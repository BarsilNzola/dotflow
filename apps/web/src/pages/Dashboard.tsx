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
      <div className="text-center py-16">
        <h2 className="text-2xl font-bold mb-4">Connect Your Wallet</h2>
        <p className="text-muted-foreground">
          Please connect your wallet to view your dashboard
        </p>
      </div>
    )
  }

  const userTransactions = transactions.filter((tx) => tx.from === address)

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      {/* Stats Cards */}
      <div className="grid md:grid-cols-4 gap-6">
        <div className="swap-card p-6">
          <div className="text-sm text-muted-foreground mb-1">Total Swaps</div>
          <div className="text-2xl font-bold">
            {userTransactions.filter((tx) => tx.type === 'swap').length}
          </div>
        </div>
        <div className="swap-card p-6">
          <div className="text-sm text-muted-foreground mb-1">Cross-Chain Swaps</div>
          <div className="text-2xl font-bold">
            {userTransactions.filter((tx) => tx.type === 'cross-chain-swap').length}
          </div>
        </div>
        <div className="swap-card p-6">
          <div className="text-sm text-muted-foreground mb-1">Pending</div>
          <div className="text-2xl font-bold text-yellow-600">
            {pendingTransactions.length}
          </div>
        </div>
        <div className="swap-card p-6">
          <div className="text-sm text-muted-foreground mb-1">Total Value</div>
          <div className="text-2xl font-bold">$0.00</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex space-x-8">
          <button
            onClick={() => setActiveTab('transactions')}
            className={`pb-4 px-1 font-medium transition-colors relative ${
              activeTab === 'transactions'
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Transactions
          </button>
          <button
            onClick={() => setActiveTab('positions')}
            className={`pb-4 px-1 font-medium transition-colors relative ${
              activeTab === 'positions'
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Liquidity Positions
          </button>
        </div>
      </div>

      {/* Transactions Tab */}
      {activeTab === 'transactions' && (
        <div className="swap-card overflow-hidden">
          {userTransactions.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No transactions yet
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-secondary">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    TX Hash
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {userTransactions.map((tx) => (
                  <tr key={tx.hash} className="hover:bg-secondary/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        tx.type === 'swap' ? 'bg-blue-100 text-blue-800' :
                        tx.type === 'cross-chain-swap' ? 'bg-purple-100 text-purple-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm">{tx.description}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        tx.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                        tx.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {formatTimestamp(tx.timestamp / 1000)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono">
                      <a
                        href={`https://etherscan.io/tx/${tx.hash}`}
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

      {/* Positions Tab */}
      {activeTab === 'positions' && (
        <div className="swap-card p-8 text-center text-muted-foreground">
          No active liquidity positions
        </div>
      )}
    </div>
  )
}