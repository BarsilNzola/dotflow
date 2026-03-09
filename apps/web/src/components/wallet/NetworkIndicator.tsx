import { useWalletStore } from '../../store/useWalletStore'
import { cn } from '../../lib/utils'

const SUPPORTED_CHAINS = { 0: 'Polkadot Hub' } as const

export function NetworkIndicator() {
  const { chainId } = useWalletStore()

  if (!chainId) {
    return (
      <div className="flex items-center gap-2 bg-secondary px-3 py-2 rounded-xl">
        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
        <span className="font-mono text-xs text-muted-foreground">No Network</span>
      </div>
    )
  }

  const isSupported = chainId in SUPPORTED_CHAINS
  const chainName   = SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS] || `Chain ${chainId}`

  return (
    <div className={cn(
      'flex items-center gap-2 px-3 py-2 rounded-xl',
      isSupported ? 'bg-secondary' : 'bg-red-500/10'
    )}>
      <div className={cn(
        'w-1.5 h-1.5 rounded-full',
        isSupported ? 'bg-green-500' : 'bg-red-500'
      )} />
      <span className="font-mono text-xs">{chainName}</span>
    </div>
  )
}