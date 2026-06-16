/**
 * Cleanup Expired Pending Actions Cron
 * Runs every 15 minutes to expire old pending confirmations
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendMessage } from '@/lib/whatsapp/api-client'

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

export async function GET(req: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    console.log('🧹 Running cleanup expired actions cron...')

    // Find expired pending actions
    const { data: expiredActions, error: fetchError } = await supabase
      .from('whatsapp_pending_actions')
      .select('*')
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString())

    if (fetchError) {
      console.error('Error fetching expired actions:', fetchError)
      throw fetchError
    }

    if (!expiredActions || expiredActions.length === 0) {
      console.log('✅ No expired actions to clean up')
      return NextResponse.json({
        success: true,
        expired: 0,
        message: 'No expired actions'
      })
    }

    console.log(`Found ${expiredActions.length} expired actions`)

    // Update status to expired
    const expiredIds = expiredActions.map(a => a.id)

    const { error: updateError } = await supabase
      .from('whatsapp_pending_actions')
      .update({ status: 'expired' })
      .in('id', expiredIds)

    if (updateError) {
      console.error('Error updating expired actions:', updateError)
      throw updateError
    }

    // Optionally notify users (gentle reminder, not pushy)
    let notifiedCount = 0

    for (const action of expiredActions) {
      try {
        // Only notify if it expired less than 1 hour ago (don't spam old ones)
        const expiredAt = new Date(action.expires_at)
        const now = new Date()
        const hoursSinceExpiry = (now.getTime() - expiredAt.getTime()) / (1000 * 60 * 60)

        if (hoursSinceExpiry < 1) {
          await sendMessage(
            action.wa_phone,
            `⏰ Your pending transaction expired.\n\n` +
            `Send it again if you still want to save it!`
          )
          notifiedCount++
        }
      } catch (error) {
        console.error('Error notifying user:', error)
        // Continue with other notifications
      }
    }

    console.log(`✅ Expired ${expiredActions.length} actions, notified ${notifiedCount} users`)

    return NextResponse.json({
      success: true,
      expired: expiredActions.length,
      notified: notifiedCount
    })

  } catch (error) {
    console.error('❌ Cleanup cron error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
