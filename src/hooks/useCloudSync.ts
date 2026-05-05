'use client'

import { useCallback } from 'react'
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

  // --- Sales ---

  const addSale = useCallback((sale: SalesEntry) => {
    store.addSale(sale)
    if (shouldSync) {
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
      }).catch((err) => console.error('Sync addSale failed:', err))
    }
  }, [shouldSync, store])

  const updateSale = useCallback((id: string, updates: Partial<SalesEntry>) => {
    store.updateSale(id, updates)
    if (shouldSync) {
      db.updateSale(id, updates as Record<string, unknown>)
        .catch((err) => console.error('Sync updateSale failed:', err))
    }
  }, [shouldSync, store])

  const deleteSale = useCallback((id: string) => {
    store.deleteSale(id)
    if (shouldSync) {
      db.deleteSale(id).catch((err) => console.error('Sync deleteSale failed:', err))
    }
  }, [shouldSync, store])

  // --- Expenses ---

  const upsertExpenseMonth = useCallback((expense: ExpenseMonth) => {
    store.upsertExpenseMonth(expense)
    if (shouldSync) {
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
      }).catch((err) => console.error('Sync upsertExpenseMonth failed:', err))
    }
  }, [shouldSync, store])

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
  }, [shouldSync, store])

  const deleteExpenseOther = useCallback((id: string) => {
    store.deleteExpenseOther(id)
    if (shouldSync) {
      db.deleteExpenseOther(id).catch((err) => console.error('Sync deleteExpenseOther failed:', err))
    }
  }, [shouldSync, store])

  // --- Products ---

  const addProduct = useCallback((product: Product) => {
    store.addProduct(product)
    if (shouldSync) {
      db.createProduct({
        id: product.id,
        business_id: product.business_id,
        name: product.name,
        price: product.price,
        created_at: product.created_at,
      }).catch((err) => console.error('Sync addProduct failed:', err))
    }
  }, [shouldSync, store])

  const deleteProduct = useCallback((id: string) => {
    store.deleteProduct(id)
    if (shouldSync) {
      db.deleteProduct(id).catch((err) => console.error('Sync deleteProduct failed:', err))
    }
  }, [shouldSync, store])

  // --- Business ---

  const setBusiness = useCallback((business: Business | null) => {
    store.setBusiness(business)
    if (shouldSync && business) {
      db.updateBusiness(business.id, {
        name: business.name,
        type: business.type,
        currency: business.currency,
        channels: business.channels,
        logo_base64: business.logo_base64,
      }).catch((err) => console.error('Sync setBusiness failed:', err))
    }
  }, [shouldSync, store])

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
      }).catch((err) => console.error('Sync addBusiness failed:', err))
    }
  }, [shouldSync, store])

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
