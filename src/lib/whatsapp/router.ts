/**
 * Message Router
 * Main orchestration logic for incoming WhatsApp messages
 */

import { createClient } from '@supabase/supabase-js'
import { parseMessage, ParsedIntent } from './llm-parser'
import { createPendingAction, getActivePending, rejectPendingAction } from './confirmation'
import { commitPendingAction } from './commit'
import { sendMessage, formatNaira } from './api-client'
import { transcribeVoiceNote } from './voice'
import {
  getBusinessDebts,
  getCustomerDebts,
  formatDebtListMessage,
  sendDebtReminder,
  saveCustomerPhone,
  markDebtAsPaid
} from './debt-manager'

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

interface WhatsAppUser {
  id: string
  wa_phone: string
  user_id: string | null
  business_id: string | null
  preferred_language: string
  language_pref: string  // 'pidgin' | 'english' | 'auto'
  onboarding_completed_at: string | null
  onboarding_state: string
  owner_name: string | null
  subscription_status: string
  trial_ends_at: string | null
}

/**
 * Main message processing function
 * Called for each incoming WhatsApp message
 */
export async function processMessage(messageId: string): Promise<void> {
  try {
    // Fetch the raw message
    const { data: rawMessage, error: fetchError } = await supabase
      .from('whatsapp_messages_raw')
      .select('*')
      .eq('id', messageId)
      .single()

    if (fetchError || !rawMessage) {
      console.error('Failed to fetch message:', fetchError)
      return
    }

    const waPhone = rawMessage.wa_phone
    const messageBody = rawMessage.body
    const messageType = rawMessage.message_type

    // Update last_message_at for service window tracking
    await supabase
      .from('whatsapp_users')
      .update({ last_message_at: new Date().toISOString() })
      .eq('wa_phone', waPhone)

    // Handle voice notes
    if (messageType === 'audio') {
      await sendMessage(waPhone, '🎤 Processing your voice note...')

      const transcription = await transcribeVoiceNote(
        rawMessage.media_url,
        rawMessage.media_mime_type
      )

      if (!transcription.success) {
        await sendMessage(
          waPhone,
          `❌ Couldn't understand the audio. ${transcription.error}\n\nPlease try again or send a text message.`
        )
        await markMessageProcessed(messageId)
        return
      }

      // Use transcribed text as message body
      const waUser = await getOrCreateWhatsAppUser(waPhone)
      if (!waUser) {
        console.error('Failed to get/create user')
        return
      }

      if (waUser.subscription_status === 'expired') {
        await handleExpiredSubscription(waUser)
        await markMessageProcessed(messageId)
        return
      }

      await routeMessage(waUser, transcription.text!)
      await markMessageProcessed(messageId)
      return
    }

    // Handle other message types
    if (messageType !== 'text') {
      // Silently ignore button responses, reactions, and status updates
      // (Users also send text replies, so we handle those)
      const ignoredTypes = ['button', 'interactive', 'reaction', 'status', 'unknown']

      if (ignoredTypes.includes(messageType)) {
        await markMessageProcessed(messageId)
        return
      }

      // For actual media types, send helpful message
      if (messageType === 'image' || messageType === 'document') {
        await sendMessage(
          waPhone,
          '📎 I can\'t read images or documents yet.\n\n' +
          'Please describe your sale in text or send a voice note.'
        )
      } else {
        await sendMessage(
          waPhone,
          '❓ I didn\'t understand that message type.\n\n' +
          'Please send text or voice messages.'
        )
      }

      await markMessageProcessed(messageId)
      return
    }

    if (!messageBody) {
      await markMessageProcessed(messageId)
      return
    }

    // Get or create WhatsApp user
    const waUser = await getOrCreateWhatsAppUser(waPhone)

    if (!waUser) {
      console.error('Failed to get/create user')
      return
    }

    // Check subscription status
    if (waUser.subscription_status === 'expired') {
      await handleExpiredSubscription(waUser)
      await markMessageProcessed(messageId)
      return
    }

    // Route based on state
    await routeMessage(waUser, messageBody)

    // Mark as processed
    await markMessageProcessed(messageId)

  } catch (error) {
    console.error('Error processing message:', error)

    // Log error in database
    await supabase
      .from('whatsapp_messages_raw')
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : 'Unknown error'
      })
      .eq('id', messageId)
  }
}

/**
 * Route message based on user state and content
 */
