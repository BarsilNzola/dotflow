import { type Chain } from 'viem'

export const POLKADOT_HUB: Chain = {
  id: 3000, // Replace with actual Polkadot Hub chain ID
  name: 'Polkadot Hub',
  nativeCurrency: {
    decimals: 10,
    name: 'DOT',
    symbol: 'DOT',
  },
  rpcUrls: {
    default: { http: ['https://rpc.polkadot-hub.com'] },
    public: { http: ['https://rpc.polkadot-hub.com'] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'https://explorer.polkadot-hub.com' },
  },
}

export const SUPPORTED_CHAINS = [POLKADOT_HUB] as const