import { CURRENCY } from './constants'

export function formatCurrency(amount: number): string {
  return `${CURRENCY.symbol}${amount.toLocaleString('en-NG')}`
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function getCurrentMonthYear(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function getMonthLabel(monthYear: string): string {
  const [year, month] = monthYear.split('-')
  const date = new Date(parseInt(year), parseInt(month) - 1)
  return date.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' })
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export function getTodayDate(): string {
  return new Date().toISOString().split('T')[0]
}
