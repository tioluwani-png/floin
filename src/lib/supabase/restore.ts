import {
  fetchBusinesses,
  fetchSales,
  fetchAllExpenseMonths,
  fetchExpenseOthers,
  fetchProducts,
} from './db'
import { supabase } from './client'
import type { Business, SalesEntry, ExpenseMonth, ExpenseOther, Product } from './types'

function mergeById<T extends { id: string }>(local: T[], cloud: T[]): T[] {
  const localIds = new Set(local.map((item) => item.id))
  const newFromCloud = cloud.filter((item) => !localIds.has(item.id))
  return [...local, ...newFromCloud]
}

export async function restoreFromCloud(userId: string) {
  if (!supabase) throw new Error('Supabase not configured')

  const cloudBusinesses = await fetchBusinesses(userId)

  let allSales: SalesEntry[] = []
  let allExpenseMonths: ExpenseMonth[] = []
  let allExpenseOthers: ExpenseOther[] = []
  let allProducts: Product[] = []

  for (const biz of cloudBusinesses) {
    const [sales, expenseMonths, products] = await Promise.all([
      fetchSales(biz.id),
      fetchAllExpenseMonths(biz.id),
      fetchProducts(biz.id),
    ])

    allSales = [...allSales, ...sales]
    allExpenseMonths = [...allExpenseMonths, ...expenseMonths]
    allProducts = [...allProducts, ...products]

    const othersArrays = await Promise.all(
      expenseMonths.map((em) => fetchExpenseOthers(em.id))
    )
    allExpenseOthers = [...allExpenseOthers, ...othersArrays.flat()]
  }

  return {
    businesses: cloudBusinesses,
    sales: allSales,
    expenseMonths: allExpenseMonths,
    expenseOthers: allExpenseOthers,
    products: allProducts,
  }
}

export async function restoreAndMerge(
  userId: string,
  localState: {
    businesses: Business[]
    business: Business | null
    sales: SalesEntry[]
    expenseMonths: ExpenseMonth[]
    expenseOthers: ExpenseOther[]
    products: Product[]
  },
  applyMerged: (result: {
    businesses: Business[]
    activeBusiness: Business | null
    sales: SalesEntry[]
    expenseMonths: ExpenseMonth[]
    expenseOthers: ExpenseOther[]
    products: Product[]
  }) => void
): Promise<void> {
  const cloud = await restoreFromCloud(userId)

  const mergedBusinesses = mergeById(localState.businesses, cloud.businesses)
  const mergedSales = mergeById(localState.sales, cloud.sales)
  const mergedExpenseMonths = mergeById(localState.expenseMonths, cloud.expenseMonths)
  const mergedExpenseOthers = mergeById(localState.expenseOthers, cloud.expenseOthers)
  const mergedProducts = mergeById(localState.products, cloud.products)

  const activeBusiness =
    localState.business && mergedBusinesses.find((b) => b.id === localState.business!.id)
      ? localState.business
      : mergedBusinesses[0] || null

  applyMerged({
    businesses: mergedBusinesses,
    activeBusiness,
    sales: mergedSales,
    expenseMonths: mergedExpenseMonths,
    expenseOthers: mergedExpenseOthers,
    products: mergedProducts,
  })
}
