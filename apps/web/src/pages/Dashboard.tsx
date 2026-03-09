import { useState } from 'react'
import { useWalletStore } from '../store/useWalletStore'
import { useTransactionStore } from '../store/useTransactionStore'
import { formatTimestamp, formatAddress } from '../lib/utils'

export function Dashboard() {
  const { address, isConnected } = useWalletStore()
  const { transactions, pendingTransactions } = useTransactionStore()
  const [activeTab, setActiveTab] = useState<'transactions' | 'positions'>('transactions')

  if (!isConnected) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <div className="font-mono text-xs text-muted-foreground uppercase tracking-widest mb-4">Dashboard</div>
        <h2 className="text-4xl font-black tracking-tight mb-3">Connect your wallet</h2>
        <p className="text-muted-foreground text-sm">Your swap history and positions will appear here.</p>
      </div>
    )
  }

  const userTransactions = transactions.filter(tx => tx.from === address)
  const swapCount        = userTransactions.filter(tx => tx.type === 'swap').length
  const crossChainCount  = userTransactions.filter(tx => tx.type === 'cross-chain-swap').length

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-10">

      {/* Header */}
      <div>
        <div className="font-mono text-xs text-muted-foreground uppercase tracking-widest mb-2">Overview</div>
        <h1 className="text-4xl font-black tracking-tight">Dashboard</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-2xl overflow-hidden">
        {[
          { label: 'Total Swaps',        value: swapCount,               accent: false },
          { label: 'Cross-Chain Swaps',  value: crossChainCount,         accent: false },
          { label: 'Pending',            value: pendingTransactions.length, accent: pendingTransactions.length > 0 },
          { label: 'Total Value',        value: '$0.00',                 accent: false },
        ].map(({ label, value, accent }) => (
          <div key={label} className="bg-background p-6">
            <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2">{label}</div>
            <div className={`text-3xl font-black tracking-tight ${accent ? 'text-yellow-500' : ''}`}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-border">
        {(['transactions', 'positions'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-3 font-mono text-xs uppercase tracking-widest transition-colors relative ${
              activeTab === tab
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'transactions' ? 'Transactions' : 'Liquidity Positions'}
            {activeTab === tab && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Transactions */}
      {activeTab === 'transactions' && (
        <div className="swap-card overflow-hidden">
          {userTransactions.length === 0 ? (
            <div className="py-20 text-center">
              <div className="font-mono text-xs text-muted-foreground uppercase tracking-widest mb-3">Empty</div>
              <p className="text-muted-foreground text-sm">No transactions yet — make your first swap.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {['Type', 'Description', 'Status', 'Time', 'TX Hash'].map(h => (
                    <th key={h} className="px-5 py-3 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {userTransactions.map(tx => (
                  <tr key={tx.hash} className="hover:bg-secondary/40 transition-colors">
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className={`px-2.5 py-1 rounded-full font-mono text-[10px] uppercase tracking-wider ${
                        tx.type === 'cross-chain-swap'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-secondary text-muted-foreground'
                      }`}>
                        {tx.type === 'cross-chain-swap' ? 'XCM' : 'Swap'}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm">{tx.description}</td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className={`px-2.5 py-1 rounded-full font-mono text-[10px] uppercase tracking-wider ${
                        tx.status === 'confirmed' ? 'bg-green-500/10 text-green-500' :
                        tx.status === 'pending'   ? 'bg-yellow-500/10 text-yellow-500' :
                                                    'bg-red-500/10 text-red-500'
                      }`}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {formatTimestamp(tx.timestamp / 1000)}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap font-mono text-xs">
                      <a
                        href={`https://blockscout-westend.polkadot.io/tx/${tx.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {formatAddress(tx.hash)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Positions */}
      {activeTab === 'positions' && (
        <div className="swap-card py-20 text-center">
          <div className="font-mono text-xs text-muted-foreground uppercase tracking-widest mb-3">Empty</div>
          <p className="text-muted-foreground text-sm">No active liquidity positions.</p>
        </div>
      )}
    </div>
  )
}