async function routeMessage(waUser: WhatsAppUser, messageBody: string): Promise<void> {
  const normalizedMessage = messageBody.toLowerCase().trim()

  // Check for pending confirmation first (exclude 'clarifying' - those need to go to parser)
  const pending = await getActivePending(waUser.wa_phone)

  let autoSavePrefix = ''
  if (pending && pending.action_type !== 'clarifying') {
    // Parse the message to see if it's a confirmation or a new intent
    const { isConfirmation, autoSaveMessage } = await handleConfirmationReply(waUser, messageBody, pending)
    if (isConfirmation) {
      return  // Confirmation was handled, stop here
    }
    // If not a confirmation, fall through to process as new intent
    // (pending was auto-saved by handleConfirmationReply)
    autoSavePrefix = autoSaveMessage || ''
  }

  // Check for special commands
  if (normalizedMessage.startsWith('link ')) {
    await handleLinkCommand(waUser, messageBody)
    return
  }

  if (normalizedMessage === 'help' || normalizedMessage === 'start') {
    await handleHelpCommand(waUser)
    return
  }

  // Onboarding flow - must come before parser to avoid asking LLM about onboarding questions
  if (waUser.onboarding_state !== 'done') {
    const consumed = await handleOnboarding(waUser, messageBody)
    if (consumed) return  // Onboarding consumed the message
  }

  // Check if user has a business context
  if (!waUser.business_id) {
    await handleNoBusinessContext(waUser)
    return
  }

  // Debt management commands
  if (normalizedMessage.startsWith('remind ')) {
    await handleRemindCommand(waUser, messageBody)
    return
  }

  if (normalizedMessage.includes(' phone is ') || normalizedMessage.includes(' number is ')) {
    await handleSavePhoneCommand(waUser, messageBody)
    return
  }

  if (normalizedMessage.startsWith('mark ') && normalizedMessage.includes(' paid')) {
    await handleMarkPaidCommand(waUser, messageBody)
    return
  }

  // Handle greetings
  if (
    normalizedMessage === 'hi' ||
    normalizedMessage === 'hello' ||
    normalizedMessage === 'hey' ||
    normalizedMessage === 'good morning' ||
    normalizedMessage === 'good afternoon' ||
    normalizedMessage === 'good evening'
  ) {
    await handleHelpCommand(waUser)
    return
  }

  // Detect query vs transaction
  if (isQueryMessage(normalizedMessage)) {
    await handleQuery(waUser, messageBody, autoSavePrefix)
    return
  }

  // Default: Parse as sale intent
  await handleSaleIntent(waUser, messageBody, autoSavePrefix)
}

/**
 * Handle confirmation reply (yes/no)
 * Uses tolerant matching to accept natural Nigerian English and Pidgin confirmations
 * Returns object with isConfirmation flag and optional autoSaveMessage
 */
async function handleConfirmationReply(
  waUser: WhatsAppUser,
  message: string,
  pending: any
): Promise<{ isConfirmation: boolean; autoSaveMessage?: string }> {
  // Normalize: lowercase, trim, remove emojis and punctuation except word boundaries
  const normalized = message.toLowerCase().trim().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ')

  // Tolerant regex patterns for confirmation (English + Pidgin)
  const YES_PATTERN = /\b(1|yes|y|yeah|yep|yup|confirm(ed)?|ok|okay|k|correct|right|sure|save|done|na so|e correct|good)\b|✅/i
  const NO_PATTERN = /\b(2|no|nope|cancel|delete|discard|remove|forget|wrong|no mind|e no correct)\b|❌/i

  // Check original message too (for emojis that might be stripped)
  const originalLower = message.toLowerCase()

  // Check for positive confirmation
  if (YES_PATTERN.test(normalized) || originalLower.includes('✅')) {
    // Commit the pending action
    const result = await commitPendingAction(pending.id)

    if (!result.success) {
      await sendMessage(
        waUser.wa_phone,
        `❌ Failed to save: ${result.error}\n\nPlease try again.`
      )
    }
    return { isConfirmation: true }
  }

  // Check for negative response
  if (NO_PATTERN.test(normalized) || originalLower.includes('❌')) {
    await rejectPendingAction(pending.id)
    await sendMessage(
      waUser.wa_phone,
      '❌ Cancelled. Send a new message to try again.'
    )
    return { isConfirmation: true }
  }

  // Check if it's a correction (e.g., "no na 4500")
  const correctionPattern = /\b(no|wrong|na)\b.*\d+/i
  if (correctionPattern.test(message)) {
    // This is a correction - handle it
    await rejectPendingAction(pending.id)
    await sendMessage(
      waUser.wa_phone,
      '❌ Cancelled. Send the correct amount:'
    )
    return { isConfirmation: true }
  }

  // Parse the message to see if it's a NEW intent (query, new transaction, greeting, etc.)
  try {
    const intent = await parseMessage(message, { businessName: 'Business' }, undefined, waUser.language_pref || 'auto')

    // Check if it's a clear new intent (not ambiguous)
    const newIntents = ['query', 'log_sale', 'log_sale_credit', 'log_expense', 'log_owner_withdrawal',
                        'log_loan_given', 'log_payment_received', 'greeting', 'thanks', 'help', 'list_debts']

    if (newIntents.includes(intent.intent) && intent.confidence > 0.7) {
      // This is a NEW intent - auto-save the pending entry and continue
      console.log(`🔄 Auto-saving pending ${pending.action_type} to process new ${intent.intent}`)

      const result = await commitPendingAction(pending.id)

      // Format the pending action for the prepend message
      const actionLabel = pending.action_type === 'sale' ? 'sale' :
                         pending.action_type === 'expense' ? 'expense' :
                         pending.action_type === 'loan_given' ? 'loan' :
                         pending.action_type === 'withdrawal' ? 'withdrawal' :
                         pending.action_type === 'debt_payment' ? 'payment' : 'entry'

      const totalKobo = pending.intent_data.amount_kobo ||
                       pending.intent_data.items?.reduce((sum: number, item: any) => {
                         const itemTotal = item.amount_basis === 'unit' && item.qty
                           ? item.amount_kobo * item.qty
                           : item.amount_kobo
                         return sum + itemTotal
                       }, 0) || 0

      let autoSaveMessage = ''
      if (result.success) {
        autoSaveMessage = `✅ Saved your pending ${formatNaira(totalKobo)} ${actionLabel} first.\n\n`
      } else {
        // If auto-save failed, just cancel it
        await rejectPendingAction(pending.id)
      }

      return { isConfirmation: false, autoSaveMessage }  // Not a confirmation - let router continue
    }

    // If we get here, the intent is unclear or low confidence
    // Re-prompt for confirmation
    await sendMessage(
      waUser.wa_phone,
      'Reply *1* to save ✅  or  *2* to cancel ❌'
    )
    return { isConfirmation: true }  // Block processing of unclear message

  } catch (error) {
    console.error('Error parsing message during confirmation:', error)
    // On parse error, just re-prompt
    await sendMessage(
      waUser.wa_phone,
      'Reply *1* to save ✅  or  *2* to cancel ❌'
    )
    return { isConfirmation: true }
  }
}

