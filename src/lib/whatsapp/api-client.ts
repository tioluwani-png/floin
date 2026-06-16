/**
 * WhatsApp Cloud API Client
 * Handles all interactions with WhatsApp Cloud API
 */

const WHATSAPP_API_URL = 'https://graph.facebook.com/v21.0'
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID
const ACCESS_TOKEN = process.env.WHATSAPP_TOKEN

interface TextMessage {
  type: 'text'
  text: { body: string }
}

interface InteractiveButtonMessage {
  type: 'interactive'
  interactive: {
    type: 'button'
    body: { text: string }
    action: {
      buttons: Array<{
        type: 'reply'
        reply: {
          id: string
          title: string
        }
      }>
    }
  }
}

type MessagePayload = TextMessage | InteractiveButtonMessage

/**
 * Send a text message to a WhatsApp number
 */
export async function sendMessage(
  waPhone: string,
  body: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const payload: TextMessage = {
      type: 'text',
      text: { body }
    }

    return await sendWhatsAppMessage(waPhone, payload)
  } catch (error) {
    console.error('Failed to send message:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Send an interactive button message
 */
export async function sendButtonMessage(
  waPhone: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const payload: InteractiveButtonMessage = {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.map(btn => ({
            type: 'reply',
            reply: {
              id: btn.id,
              title: btn.title.substring(0, 20) // WhatsApp limit: 20 chars
            }
          }))
        }
      }
    }

    return await sendWhatsAppMessage(waPhone, payload)
  } catch (error) {
    console.error('Failed to send button message:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Core function to send any message via WhatsApp Cloud API
 */
async function sendWhatsAppMessage(
  waPhone: string,
  payload: MessagePayload
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    throw new Error('WhatsApp credentials not configured')
  }

  const response = await fetch(
    `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: waPhone,
        ...payload
      })
    }
  )

  const result = await response.json()

  if (!response.ok) {
    console.error('WhatsApp API error:', result)
    return {
      success: false,
      error: result.error?.message || 'Failed to send message'
    }
  }

  // Store outbound message in database for audit trail
  await logOutboundMessage(waPhone, payload, result.messages[0].id)

  return {
    success: true,
    messageId: result.messages[0].id
  }
}

/**
 * Download media file from WhatsApp
 */
export async function downloadMedia(mediaId: string): Promise<Buffer | null> {
  try {
    if (!ACCESS_TOKEN) {
      throw new Error('WhatsApp token not configured')
    }

    // Step 1: Get media URL
    const urlResponse = await fetch(
      `${WHATSAPP_API_URL}/${mediaId}`,
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`
        }
      }
    )

    if (!urlResponse.ok) {
      console.error('Failed to get media URL')
      return null
    }

    const urlData = await urlResponse.json()
    const mediaUrl = urlData.url

    // Step 2: Download the actual file
    const fileResponse = await fetch(mediaUrl, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`
      }
    })

    if (!fileResponse.ok) {
      console.error('Failed to download media file')
      return null
    }

    const arrayBuffer = await fileResponse.arrayBuffer()
    return Buffer.from(arrayBuffer)

  } catch (error) {
    console.error('Error downloading media:', error)
    return null
  }
}

/**
 * Log outbound messages to database for audit trail
 */
async function logOutboundMessage(
  waPhone: string,
  payload: MessagePayload,
  waMessageId: string
): Promise<void> {
  try {
    const { createClient } = await import('@supabase/supabase-js')

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

    // Extract body text from payload
    let body = ''
    if (payload.type === 'text') {
      body = payload.text.body
    } else if (payload.type === 'interactive') {
      body = payload.interactive.body.text
    }

    const messageId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

    await supabase.from('whatsapp_messages_raw').insert({
      id: messageId,
      wa_message_id: waMessageId,
      wa_phone: waPhone,
      direction: 'outbound',
      message_type: payload.type,
      body,
      received_at: new Date().toISOString(),
      processed: true, // Outbound messages are immediately processed
      raw_payload: payload
    })
  } catch (error) {
    // Don't throw - logging failure shouldn't break message sending
    console.error('Failed to log outbound message:', error)
  }
}

/**
 * Format currency in Naira
 */
export function formatNaira(kobo: number): string {
  const naira = kobo / 100
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

/**
 * Format date in readable format
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-NG', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

/**
 * Check if user messaged within the last 24 hours (service window)
 * If yes, we can send free-form messages
 * If no, we need to use template messages (paid)
 */
export function isWithinServiceWindow(lastMessageAt: Date | string): boolean {
  const lastMessage = new Date(lastMessageAt)
  const now = new Date()
  const hoursSince = (now.getTime() - lastMessage.getTime()) / (1000 * 60 * 60)
  return hoursSince < 24
}
