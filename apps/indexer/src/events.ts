import { prisma } from './db'
import logger from './logger'
import { formatUnits } from 'viem'

export async function handleSwapEvent(log: any, chainId: number) {
  const { args, transactionHash, blockNumber, blockHash } = log

  try {
    // Get or create tokens
    const tokenIn = await getOrCreateToken(chainId, args.tokenIn)
    const tokenOut = await getOrCreateToken(chainId, args.tokenOut)

    // Create swap record
    const swap = await prisma.swap.create({
      data: {
        swapId: args.swapId,
        userAddress: args.user,
        tokenInAddress: args.tokenIn,
        tokenOutAddress: args.tokenOut,
        amountIn: BigInt(args.amountIn.toString()),
        amountOut: 0n, // Will be updated when SwapExecuted is processed
        amountOutMin: BigInt(args.amountOutMin.toString()),
        recipient: args.recipient,
        fee: 0n,
        protocolFee: 0n,
        status: 'PENDING',
        txHash: transactionHash,
        blockNumber: BigInt(blockNumber),
        blockTimestamp: new Date(), // Will be updated with actual timestamp
        chainId
      }
    })

    logger.info(`Swap created: ${args.swapId}`)
    return swap
  } catch (error) {
    logger.error('Error handling swap event:', error)
    throw error
  }
}

export async function handleSwapExecutedEvent(log: any, chainId: number) {
  const { args } = log

  try {
    const swap = await prisma.swap.update({
      where: { swapId: args.swapId },
      data: {
        amountOut: BigInt(args.amountOut.toString()),
        fee: BigInt(args.fee.toString()),
        status: 'COMPLETED'
      }
    })

    logger.info(`Swap executed: ${args.swapId}, amountOut: ${args.amountOut}`)
    return swap
  } catch (error) {
    logger.error('Error handling swap executed event:', error)
    throw error
  }
}

export async function handleCrossChainEvent(log: any, chainId: number) {
  const { args } = log

  try {
    // Update swap with XCM info
    const swap = await prisma.swap.update({
      where: { swapId: args.swapId },
      data: {
        xcmMessage: {
          create: {
            messageId: args.xcmMessageId,
            sourceChainId: chainId,
            destinationChainId: args.destinationChain,
            sender: args.sender || '',
            recipient: args.recipient || '',
            amount: BigInt(args.amount.toString()),
            status: 'PREPARED',
            timeout: 3600n
          }
        }
      },
      include: { xcmMessage: true }
    })

    logger.info(`Cross-chain swap initiated: ${args.swapId} -> chain ${args.destinationChain}`)
    return swap
  } catch (error) {
    logger.error('Error handling cross-chain event:', error)
    throw error
  }
}

export async function handleXCMEvent(log: any, chainId: number) {
  const { args, eventName } = log

  try {
    let status = 'PREPARED'
    
    switch (eventName) {
      case 'XCMMessageExecuted':
        status = 'EXECUTED'
        break
      case 'XCMMessageExpired':
        status = 'EXPIRED'
        break
      case 'XCMMessageCancelled':
        status = 'CANCELLED'
        break
    }

    const xcmMessage = await prisma.xCMMessage.update({
      where: { messageId: args.messageId },
      data: {
        status,
        executedAt: status === 'EXECUTED' ? new Date() : undefined
      }
    })

    logger.info(`XCM message ${args.messageId} status: ${status}`)
    return xcmMessage
  } catch (error) {
    logger.error('Error handling XCM event:', error)
    throw error
  }
}

