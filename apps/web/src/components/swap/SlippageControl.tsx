import { useState } from 'react'
import { useSwapStore } from '../../store/useSwapStore'
import { cn } from '../../lib/utils'

const SLIPPAGE_OPTIONS = [0.1, 0.5, 1.0]

export function SlippageControl() {
  const { slippage, setSlippage } = useSwapStore()
  const [isCustom, setIsCustom] = useState(!SLIPPAGE_OPTIONS.includes(slippage))

  const isHigh     = slippage > 5
  const isVeryHigh = slippage > 10

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Slippage
        </span>
        <span className={cn(
          'font-mono text-xs font-semibold',
          isVeryHigh ? 'text-red-500' : isHigh ? 'text-yellow-500' : 'text-muted-foreground'
        )}>
          {slippage}%
        </span>
      </div>

      <div className="flex gap-1.5">
        {SLIPPAGE_OPTIONS.map(opt => (
          <button
            key={opt}
            onClick={() => { setIsCustom(false); setSlippage(opt) }}
            className={cn(
              'flex-1 py-2 rounded-lg font-mono text-xs font-semibold transition-colors',
              !isCustom && slippage === opt
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            )}
          >
            {opt}%
          </button>
        ))}
        <input
          type="number"
          value={isCustom ? slippage : ''}
          onChange={e => {
            const v = parseFloat(e.target.value)
            if (!isNaN(v)) { setIsCustom(true); setSlippage(v) }
          }}
          placeholder="Custom"
          min="0" max="50" step="0.1"
          className={cn(
            'flex-1 px-2 py-2 rounded-lg font-mono text-xs bg-secondary border text-center outline-none transition-colors',
            isCustom ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'
          )}
        />
      </div>

      {isVeryHigh && (
        <p className="font-mono text-[10px] text-red-500">
          ⚠ High slippage — transaction may be frontrun.
        </p>
      )}
      {isHigh && !isVeryHigh && (
        <p className="font-mono text-[10px] text-yellow-500">
          Slippage above 5% may result in unfavorable rates.
        </p>
      )}
    </div>
  )
}