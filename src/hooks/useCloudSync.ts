'use client'

import { useCallback, useRef } from 'react'
import { useStore } from '@/store'
import { supabase } from '@/lib/supabase/client'
import * as db from '@/lib/supabase/db'
import type { Business, SalesEntry, ExpenseMonth, ExpenseOther, Product } from '@/lib/supabase/types'

/**
 * Hook that provides store actions with automatic Supabase cloud sync.
 * Local store updates immediately (optimistic), cloud syncs in background.
 * If cloud fails, local still works — errors are logged silently.
 */
export function useCloudSync() {
  const store = useStore()
  const { user, isGuest } = store

  const shouldSync = !!supabase && !!user && !isGuest

  // Track which businesses have been confirmed to exist in Supabase
  const syncedBusinesses = useRef<Set<string>>(new Set())

  /**
   * Ensures a business exists in Supabase before syncing child records.
   * If business doesn't exist remotely, creates it first.
   */
  async function ensureBusinessInCloud(businessId: string) {
    if (syncedBusinesses.current.has(businessId)) return

    const state = useStore.getState()
    const biz = state.businesses.find((b) => b.id === businessId)
    if (!biz) return

    // Shared business (owned by someone else) — already exists in cloud
    if (biz.user_id !== user!.id) {
      syncedBusinesses.current.add(businessId)
      return
    }

    // Try to fetch it first
    const existing = await db.fetchBusiness(user!.id)
    if (existing && existing.id === businessId) {
      syncedBusinesses.current.add(businessId)
      return
    }

    // Check if this specific business exists via fetchBusinesses
    const allBiz = await db.fetchBusinesses(user!.id)
    if (allBiz.some((b) => b.id === businessId)) {
      syncedBusinesses.current.add(businessId)
      return
    }

    // Business doesn't exist in cloud — create it
    await db.createBusiness({
      id: biz.id,
      user_id: user!.id,
      name: biz.name,
      type: biz.type,
      currency: biz.currency,
      channels: biz.channels,
      logo_base64: biz.logo_base64,
      created_at: biz.created_at,
    })
    syncedBusinesses.current.add(businessId)
  }

  // --- Sales ---

  const addSale = useCallback((sale: SalesEntry) => {
    store.addSale(sale)
    if (shouldSync) {
      ensureBusinessInCloud(sale.business_id).then(() =>
        db.createSale({
          id: sale.id,
          business_id: sale.business_id,
          date: sale.date,
          channel: sale.channel,
          units: sale.units,
          amount: sale.amount,
          delivery_fee: sale.delivery_fee,
          note: sale.note,
          created_at: sale.created_at,
        })
      ).catch((err) => console.error('Sync addSale failed:', err))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldSync])

  const updateSale = useCallback((id: string, updates: Partial<SalesEntry>) => {
    store.updateSale(id, updates)
    if (shouldSync) {
      db.updateSale(id, updates as Record<string, unknown>)
        .catch((err) => console.error('Sync updateSale failed:', err))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldSync])

  const deleteSale = useCallback((id: string) => {
    store.deleteSale(id)
    if (shouldSync) {
      db.deleteSale(id).catch((err) => console.error('Sync deleteSale failed:', err))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldSync])

  // --- Expenses ---

  const upsertExpenseMonth = useCallback((expense: ExpenseMonth) => {
    store.upsertExpenseMonth(expense)
    if (shouldSync) {
      ensureBusinessInCloud(expense.business_id).then(() =>
        db.upsertExpenseMonth({
          id: expense.id,
          business_id: expense.business_id,
          month_year: expense.month_year,
          production: expense.production,
          logistics: expense.logistics,
          marketing: expense.marketing,
          packaging: expense.packaging,
          software: expense.software,
          amenities: expense.amenities,
          notes: expense.notes,
          created_at: expense.created_at,
        })
      ).catch((err) => console.error('Sync upsertExpenseMonth failed:', err))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldSync])

  const addExpenseOther = useCallback((other: ExpenseOther) => {
    store.addExpenseOther(other)
    if (shouldSync) {
      db.createExpenseOther({
        id: other.id,
        expense_month_id: other.expense_month_id,
        label: other.label,
        amount: other.amount,
      }).catch((err) => console.error('Sync addExpenseOther failed:', err))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldSync])

  const deleteExpenseOther = useCallback((id: string) => {
    store.deleteExpenseOther(id)
    if (shouldSync) {
      db.deleteExpenseOther(id).catch((err) => console.error('Sync deleteExpenseOther failed:', err))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldSync])

  // --- Products ---

  const addProduct = useCallback((product: Product) => {
    store.addProduct(product)
    if (shouldSync) {
      ensureBusinessInCloud(product.business_id).then(() =>
        db.createProduct({
          id: product.id,
          business_id: product.business_id,
          name: product.name,
          price: product.price,
          created_at: product.created_at,
        })
      ).catch((err) => console.error('Sync addProduct failed:', err))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldSync])

  const deleteProduct = useCallback((id: string) => {
    store.deleteProduct(id)
    if (shouldSync) {
      db.deleteProduct(id).catch((err) => console.error('Sync deleteProduct failed:', err))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldSync])

  // --- Business ---

  const setBusiness = useCallback((business: Business | null) => {
    store.setBusiness(business)
    if (shouldSync && business) {
      ensureBusinessInCloud(business.id).then(() =>
        db.updateBusiness(business.id, {
          name: business.name,
          type: business.type,
          currency: business.currency,
          channels: business.channels,
          logo_base64: business.logo_base64,
        })
      ).catch((err) => console.error('Sync setBusiness failed:', err))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldSync])

  const addBusiness = useCallback((business: Business) => {
    store.addBusiness(business)
    if (shouldSync) {
      db.createBusiness({
        id: business.id,
        user_id: business.user_id,
        name: business.name,
        type: business.type,
        currency: business.currency,
        channels: business.channels,
        logo_base64: business.logo_base64,
        created_at: business.created_at,
      }).then(() => {
        syncedBusinesses.current.add(business.id)
      }).catch((err) => console.error('Sync addBusiness failed:', err))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldSync])

  return {
    // Pass through read state
    ...store,
    // Override write actions with synced versions
    addSale,
    updateSale,
    deleteSale,
    upsertExpenseMonth,
    addExpenseOther,
    deleteExpenseOther,
    addProduct,
    deleteProduct,
    setBusiness,
    addBusiness,
  }
}
