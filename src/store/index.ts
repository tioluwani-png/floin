import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Business, SalesEntry, ExpenseMonth, ExpenseOther, Product } from '@/lib/supabase/types'

interface User {
  id: string
  email: string
  name: string
  avatar_url?: string
}

interface FloinState {
  // Auth
  user: User | null
  isGuest: boolean
  setUser: (user: User | null) => void
  setGuest: (isGuest: boolean) => void

  // Business (multi-business)
  business: Business | null
  businesses: Business[]
  activeBusinessId: string | null
  setBusiness: (business: Business | null) => void
  addBusiness: (business: Business) => void
  switchBusiness: (id: string) => void
  removeBusiness: (id: string) => void

  // Sales
  sales: SalesEntry[]
  setSales: (sales: SalesEntry[]) => void
  addSale: (sale: SalesEntry) => void
  updateSale: (id: string, sale: Partial<SalesEntry>) => void
  deleteSale: (id: string) => void

  // Expenses
  expenseMonths: ExpenseMonth[]
  expenseOthers: ExpenseOther[]
  setExpenseMonths: (expenses: ExpenseMonth[]) => void
  setExpenseOthers: (others: ExpenseOther[]) => void
  upsertExpenseMonth: (expense: ExpenseMonth) => void
  addExpenseOther: (other: ExpenseOther) => void
  deleteExpenseOther: (id: string) => void

  // Products
  products: Product[]
  setProducts: (products: Product[]) => void
  addProduct: (product: Product) => void
  deleteProduct: (id: string) => void

  // Onboarding
  onboardingComplete: boolean
  setOnboardingComplete: (complete: boolean) => void
}

export const useStore = create<FloinState>()(
  persist(
    (set) => ({
      // Auth
      user: null,
      isGuest: true,
      setUser: (user) => set({ user, isGuest: !user }),
      setGuest: (isGuest) => set({ isGuest }),

      // Business (multi-business)
      business: null,
      businesses: [],
      activeBusinessId: null,
      setBusiness: (business) => set((state) => {
        if (!business) return { business: null, activeBusinessId: null }
        const idx = state.businesses.findIndex(b => b.id === business.id)
        const businesses = idx >= 0
          ? state.businesses.map(b => b.id === business.id ? business : b)
          : [...state.businesses, business]
        return { business, businesses, activeBusinessId: business.id }
      }),
      addBusiness: (business) => set((state) => ({
        businesses: [...state.businesses, business],
        business,
        activeBusinessId: business.id,
      })),
      switchBusiness: (id) => set((state) => ({
        business: state.businesses.find(b => b.id === id) || state.business,
        activeBusinessId: id,
      })),
      removeBusiness: (id) => set((state) => {
        const businesses = state.businesses.filter(b => b.id !== id)
        const next = businesses[0] || null
        return {
          businesses,
          business: next,
          activeBusinessId: next?.id || null,
        }
      }),

      // Sales
      sales: [],
      setSales: (sales) => set({ sales }),
      addSale: (sale) => set((state) => ({ sales: [sale, ...state.sales] })),
      updateSale: (id, updated) =>
        set((state) => ({
          sales: state.sales.map((s) => (s.id === id ? { ...s, ...updated } : s)),
        })),
      deleteSale: (id) =>
        set((state) => ({ sales: state.sales.filter((s) => s.id !== id) })),

      // Expenses
      expenseMonths: [],
      expenseOthers: [],
      setExpenseMonths: (expenseMonths) => set({ expenseMonths }),
      setExpenseOthers: (expenseOthers) => set({ expenseOthers }),
      upsertExpenseMonth: (expense) =>
        set((state) => {
          const exists = state.expenseMonths.find((e) => e.id === expense.id)
          if (exists) {
            return {
              expenseMonths: state.expenseMonths.map((e) =>
                e.id === expense.id ? expense : e
              ),
            }
          }
          return { expenseMonths: [...state.expenseMonths, expense] }
        }),
      addExpenseOther: (other) =>
        set((state) => ({ expenseOthers: [...state.expenseOthers, other] })),
      deleteExpenseOther: (id) =>
        set((state) => ({
          expenseOthers: state.expenseOthers.filter((o) => o.id !== id),
        })),

      // Products
      products: [],
      setProducts: (products) => set({ products }),
      addProduct: (product) =>
        set((state) => ({ products: [...state.products, product] })),
      deleteProduct: (id) =>
        set((state) => ({ products: state.products.filter((p) => p.id !== id) })),

      // Onboarding
      onboardingComplete: false,
      setOnboardingComplete: (onboardingComplete) => set({ onboardingComplete }),
    }),
    {
      name: 'floin-storage',
      onRehydrateStorage: () => (state) => {
        // Migrate: if old single-business exists but businesses array is empty
        if (state && state.business && state.businesses.length === 0) {
          state.businesses = [state.business]
          state.activeBusinessId = state.business.id
        }
      },
    }
  )
)
