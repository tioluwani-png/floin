/**
 * Voice Note Transcription
 * Uses OpenAI Whisper API to transcribe voice notes
 */

import OpenAI from 'openai'
import { downloadMedia } from './api-client'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

/**
 * Transcribe a voice note from WhatsApp
 */
export async function transcribeVoiceNote(
  mediaId: string,
  mediaMimeType?: string
): Promise<{ success: boolean; text?: string; error?: string }> {
  try {
    console.log(`🎤 Transcribing voice note: ${mediaId}`)

    // Download audio from WhatsApp
    const audioBuffer = await downloadMedia(mediaId)

    if (!audioBuffer) {
      return {
        success: false,
        error: 'Failed to download audio file'
      }
    }

    // Determine file extension from MIME type
    const extension = getAudioExtension(mediaMimeType)

    // Create a File object for Whisper API
    // Whisper expects a File with proper name and type
    // Convert Buffer to Uint8Array for browser compatibility
    const audioFile = new File(
      [new Uint8Array(audioBuffer)],
      `audio.${extension}`,
      { type: mediaMimeType || 'audio/ogg' }
    )

    // Transcribe with Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'en', // Hint: English (works for Pidgin too)
      response_format: 'text',
      temperature: 0 // More deterministic
    })

    // response_format: 'text' returns a string directly
    const text = transcription as string

    if (!text || text.trim().length === 0) {
      return {
        success: false,
        error: 'Empty transcription'
      }
    }

    console.log(`✅ Transcription: "${text}"`)

    return {
      success: true,
      text: text.trim()
    }

  } catch (error) {
    console.error('❌ Transcription error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Get audio file extension from MIME type
 */
function getAudioExtension(mimeType?: string): string {
  if (!mimeType) return 'ogg'

  const mimeToExt: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/amr': 'amr',
    'audio/wav': 'wav'
  }

  return mimeToExt[mimeType.toLowerCase()] || 'ogg'
}

/**
 * Check if audio duration is reasonable (< 2 minutes for sales logging)
 * WhatsApp provides duration in metadata, but we can estimate from file size
 */
export function isReasonableAudioLength(audioBuffer: Buffer): boolean {
  // Rough estimate: typical voice note is ~10-30KB per second
  // 2 minutes = 120 seconds = ~1.2-3.6MB
  // Let's cap at 5MB to be safe
  const maxSizeBytes = 5 * 1024 * 1024 // 5MB
  return audioBuffer.length <= maxSizeBytes
}
