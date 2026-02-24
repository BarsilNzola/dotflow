import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { http } from 'wagmi'
import { 
  mainnet, 
  polygon, 
  arbitrum, 
  optimism, 
  base,
  bsc
} from 'wagmi/chains'

const projectId = import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID || 'YOUR_PROJECT_ID'

export const wagmiConfig = getDefaultConfig({
  appName: 'DotFlow',
  projectId,
  chains: [mainnet, polygon, arbitrum, optimism, base, bsc],
  transports: {
    [mainnet.id]: http(),
    [polygon.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [base.id]: http(),
    [bsc.id]: http()
  }
})