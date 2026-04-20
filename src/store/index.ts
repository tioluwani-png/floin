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

  // Business
  business: Business | null
  setBusiness: (business: Business | null) => void

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

      // Business
      business: null,
      setBusiness: (business) => set({ business }),

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
    }
  )
)
