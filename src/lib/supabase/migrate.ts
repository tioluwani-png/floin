import { supabase } from './client'
import { useStore } from '@/store'

/**
 * Ensures ALL local data is pushed to Supabase under the real user_id.
 *
 * Handles three cases:
 * 1. Guest data (user_id='guest') → retag and push
 * 2. Data with correct user_id that never reached Supabase (e.g. sync failed)
 * 3. Data already in cloud → upsert is a safe no-op
 *
 * Uses upsert so it's safe to call on every sign-in.
 */
export async function ensureLocalDataInCloud(userId: string) {
  if (!supabase) return

  const state = useStore.getState()

  if (state.businesses.length === 0) return

  // 1. Retag any guest businesses locally
  const hasGuestData = state.businesses.some(b => b.user_id === 'guest')
  if (hasGuestData) {
    const updatedBusinesses = state.businesses.map(b =>
      b.user_id === 'guest' ? { ...b, user_id: userId } : b
    )
    const activeBusiness = state.business && state.business.user_id === 'guest'
      ? { ...state.business, user_id: userId }
      : state.business
    state.setBusinesses(updatedBusinesses, activeBusiness)
  }

  // 2. Push ALL local businesses and child records to Supabase
  //    (re-read state after potential guest migration above)
  const current = useStore.getState()

  for (const biz of current.businesses) {
    // Skip businesses we don't own — they're shared with us
    if (biz.user_id !== userId && biz.user_id !== 'guest') continue

    try {
      await supabase.from('businesses').upsert({
        id: biz.id, user_id: userId, name: biz.name, type: biz.type,
        currency: biz.currency, channels: biz.channels,
        logo_base64: biz.logo_base64, created_at: biz.created_at,
      } as never)

      const sales = current.sales.filter(s => s.business_id === biz.id)
      if (sales.length > 0) {
        await supabase.from('sales_entries').upsert(
          sales.map(s => ({
            id: s.id, business_id: s.business_id, date: s.date,
            channel: s.channel, units: s.units, amount: s.amount,
            delivery_fee: s.delivery_fee, note: s.note, created_at: s.created_at,
          })) as never
        )
      }

      const expenses = current.expenseMonths.filter(e => e.business_id === biz.id)
      if (expenses.length > 0) {
        await supabase.from('expense_months').upsert(
          expenses.map(e => ({
            id: e.id, business_id: e.business_id, month_year: e.month_year,
            production: e.production, logistics: e.logistics, marketing: e.marketing,
            packaging: e.packaging, software: e.software, amenities: e.amenities,
            notes: e.notes, created_at: e.created_at,
          })) as never
        )
      }

      const expenseIds = new Set(expenses.map(e => e.id))
      const others = current.expenseOthers.filter(o => expenseIds.has(o.expense_month_id))
      if (others.length > 0) {
        await supabase.from('expense_others').upsert(
          others.map(o => ({
            id: o.id, expense_month_id: o.expense_month_id,
            label: o.label, amount: o.amount,
          })) as never
        )
      }

      const products = current.products.filter(p => p.business_id === biz.id)
      if (products.length > 0) {
        await supabase.from('products').upsert(
          products.map(p => ({
            id: p.id, business_id: p.business_id,
            name: p.name, price: p.price, created_at: p.created_at,
          })) as never
        )
      }
    } catch (err) {
      console.error('Failed to push local data to cloud for business:', biz.id, err)
    }
  }
}
