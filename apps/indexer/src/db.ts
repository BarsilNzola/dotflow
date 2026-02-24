import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error']
})

export async function initializeChains() {
  const chains = [
    // EVM Chains
    { chainId: 1, name: 'Ethereum', type: 'EVM', rpcUrl: process.env.ETH_RPC_URL, wsUrl: process.env.ETH_WS_URL },
    { chainId: 137, name: 'Polygon', type: 'EVM', rpcUrl: process.env.POLYGON_RPC_URL, wsUrl: process.env.POLYGON_WS_URL },
    { chainId: 42161, name: 'Arbitrum', type: 'EVM', rpcUrl: process.env.ARBITRUM_RPC_URL, wsUrl: process.env.ARBITRUM_WS_URL },
    { chainId: 10, name: 'Optimism', type: 'EVM', rpcUrl: process.env.OPTIMISM_RPC_URL, wsUrl: process.env.OPTIMISM_WS_URL },
    { chainId: 8453, name: 'Base', type: 'EVM', rpcUrl: process.env.BASE_RPC_URL, wsUrl: process.env.BASE_WS_URL },
    { chainId: 56, name: 'BNB Chain', type: 'EVM', rpcUrl: process.env.BNB_RPC_URL, wsUrl: process.env.BNB_WS_URL },
    
    // Parachains
    { chainId: 2000, name: 'Polkadot Hub', type: 'PARACHAIN', rpcUrl: process.env.POLKADOT_HUB_RPC_URL, wsUrl: process.env.POLKADOT_HUB_WS_URL },
    { chainId: 2004, name: 'Moonbeam', type: 'PARACHAIN', rpcUrl: process.env.MOONBEAM_RPC_URL, wsUrl: process.env.MOONBEAM_WS_URL },
    { chainId: 2006, name: 'Astar', type: 'PARACHAIN', rpcUrl: process.env.ASTAR_RPC_URL, wsUrl: process.env.ASTAR_WS_URL }
  ]

  for (const chain of chains) {
    await prisma.chain.upsert({
      where: { chainId: chain.chainId },
      update: {
        name: chain.name,
        rpcUrl: chain.rpcUrl,
        wsUrl: chain.wsUrl,
        isActive: true
      },
      create: {
        chainId: chain.chainId,
        name: chain.name,
        type: chain.type as any,
        rpcUrl: chain.rpcUrl,
        wsUrl: chain.wsUrl,
        isActive: true
      }
    })
  }

  logger.info('Chains initialized')
}