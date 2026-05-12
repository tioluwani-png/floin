'use client'

import { useEffect } from 'react'
import { useStore } from '@/store'
import { supabase } from '@/lib/supabase/client'
import { restoreAndMerge } from '@/lib/supabase/restore'
import { ensureLocalDataInCloud } from '@/lib/supabase/migrate'

function syncFromCloud(userId: string) {
  const state = useStore.getState()
  restoreAndMerge(
    userId,
    {
      businesses: state.businesses,
      business: state.business,
      sales: state.sales,
      expenseMonths: state.expenseMonths,
      expenseOthers: state.expenseOthers,
      products: state.products,
    },
    (merged) => {
      const s = useStore.getState()
      s.setBusinesses(merged.businesses, merged.activeBusiness)
      s.setSales(merged.sales)
      s.setExpenseMonths(merged.expenseMonths)
      s.setExpenseOthers(merged.expenseOthers)
      s.setProducts(merged.products)
      s.setMemberRoles(merged.memberRoles)
      if (merged.businesses.length > 0) {
        s.setOnboardingComplete(true)
      }
    }
  ).catch((err) => {
    console.error('Cloud restore failed:', err)
  })
}

function handleSignIn(userId: string) {
  ensureLocalDataInCloud(userId)
    .then(() => syncFromCloud(userId))
    .catch((err) => {
      console.error('Migration failed, syncing anyway:', err)
      syncFromCloud(userId)
    })
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setGuest } = useStore()

  useEffect(() => {
    if (!supabase) return

    // Check for existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email || '',
          name: session.user.user_metadata?.full_name || session.user.email || '',
          avatar_url: session.user.user_metadata?.avatar_url,
        })
        setGuest(false)
        handleSignIn(session.user.id)
      }
    })

    // Listen for auth state changes (sign in, sign out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          setUser({
            id: session.user.id,
            email: session.user.email || '',
            name: session.user.user_metadata?.full_name || session.user.email || '',
            avatar_url: session.user.user_metadata?.avatar_url,
          })
          setGuest(false)
          handleSignIn(session.user.id)
        } else if (event === 'SIGNED_OUT') {
          setUser(null)
          setGuest(true)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [setUser, setGuest])

  return <>{children}</>
}
