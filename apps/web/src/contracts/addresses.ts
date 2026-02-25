export const CONTRACT_ADDRESSES = {
    // Polkadot Hub
    3000: {
      dotFlowRouter: '0x...', // Your deployed router address
      liquidityManager: '0x...', // Your deployed liquidity manager
      crossChainExecutor: '0x...', // Your deployed XCM executor
      uniswapV2Adapter: '0x...', // Your deployed Uniswap adapter
      parachainAdapter: '0x...', // Your deployed parachain adapter
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