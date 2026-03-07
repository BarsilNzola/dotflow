import { useState } from 'react'
import { SwapForm } from '../components/swap/SwapForm'
import { CrossChainSwapForm } from '../components/swap/CrossChainSwapForm'
import { cn } from '../lib/utils'

type Tab = 'same-chain' | 'cross-chain'

export function Swap() {
  const [activeTab, setActiveTab] = useState<Tab>('same-chain')

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6 text-center">Swap</h1>

      {/* Tab switcher */}
      <div className="flex bg-secondary rounded-xl p-1 mb-6">
        <button
          onClick={() => setActiveTab('same-chain')}
          className={cn(
            'flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200',
            activeTab === 'same-chain'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Same Chain
        </button>
        <button
          onClick={() => setActiveTab('cross-chain')}
          className={cn(
            'flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2',
            activeTab === 'cross-chain'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Cross-Chain
          <span className="text-[10px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
            XCM
          </span>
        </button>
      </div>

      {activeTab === 'same-chain' ? (
        <SwapForm />
      ) : (
        <CrossChainSwapForm />
      )}
    </div>
  )
}