export async function handleAdapterEvent(log: any, chainId: number) {
  const { args, eventName } = log

  try {
    if (eventName === 'AdapterAdded') {
      const adapter = await prisma.adapter.upsert({
        where: { address: args.adapter },
        update: {
          name: args.name,
          fee: args.fee,
          isActive: true
        },
        create: {
          address: args.adapter,
          chainId,
          name: args.name,
          type: 'CUSTOM', // Will be updated when we fetch adapter info
          fee: args.fee,
          minSwapAmount: 0n,
          maxSwapAmount: 0n,
          tvl: 0n,
          isActive: true
        }
      })

      logger.info(`Adapter added: ${args.name} (${args.adapter})`)
      return adapter
    } else if (eventName === 'AdapterRemoved') {
      const adapter = await prisma.adapter.update({
        where: { address: args.adapter },
        data: { isActive: false }
      })

      logger.info(`Adapter removed: ${args.adapter}`)
      return adapter
    }
  } catch (error) {
    logger.error('Error handling adapter event:', error)
    throw error
  }
}

export async function handleLiquidityEvent(log: any, chainId: number) {
  const { args, eventName } = log

  try {
    switch (eventName) {
      case 'PoolCreated':
        await prisma.liquidityPool.upsert({
          where: { tokenAddress_chainId: { tokenAddress: args.token, chainId } },
          update: {
            totalLiquidity: BigInt(args.initialLiquidity.toString()),
            availableLiquidity: BigInt(args.initialLiquidity.toString()),
            feeRate: args.feeRate,
            isActive: true
          },
          create: {
            tokenAddress: args.token,
            chainId,
            totalLiquidity: BigInt(args.initialLiquidity.toString()),
            availableLiquidity: BigInt(args.initialLiquidity.toString()),
            borrowedLiquidity: 0n,
            utilizationRate: 0,
            feeRate: args.feeRate,
            reserveFactor: 0n,
            minLiquidity: 0n,
            maxLiquidity: 0n,
            isActive: true
          }
        })
        logger.info(`Pool created for token ${args.token}`)
        break

      case 'LiquidityAdded':
        await prisma.liquidityPool.update({
          where: { tokenAddress_chainId: { tokenAddress: args.token, chainId } },
          data: {
            totalLiquidity: { increment: BigInt(args.amount.toString()) },
            availableLiquidity: { increment: BigInt(args.amount.toString()) }
          }
        })

        await prisma.liquidityPosition.upsert({
          where: {
            provider_tokenAddress_chainId: {
              provider: args.provider,
              tokenAddress: args.token,
              chainId
            }
          },
          update: {
            shares: { increment: BigInt(args.shares.toString()) },
            lastDeposit: new Date()
          },
          create: {
            provider: args.provider,
            tokenAddress: args.token,
            chainId,
            shares: BigInt(args.shares.toString()),
            entryTimestamp: new Date(),
            lastDeposit: new Date(),
            accruedFees: 0n,
            pendingFees: 0n
          }
        })
        logger.info(`Liquidity added: ${args.amount} ${args.token} by ${args.provider}`)
        break

      case 'LiquidityRemoved':
        await prisma.liquidityPool.update({
          where: { tokenAddress_chainId: { tokenAddress: args.token, chainId } },
          data: {
            totalLiquidity: { decrement: BigInt(args.amount.toString()) },
            availableLiquidity: { decrement: BigInt(args.amount.toString()) }
          }
        })

        await prisma.liquidityPosition.update({
          where: {
            provider_tokenAddress_chainId: {
              provider: args.provider,
              tokenAddress: args.token,
              chainId
            }
          },
          data: {
            shares: { decrement: BigInt(args.shares.toString()) },
            lastWithdraw: new Date()
          }
        })
        logger.info(`Liquidity removed: ${args.amount} ${args.token} by ${args.provider}`)
        break
    }
  } catch (error) {
    logger.error('Error handling liquidity event:', error)
    throw error
  }
}

async function getOrCreateToken(chainId: number, address: string) {
  // Try to find existing token
  let token = await prisma.token.findUnique({
    where: { address_chainId: { address, chainId } }
  })

  if (!token) {
    // For now, create a placeholder
    // In production, you'd fetch token info from the contract
    token = await prisma.token.create({
      data: {
        address,
        chainId,
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        decimals: 18
      }
    })
  }

  return token
}