/**
 * Handle sale intent (main use case)
 */
async function handleSaleIntent(waUser: WhatsAppUser, messageBody: string, autoSavePrefix: string = ''): Promise<void> {
  try {
    // Check if there's an active clarification pending
    const { data: clarificationPending } = await supabase
      .from('whatsapp_pending_actions')
      .select('*')
      .eq('wa_phone', waUser.wa_phone)
      .eq('action_type', 'clarifying')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    let intent

    // If there's a clarification context, use merge mode
    if (clarificationPending && clarificationPending.partial_parse) {
      console.log('🔄 Clarification context found, using merge mode')

      // Shortcut: if reply is just a number, assume it's the amount
      const numberMatch = messageBody.match(/^(\d+\.?\d*)[kKmM]?$/)
      if (numberMatch) {
        const partialParse = clarificationPending.partial_parse as Partial<ParsedIntent>

        // Parse the amount
        let amountKobo = 0
        const value = parseFloat(numberMatch[1])
        const suffix = messageBody.toLowerCase()

        if (suffix.includes('k')) {
          amountKobo = value * 1000 * 100  // k = thousand, convert to kobo
        } else if (suffix.includes('m')) {
          amountKobo = value * 1000000 * 100  // m = million, convert to kobo
        } else {
          amountKobo = value * 100  // plain number, convert to kobo
        }

        // Merge with partial parse
        intent = {
          ...partialParse,
          items: (partialParse.items || []).map(item => ({
            ...item,
            amount_kobo: item.amount_kobo || amountKobo,
            amount_basis: item.amount_basis || 'total'
          })),
          amount_kobo: amountKobo,
          confidence: 0.95,
          needs_clarification: false,
          clarification_question: null
        } as ParsedIntent

        console.log('✅ Shortcut: plain number merged as amount')
      } else {
        // Use LLM merge mode
        intent = await parseMessage(
          messageBody,
          { businessName: 'Business', currency: 'NGN' },
          clarificationPending.partial_parse as Partial<ParsedIntent>,
          waUser.language_pref
        )
      }

      // Delete the clarification pending action
      await supabase
        .from('whatsapp_pending_actions')
        .delete()
        .eq('id', clarificationPending.id)

    } else {
      // Normal parse (no clarification context)
      intent = await parseMessage(
        messageBody,
        { businessName: 'Business', currency: 'NGN' },
        undefined,
        waUser.language_pref
      )
    }

    // Check if clarification needed
    if (intent.needs_clarification && intent.clarification_question) {
      // Save partial parse for context
      const clarificationId = generateId()

      await supabase
        .from('whatsapp_pending_actions')
        .insert({
          id: clarificationId,
          wa_phone: waUser.wa_phone,
          business_id: waUser.business_id!,
          action_type: 'clarifying',
          intent_data: intent,
          partial_parse: intent,  // Save full intent as partial parse
          confirmation_message: intent.clarification_question,
          status: 'pending',
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()  // 10 min expiry
        })

      await sendMessage(waUser.wa_phone, intent.clarification_question)
      return
    }

    // Handle special intents
    if (intent.intent === 'other' || intent.intent === 'help') {
      await sendMessage(
        waUser.wa_phone,
        `Sorry, I didn't understand that.\n\n` +
        `Try: "Sold 3 bags for 45k" or "I don sell 5000 naira"`
      )
      return
    }

    if (intent.intent === 'greeting' || intent.intent === 'thanks') {
      await handleHelpCommand(waUser)
      return
    }

    if (intent.intent === 'query' || intent.intent === 'list_debts' || intent.intent === 'debt_check') {
      await handleQuery(waUser, intent.query_text || messageBody, autoSavePrefix)
      return
    }

    // Check confidence (0.0-1.0 now)
    if (intent.confidence < 0.6) {
      await sendMessage(
        waUser.wa_phone,
        `I'm not sure I understood correctly.\n\n` +
        `${intent.note || 'Please try again with more details.'}`
      )
      return
    }

    // Create pending confirmation
    const result = await createPendingAction(
      waUser.wa_phone,
      waUser.business_id!,
      intent
    )

    if (!result.success) {
      await sendMessage(
        waUser.wa_phone,
        `❌ Error: ${result.error}\n\nPlease try again.`
      )
    }

  } catch (error) {
    console.error('Error handling sale intent:', error)
    await sendMessage(
      waUser.wa_phone,
      '❌ Something went wrong. Please try again.'
    )
  }
}

