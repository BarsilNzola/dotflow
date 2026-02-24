import { Address } from 'viem'

export interface SwapPathStruct {
  adapters: Address[]
  path: Address[]
  isCrossChain: boolean
  destinationChains: number[]
}

export interface SwapRequestStruct {
  id: `0x${string}`
  user: Address
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  amountOutMin: bigint
  recipient: Address
  deadline: bigint
  path: SwapPathStruct
  nonce: bigint
}

export interface CrossChainSwapRequestStruct {
  swapId: `0x${string}`
  xcmMessageId: `0x${string}`
  destinationChainId: number
  executor: Address
  xcmCallData: `0x${string}`
  sourceAmount: bigint
  targetAmount: bigint
  timeout: bigint
}

export interface AdapterInfoStruct {
  name: string
  adapterAddress: Address
  isActive: boolean
  tvl: bigint
  fee: number
  minSwapAmount: bigint
  maxSwapAmount: bigint
  supportedTokens: Address[]
}

export interface PoolInfoStruct {
  totalLiquidity: bigint
  availableLiquidity: bigint
  borrowedLiquidity: bigint
  utilizationRate: number
  feeRate: number
  reserveFactor: bigint
  isActive: boolean
}

export interface ProviderPositionStruct {
  shares: bigint
  entryTimestamp: bigint
  lastDeposit: bigint
  lastWithdraw: bigint
  accruedFees: bigint
  pendingFees: bigint
}

export interface XCMInstructionStruct {
  destinationChainId: number
  sender: Address
  recipient: Address
  asset: Address
  amount: bigint
  callData: `0x${string}`
  weight: bigint
  transactWeight: bigint
  timeout: bigint
}

export interface ParachainAssetStruct {
  assetId: `0x${string}`
  amount: bigint
  isNative: boolean
}

export interface XCMMessageStruct {
  id: `0x${string}`
  sourceChainId: number
  destinationChainId: number
  sender: Address
  recipient: Address
  asset: Address
  amount: bigint
  timestamp: bigint
  timeout: bigint
  hash: `0x${string}`
  status: number
}

export type MessageStatus = 0 | 1 | 2 | 3 | 4 // Pending, Executed, Failed, Cancelled, Expired