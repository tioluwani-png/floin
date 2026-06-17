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
  action_type: 'sale' | 'expense' | 'debt_payment' | 'withdrawal' | 'correction' | 'clarifying' | 'loan_given' | 'write_off' | 'delete_entry' | 'edit_entry'
  intent_data: any  // Can be ParsedIntent or custom data for new action types
  partial_parse?: Partial<ParsedIntent>  // For clarification context
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
    // Determine action type from new intent types
    let actionType: 'sale' | 'expense' | 'debt_payment' | 'withdrawal' | 'correction' | 'clarifying' | 'loan_given' | 'write_off' | 'delete_entry' | 'edit_entry'

    if (intent.intent === 'log_sale' || intent.intent === 'log_sale_credit') {
      actionType = 'sale'
    } else if (intent.intent === 'log_expense') {
      actionType = 'expense'
    } else if (intent.intent === 'log_payment_received') {
      actionType = 'debt_payment'
    } else if (intent.intent === 'log_owner_withdrawal') {
      actionType = 'withdrawal'
    } else if (intent.intent === 'log_loan_given') {
      actionType = 'loan_given'
    } else if (intent.intent === 'correction') {
      actionType = 'correction'
    } else if (intent.intent === 'write_off_debt') {
      actionType = 'write_off'
    } else if (intent.intent === 'delete_entry') {
      actionType = 'delete_entry'
    } else if (intent.intent === 'edit_entry') {
      actionType = 'edit_entry'
    } else {
      // NON-TRANSACTION INTENT - Should not create pending action
      // Return error that will be handled gracefully by router
      return {
        success: false,
        error: 'Cannot create pending action for non-transaction intent'
      }
    }

    // Generate confirmation message
    const confirmationMessage = formatConfirmationMessage(intent, actionType)

    // Create pending action
    const pendingId = generateId()
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now

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
        confirmationMessage + '\n\nReply *1* to save ✅  or  *2* to cancel ❌'
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
  actionType: 'sale' | 'expense' | 'debt_payment' | 'withdrawal' | 'correction' | 'loan_given' | 'write_off' | 'delete_entry' | 'edit_entry'
): string {
  // Calculate total from items
  const totalKobo = intent.items.reduce((sum, item) => {
    if (!item.amount_kobo) return sum
    const itemTotal = item.amount_basis === 'unit' && item.qty
      ? item.amount_kobo * item.qty
      : item.amount_kobo
    return sum + itemTotal
  }, 0)

  const amount = formatNaira(totalKobo || intent.amount_kobo || 0)
  const date = formatDate(intent.time_ref || 'today')

  if (actionType === 'sale') {
    let message = '📝 *Confirm this sale?*\n\n'

    // Show items
    if (intent.items.length > 0) {
      intent.items.forEach(item => {
        if (item.kind === 'sale') {
          const itemAmount = item.amount_basis === 'unit' && item.qty
            ? item.amount_kobo! * item.qty
            : item.amount_kobo || 0
          message += `📦 ${item.qty || ''} ${item.description || 'item'}: ${formatNaira(itemAmount)}\n`
        }
      })
      message += `\n💰 Total: ${amount}\n`
    } else {
      message += `💰 Amount: ${amount}\n`
    }

    message += `📅 Date: ${date}\n`

    if (intent.note) {
      message += `📌 ${intent.note}\n`
    }

    if (intent.party) {
      message += `\n💳 *Credit Sale*\n`
      message += `Customer: ${intent.party}\n`
      message += `(${intent.party} owes ${amount})`
    }

    return message
  }

  if (actionType === 'expense') {
    let message = '📝 *Confirm this expense?*\n\n'
    message += `💸 Amount: ${amount}\n`
    message += `📅 Date: ${date}\n`

    if (intent.note || (intent.items.length > 0 && intent.items[0].description)) {
      message += `📌 ${intent.note || intent.items[0].description}\n`
    }

    return message
  }

  if (actionType === 'debt_payment') {
    let message = '📝 *Confirm payment received?*\n\n'
    message += `💰 Amount: ${amount}\n`
    message += `📅 Date: ${date}\n`

    if (intent.party) {
      message += `👤 From: ${intent.party}\n`
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

  if (actionType === 'loan_given') {
    let message = '📝 *Confirm loan given?*\n\n'
    message += `💸 *Money lent out*\n`
    message += `To: ${intent.party || 'Unknown'}\n`
    message += `Amount: ${amount}\n`
    message += `📅 Date: ${date}\n\n`
    message += `⚠️ ${intent.party || 'This person'} owes you ${amount}\n`
    message += `📌 This is NOT a sale (not counted as revenue)`

    return message
  }

  return `Confirm: ${amount}`
}

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
  // Handle time_ref values
  if (dateString === 'today') return 'Today'
  if (dateString === 'yesterday') return 'Yesterday'
  if (dateString === 'this_week') return 'This week'
  if (dateString === 'last_week') return 'Last week'
  if (dateString === 'this_month') return 'This month'
  if (dateString === 'last_month') return 'Last month'

  // Handle actual dates
  const date = new Date(dateString)
  if (isNaN(date.getTime())) {
    return 'Today' // Default fallback
  }

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