/**
 * Handle query messages - route to specific metric calculation
 */
async function handleQuery(waUser: WhatsAppUser, query: string, autoSavePrefix: string = ''): Promise<void> {
  const normalized = query.toLowerCase()

  // Determine metric from keywords
  let metric: 'sales' | 'expenses' | 'profit' | 'withdrawals' | 'balance' | 'debts' | 'summary' = 'summary'

  if (normalized.includes('expense') || normalized.includes('spend')) {
    metric = 'expenses'
  } else if (normalized.includes('profit') || normalized.includes('gain') || normalized.includes('make') || normalized.includes('made')) {
    metric = 'profit'
  } else if (normalized.includes('balance') || normalized.includes('cash') || normalized.includes('drawer') || normalized.includes('left')) {
    metric = 'balance'
  } else if (normalized.includes('sales') || normalized.includes('sold')) {
    metric = 'sales'
  } else if (normalized.includes('withdraw') || normalized.includes('took for myself') || normalized.includes('chop')) {
    metric = 'withdrawals'
  } else if (normalized.includes('owe') || normalized.includes('debt') || normalized.includes('owing')) {
    metric = 'debts'
  }

  // Determine time period from keywords
  let timeRef: 'today' | 'yesterday' | 'this_week' | 'this_month' = 'today'
  if (normalized.includes('yesterday')) {
    timeRef = 'yesterday'
  } else if (normalized.includes('week')) {
    timeRef = 'this_week'
  } else if (normalized.includes('month')) {
    timeRef = 'this_month'
  }

  // Route to specific query handler
  await handleSpecificQuery(waUser, metric, timeRef, autoSavePrefix)
}

/**
 * Handle specific query based on metric and time period
 */
