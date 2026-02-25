export const CONTRACT_ADDRESSES = {
    // Polkadot Hub
    420420417: {
      dotFlowRouter: '0x685D11df23C6F631dfe4a231F84c64d3D5204b6C',
      liquidityManager: '0xB996c3c94bE5e1edA58c10eF561ee3163A8eE5b8',
      crossChainExecutor: '0xeDAA51c9d8aEf7f79FD705d88218f05b7D771F96',
      uniswapV2Adapter: '0x04459298b8cc115F5DB81231C191e6837671b6c6',
      parachainAdapter: '0xe8Aff4d9F267D3c3B36708599f9fE113bd4cC56E',
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