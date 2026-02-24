import DotFlowRouterABI from './abi/DotFlowRouter.json'
import LiquidityManagerABI from './abi/LiquidityManager.json'
import CrossChainExecutorABI from './abi/CrossChainExecutor.json'
import UniswapV2AdapterABI from './abi/UniswapV2Adapter.json'
import ParachainAdapterABI from './abi/ParachainAdapter.json'

export {
  DotFlowRouterABI,
  LiquidityManagerABI,
  CrossChainExecutorABI,
  UniswapV2AdapterABI,
  ParachainAdapterABI
}

export const DOTFLOW_ROUTER_EVENTS = {
  SwapCreated: '0x...', // Will be populated from actual event signatures
  SwapExecuted: '0x...',
  CrossChainSwapInitiated: '0x...',
  CrossChainSwapCompleted: '0x...',
  AdapterAdded: '0x...',
  AdapterRemoved: '0x...'
} as const

export const LIQUIDITY_MANAGER_EVENTS = {
  PoolCreated: '0x...',
  LiquidityAdded: '0x...',
  LiquidityRemoved: '0x...',
  FeesClaimed: '0x...'
} as const

export const CROSS_CHAIN_EXECUTOR_EVENTS = {
  XCMMessagePrepared: '0x...',
  XCMMessageExecuted: '0x...',
  XCMMessageExpired: '0x...',
  XCMMessageCancelled: '0x...'
} as const