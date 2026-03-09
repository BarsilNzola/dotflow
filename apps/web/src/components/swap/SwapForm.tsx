import { useState, useEffect } from 'react'
import { TokenSelect } from './TokenSelect'
import { SwapButton } from './SwapButton'
import { useSwapStore } from '../../store/useSwapStore'
import { useWalletStore } from '../../store/useWalletStore'
import { useTokenBalance } from '../../hooks/useBalances'
import { useRouteQuote } from '../../hooks/useRouteQuote'
import { useExecuteRoute } from '../../hooks/useExecuteRoute'
import { RoutePreview } from './RoutePreview'
import { SlippageControl } from './SlippageControl'
import { Token } from '../../types'
import { formatTokenAmount } from '../../lib/utils'
import toast from 'react-hot-toast'

export function SwapForm() {
  const { isConnected } = useWalletStore()
  const {
    tokenIn, tokenOut, amountIn,
    setTokenIn, setTokenOut, setAmountIn, setAmountOut,
    swapTokens, recipient, setRecipient,
  } = useSwapStore()

  const [showTokenSelect, setShowTokenSelect] = useState<'in' | 'out' | null>(null)

  const { balance: tokenInBalance, formatted: tokenInBalanceFormatted, refetch: refetchBalance } = useTokenBalance(tokenIn)
  const { quote, isLoading: isQuoteLoading } = useRouteQuote()
  const { executeSwap, executeCrossChainSwap } = useExecuteRoute()

  useEffect(() => {
    if (quote) setAmountOut(formatTokenAmount(quote.amountOut, tokenOut?.decimals || 18))
  }, [quote, setAmountOut, tokenOut])

  const handleSelectToken = (token: Token, type: 'in' | 'out') => {
    if (type === 'in') {
      tokenOut?.address === token.address ? (setTokenIn(tokenOut), setTokenOut(token)) : setTokenIn(token)
    } else {
      tokenIn?.address === token.address  ? (setTokenOut(tokenIn), setTokenIn(token))  : setTokenOut(token)
    }
    setShowTokenSelect(null)
  }

  const handleSwap = async () => {
    if (!isConnected)                           { toast.error('Please connect your wallet'); return }
    if (!tokenIn || !tokenOut)                  { toast.error('Please select tokens'); return }
    if (!amountIn || parseFloat(amountIn) <= 0) { toast.error('Please enter an amount'); return }

    try {
      if (tokenIn.chainId !== tokenOut.chainId) {
        if (!recipient) { toast.error('Please enter recipient address for cross-chain swap'); return }
        await executeCrossChainSwap(tokenOut.chainId, '0x', 3600)
      } else {
        await executeSwap()
      }
      setAmountIn('')
      setAmountOut('')
      refetchBalance()
    } catch (error: any) {
      toast.error(error.message || 'Swap failed')
    }
  }

  const hasInsufficientBalance = tokenIn && tokenInBalance && amountIn
    ? parseFloat(amountIn) > parseFloat(tokenInBalanceFormatted) : false

  return (
    <div className="swap-card p-5 space-y-3">

      {/* Token In */}
      <div className="bg-secondary rounded-xl p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">From</span>
          {tokenIn && (
            <button
              onClick={() => tokenIn && tokenInBalance && setAmountIn(formatTokenAmount(tokenInBalance, tokenIn.decimals))}
              className="font-mono text-[10px] text-primary hover:underline"
            >
              Balance: {tokenInBalanceFormatted}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number" value={amountIn}
            onChange={e => setAmountIn(e.target.value)}
            placeholder="0.0" min="0" step="any"
            className="flex-1 bg-transparent text-2xl font-bold outline-none"
          />
          <button
            onClick={() => setShowTokenSelect('in')}
            className="flex items-center gap-2 bg-background rounded-xl px-3 py-2 border border-border hover:border-primary transition-colors shrink-0"
          >
            {tokenIn ? (
              <>
                {tokenIn.logoURI && <img src={tokenIn.logoURI} alt={tokenIn.symbol} className="w-5 h-5 rounded-full" />}
                <span className="font-semibold text-sm">{tokenIn.symbol}</span>
              </>
            ) : <span className="text-sm text-muted-foreground">Select</span>}
          </button>
        </div>
      </div>

      {/* Swap direction */}
      <div className="flex justify-center -my-1">
        <button
          onClick={swapTokens}
          className="bg-background border border-border rounded-full p-2 hover:border-primary hover:text-primary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </button>
      </div>

      {/* Token Out */}
      <div className="bg-secondary rounded-xl p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">To</span>
          {tokenOut && <span className="font-mono text-[10px] text-muted-foreground">Estimated</span>}
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number" readOnly placeholder="0.0"
            value={quote?.amountOut ? formatTokenAmount(quote.amountOut, tokenOut?.decimals || 18) : ''}
            className="flex-1 bg-transparent text-2xl font-bold outline-none text-muted-foreground"
          />
          <button
            onClick={() => setShowTokenSelect('out')}
            className="flex items-center gap-2 bg-background rounded-xl px-3 py-2 border border-border hover:border-primary transition-colors shrink-0"
          >
            {tokenOut ? (
              <>
                {tokenOut.logoURI && <img src={tokenOut.logoURI} alt={tokenOut.symbol} className="w-5 h-5 rounded-full" />}
                <span className="font-semibold text-sm">{tokenOut.symbol}</span>
              </>
            ) : <span className="text-sm text-muted-foreground">Select</span>}
          </button>
        </div>
      </div>

      {/* Route preview */}
      {quote && tokenIn && tokenOut && (
        <RoutePreview quote={quote} tokenIn={tokenIn} tokenOut={tokenOut} />
      )}

      {/* Cross-chain recipient */}
      {tokenIn && tokenOut && tokenIn.chainId !== tokenOut.chainId && (
        <div className="space-y-1.5">
          <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Recipient on destination chain
          </label>
          <input
            type="text" value={recipient} onChange={e => setRecipient(e.target.value)}
            placeholder="0x…"
            className="w-full bg-secondary rounded-xl px-4 py-3 border border-border focus:border-primary outline-none text-sm font-mono transition-colors"
          />
        </div>
      )}

      <SlippageControl />

      <SwapButton
        onSwap={handleSwap}
        isLoading={isQuoteLoading}
        hasInsufficientBalance={!!hasInsufficientBalance}
        tokenIn={tokenIn}
        tokenOut={tokenOut}
      />

      {/* Rate */}
      {quote && tokenIn && tokenOut && amountIn && parseFloat(amountIn) > 0 && (
        <div className="font-mono text-[10px] text-muted-foreground text-center">
          1 {tokenIn.symbol} ≈ {formatTokenAmount(
            quote.amountOut * BigInt(10 ** tokenIn.decimals)
              / (BigInt(Math.floor(parseFloat(amountIn) * 10 ** tokenIn.decimals)) || 1n),
            tokenOut.decimals
          )} {tokenOut.symbol}
        </div>
      )}

      {showTokenSelect && (
        <TokenSelect
          type={showTokenSelect}
          onSelect={(token: Token) => handleSelectToken(token, showTokenSelect)}
          onClose={() => setShowTokenSelect(null)}
        />
      )}
    </div>
  )
}