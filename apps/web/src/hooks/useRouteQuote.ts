import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { parseUnits, type Address, formatUnits } from 'viem'
import { useSwapStore } from '../store/useSwapStore'
import { useWalletStore } from '../store/useWalletStore'
import { getContractAddress, type ChainId, type ContractName } from '../contracts/addresses'
import DotFlowRouterArtifact from '../contracts/abi/DotFlowRouter.json'
import UniswapV2AdapterArtifact from '../contracts/abi/UniswapV2Adapter.json'
import { RouteQuote, SwapPath } from '../types'

const routerABI = DotFlowRouterArtifact.abi
const uniswapAdapterABI = UniswapV2AdapterArtifact.abi

const UNISWAP_ADAPTER = '0xB339908346d5307a16DEcD80bB64e6D1cDB46c0a'

export function useRouteQuote() {
  const { tokenIn, tokenOut, amountIn, slippage, setQuote } = useSwapStore()
  const { chainId } = useWalletStore()
  const publicClient = usePublicClient()

  // Log the current state
  console.log('useRouteQuote state:', {
    tokenIn: tokenIn?.symbol,
    tokenOut: tokenOut?.symbol,
    amountIn,
    chainId,
    hasPublicClient: !!publicClient,
    enabled: !!tokenIn && !!tokenOut && !!amountIn && !!chainId && !!publicClient && 
             tokenIn?.chainId === chainId && tokenOut?.chainId === chainId
  })

  const { data: quote, isLoading, error, refetch } = useQuery({
    queryKey: ['routeQuote', tokenIn?.address, tokenOut?.address, amountIn, chainId, slippage],
    queryFn: async (): Promise<RouteQuote | null> => {
      console.log('🔥 queryFn executing for:', tokenIn?.symbol, '->', tokenOut?.symbol, 'amount:', amountIn)
      
      if (!tokenIn || !tokenOut || !amountIn || !chainId || !publicClient || 
          tokenIn.chainId !== chainId || tokenOut.chainId !== chainId) {
        console.log('❌ Missing required data for quote', {
          tokenIn: !!tokenIn,
          tokenOut: !!tokenOut,
          amountIn: !!amountIn,
          chainId: !!chainId,
          publicClient: !!publicClient,
          tokenInChainMatch: tokenIn?.chainId === chainId,
          tokenOutChainMatch: tokenOut?.chainId === chainId
        })
        return null
      }

      try {
        const routerAddress = getContractAddress(chainId as ChainId, 'dotFlowRouter' as ContractName)
        console.log('Router address:', routerAddress)
        
        const amountInParsed = parseUnits(amountIn, tokenIn.decimals)
        console.log('Amount parsed:', amountInParsed.toString())
        
        const adapterAddress = UNISWAP_ADAPTER as Address
        console.log('Adapter address:', adapterAddress)

        // Get pair info
        const pairInfo = await publicClient.readContract({
          address: adapterAddress,
          abi: uniswapAdapterABI,
          functionName: 'getPairInfo',
          args: [tokenIn.address as Address, tokenOut.address as Address]
        }) as any
        
        console.log('Pair info:', {
          pair: pairInfo[0],
          reserve0: pairInfo[1].toString(),
          reserve1: pairInfo[2].toString()
        })

        if (pairInfo[0] === '0x0000000000000000000000000000000000000000') {
          throw new Error('Pair does not exist')
        }

        const path: SwapPath = {
          adapters: [adapterAddress],
          path: [tokenIn.address as Address, tokenOut.address as Address],
          isCrossChain: false,
          destinationChains: []
        }

        console.log('Calling router.getAmountOut with:', {
          tokenIn: tokenIn.address,
          tokenOut: tokenOut.address,
          amountIn: amountInParsed.toString(),
          path
        })

        const result = await publicClient.readContract({
          address: routerAddress,
          abi: routerABI,
          functionName: 'getAmountOut',
          args: [
            tokenIn.address as Address,
            tokenOut.address as Address,
            amountInParsed,
            path
          ]
        }) as [bigint, bigint, bigint]

        const [amountOut, totalFee] = result
        console.log('Router result:', {
          amountOut: amountOut.toString(),
          amountOutFormatted: formatUnits(amountOut, tokenOut.decimals),
          totalFee: totalFee.toString(),
          totalFeeFormatted: formatUnits(totalFee, tokenOut.decimals)
        })

        const newQuote: RouteQuote = {
          amountOut,
          totalFee,
          priceImpact: 0,
          path,
          estimatedGas: 200000n,
          adapters: [adapterAddress],
          steps: [{
            adapter: adapterAddress,
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            amountIn: amountInParsed,
            amountOut,
            fee: totalFee,
            priceImpact: 0,
            estimatedGas: 200000n
          }]
        }

        setQuote(newQuote)
        console.log('Quote set successfully')
        return newQuote
      } catch (error: any) {
        console.error('Error in queryFn:', error)
        setQuote(null)
        throw error
      }
    },
    enabled: !!tokenIn && !!tokenOut && !!amountIn && !!chainId && !!publicClient && 
             tokenIn.chainId === chainId && tokenOut.chainId === chainId,
    staleTime: 10000,
    refetchInterval: 30000
  })

  console.log('useRouteQuote return:', { isLoading, hasError: !!error, hasQuote: !!quote })

  return {
    quote,
    isLoading,
    error,
    refetch
  }
}