async function handleSpecificQuery(
  waUser: WhatsAppUser,
  metric: 'sales' | 'expenses' | 'profit' | 'withdrawals' | 'balance' | 'debts' | 'summary',
  timeRef: 'today' | 'yesterday' | 'this_week' | 'this_month',
  autoSavePrefix: string = ''
): Promise<void> {
  try {
    const period = getPeriodLabel(timeRef)
    const dates = getDateRange(timeRef)

    if (metric === 'debts') {
      await handleDebtQuery(waUser)
      return
    }

    // Get sales data (only actual sales, NOT loans)
    const { data: sales } = await supabase
      .from('sales_entries')
      .select('amount, units')
      .eq('business_id', waUser.business_id!)
      .gte('date', dates.start)
      .lte('date', dates.end)

    const salesNaira = (sales || []).reduce((sum, s) => sum + Number(s.amount), 0)
    const salesKobo = Math.round(salesNaira * 100)

    // Note: expenses table not implemented yet, defaulting to 0
    const expensesKobo = 0

    // Get withdrawals
    const { data: withdrawals } = await supabase
      .from('owner_withdrawals')
      .select('amount_kobo')
      .eq('business_id', waUser.business_id!)
      .gte('withdrawal_date', dates.start)
      .lte('withdrawal_date', dates.end)

    const withdrawalsKobo = (withdrawals || []).reduce((sum, w) => sum + w.amount_kobo, 0)

    // Get loans given (cash out, NOT revenue)
    const { data: loans } = await supabase
      .from('whatsapp_debts')
      .select('amount_kobo, customer_name')
      .eq('business_id', waUser.business_id!)
      .eq('is_loan', true)
      .gte('sale_date', dates.start)
      .lte('sale_date', dates.end)

    const loansKobo = (loans || []).reduce((sum, l) => sum + l.amount_kobo, 0)

    // Get receivables (money owed to user - both credit sales and loans)
    const receivables = await getTotalReceivables(waUser.business_id!)

    // PROFIT = sales revenue - expenses ONLY
    // NOT reduced by withdrawals or loans (those aren't business costs)
    const profitKobo = salesKobo - expensesKobo

    // CASH IN DRAWER = proper calculation of physical money
    // + cash sales + repayments - expenses - withdrawals - loans
    const cashInDrawerKobo = await calculateCashInDrawer(
      waUser.business_id!,
      dates.start,
      dates.end
    )

    // Format response based on requested metric
    let message = ''

    switch (metric) {
      case 'sales':
        message = `💰 *Sales ${period}*\n\n${formatNaira(salesKobo)}`
        if (sales && sales.length > 0) {
          message += `\n📋 ${sales.length} transaction${sales.length > 1 ? 's' : ''}`
        }
        break

      case 'expenses':
        message = `📉 *Expenses ${period}*\n\n${formatNaira(expensesKobo)}`
        if (expensesKobo === 0) {
          message += '\n\n📌 No business expenses recorded'
        }
        // Add helpful note if loans were given today (so user isn't confused)
        if (loansKobo > 0 && loans && loans.length > 0) {
          const loanNames = loans.map(l => l.customer_name).join(', ')
          message += `\n\n💡 Note: ${formatNaira(loansKobo)} you lent to ${loanNames} is tracked in your debt book and reduces your cash, but it's not an expense (you'll get it back).`
        }
        break

      case 'profit':
        message = `📊 *Profit ${period}*\n\n`
        message += `Sales: ${formatNaira(salesKobo)}\n`
        message += `Expenses: ${formatNaira(expensesKobo)}\n`
        message += `\n💵 *Profit: ${formatNaira(profitKobo)}*`
        break

      case 'withdrawals':
        message = `💸 *Owner Withdrawals ${period}*\n\n${formatNaira(withdrawalsKobo)}`
        break

      case 'balance':
        message = `💵 *Cash in Drawer ${period}*\n\n`
        message += `${formatNaira(cashInDrawerKobo)}\n\n`
        message += `Breakdown:\n`
        message += `Cash sales: +${formatNaira(salesKobo)}\n`
        message += `Expenses: -${formatNaira(expensesKobo)}\n`
        if (withdrawalsKobo > 0) message += `Withdrawals: -${formatNaira(withdrawalsKobo)}\n`
        if (loansKobo > 0) message += `Loans given: -${formatNaira(loansKobo)}\n`
        message += `\n📌 This is physical money, not profit`
        break

      case 'summary':
      default:
        const todayDate = new Date().toLocaleDateString('en-NG', {
          timeZone: 'Africa/Lagos',
          month: 'short',
          day: 'numeric'
        })
        message = `📊 *${period === 'today' ? `Today — ${todayDate}` : `Summary ${period}`}*\n\n`
        message += `💰 Sales: ${formatNaira(salesKobo)}\n`
        message += `📉 Expenses: ${formatNaira(expensesKobo)}\n`
        if (loansKobo > 0) {
          message += `💸 Lent out: ${formatNaira(loansKobo)}\n`
        }
        if (withdrawalsKobo > 0) {
          message += `🏠 Withdrawals: ${formatNaira(withdrawalsKobo)}\n`
        }
        message += `\n🟢 Profit: ${formatNaira(profitKobo)} (sales − expenses)\n`
        message += `💵 Cash in drawer: ${formatNaira(cashInDrawerKobo)}\n`
        message += `📌 Owed to you: ${formatNaira(receivables.total)}`
        if (receivables.count > 0) {
          message += ` (${receivables.count} ${receivables.count === 1 ? 'person' : 'people'})`
        }
    }

    await sendMessage(waUser.wa_phone, autoSavePrefix + message)

  } catch (error) {
    console.error('Error handling query:', error)
    await sendMessage(waUser.wa_phone, '❌ Failed to get data')
  }
}

/**
 * Get period label for display
 */
function getPeriodLabel(timeRef: string): string {
  switch (timeRef) {
    case 'today': return 'today'
    case 'yesterday': return 'yesterday'
    case 'this_week': return 'this week'
    case 'this_month': return 'this month'
    default: return timeRef
  }
}

/**
 * Get date range for query
 */
function getDateRange(timeRef: string): { start: string; end: string } {
  const today = new Date()
  const formatter = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })

  switch (timeRef) {
    case 'today':
      return { start: formatter(today), end: formatter(today) }

    case 'yesterday': {
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      return { start: formatter(yesterday), end: formatter(yesterday) }
    }

    case 'this_week': {
      const weekStart = new Date(today)
      weekStart.setDate(today.getDate() - today.getDay())
      return { start: formatter(weekStart), end: formatter(today) }
    }

    case 'this_month': {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
      return { start: formatter(monthStart), end: formatter(today) }
    }

    default:
      return { start: formatter(today), end: formatter(today) }
  }
}

/**
 * Calculate cash in drawer (real money position)
 * Formula: cash_sales + debt_repayments - expenses - withdrawals - loans_given
 * Credit sales do NOT affect cash (no money moved yet)
 */
