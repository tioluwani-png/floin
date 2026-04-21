'use client'

import { useEffect } from 'react'
import { useStore } from '@/store'
import { supabase } from '@/lib/supabase/client'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setGuest } = useStore()

  useEffect(() => {
    if (!supabase) return

    // Listen for auth state changes (sign in, sign out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) {
          setUser({
            id: session.user.id,
            email: session.user.email || '',
            name: session.user.user_metadata?.full_name || session.user.email || '',
            avatar_url: session.user.user_metadata?.avatar_url,
          })
          setGuest(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [setUser, setGuest])

  return <>{children}</>
}
