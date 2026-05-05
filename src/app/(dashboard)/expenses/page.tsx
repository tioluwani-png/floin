'use client'

import { useState, useMemo, useEffect } from 'react'
import { EXPENSE_CATEGORIES } from '@/lib/constants'
import { getCurrentMonthYear, generateId } from '@/lib/utils'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import { useCloudSync } from '@/hooks/useCloudSync'
import { useCurrency } from '@/hooks/useCurrency'
import type { ExpenseMonth, ExpenseOther } from '@/lib/supabase/types'

export default function ExpensesPage() {
  const {
    business,
    sales,
    expenseMonths,
    expenseOthers,
    upsertExpenseMonth,
    addExpenseOther,
    deleteExpenseOther,
  } = useCloudSync()
  const { symbol, format } = useCurrency()

  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthYear())
  const businessExpenses = useMemo(
    () => expenseMonths.filter((e) => e.business_id === (business?.id || 'guest')),
    [expenseMonths, business?.id]
  )

  const currentExpense = useMemo(
    () => businessExpenses.find((e) => e.month_year === selectedMonth) || null,
    [businessExpenses, selectedMonth]
  )

  const deliveryFeesFromSales = useMemo(() => {
    return sales
      .filter((s) => s.business_id === (business?.id || 'guest') && s.date.startsWith(selectedMonth))
      .reduce((sum, s) => sum + (s.delivery_fee || 0), 0)
  }, [sales, business?.id, selectedMonth])

  const [categories, setCategories] = useState<Record<string, string>>({
    production: '', logistics: '', marketing: '', packaging: '', software: '', amenities: '',
  })

  useEffect(() => {
    if (currentExpense) {
      setCategories({
        production: currentExpense.production?.toString() || '',
        logistics: currentExpense.logistics?.toString() || '',
        marketing: currentExpense.marketing?.toString() || '',
        packaging: currentExpense.packaging?.toString() || '',
        software: currentExpense.software?.toString() || '',
        amenities: currentExpense.amenities?.toString() || '',
      })
    } else {
      setCategories({ production: '', logistics: '', marketing: '', packaging: '', software: '', amenities: '' })
    }
  }, [selectedMonth, currentExpense])

  const currentOthers = useMemo(
    () => (currentExpense ? expenseOthers.filter((o) => o.expense_month_id === currentExpense.id) : []),
    [expenseOthers, currentExpense]
  )

  const [otherLabel, setOtherLabel] = useState('')
  const [otherAmount, setOtherAmount] = useState('')

  const categoryTotal = useMemo(
    () => Object.values(categories).reduce((sum, val) => sum + (parseFloat(val) || 0), 0),
    [categories]
  )
  const othersTotal = useMemo(
    () => currentOthers.reduce((sum, o) => sum + o.amount, 0),
    [currentOthers]
  )
  const grandTotal = categoryTotal + othersTotal + deliveryFeesFromSales

  function handleCategoryChange(id: string, value: string) {
    setCategories((prev) => ({ ...prev, [id]: value }))
  }

  function handleSave() {
    const expense: ExpenseMonth = {
      id: currentExpense?.id || generateId(),
      business_id: business?.id || 'guest',
      month_year: selectedMonth,
      production: parseFloat(categories.production) || 0,
      logistics: parseFloat(categories.logistics) || 0,
      marketing: parseFloat(categories.marketing) || 0,
      packaging: parseFloat(categories.packaging) || 0,
      software: parseFloat(categories.software) || 0,
      amenities: parseFloat(categories.amenities) || 0,
      notes: null,
      created_at: currentExpense?.created_at || new Date().toISOString(),
    }
    upsertExpenseMonth(expense)
  }

  function handleAddOther(e: React.FormEvent) {
    e.preventDefault()
    if (!otherLabel || !otherAmount) return

    if (!currentExpense) handleSave()

    const other: ExpenseOther = {
      id: generateId(),
      expense_month_id: currentExpense?.id || generateId(),
      label: otherLabel,
      amount: parseFloat(otherAmount),
    }
    addExpenseOther(other)
    setOtherLabel('')
    setOtherAmount('')
  }

  const categoryIcons: Record<string, string> = {
    production: '🏭',
    logistics: '🚚',
    marketing: '📣',
    packaging: '📦',
    software: '💻',
    amenities: '🧴',
  }

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <MonthNavigator selectedMonth={selectedMonth} onMonthChange={setSelectedMonth} />
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Expenses</h1>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-floin-red to-rose-600 px-4 py-2 shadow-sm shadow-floin-red/10">
          <p className="text-xs font-bold text-white">{format(grandTotal)}</p>
        </div>
      </div>

      {/* Categories */}
      <div className="mt-6 space-y-2 stagger-children">
        {EXPENSE_CATEGORIES.map((cat) => (
          <div key={cat.id}>
            <div className="flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-sm border border-border/40">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-background text-sm">
                {categoryIcons[cat.id]}
              </span>
              <label className="flex-1 text-sm font-medium text-foreground">{cat.label}</label>
              <div className="relative w-28">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted">
                  {symbol}
                </span>
                <input
                  type="number"
                  value={categories[cat.id]}
                  onChange={(e) => handleCategoryChange(cat.id, e.target.value)}
                  onBlur={handleSave}
                  placeholder="0"
                  min="0"
                  step="0.01"
                  className="w-full rounded-xl bg-background py-2.5 pl-7 pr-3 text-sm font-medium text-right outline-none ring-1 ring-border transition-all focus:ring-2 focus:ring-floin-green"
                />
              </div>
            </div>
            {cat.id === 'logistics' && deliveryFeesFromSales > 0 && (
              <div className="ml-12 mt-1 flex items-center gap-1.5 px-1">
                <span className="text-[10px] text-floin-purple font-medium">
                  + {format(deliveryFeesFromSales)} from delivery fees this month
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Other expenses */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">Other expenses</h3>
          <span className="text-xs text-muted">{currentOthers.length} items</span>
        </div>

        {currentOthers.length > 0 && (
          <div className="mt-3 space-y-2">
            {currentOthers.map((other) => (
              <div
                key={other.id}
                className="group flex items-center justify-between rounded-2xl bg-white p-3.5 shadow-sm border border-border/40"
              >
                <div>
                  <p className="text-sm font-medium">{other.label}</p>
                  <p className="text-xs text-muted">{format(other.amount)}</p>
                </div>
                <button
                  onClick={() => deleteExpenseOther(other.id)}
                  className="rounded-lg p-2 text-muted hover:bg-floin-red-light hover:text-floin-red transition-all"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add other expense */}
        <form onSubmit={handleAddOther} className="mt-3 flex gap-2">
          <input
            type="text"
            value={otherLabel}
            onChange={(e) => setOtherLabel(e.target.value)}
            placeholder="e.g. Courier tip"
            className="flex-1 rounded-xl bg-white px-4 py-3 text-sm outline-none ring-1 ring-border transition-all focus:ring-2 focus:ring-floin-green shadow-sm"
          />
          <div className="relative w-24">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted">
              {symbol}
            </span>
            <input
              type="number"
              value={otherAmount}
              onChange={(e) => setOtherAmount(e.target.value)}
              placeholder="0"
              min="0"
              step="0.01"
              className="w-full rounded-xl bg-white py-3 pl-7 pr-3 text-sm font-medium text-right outline-none ring-1 ring-border transition-all focus:ring-2 focus:ring-floin-green shadow-sm"
            />
          </div>
          <button
            type="submit"
            disabled={!otherLabel || !otherAmount}
            className="rounded-xl bg-gradient-to-r from-floin-green to-floin-green-dark px-4 text-white font-bold shadow-sm transition-all active:scale-95 disabled:opacity-40"
          >
            +
          </button>
        </form>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        className="mt-8 w-full rounded-2xl bg-foreground py-4 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
      >
        Save expenses
      </button>
    </div>
  )
}
