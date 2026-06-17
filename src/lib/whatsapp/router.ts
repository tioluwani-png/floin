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
  findCustomerNameMatches,
  formatDebtListMessage,
  sendDebtReminder,
  saveCustomerPhone,
  markDebtAsPaid
} from './debt-manager'
import { validateCustomerName, isNonName } from './name-utils'
import { getDailyTotals, getDateRange } from './daily-totals'
import { saveQueryContext, getQueryContext, isPeriodChangeQuery } from './query-context'

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
 * Wrapped with global error handler - NEVER show raw errors to users
 */
async function routeMessage(waUser: WhatsAppUser, messageBody: string): Promise<void> {
  try {
    await routeMessageUnsafe(waUser, messageBody)
  } catch (error) {
    console.error('🚨 Unhandled error in message routing:', error)
    console.error('Stack:', error instanceof Error ? error.stack : 'No stack trace')

    // NEVER show raw errors to users - send friendly fallback
    const friendlyMessage = waUser.language_pref === 'pidgin'
      ? `Hmm, I no sure how to handle that one 🙏\n\nYou fit:\n` +
        `• Log sale/expense (e.g. "sold 3 charger 5k")\n` +
        `• Check who owe you ("who dey owe me")\n` +
        `• Write off debt ("clear Clara debt")\n` +
        `• Ask for help ("wetin you fit do")\n\n` +
        `Try one of those, or type "help" to see everything I fit do.`
      : `Hmm, I'm not sure how to handle that 🙏\n\nYou can:\n` +
        `• Log a sale/expense (e.g. "sold 3 chargers 5k")\n` +
        `• Check who owes you ("who owes me")\n` +
        `• Write off a debt ("clear Clara's debt")\n` +
        `• Ask for help ("what can you do")\n\n` +
        `Try one of those, or type "help" to see everything I can do.`

    await sendMessage(waUser.wa_phone, friendlyMessage)
  }
}

/**
 * Internal routing logic (unsafe - throws errors)
 */
