export const CONTRACT_ADDRESSES = {
    // Polkadot Hub
    420420417: {
      dotFlowRouter: '0x6c964D065A25047563D0148a22F9eC296513A593',
      liquidityManager: '0xF26e54bD3FEaCcE3B6A2b80FdCbb523A4196a8a2',
      crossChainExecutor: '0x97B4eEc143f98f08c25e9e2960448BaCbe0E78CF',
      uniswapV2Adapter: '0xcE6e8394eaEBA3dcC320189D750F55e3Bc3De9D9',
      parachainAdapter: '0xc76FFfC72966FD39d3B76a98f086Ae1F27c46756',
      usdc: '0x399ae6bf402a89f18993A97Ff50Bd50A891DaD37',
      wdot: '0x38183Ef90FDFed16b6b60254A1A18832e5ea0F23',
      wpas: '0xD30D62367a61636a2D7c2bD759a507974be1B193', 
      uniswapRouter: '0x4288D462626ba3e7761A9aF2A7281f1f6F949Afb',
      uniswapFactory: '0xb2CA69fda5644aCd262EA526181C529882121c9d',
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