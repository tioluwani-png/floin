'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/store'
import { signOut } from '@/lib/supabase/auth'
import { SALES_CHANNELS, BUSINESS_TYPES, CURRENCY } from '@/lib/constants'
import { generateId } from '@/lib/utils'
import type { Product } from '@/lib/supabase/types'

export default function ProfilePage() {
  const router = useRouter()
  const {
    user, isGuest, business, setBusiness,
    products, addProduct, deleteProduct,
    setOnboardingComplete, setUser, setGuest,
    setSales, setExpenseMonths, setExpenseOthers, setProducts,
  } = useStore()

  const [name, setName] = useState(business?.name || '')
  const [type, setType] = useState(business?.type || 'product')
  const [channels, setChannels] = useState<string[]>(business?.channels || [])
  const [productName, setProductName] = useState('')
  const [productPrice, setProductPrice] = useState('')
  const [showProductForm, setShowProductForm] = useState(false)

  function toggleChannel(id: string) {
    const updated = channels.includes(id) ? channels.filter((c) => c !== id) : [...channels, id]
    setChannels(updated)
    if (business) setBusiness({ ...business, channels: updated })
  }

  function handleSaveProfile() {
    if (business) {
      setBusiness({ ...business, name: name || business.name, type: type as 'product' | 'service' | 'hybrid', channels })
    }
  }

  function handleAddProduct(e: React.FormEvent) {
    e.preventDefault()
    if (!productName || !productPrice) return
    const product: Product = { id: generateId(), business_id: business?.id || 'guest', name: productName, price: parseFloat(productPrice), created_at: new Date().toISOString() }
    addProduct(product)
    setProductName('')
    setProductPrice('')
    setShowProductForm(false)
  }

  async function handleLogout() {
    try { await signOut() } catch {}
    setUser(null)
    setGuest(true)
    setOnboardingComplete(false)
    setBusiness(null)
    setSales([])
    setExpenseMonths([])
    setExpenseOthers([])
    setProducts([])
    router.push('/login')
  }

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-floin-green to-floin-green-dark shadow-sm shadow-floin-green/20">
          <span className="text-xl font-bold text-white">
            {(business?.name || 'F')[0].toUpperCase()}
          </span>
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">{business?.name || 'My Business'}</h1>
          <p className="text-xs text-muted">
            {isGuest ? 'Guest mode — data saved locally' : user?.email}
          </p>
        </div>
      </div>

      {/* Business info */}
      <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm border border-border/40">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Business details</h3>

        <div className="mt-4">
          <label className="text-xs font-medium text-muted-dark">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleSaveProfile}
            placeholder="Business name"
            className="mt-1.5 w-full rounded-xl bg-background px-4 py-3 text-sm font-medium outline-none ring-1 ring-border transition-all focus:ring-2 focus:ring-floin-green"
          />
        </div>

        <div className="mt-4">
          <label className="text-xs font-medium text-muted-dark">Type</label>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {BUSINESS_TYPES.map((bt) => (
              <button
                key={bt.id}
                onClick={() => { setType(bt.id); if (business) setBusiness({ ...business, type: bt.id as 'product' | 'service' | 'hybrid' }) }}
                className={`rounded-xl px-2 py-2.5 text-xs font-medium transition-all duration-200 ${
                  type === bt.id
                    ? 'bg-gradient-to-br from-floin-green to-floin-green-dark text-white shadow-sm'
                    : 'bg-background text-muted-dark ring-1 ring-border'
                }`}
              >
                {bt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <label className="text-xs font-medium text-muted-dark">Sales channels</label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SALES_CHANNELS.map((ch) => (
              <button
                key={ch.id}
                onClick={() => toggleChannel(ch.id)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all duration-200 ${
                  channels.includes(ch.id)
                    ? 'bg-gradient-to-r from-floin-green to-floin-green-dark text-white shadow-sm'
                    : 'bg-background text-muted-dark ring-1 ring-border'
                }`}
              >
                <span className="text-sm">{ch.icon}</span>
                {ch.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-xl bg-background p-3">
          <span className="text-xs text-muted-dark">Currency</span>
          <span className="text-xs font-semibold">{CURRENCY.name} ({CURRENCY.symbol})</span>
        </div>
      </div>

      {/* Product catalogue */}
      <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm border border-border/40">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Product catalogue</h3>
          <button
            onClick={() => setShowProductForm(!showProductForm)}
            className="rounded-lg bg-floin-green-light px-2.5 py-1 text-xs font-semibold text-floin-green-dark transition-colors hover:bg-floin-green/20"
          >
            {showProductForm ? 'Cancel' : '+ Add'}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">Pre-set products for faster sale logging</p>

        {showProductForm && (
          <form onSubmit={handleAddProduct} className="mt-3 flex gap-2 animate-scale-in">
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="Product name"
              className="flex-1 rounded-xl bg-background px-3 py-2.5 text-sm outline-none ring-1 ring-border focus:ring-2 focus:ring-floin-green"
              autoFocus
            />
            <div className="relative w-24">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">{CURRENCY.symbol}</span>
              <input
                type="number"
                value={productPrice}
                onChange={(e) => setProductPrice(e.target.value)}
                placeholder="0"
                min="0"
                className="w-full rounded-xl bg-background py-2.5 pl-6 pr-2 text-sm text-right outline-none ring-1 ring-border focus:ring-2 focus:ring-floin-green"
              />
            </div>
            <button type="submit" disabled={!productName || !productPrice} className="rounded-xl bg-gradient-to-r from-floin-green to-floin-green-dark px-3 text-white font-bold disabled:opacity-40">+</button>
          </form>
        )}

        {products.length > 0 ? (
          <div className="mt-3 space-y-2">
            {products.map((p) => (
              <div key={p.id} className="group flex items-center justify-between rounded-xl bg-background p-3">
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted">{CURRENCY.symbol}{p.price.toLocaleString()}</p>
                </div>
                <button onClick={() => deleteProduct(p.id)} className="text-xs font-medium text-muted opacity-0 group-hover:opacity-100 hover:text-floin-red transition-all">Remove</button>
              </div>
            ))}
          </div>
        ) : !showProductForm && (
          <p className="mt-3 text-xs text-muted">No products added yet</p>
        )}
      </div>

      {/* Actions */}
      <div className="mt-6 space-y-3">
        {isGuest && (
          <button
            onClick={() => router.push('/login')}
            className="w-full rounded-2xl bg-foreground py-4 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
          >
            Sign in to save your data
          </button>
        )}
        <button
          onClick={handleLogout}
          className="w-full rounded-2xl border-2 border-floin-red/20 py-3.5 text-sm font-semibold text-floin-red transition-all hover:bg-floin-red-light hover:border-floin-red/40 active:scale-[0.98]"
        >
          {isGuest ? 'Clear all data' : 'Sign out'}
        </button>
      </div>
    </div>
  )
}
