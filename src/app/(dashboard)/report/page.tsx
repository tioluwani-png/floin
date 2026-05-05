'use client'

import { useState, useMemo } from 'react'
import { useStore } from '@/store'
import { SALES_CHANNELS, EXPENSE_CATEGORIES } from '@/lib/constants'
import { getCurrentMonthYear, getMonthLabel } from '@/lib/utils'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import { useCurrency } from '@/hooks/useCurrency'
import { ChannelChart } from '@/components/report/ChannelChart'
import { ExportButton } from '@/components/report/ExportButton'
import { ShareButton } from '@/components/report/ShareButton'

export default function ReportPage() {
  const { sales, expenseMonths, expenseOthers, business } = useStore()
  const { symbol, format, code: currencyCode } = useCurrency()
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthYear())

  const businessSales = useMemo(
    () => sales.filter((s) => s.business_id === (business?.id || 'guest')),
    [sales, business?.id]
  )
  const businessExpenses = useMemo(
    () => expenseMonths.filter((e) => e.business_id === (business?.id || 'guest')),
    [expenseMonths, business?.id]
  )

  const monthSales = useMemo(
    () => businessSales.filter((s) => s.date.startsWith(selectedMonth)),
    [businessSales, selectedMonth]
  )

  const monthExpense = useMemo(
    () => businessExpenses.find((e) => e.month_year === selectedMonth),
    [businessExpenses, selectedMonth]
  )

  const monthOthers = useMemo(
    () => (monthExpense ? expenseOthers.filter((o) => o.expense_month_id === monthExpense.id) : []),
    [expenseOthers, monthExpense]
  )

  const totalRevenue = useMemo(() => monthSales.reduce((sum, s) => sum + s.amount, 0), [monthSales])
  const totalUnits = useMemo(() => monthSales.reduce((sum, s) => sum + s.units, 0), [monthSales])

  const categoryExpenses = useMemo(() => {
    if (!monthExpense) return 0
    return monthExpense.production + monthExpense.logistics + monthExpense.marketing + monthExpense.packaging + monthExpense.software + monthExpense.amenities
  }, [monthExpense])

  const othersExpenses = useMemo(() => monthOthers.reduce((sum, o) => sum + o.amount, 0), [monthOthers])
  const totalExpenses = categoryExpenses + othersExpenses
  const netProfit = totalRevenue - totalExpenses
  const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

  const channelData = useMemo(() => {
    const data: Record<string, number> = {}
    monthSales.forEach((sale) => { data[sale.channel] = (data[sale.channel] || 0) + sale.amount })
    return data
  }, [monthSales])

  const directUnits = useMemo(() => monthSales.filter((s) => s.channel !== 'distributor').reduce((sum, s) => sum + s.units, 0), [monthSales])
  const distributorUnits = useMemo(() => monthSales.filter((s) => s.channel === 'distributor').reduce((sum, s) => sum + s.units, 0), [monthSales])

  const hasData = monthSales.length > 0 || monthExpense

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <MonthNavigator selectedMonth={selectedMonth} onMonthChange={setSelectedMonth} />
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Report</h1>
        </div>
        {hasData && (
          <ExportButton
            monthLabel={getMonthLabel(selectedMonth)}
            businessName={business?.name || 'My Business'}
            revenue={totalRevenue}
            expenses={totalExpenses}
            profit={netProfit}
            margin={margin}
            units={totalUnits}
            salesCount={monthSales.length}
            channelData={channelData}
            expenseBreakdown={[
              ...EXPENSE_CATEGORIES.filter(cat => monthExpense && (monthExpense[cat.id as keyof typeof monthExpense] as number) > 0).map(cat => ({
                label: cat.label,
                amount: (monthExpense?.[cat.id as keyof typeof monthExpense] as number) || 0,
              })),
              ...monthOthers.map(o => ({ label: o.label, amount: o.amount })),
            ]}
            directUnits={directUnits}
            distributorUnits={distributorUnits}
            avgOrder={monthSales.length > 0 ? totalRevenue / monthSales.length : 0}
            currencyCode={currencyCode}
            logoBase64={business?.logo_base64 || null}
            businessType={business?.type || 'product'}
          />
        )}
      </div>

      {!hasData ? (
        <div className="mt-20 text-center animate-fade-in">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-floin-purple-light">
            <span className="text-2xl">📊</span>
          </div>
          <p className="mt-4 text-sm font-semibold">No data yet</p>
          <p className="mt-1 text-xs text-muted">Log some sales and expenses to see your report</p>
        </div>
      ) : (
        <div>
          {/* Hero profit card */}
          <div className={`mt-6 rounded-3xl p-6 ${netProfit >= 0 ? 'bg-gradient-to-br from-floin-green to-emerald-600' : 'bg-gradient-to-br from-floin-red to-rose-600'} shadow-lg ${netProfit >= 0 ? 'shadow-floin-green/20' : 'shadow-floin-red/20'}`}>
            <p className="text-xs font-medium text-white/70">Net Profit</p>
            <p className="mt-1 text-3xl font-bold text-white" data-metric="Net Profit">
              {format(netProfit)}
            </p>
            <div className="mt-3 flex gap-4">
              <span className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-medium text-white">
                {margin.toFixed(1)}% margin
              </span>
              <span className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-medium text-white">
                {totalUnits} units
              </span>
            </div>
          </div>

          {/* Revenue & Expenses */}
          <div className="mt-4 grid grid-cols-2 gap-3 stagger-children">
            <div className="rounded-2xl bg-white p-4 shadow-sm border border-border/40" data-metric="Revenue">
              <p className="text-xs font-medium text-muted">Revenue</p>
              <p className="mt-1 text-lg font-bold text-floin-green">{format(totalRevenue)}</p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm border border-border/40" data-metric="Expenses">
              <p className="text-xs font-medium text-muted">Expenses</p>
              <p className="mt-1 text-lg font-bold text-floin-red">{format(totalExpenses)}</p>
            </div>
          </div>

          {/* Units breakdown */}
          <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm border border-border/40">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Units sold</h3>
            <div className="mt-3 flex items-end gap-6">
              <div>
                <p className="text-3xl font-bold">{totalUnits}</p>
                <p className="text-xs text-muted">Total</p>
              </div>
              <div className="h-8 w-px bg-border" />
              <div>
                <p className="text-sm font-bold">{directUnits}</p>
                <p className="text-xs text-muted">Direct</p>
              </div>
              <div>
                <p className="text-sm font-bold">{distributorUnits}</p>
                <p className="text-xs text-muted">Distributor</p>
              </div>
            </div>
          </div>

          {/* Channel breakdown */}
          {Object.keys(channelData).length > 0 && (
            <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm border border-border/40">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Revenue by channel</h3>
              <div className="mt-4">
                <ChannelChart channelData={channelData} />
              </div>
              <div className="mt-4 space-y-2.5">
                {Object.entries(channelData)
                  .sort(([, a], [, b]) => b - a)
                  .map(([channelId, amount]) => {
                    const percentage = totalRevenue > 0 ? (amount / totalRevenue) * 100 : 0
                    return (
                      <div key={channelId} className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-background text-sm">
                          {SALES_CHANNELS.find((c) => c.id === channelId)?.icon}
                        </span>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">
                              {SALES_CHANNELS.find((c) => c.id === channelId)?.label}
                            </span>
                            <span className="text-xs font-bold">{format(amount)}</span>
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-background overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-floin-green to-floin-green-dark transition-all duration-500"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}

          {/* Expense breakdown */}
          {monthExpense && (
            <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm border border-border/40">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Expense breakdown</h3>
              <div className="mt-3 space-y-2.5">
                {EXPENSE_CATEGORIES.map((cat) => {
                  const val = monthExpense[cat.id as keyof typeof monthExpense] as number
                  if (!val || val === 0) return null
                  return (
                    <div key={cat.id} className="flex items-center justify-between">
                      <span className="text-sm text-muted-dark">{cat.label}</span>
                      <span className="text-sm font-semibold">{format(val)}</span>
                    </div>
                  )
                })}
                {monthOthers.map((other) => (
                  <div key={other.id} className="flex items-center justify-between">
                    <span className="text-sm text-muted-dark">{other.label}</span>
                    <span className="text-sm font-semibold">{format(other.amount)}</span>
                  </div>
                ))}
                <div className="border-t border-border/50 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">Total</span>
                    <span className="text-sm font-bold text-floin-red">{format(totalExpenses)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Share */}
          <ShareButton
            monthLabel={getMonthLabel(selectedMonth)}
            revenue={totalRevenue}
            expenses={totalExpenses}
            profit={netProfit}
            margin={margin}
            units={totalUnits}
            currencySymbol={symbol}
          />
        </div>
      )}
    </div>
  )
}
