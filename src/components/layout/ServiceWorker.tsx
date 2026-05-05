'use client'

import { useEffect } from 'react'

export function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        // Check for a new service worker on every page load
        reg.update()
      }).catch(() => {
        // SW registration failed — app still works without it
      })
    }
  }, [])

  return null
}
