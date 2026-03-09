import { useState, useEffect } from 'react'
import { useWalletStore } from '../../store/useWalletStore'
import { useMultipleTokenBalances } from '../../hooks/useBalances'
import { usePublicClient } from 'wagmi'
import { Token } from '../../types'
import { cn, formatTokenAmount } from '../../lib/utils'
import { tokenService } from '../../services/tokenService'

interface TokenSelectProps {
  type:     'in' | 'out'
  onSelect: (token: Token) => void
  onClose:  () => void
}

export function TokenSelect({ type, onSelect, onClose }: TokenSelectProps) {
  const [search, setSearch]     = useState('')
  const [tokens, setTokens]     = useState<Token[]>([])
  const [isLoading, setLoading] = useState(true)
  const { chainId }             = useWalletStore()
  const publicClient            = usePublicClient()

  useEffect(() => {
    const load = async () => {
      if (!chainId || !publicClient) { setLoading(false); return }
      setLoading(true)
      try {
        setTokens(await tokenService.getAllSupportedTokens(chainId, publicClient))
      } catch (e) { console.error(e) }
      finally { setLoading(false) }
    }
    load()
  }, [chainId, publicClient])

  useEffect(() => {
    const search_ = async () => {
      if (!chainId || !publicClient) return
      setLoading(true)
      try {
        setTokens(
          search.trim()
            ? await tokenService.searchTokens(chainId, search, publicClient)
            : await tokenService.getAllSupportedTokens(chainId, publicClient)
        )
      } catch (e) { console.error(e) }
      finally { setLoading(false) }
    }
    const t = setTimeout(search_, 300)
    return () => clearTimeout(t)
  }, [search, chainId, publicClient])

  const filtered = tokens.filter(t => type === 'in' && chainId ? t.chainId === chainId : true)
  const { balances } = useMultipleTokenBalances(filtered)

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="swap-card w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">
              Select
            </div>
            <h3 className="font-bold text-base">Token</h3>
          </div>
          <button
            onClick={onClose}
            className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-border shrink-0">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search or paste address"
              disabled={!chainId || !publicClient}
              className="w-full bg-secondary rounded-xl pl-9 pr-4 py-2.5 text-sm border border-transparent focus:border-primary outline-none transition-colors"
            />
          </div>
          {!chainId && (
            <p className="font-mono text-[10px] text-muted-foreground mt-2 uppercase tracking-wider">
              Connect wallet to view tokens
            </p>
          )}
        </div>

        {/* Token list */}
        <div className="overflow-y-auto flex-1">
          {!chainId ? (
            <div className="py-16 text-center text-muted-foreground text-sm">Connect wallet to view tokens</div>
          ) : isLoading ? (
            <div className="py-16 flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Loading</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Not found</div>
              <p className="text-sm text-muted-foreground">
                {search ? 'No tokens match your search.' : 'No tokens available.'}
              </p>
            </div>
          ) : (
            filtered.map(token => {
              const balance    = balances.get(token.address) || 0n
              const hasBalance = balance > 0n

              return (
                <button
                  key={`${token.chainId}-${token.address}`}
                  onClick={() => onSelect(token)}
                  className={cn(
                    'w-full px-5 py-3.5 flex items-center justify-between hover:bg-secondary/60 transition-colors',
                    hasBalance && 'border-l-2 border-primary'
                  )}
                >
                  <div className="flex items-center gap-3">
                    {token.logoURI ? (
                      <img
                        src={token.logoURI} alt={token.symbol}
                        className="w-8 h-8 rounded-full"
                        onError={e => {
                          e.currentTarget.style.display = 'none'
                          e.currentTarget.nextElementSibling?.classList.remove('hidden')
                        }}
                      />
                    ) : null}
                    <div className={cn(
                      'w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center font-mono text-xs font-bold text-primary',
                      token.logoURI ? 'hidden' : ''
                    )}>
                      {token.symbol.slice(0, 2)}
                    </div>
                    <div className="text-left">
                      <div className="font-semibold text-sm">{token.symbol}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{token.name}</div>
                    </div>
                  </div>
                  {balance > 0n && (
                    <div className="font-mono text-xs text-muted-foreground">
                      {formatTokenAmount(balance, token.decimals)}
                    </div>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}