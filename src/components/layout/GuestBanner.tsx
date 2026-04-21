'use client'

import Link from 'next/link'
import { useStore } from '@/store'

export function GuestBanner() {
  const { isGuest } = useStore()

  if (!isGuest) return null

  return (
    <Link
      href="/login"
      className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-floin-purple/10 to-floin-green/10 px-4 py-3 mb-6 border border-floin-purple/20 transition-all hover:shadow-sm"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-floin-purple/10">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 text-floin-purple">
            <path fillRule="evenodd" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7A1.5 1.5 0 0 0 3 8.5v5A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 11.5 7V4.5A3.5 3.5 0 0 0 8 1Zm2 6V4.5a2 2 0 1 0-4 0V7h4Z" clipRule="evenodd" />
          </svg>
        </span>
        <span className="text-xs font-semibold text-foreground">Sign in to save your data</span>
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 text-muted">
        <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
      </svg>
    </Link>
  )
}
