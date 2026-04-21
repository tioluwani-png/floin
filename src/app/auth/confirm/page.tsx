'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { useStore } from '@/store'

export default function AuthConfirmPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setUser, setGuest, onboardingComplete } = useStore()

  useEffect(() => {
    async function handleAuth() {
      const code = searchParams.get('code')

      if (code && supabase) {
        try {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code)
          if (!error && data.session?.user) {
            setUser({
              id: data.session.user.id,
              email: data.session.user.email || '',
              name: data.session.user.user_metadata?.full_name || data.session.user.email || '',
              avatar_url: data.session.user.user_metadata?.avatar_url,
            })
            setGuest(false)
          }
        } catch {
          // Session exchange failed — continue anyway
        }
      }

      // Route based on onboarding state
      if (onboardingComplete) {
        router.replace('/sales')
      } else {
        router.replace('/onboarding')
      }
    }

    handleAuth()
  }, [searchParams, router, setUser, setGuest, onboardingComplete])

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
