'use client'

import { useRouter } from 'next/navigation'
import { signInWithGoogle } from '@/lib/supabase/auth'
import { useStore } from '@/store'

export default function LoginPage() {
  const router = useRouter()
  const { setGuest, setOnboardingComplete, onboardingComplete } = useStore()

  async function handleGoogleSignIn() {
    try {
      await signInWithGoogle()
    } catch (err) {
      console.error('Sign in failed:', err)
    }
  }

  function handleGuestMode() {
    setGuest(true)
    setOnboardingComplete(false)
    router.push('/onboarding')
  }

  function handleSkip() {
    router.back()
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6">
      {/* Background decoration */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -right-32 h-64 w-64 rounded-full bg-floin-green/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 h-64 w-64 rounded-full bg-floin-purple/10 blur-3xl" />
        <div className="absolute top-1/4 left-1/2 h-32 w-32 -translate-x-1/2 rounded-full bg-floin-green/5 blur-2xl" />
      </div>

      <div className="relative w-full max-w-sm animate-fade-up">
        {/* Logo */}
        <div className="text-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-floin-green to-floin-green-dark shadow-lg shadow-floin-green/20">
            <span className="text-2xl font-bold text-white">F</span>
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight">Floin</h1>
          <p className="mt-1.5 text-sm text-muted">Know your numbers. Keep moving.</p>
        </div>

        {/* Value prop cards */}
        <div className="mt-8 grid grid-cols-3 gap-2 stagger-children">
          <div className="rounded-2xl bg-white p-3 text-center shadow-sm border border-border/50">
            <span className="text-xl">⚡</span>
            <p className="mt-1 text-[10px] font-medium text-muted-dark">10-sec logging</p>
          </div>
          <div className="rounded-2xl bg-white p-3 text-center shadow-sm border border-border/50">
            <span className="text-xl">📊</span>
            <p className="mt-1 text-[10px] font-medium text-muted-dark">Auto reports</p>
          </div>
          <div className="rounded-2xl bg-white p-3 text-center shadow-sm border border-border/50">
            <span className="text-xl">🆓</span>
            <p className="mt-1 text-[10px] font-medium text-muted-dark">100% free</p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-8 space-y-3">
          <button
            onClick={handleGoogleSignIn}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-6 py-4 text-sm font-semibold shadow-sm border border-border/50 transition-all duration-200 hover:shadow-md hover:border-border active:scale-[0.98]"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          <button
            onClick={handleGuestMode}
            className="w-full rounded-2xl bg-gradient-to-r from-floin-green to-floin-green-dark px-6 py-4 text-sm font-semibold text-white shadow-md shadow-floin-green/20 transition-all duration-200 hover:shadow-lg hover:shadow-floin-green/30 active:scale-[0.98]"
          >
            Try without an account
          </button>
        </div>

        {onboardingComplete && (
          <button
            onClick={handleSkip}
            className="mt-4 w-full py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
          >
            Go back
          </button>
        )}

        <p className="mt-4 text-center text-xs text-muted">
          No credit card. No spreadsheets. Just clarity.
        </p>
      </div>
    </div>
  )
}