async function routeMessageUnsafe(waUser: WhatsAppUser, messageBody: string): Promise<void> {
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

  if (normalizedMessage === 'cleanup debts' || normalizedMessage === 'fix debts' || normalizedMessage === 'fix names') {
    await handleCleanupDebtsCommand(waUser)
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
 * Handle choice question replies intelligently
 * Detects replies to "sales, expenses, or summary?" type questions
 * Accepts: keywords, numbers (1/2/3), or affirmative replies (defaults to summary)
 * Returns parsed intent if handled, null if should fall through to LLM
 */
function handleChoiceQuestionReply(
  reply: string,
  clarificationMessage: string
): ParsedIntent | null {
  const normalized = reply.toLowerCase().trim()

  // Check if the clarification was a metric choice question
  const isMetricChoiceQuestion =
    clarificationMessage.toLowerCase().includes('sales') &&
    clarificationMessage.toLowerCase().includes('expenses') &&
    (clarificationMessage.toLowerCase().includes('summary') ||
     clarificationMessage.toLowerCase().includes('everything'))

  if (!isMetricChoiceQuestion) {
    return null  // Not a choice question, let LLM handle it
  }

  // Option 1: Keywords (sales, expenses, summary, etc.)
  if (normalized.includes('sale') || normalized === '1') {
    return {
      intent: 'query',
      items: [],
      party: null,
      amount_kobo: null,
      query_text: 'sales today',
      time_ref: 'today',
      confidence: 0.95,
      needs_clarification: false,
      clarification_question: null,
      note: null
    }
  }

  if (normalized.includes('expense') || normalized.includes('spend') || normalized === '2') {
    return {
      intent: 'query',
      items: [],
      party: null,
      amount_kobo: null,
      query_text: 'expenses today',
      time_ref: 'today',
      confidence: 0.95,
      needs_clarification: false,
      clarification_question: null,
      note: null
    }
  }

  if (normalized.includes('summary') || normalized.includes('everything') ||
      normalized.includes('all') || normalized.includes('full') ||
      normalized.includes('together') || normalized === '3') {
    return {
      intent: 'query',
      items: [],
      party: null,
      amount_kobo: null,
      query_text: 'summary today',
      time_ref: 'today',
      confidence: 0.95,
      needs_clarification: false,
      clarification_question: null,
      note: null
    }
  }

  // Option 2: Affirmative but non-specific reply → Default to full summary
  const affirmativePatterns = /\b(yes|yeah|yep|yup|ok|okay|sure|abeg|na so|e correct|good|right|fine)\b/i
  if (affirmativePatterns.test(normalized)) {
    console.log('🔄 Affirmative reply to choice question → defaulting to summary')
    return {
      intent: 'query',
      items: [],
      party: null,
      amount_kobo: null,
      query_text: 'summary today',
      time_ref: 'today',
      confidence: 0.95,
      needs_clarification: false,
      clarification_question: null,
      note: null
    }
  }

  // Unrecognized reply - return null to let LLM try
  return null
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

      // First: check if this is a reply to a choice question (sales/expenses/summary)
      const choiceReply = handleChoiceQuestionReply(
        messageBody,
        clarificationPending.confirmation_message || ''
      )
      if (choiceReply) {
        // Handled as choice question → delete clarification and process as query
        await supabase
          .from('whatsapp_pending_actions')
          .delete()
          .eq('id', clarificationPending.id)

        await handleQuery(waUser, choiceReply.query_text!, autoSavePrefix)
        return
      }

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
      // LOOP PREVENTION: Check if we just deleted a clarification with the same question
      // If so, don't ask again - just show help instead
      if (clarificationPending &&
          clarificationPending.confirmation_message &&
          clarificationPending.confirmation_message.toLowerCase().includes(
            intent.clarification_question.toLowerCase().substring(0, 20)
          )) {
        console.log('🚫 Loop detected: same clarification question twice, showing help instead')
        await sendMessage(
          waUser.wa_phone,
          `I'm having trouble understanding.\n\n` +
          `Try:\n` +
          `• "Sold 3 bags for 45k"\n` +
          `• "I spend 10k for fuel"\n` +
          `• "How much I make today"\n` +
          `• "Who owes me"`
        )
        return
      }

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
    if (intent.intent === 'other') {
      await sendMessage(
        waUser.wa_phone,
        `Sorry, I didn't understand that.\n\n` +
        `Try: "Sold 3 bags for 45k" or "I don sell 5000 naira"`
      )
      return
    }

    // NEW: Help intent - show capabilities
    if (intent.intent === 'help') {
      await handleHelpCommand(waUser)
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

    // NEW: Write off debt (forgive without payment)
    if (intent.intent === 'write_off_debt') {
      await handleWriteOffDebt(waUser, intent, autoSavePrefix)
      return
    }

    // NEW: Delete/undo entry
    if (intent.intent === 'delete_entry') {
      await handleDeleteEntry(waUser, intent, autoSavePrefix)
      return
    }

    // NEW: Edit entry
    if (intent.intent === 'edit_entry') {
      await handleEditEntry(waUser, intent, autoSavePrefix)
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

  // Check if this is a period change query (e.g., "how about this month?" after asking for profit)
  const periodChange = isPeriodChangeQuery(query)
  if (periodChange.isPeriodChange && periodChange.timeRef) {
    // Use previous metric from context
    const context = getQueryContext(waUser.wa_phone)
    if (context) {
      // User asked "how about [period]?" - infer they want same metric for new period
      await handleSpecificQuery(waUser, context.metric, periodChange.timeRef, autoSavePrefix)
      return
    }
    // No context - fall through to normal metric detection
  }

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

    // SINGLE SOURCE OF TRUTH - Get ALL figures from one unified function
    // This ensures consistency: expenses in profit/summary/cash all come from same data
    const totals = await getDailyTotals(
      waUser.business_id!,
      dates.start,
      dates.end
    )

    // For helpful notes, get loan details if needed
    let loanDetails: Array<{ customer_name: string }> = []
    if (totals.loansGivenKobo > 0 && metric === 'expenses') {
      const { data: loans } = await supabase
        .from('whatsapp_debts')
        .select('customer_name')
        .eq('business_id', waUser.business_id!)
        .eq('is_loan', true)
        .gte('sale_date', dates.start)
        .lte('sale_date', dates.end)
      loanDetails = loans || []
    }

    // Get sales count for display
    let salesCount = 0
    if (metric === 'sales') {
      const { data: sales } = await supabase
        .from('sales_entries')
        .select('id')
        .eq('business_id', waUser.business_id!)
        .gte('date', dates.start)
        .lte('date', dates.end)
      salesCount = sales?.length || 0
    }

    // Format response based on requested metric
    // ALL figures come from the same totals object (single source of truth)
    let message = ''

    switch (metric) {
      case 'sales':
        message = `💰 *Sales ${period}*\n\n${formatNaira(totals.salesKobo)}`
        if (salesCount > 0) {
          message += `\n📋 ${salesCount} transaction${salesCount > 1 ? 's' : ''}`
        }
        break

      case 'expenses':
        message = `📉 *Expenses ${period}*\n\n${formatNaira(totals.expensesKobo)}`
        if (totals.expensesKobo === 0) {
          message += '\n\n📌 No business expenses recorded'
        }
        // Add helpful note if loans were given (so user isn't confused)
        if (totals.loansGivenKobo > 0 && loanDetails.length > 0) {
          const loanNames = loanDetails.map(l => l.customer_name).join(', ')
          message += `\n\n💡 Note: ${formatNaira(totals.loansGivenKobo)} you lent to ${loanNames} is tracked in your debt book and reduces your cash, but it's not an expense (you'll get it back).`
        }
        break

      case 'profit':
        message = `📊 *Profit ${period}*\n\n`
        message += `Sales: ${formatNaira(totals.salesKobo)}\n`
        message += `Expenses: ${formatNaira(totals.expensesKobo)}\n`
        message += `\n💵 *Profit: ${formatNaira(totals.profitKobo)}*`
        break

      case 'withdrawals':
        message = `💸 *Owner Withdrawals ${period}*\n\n${formatNaira(totals.withdrawalsKobo)}`
        break

      case 'balance':
        message = `💵 *Cash in Drawer ${period}*\n\n`
        message += `${formatNaira(totals.cashInDrawerKobo)}\n\n`
        message += `Breakdown:\n`
        message += `Cash sales: +${formatNaira(totals.salesKobo)}\n`
        message += `Expenses: -${formatNaira(totals.expensesKobo)}\n`
        if (totals.withdrawalsKobo > 0) message += `Withdrawals: -${formatNaira(totals.withdrawalsKobo)}\n`
        if (totals.loansGivenKobo > 0) message += `Loans given: -${formatNaira(totals.loansGivenKobo)}\n`
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
        message += `💰 Sales: ${formatNaira(totals.salesKobo)}\n`
        message += `📉 Expenses: ${formatNaira(totals.expensesKobo)}\n`
        if (totals.loansGivenKobo > 0) {
          message += `💸 Lent out: ${formatNaira(totals.loansGivenKobo)}\n`
        }
        if (totals.withdrawalsKobo > 0) {
          message += `🏠 Withdrawals: ${formatNaira(totals.withdrawalsKobo)}\n`
        }
        message += `\n🟢 Profit: ${formatNaira(totals.profitKobo)} (sales − expenses)\n`
        message += `💵 Cash in drawer: ${formatNaira(totals.cashInDrawerKobo)}\n`
        message += `📌 Owed to you: ${formatNaira(totals.receivablesKobo)}`
        if (totals.debtorCount > 0) {
          message += ` (${totals.debtorCount} ${totals.debtorCount === 1 ? 'person' : 'people'})`
        }
    }

    await sendMessage(waUser.wa_phone, autoSavePrefix + message)

    // Save query context so "how about [period]?" can infer same metric
    saveQueryContext(waUser.wa_phone, metric, timeRef)

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
 * Uses fuzzy matching and disambiguation
 */
async function handleRemindCommand(waUser: WhatsAppUser, message: string): Promise<void> {
  try {
    const searchName = message.toLowerCase().replace('remind ', '').trim()

    if (!searchName) {
      await sendMessage(waUser.wa_phone, '❌ Please specify customer name: "remind Mama Nkechi"')
      return
    }

    // Find matching customer names
    const { matches } = await findCustomerNameMatches(waUser.business_id!, searchName)

    if (matches.length === 0) {
      // No matches - show current debtor names for reference
      const allDebts = await getBusinessDebts(waUser.business_id!)
      const allNames = [...new Set(allDebts.map(d => d.customer_name))].sort()

      let msg = `❌ No debtor found matching "${searchName}"`

      if (allNames.length > 0) {
        msg += `\n\nCurrent debtors:\n`
        allNames.forEach(name => {
          msg += `• ${name}\n`
        })
        msg += `\nTry: "remind ${allNames[0]}"`
      }

      await sendMessage(waUser.wa_phone, msg)
      return
    }

    if (matches.length > 1) {
      // Multiple matches - ask user to be more specific
      let msg = `❓ Multiple matches found for "${searchName}":\n\n`
      matches.forEach(name => {
        msg += `• ${name}\n`
      })
      msg += `\nPlease be more specific. Example: "remind ${matches[0]}"`

      await sendMessage(waUser.wa_phone, msg)
      return
    }

    // Exactly one match - proceed with reminder
    const customerName = matches[0]
    const debts = await getCustomerDebts(waUser.business_id!, customerName)

    if (debts.length === 0) {
      await sendMessage(waUser.wa_phone, `${customerName} has no outstanding debts`)
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
      const matchedName = result.matchedName || customerName
      await sendMessage(
        waUser.wa_phone,
        `✅ Saved ${matchedName}'s number!\n\n` +
        `You can now send reminders: "remind ${matchedName}"`
      )
    } else {
      await sendMessage(waUser.wa_phone, `❌ ${result.error}`)
    }

  } catch (error) {
    console.error('Error saving phone:', error)
    await sendMessage(waUser.wa_phone, '❌ Failed to save phone number')
  }
}

/**
 * Handle "mark [customer] paid" command
 * Uses fuzzy matching and disambiguation
 */
async function handleMarkPaidCommand(waUser: WhatsAppUser, message: string): Promise<void> {
  try {
    // Parse: "mark Mama Nkechi paid"
    const searchName = message
      .toLowerCase()
      .replace('mark ', '')
      .replace(' paid', '')
      .trim()

    if (!searchName) {
      await sendMessage(waUser.wa_phone, '❌ Format: "mark Mama Nkechi paid"')
      return
    }

    // Find matching customer names
    const { matches } = await findCustomerNameMatches(waUser.business_id!, searchName)

    if (matches.length === 0) {
      // No matches - show current debtor names for reference
      const allDebts = await getBusinessDebts(waUser.business_id!)
      const allNames = [...new Set(allDebts.map(d => d.customer_name))].sort()

      let msg = `❌ No debtor found matching "${searchName}"`

      if (allNames.length > 0) {
        msg += `\n\nCurrent debtors:\n`
        allNames.forEach(name => {
          msg += `• ${name}\n`
        })
      }

      await sendMessage(waUser.wa_phone, msg)
      return
    }

    if (matches.length > 1) {
      // Multiple matches - ask user to be more specific
      let msg = `❓ Multiple matches found for "${searchName}":\n\n`
      matches.forEach(name => {
        msg += `• ${name}\n`
      })
      msg += `\nPlease be more specific.`

      await sendMessage(waUser.wa_phone, msg)
      return
    }

    // Exactly one match - proceed with marking paid
    const customerName = matches[0]
    const debts = await getCustomerDebts(waUser.business_id!, customerName)

    if (debts.length === 0) {
      await sendMessage(waUser.wa_phone, `${customerName} has no outstanding debts`)
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
 * Handle cleanup debts command
 * Fixes ghost debtors (pronouns as names) and consolidates duplicates
 */
async function handleCleanupDebtsCommand(waUser: WhatsAppUser): Promise<void> {
  try {
    await sendMessage(waUser.wa_phone, '🧹 Starting debt cleanup...')

    const { autoCleanupBadDebtors, consolidateDuplicateDebtors, formatBadDebtorClarificationMessage } =
      await import('./debt-cleanup')

    // Step 1: Consolidate duplicates (Clara, clara, CLARA → Clara)
    const consolidateResult = await consolidateDuplicateDebtors(waUser.business_id!)

    // Step 2: Auto-cleanup bad names (pronouns → real names where confident)
    const cleanupResult = await autoCleanupBadDebtors(waUser.business_id!)

    // Format result message
    let message = `✅ *Cleanup complete!*\n\n`

    if (consolidateResult.consolidated > 0) {
      message += `📝 Fixed ${consolidateResult.consolidated} duplicate name${consolidateResult.consolidated === 1 ? '' : 's'}\n`
    }

    if (cleanupResult.merged > 0) {
      message += `🔗 Merged ${cleanupResult.merged} debt${cleanupResult.merged === 1 ? '' : 's'} with bad names\n`
    }

    if (consolidateResult.consolidated === 0 && cleanupResult.merged === 0 && cleanupResult.flaggedForUser.length === 0) {
      message += `No issues found - all debtor names are clean! 🎉\n`
    }

    await sendMessage(waUser.wa_phone, message)

    // If there are debts flagged for user clarification, ask about each one
    if (cleanupResult.flaggedForUser.length > 0) {
      await sendMessage(
        waUser.wa_phone,
        `⚠️ Found ${cleanupResult.flaggedForUser.length} debt${cleanupResult.flaggedForUser.length === 1 ? '' : 's'} that need${cleanupResult.flaggedForUser.length === 1 ? 's' : ''} your help...\n\n` +
        `I'll ask you about each one.`
      )

      // Get valid debtor names for suggestions (filter out bad names)
      const allDebts = await getBusinessDebts(waUser.business_id!)
      const validNames = [...new Set(allDebts.map(d => d.customer_name).filter(name => !isNonName(name)))].sort()

      // Ask about first flagged debt
      const firstFlagged = cleanupResult.flaggedForUser[0]
      const clarificationMsg = formatBadDebtorClarificationMessage(
        firstFlagged.name,
        firstFlagged.balance,
        firstFlagged.count,
        validNames.slice(0, 5)  // Show top 5 suggestions
      )

      await sendMessage(waUser.wa_phone, clarificationMsg)

      // TODO: Handle user's response to rename the debt
      // For now, they'll need to manually fix via database or we can add a follow-up handler
    }

  } catch (error) {
    console.error('Error cleaning up debts:', error)
    await sendMessage(waUser.wa_phone, '❌ Failed to cleanup debts')
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
    ? `📚 *Wetin FLOIN Fit Do*\n\n` +
      `*📝 Log sales & expenses:*\n` +
      `"I sell 3 bags 45k" or 🎤 voice note\n` +
      `"I spend 10k for fuel"\n` +
      `"I take 20k for myself" (owner chop)\n\n` +
      `*💳 Credit & Loans:*\n` +
      `"Mama carry 1 bag on credit 15k"\n` +
      `"I lend Musa 5k"\n` +
      `"Clara don pay 3k"\n\n` +
      `*👥 Check who owe you:*\n` +
      `"Who dey owe me?"\n` +
      `"Remind Mama Nkechi"\n` +
      `"Mama phone is 080..."\n\n` +
      `*🧹 Fix/Clear entries:*\n` +
      `"Clear Clara debt" (write off)\n` +
      `"Delete that last one" (undo)\n` +
      `"Change last sale to 7k" (edit)\n\n` +
      `*📊 Check your money:*\n` +
      `"How much I make today?"\n` +
      `"Show me this week summary"\n` +
      `"Wetin be my profit?"\n\n` +
      `Any question? Just ask! 😊`
    : `📚 *What FLOIN Can Do*\n\n` +
      `*📝 Log sales & expenses:*\n` +
      `"Sold 3 bags 45k" or 🎤 voice note\n` +
      `"Spent 10k on fuel"\n` +
      `"Took 20k for myself" (personal)\n\n` +
      `*💳 Credit & Loans:*\n` +
      `"Mama bought 1 bag on credit 15k"\n` +
      `"Lent Musa 5k"\n` +
      `"Clara paid 3k"\n\n` +
      `*👥 Check who owes you:*\n` +
      `"Who owes me?"\n` +
      `"Remind Mama Nkechi"\n` +
      `"Mama's phone is 080..."\n\n` +
      `*🧹 Fix/Clear entries:*\n` +
      `"Write off Clara's debt" (forgive)\n` +
      `"Delete that last one" (undo)\n` +
      `"Change last sale to 7k" (edit)\n\n` +
      `*📊 Check your money:*\n` +
      `"How much today?"\n` +
      `"Show this week's summary"\n` +
      `"What's my profit?"\n\n` +
      `Questions? Just ask! 😊`

  await sendMessage(waUser.wa_phone, helpMessage)
}

/**
 * Handle write off debt (forgive without payment)
 * NEW: Supports "clear the debt", "forget am", "write off"
 */
async function handleWriteOffDebt(waUser: WhatsAppUser, intent: ParsedIntent, autoSavePrefix: string = ''): Promise<void> {
  try {
    // Get debtor name from intent
    let debtorName = intent.party

    if (!debtorName) {
      // No name provided - list current debtors and ask
      const allDebts = await getBusinessDebts(waUser.business_id!)
      if (allDebts.length === 0) {
        await sendMessage(waUser.wa_phone, autoSavePrefix + '✅ No outstanding debts to clear!')
        return
      }

      const uniqueDebtors = [...new Set(allDebts.map(d => d.customer_name))].sort()
      if (uniqueDebtors.length === 1) {
        // Only one debtor - use them
        debtorName = uniqueDebtors[0]
      } else {
        // Multiple debtors - ask which one
        let msg = autoSavePrefix + `Whose debt you wan clear?\n\n`
        uniqueDebtors.forEach(name => {
          msg += `• ${name}\n`
        })
        msg += `\nReply with the name.`
        await sendMessage(waUser.wa_phone, msg)
        return
      }
    }

    // Find matching customer debts using fuzzy matching
    const { matches } = await findCustomerNameMatches(waUser.business_id!, debtorName)

    if (matches.length === 0) {
      await sendMessage(waUser.wa_phone, autoSavePrefix + `❌ No debtor found matching "${debtorName}"`)
      return
    }

    if (matches.length > 1) {
      let msg = autoSavePrefix + `❓ Multiple matches for "${debtorName}":\n\n`
      matches.forEach(name => { msg += `• ${name}\n` })
      msg += `\nBe more specific.`
      await sendMessage(waUser.wa_phone, msg)
      return
    }

    // Exactly one match
    const matchedName = matches[0]
    const debts = await getCustomerDebts(waUser.business_id!, matchedName)

    if (debts.length === 0) {
      await sendMessage(waUser.wa_phone, autoSavePrefix + `${matchedName} has no outstanding debts.`)
      return
    }

    const totalOwed = debts.reduce((sum, d) => sum + d.balance_kobo, 0)

    // Ask for confirmation
    const confirmMsg = autoSavePrefix +
      `⚠️ *Write off ${matchedName}'s debt?*\n\n` +
      `Amount: ${formatNaira(totalOwed)}\n` +
      `Debts: ${debts.length}\n\n` +
      `This removes the debt WITHOUT payment (no cash added).\n\n` +
      `Reply *1* to write off ✅\nReply *2* to cancel ❌`

    await sendMessage(waUser.wa_phone, confirmMsg)

    // Create a pending action for confirmation
    const pendingId = generateId()
    await supabase
      .from('whatsapp_pending_actions')
      .insert({
        id: pendingId,
        wa_phone: waUser.wa_phone,
        business_id: waUser.business_id!,
        action_type: 'write_off',
        intent_data: { party: matchedName, debts: debts.map(d => d.id), amount_kobo: totalOwed },
        confirmation_message: confirmMsg,
        status: 'pending',
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      })

  } catch (error) {
    console.error('Error handling write off:', error)
    await sendMessage(waUser.wa_phone, '❌ Failed to process write off')
  }
}

/**
 * Handle delete entry (undo last entry)
 * NEW: Supports "delete that last one", "undo", "cancel that sale"
 */
async function handleDeleteEntry(waUser: WhatsAppUser, intent: ParsedIntent, autoSavePrefix: string = ''): Promise<void> {
  try {
    // Find most recent entry for this business
    // Check sales_entries first (most common)
    const { data: recentSale } = await supabase
      .from('sales_entries')
      .select('*')
      .eq('business_id', waUser.business_id!)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    // Check expenses
    const { data: recentExpense } = await supabase
      .from('whatsapp_expenses')
      .select('*')
      .eq('business_id', waUser.business_id!)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    // Find which is most recent
    let entryType: 'sale' | 'expense' | null = null
    let entryData: any = null
    let entryDate: Date | null = null

    if (recentSale && recentExpense) {
      const saleDate = new Date(recentSale.created_at)
      const expenseDate = new Date(recentExpense.created_at)
      if (saleDate > expenseDate) {
        entryType = 'sale'
        entryData = recentSale
        entryDate = saleDate
      } else {
        entryType = 'expense'
        entryData = recentExpense
        entryDate = expenseDate
      }
    } else if (recentSale) {
      entryType = 'sale'
      entryData = recentSale
      entryDate = new Date(recentSale.created_at)
    } else if (recentExpense) {
      entryType = 'expense'
      entryData = recentExpense
      entryDate = new Date(recentExpense.created_at)
    }

    if (!entryType || !entryData) {
      await sendMessage(waUser.wa_phone, autoSavePrefix + '📝 No recent entries to delete.')
      return
    }

    // Format description
    const timeAgo = Math.floor((Date.now() - entryDate!.getTime()) / (1000 * 60))
    const timeStr = timeAgo < 60 ? `${timeAgo} min${timeAgo === 1 ? '' : 's'} ago` : `${Math.floor(timeAgo / 60)} hour${Math.floor(timeAgo / 60) === 1 ? '' : 's'} ago`

    let description = ''
    if (entryType === 'sale') {
      description = `Sale: ${formatNaira(entryData.amount * 100)}`
      if (entryData.note) description += ` (${entryData.note})`
    } else {
      description = `Expense: ${formatNaira(entryData.amount_kobo)}`
      if (entryData.note) description += ` (${entryData.note})`
    }

    const confirmMsg = autoSavePrefix +
      `🗑️ *Delete this entry?*\n\n` +
      `${description}\n` +
      `Created: ${timeStr}\n\n` +
      `Reply *1* to delete ✅\nReply *2* to cancel ❌`

    await sendMessage(waUser.wa_phone, confirmMsg)

    // Create pending action
    const pendingId = generateId()
    await supabase
      .from('whatsapp_pending_actions')
      .insert({
        id: pendingId,
        wa_phone: waUser.wa_phone,
        business_id: waUser.business_id!,
        action_type: 'delete_entry',
        intent_data: { entry_type: entryType, entry_id: entryData.id },
        confirmation_message: confirmMsg,
        status: 'pending',
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      })

  } catch (error) {
    console.error('Error handling delete entry:', error)
    await sendMessage(waUser.wa_phone, '❌ Failed to process delete')
  }
}

/**
 * Handle edit entry (change amount/description)
 * NEW: Supports "change the last sale to 7000", "that fuel na 2500 not 2000"
 */
async function handleEditEntry(waUser: WhatsAppUser, intent: ParsedIntent, autoSavePrefix: string = ''): Promise<void> {
  try {
    // Extract new amount from intent
    const newAmountKobo = intent.amount_kobo

    if (!newAmountKobo) {
      await sendMessage(
        waUser.wa_phone,
        autoSavePrefix + '❓ What\'s the new amount?\n\nExample: "change last sale to 7000"'
      )
      return
    }

    // Find most recent entry (similar to delete logic)
    const { data: recentSale } = await supabase
      .from('sales_entries')
      .select('*')
      .eq('business_id', waUser.business_id!)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const { data: recentExpense } = await supabase
      .from('whatsapp_expenses')
      .select('*')
      .eq('business_id', waUser.business_id!)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    let entryType: 'sale' | 'expense' | null = null
    let entryData: any = null

    if (recentSale && recentExpense) {
      const saleDate = new Date(recentSale.created_at)
      const expenseDate = new Date(recentExpense.created_at)
      entryType = saleDate > expenseDate ? 'sale' : 'expense'
      entryData = saleDate > expenseDate ? recentSale : recentExpense
    } else if (recentSale) {
      entryType = 'sale'
      entryData = recentSale
    } else if (recentExpense) {
      entryType = 'expense'
      entryData = recentExpense
    }

    if (!entryType || !entryData) {
      await sendMessage(waUser.wa_phone, autoSavePrefix + '📝 No recent entries to edit.')
      return
    }

    const oldAmount = entryType === 'sale' ? entryData.amount * 100 : entryData.amount_kobo
    const confirmMsg = autoSavePrefix +
      `✏️ *Edit this entry?*\n\n` +
      `Type: ${entryType === 'sale' ? 'Sale' : 'Expense'}\n` +
      `Old: ${formatNaira(oldAmount)}\n` +
      `New: ${formatNaira(newAmountKobo)}\n\n` +
      `Reply *1* to save ✅\nReply *2* to cancel ❌`

    await sendMessage(waUser.wa_phone, confirmMsg)

    // Create pending action
    const pendingId = generateId()
    await supabase
      .from('whatsapp_pending_actions')
      .insert({
        id: pendingId,
        wa_phone: waUser.wa_phone,
        business_id: waUser.business_id!,
        action_type: 'edit_entry',
        intent_data: {
          entry_type: entryType,
          entry_id: entryData.id,
          old_amount_kobo: oldAmount,
          new_amount_kobo: newAmountKobo
        },
        confirmation_message: confirmMsg,
        status: 'pending',
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      })

  } catch (error) {
    console.error('Error handling edit entry:', error)
    await sendMessage(waUser.wa_phone, '❌ Failed to process edit')
  }
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
