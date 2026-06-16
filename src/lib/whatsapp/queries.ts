/**
 * Query and Summary Utilities
 * Functions for calculating daily/weekly summaries and statistics
 */

import { createClient } from '@supabase/supabase-js'
import { formatNaira } from './api-client'

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

export interface DailySummary {
  date: string
  totalSalesKobo: number
  salesCount: number
  totalUnits: number
  topChannel: string | null
  totalDebtsOwedKobo: number
  debtorsCount: number
}

export interface WeeklySummary {
  startDate: string
  endDate: string
  totalSalesKobo: number
  salesCount: number
  averageDailyKobo: number
  bestDay: { date: string; amount: number } | null
}

/**
 * Calculate daily summary for a business
 */
export async function calculateDailySummary(
  businessId: string,
  date?: string
): Promise<DailySummary> {
  try {
    // Default to today in Lagos timezone
    const summaryDate = date || new Date().toLocaleDateString('en-CA', {
      timeZone: 'Africa/Lagos'
    })

    // Fetch sales for the day
    const { data: sales, error: salesError } = await supabase
      .from('sales_entries')
      .select('amount, units, channel')
      .eq('business_id', businessId)
      .eq('date', summaryDate)

    if (salesError) throw salesError

    // Calculate sales totals
    const totalNaira = (sales || []).reduce((sum, s) => sum + Number(s.amount), 0)
    const totalSalesKobo = Math.round(totalNaira * 100)
    const salesCount = sales?.length || 0
    const totalUnits = (sales || []).reduce((sum, s) => sum + s.units, 0)

    // Find top channel
    const channelCounts: Record<string, number> = {}
    sales?.forEach(s => {
      channelCounts[s.channel] = (channelCounts[s.channel] || 0) + 1
    })

    const topChannel = Object.keys(channelCounts).length > 0
      ? Object.entries(channelCounts).sort((a, b) => b[1] - a[1])[0][0]
      : null

    // Fetch outstanding debts
    const { data: debts, error: debtsError } = await supabase
      .from('whatsapp_debts')
      .select('balance_kobo')
      .eq('business_id', businessId)
      .in('status', ['outstanding', 'partial'])

    if (debtsError) throw debtsError

    const totalDebtsOwedKobo = (debts || []).reduce((sum, d) => sum + d.balance_kobo, 0)
    const debtorsCount = debts?.length || 0

    return {
      date: summaryDate,
      totalSalesKobo,
      salesCount,
      totalUnits,
      topChannel,
      totalDebtsOwedKobo,
      debtorsCount
    }

  } catch (error) {
    console.error('Error calculating daily summary:', error)
    // Return zeros on error
    return {
      date: date || new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }),
      totalSalesKobo: 0,
      salesCount: 0,
      totalUnits: 0,
      topChannel: null,
      totalDebtsOwedKobo: 0,
      debtorsCount: 0
    }
  }
}

/**
 * Calculate weekly summary for a business
 */
export async function calculateWeeklySummary(
  businessId: string,
  endDate?: string
): Promise<WeeklySummary> {
  try {
    const end = endDate ? new Date(endDate) : new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - 6) // Last 7 days

    const startDateStr = start.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
    const endDateStr = end.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })

    // Fetch sales for the week
    const { data: sales, error } = await supabase
      .from('sales_entries')
      .select('date, amount')
      .eq('business_id', businessId)
      .gte('date', startDateStr)
      .lte('date', endDateStr)

    if (error) throw error

    const totalNaira = (sales || []).reduce((sum, s) => sum + Number(s.amount), 0)
    const totalSalesKobo = Math.round(totalNaira * 100)
    const salesCount = sales?.length || 0
    const averageDailyKobo = Math.round(totalSalesKobo / 7)

    // Find best day
    const dailyTotals: Record<string, number> = {}
    sales?.forEach(s => {
      const amount = Math.round(Number(s.amount) * 100)
      dailyTotals[s.date] = (dailyTotals[s.date] || 0) + amount
    })

    let bestDay: { date: string; amount: number } | null = null
    if (Object.keys(dailyTotals).length > 0) {
      const [date, amount] = Object.entries(dailyTotals).sort((a, b) => b[1] - a[1])[0]
      bestDay = { date, amount }
    }

    return {
      startDate: startDateStr,
      endDate: endDateStr,
      totalSalesKobo,
      salesCount,
      averageDailyKobo,
      bestDay
    }

  } catch (error) {
    console.error('Error calculating weekly summary:', error)
    const endDateStr = endDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
    const start = new Date(endDateStr)
    start.setDate(start.getDate() - 6)
    const startDateStr = start.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })

    return {
      startDate: startDateStr,
      endDate: endDateStr,
      totalSalesKobo: 0,
      salesCount: 0,
      averageDailyKobo: 0,
      bestDay: null
    }
  }
}