async function calculateCashInDrawer(
  businessId: string,
  startDate: string,
  endDate: string
): Promise<number> {
  // Cash sales (+)
  const { data: sales } = await supabase
    .from('sales_entries')
    .select('amount')
    .eq('business_id', businessId)
    .gte('date', startDate)
    .lte('date', endDate)

  const cashSalesKobo = (sales || []).reduce((sum, s) => sum + Number(s.amount) * 100, 0)

  // Debt repayments received (+)
  // First get debt IDs for this business
  const { data: businessDebts } = await supabase
    .from('whatsapp_debts')
    .select('id')
    .eq('business_id', businessId)

  const debtIds = (businessDebts || []).map(d => d.id)

  // Then get payments for those debts
  const { data: payments } = debtIds.length > 0
    ? await supabase
        .from('whatsapp_debt_payments')
        .select('amount_kobo')
        .in('debt_id', debtIds)
        .gte('payment_date', startDate)
        .lte('payment_date', endDate)
    : { data: [] }

  const repaymentsKobo = (payments || []).reduce((sum, p) => sum + p.amount_kobo, 0)

  // Expenses (-)
  const { data: expenses } = await supabase
    .from('whatsapp_expenses')
    .select('amount_kobo')
    .eq('business_id', businessId)
    .gte('expense_date', startDate)
    .lte('expense_date', endDate)

  const expensesKobo = (expenses || []).reduce((sum, e) => sum + e.amount_kobo, 0)

  // Owner withdrawals (-)
  const { data: withdrawals } = await supabase
    .from('owner_withdrawals')
    .select('amount_kobo')
    .eq('business_id', businessId)
    .gte('withdrawal_date', startDate)
    .lte('withdrawal_date', endDate)

  const withdrawalsKobo = (withdrawals || []).reduce((sum, w) => sum + w.amount_kobo, 0)

  // Loans given (-)
  const { data: loans } = await supabase
    .from('whatsapp_debts')
    .select('amount_kobo')
    .eq('business_id', businessId)
    .eq('is_loan', true)
    .gte('sale_date', startDate)
    .lte('sale_date', endDate)

  const loansKobo = (loans || []).reduce((sum, l) => sum + l.amount_kobo, 0)

  // Calculate: + cash sales + repayments - expenses - withdrawals - loans
  return cashSalesKobo + repaymentsKobo - expensesKobo - withdrawalsKobo - loansKobo
}

/**
 * Get total receivables (money owed to user)
 */
async function getTotalReceivables(businessId: string): Promise<{ total: number; count: number }> {
  const { data: debts } = await supabase
    .from('whatsapp_debts')
    .select('balance_kobo, customer_name')
    .eq('business_id', businessId)
    .in('status', ['outstanding', 'partial'])

  const total = (debts || []).reduce((sum, d) => sum + d.balance_kobo, 0)
  const count = debts?.length || 0

  return { total, count }
}

/**
 * Handle "who owes me?" query
 */
async function handleDebtQuery(waUser: WhatsAppUser): Promise<void> {
  try {
    const debts = await getBusinessDebts(waUser.business_id!)
    const message = formatDebtListMessage(debts)
    await sendMessage(waUser.wa_phone, message)
  } catch (error) {
    console.error('Error handling debt query:', error)
    await sendMessage(waUser.wa_phone, '❌ Failed to get debt list')
  }
}

/**
 * Handle "remind [customer name]" command
 */
async function handleRemindCommand(waUser: WhatsAppUser, message: string): Promise<void> {
  try {
    const customerName = message.toLowerCase().replace('remind ', '').trim()

    if (!customerName) {
      await sendMessage(waUser.wa_phone, '❌ Please specify customer name: "remind Mama Nkechi"')
      return
    }

    // Get debts for this customer
    const debts = await getCustomerDebts(waUser.business_id!, customerName)

    if (debts.length === 0) {
      await sendMessage(waUser.wa_phone, `No outstanding debts found for "${customerName}"`)
      return
    }

    // Get business info
    const { data: business } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', waUser.business_id!)
      .single()

    const businessName = business?.name || 'Your Business'

    // Send reminder
    const result = await sendDebtReminder(debts[0], businessName, waUser.wa_phone)
    await sendMessage(waUser.wa_phone, result.message)

  } catch (error) {
    console.error('Error handling remind command:', error)
    await sendMessage(waUser.wa_phone, '❌ Failed to send reminder')
  }
}

/**
 * Handle "[customer] phone is [number]" command
 */
async function handleSavePhoneCommand(waUser: WhatsAppUser, message: string): Promise<void> {
  try {
    // Parse: "Mama Nkechi phone is 08012345678" or "Mama Nkechi number is 080..."
    const parts = message.toLowerCase().split(/ phone is | number is /)

    if (parts.length !== 2) {
      await sendMessage(waUser.wa_phone, '❌ Format: "Mama Nkechi phone is 08012345678"')
      return
    }

    const customerName = parts[0].trim()
    const phoneNumber = parts[1].trim().replace(/[^\d+]/g, '') // Keep only digits and +

    if (!phoneNumber) {
      await sendMessage(waUser.wa_phone, '❌ Invalid phone number')
      return
    }

    // Add country code if not present
    const formattedPhone = phoneNumber.startsWith('+') || phoneNumber.startsWith('234')
      ? phoneNumber
      : `234${phoneNumber.replace(/^0/, '')}` // Convert 080... to 234...

    const result = await saveCustomerPhone(waUser.business_id!, customerName, formattedPhone)

    if (result.success) {
      await sendMessage(
        waUser.wa_phone,
        `✅ Saved ${customerName}'s number!\n\n` +
        `You can now send reminders: "remind ${customerName}"`
      )
    } else {
      await sendMessage(waUser.wa_phone, `❌ Failed to save: ${result.error}`)
    }

  } catch (error) {
    console.error('Error saving phone:', error)
    await sendMessage(waUser.wa_phone, '❌ Failed to save phone number')
  }
}

