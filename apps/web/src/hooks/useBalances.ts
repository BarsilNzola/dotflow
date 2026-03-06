import { useQuery, useQueries } from '@tanstack/react-query'
import { useBalance, usePublicClient } from 'wagmi'
import { type Address, formatUnits, erc20Abi } from 'viem'
import { useWalletStore } from '../store/useWalletStore'
import { Token } from '../types'

export function useNativeBalance() {
  const { address, chainId } = useWalletStore()
  
  const { data, isLoading, refetch } = useBalance({
    address: address as Address,
    chainId: chainId || undefined,
    query: {
      enabled: !!address && !!chainId
    }
  })

  return {
    balance: data?.value || 0n,
    formatted: data ? formatUnits(data.value, data.decimals) : '0',
    symbol: data?.symbol || '',
    decimals: data?.decimals || 18,
    isLoading,
    refetch
  }
}

export function useTokenBalance(token: Token | null) {
  const { address, chainId } = useWalletStore()
  const publicClient = usePublicClient()
  
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['tokenBalance', address, token?.address, token?.chainId],
    queryFn: async () => {
      if (!address || !token || chainId !== token.chainId || !publicClient) return 0n
      
      try {
        const balance = await publicClient.readContract({
          address: token.address as Address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address as Address]
        })
        
        return balance as bigint
      } catch (error) {
        console.error('Error fetching token balance:', error)
        return 0n
      }
    },
    enabled: !!address && !!token && !!publicClient && chainId === token.chainId,
    refetchInterval: 10000
  })

  return {
    balance: data || 0n,
    formatted: data ? formatUnits(data, token?.decimals || 18) : '0',
    isLoading,
    refetch
  }
}

export function useMultipleTokenBalances(tokens: Token[]) {
  const { address, chainId } = useWalletStore()
  const publicClient = usePublicClient()
  
  const results = useQueries({
    queries: tokens.map((token) => ({
      queryKey: ['tokenBalance', address, token?.address, token?.chainId],
      queryFn: async () => {
        if (!address || !token || chainId !== token.chainId || !publicClient) {
          return { token, balance: 0n }
        }
        
        try {
          const balance = await publicClient.readContract({
            address: token.address as Address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address as Address]
          })
          
          return { token, balance: balance as bigint }
        } catch (error) {
          console.error('Error fetching token balance:', error)
          return { token, balance: 0n }
        }
      },
      enabled: !!address && !!token && !!publicClient && chainId === token.chainId
    }))
  })

  const balances = new Map<string, bigint>()
  
  results.forEach((result) => {
    // Check if result.data exists and has the token property
    if (result.data && result.data.token && result.data.token.address) {
      balances.set(result.data.token.address, result.data.balance)
    }
  })

  const isLoading = results.some((r) => r.isLoading)

  return { balances, isLoading }
}