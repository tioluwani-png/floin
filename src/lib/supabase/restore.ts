import {
  fetchBusinesses,
  fetchSales,
  fetchAllExpenseMonths,
  fetchExpenseOthers,
  fetchProducts,
} from './db'
import { fetchMemberships, fetchBusinessesByIds } from './teams'
import { supabase } from './client'
import type { Business, SalesEntry, ExpenseMonth, ExpenseOther, Product } from './types'

function mergeById<T extends { id: string }>(local: T[], cloud: T[]): T[] {
  const localIds = new Set(local.map((item) => item.id))
  const newFromCloud = cloud.filter((item) => !localIds.has(item.id))
  return [...local, ...newFromCloud]
}

export async function restoreFromCloud(userId: string) {
  if (!supabase) throw new Error('Supabase not configured')

  // Fetch owned businesses
  const ownedBusinesses = await fetchBusinesses(userId)

  // Fetch shared businesses (where user is a member)
  const memberships = await fetchMemberships(userId)
  const sharedBusinessIds = memberships
    .map((m) => m.business_id)
    .filter((id) => !ownedBusinesses.some((b) => b.id === id))
  const sharedBusinesses = await fetchBusinessesByIds(sharedBusinessIds)

  // Combine owned + shared
  const allBusinesses = [...ownedBusinesses, ...sharedBusinesses]

  // Build memberRoles map
  const memberRoles: Record<string, 'owner' | 'member'> = {}
  for (const biz of ownedBusinesses) {
    memberRoles[biz.id] = 'owner'
  }
  for (const biz of sharedBusinesses) {
    memberRoles[biz.id] = 'member'
  }

  let allSales: SalesEntry[] = []
  let allExpenseMonths: ExpenseMonth[] = []
  let allExpenseOthers: ExpenseOther[] = []
  let allProducts: Product[] = []

  for (const biz of allBusinesses) {
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
    businesses: allBusinesses,
    sales: allSales,
    expenseMonths: allExpenseMonths,
    expenseOthers: allExpenseOthers,
    products: allProducts,
    memberRoles,
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
    memberRoles: Record<string, 'owner' | 'member'>
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
    memberRoles: cloud.memberRoles,
  })
}
