import { create } from 'zustand'
import { Transaction } from '../types'

interface TransactionState {
  transactions: Transaction[]
  pendingTransactions: Transaction[]
  
  addTransaction: (tx: Transaction) => void
  updateTransaction: (hash: string, updates: Partial<Transaction>) => void
  removeTransaction: (hash: string) => void
  clearTransactions: () => void
  getTransaction: (hash: string) => Transaction | undefined
  getTransactionsByType: (type: Transaction['type']) => Transaction[]
  getTransactionsByStatus: (status: Transaction['status']) => Transaction[]
}

export const useTransactionStore = create<TransactionState>((set, get) => ({
  transactions: [],
  pendingTransactions: [],

  addTransaction: (tx) => set((state) => {
    const transactions = [tx, ...state.transactions].slice(0, 100)
    const pendingTransactions = tx.status === 'pending' 
      ? [tx, ...state.pendingTransactions]
      : state.pendingTransactions
    
    return { transactions, pendingTransactions }
  }),

  updateTransaction: (hash, updates) => set((state) => {
    const transactions = state.transactions.map((tx) =>
      tx.hash === hash ? { ...tx, ...updates } : tx
    )
    
    const pendingTransactions = state.pendingTransactions.filter(
      (tx) => tx.hash !== hash
    )
    
    if (updates.status === 'pending') {
      const updated = transactions.find((tx) => tx.hash === hash)
      if (updated) {
        pendingTransactions.push(updated)
      }
    }
    
    return { transactions, pendingTransactions }
  }),

  removeTransaction: (hash) => set((state) => ({
    transactions: state.transactions.filter((tx) => tx.hash !== hash),
    pendingTransactions: state.pendingTransactions.filter((tx) => tx.hash !== hash)
  })),

  clearTransactions: () => set({ transactions: [], pendingTransactions: [] }),

  getTransaction: (hash) => {
    return get().transactions.find((tx) => tx.hash === hash)
  },

  getTransactionsByType: (type) => {
    return get().transactions.filter((tx) => tx.type === type)
  },

  getTransactionsByStatus: (status) => {
    return get().transactions.filter((tx) => tx.status === status)
  }
}))