'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/store'

export default function Home() {
  const router = useRouter()
  const { onboardingComplete } = useStore()

  useEffect(() => {
    if (onboardingComplete) {
      router.replace('/sales')
    } else {
      router.replace('/login')
    }
  }, [onboardingComplete, router])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-4xl font-bold text-floin-green">Floin</div>
    </div>
  )
}
