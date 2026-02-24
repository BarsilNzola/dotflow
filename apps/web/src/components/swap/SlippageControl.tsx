import { useState } from 'react'
import { useSwapStore } from '../../store/useSwapStore'
import { cn } from '../../lib/utils'

const SLIPPAGE_OPTIONS = [0.1, 0.5, 1.0]

export function SlippageControl() {
  const { slippage, setSlippage } = useSwapStore()
  const [isCustom, setIsCustom] = useState(!SLIPPAGE_OPTIONS.includes(slippage))

  const handleSlippageChange = (value: number) => {
    setIsCustom(false)
    setSlippage(value)
  }

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    if (!isNaN(value)) {
      setIsCustom(true)
      setSlippage(value)
    }
  }

  const isHighSlippage = slippage > 5
  const isVeryHighSlippage = slippage > 10

  return (
    <div className="bg-secondary rounded-xl p-4 space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-sm text-muted-foreground">Slippage tolerance</span>
        <span
          className={cn(
            'text-sm font-medium',
            isVeryHighSlippage ? 'text-red-600' : isHighSlippage ? 'text-yellow-600' : ''
          )}
        >
          {slippage}%
        </span>
      </div>

      <div className="flex space-x-2">
        {SLIPPAGE_OPTIONS.map((option) => (
          <button
            key={option}
            onClick={() => handleSlippageChange(option)}
            className={cn(
              'flex-1 py-2 rounded-lg text-sm font-medium transition-colors',
              !isCustom && slippage === option
                ? 'bg-primary text-primary-foreground'
                : 'bg-background hover:bg-secondary'
            )}
          >
            {option}%
          </button>
        ))}
        <div className="flex-1">
          <input
            type="number"
            value={isCustom ? slippage : ''}
            onChange={handleCustomChange}
            placeholder="Custom"
            className={cn(
              'w-full px-3 py-2 rounded-lg text-sm bg-background border focus:outline-none',
              isCustom ? 'border-primary' : 'border-border'
            )}
            min="0"
            max="50"
            step="0.1"
          />
        </div>
      </div>

      {isVeryHighSlippage && (
        <p className="text-xs text-red-600">
          Warning: High slippage tolerance. Your transaction may be frontrun.
        </p>
      )}
      {isHighSlippage && !isVeryHighSlippage && (
        <p className="text-xs text-yellow-600">
          Slippage above 5% may result in unfavorable rates.
        </p>
      )}
    </div>
  )
}