/**
 * Handle "mark [customer] paid" command
 */
async function handleMarkPaidCommand(waUser: WhatsAppUser, message: string): Promise<void> {
  try {
    // Parse: "mark Mama Nkechi paid"
    const customerName = message
      .toLowerCase()
      .replace('mark ', '')
      .replace(' paid', '')
      .trim()

    if (!customerName) {
      await sendMessage(waUser.wa_phone, '❌ Format: "mark Mama Nkechi paid"')
      return
    }

    // Get customer's debts
    const debts = await getCustomerDebts(waUser.business_id!, customerName)

    if (debts.length === 0) {
      await sendMessage(waUser.wa_phone, `No outstanding debts for "${customerName}"`)
      return
    }

    // Mark all their debts as paid
    let markedCount = 0
    for (const debt of debts) {
      const result = await markDebtAsPaid(debt.id)
      if (result.success) markedCount++
    }

    const totalCleared = debts.reduce((sum, d) => sum + d.balance_kobo, 0)

    await sendMessage(
      waUser.wa_phone,
      `✅ *Debt cleared!*\n\n` +
      `${customerName} has paid ${formatNaira(totalCleared)}\n\n` +
      `🎉 Great job collecting!`
    )

  } catch (error) {
    console.error('Error marking paid:', error)
    await sendMessage(waUser.wa_phone, '❌ Failed to mark as paid')
  }
}

/**
 * Check if message is a query
 */
function isQueryMessage(message: string): boolean {
  const queryKeywords = [
    'how much',
    'wetin',
    'show',
    'balance',
    'total',
    'summary',
    'report',
    'who owe',
    'who dey owe'
  ]

  return queryKeywords.some(keyword => message.includes(keyword))
}

/**
 * Handle onboarding state machine for new users
 * State transitions: new → asked_name → asked_lang → asked_biz → first_sale → done
 * Returns true if message was consumed by onboarding, false otherwise
 */
async function handleOnboarding(waUser: WhatsAppUser, message: string): Promise<boolean> {
  const currentState = waUser.onboarding_state

  // State: new → Ask for user's name
  if (currentState === 'new') {
    await supabase
      .from('whatsapp_users')
      .update({ onboarding_state: 'asked_name' })
      .eq('id', waUser.id)

    await sendMessage(
      waUser.wa_phone,
      `👋 Welcome to FLOIN!\n\n` +
      `I'm your bookkeeping assistant. I'll help you track sales, expenses, and debts via WhatsApp.\n\n` +
      `First, what's your name?`
    )
    return true  // Consumed the message
  }

  // State: asked_name → Save name, ask for language preference
  if (currentState === 'asked_name') {
    const userName = message.substring(0, 50).trim()

    await supabase
      .from('whatsapp_users')
      .update({
        owner_name: userName,
        onboarding_state: 'asked_lang'
      })
      .eq('id', waUser.id)

    await sendMessage(
      waUser.wa_phone,
      `Nice one ${userName} 🤝\n\n` +
      `Quick one — you wan make I dey yarn with you for *Pidgin* or *English*?\n\n` +
      `Reply *1* for Pidgin, *2* for English.`
    )
    return true
  }

  // State: asked_lang → Save language preference, ask for business name
  if (currentState === 'asked_lang') {
    const text = message.trim()
    const choice = /^1|pidgin|pidin|pigin/i.test(text) ? 'pidgin'
                 : /^2|english|eng/i.test(text) ? 'english'
                 : null

    if (!choice) {
      await sendMessage(waUser.wa_phone, "Reply *1* for Pidgin or *2* for English 🙏")
      return true  // Stay on this step
    }

    await supabase
      .from('whatsapp_users')
      .update({
        language_pref: choice,
        onboarding_state: 'asked_biz'
      })
      .eq('id', waUser.id)

    // Send next question in chosen language
    const nextMessage = choice === 'pidgin'
      ? "Better 👌 Wetin you dey sell? (e.g. phone accessories, food, clothes)"
      : "Great 👌 What do you sell? (e.g. phone accessories, food, clothes)"

    await sendMessage(waUser.wa_phone, nextMessage)
    return true
  }

  // State: asked_biz → Create business, move to first_sale
  if (currentState === 'asked_biz') {
    const businessName = message.substring(0, 50).trim()
    const businessId = generateId()

    // Create guest business
    await supabase.from('businesses').insert({
      id: businessId,
      user_id: 'guest',  // Guest mode for now
      name: businessName,
      type: 'product',
      currency: 'NGN',
      channels: ['whatsapp'],
      created_at: new Date().toISOString()
    })

    await supabase
      .from('whatsapp_users')
      .update({
        business_id: businessId,
        onboarding_state: 'first_sale',
        trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() // 14 days
      })
      .eq('id', waUser.id)

    // Send confirmation in chosen language
    const confirmMessage = waUser.language_pref === 'pidgin'
      ? `Perfect! 🎉\n\n` +
        `${businessName} don set finish.\n\n` +
        `Now, yarn me your first sale today. Like:\n` +
        `• "I sell 3 bags 45k"\n` +
        `• "Sold 2 bottles 500 naira"\n` +
        `• 🎤 Or send voice note!\n\n` +
        `Type "help" anytime you need am.`
      : `Perfect! 🎉\n\n` +
        `${businessName} is all set up.\n\n` +
        `Now, tell me about your first sale today. Examples:\n` +
        `• "Sold 3 bags for 45k"\n` +
        `• "I sell 2 bottles 500 naira"\n` +
        `• 🎤 Or send a voice note!\n\n` +
        `Type "help" anytime if you need assistance.`

    await sendMessage(waUser.wa_phone, confirmMessage)
    return true
  }

  // State: first_sale → Let message fall through to parser, mark as done after first confirmation
  if (currentState === 'first_sale') {
    // Don't consume the message - let it go to the parser
    // We'll mark onboarding as done when they confirm their first transaction
    return false
  }

  // State: done → Should never reach here
  return false
}

