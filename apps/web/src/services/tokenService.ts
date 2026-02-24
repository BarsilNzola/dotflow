import { Token } from '../types'
import { getContractAddress, type ChainId, type ContractName } from '../contracts/addresses'
import { erc20Abi } from 'viem'
import DotFlowRouterABI from '../contracts/abi/DotFlowRouter.json'
import UniswapV2AdapterABI from '../contracts/abi/UniswapV2Adapter.json'

// Type assertions for ABIs
const routerABI = DotFlowRouterABI as any
const adapterABI = UniswapV2AdapterABI as any

export class TokenService {
  private static instance: TokenService
  private tokenCache: Map<string, Token> = new Map()
  private tokenListCache: Map<number, Token[]> = new Map()
  private lastFetch: Map<number, number> = new Map()
  private readonly CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

  static getInstance(): TokenService {
    if (!TokenService.instance) {
      TokenService.instance = new TokenService()
    }
    return TokenService.instance
  }

  // This method requires a publicClient to be passed in
  async getToken(chainId: number, address: string, publicClient: any): Promise<Token | null> {
    const cacheKey = `${chainId}-${address.toLowerCase()}`
    const cached = this.tokenCache.get(cacheKey)
    
    if (cached && Date.now() - (cached as any)._timestamp < this.CACHE_DURATION) {
      return cached
    }

    try {
      const [symbol, name, decimals] = await Promise.all([
        publicClient.readContract({
          address: address as `0x${string}`,
          abi: erc20Abi,
          functionName: 'symbol'
        }),
        publicClient.readContract({
          address: address as `0x${string}`,
          abi: erc20Abi,
          functionName: 'name'
        }),
        publicClient.readContract({
          address: address as `0x${string}`,
          abi: erc20Abi,
          functionName: 'decimals'
        })
      ])

      const token: Token = {
        address,
        symbol: symbol as string,
        name: name as string,
        decimals: decimals as number,
        chainId,
        logoURI: `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${address}/logo.png`
      }

      // Add timestamp for cache
      ;(token as any)._timestamp = Date.now()
      
      this.tokenCache.set(cacheKey, token)
      return token
    } catch (error) {
      console.error(`Failed to fetch token ${address} on chain ${chainId}:`, error)
      return null
    }
  }

  async getTokensFromAdapter(chainId: number, adapterAddress: string, publicClient: any): Promise<Token[]> {
    const lastFetch = this.lastFetch.get(chainId) || 0
    
    if (Date.now() - lastFetch < this.CACHE_DURATION) {
      const cached = this.tokenListCache.get(chainId)
      if (cached) return cached
    }

    try {
      // Get adapter info to get supported tokens
      const adapterInfo = await publicClient.readContract({
        address: adapterAddress as `0x${string}`,
        abi: adapterABI,
        functionName: 'getAdapterInfo'
      }) as any

      const tokenPromises = adapterInfo.supportedTokens.map((tokenAddress: string) => 
        this.getToken(chainId, tokenAddress, publicClient)
      )

      const tokens = (await Promise.all(tokenPromises)).filter((t): t is Token => t !== null)
      
      this.tokenListCache.set(chainId, tokens)
      this.lastFetch.set(chainId, Date.now())
      
      return tokens
    } catch (error) {
      console.error(`Failed to fetch tokens from adapter ${adapterAddress}:`, error)
      return []
    }
  }

  async getAllSupportedTokens(chainId: number, publicClient: any): Promise<Token[]> {
    try {
      const routerAddress = getContractAddress(chainId as ChainId, 'dotFlowRouter' as ContractName)
      
      const adapters = await publicClient.readContract({
        address: routerAddress,
        abi: routerABI,
        functionName: 'getActiveAdapters'
      }) as `0x${string}`[]

      const tokensByAdapter = await Promise.all(
        adapters.map(adapter => this.getTokensFromAdapter(chainId, adapter, publicClient))
      )

      // Flatten and deduplicate
      const allTokens = tokensByAdapter.flat()
      const uniqueTokens = Array.from(
        new Map(allTokens.map(token => [token.address.toLowerCase(), token])).values()
      )

      return uniqueTokens
    } catch (error) {
      console.error('Failed to fetch all supported tokens:', error)
      return []
    }
  }

  async searchTokens(chainId: number, query: string, publicClient: any): Promise<Token[]> {
    const tokens = await this.getAllSupportedTokens(chainId, publicClient)
    
    const normalizedQuery = query.toLowerCase()
    
    return tokens.filter(token => 
      token.symbol.toLowerCase().includes(normalizedQuery) ||
      token.name.toLowerCase().includes(normalizedQuery) ||
      token.address.toLowerCase().includes(normalizedQuery)
    )
  }

  clearCache(): void {
    this.tokenCache.clear()
    this.tokenListCache.clear()
    this.lastFetch.clear()
  }
}

export const tokenService = TokenService.getInstance()