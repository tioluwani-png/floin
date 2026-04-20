'use client'

import { useEffect, useState } from 'react'

export function StoreHydration({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center animate-fade-in">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-floin-green to-floin-green-dark shadow-lg shadow-floin-green/20">
            <span className="text-xl font-bold text-white">F</span>
          </div>
          <p className="mt-3 text-sm font-medium text-muted">Loading...</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
