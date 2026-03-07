export const CONTRACT_ADDRESSES = {
    // Polkadot Hub
    420420417: {
      dotFlowRouter: '0x955E01C6CfE3D48F752C958DB42da5997C6C3a5F',
      liquidityManager: '0x7B6A6a57Efc00529a97db51426107Aa569d199Da',
      crossChainExecutor: '0xD21a7497551A05DF3018202aE28AB0056fD2B15b',
      uniswapV2Adapter: '0xB339908346d5307a16DEcD80bB64e6D1cDB46c0a',
      parachainAdapter: '0x764b1777E66a1aCCd87aC83ffEd35E0141230B82',
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