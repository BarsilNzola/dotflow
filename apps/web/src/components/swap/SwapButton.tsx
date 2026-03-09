import { useWalletStore } from '../../store/useWalletStore'
import { Token } from '../../types'
import { cn } from '../../lib/utils'

interface SwapButtonProps {
  onSwap:                () => void
  isLoading:             boolean
  hasInsufficientBalance: boolean
  tokenIn:               Token | null
  tokenOut:              Token | null
}

export function SwapButton({ onSwap, isLoading, hasInsufficientBalance, tokenIn, tokenOut }: SwapButtonProps) {
  const { isConnected } = useWalletStore()

  const label = () => {
    if (!isConnected)           return 'Connect Wallet'
    if (!tokenIn || !tokenOut)  return 'Select Tokens'
    if (hasInsufficientBalance) return 'Insufficient Balance'
    if (isLoading)              return 'Fetching Quote…'
    if (tokenIn.chainId !== tokenOut.chainId) return 'Cross-Chain Swap'
    return 'Swap'
  }

  const disabled = !isConnected || !tokenIn || !tokenOut || hasInsufficientBalance || isLoading

  return (
    <button
      onClick={onSwap}
      disabled={disabled}
      className={cn(
        'w-full py-4 rounded-xl font-semibold text-sm transition-all duration-200 active:scale-[0.98]',
        disabled
          ? 'bg-secondary text-muted-foreground cursor-not-allowed'
          : 'bg-primary text-primary-foreground hover:opacity-90'
      )}
    >
      {isLoading ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Fetching Quote…
        </span>
      ) : label()}
    </button>
  )
}