/**
 * Format daily summary message for WhatsApp
 */
export function formatDailySummaryMessage(summary: DailySummary): string {
  const dateObj = new Date(summary.date)
  const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Africa/Lagos' })
  const dateFormatted = dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'Africa/Lagos'
  })

  let message = `📊 *Daily Summary — ${dayName}, ${dateFormatted}*\n\n`

  if (summary.salesCount === 0) {
    message += `No sales recorded today.\n\n`
    message += `💡 *Tip:* Log your next sale by sending:\n`
    message += `"Sold 3 bags 45k"`
  } else {
    message += `💰 *Sales:* ${formatNaira(summary.totalSalesKobo)}\n`
    message += `📦 *Units:* ${summary.totalUnits}\n`
    message += `📋 *Transactions:* ${summary.salesCount}\n`

    if (summary.topChannel) {
      const channelEmoji = getChannelEmoji(summary.topChannel)
      message += `${channelEmoji} *Top channel:* ${formatChannelName(summary.topChannel)}\n`
    }

    if (summary.totalDebtsOwedKobo > 0) {
      message += `\n💳 *Outstanding debts:* ${formatNaira(summary.totalDebtsOwedKobo)}\n`
      message += `👥 *Debtors:* ${summary.debtorsCount} ${summary.debtorsCount === 1 ? 'person' : 'people'}`
    }
  }

  message += `\n\n_Sent by FLOIN at 9pm_ 🌙`

  return message
}

/**
 * Format weekly summary message
 */
export function formatWeeklySummaryMessage(summary: WeeklySummary): string {
  let message = `📈 *Weekly Summary*\n\n`
  message += `💰 *Total:* ${formatNaira(summary.totalSalesKobo)}\n`
  message += `📋 *Sales:* ${summary.salesCount}\n`
  message += `📊 *Daily average:* ${formatNaira(summary.averageDailyKobo)}\n`

  if (summary.bestDay) {
    const bestDate = new Date(summary.bestDay.date)
    const dayName = bestDate.toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'Africa/Lagos'
    })
    message += `\n🏆 *Best day:* ${dayName}\n`
    message += `${formatNaira(summary.bestDay.amount)}`
  }

  return message
}

/**
 * Get emoji for sales channel
 */
function getChannelEmoji(channel: string): string {
  const emojis: Record<string, string> = {
    'instagram': '📸',
    'whatsapp': '💬',
    'tiktok': '🎵',
    'twitter': '🐦',
    'distributor': '🏪',
    'website': '🌐',
    'walkin': '🚶',
    'other': '📱'
  }
  return emojis[channel.toLowerCase()] || '📱'
}

/**
 * Format channel name for display
 */
function formatChannelName(channel: string): string {
  const names: Record<string, string> = {
    'instagram': 'Instagram',
    'whatsapp': 'WhatsApp',
    'tiktok': 'TikTok',
    'twitter': 'Twitter/X',
    'distributor': 'Distributor',
    'website': 'Website',
    'walkin': 'Walk-in',
    'other': 'Other'
  }
  return names[channel.toLowerCase()] || channel
}

/**
 * Store daily summary in database
 */
export async function storeDailySummary(
  businessId: string,
  summary: DailySummary
): Promise<void> {
  try {
    const summaryId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

    await supabase
      .from('whatsapp_daily_summaries')
      .upsert({
        id: summaryId,
        business_id: businessId,
        summary_date: summary.date,
        total_sales_kobo: summary.totalSalesKobo,
        sales_count: summary.salesCount,
        total_expenses_kobo: 0, // Phase 2
        top_channel: summary.topChannel,
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      }, {
        onConflict: 'business_id,summary_date'
      })

  } catch (error) {
    console.error('Error storing daily summary:', error)
  }
}
