'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { useStore } from '@/store'
import { restoreAndMerge } from '@/lib/supabase/restore'

export default function AuthCallbackPage() {
  const router = useRouter()
  const { setUser, setGuest, onboardingComplete } = useStore()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function handleCallback() {
      if (!supabase) {
        setError('Supabase not configured')
        setTimeout(() => router.replace('/login'), 1500)
        return
      }

      try {
        const url = new URL(window.location.href)
        const code = url.searchParams.get('code')
        const errorParam = url.searchParams.get('error')
        const errorDescription = url.searchParams.get('error_description')

        // Handle OAuth error returned by provider
        if (errorParam) {
          console.error('OAuth error:', errorParam, errorDescription)
          setError(errorDescription || 'Sign-in was cancelled')
          setTimeout(() => router.replace('/login'), 2000)
          return
        }

        let session = null

        // PKCE flow: exchange the authorization code for a session
        if (code) {
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) {
            console.error('Code exchange failed:', exchangeError.message)
            setError('Sign-in failed. Please try again.')
            setTimeout(() => router.replace('/login'), 2000)
            return
          }
          session = data.session
        }

        // Fallback: check for an existing session
        if (!session) {
          const { data } = await supabase.auth.getSession()
          session = data.session
        }

        if (session?.user) {
          setUser({
            id: session.user.id,
            email: session.user.email || '',
            name: session.user.user_metadata?.full_name || session.user.email || '',
            avatar_url: session.user.user_metadata?.avatar_url,
          })
          setGuest(false)

          // If onboarding already done (same device), go straight to dashboard
          if (onboardingComplete) {
            router.replace('/sales')
            return
          }

          // onboardingComplete is false — could be new device. Try cloud restore.
          try {
            const state = useStore.getState()
            await restoreAndMerge(
              session.user.id,
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
              }
            )
            const updated = useStore.getState()
            if (updated.businesses.length > 0) {
              updated.setOnboardingComplete(true)
              router.replace('/sales')
              return
            }
          } catch (err) {
            console.error('Cloud restore in callback failed:', err)
          }

          // No cloud data either — genuinely new user
          router.replace('/onboarding')
        } else {
          setError('Could not sign you in. Please try again.')
          setTimeout(() => router.replace('/login'), 2000)
        }
      } catch (err) {
        console.error('Auth callback error:', err)
        setError('Something went wrong. Please try again.')
        setTimeout(() => router.replace('/login'), 2000)
      }
    }

    handleCallback()
  }, [router, setUser, setGuest, onboardingComplete])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center animate-fade-in">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-floin-green to-floin-green-dark shadow-lg shadow-floin-green/20">
          <span className="text-xl font-bold text-white">F</span>
        </div>
        {error ? (
          <p className="mt-3 text-sm font-medium text-floin-red">{error}</p>
        ) : (
          <p className="mt-3 text-sm font-medium text-muted">Signing you in...</p>
        )}
      </div>
    </div>
  )
}
