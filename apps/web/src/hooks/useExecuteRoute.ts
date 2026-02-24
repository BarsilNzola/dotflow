import { useCallback } from 'react'
import { useWriteContract, usePublicClient } from 'wagmi'
import { parseUnits, type Address } from 'viem'
import { useSwapStore } from '../store/useSwapStore'
import { useWalletStore } from '../store/useWalletStore'
import { useTransactionStore } from '../store/useTransactionStore'
import { getContractAddress, type ChainId, type ContractName } from '../contracts/addresses'
import DotFlowRouterABI from '../contracts/abi/DotFlowRouter.json'
import CrossChainExecutorABI from '../contracts/abi/CrossChainExecutor.json'
import toast from 'react-hot-toast'
import { Transaction } from '../types'

// Type assertions for ABIs
const routerABI = DotFlowRouterABI as any
const executorABI = CrossChainExecutorABI as any

export function useExecuteRoute() {
  const { tokenIn, tokenOut, amountIn, slippage, deadline, recipient, quote, path } = useSwapStore()
  const { address, chainId } = useWalletStore()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const { addTransaction, updateTransaction } = useTransactionStore()

  const executeSwap = useCallback(async () => {
    if (!tokenIn || !tokenOut || !amountIn || !quote || !path || !address || !chainId || !publicClient) {
      toast.error('Missing required swap data')
      return
    }

    const toastId = toast.loading('Preparing swap...')

    try {
      const routerAddress = getContractAddress(chainId as ChainId, 'dotFlowRouter' as ContractName)
      const amountInParsed = parseUnits(amountIn, tokenIn.decimals)
      
      // Calculate deadline
      const deadlineTimestamp = BigInt(Math.floor(Date.now() / 1000) + (deadline * 60))
      
      // Calculate min amount out with slippage
      const slippageBps = BigInt(Math.floor(slippage * 100))
      const amountOutMin = quote.amountOut - (quote.amountOut * slippageBps / 10000n)

      const txHash = await writeContractAsync({
        address: routerAddress,
        abi: routerABI,
        functionName: 'swap',
        args: [
          tokenIn.address as Address,
          tokenOut.address as Address,
          amountInParsed,
          amountOutMin,
          (recipient || address) as Address,
          path,
          deadlineTimestamp
        ]
      })

      const transaction: Transaction = {
        hash: txHash,
        type: 'swap',
        status: 'pending',
        from: address,
        to: routerAddress,
        value: amountInParsed,
        timestamp: Date.now(),
        description: `Swap ${amountIn} ${tokenIn.symbol} to ${tokenOut.symbol}`
      }

      addTransaction(transaction)

      toast.success('Swap submitted!', { id: toastId })

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` })

      if (receipt?.status === 'success') {
        updateTransaction(txHash, { status: 'confirmed' })
        toast.success('Swap completed successfully!')
        
        // Try to get swapId from logs
        const swapCreatedLog = receipt.logs.find(
          (log: any) => log.topics[0] === '0x...' // SwapCreated event signature
        )
        
        if (swapCreatedLog) {
          const swapId = swapCreatedLog.topics[1]
          console.log('Swap ID:', swapId)
        }
      } else {
        updateTransaction(txHash, { status: 'failed' })
        toast.error('Swap failed')
      }

      return receipt
    } catch (error: any) {
      console.error('Swap error:', error)
      toast.error(error.message || 'Swap failed', { id: toastId })
      throw error
    }
  }, [tokenIn, tokenOut, amountIn, quote, path, address, chainId, slippage, deadline, recipient, writeContractAsync, publicClient, addTransaction, updateTransaction])

  const executeCrossChainSwap = useCallback(async (
    destinationChainId: number,
    xcmCallData: string,
    xcmTimeout: number
  ) => {
    if (!tokenIn || !tokenOut || !amountIn || !quote || !path || !address || !chainId || !publicClient) {
      toast.error('Missing required swap data')
      return
    }

    const toastId = toast.loading('Preparing cross-chain swap...')

    try {
      const routerAddress = getContractAddress(chainId as ChainId, 'dotFlowRouter' as ContractName)
      const amountInParsed = parseUnits(amountIn, tokenIn.decimals)
      
      const deadlineTimestamp = BigInt(Math.floor(Date.now() / 1000) + (deadline * 60))
      
      const slippageBps = BigInt(Math.floor(slippage * 100))
      const amountOutMin = quote.amountOut - (quote.amountOut * slippageBps / 10000n)

      // Calculate XCM fee
      const xcmExecutorAddress = getContractAddress(chainId as ChainId, 'crossChainExecutor' as ContractName)
      
      // Use type assertion for the readContract calls
      const weight = await publicClient.readContract({
        address: xcmExecutorAddress,
        abi: executorABI,
        functionName: '_calculateWeight',
        args: [tokenOut.address, quote.amountOut, xcmCallData]
      }) as bigint

      const xcmFee = await publicClient.readContract({
        address: xcmExecutorAddress,
        abi: executorABI,
        functionName: 'calculateFee',
        args: [destinationChainId, weight, quote.amountOut]
      }) as bigint

      const txHash = await writeContractAsync({
        address: routerAddress,
        abi: routerABI,
        functionName: 'crossChainSwap',
        args: [
          tokenIn.address as Address,
          tokenOut.address as Address,
          amountInParsed,
          amountOutMin,
          address as Address, // Router will forward to recipient on destination
          path,
          destinationChainId,
          xcmCallData as `0x${string}`,
          BigInt(xcmTimeout),
          deadlineTimestamp
        ],
        value: xcmFee
      })

      const transaction: Transaction = {
        hash: txHash,
        type: 'cross-chain-swap',
        status: 'pending',
        from: address,
        to: routerAddress,
        value: amountInParsed,
        timestamp: Date.now(),
        description: `Cross-chain swap ${amountIn} ${tokenIn.symbol} to ${tokenOut.symbol} on chain ${destinationChainId}`
      }

      addTransaction(transaction)

      toast.success('Cross-chain swap submitted!', { id: toastId })

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` })

      if (receipt?.status === 'success') {
        updateTransaction(txHash, { status: 'confirmed' })
        toast.success('Cross-chain swap initiated successfully!')
        
        // Try to get XCM message ID from logs
        const xcmInitiatedLog = receipt.logs.find(
          (log: any) => log.topics[0] === '0x...' // CrossChainSwapInitiated event signature
        )
        
        if (xcmInitiatedLog) {
          const xcmMessageId = xcmInitiatedLog.topics[2]
          console.log('XCM Message ID:', xcmMessageId)
        }
      } else {
        updateTransaction(txHash, { status: 'failed' })
        toast.error('Cross-chain swap failed')
      }

      return receipt
    } catch (error: any) {
      console.error('Cross-chain swap error:', error)
      toast.error(error.message || 'Cross-chain swap failed', { id: toastId })
      throw error
    }
  }, [tokenIn, tokenOut, amountIn, quote, path, address, chainId, slippage, deadline, writeContractAsync, publicClient, addTransaction, updateTransaction])

  return {
    executeSwap,
    executeCrossChainSwap
  }
}