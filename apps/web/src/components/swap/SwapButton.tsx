import { useWalletStore } from '../../store/useWalletStore'
import { Token } from '../../types'
import { cn } from '../../lib/utils'

interface SwapButtonProps {
  onSwap: () => void
  isLoading: boolean
  hasInsufficientBalance: boolean
  tokenIn: Token | null
  tokenOut: Token | null
}

export function SwapButton({
  onSwap,
  isLoading,
  hasInsufficientBalance,
  tokenIn,
  tokenOut
}: SwapButtonProps) {
  const { isConnected } = useWalletStore()

  const getButtonText = () => {
    if (!isConnected) return 'Connect Wallet'
    if (!tokenIn || !tokenOut) return 'Select Tokens'
    if (hasInsufficientBalance) return 'Insufficient Balance'
    if (isLoading) return 'Fetching Quote...'
    if (tokenIn.chainId !== tokenOut.chainId) return 'Cross-Chain Swap'
    return 'Swap'
  }

  const isDisabled = 
    !isConnected || 
    !tokenIn || 
    !tokenOut || 
    hasInsufficientBalance || 
    isLoading

  return (
    <button
      onClick={onSwap}
      disabled={isDisabled}
      className={cn(
        'w-full py-4 rounded-xl font-medium transition-colors',
        isDisabled
          ? 'bg-secondary text-muted-foreground cursor-not-allowed'
          : 'bg-primary text-primary-foreground hover:bg-primary/90'
      )}
    >
      {getButtonText()}
    </button>
  )
}