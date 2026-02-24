export interface Token {
  address: string
  symbol: string
  name: string
  decimals: number
  chainId: number
  logoURI?: string
  price?: number
  balance?: bigint
}

export interface SwapPath {
  adapters: string[]
  path: string[]
  isCrossChain: boolean
  destinationChains: number[]
}

export interface SwapRequest {
  id: string
  user: string
  tokenIn: string
  tokenOut: string
  amountIn: bigint
  amountOutMin: bigint
  recipient: string
  deadline: bigint
  path: SwapPath
  nonce: number
}

export interface RouteQuote {
  amountOut: bigint
  totalFee: bigint
  priceImpact: number
  path: SwapPath
  estimatedGas: bigint
  adapters: string[]
  steps: RouteStep[]
}

export interface RouteStep {
  adapter: string
  tokenIn: string
  tokenOut: string
  amountIn: bigint
  amountOut: bigint
  fee: bigint
  priceImpact: number
  estimatedGas: bigint
}

export interface CrossChainSwapRequest {
  swapId: string
  xcmMessageId: string
  destinationChainId: number
  executor: string
  xcmCallData: string
  sourceAmount: bigint
  targetAmount: bigint
  timeout: bigint
}

export interface XCMInstruction {
  destinationChainId: number
  sender: string
  recipient: string
  asset: string
  amount: bigint
  callData: string
  weight: bigint
  transactWeight: bigint
  timeout: bigint
}

export interface ParachainAsset {
  assetId: string
  amount: bigint
  isNative: boolean
}

export interface AdapterInfo {
  name: string
  adapterAddress: string
  isActive: boolean
  tvl: bigint
  fee: number
  minSwapAmount: bigint
  maxSwapAmount: bigint
  supportedTokens: string[]
}

export interface PoolInfo {
  token: string
  totalLiquidity: bigint
  availableLiquidity: bigint
  borrowedLiquidity: bigint
  utilizationRate: number
  feeRate: number
  reserveFactor: bigint
  isActive: boolean
}

export interface ProviderPosition {
  shares: bigint
  entryTimestamp: bigint
  lastDeposit: bigint
  lastWithdraw: bigint
  accruedFees: bigint
  pendingFees: bigint
}

export interface Transaction {
  hash: string
  type: 'swap' | 'cross-chain-swap' | 'add-liquidity' | 'remove-liquidity'
  status: 'pending' | 'confirmed' | 'failed'
  from: string
  to: string
  value: bigint
  timestamp: number
  description?: string
  swapId?: string
  xcmMessageId?: string
}