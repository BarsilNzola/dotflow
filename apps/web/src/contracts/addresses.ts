export const CONTRACT_ADDRESSES = {
    // Polkadot Hub
    420420417: {
      dotFlowRouter: '0xf35B4d277AbFd46f71A838a72b33ad58f304E09B',
      liquidityManager: '0x1b7df4e24690a6bFC46fB8C50098425D2dD02CeA',
      crossChainExecutor: '0xC365A93EA54A68cb096D1Cb4e25E86eFaeDCf122',
      uniswapV2Adapter: '0x448928adc4a26aE816B8CB343305c4136a91dfEd',
      parachainAdapter: '0x504fdF0192fa79cd3505c5e9E3D6a06e61778B89',
      usdc: '0x5a5306B699d21c9d6a16A792b266215d550cc338',
      wdot: '0xE32Abcaa249aB85bC995377E6DDd96f283343B28',
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