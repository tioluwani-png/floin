import { supabase } from './client'
import { useStore } from '@/store'

/**
 * Migrates any local data created under 'guest' user_id to the real
 * signed-in user_id, then pushes it all to Supabase.
 *
 * This handles two cases:
 * 1. User tried guest mode → added data → then signed in with Google
 * 2. Cloud sync previously failed silently (e.g. bad env config)
 *
 * Uses upsert so it's safe to call repeatedly — duplicates are ignored.
 */
export async function migrateGuestData(userId: string) {
  if (!supabase) return

  const state = useStore.getState()
  const guestBusinesses = state.businesses.filter(b => b.user_id === 'guest')

  if (guestBusinesses.length === 0) return

  // 1. Update local state — retag guest businesses with real user_id
  const updatedBusinesses = state.businesses.map(b =>
    b.user_id === 'guest' ? { ...b, user_id: userId } : b
  )
  const activeBusiness = state.business && state.business.user_id === 'guest'
    ? { ...state.business, user_id: userId }
    : state.business
  state.setBusinesses(updatedBusinesses, activeBusiness)

  // 2. Push each migrated business and its child records to Supabase
  for (const biz of guestBusinesses) {
    try {
      await supabase.from('businesses').upsert({
        id: biz.id, user_id: userId, name: biz.name, type: biz.type,
        currency: biz.currency, channels: biz.channels,
        logo_base64: biz.logo_base64, created_at: biz.created_at,
      } as never)

      const sales = state.sales.filter(s => s.business_id === biz.id)
      if (sales.length > 0) {
        await supabase.from('sales_entries').upsert(
          sales.map(s => ({
            id: s.id, business_id: s.business_id, date: s.date,
            channel: s.channel, units: s.units, amount: s.amount,
            delivery_fee: s.delivery_fee, note: s.note, created_at: s.created_at,
          })) as never
        )
      }

      const expenses = state.expenseMonths.filter(e => e.business_id === biz.id)
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
      const others = state.expenseOthers.filter(o => expenseIds.has(o.expense_month_id))
      if (others.length > 0) {
        await supabase.from('expense_others').upsert(
          others.map(o => ({
            id: o.id, expense_month_id: o.expense_month_id,
            label: o.label, amount: o.amount,
          })) as never
        )
      }

      const products = state.products.filter(p => p.business_id === biz.id)
      if (products.length > 0) {
        await supabase.from('products').upsert(
          products.map(p => ({
            id: p.id, business_id: p.business_id,
            name: p.name, price: p.price, created_at: p.created_at,
          })) as never
        )
      }
    } catch (err) {
      console.error('Guest data migration failed for business:', biz.id, err)
    }
  }
}
