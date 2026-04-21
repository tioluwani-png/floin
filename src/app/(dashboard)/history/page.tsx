'use client'

import { useMemo } from 'react'
import { useStore } from '@/store'
import { formatCurrency, getMonthLabel } from '@/lib/utils'
import { TrendChart } from '@/components/report/TrendChart'

interface MonthSummary {
  monthYear: string
  revenue: number
  expenses: number
  profit: number
  margin: number
  units: number
}

export default function HistoryPage() {
  const { sales, expenseMonths, expenseOthers, business } = useStore()

  const businessSales = useMemo(
    () => sales.filter((s) => s.business_id === (business?.id || 'guest')),
    [sales, business?.id]
  )
  const businessExpenses = useMemo(
    () => expenseMonths.filter((e) => e.business_id === (business?.id || 'guest')),
    [expenseMonths, business?.id]
  )

  const months = useMemo(() => {
    const monthMap = new Map<string, MonthSummary>()

    businessSales.forEach((sale) => {
      const monthYear = sale.date.substring(0, 7)
      const existing = monthMap.get(monthYear) || { monthYear, revenue: 0, expenses: 0, profit: 0, margin: 0, units: 0 }
      existing.revenue += sale.amount
      existing.units += sale.units
      monthMap.set(monthYear, existing)
    })

    businessExpenses.forEach((expense) => {
      const existing = monthMap.get(expense.month_year) || { monthYear: expense.month_year, revenue: 0, expenses: 0, profit: 0, margin: 0, units: 0 }
      const catTotal = expense.production + expense.logistics + expense.marketing + expense.packaging + expense.software + expense.amenities
      const othersTotal = expenseOthers.filter((o) => o.expense_month_id === expense.id).reduce((sum, o) => sum + o.amount, 0)
      existing.expenses = catTotal + othersTotal
      monthMap.set(expense.month_year, existing)
    })

    return Array.from(monthMap.values())
      .map((m) => ({
        ...m,
        profit: m.revenue - m.expenses,
        margin: m.revenue > 0 ? ((m.revenue - m.expenses) / m.revenue) * 100 : 0,
      }))
      .sort((a, b) => b.monthYear.localeCompare(a.monthYear))
  }, [businessSales, businessExpenses, expenseOthers])

  const bestMonth = useMemo(() => months.reduce((best, m) => (m.profit > (best?.profit || -Infinity) ? m : best), months[0]), [months])
  const worstMonth = useMemo(() => months.reduce((worst, m) => (m.profit < (worst?.profit || Infinity) ? m : worst), months[0]), [months])
  const avgMargin = useMemo(() => months.length === 0 ? 0 : months.reduce((sum, m) => sum + m.margin, 0) / months.length, [months])

  if (months.length === 0) {
    return (
      <div className="animate-fade-up">
        <h1 className="text-2xl font-bold tracking-tight">History</h1>
        <div className="mt-20 text-center animate-fade-in">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-floin-green-light">
            <span className="text-2xl">📈</span>
          </div>
          <p className="mt-4 text-sm font-semibold">No history yet</p>
          <p className="mt-1 text-xs text-muted">Your monthly performance will appear here over time</p>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-up">
      <div>
        <p className="text-xs font-medium text-muted uppercase tracking-wider">
          {months.length} month{months.length > 1 ? 's' : ''} tracked
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">History</h1>
      </div>

      {/* At-a-glance stats */}
      <div className="mt-5 grid grid-cols-3 gap-2 stagger-children">
        <div className="rounded-2xl bg-gradient-to-br from-floin-green to-emerald-600 p-3.5 shadow-sm shadow-floin-green/10">
          <p className="text-[10px] font-medium text-white/70">Best</p>
          <p className="mt-0.5 text-xs font-bold text-white">
            {bestMonth ? getMonthLabel(bestMonth.monthYear).split(' ')[0] : '—'}
          </p>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-floin-red to-rose-600 p-3.5 shadow-sm shadow-floin-red/10">
          <p className="text-[10px] font-medium text-white/70">Worst</p>
          <p className="mt-0.5 text-xs font-bold text-white">
            {worstMonth ? getMonthLabel(worstMonth.monthYear).split(' ')[0] : '—'}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-3.5 shadow-sm border border-border/40">
          <p className="text-[10px] font-medium text-muted">Avg margin</p>
          <p className="mt-0.5 text-xs font-bold">{avgMargin.toFixed(1)}%</p>
        </div>
      </div>

      {/* Trend chart */}
      {months.length >= 2 && (
        <div className="mt-6 rounded-2xl bg-white p-4 shadow-sm border border-border/40">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Trend</h3>
          <div className="mt-4">
            <TrendChart months={[...months].reverse()} />
          </div>
        </div>
      )}

      {/* Month-by-month */}
      <div className="mt-6 space-y-2 stagger-children">
        {months.map((m) => (
          <div
            key={m.monthYear}
            className="rounded-2xl bg-white p-4 shadow-sm border border-border/40 transition-all duration-200 hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">{getMonthLabel(m.monthYear)}</h3>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                  m.profit >= 0
                    ? 'bg-floin-green-light text-floin-green-dark'
                    : 'bg-floin-red-light text-floin-red'
                }`}
              >
                {m.profit >= 0 ? '+' : ''}{formatCurrency(m.profit)}
              </span>
            </div>
            <div className="mt-2.5 flex gap-4 text-xs text-muted">
              <span>Revenue: <span className="font-medium text-foreground">{formatCurrency(m.revenue)}</span></span>
              <span>Expenses: <span className="font-medium text-foreground">{formatCurrency(m.expenses)}</span></span>
            </div>
            {/* Mini progress bar */}
            <div className="mt-2.5 h-1.5 rounded-full bg-background overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${m.profit >= 0 ? 'bg-gradient-to-r from-floin-green to-emerald-400' : 'bg-gradient-to-r from-floin-red to-rose-400'}`}
                style={{ width: `${Math.min(Math.abs(m.margin), 100)}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] text-muted">
              <span>{m.units} units</span>
              <span>{m.margin.toFixed(1)}% margin</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
