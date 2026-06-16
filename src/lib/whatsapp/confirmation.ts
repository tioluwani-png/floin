/**
 * Confirmation Workflow
 * Handles the confirm-before-commit pattern for all transactions
 */

import { createClient } from '@supabase/supabase-js'
import { ParsedIntent } from './llm-parser'
import { sendMessage, sendButtonMessage, formatNaira } from './api-client'

// Server-side Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export interface PendingAction {
  id: string
  wa_phone: string
  business_id: string
  action_type: 'sale' | 'expense' | 'debt_payment' | 'withdrawal' | 'correction'
  intent_data: ParsedIntent
  confirmation_message: string
  status: 'pending' | 'confirmed' | 'rejected' | 'expired'
  expires_at: string
  confirmed_at?: string
  committed_record_id?: string
  created_at: string
}

/**
 * Create a pending action that requires user confirmation
 */
export async function createPendingAction(
  waPhone: string,
  businessId: string,
  intent: ParsedIntent
): Promise<{ success: boolean; pendingId?: string; error?: string }> {
  try {
    // Determine action type from intent
    let actionType: 'sale' | 'expense' | 'debt_payment' | 'withdrawal' | 'correction'

    if (intent.intent === 'sale') {
      actionType = 'sale'
    } else if (intent.intent === 'expense') {
      actionType = 'expense'
    } else if (intent.intent === 'debt_payment') {
      actionType = 'debt_payment'
    } else if (intent.intent === 'withdrawal') {
      actionType = 'withdrawal'
    } else {
      return {
        success: false,
        error: 'Cannot create pending action for non-transaction intent'
      }
    }

    // Generate confirmation message
    const confirmationMessage = formatConfirmationMessage(intent, actionType)

    // Create pending action
    const pendingId = generateId()
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour from now

    const { error: insertError } = await supabase
      .from('whatsapp_pending_actions')
      .insert({
        id: pendingId,
        wa_phone: waPhone,
        business_id: businessId,
        action_type: actionType,
        intent_data: intent,
        confirmation_message: confirmationMessage,
        status: 'pending',
        expires_at: expiresAt.toISOString()
      })

    if (insertError) {
      console.error('Failed to create pending action:', insertError)
      return { success: false, error: insertError.message }
    }

    // Send confirmation message to user
    const sendResult = await sendButtonMessage(
      waPhone,
      confirmationMessage,
      [
        { id: `confirm_${pendingId}`, title: '✅ Confirm' },
        { id: `cancel_${pendingId}`, title: '❌ Cancel' }
      ]
    )

    if (!sendResult.success) {
      // Fallback to simple text message if buttons fail
      await sendMessage(
        waPhone,
        confirmationMessage + '\n\nReply "Yes" to confirm or "No" to cancel.'
      )
    }

    return {
      success: true,
      pendingId
    }

  } catch (error) {
    console.error('Error creating pending action:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Get active pending action for a user
 */
export async function getActivePending(waPhone: string): Promise<PendingAction | null> {
  try {
    const { data, error } = await supabase
      .from('whatsapp_pending_actions')
      .select('*')
      .eq('wa_phone', waPhone)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null
      }
      throw error
    }

    return data as PendingAction
  } catch (error) {
    console.error('Error fetching pending action:', error)
    return null
  }
}

/**
 * Get pending action by ID
 */
export async function getPendingById(pendingId: string): Promise<PendingAction | null> {
  try {
    const { data, error } = await supabase
      .from('whatsapp_pending_actions')
      .select('*')
      .eq('id', pendingId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return null
      }
      throw error
    }

    return data as PendingAction
  } catch (error) {
    console.error('Error fetching pending by ID:', error)
    return null
  }
}

/**
 * Reject/cancel a pending action
 */
export async function rejectPendingAction(
  pendingId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('whatsapp_pending_actions')
      .update({
        status: 'rejected'
      })
      .eq('id', pendingId)

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error rejecting pending action:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Expire old pending actions (called by cron)
 */
export async function expirePendingActions(): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('whatsapp_pending_actions')
      .update({ status: 'expired' })
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString())
      .select()

    if (error) throw error

    return data?.length || 0
  } catch (error) {
    console.error('Error expiring pending actions:', error)
    return 0
  }
}

/**
 * Format confirmation message for user
 */
function formatConfirmationMessage(
  intent: ParsedIntent,
  actionType: 'sale' | 'expense' | 'debt_payment' | 'withdrawal' | 'correction'
): string {
  const amount = formatNaira(intent.amount_kobo)
  const date = formatDate(intent.date)

  if (actionType === 'sale') {
    let message = '📝 *Confirm this sale?*\n\n'
    message += `💰 Amount: ${amount}\n`
    message += `📦 Units: ${intent.units}\n`
    message += `📅 Date: ${date}\n`

    if (intent.note) {
      message += `📌 Note: ${intent.note}\n`
    }

    if (intent.customer_name) {
      message += `\n💳 *Credit Sale*\n`
      message += `Customer: ${intent.customer_name}\n`
      message += `(Customer owes ${amount})`
    }

    return message
  }

  if (actionType === 'expense') {
    let message = '📝 *Confirm this expense?*\n\n'
    message += `💸 Amount: ${amount}\n`
    message += `📅 Date: ${date}\n`

    if (intent.note) {
      message += `📌 Note: ${intent.note}\n`
    }

    return message
  }

  if (actionType === 'debt_payment') {
    let message = '📝 *Confirm payment received?*\n\n'
    message += `💰 Amount: ${amount}\n`
    message += `📅 Date: ${date}\n`

    if (intent.customer_name) {
      message += `👤 From: ${intent.customer_name}\n`
    }

    return message
  }

  if (actionType === 'withdrawal') {
    let message = '📝 *Confirm owner withdrawal?*\n\n'
    message += `💵 Amount: ${amount}\n`
    message += `📅 Date: ${date}\n`
    message += `📌 Note: Personal withdrawal (not business expense)\n\n`
    message += `This will be tracked separately from business expenses.`

    return message
  }

  return `Confirm: ${amount}`
}

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const dateOnly = date.toDateString()
  const todayOnly = today.toDateString()
  const yesterdayOnly = yesterday.toDateString()

  if (dateOnly === todayOnly) {
    return 'Today'
  } else if (dateOnly === yesterdayOnly) {
    return 'Yesterday'
  } else {
    return date.toLocaleDateString('en-NG', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    })
  }
}
