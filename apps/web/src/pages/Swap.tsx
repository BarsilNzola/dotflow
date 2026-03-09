import { useState } from 'react'
import { SwapForm } from '../components/swap/SwapForm'
import { CrossChainSwapForm } from '../components/swap/CrossChainSwapForm'
import { cn } from '../lib/utils'

type Tab = 'same-chain' | 'cross-chain'

export function Swap() {
  const [activeTab, setActiveTab] = useState<Tab>('same-chain')

  return (
    <div className="max-w-lg mx-auto px-4 py-10">

      {/* Header */}
      <div className="text-center mb-8">
        <div className="font-mono text-xs text-muted-foreground uppercase tracking-widest mb-2">DotFlow</div>
        <h1 className="text-4xl font-black tracking-tight">Swap</h1>
      </div>

      {/* Tab switcher */}
      <div className="flex bg-secondary rounded-xl p-1 mb-6 relative">
        <button
          onClick={() => setActiveTab('same-chain')}
          className={cn(
            'flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 relative z-10',
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
            'flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-2 relative z-10',
            activeTab === 'cross-chain'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Cross-Chain
          <span className="font-mono text-[9px] font-bold bg-primary/15 text-primary px-1.5 py-0.5 rounded-full tracking-wider">
            XCM
          </span>
        </button>
      </div>

      {activeTab === 'same-chain' ? <SwapForm /> : <CrossChainSwapForm />}
    </div>
  )
}