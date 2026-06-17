/**
 * Daily Summary Cron - The Retention Engine
 * Runs every day at 9pm WAT to send daily summaries to all active users
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendMessage, formatNaira, isWithinServiceWindow } from '@/lib/whatsapp/api-client'
import { getDailyTotals, getDateRange } from '@/lib/whatsapp/daily-totals'

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

interface WhatsAppUser {
  id: string
  wa_phone: string
  business_id: string | null
  subscription_status: string
  last_message_at: string | null
}

export async function GET(req: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    console.log('📊 Running daily summary cron at 9pm WAT...')

    // Get today's date in Lagos timezone
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Africa/Lagos'
    })

    // Fetch all active WhatsApp users with businesses
    const { data: users, error: usersError } = await supabase
      .from('whatsapp_users')
      .select('id, wa_phone, business_id, subscription_status, last_message_at')
      .eq('is_active', true)
      .not('business_id', 'is', null)
      .in('subscription_status', ['trial', 'active'])

    if (usersError) {
      console.error('Error fetching users:', usersError)
      throw usersError
    }

    if (!users || users.length === 0) {
      console.log('No active users to send summaries to')
      return NextResponse.json({
        success: true,
        sent: 0,
        skipped: 0,
        failed: 0,
        message: 'No active users'
      })
    }

    console.log(`Processing ${users.length} users...`)

    let sentCount = 0
    let skippedCount = 0
    let failedCount = 0

    // Process each user
    for (const user of users as WhatsAppUser[]) {
      try {
        // Skip users without business context
        if (!user.business_id) {
          skippedCount++
          continue
        }

        // Calculate today's totals using single source of truth
        const { start, end } = getDateRange('today')
        const totals = await getDailyTotals(user.business_id, start, end)

        // Format message with full financial picture
        const dateObj = new Date()
        const dayName = dateObj.toLocaleDateString('en-US', {
          weekday: 'long',
          timeZone: 'Africa/Lagos'
        })
        const dateFormatted = dateObj.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'Africa/Lagos'
        })

        let message = `📊 *Daily Summary — ${dayName}, ${dateFormatted}*\n\n`

        if (totals.salesKobo === 0 && totals.expensesKobo === 0) {
          message += `No activity recorded today.\n\n`
          message += `💡 Start logging: "Sold 3 bags 45k"`
        } else {
          // Show financial overview
          message += `💰 *Sales:* ${formatNaira(totals.salesKobo)}\n`

          if (totals.expensesKobo > 0) {
            message += `📉 *Expenses:* ${formatNaira(totals.expensesKobo)}\n`
          }

          if (totals.profitKobo !== totals.salesKobo) {
            const profitEmoji = totals.profitKobo >= 0 ? '🟢' : '🔴'
            message += `${profitEmoji} *Profit:* ${formatNaira(totals.profitKobo)}\n`
          }

          message += `\n💵 *Cash in drawer:* ${formatNaira(totals.cashInDrawerKobo)}\n`

          // Show receivables if any
          if (totals.receivablesKobo > 0) {
            const debtCount = totals.receivablesKobo > 0 ? '(outstanding)' : ''
            message += `📌 *Owed to you:* ${formatNaira(totals.receivablesKobo)} ${debtCount}\n`
          }

          // Show other movements if any
          if (totals.loansGivenKobo > 0) {
            message += `💸 *Lent out:* ${formatNaira(totals.loansGivenKobo)}\n`
          }

          if (totals.withdrawalsKobo > 0) {
            message += `💵 *Withdrawn:* ${formatNaira(totals.withdrawalsKobo)}\n`
          }
        }

        message += `\n\n_Sent by FLOIN at 9pm_ 🌙`

        // Check service window (24 hours since last message)
        const withinWindow = user.last_message_at
          ? isWithinServiceWindow(user.last_message_at)
          : false

        if (withinWindow) {
          // User messaged today - send free-form summary
          const result = await sendMessage(user.wa_phone, message)

          if (result.success) {
            sentCount++
            console.log(`✅ Sent summary to ${user.wa_phone}`)
          } else {
            failedCount++
            console.error(`❌ Failed to send to ${user.wa_phone}:`, result.error)
          }
        } else {
          // User didn't message today - need template message (Phase 2)
          // For now, skip silent users to avoid spam
          skippedCount++
          console.log(`⏭️ Skipped ${user.wa_phone} (inactive, template not implemented)`)

          // TODO Phase 2: Send template message
          // "Your FLOIN summary for {date} is ready. Reply 'summary' to see it."
        }

        // Rate limiting: small delay between sends to avoid WhatsApp throttling
        await new Promise(resolve => setTimeout(resolve, 100))

      } catch (error) {
        failedCount++
        console.error(`Error processing user ${user.wa_phone}:`, error)
      }
    }

    const result = {
      success: true,
      total: users.length,
      sent: sentCount,
      skipped: skippedCount,
      failed: failedCount,
      date: today,
      timestamp: new Date().toISOString()
    }

    console.log('📊 Daily summary cron completed:', result)

    return NextResponse.json(result)

  } catch (error) {
    console.error('❌ Daily summary cron error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

/**
 * Manual trigger endpoint for testing
 * POST /api/cron/daily-summaries?test=true
 */
