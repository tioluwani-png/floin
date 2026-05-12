'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { useStore } from '@/store'
import { signInWithGoogle } from '@/lib/supabase/auth'
import {
  fetchInviteByToken,
  addBusinessMember,
  fetchBusinessMembers,
} from '@/lib/supabase/teams'
import {
  fetchSales,
  fetchAllExpenseMonths,
  fetchExpenseOthers,
  fetchProducts,
} from '@/lib/supabase/db'
import type { Business, BusinessInvite } from '@/lib/supabase/types'

export default function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const handled = useRef(false)

  const { user, isGuest } = useStore()

  const [invite, setInvite] = useState<(BusinessInvite & { businessName?: string }) | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'joining' | 'done' | 'error' | 'already-member' | 'is-owner'>('loading')
  const [errorMessage, setErrorMessage] = useState('')

  // Load the invite details
  useEffect(() => {
    if (handled.current) return
    handled.current = true

    async function loadInvite() {
      try {
        const inv = await fetchInviteByToken(token)
        if (!inv || !inv.is_active) {
          setStatus('error')
          setErrorMessage('This invite link is no longer valid.')
          return
        }

        // Fetch the business name
        if (supabase) {
          const { data: biz } = await supabase
            .from('businesses')
            .select('name')
            .eq('id', inv.business_id)
            .single()
          const bizData = biz as { name: string } | null
          setInvite({ ...inv, businessName: bizData?.name || 'a business' })
        } else {
          setInvite({ ...inv, businessName: 'a business' })
        }

        // Check if user is already a member or owner
        if (user && !isGuest) {
          // Check if user owns this business
          if (supabase) {
            const { data: biz } = await supabase
              .from('businesses')
              .select('user_id')
              .eq('id', inv.business_id)
              .single()
            const bizData = biz as { user_id: string } | null
            if (bizData?.user_id === user.id) {
              setStatus('is-owner')
              return
            }
          }

          // Check if already a member
          const members = await fetchBusinessMembers(inv.business_id)
          if (members.some(m => m.user_id === user.id)) {
            setStatus('already-member')
            return
          }
        }

        setStatus('ready')
      } catch (err) {
        console.error('Failed to load invite:', err)
        setStatus('error')
        setErrorMessage('Failed to load invite. Please try again.')
      }
    }

    loadInvite()
  }, [token, user, isGuest])

  async function handleSignIn() {
    sessionStorage.setItem('pending-invite-token', token)
    try {
      await signInWithGoogle()
    } catch (err) {
      console.error('Sign in failed:', err)
    }
  }

  async function handleJoin() {
    if (!user || !invite) return
    setStatus('joining')

    try {
      // Add as member
      await addBusinessMember({
        id: crypto.randomUUID(),
        business_id: invite.business_id,
        user_id: user.id,
        role: 'member',
        user_email: user.email || null,
        user_name: user.name || null,
        user_avatar_url: user.avatar_url || null,
      })

      // Fetch the business and its data
      if (supabase) {
        const { data } = await supabase
          .from('businesses')
          .select('*')
          .eq('id', invite.business_id)
          .single()
        const biz = data as unknown as Business | null

        if (biz) {
          const store = useStore.getState()

          // Add business to local store
          store.addBusiness(biz)

          // Update memberRoles
          store.setMemberRoles({
            ...store.memberRoles,
            [biz.id]: 'member',
          })

          // Fetch and merge child data
          const [sales, expenseMonths, products] = await Promise.all([
            fetchSales(biz.id),
            fetchAllExpenseMonths(biz.id),
            fetchProducts(biz.id),
          ])

          store.setSales([...store.sales, ...sales])
          store.setExpenseMonths([...store.expenseMonths, ...expenseMonths])
          store.setProducts([...store.products, ...products])

          // Fetch expense others
          if (expenseMonths.length > 0) {
            const othersArrays = await Promise.all(
              expenseMonths.map(em => fetchExpenseOthers(em.id))
            )
            const allOthers = othersArrays.flat()
            if (allOthers.length > 0) {
              store.setExpenseOthers([...store.expenseOthers, ...allOthers])
            }
          }

          store.setOnboardingComplete(true)
        }
      }

      setStatus('done')
      setTimeout(() => router.replace('/sales'), 1000)
    } catch (err) {
      console.error('Failed to join business:', err)
      setStatus('error')
      setErrorMessage('Failed to join. Please try again.')
    }
  }

  const isSignedIn = !!user && !isGuest

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6">
      {/* Background decoration */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -right-32 h-64 w-64 rounded-full bg-floin-green/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 h-64 w-64 rounded-full bg-floin-purple/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm animate-fade-up">
        {/* Logo */}
        <div className="text-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-floin-green to-floin-green-dark shadow-lg shadow-floin-green/20">
            <span className="text-2xl font-bold text-white">F</span>
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight">Floin</h1>
        </div>

        <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm border border-border/50">
          {status === 'loading' && (
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-floin-green border-t-transparent" />
              <p className="mt-3 text-sm text-muted">Loading invite...</p>
            </div>
          )}

          {status === 'ready' && invite && (
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-floin-green-light">
                <svg className="h-6 w-6 text-floin-green" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
              </div>
              <h2 className="mt-3 text-lg font-bold">Join {invite.businessName}</h2>
              <p className="mt-1.5 text-sm text-muted">
                You&apos;ve been invited to collaborate on this business. You&apos;ll be able to view, add, edit, and delete sales, expenses, and products.
              </p>

              {isSignedIn ? (
                <button
                  onClick={handleJoin}
                  className="mt-5 w-full rounded-2xl bg-gradient-to-r from-floin-green to-floin-green-dark px-6 py-4 text-sm font-semibold text-white shadow-md shadow-floin-green/20 transition-all duration-200 hover:shadow-lg active:scale-[0.98]"
                >
                  Join business
                </button>
              ) : (
                <button
                  onClick={handleSignIn}
                  className="mt-5 flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-6 py-4 text-sm font-semibold shadow-sm border border-border/50 transition-all duration-200 hover:shadow-md active:scale-[0.98]"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Sign in with Google to join
                </button>
              )}
            </div>
          )}

          {status === 'joining' && (
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-floin-green border-t-transparent" />
              <p className="mt-3 text-sm text-muted">Joining business...</p>
            </div>
          )}

          {status === 'done' && (
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-floin-green-light">
                <svg className="h-6 w-6 text-floin-green" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <h2 className="mt-3 text-lg font-bold">You&apos;re in!</h2>
              <p className="mt-1.5 text-sm text-muted">Redirecting to dashboard...</p>
            </div>
          )}

          {status === 'already-member' && (
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-floin-green-light">
                <svg className="h-6 w-6 text-floin-green" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <h2 className="mt-3 text-lg font-bold">Already a member</h2>
              <p className="mt-1.5 text-sm text-muted">You already have access to this business.</p>
              <button
                onClick={() => router.replace('/sales')}
                className="mt-5 w-full rounded-2xl bg-gradient-to-r from-floin-green to-floin-green-dark px-6 py-4 text-sm font-semibold text-white shadow-md shadow-floin-green/20 transition-all duration-200 hover:shadow-lg active:scale-[0.98]"
              >
                Go to dashboard
              </button>
            </div>
          )}

          {status === 'is-owner' && (
            <div className="text-center">
              <h2 className="mt-1 text-lg font-bold">This is your business</h2>
              <p className="mt-1.5 text-sm text-muted">You own this business — no need to join.</p>
              <button
                onClick={() => router.replace('/sales')}
                className="mt-5 w-full rounded-2xl bg-gradient-to-r from-floin-green to-floin-green-dark px-6 py-4 text-sm font-semibold text-white shadow-md shadow-floin-green/20 transition-all duration-200 hover:shadow-lg active:scale-[0.98]"
              >
                Go to dashboard
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-floin-red-light">
                <svg className="h-6 w-6 text-floin-red" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="mt-3 text-lg font-bold">Invalid invite</h2>
              <p className="mt-1.5 text-sm text-muted">{errorMessage}</p>
              <button
                onClick={() => router.replace('/login')}
                className="mt-5 w-full rounded-2xl border border-border/50 px-6 py-4 text-sm font-semibold shadow-sm transition-all duration-200 hover:shadow-md active:scale-[0.98]"
              >
                Go to Floin
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
