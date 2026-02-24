import { type Chain } from 'viem'
import { 
  mainnet, 
  polygon, 
  arbitrum, 
  optimism, 
  base,
  bsc
} from 'wagmi/chains'

export const SUPPORTED_CHAINS = [
  mainnet,
  polygon,
  arbitrum,
  optimism,
  base,
  bsc
] as const

export type SupportedChain = typeof SUPPORTED_CHAINS[number]

export const chains = SUPPORTED_CHAINS

export const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  137: 'Polygon',
  42161: 'Arbitrum',
  10: 'Optimism',
  8453: 'Base',
  56: 'BNB Chain'
}

export const CHAIN_NATIVE_TOKENS: Record<number, { symbol: string; name: string; decimals: number }> = {
  1: { symbol: 'ETH', name: 'Ether', decimals: 18 },
  137: { symbol: 'MATIC', name: 'Matic', decimals: 18 },
  42161: { symbol: 'ETH', name: 'Ether', decimals: 18 },
  10: { symbol: 'ETH', name: 'Ether', decimals: 18 },
  8453: { symbol: 'ETH', name: 'Ether', decimals: 18 },
  56: { symbol: 'BNB', name: 'Binance Coin', decimals: 18 }
}