import { RouteQuote, Token } from '../../types'
import { formatTokenAmount, formatUSD, formatPercentage, cn } from '../../lib/utils'
import { InformationCircleIcon } from '@heroicons/react/24/outline'
import { useSwapStore } from '../../store/useSwapStore'

interface RoutePreviewProps {
  quote: RouteQuote
  tokenIn: Token
  tokenOut: Token
}

export function RoutePreview({ quote, tokenOut }: RoutePreviewProps) {
  const { slippage } = useSwapStore()
  
  const priceImpactColor = 
    quote.priceImpact < 1 ? 'text-green-600' :
    quote.priceImpact < 3 ? 'text-yellow-600' :
    'text-red-600'

  // Calculate minimum received with slippage
  const slippageBps = Math.floor(slippage * 100)
  const minimumReceived = quote.amountOut - (quote.amountOut * BigInt(slippageBps) / 10000n)

  // Format the fee (totalFee is in tokenOut decimals)
  const feeFormatted = formatTokenAmount(quote.totalFee, tokenOut.decimals)

  return (
    <div className="bg-secondary rounded-xl p-4 space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-sm text-muted-foreground">Route</span>
        <div className="flex items-center space-x-1">
          {quote.adapters.map((adapter, i) => (
            <div key={adapter} className="flex items-center">
              <span className="text-xs bg-background px-2 py-1 rounded">
                Adapter {i + 1}
              </span>
              {i < quote.adapters.length - 1 && (
                <span className="mx-1 text-muted-foreground">→</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-between">
        <span className="text-sm text-muted-foreground">Expected output</span>
        <span className="font-medium">
          {formatTokenAmount(quote.amountOut, tokenOut.decimals)} {tokenOut.symbol}
        </span>
      </div>

      <div className="flex justify-between">
        <span className="text-sm text-muted-foreground">Minimum received</span>
        <span className="font-medium">
          {formatTokenAmount(minimumReceived, tokenOut.decimals)} {tokenOut.symbol}
        </span>
      </div>

      <div className="flex justify-between">
        <span className="text-sm text-muted-foreground flex items-center space-x-1">
          <span>Price impact</span>
          <InformationCircleIcon className="w-4 h-4" />
        </span>
        <span className={cn('font-medium', priceImpactColor)}>
          {formatPercentage(quote.priceImpact)}
        </span>
      </div>

      <div className="flex justify-between">
        <span className="text-sm text-muted-foreground">Network fee</span>
        <div className="text-right">
          <span className="font-medium block">
            {feeFormatted} {tokenOut.symbol}
          </span>
          <span className="text-xs text-muted-foreground">
            ~{formatUSD(Number(quote.totalFee) * 0.01 / 10 ** tokenOut.decimals)} {/* Rough USD estimate */}
          </span>
        </div>
      </div>

      {quote.steps.length > 1 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-primary">View route details</summary>
          <div className="mt-2 space-y-2">
            {quote.steps.map((step, i) => (
              <div key={i} className="pl-2 border-l-2 border-border">
                <div className="flex justify-between">
                  <span>Step {i + 1}</span>
                  <span>{formatTokenAmount(step.amountOut, tokenOut.decimals)} {tokenOut.symbol}</span>
                </div>
                <div className="text-muted-foreground">
                  Fee: {formatTokenAmount(step.fee, tokenOut.decimals)} {tokenOut.symbol}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}