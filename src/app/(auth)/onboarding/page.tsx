'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCloudSync } from '@/hooks/useCloudSync'
import { SALES_CHANNELS, BUSINESS_TYPES, CURRENCIES } from '@/lib/constants'
import { generateId } from '@/lib/utils'
import type { Business } from '@/lib/supabase/types'

type Step = 1 | 2 | 3 | 4

export default function OnboardingPage() {
  const router = useRouter()
  const { user, isGuest, addBusiness, setOnboardingComplete } = useCloudSync()
  const [step, setStep] = useState<Step>(1)

  const [businessName, setBusinessName] = useState('')
  const [businessType, setBusinessType] = useState<'product' | 'service' | 'hybrid'>('product')
  const [selectedChannels, setSelectedChannels] = useState<string[]>(['instagram', 'whatsapp'])
  const [selectedCurrency, setSelectedCurrency] = useState('NGN')

  function toggleChannel(channelId: string) {
    setSelectedChannels((prev) =>
      prev.includes(channelId)
        ? prev.filter((c) => c !== channelId)
        : [...prev, channelId]
    )
  }

  function handleComplete() {
    const business: Business = {
      id: generateId(),
      user_id: isGuest ? 'guest' : user?.id || 'guest',
      name: businessName || 'My Business',
      type: businessType,
      currency: selectedCurrency,
      channels: selectedChannels,
      logo_base64: null,
      created_at: new Date().toISOString(),
    }
    addBusiness(business)
    setOnboardingComplete(true)
    router.push('/sales')
  }

  return (
    <div className="relative flex min-h-screen flex-col px-6 py-10 overflow-hidden">
      {/* Background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-20 -right-20 h-48 w-48 rounded-full bg-floin-green/8 blur-3xl" />
        <div className="absolute bottom-20 -left-20 h-48 w-48 rounded-full bg-floin-purple/8 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-sm">
        {/* Progress bar */}
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-border/60"
            >
              <div
                className={`h-full rounded-full bg-gradient-to-r from-floin-green to-floin-green-dark transition-all duration-500 ease-out ${
                  s <= step ? 'w-full' : 'w-0'
                }`}
              />
            </div>
          ))}
        </div>

        <p className="mt-3 text-xs text-muted">Step {step} of 4</p>

        {/* Step 1: Welcome */}
        {step === 1 && (
          <div className="mt-8 animate-fade-up">
            <h1 className="text-3xl font-bold tracking-tight">
              Welcome to <span className="gradient-text">Floin</span>
            </h1>
            <p className="mt-2 text-sm text-muted-dark leading-relaxed">
              Let&apos;s set up your business in under a minute. Then you&apos;ll never lose track of your money again.
            </p>

            <div className="mt-8 space-y-3 stagger-children">
              <div className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm border border-border/40">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-floin-green-light text-sm">1</span>
                <div>
                  <p className="text-sm font-semibold">Log each sale in 10 seconds</p>
                  <p className="mt-0.5 text-xs text-muted">As orders come in — from DMs, walk-ins, anywhere</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm border border-border/40">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-floin-purple-light text-sm">2</span>
                <div>
                  <p className="text-sm font-semibold">Track expenses as they happen</p>
                  <p className="mt-0.5 text-xs text-muted">Production, logistics, ads — all in one place</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm border border-border/40">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-floin-yellow-light text-sm">3</span>
                <div>
                  <p className="text-sm font-semibold">Get your monthly report — free</p>
                  <p className="mt-0.5 text-xs text-muted">Revenue, profit, margins. Zero math required.</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setStep(2)}
              className="mt-8 w-full rounded-2xl bg-gradient-to-r from-floin-green to-floin-green-dark px-6 py-4 text-sm font-semibold text-white shadow-md shadow-floin-green/20 transition-all hover:shadow-lg active:scale-[0.98]"
            >
              Let&apos;s go
            </button>
          </div>
        )}

        {/* Step 2: Business Name & Type */}
        {step === 2 && (
          <div className="mt-8 animate-fade-up">
            <h1 className="text-3xl font-bold tracking-tight">Your business</h1>
            <p className="mt-2 text-sm text-muted-dark">What should we call it?</p>

            <div className="mt-6 rounded-2xl bg-white p-4 shadow-sm border border-border/40">
              <label className="text-xs font-medium text-muted-dark">Business name</label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Relaks, FLU Prints..."
                className="mt-2 w-full rounded-xl border-0 bg-background px-4 py-3 text-sm font-medium outline-none ring-1 ring-border transition-all focus:ring-2 focus:ring-floin-green"
                autoFocus
              />
            </div>

            <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm border border-border/40">
              <label className="text-xs font-medium text-muted-dark">Business type</label>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {BUSINESS_TYPES.map((type) => (
                  <button
                    key={type.id}
                    onClick={() => setBusinessType(type.id as typeof businessType)}
                    className={`rounded-xl px-3 py-3 text-xs font-medium transition-all duration-200 ${
                      businessType === type.id
                        ? 'bg-gradient-to-br from-floin-green to-floin-green-dark text-white shadow-sm'
                        : 'bg-background text-muted-dark ring-1 ring-border hover:ring-floin-green/30'
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm border border-border/40">
              <label className="text-xs font-medium text-muted-dark">Currency</label>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {CURRENCIES.map((cur) => (
                  <button
                    key={cur.code}
                    onClick={() => setSelectedCurrency(cur.code)}
                    className={`flex items-center gap-2.5 rounded-xl px-3 py-3 text-xs font-medium transition-all duration-200 ${
                      selectedCurrency === cur.code
                        ? 'bg-gradient-to-br from-floin-green to-floin-green-dark text-white shadow-sm'
                        : 'bg-background text-muted-dark ring-1 ring-border hover:ring-floin-green/30'
                    }`}
                  >
                    <span className="text-sm font-bold">{cur.symbol}</span>
                    {cur.code}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setStep(3)}
              className="mt-8 w-full rounded-2xl bg-gradient-to-r from-floin-green to-floin-green-dark px-6 py-4 text-sm font-semibold text-white shadow-md shadow-floin-green/20 transition-all hover:shadow-lg active:scale-[0.98]"
            >
              Next
            </button>
          </div>
        )}

        {/* Step 3: Sales Channels */}
        {step === 3 && (
          <div className="mt-8 animate-fade-up">
            <h1 className="text-3xl font-bold tracking-tight">Where do you sell?</h1>
            <p className="mt-2 text-sm text-muted-dark">Pick your primary sales channels.</p>

            <div className="mt-6 grid grid-cols-2 gap-2 stagger-children">
              {SALES_CHANNELS.map((channel) => (
                <button
                  key={channel.id}
                  onClick={() => toggleChannel(channel.id)}
                  className={`flex items-center gap-2.5 rounded-2xl px-4 py-3.5 text-xs font-medium transition-all duration-200 ${
                    selectedChannels.includes(channel.id)
                      ? 'bg-gradient-to-br from-floin-green to-floin-green-dark text-white shadow-sm shadow-floin-green/20'
                      : 'bg-white text-muted-dark ring-1 ring-border/60 hover:ring-floin-green/30 shadow-sm'
                  }`}
                >
                  <span className="text-base">{channel.icon}</span>
                  {channel.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setStep(4)}
              disabled={selectedChannels.length === 0}
              className="mt-8 w-full rounded-2xl bg-gradient-to-r from-floin-green to-floin-green-dark px-6 py-4 text-sm font-semibold text-white shadow-md shadow-floin-green/20 transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
            >
              Next
            </button>
          </div>
        )}

        {/* Step 4: Ready */}
        {step === 4 && (
          <div className="mt-8 animate-fade-up">
            <div className="text-center">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-floin-green-light animate-pulse-glow">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-8 w-8 text-floin-green">
                  <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" />
                </svg>
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight">You&apos;re all set!</h1>
              <p className="mt-2 text-sm text-muted-dark">
                Start logging your first sale — it takes 10 seconds.
              </p>
            </div>

            <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm border border-border/40">
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted">Business</span>
                  <span className="font-semibold">{businessName || 'My Business'}</span>
                </div>
                <div className="h-px bg-border/50" />
                <div className="flex items-center justify-between">
                  <span className="text-muted">Type</span>
                  <span className="font-medium capitalize">{businessType}</span>
                </div>
                <div className="h-px bg-border/50" />
                <div className="flex items-center justify-between">
                  <span className="text-muted">Channels</span>
                  <span className="font-medium">{selectedChannels.length} selected</span>
                </div>
                <div className="h-px bg-border/50" />
                <div className="flex items-center justify-between">
                  <span className="text-muted">Currency</span>
                  <span className="font-medium">{selectedCurrency} ({CURRENCIES.find(c => c.code === selectedCurrency)?.symbol})</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleComplete}
              className="mt-8 w-full rounded-2xl bg-gradient-to-r from-floin-green to-floin-green-dark px-6 py-4 text-sm font-semibold text-white shadow-md shadow-floin-green/20 transition-all hover:shadow-lg active:scale-[0.98]"
            >
              Start logging sales
            </button>

            <button
              onClick={() => setStep(2)}
              className="mt-3 w-full py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
            >
              Go back and edit
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
