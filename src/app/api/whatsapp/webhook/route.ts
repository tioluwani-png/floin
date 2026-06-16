import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { processMessage } from '@/lib/whatsapp/router'

// Server-side Supabase client with service role key (bypasses RLS)
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

// Generate unique ID (timestamp-based)
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * GET handler for Meta webhook verification handshake
 * Called once when setting up the webhook URL in Meta Business Manager
 */
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  // Verify the token matches our environment variable
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('✅ Webhook verified')
    return new NextResponse(challenge, { status: 200 })
  }

  console.error('❌ Webhook verification failed')
  return new NextResponse('Forbidden', { status: 403 })
}

/**
 * POST handler for incoming WhatsApp messages
 * Must return 200 within 5 seconds or Meta will retry
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Verify WhatsApp signature (X-Hub-Signature-256)
    const rawBody = await req.text()
    const signature = req.headers.get('x-hub-signature-256')

    if (!signature) {
      console.error('❌ No signature header')
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', process.env.WHATSAPP_APP_SECRET!)
      .update(rawBody)
      .digest('hex')

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      console.error('❌ Invalid signature')
      return new NextResponse('Unauthorized', { status: 401 })
    }

    // 2. Parse webhook payload
    const body = JSON.parse(rawBody)

    // 3. Extract message from webhook structure
    const entry = body?.entry?.[0]
    const change = entry?.changes?.[0]
    const value = change?.value
    const messages = value?.messages

    if (!messages || messages.length === 0) {
      // Not a message event (could be status update, etc.)
      return NextResponse.json({ status: 'ok' }, { status: 200 })
    }

    const message = messages[0]
    const waPhone = message.from
    const waMessageId = message.id
    const messageType = message.type

    // Extract message body based on type
    let messageBody = null
    let mediaUrl = null
    let mediaMimeType = null

    switch (messageType) {
      case 'text':
        messageBody = message.text?.body
        break
      case 'audio':
        mediaUrl = message.audio?.id
        mediaMimeType = message.audio?.mime_type
        break
      case 'image':
        mediaUrl = message.image?.id
        mediaMimeType = message.image?.mime_type
        break
      case 'document':
        mediaUrl = message.document?.id
        mediaMimeType = message.document?.mime_type
        break
      default:
        messageBody = `[Unsupported message type: ${messageType}]`
    }

    // 4. Insert to whatsapp_messages_raw (dedupe on wa_message_id)
    const messageId = generateId()

    const { error: insertError } = await supabase
      .from('whatsapp_messages_raw')
      .insert({
        id: messageId,
        wa_message_id: waMessageId,
        wa_phone: waPhone,
        direction: 'inbound',
        message_type: messageType,
        body: messageBody,
        media_url: mediaUrl,
        media_mime_type: mediaMimeType,
        received_at: new Date().toISOString(),
        processed: false,
        raw_payload: body
      })

    if (insertError) {
      // Check if it's a duplicate (unique constraint violation)
      if (insertError.code === '23505') {
        console.log(`⚠️ Duplicate message (retry): ${waMessageId}`)
        return NextResponse.json({ status: 'duplicate' }, { status: 200 })
      }

      console.error('❌ Failed to insert message:', insertError)
      throw insertError
    }

    console.log(`✅ Message stored: ${waMessageId} from ${waPhone}`)

    // 5. Process message asynchronously (non-blocking)
    // Note: In production with Vercel, use waitUntil() for better async handling
    processMessage(messageId).catch(error => {
      console.error('Background processing error:', error)
    })

    // 6. Return 200 immediately
    return NextResponse.json({ status: 'received' }, { status: 200 })

  } catch (error) {
    console.error('❌ Webhook error:', error)
    // Still return 200 to prevent Meta from retrying
    // Log the error for monitoring
    return NextResponse.json({ status: 'error' }, { status: 200 })
  }
}
