import { Token } from '../types'
import { getContractAddress, type ChainId, type ContractName } from '../contracts/addresses'
import { erc20Abi } from 'viem'
import DotFlowRouterArtifact from '../contracts/abi/DotFlowRouter.json'
import UniswapV2AdapterArtifact from '../contracts/abi/UniswapV2Adapter.json'
import deployedTokens from '../contracts/abi/deployed-tokens.json'

// Extract just the ABI array from the artifacts
const routerABI = DotFlowRouterArtifact.abi
const adapterABI = UniswapV2AdapterArtifact.abi

// deployed mock tokens
const MOCK_TOKENS: Token[] = [
  {
    address: deployedTokens.usdc,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    chainId: Number(deployedTokens.chainId),
    logoURI: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png"
  },
  {
    address: deployedTokens.wdot,
    symbol: "WDOT",
    name: "Wrapped DOT",
    decimals: 10,
    chainId: Number(deployedTokens.chainId),
    logoURI: "https://cryptologos.cc/logos/polkadot-new-dot-logo.png"
  }
]

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

  async getToken(chainId: number, address: string, publicClient: any): Promise<Token | null> {
    const cacheKey = `${chainId}-${address.toLowerCase()}`
    const cached = this.tokenCache.get(cacheKey)
    
    if (cached && Date.now() - (cached as any)._timestamp < this.CACHE_DURATION) {
      return cached
    }

    // First check if it's one of the mock tokens
    const mockToken = MOCK_TOKENS.find(
      t => t.address.toLowerCase() === address.toLowerCase() && t.chainId === chainId
    )
    if (mockToken) {
      this.tokenCache.set(cacheKey, mockToken)
      return mockToken
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
    console.log('getAllSupportedTokens called with chainId:', chainId);
    
    // Always include mock tokens
    const mockTokensForChain = MOCK_TOKENS.filter(t => t.chainId === chainId);
    
    try {
      const routerAddress = getContractAddress(chainId as ChainId, 'dotFlowRouter' as ContractName)
      console.log('Router address:', routerAddress);
      
      // Check if the router contract exists and has the function
      try {
        const code = await publicClient.getBytecode({ address: routerAddress });
        if (!code || code === '0x') {
          console.log('No contract at router address, returning mock tokens only');
          return mockTokensForChain;
        }
      } catch (error) {
        console.log('Error checking router contract:', error);
        return mockTokensForChain;
      }
      
      // Try to get adapters
      let adapters: `0x${string}`[] = [];
      try {
        adapters = await publicClient.readContract({
          address: routerAddress,
          abi: routerABI,
          functionName: 'getActiveAdapters'
        }) as `0x${string}`[];
        console.log('Active adapters:', adapters);
      } catch (error) {
        console.log('getActiveAdapters not available or failed:', error);
        // If the function doesn't exist, just return mock tokens
        return mockTokensForChain;
      }
  
      // If no adapters, return mock tokens
      if (!adapters || adapters.length === 0) {
        console.log('No active adapters found, returning mock tokens')
        return mockTokensForChain
      }
  
      // Get tokens from adapters
      const tokensByAdapter = await Promise.all(
        adapters.map(adapter => this.getTokensFromAdapter(chainId, adapter, publicClient))
      );
  
      const allTokens = tokensByAdapter.flat();
      const combinedTokens = [...allTokens, ...mockTokensForChain];
      
      const uniqueTokens = Array.from(
        new Map(combinedTokens.map(token => [token.address.toLowerCase(), token])).values()
      );
  
      console.log('Total unique tokens found:', uniqueTokens.length);
      return uniqueTokens;
    } catch (error) {
      console.error('Failed to fetch all supported tokens:', error);
      return mockTokensForChain;
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