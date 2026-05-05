'use client'

import { useState, useMemo } from 'react'
import { SALES_CHANNELS } from '@/lib/constants'
import { useCloudSync } from '@/hooks/useCloudSync'
import { useCurrency } from '@/hooks/useCurrency'
import { formatDate, generateId, getTodayDate, getCurrentMonthYear } from '@/lib/utils'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import type { SalesEntry } from '@/lib/supabase/types'

export default function SalesPage() {
  const { sales, business, products, addSale, deleteSale, updateSale } = useCloudSync()
  const { symbol, format } = useCurrency()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [date, setDate] = useState(getTodayDate())
  const [channel, setChannel] = useState(business?.channels?.[0] || 'instagram')
  const [units, setUnits] = useState('')
  const [amount, setAmount] = useState('')
  const [deliveryFee, setDeliveryFee] = useState('')
  const [note, setNote] = useState('')

  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthYear())
  const businessSales = useMemo(
    () => sales.filter((s) => s.business_id === (business?.id || 'guest')),
    [sales, business?.id]
  )
  const monthSales = useMemo(
    () => businessSales
      .filter((s) => s.date.startsWith(selectedMonth))
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)),
    [businessSales, selectedMonth]
  )

  const filteredSales = useMemo(() => {
    if (!search.trim()) return monthSales
    const q = search.toLowerCase()
    return monthSales.filter((s) =>
      (s.note && s.note.toLowerCase().includes(q)) ||
      SALES_CHANNELS.find((c) => c.id === s.channel)?.label.toLowerCase().includes(q) ||
      formatDate(s.date).toLowerCase().includes(q) ||
      s.amount.toString().includes(q)
    )
  }, [monthSales, search])

  const totals = useMemo(() => {
    const totalRevenue = monthSales.reduce((sum, s) => sum + s.amount, 0)
    const totalUnits = monthSales.reduce((sum, s) => sum + s.units, 0)
    const totalDelivery = monthSales.reduce((sum, s) => sum + (s.delivery_fee || 0), 0)
    const avgOrder = monthSales.length > 0 ? totalRevenue / monthSales.length : 0
    return { totalRevenue, totalUnits, totalDelivery, avgOrder, count: monthSales.length }
  }, [monthSales])

  function resetForm() {
    setDate(getTodayDate())
    setChannel(business?.channels?.[0] || 'instagram')
    setUnits('')
    setAmount('')
    setDeliveryFee('')
    setNote('')
    setEditingId(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!units || !amount) return

    if (editingId) {
      updateSale(editingId, {
        date, channel,
        units: parseInt(units),
        amount: parseFloat(amount),
        delivery_fee: parseFloat(deliveryFee) || 0,
        note: note || null,
      })
    } else {
      const sale: SalesEntry = {
        id: generateId(),
        business_id: business?.id || 'guest',
        date, channel,
        units: parseInt(units),
        amount: parseFloat(amount),
        delivery_fee: parseFloat(deliveryFee) || 0,
        note: note || null,
        created_at: new Date().toISOString(),
      }
      addSale(sale)
    }
    resetForm()
    setShowForm(false)
  }

  function handleEdit(sale: SalesEntry) {
    setEditingId(sale.id)
    setDate(sale.date)
    setChannel(sale.channel)
    setUnits(sale.units.toString())
    setAmount(sale.amount.toString())
    setDeliveryFee((sale.delivery_fee || 0) > 0 ? sale.delivery_fee.toString() : '')
    setNote(sale.note || '')
    setShowForm(true)
  }

  const businessProducts = useMemo(
    () => products.filter((p) => p.business_id === (business?.id || 'guest')),
    [products, business?.id]
  )

  function handleSelectProduct(productName: string, productPrice: number) {
    setAmount(productPrice.toString())
    if (!units) setUnits('1')
    setNote(productName)
  }

  const channels = business?.channels?.length
    ? SALES_CHANNELS.filter((c) => business.channels.includes(c.id))
    : SALES_CHANNELS

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div>
        <MonthNavigator selectedMonth={selectedMonth} onMonthChange={setSelectedMonth} />
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Sales</h1>
      </div>

      {/* Stats cards */}
      <div className="mt-5 grid grid-cols-3 gap-2 stagger-children">
        <div className="rounded-2xl bg-gradient-to-br from-floin-green to-floin-green-dark p-3.5 shadow-sm shadow-floin-green/10">
          <p className="text-[10px] font-medium text-white/70">Revenue</p>
          <p className="mt-1 text-sm font-bold text-white">
            {format(totals.totalRevenue)}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-3.5 shadow-sm border border-border/40">
          <p className="text-[10px] font-medium text-muted">Units</p>
          <p className="mt-1 text-sm font-bold text-foreground">{totals.totalUnits}</p>
        </div>
        <div className="rounded-2xl bg-white p-3.5 shadow-sm border border-border/40">
          <p className="text-[10px] font-medium text-muted">Delivery</p>
          <p className="mt-1 text-sm font-bold text-foreground">
            {format(totals.totalDelivery)}
          </p>
        </div>
      </div>

      {/* Log sale button */}
      {!showForm && (
        <button
          onClick={() => { resetForm(); setShowForm(true) }}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-floin-green to-floin-green-dark py-4 text-sm font-semibold text-white shadow-md shadow-floin-green/20 transition-all hover:shadow-lg active:scale-[0.98]"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Log sale
        </button>
      )}

      {/* Sale form */}
      {showForm && (
        <div className="mt-6 animate-scale-in rounded-2xl bg-white p-5 shadow-lg shadow-black/5 border border-border/40">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold">{editingId ? 'Edit sale' : 'New sale'}</h3>
            <button
              onClick={() => { setShowForm(false); resetForm() }}
              className="rounded-lg p-1.5 text-muted hover:bg-background hover:text-foreground transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            {/* Date */}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-xl bg-background px-4 py-3 text-sm outline-none ring-1 ring-border transition-all focus:ring-2 focus:ring-floin-green"
            />

            {/* Channel selection */}
            <div>
              <label className="text-xs font-medium text-muted-dark">Channel</label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {channels.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setChannel(ch.id)}
                    className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all duration-200 ${
                      channel === ch.id
                        ? 'bg-gradient-to-r from-floin-green to-floin-green-dark text-white shadow-sm'
                        : 'bg-background text-muted-dark ring-1 ring-border hover:ring-floin-green/40'
                    }`}
                  >
                    <span className="text-sm">{ch.icon}</span>
                    {ch.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Product quick-select */}
            {businessProducts.length > 0 && (
              <div>
                <label className="text-xs font-medium text-muted-dark">Quick select product</label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {businessProducts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectProduct(p.name, p.price)}
                      className={`rounded-xl px-3 py-2 text-xs font-medium transition-all duration-200 ${
                        note === p.name && amount === p.price.toString()
                          ? 'bg-gradient-to-r from-floin-purple to-floin-purple-dark text-white shadow-sm'
                          : 'bg-background text-muted-dark ring-1 ring-border hover:ring-floin-purple/40'
                      }`}
                    >
                      {p.name} · {symbol}{p.price.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Units + Amount */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-dark">Units sold</label>
                <input
                  type="number"
                  value={units}
                  onChange={(e) => setUnits(e.target.value)}
                  placeholder="1"
                  min="1"
                  className="mt-1.5 w-full rounded-xl bg-background px-4 py-3 text-sm font-medium outline-none ring-1 ring-border transition-all focus:ring-2 focus:ring-floin-green"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-dark">Amount ({symbol})</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  min="0"
                  step="0.01"
                  className="mt-1.5 w-full rounded-xl bg-background px-4 py-3 text-sm font-medium outline-none ring-1 ring-border transition-all focus:ring-2 focus:ring-floin-green"
                />
              </div>
            </div>

            {/* Delivery fee */}
            <div>
              <label className="text-xs font-medium text-muted-dark">Delivery fee ({symbol}) — optional</label>
              <input
                type="number"
                value={deliveryFee}
                onChange={(e) => setDeliveryFee(e.target.value)}
                placeholder="0"
                min="0"
                step="0.01"
                className="mt-1.5 w-full rounded-xl bg-background px-4 py-3 text-sm font-medium outline-none ring-1 ring-border transition-all focus:ring-2 focus:ring-floin-green"
              />
              <p className="mt-1 text-[10px] text-muted">Charged to customer — not deducted from your profit</p>
            </div>

            {/* Note */}
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional) — e.g. customer name"
              className="w-full rounded-xl bg-background px-4 py-3 text-sm outline-none ring-1 ring-border transition-all focus:ring-2 focus:ring-floin-green"
            />

            {/* Submit */}
            <button
              type="submit"
              disabled={!units || !amount}
              className="w-full rounded-2xl bg-gradient-to-r from-floin-green to-floin-green-dark py-3.5 text-sm font-semibold text-white shadow-md shadow-floin-green/20 transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
            >
              {editingId ? 'Update sale' : 'Add sale'}
            </button>
          </form>
        </div>
      )}

      {/* Sales list */}
      <div className="mt-6">
        {monthSales.length === 0 && !showForm && (
          <div className="py-16 text-center animate-fade-in">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-floin-green-light">
              <span className="text-2xl">💰</span>
            </div>
            <p className="mt-4 text-sm font-semibold">No sales logged yet</p>
            <p className="mt-1 text-xs text-muted">
              Tap &quot;Log sale&quot; to record your first sale
            </p>
          </div>
        )}

        {monthSales.length > 0 && (
          <div className="space-y-2">
            {/* Search bar */}
            <div className="relative">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted">
                <path fillRule="evenodd" d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z" clipRule="evenodd" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, channel, date..."
                className="w-full rounded-xl bg-white pl-10 pr-4 py-2.5 text-sm outline-none ring-1 ring-border/60 transition-all focus:ring-2 focus:ring-floin-green shadow-sm placeholder:text-muted"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted hover:text-foreground transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
                  </svg>
                </button>
              )}
            </div>

            <p className="text-xs font-medium text-muted uppercase tracking-wider mb-3">
              {search
                ? `${filteredSales.length} result${filteredSales.length !== 1 ? 's' : ''}`
                : `${totals.count} sale${totals.count !== 1 ? 's' : ''}`}
            </p>

            {filteredSales.length === 0 && search && (
              <div className="py-8 text-center">
                <p className="text-sm text-muted">No sales matching &quot;{search}&quot;</p>
              </div>
            )}

            {filteredSales.map((sale) => (
              <div
                key={sale.id}
                className="group flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm border border-border/40 transition-all duration-200 hover:shadow-md"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background text-lg">
                    {SALES_CHANNELS.find((c) => c.id === sale.channel)?.icon || '📦'}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{format(sale.amount)}</p>
                      {(sale.delivery_fee || 0) > 0 && (
                        <span className="rounded-md bg-floin-purple-light px-1.5 py-0.5 text-[10px] font-semibold text-floin-purple">
                          +{format(sale.delivery_fee)} delivery
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted truncate">
                      {sale.units} unit{sale.units > 1 ? 's' : ''} · {formatDate(sale.date)}
                      {sale.note && <span className="text-muted-dark"> · {sale.note}</span>}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <button
                    onClick={() => handleEdit(sale)}
                    className="rounded-lg p-2 text-muted hover:bg-background hover:text-foreground transition-colors"
                    aria-label="Edit sale"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                      <path d="m13.488 2.513-1.001-1.001a1.462 1.462 0 0 0-2.07 0L2.71 9.22a.75.75 0 0 0-.198.37l-.582 2.907a.75.75 0 0 0 .882.882l2.907-.582a.75.75 0 0 0 .37-.198l7.706-7.707a1.462 1.462 0 0 0 0-2.07Z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => deleteSale(sale.id)}
                    className="rounded-lg p-2 text-muted hover:bg-floin-red-light hover:text-floin-red transition-colors"
                    aria-label="Delete sale"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                      <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5A.75.75 0 0 1 9.95 6Z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
