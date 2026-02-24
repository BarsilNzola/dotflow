export const CONTRACT_ADDRESSES = {
    // Mainnet
    1: {
      dotFlowRouter: '0x...' as `0x${string}`,
      liquidityManager: '0x...' as `0x${string}`,
      crossChainExecutor: '0x...' as `0x${string}`,
      uniswapV2Adapter: '0x...' as `0x${string}`,
      parachainAdapter: '0x...' as `0x${string}`
    },
    // Polygon
    137: {
      dotFlowRouter: '0x...' as `0x${string}`,
      liquidityManager: '0x...' as `0x${string}`,
      crossChainExecutor: '0x...' as `0x${string}`,
      uniswapV2Adapter: '0x...' as `0x${string}`,
      parachainAdapter: '0x...' as `0x${string}`
    },
    // Arbitrum
    42161: {
      dotFlowRouter: '0x...' as `0x${string}`,
      liquidityManager: '0x...' as `0x${string}`,
      crossChainExecutor: '0x...' as `0x${string}`,
      uniswapV2Adapter: '0x...' as `0x${string}`,
      parachainAdapter: '0x...' as `0x${string}`
    },
    // Optimism
    10: {
      dotFlowRouter: '0x...' as `0x${string}`,
      liquidityManager: '0x...' as `0x${string}`,
      crossChainExecutor: '0x...' as `0x${string}`,
      uniswapV2Adapter: '0x...' as `0x${string}`,
      parachainAdapter: '0x...' as `0x${string}`
    },
    // Base
    8453: {
      dotFlowRouter: '0x...' as `0x${string}`,
      liquidityManager: '0x...' as `0x${string}`,
      crossChainExecutor: '0x...' as `0x${string}`,
      uniswapV2Adapter: '0x...' as `0x${string}`,
      parachainAdapter: '0x...' as `0x${string}`
    },
    // BSC
    56: {
      dotFlowRouter: '0x...' as `0x${string}`,
      liquidityManager: '0x...' as `0x${string}`,
      crossChainExecutor: '0x...' as `0x${string}`,
      uniswapV2Adapter: '0x...' as `0x${string}`,
      parachainAdapter: '0x...' as `0x${string}`
    }
  } as const
  
  export type ChainId = keyof typeof CONTRACT_ADDRESSES
  export type ContractName = keyof typeof CONTRACT_ADDRESSES[ChainId]
  
  export const getContractAddress = (
    chainId: ChainId,
    contract: ContractName
  ): `0x${string}` => {
    const chainAddresses = CONTRACT_ADDRESSES[chainId]
    const address = chainAddresses?.[contract]
    
    if (!address) {
      throw new Error(`Contract ${contract} not deployed on chain ${chainId}`)
    }
    
    return address
  }