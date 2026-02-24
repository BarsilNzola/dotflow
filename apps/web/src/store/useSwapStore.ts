import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Token, RouteQuote, SwapPath } from '../types'

interface SwapState {
  tokenIn: Token | null
  tokenOut: Token | null
  amountIn: string
  amountOut: string
  quote: RouteQuote | null
  isQuoteLoading: boolean
  slippage: number
  deadline: number
  recipient: string
  path: SwapPath | null
  
  setTokenIn: (token: Token | null) => void
  setTokenOut: (token: Token | null) => void
  setAmountIn: (amount: string) => void
  setAmountOut: (amount: string) => void
  setQuote: (quote: RouteQuote | null) => void
  setIsQuoteLoading: (loading: boolean) => void
  setSlippage: (slippage: number) => void
  setDeadline: (deadline: number) => void
  setRecipient: (recipient: string) => void
  setPath: (path: SwapPath | null) => void
  swapTokens: () => void
  reset: () => void
}

export const useSwapStore = create<SwapState>()(
  persist(
    (set) => ({
      tokenIn: null,
      tokenOut: null,
      amountIn: '',
      amountOut: '',
      quote: null,
      isQuoteLoading: false,
      slippage: 0.5,
      deadline: 30,
      recipient: '',
      path: null,

      setTokenIn: (token) => set({ tokenIn: token, quote: null, amountOut: '' }),
      setTokenOut: (token) => set({ tokenOut: token, quote: null, amountOut: '' }),
      setAmountIn: (amount) => set({ amountIn: amount, quote: null, amountOut: '' }),
      setAmountOut: (amount) => set({ amountOut: amount }),
      setQuote: (quote) => set({ quote }),
      setIsQuoteLoading: (loading) => set({ isQuoteLoading: loading }),
      setSlippage: (slippage) => set({ slippage }),
      setDeadline: (deadline) => set({ deadline }),
      setRecipient: (recipient) => set({ recipient }),
      setPath: (path) => set({ path }),

      swapTokens: () => set((state) => ({
        tokenIn: state.tokenOut,
        tokenOut: state.tokenIn,
        amountIn: '',
        amountOut: '',
        quote: null
      })),

      reset: () => set({
        tokenIn: null,
        tokenOut: null,
        amountIn: '',
        amountOut: '',
        quote: null,
        isQuoteLoading: false,
        path: null
      })
    }),
    {
      name: 'dotflow-swap-storage',
      partialize: (state) => ({
        slippage: state.slippage,
        deadline: state.deadline
      })
    }
  )
)