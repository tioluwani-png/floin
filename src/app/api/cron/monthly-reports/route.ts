/**
 * Monthly Report Cron
 * Runs on 1st of each month to generate and send PDF reports
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateMonthlyReportPDF, uploadPDFToStorage } from '@/lib/whatsapp/pdf-generator'
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

    console.log('📊 Running monthly report cron...')

    // Get last month (reports are for completed months)
    const now = new Date()
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const monthYear = lastMonth.toISOString().slice(0, 7) // "YYYY-MM"

    console.log(`Generating reports for ${monthYear}`)

    // Fetch all active WhatsApp users with businesses
    const { data: users, error: usersError } = await supabase
      .from('whatsapp_users')
      .select('id, wa_phone, business_id, whatsapp_messages_raw!inner(created_at)')
      .eq('is_active', true)
      .not('business_id', 'is', null)
      .in('subscription_status', ['trial', 'active'])
      .order('whatsapp_messages_raw(created_at)', { ascending: false })

    if (usersError) {
      console.error('Error fetching users:', usersError)
      throw usersError
    }

    if (!users || users.length === 0) {
      console.log('No active users to send reports to')
      return NextResponse.json({
        success: true,
        generated: 0,
        sent: 0,
        message: 'No active users'
      })
    }

    console.log(`Processing ${users.length} users...`)

    let generatedCount = 0
    let sentCount = 0
    let failedCount = 0

    // Group by business to avoid duplicate reports
    const businessesProcessed = new Set<string>()

    for (const user of users as any[]) {
      try {
        const businessId = user.business_id

        // Skip if already processed this business
        if (businessesProcessed.has(businessId)) {
          continue
        }

        businessesProcessed.add(businessId)

        // Generate PDF
        const pdfBuffer = await generateMonthlyReportPDF(businessId, monthYear)

        if (!pdfBuffer) {
          console.error(`Failed to generate PDF for business ${businessId}`)
          failedCount++
          continue
        }

        generatedCount++

        // Upload to Supabase Storage
        const pdfUrl = await uploadPDFToStorage(pdfBuffer, businessId, monthYear)

        if (!pdfUrl) {
          console.error(`Failed to upload PDF for business ${businessId}`)
          failedCount++
          continue
        }

        // Send to all users of this business
        const { data: businessUsers } = await supabase
          .from('whatsapp_users')
          .select('wa_phone')
          .eq('business_id', businessId)
          .eq('is_active', true)

        for (const bUser of businessUsers || []) {
          try {
            // Get business name
            const { data: business } = await supabase
              .from('businesses')
              .select('name')
              .eq('id', businessId)
              .single()

            const businessName = business?.name || 'Your Business'
            const monthLabel = lastMonth.toLocaleDateString('en-US', {
              month: 'long',
              year: 'numeric'
            })

            // Send message with PDF link
            const message = `📊 *${businessName} - ${monthLabel} Report*\n\n` +
              `Your monthly report is ready!\n\n` +
              `📄 Download: ${pdfUrl}\n\n` +
              `_Forward this to anyone - accountant, partner, or investor!_\n\n` +
              `💡 Want reports like this? Text your sales to FLOIN.`

            const result = await sendMessage(bUser.wa_phone, message)

            if (result.success) {
              sentCount++
              console.log(`✅ Sent report to ${bUser.wa_phone}`)
            } else {
              failedCount++
              console.error(`❌ Failed to send to ${bUser.wa_phone}`)
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100))

          } catch (error) {
            console.error(`Error sending to user:`, error)
            failedCount++
          }
        }

      } catch (error) {
        console.error(`Error processing business:`, error)
        failedCount++
      }
    }

    const result = {
      success: true,
      month: monthYear,
      businesses: businessesProcessed.size,
      generated: generatedCount,
      sent: sentCount,
      failed: failedCount,
      timestamp: new Date().toISOString()
    }

    console.log('📊 Monthly report cron completed:', result)

    return NextResponse.json(result)

  } catch (error) {
    console.error('❌ Monthly report cron error:', error)
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
 * Manual trigger for testing
 * POST /api/cron/monthly-reports?month=2026-06&business=xyz
 */
export async function POST(req: NextRequest) {
  try {
    // Verify authorization
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const monthYear = searchParams.get('month')
    const businessId = searchParams.get('business')

    if (!monthYear || !businessId) {
      return NextResponse.json(
        { error: 'month and business parameters required' },
        { status: 400 }
      )
    }

    console.log(`🧪 Test report for business ${businessId} - ${monthYear}`)

    // Generate PDF
    const pdfBuffer = await generateMonthlyReportPDF(businessId, monthYear)

    if (!pdfBuffer) {
      return NextResponse.json(
        { error: 'Failed to generate PDF' },
        { status: 500 }
      )
    }

    // Upload to storage
    const pdfUrl = await uploadPDFToStorage(pdfBuffer, businessId, monthYear)

    if (!pdfUrl) {
      return NextResponse.json(
        { error: 'Failed to upload PDF' },
        { status: 500 }
      )
    }

    // Send to business users
    const { data: users } = await supabase
      .from('whatsapp_users')
      .select('wa_phone')
      .eq('business_id', businessId)
      .eq('is_active', true)

    const results = []

    for (const user of users || []) {
      const message = `📊 *Test Monthly Report*\n\n` +
        `Your report for ${monthYear} is ready!\n\n` +
        `📄 Download: ${pdfUrl}`

      const result = await sendMessage(user.wa_phone, message)
      results.push({ phone: user.wa_phone, success: result.success })
    }

    return NextResponse.json({
      success: true,
      pdfUrl,
      sent: results.length,
      results
    })

  } catch (error) {
    console.error('Test report error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
