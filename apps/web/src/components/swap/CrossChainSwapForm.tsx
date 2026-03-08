import { useState, useEffect } from 'react'
import { ArrowDownIcon } from '@heroicons/react/24/outline'
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
  const { quote } = useRouteQuote()
  const { tx, executeCrossChainSwap, reset }  = useCrossChainSwap()

  const { address: walletAddress } = useAccount()
  const addresses = CONTRACT_ADDRESSES[420420417]

  // Auto-fill recipient with connected wallet — user can override
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
    if (!isConnected)                            return toast.error('Please connect your wallet')
    if (!tokenIn || !tokenOut)                   return toast.error('Please select tokens')
    if (!amountIn || parseFloat(amountIn) <= 0)  return toast.error('Please enter an amount')

    try {
      await executeCrossChainSwap({
        tokenIn:               tokenIn.address,
        tokenOut:              tokenOut.address,
        amountIn,
        destinationChain:      destinationChainId,
        recipient,
        uniswapAdapterAddress: addresses.uniswapV2Adapter,
        tokenInDecimals:       tokenIn.decimals,
      })
      setAmountIn('')
      setAmountOut('')
      refetchBalance()
    } catch {
      // error already surfaced in CrossChainStatus
    }
  }

  const isSubmitting = tx !== null && tx.stage !== 'idle' && tx.stage !== 'xcm_executed' && tx.stage !== 'failed'
  const hasInsufficientBalance = tokenIn && tokenInBalance && amountIn
    ? parseFloat(amountIn) > parseFloat(tokenInBalanceFormatted) : false

  const buttonLabel = () => {
    if (!isConnected)          return 'Connect Wallet'
    if (isSubmitting)          return 'Processing…'
    if (hasInsufficientBalance) return 'Insufficient Balance'
    if (!tokenIn || !tokenOut) return 'Select Tokens'
    if (!amountIn)             return 'Enter Amount'
    return 'Swap Cross-Chain'
  }

  const isDisabled = isSubmitting || !!hasInsufficientBalance || !isConnected
    || !tokenIn || !tokenOut || !amountIn

  return (
    <>
      <div className="swap-card p-6 space-y-4">

        {/* Token In */}
        <div className="bg-secondary rounded-xl p-4">
          <div className="flex justify-between mb-2">
            <span className="text-sm text-muted-foreground">From</span>
            {tokenIn && (
              <button
                onClick={() => tokenIn && tokenInBalance && setAmountIn(formatTokenAmount(tokenInBalance, tokenIn.decimals))}
                className="text-xs text-primary hover:underline"
              >
                Balance: {tokenInBalanceFormatted}
              </button>
            )}
          </div>
          <div className="flex items-center space-x-3">
            <input
              type="number" value={amountIn}
              onChange={e => setAmountIn(e.target.value)}
              placeholder="0.0" min="0" step="any"
              className="flex-1 bg-transparent text-2xl outline-none"
            />
            <button
              onClick={() => setShowTokenSelect('in')}
              className="flex items-center space-x-2 bg-background rounded-xl px-4 py-2 border border-border hover:border-primary transition-colors"
            >
              {tokenIn ? (
                <>
                  {tokenIn.logoURI && <img src={tokenIn.logoURI} alt={tokenIn.symbol} className="w-6 h-6 rounded-full" />}
                  <span className="font-medium">{tokenIn.symbol}</span>
                </>
              ) : <span>Select token</span>}
            </button>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex justify-center -my-2">
          <button onClick={swapTokens} className="bg-secondary rounded-full p-2 border-4 border-background hover:bg-secondary/80 transition-colors">
            <ArrowDownIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Token Out + chain selector */}
        <div className="bg-secondary rounded-xl p-4">
          <div className="flex justify-between mb-2">
            <span className="text-sm text-muted-foreground">To (estimated)</span>
            <select
              value={destinationChainId}
              onChange={e => setDestinationChainId(Number(e.target.value))}
              className="text-xs bg-background border border-border rounded-lg px-2 py-1 outline-none focus:border-primary"
            >
              {DESTINATION_CHAINS.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center space-x-3">
            <input
              type="number" readOnly placeholder="0.0"
              value={quote?.amountOut ? formatTokenAmount(quote.amountOut, tokenOut?.decimals || 18) : ''}
              className="flex-1 bg-transparent text-2xl outline-none"
            />
            <button
              onClick={() => setShowTokenSelect('out')}
              className="flex items-center space-x-2 bg-background rounded-xl px-4 py-2 border border-border hover:border-primary transition-colors"
            >
              {tokenOut ? (
                <>
                  {tokenOut.logoURI && <img src={tokenOut.logoURI} alt={tokenOut.symbol} className="w-6 h-6 rounded-full" />}
                  <span className="font-medium">{tokenOut.symbol}</span>
                </>
              ) : <span>Select token</span>}
            </button>
          </div>
        </div>

        {/* Recipient */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm text-muted-foreground">Recipient</label>
            <button
              onClick={() => {
                setCustomRecipient(!customRecipient)
                if (customRecipient && walletAddress) setRecipient(walletAddress)
              }}
              className="text-xs text-primary hover:underline"
            >
              {customRecipient ? '← Use my wallet' : 'Send to different address'}
            </button>
          </div>
          {customRecipient ? (
            <input
              type="text" value={recipient} onChange={e => setRecipient(e.target.value)}
              placeholder="0x…"
              className="w-full bg-secondary rounded-xl px-4 py-3 border border-border focus:border-primary outline-none text-sm font-mono"
            />
          ) : (
            <div className="bg-secondary rounded-xl px-4 py-3 border border-border text-sm font-mono text-muted-foreground truncate">
              {walletAddress ?? 'Connect wallet'}
            </div>
          )}
        </div>

        {/* XCM fee note */}
        <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 text-xs text-muted-foreground">
          <span className="text-primary font-semibold shrink-0">XCM</span>
          A small native token fee (PAS/WND) is required to pay execution weight on the destination chain. A 20% buffer is added automatically.
        </div>

        <SlippageControl />

        {/* Submit */}
        <button
          onClick={handleSwap} disabled={isDisabled}
          className="w-full py-4 rounded-xl font-semibold text-base transition-all duration-200
            bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98]
            disabled:opacity-40 disabled:cursor-not-allowed"
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
          <div className="text-xs text-muted-foreground text-center">
            1 {tokenIn.symbol} ≈ {formatTokenAmount(
              quote.amountOut * BigInt(10 ** tokenIn.decimals)
                / BigInt(Math.floor(parseFloat(amountIn) * 10 ** tokenIn.decimals) || 1),
              tokenOut.decimals
            )} {tokenOut.symbol}
          </div>
        )}
      </div>

      {/* CrossChainStatus overlay — shown when a tx is in flight or settled */}
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
