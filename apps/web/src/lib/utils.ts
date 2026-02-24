import { type ClassValue, clsx } from 'clsx'
import { formatUnits } from 'viem'
import Decimal from 'decimal.js'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  const value = formatUnits(amount, decimals)
  const decimal = new Decimal(value)
  
  if (decimal.greaterThanOrEqualTo(1000)) {
    return decimal.toFixed(2)
  } else if (decimal.greaterThanOrEqualTo(1)) {
    return decimal.toFixed(4)
  } else if (decimal.greaterThanOrEqualTo(0.0001)) {
    return decimal.toFixed(6)
  } else {
    return decimal.toFixed(8)
  }
}

export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount)
}

export function formatPercentage(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString()
}

export function calculateSlippage(amount: bigint, slippage: number): bigint {
  const slippageBps = Math.floor(slippage * 100)
  const amountDecimal = new Decimal(amount.toString())
  const slippageDecimal = new Decimal(slippageBps).dividedBy(10000)
  const minAmount = amountDecimal.times(new Decimal(1).minus(slippageDecimal))
  
  return BigInt(minAmount.toFixed(0))
}

export function calculatePriceImpact(
  amountIn: bigint,
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint
): number {
  if (reserveIn === 0n || reserveOut === 0n) return 0
  
  const amountInDecimal = new Decimal(amountIn.toString())
  const amountOutDecimal = new Decimal(amountOut.toString())
  const reserveInDecimal = new Decimal(reserveIn.toString())
  const reserveOutDecimal = new Decimal(reserveOut.toString())
  
  const k = reserveInDecimal.times(reserveOutDecimal)
  const newReserveIn = reserveInDecimal.plus(amountInDecimal)
  const newReserveOut = k.dividedBy(newReserveIn)
  const expectedOut = reserveOutDecimal.minus(newReserveOut)
  
  if (expectedOut.equals(0)) return 0
  
  const impact = amountOutDecimal.minus(expectedOut).dividedBy(expectedOut).times(100)
  
  return Number(impact.toFixed(2))
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

export function abbreviateNumber(num: number): string {
  if (num >= 1e9) {
    return (num / 1e9).toFixed(2) + 'B'
  } else if (num >= 1e6) {
    return (num / 1e6).toFixed(2) + 'M'
  } else if (num >= 1e3) {
    return (num / 1e3).toFixed(2) + 'K'
  } else {
    return num.toString()
  }
}