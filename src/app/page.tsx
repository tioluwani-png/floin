'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/store'

export default function Home() {
  const router = useRouter()
  const { onboardingComplete } = useStore()

  useEffect(() => {
    // StoreHydration ensures Zustand is fully hydrated before this renders,
    // so onboardingComplete reflects the real persisted value
    if (onboardingComplete) {
      router.replace('/sales')
    } else {
      router.replace('/login')
    }
  }, [onboardingComplete, router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center animate-fade-in">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-floin-green to-floin-green-dark shadow-lg shadow-floin-green/20">
          <span className="text-xl font-bold text-white">F</span>
        </div>
      </div>
    </div>
  )
}
