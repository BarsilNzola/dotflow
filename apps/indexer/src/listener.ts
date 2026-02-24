import { createPublicClient, http, webSocket, parseAbiItem } from 'viem'
import { mainnet, polygon, arbitrum, optimism, base, bsc } from 'viem/chains'
import { prisma } from './db'
import logger from './logger'
import { handleSwapEvent, handleCrossChainEvent, handleAdapterEvent } from './events'
import { startParachainListener } from './parachain'

// Contract ABIs for events
const DOTFLOW_ROUTER_ABI = [
  parseAbiItem('event SwapCreated(bytes32 indexed swapId, address indexed user, address indexed tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, address recipient, uint256 deadline)'),
  parseAbiItem('event SwapExecuted(bytes32 indexed swapId, address indexed user, uint256 amountOut, uint256 fee, uint256 timestamp)'),
  parseAbiItem('event CrossChainSwapInitiated(bytes32 indexed swapId, bytes32 indexed xcmMessageId, uint32 indexed destinationChain, uint256 amount)'),
  parseAbiItem('event CrossChainSwapCompleted(bytes32 indexed swapId, bytes32 indexed xcmMessageId, address recipient, uint256 amount)'),
  parseAbiItem('event AdapterAdded(address indexed adapter, string name, uint24 fee)'),
  parseAbiItem('event AdapterRemoved(address indexed adapter)')
]

const LIQUIDITY_MANAGER_ABI = [
  parseAbiItem('event PoolCreated(address indexed token, string name, string symbol, uint256 initialLiquidity, uint24 feeRate, address creator)'),
  parseAbiItem('event LiquidityAdded(address indexed provider, address indexed token, uint256 amount, uint256 shares, uint256 totalLiquidity)'),
  parseAbiItem('event LiquidityRemoved(address indexed provider, address indexed token, uint256 amount, uint256 shares, uint256 fee)'),
  parseAbiItem('event FeesClaimed(address indexed provider, address indexed token, uint256 amount)')
]

const XCM_EXECUTOR_ABI = [
  parseAbiItem('event XCMMessagePrepared(bytes32 indexed messageId, uint32 indexed destinationChainId, address indexed sender, address recipient, address asset, uint256 amount, uint64 timeout)'),
  parseAbiItem('event XCMMessageExecuted(bytes32 indexed messageId, bytes32 indexed transactionHash, bool success)'),
  parseAbiItem('event XCMMessageExpired(bytes32 indexed messageId)'),
  parseAbiItem('event XCMMessageCancelled(bytes32 indexed messageId)')
]

const CHAIN_CONFIGS = {
  1: { chain: mainnet, router: '0x...', liquidityManager: '0x...', xcmExecutor: '0x...' },
  137: { chain: polygon, router: '0x...', liquidityManager: '0x...', xcmExecutor: '0x...' },
  42161: { chain: arbitrum, router: '0x...', liquidityManager: '0x...', xcmExecutor: '0x...' },
  10: { chain: optimism, router: '0x...', liquidityManager: '0x...', xcmExecutor: '0x...' },
  8453: { chain: base, router: '0x...', liquidityManager: '0x...', xcmExecutor: '0x...' },
  56: { chain: bsc, router: '0x...', liquidityManager: '0x...', xcmExecutor: '0x...' }
}

export async function startListener() {
  logger.info('Starting blockchain listeners...')

  // Start EVM chain listeners
  for (const [chainIdStr, config] of Object.entries(CHAIN_CONFIGS)) {
    const chainId = parseInt(chainIdStr)
    startEVMListener(chainId, config)
  }

  // Start parachain listeners
  await startParachainListener()
}

async function startEVMListener(chainId: number, config: any) {
  try {
    const chain = await prisma.chain.findUnique({ where: { chainId } })
    if (!chain || !chain.wsUrl) {
      logger.warn(`No WebSocket URL for chain ${chainId}, skipping...`)
      return
    }

    const client = createPublicClient({
      chain: config.chain,
      transport: webSocket(chain.wsUrl)
    })

    logger.info(`Listening to chain ${chainId} (${chain.name})`)

    // Get last synced block
    const syncState = await prisma.syncState.upsert({
      where: { chainId },
      update: {},
      create: { chainId, lastBlock: 0n }
    })

    let currentBlock = syncState.lastBlock
    const latestBlock = await client.getBlockNumber()

    // Process historical blocks if needed
    if (currentBlock < latestBlock) {
      logger.info(`Catching up chain ${chainId} from block ${currentBlock} to ${latestBlock}`)
      await processBlocksInRange(client, chainId, currentBlock + 1n, latestBlock)
    }

    // Watch for new blocks
    client.watchBlockNumber({
      onBlockNumber: async (blockNumber) => {
        logger.debug(`New block on chain ${chainId}: ${blockNumber}`)
        await processBlocksInRange(client, chainId, currentBlock + 1n, blockNumber)
        currentBlock = blockNumber
        
        await prisma.syncState.update({
          where: { chainId },
          data: { lastBlock: blockNumber, lastSync: new Date() }
        })
      },
      onError: (error) => {
        logger.error(`Error watching blocks on chain ${chainId}:`, error)
      }
    })
  } catch (error) {
    logger.error(`Failed to start listener for chain ${chainId}:`, error)
  }
}

async function processBlocksInRange(
  client: any,
  chainId: number,
  fromBlock: bigint,
  toBlock: bigint
) {
  const BATCH_SIZE = 100n
  let currentFrom = fromBlock

  while (currentFrom <= toBlock) {
    const currentTo = currentFrom + BATCH_SIZE - 1n > toBlock ? toBlock : currentFrom + BATCH_SIZE - 1n
    
    try {
      await processBlockRange(client, chainId, currentFrom, currentTo)
    } catch (error) {
      logger.error(`Error processing blocks ${currentFrom}-${currentTo} on chain ${chainId}:`, error)
    }

    currentFrom = currentTo + 1n
  }
}

async function processBlockRange(
  client: any,
  chainId: number,
  fromBlock: bigint,
  toBlock: bigint
) {
  logger.debug(`Processing blocks ${fromBlock} to ${toBlock} on chain ${chainId}`)

  const config = CHAIN_CONFIGS[chainId as keyof typeof CHAIN_CONFIGS]
  if (!config) return

  // Get logs for all relevant contracts
  const logs = await client.getLogs({
    address: [config.router, config.liquidityManager, config.xcmExecutor],
    events: [
      ...DOTFLOW_ROUTER_ABI,
      ...LIQUIDITY_MANAGER_ABI,
      ...XCM_EXECUTOR_ABI
    ],
    fromBlock,
    toBlock
  })

  for (const log of logs) {
    try {
      await processLog(log, chainId)
    } catch (error) {
      logger.error(`Error processing log:`, { log, error })
    }
  }
}

async function processLog(log: any, chainId: number) {
  const eventName = log.eventName

  switch (eventName) {
    case 'SwapCreated':
      await handleSwapEvent(log, chainId)
      break
    case 'CrossChainSwapInitiated':
      await handleCrossChainEvent(log, chainId)
      break
    case 'AdapterAdded':
    case 'AdapterRemoved':
      await handleAdapterEvent(log, chainId)
      break
    case 'PoolCreated':
    case 'LiquidityAdded':
    case 'LiquidityRemoved':
      await handleLiquidityEvent(log, chainId)
      break
    case 'XCMMessagePrepared':
    case 'XCMMessageExecuted':
    case 'XCMMessageExpired':
    case 'XCMMessageCancelled':
      await handleXCMEvent(log, chainId)
      break
    default:
      logger.debug(`Unhandled event: ${eventName}`)
  }
}