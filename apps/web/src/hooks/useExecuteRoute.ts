import { useCallback } from 'react'
import { useWriteContract, usePublicClient } from 'wagmi'
import { parseUnits, type Address, erc20Abi, formatUnits } from 'viem'
import { useSwapStore } from '../store/useSwapStore'
import { useWalletStore } from '../store/useWalletStore'
import { useTransactionStore } from '../store/useTransactionStore'
import { getContractAddress, type ChainId, type ContractName } from '../contracts/addresses'
import DotFlowRouterArtifact from '../contracts/abi/DotFlowRouter.json'
import UniswapV2AdapterArtifact from '../contracts/abi/UniswapV2Adapter.json'
import CrossChainExecutorArtifact from '../contracts/abi/CrossChainExecutor.json'
import toast from 'react-hot-toast'
import { Transaction } from '../types'

const routerABI = DotFlowRouterArtifact.abi
const uniswapAdapterABI = UniswapV2AdapterArtifact.abi
const executorABI = CrossChainExecutorArtifact.abi

export function useExecuteRoute() {
  const { tokenIn, tokenOut, amountIn, slippage, deadline, recipient, quote } = useSwapStore()
  const { address, chainId } = useWalletStore()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const { addTransaction, updateTransaction } = useTransactionStore()

  const checkAndApprove = useCallback(async (
    tokenAddress: Address,
    spenderAddress: Address,
    amount: bigint
  ): Promise<boolean> => {
    if (!address || !publicClient) return false

    try {
      console.log('🔍 Checking allowance...')
      const allowance = await publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, spenderAddress]
      }) as bigint

      console.log(`Current allowance: ${allowance.toString()}, needed: ${amount.toString()}`)

      if (allowance >= amount) {
        console.log('✅ Allowance sufficient')
        return true
      }

      console.log('❌ Allowance insufficient, requesting approval...')
      toast.success(`Please approve ${tokenIn?.symbol} in your wallet`)
      
      const approveHash = await writeContractAsync({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [spenderAddress, amount]
      })

      console.log('Approval transaction sent:', approveHash)
      await publicClient.waitForTransactionReceipt({ hash: approveHash })
      console.log('✅ Approval confirmed')
      
      // VERIFY the allowance was actually set
      const newAllowance = await publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, spenderAddress]
      }) as bigint
      
      console.log('New allowance after approval:', newAllowance.toString())
      
      if (newAllowance < amount) {
        console.error('❌ Approval failed - allowance still insufficient')
        toast.error('Approval failed. Please try again.')
        return false
      }
      
      console.log('✅ Allowance verified')
      toast.success('Approval successful!')
      return true

    } catch (error: any) {
      console.error('❌ Approval error:', error)
      toast.error(error.message || 'Approval failed')
      return false
    }
  }, [address, publicClient, writeContractAsync, tokenIn])

  const executeSwap = useCallback(async () => {
    if (!tokenIn || !tokenOut || !amountIn || !quote || !quote.path || !address || !chainId || !publicClient) {
      console.error('Missing required swap data:', {
        tokenIn: !!tokenIn,
        tokenOut: !!tokenOut,
        amountIn: !!amountIn,
        quote: !!quote,
        quotePath: !!quote?.path,
        address: !!address,
        chainId: !!chainId,
        publicClient: !!publicClient
      })
      toast.error('Missing required swap data')
      return
    }

    const toastId = toast.loading('Preparing swap...')

    try {
      const routerAddress = getContractAddress(chainId as ChainId, 'dotFlowRouter' as ContractName)
      
      // Parse amount with token's native decimals
      const amountInParsed = parseUnits(amountIn, tokenIn.decimals)
      console.log('💰 Amount in parsed (native decimals):', amountInParsed.toString())
      
      const deadlineTimestamp = BigInt(Math.floor(Date.now() / 1000) + (deadline * 60))
      
      const slippageBps = BigInt(Math.floor(slippage * 100))
      const amountOutMin = quote.amountOut - (quote.amountOut * slippageBps / 10000n)

      // ==================== DEBUG INFO ====================
      console.log('\n🔍 ========== SWAP DEBUG INFO ==========')
      console.log('Router Address:', routerAddress)
      console.log('Token In:', {
        address: tokenIn.address,
        symbol: tokenIn.symbol,
        decimals: tokenIn.decimals
      })
      console.log('Token Out:', {
        address: tokenOut.address,
        symbol: tokenOut.symbol,
        decimals: tokenOut.decimals
      })
      console.log('Amount In (user):', amountIn)
      console.log('Amount In (parsed):', amountInParsed.toString())
      console.log('Amount Out (quote):', quote.amountOut.toString())
      console.log('Amount Out (formatted):', formatUnits(quote.amountOut, tokenOut.decimals), tokenOut.symbol)
      console.log('Slippage:', slippage, '%')
      console.log('Slippage BPS:', slippageBps.toString())
      console.log('Amount Out Min (raw):', amountOutMin.toString())
      console.log('Amount Out Min (formatted):', formatUnits(amountOutMin, tokenOut.decimals), tokenOut.symbol)
      console.log('Deadline:', deadlineTimestamp.toString())
      console.log('Recipient:', recipient || address)
      console.log('Path:', JSON.stringify(quote.path, (_key, value) =>  
        typeof value === 'bigint' ? value.toString() : value, 2))
      // ===================================================

      // Check token balance
      console.log('\n💰 Checking balance...')
      const balance = await publicClient.readContract({
        address: tokenIn.address as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address as Address]
      }) as bigint
      console.log(`${tokenIn.symbol} Balance:`, balance.toString())
      console.log(`${tokenIn.symbol} Balance (formatted):`, formatUnits(balance, tokenIn.decimals), tokenIn.symbol)
      
      if (balance < amountInParsed) {
        console.error('❌ Insufficient balance')
        toast.error(`Insufficient ${tokenIn.symbol} balance`)
        toast.dismiss(toastId)
        return
      }
      console.log('✅ Balance sufficient')

      // Check and handle approval
      console.log('\n🔑 Checking allowance...')
      const isApproved = await checkAndApprove(
        tokenIn.address as Address,
        routerAddress,
        amountInParsed
      )

      if (!isApproved) {
        toast.dismiss(toastId)
        return
      }

      // ==================== ADAPTER DEBUG ====================
      const adapterAddress = quote.path.adapters[0] as Address
      console.log('\n🔧 ========== ADAPTER DEBUG ==========')
      console.log('Adapter Address:', adapterAddress)
      
      try {
        // Check if adapter is active
        const isActive = await publicClient.readContract({
          address: adapterAddress,
          abi: uniswapAdapterABI,
          functionName: 'isActive'
        }) as boolean
        console.log('Adapter active:', isActive)
        
        // Get adapter info
        const adapterInfo = await publicClient.readContract({
          address: adapterAddress,
          abi: uniswapAdapterABI,
          functionName: 'getAdapterInfo'
        }) as any
        console.log('Adapter info:', {
          name: adapterInfo.name,
          minSwap: adapterInfo.minSwapAmount.toString(),
          maxSwap: adapterInfo.maxSwapAmount.toString(),
          fee: adapterInfo.fee
        })
        
        // Get pair info from adapter
        const pairInfo = await publicClient.readContract({
          address: adapterAddress,
          abi: uniswapAdapterABI,
          functionName: 'getPairInfo',
          args: [tokenIn.address as Address, tokenOut.address as Address]
        }) as any
        
        console.log('Adapter pair info:', {
          pair: pairInfo[0],
          reserve0: pairInfo[1].toString(),
          reserve0Formatted: formatUnits(pairInfo[1], tokenIn.decimals),
          reserve1: pairInfo[2].toString(),
          reserve1Formatted: formatUnits(pairInfo[2], tokenOut.decimals),
          liquidity: pairInfo[4].toString()
        })
        
        // Check if tokens are supported
        const isTokenInSupported = await publicClient.readContract({
          address: adapterAddress,
          abi: uniswapAdapterABI,
          functionName: 'isTokenSupported',
          args: [tokenIn.address as Address]
        }) as boolean
        
        const isTokenOutSupported = await publicClient.readContract({
          address: adapterAddress,
          abi: uniswapAdapterABI,
          functionName: 'isTokenSupported',
          args: [tokenOut.address as Address]
        }) as boolean
        
        console.log('Token In supported:', isTokenInSupported)
        console.log('Token Out supported:', isTokenOutSupported)
        
      } catch (adapterError: any) {
        console.error('❌ Failed to get adapter info:', adapterError)
      }
      // =======================================================


      // Try to simulate the contract call first
      console.log('\n🎭 Simulating contract call...')
      try {
        const { request } = await publicClient.simulateContract({
          address: routerAddress,
          abi: routerABI,
          functionName: 'swap',
          args: [
            tokenIn.address as Address,
            tokenOut.address as Address,
            amountInParsed,
            amountOutMin,
            (recipient || address) as Address,
            quote.path,
            deadlineTimestamp
          ],
          account: address as Address
        })
        console.log('✅ Simulation successful!')
        console.log('Transaction request:', request)
      } catch (simulateError: any) {
        console.error('❌ Simulation failed:', simulateError)
        
        // Try to decode the error
        if (simulateError.cause?.data) {
          console.error('Error data:', simulateError.cause.data)
          
          // Check for common error signatures
          const errorData = simulateError.cause.data
          if (errorData.includes('0xfb8f41b2')) {
            toast.error('Transfer failed - check token balance and approvals')
          } else if (errorData.includes('0x46f4384b')) {
            toast.error('Invalid amount - outside allowed range')
          } else {
            toast.error('Transaction would fail. Check your inputs.')
          }
        } else {
          toast.error('Transaction would fail. Check your inputs.')
        }
        
        console.log('\n📝 Debug information:')
        console.log('Amount In:', amountIn, tokenIn.symbol)
        console.log('Amount Out Min:', formatUnits(amountOutMin, tokenOut.decimals), tokenOut.symbol)
        console.log('Quote Amount Out:', formatUnits(quote.amountOut, tokenOut.decimals), tokenOut.symbol)
        
        toast.dismiss(toastId)
        return
      }

      // Estimate gas
      console.log('\n⛽ Estimating gas...')
      try {
        const gasEstimate = await publicClient.estimateContractGas({
          address: routerAddress,
          abi: routerABI,
          functionName: 'swap',
          args: [
            tokenIn.address as Address,
            tokenOut.address as Address,
            amountInParsed,
            amountOutMin,
            (recipient || address) as Address,
            quote.path,
            deadlineTimestamp
          ],
          account: address as Address
        })
        console.log('✅ Gas estimate:', gasEstimate.toString())
      } catch (estimateError: any) {
        console.error('❌ Gas estimation failed:', estimateError)
        toast.error('Transaction would fail. Check your inputs.')
        toast.dismiss(toastId)
        return
      }

      // Send transaction
      console.log('\n📤 Sending transaction...')
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
          quote.path,
          deadlineTimestamp
        ]
      })

      console.log('✅ Transaction sent:', txHash)

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
      } else {
        updateTransaction(txHash, { status: 'failed' })
        toast.error('Swap failed')
      }

      return receipt
    } catch (error: any) {
      console.error('❌ Swap error:', error)
      toast.error(error.message || 'Swap failed', { id: toastId })
      throw error
    }
  }, [tokenIn, tokenOut, amountIn, quote, address, chainId, slippage, deadline, recipient, writeContractAsync, publicClient, addTransaction, updateTransaction, checkAndApprove])

  const executeCrossChainSwap = useCallback(async (
    destinationChainId: number,
    xcmCallData: string,
    xcmTimeout: number
  ) => {
    if (!tokenIn || !tokenOut || !amountIn || !quote || !quote.path || !address || !chainId || !publicClient) {
      console.error('Missing required cross-chain swap data:', {
        tokenIn: !!tokenIn,
        tokenOut: !!tokenOut,
        amountIn: !!amountIn,
        quote: !!quote,
        quotePath: !!quote?.path,
        address: !!address,
        chainId: !!chainId,
        publicClient: !!publicClient
      })
      toast.error('Missing required swap data')
      return
    }

    const toastId = toast.loading('Preparing cross-chain swap...')

    try {
      const routerAddress = getContractAddress(chainId as ChainId, 'dotFlowRouter' as ContractName)
      
      const amountInParsed = parseUnits(amountIn, tokenIn.decimals)
      console.log('💰 Amount in parsed (native decimals):', amountInParsed.toString())
      
      const deadlineTimestamp = BigInt(Math.floor(Date.now() / 1000) + 3600)
      
      const slippageBps = BigInt(Math.floor(slippage * 100))
      const amountOutMin = quote.amountOut - (quote.amountOut * slippageBps / 10000n)

      console.log('\n🔍 ========== CROSS-CHAIN SWAP DEBUG ==========')
      console.log('Destination Chain:', destinationChainId)
      console.log('XCM Timeout:', xcmTimeout)
      console.log('XCM Call Data:', xcmCallData)

      const isApproved = await checkAndApprove(
        tokenIn.address as Address,
        routerAddress,
        amountInParsed
      )

      if (!isApproved) {
        toast.dismiss(toastId)
        return
      }

      const xcmExecutorAddress = getContractAddress(chainId as ChainId, 'crossChainExecutor' as ContractName)
      
      console.log('XCM Executor:', xcmExecutorAddress)
      
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

      console.log('XCM Weight:', weight.toString())
      console.log('XCM Fee:', xcmFee.toString())

      // Simulate cross-chain swap
      try {
        await publicClient.simulateContract({
          address: routerAddress,
          abi: routerABI,
          functionName: 'crossChainSwap',
          args: [
            tokenIn.address as Address,
            tokenOut.address as Address,
            amountInParsed,
            amountOutMin,
            address as Address,
            quote.path,
            destinationChainId,
            xcmCallData as `0x${string}`,
            BigInt(xcmTimeout),
            deadlineTimestamp
          ],
          account: address as Address,
          value: xcmFee
        })
        console.log('✅ Cross-chain simulation successful!')
      } catch (simulateError: any) {
        console.error('❌ Cross-chain simulation failed:', simulateError)
        toast.error('Transaction would fail. Check your inputs.')
        toast.dismiss(toastId)
        return
      }

      // Estimate gas
      try {
        const gasEstimate = await publicClient.estimateContractGas({
          address: routerAddress,
          abi: routerABI,
          functionName: 'crossChainSwap',
          args: [
            tokenIn.address as Address,
            tokenOut.address as Address,
            amountInParsed,
            amountOutMin,
            address as Address,
            quote.path,
            destinationChainId,
            xcmCallData as `0x${string}`,
            BigInt(xcmTimeout),
            deadlineTimestamp
          ],
          account: address as Address,
          value: xcmFee
        })
        console.log('✅ Gas estimate:', gasEstimate.toString())
      } catch (estimateError: any) {
        console.error('❌ Gas estimation failed:', estimateError)
        toast.error('Transaction would fail. Check your inputs.')
        toast.dismiss(toastId)
        return
      }

      const txHash = await writeContractAsync({
        address: routerAddress,
        abi: routerABI,
        functionName: 'crossChainSwap',
        args: [
          tokenIn.address as Address,
          tokenOut.address as Address,
          amountInParsed,
          amountOutMin,
          address as Address,
          quote.path,
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
  }, [tokenIn, tokenOut, amountIn, quote, address, chainId, slippage, deadline, writeContractAsync, publicClient, addTransaction, updateTransaction, checkAndApprove])

  return {
    executeSwap,
    executeCrossChainSwap
  }
}