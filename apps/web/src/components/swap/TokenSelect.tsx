import { useState, useEffect } from 'react'
import { XMarkIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { useWalletStore } from '../../store/useWalletStore'
import { useMultipleTokenBalances } from '../../hooks/useBalances'
import { usePublicClient } from 'wagmi'
import { Token } from '../../types'
import { cn, formatTokenAmount } from '../../lib/utils'
import { tokenService } from '../../services/tokenService'

interface TokenSelectProps {
  type: 'in' | 'out'
  onSelect: (token: Token) => void
  onClose: () => void
}

export function TokenSelect({ type, onSelect, onClose }: TokenSelectProps) {
  const [search, setSearch] = useState('')
  const [tokens, setTokens] = useState<Token[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const { chainId } = useWalletStore()
  const publicClient = usePublicClient()

  useEffect(() => {
    const loadTokens = async () => {
      if (!chainId || !publicClient) {
        setIsLoading(false)
        return
      }
      
      setIsLoading(true)
      try {
        const allTokens = await tokenService.getAllSupportedTokens(chainId, publicClient)
        setTokens(allTokens)
      } catch (error) {
        console.error('Error loading tokens:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadTokens()
  }, [chainId, publicClient])

  useEffect(() => {
    const searchTokens = async () => {
      if (!chainId || !publicClient) {
        return
      }
      
      if (!search.trim()) {
        setIsLoading(true)
        try {
          const allTokens = await tokenService.getAllSupportedTokens(chainId, publicClient)
          setTokens(allTokens)
        } catch (error) {
          console.error('Error loading tokens:', error)
        } finally {
          setIsLoading(false)
        }
        return
      }
      
      setIsLoading(true)
      try {
        const results = await tokenService.searchTokens(chainId, search, publicClient)
        setTokens(results)
      } catch (error) {
        console.error('Error searching tokens:', error)
      } finally {
        setIsLoading(false)
      }
    }

    const debounce = setTimeout(searchTokens, 300)
    return () => clearTimeout(debounce)
  }, [search, chainId, publicClient])

  // Filter tokens based on type and chainId
  const filteredTokens = tokens.filter((token) => {
    if (type === 'in' && chainId) {
      return token.chainId === chainId
    }
    return true
  })

  const { balances } = useMultipleTokenBalances(filteredTokens)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden">
        <div className="p-4 border-b border-border flex justify-between items-center">
          <h3 className="text-lg font-semibold">Select a token</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-secondary rounded-lg transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or paste address"
              className="w-full bg-secondary rounded-xl pl-10 pr-4 py-3 border border-border focus:border-primary outline-none"
              disabled={!chainId || !publicClient}
            />
          </div>
          {!chainId && (
            <p className="text-xs text-muted-foreground mt-2">
              Please connect your wallet to view tokens
            </p>
          )}
          {chainId && !publicClient && (
            <p className="text-xs text-muted-foreground mt-2">
              Waiting for connection...
            </p>
          )}
        </div>

        <div className="overflow-y-auto max-h-96">
          {!chainId ? (
            <div className="p-8 text-center text-muted-foreground">
              Connect wallet to view tokens
            </div>
          ) : isLoading ? (
            <div className="p-8 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-primary border-t-transparent"></div>
              <p className="mt-2 text-sm text-muted-foreground">Loading tokens...</p>
            </div>
          ) : filteredTokens.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {search ? 'No tokens found matching your search' : 'No tokens available on this chain'}
            </div>
          ) : (
            filteredTokens.map((token) => {
              const balance = balances.get(token.address) || 0n
              const hasBalance = balance > 0n

              return (
                <button
                  key={`${token.chainId}-${token.address}`}
                  onClick={() => onSelect(token)}
                  className={cn(
                    'w-full p-4 flex items-center justify-between hover:bg-secondary transition-colors',
                    hasBalance && 'border-l-2 border-primary'
                  )}
                >
                  <div className="flex items-center space-x-3">
                    {token.logoURI ? (
                      <img
                        src={token.logoURI}
                        alt={token.symbol}
                        className="w-8 h-8 rounded-full"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                          e.currentTarget.nextElementSibling?.classList.remove('hidden')
                        }}
                      />
                    ) : null}
                    <div className={cn(
                      "w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center",
                      token.logoURI ? 'hidden' : ''
                    )}>
                      <span className="text-xs">{token.symbol.slice(0, 2)}</span>
                    </div>
                    <div className="text-left">
                      <div className="font-medium">{token.symbol}</div>
                      <div className="text-xs text-muted-foreground">{token.name}</div>
                    </div>
                  </div>
                  {balance > 0n && (
                    <div className="text-sm">
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