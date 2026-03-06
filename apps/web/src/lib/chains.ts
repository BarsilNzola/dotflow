import { type Chain } from 'viem'

export const POLKADOT_HUB: Chain = {
  id: 420420417,
  name: 'Polkadot Hub',
  nativeCurrency: {
    decimals: 10,
    name: 'PAS',
    symbol: 'PAS',
  },
  rpcUrls: {
    default: { http: ['https://eth-rpc-testnet.polkadot.io'] },
    public: { http: ['https://eth-rpc-testnet.polkadot.io'] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'https://explorer.polkadot-hub.com' },
  },
}

export const SUPPORTED_CHAINS = [POLKADOT_HUB] as const