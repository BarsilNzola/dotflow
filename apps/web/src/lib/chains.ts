import { type Chain } from 'viem'

export const POLKADOT_HUB: Chain = {
  id: 3000,
  name: 'Polkadot Hub',
  nativeCurrency: {
    decimals: 10,
    name: 'DOT',
    symbol: 'DOT',
  },
  rpcUrls: {
    default: { http: ['https://services.polkadothub-rpc.com/testnet'] },
    public: { http: ['https://services.polkadothub-rpc.com/testnet'] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'https://explorer.polkadot-hub.com' },
  },
}

export const SUPPORTED_CHAINS = [POLKADOT_HUB] as const