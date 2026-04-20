'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/store'

export default function Home() {
  const router = useRouter()
  const { onboardingComplete } = useStore()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Wait a tick for Zustand to hydrate from localStorage
    const timeout = setTimeout(() => setReady(true), 100)
    return () => clearTimeout(timeout)
  }, [])

  useEffect(() => {
    if (!ready) return
    if (onboardingComplete) {
      router.replace('/sales')
    } else {
      router.replace('/login')
    }
  }, [ready, onboardingComplete, router])

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
