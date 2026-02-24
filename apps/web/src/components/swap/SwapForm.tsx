import { useState, useEffect } from 'react'
import { ArrowDownIcon } from '@heroicons/react/24/outline'
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
    tokenIn,
    tokenOut,
    amountIn,
    setTokenIn,
    setTokenOut,
    setAmountIn,
    setAmountOut,
    swapTokens,
    recipient,
    setRecipient
  } = useSwapStore()

  const [showTokenSelect, setShowTokenSelect] = useState<'in' | 'out' | null>(null)

  const { balance: tokenInBalance, formatted: tokenInBalanceFormatted } = useTokenBalance(tokenIn)
  const { quote, isLoading: isQuoteLoading } = useRouteQuote()
  const { executeSwap, executeCrossChainSwap } = useExecuteRoute()

  useEffect(() => {
    if (quote) {
      setAmountOut(formatTokenAmount(quote.amountOut, tokenOut?.decimals || 18))
    }
  }, [quote, setAmountOut, tokenOut])

  const handleMaxClick = () => {
    if (tokenIn && tokenInBalance) {
      setAmountIn(formatTokenAmount(tokenInBalance, tokenIn.decimals))
    }
  }

  const handleSwap = async () => {
    if (!isConnected) {
      toast.error('Please connect your wallet')
      return
    }

    if (!tokenIn || !tokenOut) {
      toast.error('Please select tokens')
      return
    }

    if (!amountIn || parseFloat(amountIn) <= 0) {
      toast.error('Please enter an amount')
      return
    }

    if (tokenIn.chainId !== tokenOut.chainId) {
      // Cross-chain swap
      if (!recipient) {
        toast.error('Please enter recipient address for cross-chain swap')
        return
      }
      
      // Execute cross-chain swap
      await executeCrossChainSwap(
        tokenOut.chainId,
        '0x', // XCM call data
        3600 // 1 hour timeout
      )
    } else {
      // Same-chain swap
      await executeSwap()
    }
  }

  const handleSelectToken = (token: Token, type: 'in' | 'out') => {
    if (type === 'in') {
      if (tokenOut && token.address === tokenOut.address) {
        // Swap tokens if same
        setTokenIn(tokenOut)
        setTokenOut(token)
      } else {
        setTokenIn(token)
      }
    } else {
      if (tokenIn && token.address === tokenIn.address) {
        // Swap tokens if same
        setTokenOut(tokenIn)
        setTokenIn(token)
      } else {
        setTokenOut(token)
      }
    }
    setShowTokenSelect(null)
  }

  const hasInsufficientBalance = tokenIn && tokenInBalance && amountIn
    ? parseFloat(amountIn) > parseFloat(tokenInBalanceFormatted)
    : false

  return (
    <div className="swap-card p-6 max-w-lg mx-auto">
      <div className="space-y-4">
        {/* Token In */}
        <div className="bg-secondary rounded-xl p-4">
          <div className="flex justify-between mb-2">
            <span className="text-sm text-muted-foreground">From</span>
            {tokenIn && (
              <button
                onClick={handleMaxClick}
                className="text-xs text-primary hover:underline"
              >
                Balance: {tokenInBalanceFormatted}
              </button>
            )}
          </div>
          <div className="flex items-center space-x-3">
            <input
              type="number"
              value={amountIn}
              onChange={(e) => setAmountIn(e.target.value)}
              placeholder="0.0"
              className="flex-1 bg-transparent text-2xl outline-none"
              min="0"
              step="any"
            />
            <button
              onClick={() => setShowTokenSelect('in')}
              className="flex items-center space-x-2 bg-background rounded-xl px-4 py-2 border border-border hover:border-primary transition-colors"
            >
              {tokenIn ? (
                <>
                  {tokenIn.logoURI && (
                    <img
                      src={tokenIn.logoURI}
                      alt={tokenIn.symbol}
                      className="w-6 h-6 rounded-full"
                    />
                  )}
                  <span className="font-medium">{tokenIn.symbol}</span>
                </>
              ) : (
                <span>Select token</span>
              )}
            </button>
          </div>
        </div>

        {/* Swap Direction Button */}
        <div className="flex justify-center -my-2">
          <button
            onClick={swapTokens}
            className="bg-secondary rounded-full p-2 border-4 border-background hover:bg-secondary/80 transition-colors"
          >
            <ArrowDownIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Token Out */}
        <div className="bg-secondary rounded-xl p-4">
          <div className="flex justify-between mb-2">
            <span className="text-sm text-muted-foreground">To</span>
            {tokenOut && (
              <span className="text-xs text-muted-foreground">
                Estimated
              </span>
            )}
          </div>
          <div className="flex items-center space-x-3">
            <input
              type="number"
              value={quote?.amountOut ? formatTokenAmount(quote.amountOut, tokenOut?.decimals || 18) : ''}
              readOnly
              placeholder="0.0"
              className="flex-1 bg-transparent text-2xl outline-none"
            />
            <button
              onClick={() => setShowTokenSelect('out')}
              className="flex items-center space-x-2 bg-background rounded-xl px-4 py-2 border border-border hover:border-primary transition-colors"
            >
              {tokenOut ? (
                <>
                  {tokenOut.logoURI && (
                    <img
                      src={tokenOut.logoURI}
                      alt={tokenOut.symbol}
                      className="w-6 h-6 rounded-full"
                    />
                  )}
                  <span className="font-medium">{tokenOut.symbol}</span>
                </>
              ) : (
                <span>Select token</span>
              )}
            </button>
          </div>
        </div>

        {/* Route Preview */}
        {quote && tokenIn && tokenOut && (
          <RoutePreview quote={quote} tokenIn={tokenIn} tokenOut={tokenOut} />
        )}

        {/* Slippage Control */}
        <SlippageControl />

        {/* Cross-chain recipient input */}
        {tokenIn && tokenOut && tokenIn.chainId !== tokenOut.chainId && (
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">
              Recipient on destination chain
            </label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
              className="w-full bg-secondary rounded-xl px-4 py-3 border border-border focus:border-primary outline-none"
            />
          </div>
        )}

        {/* Swap Button */}
        <SwapButton
          onSwap={handleSwap}
          isLoading={isQuoteLoading}
          hasInsufficientBalance={hasInsufficientBalance}
          tokenIn={tokenIn}
          tokenOut={tokenOut}
        />

        {/* Rate info */}
        {quote && tokenIn && tokenOut && (
          <div className="text-xs text-muted-foreground text-center">
            1 {tokenIn.symbol} ≈ {formatTokenAmount(
              quote.amountOut * BigInt(10 ** tokenIn.decimals) / (BigInt(amountIn || '1') * BigInt(10 ** tokenOut.decimals)),
              tokenOut.decimals
            )} {tokenOut.symbol}
          </div>
        )}
      </div>

      {/* Token Select Modal */}
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