import { useState, useEffect } from 'react'
import { TokenSelect } from './TokenSelect'
import { SlippageControl } from './SlippageControl'
import { CrossChainStatus } from './CrossChainStatus'
import { useSwapStore } from '../../store/useSwapStore'
import { useWalletStore } from '../../store/useWalletStore'
import { useTokenBalance } from '../../hooks/useBalances'
import { useRouteQuote } from '../../hooks/useRouteQuote'
import { useCrossChainSwap } from '../../hooks/useCrossChainSwap'
import { Token } from '../../types'
import { formatTokenAmount } from '../../lib/utils'
import { CONTRACT_ADDRESSES } from '../../contracts/addresses'
import { useAccount } from 'wagmi'
import toast from 'react-hot-toast'

const DESTINATION_CHAINS = [
  { id: 420420421, name: 'Westend Asset Hub' },
  { id: 420420417, name: 'Polkadot Hub'      },
]

export function CrossChainSwapForm() {
  const { isConnected } = useWalletStore()
  const {
    tokenIn, tokenOut, amountIn,
    setTokenIn, setTokenOut, setAmountIn, setAmountOut,
    swapTokens, recipient, setRecipient,
  } = useSwapStore()

  const [showTokenSelect, setShowTokenSelect]       = useState<'in' | 'out' | null>(null)
  const [destinationChainId, setDestinationChainId] = useState(DESTINATION_CHAINS[0].id)
  const [customRecipient, setCustomRecipient]       = useState(false)

  const { balance: tokenInBalance, formatted: tokenInBalanceFormatted, refetch: refetchBalance } = useTokenBalance(tokenIn)
  const { quote }                        = useRouteQuote()
  const { tx, executeCrossChainSwap, reset } = useCrossChainSwap()
  const { address: walletAddress }       = useAccount()
  const addresses                        = CONTRACT_ADDRESSES[420420417]

  useEffect(() => {
    if (walletAddress && !customRecipient) setRecipient(walletAddress)
  }, [walletAddress, customRecipient, setRecipient])

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
    if (!isConnected)                            { toast.error('Please connect your wallet'); return }
    if (!tokenIn || !tokenOut)                   { toast.error('Please select tokens'); return }
    if (!amountIn || parseFloat(amountIn) <= 0)  { toast.error('Please enter an amount'); return }
    try {
      await executeCrossChainSwap({
        tokenIn: tokenIn.address, tokenOut: tokenOut.address, amountIn,
        destinationChain: destinationChainId, recipient,
        uniswapAdapterAddress: addresses.uniswapV2Adapter,
        tokenInDecimals: tokenIn.decimals,
      })
      setAmountIn('')
      setAmountOut('')
      refetchBalance()
    } catch { /* surfaced in CrossChainStatus */ }
  }

  const isSubmitting = tx !== null && !['idle', 'xcm_executed', 'failed'].includes(tx.stage)
  const hasInsufficientBalance = tokenIn && tokenInBalance && amountIn
    ? parseFloat(amountIn) > parseFloat(tokenInBalanceFormatted) : false
  const isDisabled = isSubmitting || !!hasInsufficientBalance || !isConnected || !tokenIn || !tokenOut || !amountIn

  const buttonLabel = () => {
    if (!isConnected)           return 'Connect Wallet'
    if (isSubmitting)           return 'Processing…'
    if (hasInsufficientBalance) return 'Insufficient Balance'
    if (!tokenIn || !tokenOut)  return 'Select Tokens'
    if (!amountIn)              return 'Enter Amount'
    return 'Swap Cross-Chain'
  }

  return (
    <>
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

        {/* Token Out + destination chain */}
        <div className="bg-secondary rounded-xl p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">To (estimated)</span>
            <select
              value={destinationChainId}
              onChange={e => setDestinationChainId(Number(e.target.value))}
              className="font-mono text-[10px] bg-background border border-border rounded-lg px-2 py-1 outline-none focus:border-primary transition-colors"
            >
              {DESTINATION_CHAINS.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
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

        {/* Recipient */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Recipient</label>
            <button
              onClick={() => {
                setCustomRecipient(!customRecipient)
                if (customRecipient && walletAddress) setRecipient(walletAddress)
              }}
              className="font-mono text-[10px] text-primary hover:underline"
            >
              {customRecipient ? '← Use my wallet' : 'Different address →'}
            </button>
          </div>
          {customRecipient ? (
            <input
              type="text" value={recipient} onChange={e => setRecipient(e.target.value)}
              placeholder="0x…"
              className="w-full bg-secondary rounded-xl px-4 py-3 border border-border focus:border-primary outline-none font-mono text-xs transition-colors"
            />
          ) : (
            <div className="bg-secondary rounded-xl px-4 py-3 border border-border font-mono text-xs text-muted-foreground truncate">
              {walletAddress ?? 'Connect wallet'}
            </div>
          )}
        </div>

        {/* XCM fee note */}
        <div className="flex items-center gap-3 bg-primary/5 border border-primary/15 rounded-xl px-4 py-3">
          <span className="font-mono text-[10px] font-bold text-primary uppercase tracking-wider shrink-0">XCM</span>
          <p className="font-mono text-[10px] text-muted-foreground leading-relaxed">
            A small native fee (PAS/WND) is required for execution weight on the destination chain. 20% buffer added automatically.
          </p>
        </div>

        <SlippageControl />

        {/* Submit */}
        <button
          onClick={handleSwap} disabled={isDisabled}
          className="w-full py-4 rounded-xl font-semibold text-sm transition-all duration-200 active:scale-[0.98] bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Processing…
            </span>
          ) : buttonLabel()}
        </button>

        {/* Rate */}
        {quote && tokenIn && tokenOut && amountIn && parseFloat(amountIn) > 0 && (
          <div className="font-mono text-[10px] text-muted-foreground text-center">
            1 {tokenIn.symbol} ≈ {formatTokenAmount(
              quote.amountOut * BigInt(10 ** tokenIn.decimals)
                / BigInt(Math.floor(parseFloat(amountIn) * 10 ** tokenIn.decimals) || 1),
              tokenOut.decimals
            )} {tokenOut.symbol}
          </div>
        )}
      </div>

      {tx && tx.stage !== 'idle' && (
        <CrossChainStatus tx={tx} onClose={reset} />
      )}

      {showTokenSelect && (
        <TokenSelect
          type={showTokenSelect}
          onSelect={(token: Token) => handleSelectToken(token, showTokenSelect)}
          onClose={() => setShowTokenSelect(null)}
        />
      )}
    </>
  )
}