export async function POST(req: NextRequest) {
  try {
    // Verify authorization
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const testPhone = searchParams.get('phone')

    if (!testPhone) {
      return NextResponse.json(
        { error: 'Phone number required for test' },
        { status: 400 }
      )
    }

    console.log(`🧪 Test summary for ${testPhone}`)

    // Fetch user
    const { data: user, error: userError } = await supabase
      .from('whatsapp_users')
      .select('business_id')
      .eq('wa_phone', testPhone)
      .single()

    if (userError || !user || !user.business_id) {
      return NextResponse.json(
        { error: 'User not found or no business' },
        { status: 404 }
      )
    }

    // Calculate and send summary using getDailyTotals
    const { start, end } = getDateRange('today')
    const totals = await getDailyTotals(user.business_id, start, end)

    // Format message (same as main cron)
    const dateObj = new Date()
    const dayName = dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'Africa/Lagos'
    })
    const dateFormatted = dateObj.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'Africa/Lagos'
    })

    let message = `📊 *Daily Summary — ${dayName}, ${dateFormatted}*\n\n`

    if (totals.salesKobo === 0 && totals.expensesKobo === 0) {
      message += `No activity recorded today.\n\n`
      message += `💡 Start logging: "Sold 3 bags 45k"`
    } else {
      message += `💰 *Sales:* ${formatNaira(totals.salesKobo)}\n`

      if (totals.expensesKobo > 0) {
        message += `📉 *Expenses:* ${formatNaira(totals.expensesKobo)}\n`
      }

      if (totals.profitKobo !== totals.salesKobo) {
        const profitEmoji = totals.profitKobo >= 0 ? '🟢' : '🔴'
        message += `${profitEmoji} *Profit:* ${formatNaira(totals.profitKobo)}\n`
      }

      message += `\n💵 *Cash in drawer:* ${formatNaira(totals.cashInDrawerKobo)}\n`

      if (totals.receivablesKobo > 0) {
        message += `📌 *Owed to you:* ${formatNaira(totals.receivablesKobo)}\n`
      }

      if (totals.loansGivenKobo > 0) {
        message += `💸 *Lent out:* ${formatNaira(totals.loansGivenKobo)}\n`
      }

      if (totals.withdrawalsKobo > 0) {
        message += `💵 *Withdrawn:* ${formatNaira(totals.withdrawalsKobo)}\n`
      }
    }

    message += `\n\n_🧪 Test summary at ${new Date().toLocaleTimeString('en-US', { timeZone: 'Africa/Lagos' })}_`

    const result = await sendMessage(testPhone, message)

    if (result.success) {
      return NextResponse.json({ success: true, message: 'Test summary sent' })
    } else {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      )
    }

  } catch (error) {
    console.error('Test summary error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
