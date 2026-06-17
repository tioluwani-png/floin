/**
 * Voice Transcription Pipeline
 * Fetches WhatsApp audio, transcribes via Whisper, returns text
 */

import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
})

interface TranscriptionResult {
  success: boolean
  text?: string
  confidence?: 'high' | 'medium' | 'low'
  error?: string
}

/**
 * Fetch WhatsApp media URL from Graph API
 */
async function getMediaUrl(mediaId: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${mediaId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`
        }
      }
    )

    if (!response.ok) {
      console.error('Failed to get media URL:', await response.text())
      return null
    }

    const data = await response.json()
    return data.url || null

  } catch (error) {
    console.error('Error fetching media URL:', error)
    return null
  }
}

/**
 * Download audio bytes from WhatsApp CDN
 */
async function downloadAudio(mediaUrl: string): Promise<Buffer | null> {
  try {
    const response = await fetch(mediaUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`
      }
    })

    if (!response.ok) {
      console.error('Failed to download audio:', response.status)
      return null
    }

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)

  } catch (error) {
    console.error('Error downloading audio:', error)
    return null
  }
}

/**
 * Transcribe audio using OpenAI Whisper
 */
async function transcribeAudio(audioBuffer: Buffer): Promise<TranscriptionResult> {
  try {
    // Create a File from the buffer for Whisper API
    // Convert Buffer to Uint8Array for compatibility
    const audioArray = new Uint8Array(audioBuffer)
    const audioFile = new File([audioArray], 'voice.ogg', {
      type: 'audio/ogg'
    })

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'en', // Hint: English (handles Nigerian English well)
      response_format: 'json'
    })

    const text = transcription.text?.trim()

    if (!text || text.length === 0) {
      return {
        success: false,
        error: 'Empty transcription'
      }
    }

    // Heuristic confidence check
    // If transcript is very short or has lots of [inaudible] markers, flag low confidence
    const confidence = text.length < 5 || text.toLowerCase().includes('[inaudible]')
      ? 'low'
      : text.length < 15
        ? 'medium'
        : 'high'

    return {
      success: true,
      text,
      confidence
    }

  } catch (error) {
    console.error('Error transcribing audio:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown transcription error'
    }
  }
}

/**
 * Main pipeline: WhatsApp media ID → transcript text
 */
export async function transcribeWhatsAppVoiceNote(
  mediaId: string
): Promise<TranscriptionResult> {
  try {
    console.log(`🎤 Transcribing voice note: ${mediaId}`)

    // Step 1: Get media URL
    const mediaUrl = await getMediaUrl(mediaId)
    if (!mediaUrl) {
      return {
        success: false,
        error: 'Failed to fetch media URL from WhatsApp'
      }
    }

    console.log(`📥 Downloading audio from: ${mediaUrl}`)

    // Step 2: Download audio bytes
    const audioBuffer = await downloadAudio(mediaUrl)
    if (!audioBuffer) {
      return {
        success: false,
        error: 'Failed to download audio file'
      }
    }

    console.log(`🔊 Audio downloaded: ${audioBuffer.length} bytes`)

    // Step 3: Transcribe
    const result = await transcribeAudio(audioBuffer)

    if (result.success) {
      console.log(`✅ Transcribed: "${result.text}"`)
    } else {
      console.error(`❌ Transcription failed: ${result.error}`)
    }

    return result

  } catch (error) {
    console.error('Voice transcription pipeline error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Format friendly error message for user (language-aware)
 */
export function formatTranscriptionError(languagePref?: string): string {
  if (languagePref === 'pidgin') {
    return 'I no fit hear that one well 🙏 — try talk am again or type am.'
  }
  return 'I couldn\'t hear that clearly 🙏 — please try speaking again or type your message.'
}
