import { ApiPromise, WsProvider } from '@polkadot/api'
import { prisma } from './db'
import logger from './logger'
import { hexToString } from '@polkadot/util'

const PARACHAIN_CONFIGS = [
  { id: 2000, name: 'Polkadot Hub', wsUrl: process.env.POLKADOT_HUB_WS_URL, paraId: 1000 },
  { id: 2004, name: 'Moonbeam', wsUrl: process.env.MOONBEAM_WS_URL, paraId: 2004 },
  { id: 2006, name: 'Astar', wsUrl: process.env.ASTAR_WS_URL, paraId: 2006 }
]

export async function startParachainListener() {
  for (const config of PARACHAIN_CONFIGS) {
    if (!config.wsUrl) {
      logger.warn(`No WebSocket URL for parachain ${config.name}, skipping...`)
      continue
    }

    startParachainListenerForChain(config)
  }
}

async function startParachainListenerForChain(config: typeof PARACHAIN_CONFIGS[0]) {
  try {
    const provider = new WsProvider(config.wsUrl)
    const api = await ApiPromise.create({ provider })

    logger.info(`Connected to parachain ${config.name} (ID: ${config.id})`)

    // Subscribe to XCM events
    await api.query.system.events((events: any) => {
      events.forEach((record: any) => {
        const { event, phase } = record
        const types = event.typeDef

        // Look for XCM-related events
        if (event.section === 'xcmPallet' || event.section === 'polkadotXcm') {
          handleParachainXCMEvent(event, config.id)
        }

        // Look for asset transfers
        if (event.section === 'assets' || event.section === 'balances') {
          handleParachainAssetEvent(event, config.id)
        }
      })
    })

    // Index existing assets
    await indexParachainAssets(api, config.id)

    // Store parachain info
    await prisma.parachain.upsert({
      where: { parachainId: config.id },
      update: {
        name: config.name,
        paraId: config.paraId,
        isActive: true
      },
      create: {
        parachainId: config.id,
        name: config.name,
        paraId: config.paraId,
        bridgeFee: 0n,
        minTransfer: 0n,
        maxTransfer: 0n,
        timeout: 3600n,
        isActive: true
      }
    })

    logger.info(`Listening to parachain ${config.name}`)
  } catch (error) {
    logger.error(`Failed to connect to parachain ${config.name}:`, error)
  }
}

async function indexParachainAssets(api: ApiPromise, parachainId: number) {
  try {
    // Index native asset
    const properties = await api.rpc.system.properties()
    const tokenSymbol = properties.tokenSymbol?.toString() || 'DOT'
    const tokenDecimals = properties.tokenDecimals?.toNumber() || 18

    await prisma.asset.upsert({
      where: { assetId_chainId: { assetId: 'native', chainId: parachainId } },
      update: {
        name: tokenSymbol,
        symbol: tokenSymbol,
        decimals: tokenDecimals,
        isNative: true
      },
      create: {
        assetId: 'native',
        chainId: parachainId,
        name: tokenSymbol,
        symbol: tokenSymbol,
        decimals: tokenDecimals,
        isNative: true
      }
    })

    // Index other assets if pallet exists
    if (api.query.assets) {
      const assetEntries = await api.query.assets.asset.entries()
      
      for (const [key, value] of assetEntries) {
        const assetId = key.args[0].toString()
        const asset = value as any
        
        if (asset) {
          await prisma.asset.upsert({
            where: { assetId_chainId: { assetId, chainId: parachainId } },
            update: {
              name: hexToString(asset.name?.toHex() || ''),
              symbol: hexToString(asset.symbol?.toHex() || ''),
              decimals: asset.decimals?.toNumber() || 18,
              totalSupply: asset.supply?.toString()
            },
            create: {
              assetId,
              chainId: parachainId,
              name: hexToString(asset.name?.toHex() || ''),
              symbol: hexToString(asset.symbol?.toHex() || ''),
              decimals: asset.decimals?.toNumber() || 18,
              totalSupply: asset.supply?.toString(),
              isNative: false
            }
          })
        }
      }
    }

    logger.info(`Indexed assets for parachain ${parachainId}`)
  } catch (error) {
    logger.error(`Error indexing assets for parachain ${parachainId}:`, error)
  }
}

async function handleParachainXCMEvent(event: any, parachainId: number) {
  try {
    const eventData = event.data.toJSON()
    const eventName = `${event.section}.${event.method}`

    logger.debug(`XCM event on parachain ${parachainId}: ${eventName}`, eventData)

    // Handle different XCM events
    switch (eventName) {
      case 'xcmPallet.sent':
      case 'polkadotXcm.sent':
        // XCM message sent
        await prisma.xCMMessage.create({
          data: {
            messageId: eventData[0] || `xcm-${Date.now()}`,
            sourceChainId: parachainId,
            destinationChainId: eventData[1] || 0,
            sender: eventData[2]?.toString() || '',
            recipient: eventData[3]?.toString() || '',
            amount: BigInt(eventData[4]?.amount || 0),
            status: 'PREPARED',
            timeout: BigInt(eventData[5]?.timeout || 3600)
          }
        })
        break

      case 'xcmPallet.attempted':
      case 'polkadotXcm.attempted':
        // XCM execution attempt
        const outcome = eventData[0]
        const messageId = eventData[1]
        
        await prisma.xCMMessage.updateMany({
          where: { messageId },
          data: {
            status: outcome === 'Complete' ? 'EXECUTED' : 'FAILED',
            executedAt: new Date()
          }
        })
        break
    }
  } catch (error) {
    logger.error(`Error handling parachain XCM event:`, error)
  }
}

async function handleParachainAssetEvent(event: any, parachainId: number) {
  try {
    const eventData = event.data.toJSON()
    const eventName = `${event.section}.${event.method}`

    logger.debug(`Asset event on parachain ${parachainId}: ${eventName}`)

    // Update asset balances/total supply
    if (eventName === 'assets.Issued' || eventName === 'assets.Burned') {
      const assetId = eventData[0]
      const amount = BigInt(eventData[1])

      const asset = await prisma.asset.findUnique({
        where: { assetId_chainId: { assetId: assetId.toString(), chainId: parachainId } }
      })

      if (asset) {
        const newSupply = eventName === 'assets.Issued'
          ? (asset.totalSupply || 0n) + amount
          : (asset.totalSupply || 0n) - amount

        await prisma.asset.update({
          where: { assetId_chainId: { assetId: assetId.toString(), chainId: parachainId } },
          data: { totalSupply: newSupply }
        })
      }
    }
  } catch (error) {
    logger.error(`Error handling parachain asset event:`, error)
  }
}