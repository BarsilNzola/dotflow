import { decodeEventLog, type Log } from 'viem'
import { DotFlowRouterABI, LiquidityManagerABI, CrossChainExecutorABI } from './contracts/index.js'
import { prisma } from './db.js'
import logger from './logger.js'

const ABIS = {
  router: DotFlowRouterABI,
  liquidityManager: LiquidityManagerABI,
  xcmExecutor: CrossChainExecutorABI
}

export async function processEvent(log: Log, chainId: number) {
  try {
    // Determine which contract emitted the event
    let contractType: 'router' | 'liquidityManager' | 'xcmExecutor' | null = null
    
    if (log.address.toLowerCase() === config.router?.toLowerCase()) {
      contractType = 'router'
    } else if (log.address.toLowerCase() === config.liquidityManager?.toLowerCase()) {
      contractType = 'liquidityManager'
    } else if (log.address.toLowerCase() === config.xcmExecutor?.toLowerCase()) {
      contractType = 'xcmExecutor'
    }

    if (!contractType || !ABIS[contractType]) {
      logger.debug(`Unknown contract or ABI: ${log.address}`)
      return
    }

    // Decode the event using the actual ABI
    const decoded = decodeEventLog({
      abi: ABIS[contractType],
      data: log.data,
      topics: log.topics
    })

    // Store raw event
    await prisma.contractEvent.create({
      data: {
        chainId,
        contractAddress: log.address,
        eventName: decoded.eventName,
        blockNumber: BigInt(log.blockNumber || 0),
        blockHash: log.blockHash || '',
        transactionHash: log.transactionHash || '',
        logIndex: log.logIndex || 0,
        args: decoded.args,
        raw: log
      }
    })

    // Process based on event name
    switch (decoded.eventName) {
      case 'SwapCreated':
        await handleSwapCreated(decoded.args, chainId, log)
        break
      case 'SwapExecuted':
        await handleSwapExecuted(decoded.args, chainId, log)
        break
      case 'CrossChainSwapInitiated':
        await handleCrossChainSwap(decoded.args, chainId, log)
        break
      // ... handle other events
    }

    logger.debug(`Processed ${decoded.eventName} on chain ${chainId}`)
  } catch (error) {
    logger.error('Error processing event:', error)
  }
}

async function handleSwapCreated(args: any, chainId: number, log: Log) {
  // Extract arguments based on actual ABI structure
  const { swapId, user, tokenIn, tokenOut, amountIn, amountOutMin, recipient, deadline } = args

  await prisma.swap.create({
    data: {
      swapId,
      userAddress: user,
      tokenInAddress: tokenIn,
      tokenOutAddress: tokenOut,
      amountIn: BigInt(amountIn),
      amountOutMin: BigInt(amountOutMin),
      recipient,
      deadline: BigInt(deadline),
      status: 'PENDING',
      txHash: log.transactionHash || '',
      blockNumber: BigInt(log.blockNumber || 0),
      blockTimestamp: new Date(), // Will be updated with actual block time
      chainId
    }
  })

  logger.info(`Swap created: ${swapId}`)
}