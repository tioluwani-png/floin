import { supabase } from './client'
import type { Business, BusinessMember, BusinessInvite } from './types'

// --- Memberships ---

export async function fetchMemberships(userId: string) {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('business_members')
    .select('*')
    .eq('user_id', userId)
  if (error) throw error
  return (data || []) as unknown as BusinessMember[]
}

export async function fetchBusinessesByIds(ids: string[]) {
  if (!supabase || ids.length === 0) return []
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .in('id', ids)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data || []) as unknown as Business[]
}

export async function fetchBusinessMembers(businessId: string) {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('business_members')
    .select('*')
    .eq('business_id', businessId)
    .order('joined_at', { ascending: true })
  if (error) throw error
  return (data || []) as unknown as BusinessMember[]
}

export async function addBusinessMember(member: Record<string, unknown>) {
  if (!supabase) throw new Error('Supabase not configured')
  const { data, error } = await supabase
    .from('business_members')
    .insert(member as never)
    .select()
    .single()
  if (error) throw error
  return data as unknown as BusinessMember
}

export async function removeBusinessMember(memberId: string) {
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase
    .from('business_members')
    .delete()
    .eq('id', memberId)
  if (error) throw error
}

// --- Invites ---

export async function createInvite(businessId: string, createdBy: string) {
  if (!supabase) throw new Error('Supabase not configured')
  const token = crypto.randomUUID()
  const id = crypto.randomUUID()
  const { data, error } = await supabase
    .from('business_invites')
    .insert({
      id,
      business_id: businessId,
      token,
      created_by: createdBy,
    } as never)
    .select()
    .single()
  if (error) throw error
  return data as unknown as BusinessInvite
}

export async function fetchActiveInvite(businessId: string) {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('business_invites')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return data as unknown as BusinessInvite | null
}

export async function fetchInviteByToken(token: string) {
  if (!supabase) throw new Error('Supabase not configured')
  const { data, error } = await supabase
    .from('business_invites')
    .select('*')
    .eq('token', token)
    .eq('is_active', true)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return data as unknown as BusinessInvite | null
}

export async function revokeInvite(inviteId: string) {
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase
    .from('business_invites')
    .update({ is_active: false } as never)
    .eq('id', inviteId)
  if (error) throw error
}
