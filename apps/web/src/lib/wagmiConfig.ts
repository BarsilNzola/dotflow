import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { http } from 'wagmi'
import { POLKADOT_HUB } from './chains'

const projectId = import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID || 'PROJECT_ID'

export const wagmiConfig = getDefaultConfig({
  appName: 'DotFlow',
  projectId,
  chains: [POLKADOT_HUB], // Only Polkadot Hub
  transports: {
    [POLKADOT_HUB.id]: http(POLKADOT_HUB.rpcUrls.default.http[0]),
  }
})