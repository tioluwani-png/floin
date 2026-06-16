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

    // Other media types not supported yet
    if (messageType !== 'text') {
      await sendMessage(
        waPhone,
        '📸 Images and documents coming soon! For now, please send text or voice messages.'
      )
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

  if (pending && pending.action_type !== 'clarifying') {
    await handleConfirmationReply(waUser, messageBody, pending)
    return
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
    await handleQuery(waUser, messageBody)
    return
  }

  // Default: Parse as sale intent
  await handleSaleIntent(waUser, messageBody)
}

/**
 * Handle confirmation reply (yes/no)
 */
async function handleConfirmationReply(
  waUser: WhatsAppUser,
  message: string,
  pending: any
): Promise<void> {
  const normalized = message.toLowerCase().trim()

  // Check for positive confirmation
  if (
    normalized === 'yes' ||
    normalized === 'ok' ||
    normalized === 'okay' ||
    normalized === 'confirm' ||
    normalized === '1' ||
    normalized === 'correct' ||
    normalized === 'yeah'
  ) {
    // Commit the pending action
    const result = await commitPendingAction(pending.id)

    if (!result.success) {
      await sendMessage(
        waUser.wa_phone,
        `❌ Failed to save: ${result.error}\n\nPlease try again.`
      )
    }
    return
  }

  // Check for negative response
  if (
    normalized === 'no' ||
    normalized === 'cancel' ||
    normalized === '2' ||
    normalized === 'wrong'
  ) {
    await rejectPendingAction(pending.id)
    await sendMessage(
      waUser.wa_phone,
      '❌ Cancelled. Send a new message to try again.'
    )
    return
  }

  // Ambiguous response - re-prompt
  await sendMessage(
    waUser.wa_phone,
    'Please reply "Yes" to confirm or "No" to cancel.'
  )
}

/**
 * Handle sale intent (main use case)
 */
async function handleSaleIntent(waUser: WhatsAppUser, messageBody: string): Promise<void> {
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
          clarificationPending.partial_parse as Partial<ParsedIntent>
        )
      }

      // Delete the clarification pending action
      await supabase
        .from('whatsapp_pending_actions')
        .delete()
        .eq('id', clarificationPending.id)

    } else {
      // Normal parse (no clarification context)
      intent = await parseMessage(messageBody, {
        businessName: 'Business', // TODO: Fetch from business table
        currency: 'NGN'
      })
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
      await handleQuery(waUser, intent.query_text || messageBody)
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
 * Handle query messages
 */
async function handleQuery(waUser: WhatsAppUser, query: string): Promise<void> {
  const normalized = query.toLowerCase()

  if (normalized.includes('today') || normalized.includes('dis day')) {
    await handleTodayQuery(waUser)
    return
  }

  if (normalized.includes('week')) {
    await handleWeekQuery(waUser)
    return
  }

  if (normalized.includes('owe') || normalized.includes('debt') || normalized.includes('credit')) {
    await handleDebtQuery(waUser)
    return
  }

  // Default: show help
  await handleHelpCommand(waUser)
}

/**
 * Handle "how much today?" query
 */
async function handleTodayQuery(waUser: WhatsAppUser): Promise<void> {
  try {
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Africa/Lagos'
    })

    const { data: sales, error } = await supabase
      .from('sales_entries')
      .select('amount, units')
      .eq('business_id', waUser.business_id!)
      .eq('date', today)

    if (error) throw error

    const totalNaira = (sales || []).reduce((sum, s) => sum + Number(s.amount), 0)
    const totalUnits = (sales || []).reduce((sum, s) => sum + s.units, 0)
    const count = sales?.length || 0

    const message = `📊 *Today's Summary*\n\n` +
      `💰 Total sales: ${formatNaira(Math.round(totalNaira * 100))}\n` +
      `📦 Units sold: ${totalUnits}\n` +
      `📋 Transactions: ${count}`

    await sendMessage(waUser.wa_phone, message)

  } catch (error) {
    console.error('Error handling today query:', error)
    await sendMessage(waUser.wa_phone, '❌ Failed to get today\'s summary')
  }
}

/**
 * Handle "this week" query
 */
async function handleWeekQuery(waUser: WhatsAppUser): Promise<void> {
  // TODO: Implement week query
  await sendMessage(waUser.wa_phone, '📊 Weekly summary coming soon!')
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
 * State transitions: new → asked_name → asked_biz → first_sale → done
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

  // State: asked_name → Save name, ask for business name
  if (currentState === 'asked_name') {
    const userName = message.substring(0, 50).trim()

    await supabase
      .from('whatsapp_users')
      .update({
        owner_name: userName,
        onboarding_state: 'asked_biz'
      })
      .eq('id', waUser.id)

    await sendMessage(
      waUser.wa_phone,
      `Nice to meet you, ${userName}! 😊\n\n` +
      `What's the name of your business?`
    )
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

    await sendMessage(
      waUser.wa_phone,
      `Perfect! 🎉\n\n` +
      `${businessName} is all set up.\n\n` +
      `Now, tell me about your first sale today. Examples:\n` +
      `• "Sold 3 bags for 45k"\n` +
      `• "I sell 2 bottles 500 naira"\n` +
      `• 🎤 Or send a voice note!\n\n` +
      `Type "help" anytime if you need assistance.`
    )
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
  const helpMessage = `📚 *FLOIN Help*\n\n` +
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
