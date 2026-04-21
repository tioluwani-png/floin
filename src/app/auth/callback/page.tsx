'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { useStore } from '@/store'

export default function AuthCallbackPage() {
  const router = useRouter()
  const { setUser, setGuest, onboardingComplete } = useStore()

  useEffect(() => {
    async function handleCallback() {
      if (!supabase) {
        router.replace('/login')
        return
      }

      // Supabase auto-detects the code in the URL and exchanges it
      const { data: { session }, error } = await supabase.auth.getSession()

      if (!error && session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email || '',
          name: session.user.user_metadata?.full_name || session.user.email || '',
          avatar_url: session.user.user_metadata?.avatar_url,
        })
        setGuest(false)

        if (onboardingComplete) {
          router.replace('/sales')
        } else {
          router.replace('/onboarding')
        }
      } else {
        // Auth failed — back to login
        router.replace('/login')
      }
    }

    // Small delay to let Supabase process the URL params
    const timeout = setTimeout(handleCallback, 500)
    return () => clearTimeout(timeout)
  }, [router, setUser, setGuest, onboardingComplete])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center animate-fade-in">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-floin-green to-floin-green-dark shadow-lg shadow-floin-green/20">
          <span className="text-xl font-bold text-white">F</span>
        </div>
        <p className="mt-3 text-sm font-medium text-muted">Signing you in...</p>
      </div>
    </div>
  )
}
