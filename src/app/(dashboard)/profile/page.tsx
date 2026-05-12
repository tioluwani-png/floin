'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/store'
import { useCloudSync } from '@/hooks/useCloudSync'
import { signOut } from '@/lib/supabase/auth'
import { restoreAndMerge } from '@/lib/supabase/restore'
import { SALES_CHANNELS, BUSINESS_TYPES, CURRENCIES, getCurrency } from '@/lib/constants'
import { generateId } from '@/lib/utils'
import { compressImage } from '@/lib/imageUtils'
import {
  createInvite,
  fetchActiveInvite,
  revokeInvite,
  fetchBusinessMembers,
  removeBusinessMember,
} from '@/lib/supabase/teams'
import type { Business, Product, BusinessMember, BusinessInvite } from '@/lib/supabase/types'

export default function ProfilePage() {
  const router = useRouter()
  const {
    user, isGuest, business, businesses,
    setBusiness, addBusiness, switchBusiness, removeBusiness,
    products, addProduct, deleteProduct,
    setUser, setGuest,
    setSales, setExpenseMonths, setExpenseOthers, setProducts,
  } = useCloudSync()
  const { memberRoles, setMemberRoles } = useStore()

  const [name, setName] = useState(business?.name || '')
  const [type, setType] = useState(business?.type || 'product')
  const [channels, setChannels] = useState<string[]>(business?.channels || [])
  const [productName, setProductName] = useState('')
  const [productPrice, setProductPrice] = useState('')
  const [showProductForm, setShowProductForm] = useState(false)
  const [showNewBusiness, setShowNewBusiness] = useState(false)
  const [newBizName, setNewBizName] = useState('')
  const [newBizType, setNewBizType] = useState<'product' | 'service' | 'hybrid'>('product')
  const [newBizChannels, setNewBizChannels] = useState<string[]>(['instagram', 'whatsapp'])
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [newBizCurrency, setNewBizCurrency] = useState('NGN')
  const [restoring, setRestoring] = useState(false)
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null)

  // Team state
  const [members, setMembers] = useState<BusinessMember[]>([])
  const [activeInvite, setActiveInvite] = useState<BusinessInvite | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null)
  const [leavingBusiness, setLeavingBusiness] = useState(false)

  const isOwner = business ? (business.user_id === user?.id || memberRoles[business.id] === 'owner') : false
  const isMember = business ? memberRoles[business.id] === 'member' : false

  // Load team members and invite when business changes
  useEffect(() => {
    if (!business || isGuest || !user) {
      setMembers([])
      setActiveInvite(null)
      return
    }

    let cancelled = false

    async function loadTeamData() {
      try {
        const [memberList, invite] = await Promise.all([
          fetchBusinessMembers(business!.id),
          isOwner ? fetchActiveInvite(business!.id) : Promise.resolve(null),
        ])
        if (cancelled) return
        setMembers(memberList)
        setActiveInvite(invite)
      } catch (err) {
        console.error('Failed to load team data:', err)
      }
    }

    loadTeamData()
    return () => { cancelled = true }
  }, [business?.id, isGuest, user, isOwner])

  const businessProducts = products.filter(p => p.business_id === business?.id)
  const activeCurrency = getCurrency(business?.currency)

  function toggleChannel(id: string) {
    const updated = channels.includes(id) ? channels.filter((c) => c !== id) : [...channels, id]
    setChannels(updated)
    if (business) setBusiness({ ...business, channels: updated })
  }

  function handleSaveProfile() {
    if (business) {
      setBusiness({ ...business, name: name || business.name, type: type as 'product' | 'service' | 'hybrid', channels })
    }
  }

  function handleAddProduct(e: React.FormEvent) {
    e.preventDefault()
    if (!productName || !productPrice) return
    const product: Product = { id: generateId(), business_id: business?.id || 'guest', name: productName, price: parseFloat(productPrice), created_at: new Date().toISOString() }
    addProduct(product)
    setProductName('')
    setProductPrice('')
    setShowProductForm(false)
  }

  function handleSwitchBusiness(id: string) {
    const biz = businesses.find(b => b.id === id)
    if (!biz) return
    switchBusiness(id)
    setName(biz.name)
    setType(biz.type)
    setChannels(biz.channels)
  }

  function handleCreateBusiness() {
    if (!newBizName.trim()) return
    const biz: Business = {
      id: generateId(),
      user_id: isGuest ? 'guest' : user?.id || 'guest',
      name: newBizName.trim(),
      type: newBizType,
      currency: newBizCurrency,
      channels: newBizChannels,
      logo_base64: null,
      created_at: new Date().toISOString(),
    }
    addBusiness(biz)
    setName(biz.name)
    setType(biz.type)
    setChannels(biz.channels)
    setNewBizName('')
    setNewBizType('product')
    setNewBizChannels(['instagram', 'whatsapp'])
    setNewBizCurrency('NGN')
    setShowNewBusiness(false)
  }

  function handleDeleteBusiness(id: string) {
    removeBusiness(id)
    setShowDeleteConfirm(null)
    const remaining = businesses.filter(b => b.id !== id)
    if (remaining.length > 0) {
      setName(remaining[0].name)
      setType(remaining[0].type)
      setChannels(remaining[0].channels)
    }
  }

  function toggleNewBizChannel(id: string) {
    setNewBizChannels(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    )
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !business) return
    try {
      const base64 = await compressImage(file, 200, 0.8)
      setBusiness({ ...business, logo_base64: base64 })
    } catch {
      // silently fail
    }
    e.target.value = ''
  }

  async function handleLogout() {
    try { await signOut() } catch {}
    setUser(null)
    setGuest(true)
    router.push('/login')
  }

  async function handleRestoreFromCloud() {
    if (!user || isGuest) return
    setRestoring(true)
    setRestoreMessage(null)
    try {
      const state = useStore.getState()
      await restoreAndMerge(
        user.id,
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
          s.setMemberRoles(merged.memberRoles)
        }
      )
      setRestoreMessage('Data restored successfully!')
    } catch (err) {
      setRestoreMessage('Failed to restore. Please try again.')
      console.error(err)
    } finally {
      setRestoring(false)
      setTimeout(() => setRestoreMessage(null), 3000)
    }
  }

  async function handleGenerateInvite() {
    if (!business || !user) return
    setInviteLoading(true)
    try {
      const invite = await createInvite(business.id, user.id)
      setActiveInvite(invite)
    } catch (err) {
      console.error('Failed to create invite:', err)
    } finally {
      setInviteLoading(false)
    }
  }

  async function handleCopyInvite() {
    if (!activeInvite) return
    const url = `${window.location.origin}/invite/${activeInvite.token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: select text
    }
  }

  async function handleRevokeInvite() {
    if (!activeInvite) return
    try {
      await revokeInvite(activeInvite.id)
      setActiveInvite(null)
    } catch (err) {
      console.error('Failed to revoke invite:', err)
    }
  }

  async function handleRemoveMember(memberId: string) {
    setRemovingMemberId(memberId)
    try {
      await removeBusinessMember(memberId)
      setMembers(prev => prev.filter(m => m.id !== memberId))
    } catch (err) {
      console.error('Failed to remove member:', err)
    } finally {
      setRemovingMemberId(null)
    }
  }

  async function handleLeaveBusiness() {
    if (!business || !user) return
    setLeavingBusiness(true)
    try {
      const myMembership = members.find(m => m.user_id === user.id)
      if (myMembership) {
        await removeBusinessMember(myMembership.id)
      }
      // Remove from local store
      const updatedRoles = { ...memberRoles }
      delete updatedRoles[business.id]
      setMemberRoles(updatedRoles)
      removeBusiness(business.id)
    } catch (err) {
      console.error('Failed to leave business:', err)
    } finally {
      setLeavingBusiness(false)
    }
  }

  return (
    <div className="animate-fade-up">
      {/* Header with user info and sign-out */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-floin-green to-floin-green-dark shadow-sm shadow-floin-green/20">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" className="h-12 w-12 rounded-2xl object-cover" />
            ) : (
              <span className="text-lg font-bold text-white">
                {(user?.name || business?.name || 'F')[0].toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">{user?.name || 'Guest User'}</h1>
            <p className="text-xs text-muted">
              {isGuest ? 'Guest mode' : user?.email}
            </p>
          </div>
        </div>
        {!isGuest ? (
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-xl bg-floin-red-light px-3 py-2 text-xs font-semibold text-floin-red transition-all hover:bg-floin-red/20 active:scale-95"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M2 4.75A2.75 2.75 0 0 1 4.75 2h3a2.75 2.75 0 0 1 2.75 2.75v.5a.75.75 0 0 1-1.5 0v-.5c0-.69-.56-1.25-1.25-1.25h-3c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h3c.69 0 1.25-.56 1.25-1.25v-.5a.75.75 0 0 1 1.5 0v.5A2.75 2.75 0 0 1 7.75 14h-3A2.75 2.75 0 0 1 2 11.25v-6.5Zm9.47.47a.75.75 0 0 1 1.06 0l2.25 2.25a.75.75 0 0 1 0 1.06l-2.25 2.25a.75.75 0 1 1-1.06-1.06l.97-.97H5.75a.75.75 0 0 1 0-1.5h6.69l-.97-.97a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
            Sign out
          </button>
        ) : (
          <button
            onClick={() => router.push('/login')}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-floin-green to-floin-green-dark px-3 py-2 text-xs font-semibold text-white shadow-sm transition-all active:scale-95"
          >
            Sign in
          </button>
        )}
      </div>

      {/* Business switcher */}
      <div className="mt-5 rounded-2xl bg-white p-4 shadow-sm border border-border/40">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted">My Businesses</h3>
          <button
            onClick={() => setShowNewBusiness(!showNewBusiness)}
            className="rounded-lg bg-floin-green-light px-2.5 py-1 text-xs font-semibold text-floin-green-dark transition-colors hover:bg-floin-green/20"
          >
            {showNewBusiness ? 'Cancel' : '+ New'}
          </button>
        </div>

        {/* Business list */}
        <div className="mt-3 space-y-1.5">
          {businesses.map((biz) => (
            <div key={biz.id}>
              <div
                className={`flex items-center justify-between rounded-xl p-3 transition-all duration-200 ${
                  biz.id === business?.id
                    ? 'bg-gradient-to-r from-floin-green/10 to-floin-green-dark/5 ring-1 ring-floin-green/30'
                    : 'bg-background hover:bg-background/80'
                }`}
              >
                <button
                  onClick={() => handleSwitchBusiness(biz.id)}
                  className="flex items-center gap-2.5 text-left flex-1 min-w-0"
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                    biz.id === business?.id
                      ? 'bg-floin-green text-white'
                      : 'bg-white text-muted-dark ring-1 ring-border'
                  }`}>
                    {biz.name[0].toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-sm font-medium truncate ${biz.id === business?.id ? 'text-floin-green-dark' : ''}`}>
                      {biz.name}
                    </p>
                    <p className="text-[10px] text-muted capitalize">{biz.type}</p>
                  </div>
                </button>
                {biz.id === business?.id && (
                  <span className="shrink-0 rounded-full bg-floin-green px-2 py-0.5 text-[10px] font-bold text-white">
                    Active
                  </span>
                )}
                {memberRoles[biz.id] === 'member' && biz.id !== business?.id && (
                  <span className="shrink-0 rounded-full bg-floin-purple-light px-2 py-0.5 text-[10px] font-bold text-floin-purple">
                    Shared
                  </span>
                )}
                {businesses.length > 1 && biz.id !== business?.id && (
                  <button
                    onClick={() => setShowDeleteConfirm(biz.id)}
                    className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-floin-red-light hover:text-floin-red transition-colors"
                    aria-label="Delete business"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                      <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5Z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
              </div>
              {/* Delete confirmation */}
              {showDeleteConfirm === biz.id && (
                <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-floin-red-light/60 p-3 animate-scale-in">
                  <p className="flex-1 text-xs text-floin-red">Delete &quot;{biz.name}&quot;? Data for this business won&apos;t be removed.</p>
                  <button onClick={() => handleDeleteBusiness(biz.id)} className="rounded-lg bg-floin-red px-2.5 py-1 text-xs font-bold text-white">Delete</button>
                  <button onClick={() => setShowDeleteConfirm(null)} className="rounded-lg px-2.5 py-1 text-xs font-medium text-muted-dark">Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add new business form */}
        {showNewBusiness && (
          <div className="mt-3 rounded-xl bg-background p-4 animate-scale-in space-y-3">
            <input
              type="text"
              value={newBizName}
              onChange={(e) => setNewBizName(e.target.value)}
              placeholder="Business name"
              className="w-full rounded-xl bg-white px-4 py-3 text-sm font-medium outline-none ring-1 ring-border transition-all focus:ring-2 focus:ring-floin-green"
              autoFocus
            />
            <div>
              <label className="text-xs font-medium text-muted-dark">Type</label>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {BUSINESS_TYPES.map((bt) => (
                  <button
                    key={bt.id}
                    type="button"
                    onClick={() => setNewBizType(bt.id as typeof newBizType)}
                    className={`rounded-lg px-2 py-2 text-xs font-medium transition-all ${
                      newBizType === bt.id
                        ? 'bg-floin-green text-white'
                        : 'bg-white text-muted-dark ring-1 ring-border'
                    }`}
                  >
                    {bt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-dark">Currency</label>
              <div className="mt-1.5 grid grid-cols-4 gap-1">
                {CURRENCIES.map((cur) => (
                  <button
                    key={cur.code}
                    type="button"
                    onClick={() => setNewBizCurrency(cur.code)}
                    className={`rounded-lg px-2 py-1.5 text-[10px] font-medium transition-all ${
                      newBizCurrency === cur.code
                        ? 'bg-floin-green text-white'
                        : 'bg-white text-muted-dark ring-1 ring-border'
                    }`}
                  >
                    {cur.symbol} {cur.code}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-dark">Channels</label>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {SALES_CHANNELS.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => toggleNewBizChannel(ch.id)}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-medium transition-all ${
                      newBizChannels.includes(ch.id)
                        ? 'bg-floin-green text-white'
                        : 'bg-white text-muted-dark ring-1 ring-border'
                    }`}
                  >
                    <span className="text-xs">{ch.icon}</span>
                    {ch.label}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={handleCreateBusiness}
              disabled={!newBizName.trim()}
              className="w-full rounded-xl bg-gradient-to-r from-floin-green to-floin-green-dark py-3 text-sm font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-40"
            >
              Create business
            </button>
          </div>
        )}
      </div>

      {/* Active business details */}
      {business && (
        <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm border border-border/40">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Business details</h3>

          {/* Logo upload */}
          <div className="mt-4 flex items-center gap-4">
            <div className="relative">
              {business.logo_base64 ? (
                <img src={business.logo_base64} alt="Logo" className="h-16 w-16 rounded-2xl object-cover ring-2 ring-border/40" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-floin-green to-floin-green-dark text-xl font-bold text-white">
                  {business.name[0]?.toUpperCase() || 'B'}
                </div>
              )}
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-muted-dark">Business logo</p>
              <p className="text-[10px] text-muted">Appears in your PDF reports</p>
              <div className="mt-2 flex gap-2">
                <label className="cursor-pointer rounded-lg bg-floin-green-light px-3 py-1.5 text-xs font-semibold text-floin-green-dark transition-colors hover:bg-floin-green/20">
                  {business.logo_base64 ? 'Change' : 'Upload'}
                  <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                </label>
                {business.logo_base64 && (
                  <button
                    onClick={() => setBusiness({ ...business, logo_base64: null })}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:text-floin-red hover:bg-floin-red-light transition-all"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <label className="text-xs font-medium text-muted-dark">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleSaveProfile}
              placeholder="Business name"
              className="mt-1.5 w-full rounded-xl bg-background px-4 py-3 text-sm font-medium outline-none ring-1 ring-border transition-all focus:ring-2 focus:ring-floin-green"
            />
          </div>

          <div className="mt-4">
            <label className="text-xs font-medium text-muted-dark">Type</label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {BUSINESS_TYPES.map((bt) => (
                <button
                  key={bt.id}
                  onClick={() => { setType(bt.id); if (business) setBusiness({ ...business, type: bt.id as 'product' | 'service' | 'hybrid' }) }}
                  className={`rounded-xl px-2 py-2.5 text-xs font-medium transition-all duration-200 ${
                    type === bt.id
                      ? 'bg-gradient-to-br from-floin-green to-floin-green-dark text-white shadow-sm'
                      : 'bg-background text-muted-dark ring-1 ring-border'
                  }`}
                >
                  {bt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <label className="text-xs font-medium text-muted-dark">Sales channels</label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SALES_CHANNELS.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => toggleChannel(ch.id)}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all duration-200 ${
                    channels.includes(ch.id)
                      ? 'bg-gradient-to-r from-floin-green to-floin-green-dark text-white shadow-sm'
                      : 'bg-background text-muted-dark ring-1 ring-border'
                  }`}
                >
                  <span className="text-sm">{ch.icon}</span>
                  {ch.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <label className="text-xs font-medium text-muted-dark">Currency</label>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {CURRENCIES.map((cur) => (
                <button
                  key={cur.code}
                  onClick={() => {
                    if (business) setBusiness({ ...business, currency: cur.code })
                  }}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium transition-all duration-200 ${
                    business?.currency === cur.code
                      ? 'bg-gradient-to-r from-floin-green to-floin-green-dark text-white shadow-sm'
                      : 'bg-background text-muted-dark ring-1 ring-border'
                  }`}
                >
                  <span className="font-bold">{cur.symbol}</span>
                  {cur.code}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Team section */}
      {business && !isGuest && user && (
        <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm border border-border/40">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Team</h3>
            {memberRoles[business.id] === 'member' && (
              <span className="rounded-full bg-floin-purple-light px-2 py-0.5 text-[10px] font-bold text-floin-purple">
                Shared with you
              </span>
            )}
          </div>

          {isOwner && (
            <>
              {/* Invite link */}
              <div className="mt-3">
                {activeInvite ? (
                  <div className="rounded-xl bg-background p-3 space-y-2">
                    <p className="text-xs font-medium text-muted-dark">Invite link</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={`${typeof window !== 'undefined' ? window.location.origin : ''}/invite/${activeInvite.token}`}
                        className="flex-1 rounded-lg bg-white px-3 py-2 text-xs text-muted-dark ring-1 ring-border truncate"
                      />
                      <button
                        onClick={handleCopyInvite}
                        className="shrink-0 rounded-lg bg-floin-green-light px-3 py-2 text-xs font-semibold text-floin-green-dark transition-colors hover:bg-floin-green/20"
                      >
                        {copied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <button
                      onClick={handleRevokeInvite}
                      className="text-xs font-medium text-muted hover:text-floin-red transition-colors"
                    >
                      Revoke link
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleGenerateInvite}
                    disabled={inviteLoading}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-floin-green-light px-4 py-3 text-xs font-semibold text-floin-green-dark transition-colors hover:bg-floin-green/20 disabled:opacity-50"
                  >
                    {inviteLoading ? (
                      <>
                        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Generating...
                      </>
                    ) : (
                      <>
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-5.497a4.5 4.5 0 00-6.364 0l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                        </svg>
                        Generate invite link
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Member list */}
              <div className="mt-4">
                <p className="text-xs font-medium text-muted-dark">Members ({members.length + 1})</p>
                <div className="mt-2 space-y-1.5">
                  {/* Owner (always first) */}
                  <div className="flex items-center gap-3 rounded-xl bg-background p-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-floin-green to-floin-green-dark">
                      {user.avatar_url ? (
                        <img src={user.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <span className="text-xs font-bold text-white">{(user.name || 'O')[0].toUpperCase()}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{user.name} (you)</p>
                      <p className="text-[10px] text-muted truncate">{user.email}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-floin-green-light px-2 py-0.5 text-[10px] font-bold text-floin-green-dark">
                      Owner
                    </span>
                  </div>

                  {/* Team members */}
                  {members.map((member) => (
                    <div key={member.id} className="flex items-center gap-3 rounded-xl bg-background p-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-floin-purple-light">
                        {member.user_avatar_url ? (
                          <img src={member.user_avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                        ) : (
                          <span className="text-xs font-bold text-floin-purple">{(member.user_name || 'M')[0].toUpperCase()}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{member.user_name || 'Team member'}</p>
                        <p className="text-[10px] text-muted truncate">{member.user_email || ''}</p>
                      </div>
                      <button
                        onClick={() => handleRemoveMember(member.id)}
                        disabled={removingMemberId === member.id}
                        className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-muted hover:text-floin-red hover:bg-floin-red-light transition-all disabled:opacity-50"
                      >
                        {removingMemberId === member.id ? '...' : 'Remove'}
                      </button>
                    </div>
                  ))}

                  {members.length === 0 && (
                    <p className="text-xs text-muted py-1">No team members yet. Share the invite link to add people.</p>
                  )}
                </div>
              </div>
            </>
          )}

          {isMember && (
            <div className="mt-3">
              <p className="text-xs text-muted">You have full access to this business&apos;s data.</p>
              <button
                onClick={handleLeaveBusiness}
                disabled={leavingBusiness}
                className="mt-3 w-full rounded-xl border-2 border-floin-red/20 py-2.5 text-xs font-semibold text-floin-red transition-all hover:bg-floin-red-light hover:border-floin-red/40 active:scale-[0.98] disabled:opacity-50"
              >
                {leavingBusiness ? 'Leaving...' : 'Leave business'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Product catalogue */}
      <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm border border-border/40">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Product catalogue</h3>
          <button
            onClick={() => setShowProductForm(!showProductForm)}
            className="rounded-lg bg-floin-green-light px-2.5 py-1 text-xs font-semibold text-floin-green-dark transition-colors hover:bg-floin-green/20"
          >
            {showProductForm ? 'Cancel' : '+ Add'}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">Pre-set products for faster sale logging</p>

        {showProductForm && (
          <form onSubmit={handleAddProduct} className="mt-3 flex gap-2 animate-scale-in">
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="Product name"
              className="flex-1 rounded-xl bg-background px-3 py-2.5 text-sm outline-none ring-1 ring-border focus:ring-2 focus:ring-floin-green"
              autoFocus
            />
            <div className="relative w-24">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">{activeCurrency.symbol}</span>
              <input
                type="number"
                value={productPrice}
                onChange={(e) => setProductPrice(e.target.value)}
                placeholder="0"
                min="0"
                className="w-full rounded-xl bg-background py-2.5 pl-6 pr-2 text-sm text-right outline-none ring-1 ring-border focus:ring-2 focus:ring-floin-green"
              />
            </div>
            <button type="submit" disabled={!productName || !productPrice} className="rounded-xl bg-gradient-to-r from-floin-green to-floin-green-dark px-3 text-white font-bold disabled:opacity-40">+</button>
          </form>
        )}

        {businessProducts.length > 0 ? (
          <div className="mt-3 space-y-2">
            {businessProducts.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl bg-background p-3">
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted">{activeCurrency.symbol}{p.price.toLocaleString()}</p>
                </div>
                <button onClick={() => deleteProduct(p.id)} className="text-xs font-medium text-muted hover:text-floin-red transition-all">Remove</button>
              </div>
            ))}
          </div>
        ) : !showProductForm && (
          <p className="mt-3 text-xs text-muted">No products added yet</p>
        )}
      </div>

      {/* Bottom actions */}
      <div className="mt-6 space-y-3">
        {isGuest && (
          <button
            onClick={() => router.push('/login')}
            className="w-full rounded-2xl bg-foreground py-4 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
          >
            Sign in to save your data
          </button>
        )}
        {!isGuest && (
          <div>
            <button
              onClick={handleRestoreFromCloud}
              disabled={restoring}
              className="w-full rounded-2xl bg-gradient-to-r from-floin-purple to-floin-purple-dark py-4 text-sm font-semibold text-white shadow-md shadow-floin-purple/20 transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-60"
            >
              {restoring ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Restoring...
                </span>
              ) : (
                'Restore from cloud'
              )}
            </button>
            {restoreMessage && (
              <p className={`mt-2 text-center text-xs font-medium ${
                restoreMessage.includes('success') ? 'text-floin-green-dark' : 'text-floin-red'
              }`}>
                {restoreMessage}
              </p>
            )}
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full rounded-2xl border-2 border-floin-red/20 py-3.5 text-sm font-semibold text-floin-red transition-all hover:bg-floin-red-light hover:border-floin-red/40 active:scale-[0.98]"
        >
          {isGuest ? 'Clear all data' : 'Sign out'}
        </button>
      </div>
    </div>
  )
}
