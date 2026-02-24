import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { parseUnits, type Address } from 'viem'
import { useSwapStore } from '../store/useSwapStore'
import { useWalletStore } from '../store/useWalletStore'
import { getContractAddress, type ChainId, type ContractName } from '../contracts/addresses'
import DotFlowRouterABI from '../contracts/abi/DotFlowRouter.json'
import { RouteQuote, SwapPath } from '../types'
import { calculatePriceImpact } from '../lib/utils'

// Type assertion for the ABI
const routerABI = DotFlowRouterABI as any

export function useRouteQuote() {
  const { tokenIn, tokenOut, amountIn, slippage } = useSwapStore()
  const { chainId } = useWalletStore()
  const publicClient = usePublicClient()

  const { data: quote, isLoading, error, refetch } = useQuery({
    queryKey: ['routeQuote', tokenIn?.address, tokenOut?.address, amountIn, chainId, slippage],
    queryFn: async (): Promise<RouteQuote | null> => {
      if (!tokenIn || !tokenOut || !amountIn || !chainId || !publicClient || 
          tokenIn.chainId !== chainId || tokenOut.chainId !== chainId) {
        return null
      }

      try {
        const routerAddress = getContractAddress(chainId as ChainId, 'dotFlowRouter' as ContractName)
        
        const amountInParsed = parseUnits(amountIn, tokenIn.decimals)
        
        // Get active adapters from router
        const adapters = await publicClient.readContract({
          address: routerAddress,
          abi: routerABI,
          functionName: 'getActiveAdapters'
        }) as Address[]

        if (adapters.length === 0) {
          throw new Error('No active adapters found')
        }

        // Build optimal path (simplified - in production you'd have a routing algorithm)
        const path: SwapPath = {
          adapters: [adapters[0]],
          path: [tokenIn.address as Address, tokenOut.address as Address],
          isCrossChain: false,
          destinationChains: []
        }

        // Get quote from router
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

        // Get reserves for price impact calculation
        const reserveIn = await publicClient.readContract({
          address: adapters[0],
          abi: routerABI,
          functionName: 'getReserves',
          args: [tokenIn.address]
        }) as [bigint, bigint]

        const reserveOut = await publicClient.readContract({
          address: adapters[0],
          abi: routerABI,
          functionName: 'getReserves',
          args: [tokenOut.address]
        }) as [bigint, bigint]

        const calculatedPriceImpact = calculatePriceImpact(
          amountInParsed,
          amountOut,
          reserveIn[0],
          reserveOut[0]
        )

        return {
          amountOut,
          totalFee,
          priceImpact: calculatedPriceImpact,
          path,
          estimatedGas: 200000n,
          adapters: [adapters[0]],
          steps: [{
            adapter: adapters[0],
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            amountIn: amountInParsed,
            amountOut,
            fee: totalFee,
            priceImpact: calculatedPriceImpact,
            estimatedGas: 200000n
          }]
        }
      } catch (error) {
        console.error('Error fetching quote:', error)
        throw error
      }
    },
    enabled: !!tokenIn && !!tokenOut && !!amountIn && !!chainId && !!publicClient && 
             tokenIn.chainId === chainId && tokenOut.chainId === chainId,
    staleTime: 10000,
    refetchInterval: 30000
  })

  return {
    quote,
    isLoading,
    error,
    refetch
  }
}