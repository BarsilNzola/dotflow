import { useWalletStore } from '../../store/useWalletStore'
import { cn } from '../../lib/utils'

const SUPPORTED_CHAINS = {
  0: 'Polkadot Hub'
} as const

export function NetworkIndicator() {
  const { chainId } = useWalletStore()

  if (!chainId) {
    return (
      <div className="flex items-center space-x-2 bg-secondary px-3 py-2 rounded-xl">
        <div className="w-2 h-2 rounded-full bg-gray-400" />
        <span className="text-sm">Not Connected</span>
      </div>
    )
  }

  const isSupported = chainId in SUPPORTED_CHAINS
  const chainName = SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS] || `Chain ${chainId}`

  return (
    <div className={cn(
      'flex items-center space-x-2 px-3 py-2 rounded-xl',
      isSupported ? 'bg-secondary' : 'bg-red-100 dark:bg-red-900'
    )}>
      <div className={cn(
        'w-2 h-2 rounded-full',
        isSupported ? 'bg-green-500' : 'bg-red-500'
      )} />
      <span className="text-sm">
        {chainName}
      </span>
    </div>
  )
}