/**
 * Handle link command for web-first users
 */
async function handleLinkCommand(waUser: WhatsAppUser, message: string): Promise<void> {
  // TODO: Implement linking with web accounts
  await sendMessage(waUser.wa_phone, 'Account linking coming soon! For now, continue using WhatsApp.')
}

/**
 * Handle help command
 */
async function handleHelpCommand(waUser: WhatsAppUser): Promise<void> {
  const helpMessage = waUser.language_pref === 'pidgin'
    ? `📚 *FLOIN Help*\n\n` +
      `*Log sale:*\n` +
      `"I sell 3 bags 45k" or 🎤 voice note\n\n` +
      `*Credit sale:*\n` +
      `"Mama Nkechi carry 1 bag on credit 15k"\n\n` +
      `*Owner chop money:*\n` +
      `"I take 20k for myself"\n\n` +
      `*Check today:*\n` +
      `"How much I make today?"\n\n` +
      `*Manage debts:*\n` +
      `"Who dey owe me?" - See all debts\n` +
      `"Mama Nkechi phone is 080..." - Save number\n` +
      `"Remind Mama Nkechi" - Send reminder\n` +
      `"Mark Mama Nkechi paid" - Clear debt\n\n` +
      `Any question? Just ask! 😊`
    : `📚 *FLOIN Help*\n\n` +
      `*Log a sale:*\n` +
      `"Sold 3 bags 45k" or 🎤 voice note\n\n` +
      `*Credit sale:*\n` +
      `"Mama Nkechi carry 1 bag on credit 15k"\n\n` +
      `*Owner withdrawal:*\n` +
      `"I took 20k for myself"\n\n` +
      `*Check today:*\n` +
      `"How much today?"\n\n` +
      `*Manage debts:*\n` +
      `"Who dey owe me?" - List all debts\n` +
      `"Mama Nkechi phone is 080..." - Save number\n` +
      `"Remind Mama Nkechi" - Send reminder\n` +
      `"Mark Mama Nkechi paid" - Clear debt\n\n` +
      `Questions? Just ask! 😊`

  await sendMessage(waUser.wa_phone, helpMessage)
}

/**
 * Handle expired subscription
 */
async function handleExpiredSubscription(waUser: WhatsAppUser): Promise<void> {
  await sendMessage(
    waUser.wa_phone,
    `Your FLOIN trial has expired.\n\n` +
    `Renew to continue tracking your sales!\n` +
    `Visit: floin.app/renew`
  )
}

/**
 * Handle no business context
 */
async function handleNoBusinessContext(waUser: WhatsAppUser): Promise<void> {
  await sendMessage(
    waUser.wa_phone,
    `👋 Welcome to FLOIN!\n\n` +
    `What's your business name?`
  )
}

/**
 * Get or create WhatsApp user
 */
async function getOrCreateWhatsAppUser(waPhone: string): Promise<WhatsAppUser | null> {
  try {
    // Try to fetch existing user
    let { data: user, error } = await supabase
      .from('whatsapp_users')
      .select('*')
      .eq('wa_phone', waPhone)
      .single()

    if (error && error.code !== 'PGRST116') {
      throw error
    }

    // Create new user if doesn't exist
    if (!user) {
      const userId = generateId()
      const { data: newUser, error: createError } = await supabase
        .from('whatsapp_users')
        .insert({
          id: userId,
          wa_phone: waPhone,
          preferred_language: 'en',
          timezone: 'Africa/Lagos',
          is_active: true,
          subscription_status: 'trial',
          trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single()

      if (createError) throw createError

      user = newUser
    }

    return user as WhatsAppUser
  } catch (error) {
    console.error('Error getting/creating user:', error)
    return null
  }
}

/**
 * Mark message as processed
 */
async function markMessageProcessed(messageId: string): Promise<void> {
  await supabase
    .from('whatsapp_messages_raw')
    .update({
      processed: true,
      processed_at: new Date().toISOString()
    })
    .eq('id', messageId)
}
