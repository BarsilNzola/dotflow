import { create } from 'zustand'
import { type Address } from 'viem'
import { Token } from '../types'

interface WalletState {
  address: Address | null
  chainId: number | null
  isConnected: boolean
  balances: Map<string, bigint>
  tokens: Token[]
  
  setAddress: (address: Address | null) => void
  setChainId: (chainId: number | null) => void
  setIsConnected: (connected: boolean) => void
  setBalance: (token: string, balance: bigint) => void
  setBalances: (balances: Map<string, bigint>) => void
  setTokens: (tokens: Token[]) => void
  updateBalance: (token: string, balance: bigint) => void
  clearBalances: () => void
  reset: () => void
}

export const useWalletStore = create<WalletState>((set) => ({
  address: null,
  chainId: null,
  isConnected: false,
  balances: new Map(),
  tokens: [],

  setAddress: (address) => set({ address }),
  setChainId: (chainId) => set({ chainId }),
  setIsConnected: (isConnected) => set({ isConnected }),
  
  setBalance: (token, balance) => set((state) => {
    const newBalances = new Map(state.balances)
    newBalances.set(token, balance)
    return { balances: newBalances }
  }),
  
  setBalances: (balances) => set({ balances }),
  
  setTokens: (tokens) => set({ tokens }),
  
  updateBalance: (token, balance) => set((state) => {
    const newBalances = new Map(state.balances)
    newBalances.set(token, balance)
    return { balances: newBalances }
  }),
  
  clearBalances: () => set({ balances: new Map() }),
  
  reset: () => set({
    address: null,
    chainId: null,
    isConnected: false,
    balances: new Map(),
    tokens: []
  })
}))