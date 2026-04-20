import { supabase } from './client'
import type { Business, SalesEntry, ExpenseMonth, ExpenseOther, Product } from './types'

// --- Businesses ---

export async function fetchBusiness(userId: string) {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('user_id', userId)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return data as Business | null
}

export async function createBusiness(business: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('businesses')
    .insert(business as never)
    .select()
    .single()
  if (error) throw error
  return data as unknown as Business
}

export async function updateBusiness(id: string, updates: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('businesses')
    .update(updates as never)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as unknown as Business
}

// --- Sales ---

export async function fetchSales(businessId: string, monthYear?: string) {
  let query = supabase
    .from('sales_entries')
    .select('*')
    .eq('business_id', businessId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })

  if (monthYear) {
    const [year, month] = monthYear.split('-')
    const startDate = `${year}-${month}-01`
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate()
    const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`
    query = query.gte('date', startDate).lte('date', endDate)
  }

  const { data, error } = await query
  if (error) throw error
  return data as unknown as SalesEntry[]
}

export async function createSale(sale: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('sales_entries')
    .insert(sale as never)
    .select()
    .single()
  if (error) throw error
  return data as unknown as SalesEntry
}

export async function updateSale(id: string, updates: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('sales_entries')
    .update(updates as never)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as unknown as SalesEntry
}

export async function deleteSale(id: string) {
  const { error } = await supabase
    .from('sales_entries')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// --- Expenses ---

export async function fetchExpenseMonth(businessId: string, monthYear: string) {
  const { data, error } = await supabase
    .from('expense_months')
    .select('*')
    .eq('business_id', businessId)
    .eq('month_year', monthYear)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return data as unknown as ExpenseMonth | null
}

export async function fetchAllExpenseMonths(businessId: string) {
  const { data, error } = await supabase
    .from('expense_months')
    .select('*')
    .eq('business_id', businessId)
    .order('month_year', { ascending: false })
  if (error) throw error
  return data as unknown as ExpenseMonth[]
}

export async function upsertExpenseMonth(expense: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('expense_months')
    .upsert(expense as never, { onConflict: 'business_id,month_year' })
    .select()
    .single()
  if (error) throw error
  return data as unknown as ExpenseMonth
}

// --- Expense Others ---

export async function fetchExpenseOthers(expenseMonthId: string) {
  const { data, error } = await supabase
    .from('expense_others')
    .select('*')
    .eq('expense_month_id', expenseMonthId)
  if (error) throw error
  return data as unknown as ExpenseOther[]
}

export async function createExpenseOther(other: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('expense_others')
    .insert(other as never)
    .select()
    .single()
  if (error) throw error
  return data as unknown as ExpenseOther
}

export async function deleteExpenseOther(id: string) {
  const { error } = await supabase
    .from('expense_others')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// --- Products ---

export async function fetchProducts(businessId: string) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('business_id', businessId)
    .order('name')
  if (error) throw error
  return data as unknown as Product[]
}

export async function createProduct(product: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('products')
    .insert(product as never)
    .select()
    .single()
  if (error) throw error
  return data as unknown as Product
}

export async function deleteProduct(id: string) {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)
  if (error) throw error
}
