import 'dotenv/config'
import { createPublicClient, http, type Log, type Address } from 'viem'
import { prisma } from './db'
import DotFlowRouterABI from '../../web/src/contracts/abi/DotFlowRouter.json'
import logger from './logger'

// Define Polkadot Hub chain
const POLKADOT_HUB = {
  id: Number(process.env.CHAIN_ID) || 0,
  name: 'Polkadot Hub',
  nativeCurrency: {
    decimals: 10,
    name: 'DOT',
    symbol: 'DOT',
  },
  rpcUrls: {
    default: { http: [process.env.RPC_URL || ''] },
    public: { http: [process.env.RPC_URL || ''] },
  },
}

const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS as Address
const RPC_URL = process.env.RPC_URL

if (!RPC_URL) {
  throw new Error('RPC_URL is required in .env')
}

if (!ROUTER_ADDRESS) {
  throw new Error('ROUTER_ADDRESS is required in .env')
}

// Extract the ABI array from the JSON
const routerABI = DotFlowRouterABI.abi

// Define event types based on your contract
interface SwapCreatedEvent {
  swapId: string
  user: Address
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  amountOutMin: bigint
  recipient: Address
  deadline: bigint
}

interface SwapExecutedEvent {
  swapId: string
  user: Address
  amountOut: bigint
  fee: bigint
  timestamp: bigint
}

interface CrossChainSwapInitiatedEvent {
  swapId: string
  xcmMessageId: string
  destinationChain: number
  amount: bigint
}

async function main() {
  logger.info('Starting DotFlow Indexer on Polkadot Hub')
  
  const client = createPublicClient({
    chain: POLKADOT_HUB,
    transport: http(RPC_URL)
  })

  // Listen for your contract events
  const unwatch = client.watchContractEvent({
    address: ROUTER_ADDRESS,
    abi: routerABI,
    onLogs: async (logs) => {
      for (const log of logs) {
        try {
          // Type guard to check if log has the expected structure
          if (!('eventName' in log) || !('args' in log)) {
            logger.debug('Log missing eventName or args:', log)
            continue
          }

          const eventLog = log as Log & { 
            eventName: string; 
            args: Record<string, any> 
          }

          if (eventLog.eventName === 'SwapCreated') {
            const args = eventLog.args as unknown as SwapCreatedEvent
            await prisma.swap.create({
              data: {
                swapId: args.swapId,
                user: args.user,
                tokenIn: args.tokenIn,
                tokenOut: args.tokenOut,
                amountIn: args.amountIn.toString(),
                amountOutMin: args.amountOutMin.toString(),
                recipient: args.recipient,
                txHash: eventLog.transactionHash || '',
                timestamp: new Date()
              }
            })
            logger.info(`Swap created: ${args.swapId}`)
          }
          
          if (eventLog.eventName === 'SwapExecuted') {
            const args = eventLog.args as unknown as SwapExecutedEvent
            await prisma.swap.update({
              where: { swapId: args.swapId },
              data: {
                amountOut: args.amountOut.toString(),
                status: 'COMPLETED'
              }
            })
            logger.info(`Swap executed: ${args.swapId}`)
          }
          
          if (eventLog.eventName === 'CrossChainSwapInitiated') {
            const args = eventLog.args as unknown as CrossChainSwapInitiatedEvent
            await prisma.xCMMessage.create({
              data: {
                swapId: args.swapId,
                messageId: args.xcmMessageId,
                sourceChain: 'Polkadot Hub',
                destinationChain: args.destinationChain.toString(),
                amount: args.amount.toString(),
                timestamp: new Date()
              }
            })
            logger.info(`Cross-chain swap initiated: ${args.swapId} -> parachain ${args.destinationChain}`)
          }
        } catch (error) {
          logger.error('Error processing log:', error)
        }
      }
    }
  })

  logger.info('Indexer running. Press Ctrl+C to stop.')

  // Keep the process running
  process.on('SIGINT', () => {
    logger.info('Shutting down...')
    unwatch()
    prisma.$disconnect()
    process.exit()
  })
}

main().catch((error) => {
  logger.error('Fatal error:', error)
  process.exit(1)
})