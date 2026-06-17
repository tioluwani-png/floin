/**
 * Debt Manager
 * Advanced debt tracking, reminders, and recovery features
 */

import { createClient } from '@supabase/supabase-js'
import { sendMessage, formatNaira } from './api-client'
import { normalizeName, findMatchingNames, validateCustomerName } from './name-utils'

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

interface Debt {
  id: string
  business_id: string
  customer_name: string
  customer_phone: string | null
  amount_kobo: number
  balance_kobo: number
  sale_date: string
  due_date: string | null
  note: string | null
  status: 'outstanding' | 'partial' | 'paid'
  created_at: string
  updated_at: string
}

/**
 * Get all debts for a business with detailed info
 */
export async function getBusinessDebts(
  businessId: string,
  includePartial: boolean = true
): Promise<Debt[]> {
  try {
    const statuses = includePartial ? ['outstanding', 'partial'] : ['outstanding']

    const { data, error } = await supabase
      .from('whatsapp_debts')
      .select('*')
      .eq('business_id', businessId)
      .in('status', statuses)
      .order('sale_date', { ascending: true })

    if (error) throw error

    return (data || []) as Debt[]
  } catch (error) {
    console.error('Error fetching debts:', error)
    return []
  }
}

/**
 * Find matching customer names in the database
 * Returns { matches: string[], exactMatch: boolean }
 */
export async function findCustomerNameMatches(
  businessId: string,
  searchName: string
): Promise<{ matches: string[]; exactMatch: boolean }> {
  try {
    // Get all unique customer names with outstanding debts
    const { data: allDebts, error } = await supabase
      .from('whatsapp_debts')
      .select('customer_name')
      .eq('business_id', businessId)
      .in('status', ['outstanding', 'partial'])

    if (error) throw error

    const allCustomerNames = [...new Set((allDebts || []).map(d => d.customer_name))]
    const matchingNames = findMatchingNames(searchName, allCustomerNames)

    // Check if any match is an exact normalized match
    const normalizedSearch = normalizeName(searchName)
    const exactMatch = matchingNames.some(name => normalizeName(name) === normalizedSearch)

    return { matches: matchingNames, exactMatch }
  } catch (error) {
    console.error('Error finding customer name matches:', error)
    return { matches: [], exactMatch: false }
  }
}

/**
 * Get debts for a specific customer (with fuzzy name matching)
 */
export async function getCustomerDebts(
  businessId: string,
  customerName: string
): Promise<Debt[]> {
  try {
    // First, get all debts for this business
    const { data: allDebts, error } = await supabase
      .from('whatsapp_debts')
      .select('*')
      .eq('business_id', businessId)
      .in('status', ['outstanding', 'partial'])
      .order('sale_date', { ascending: true })

    if (error) throw error

    const debts = (allDebts || []) as Debt[]

    // Extract all customer names and find matches using fuzzy matching
    const allCustomerNames = [...new Set(debts.map(d => d.customer_name))]
    const matchingNames = findMatchingNames(customerName, allCustomerNames)

    // Filter debts to only those with matching names
    return debts.filter(d => matchingNames.includes(d.customer_name))
  } catch (error) {
    console.error('Error fetching customer debts:', error)
    return []
  }
}

/**
 * Mark a debt as fully paid
 */
export async function markDebtAsPaid(
  debtId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('whatsapp_debts')
      .update({
        balance_kobo: 0,
        status: 'paid',
        updated_at: new Date().toISOString()
      })
      .eq('id', debtId)

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error marking debt as paid:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Get overdue debts (past 30 days)
 */
export async function getOverdueDebts(businessId: string): Promise<Debt[]> {
  try {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const cutoffDate = thirtyDaysAgo.toISOString().split('T')[0]

    const { data, error } = await supabase
      .from('whatsapp_debts')
      .select('*')
      .eq('business_id', businessId)
      .in('status', ['outstanding', 'partial'])
      .lt('sale_date', cutoffDate)
      .order('sale_date', { ascending: true })

    if (error) throw error

    return (data || []) as Debt[]
  } catch (error) {
    console.error('Error fetching overdue debts:', error)
    return []
  }
}

/**
 * Format detailed debt list message
 * CRITICAL: Count and total must match what's actually shown
 */
export function formatDebtListMessage(debts: Debt[]): string {
  if (debts.length === 0) {
    return '✅ *No outstanding debts!*\n\nAll customers have paid up. Great job! 🎉'
  }

  // Group by customer
  const debtsByCustomer: Record<string, Debt[]> = {}
  debts.forEach(debt => {
    if (!debtsByCustomer[debt.customer_name]) {
      debtsByCustomer[debt.customer_name] = []
    }
    debtsByCustomer[debt.customer_name].push(debt)
  })

  // Count ACTUAL customers (not total debt records)
  const customerCount = Object.keys(debtsByCustomer).length

  let message = `💳 *Outstanding Debts (${customerCount})*\n\n`

  // Calculate total from grouped data (ensures consistency)
  let calculatedTotal = 0

  // Format each customer's debts
  Object.entries(debtsByCustomer).forEach(([customerName, customerDebts]) => {
    const totalOwed = customerDebts.reduce((sum, d) => sum + d.balance_kobo, 0)
    calculatedTotal += totalOwed // Add to running total

    const oldestDate = new Date(customerDebts[0].sale_date)
    const daysOld = Math.floor((Date.now() - oldestDate.getTime()) / (1000 * 60 * 60 * 24))

    message += `👤 *${customerName}*\n`
    message += `   Owes: ${formatNaira(totalOwed)}\n`

    if (daysOld > 0) {
      message += `   ${daysOld} day${daysOld === 1 ? '' : 's'} old\n`

      if (daysOld > 30) {
        message += `   ⚠️ Overdue!\n`
      }
    }

    if (customerDebts[0].customer_phone) {
      message += `   📞 ${customerDebts[0].customer_phone}\n`
    }

    message += '\n'
  })

  // Use calculatedTotal instead of re-summing debts array
  message += `*Total owed:* ${formatNaira(calculatedTotal)}\n\n`
  message += `💡 _Reply "remind [name]" to send them a polite reminder_`

  return message
}

/**
 * Format reminder message for debtor
 */
export function formatDebtReminderMessage(
  businessName: string,
  ownerPhone: string,
  totalOwed: number
): string {
  return `Hello! 👋\n\n` +
    `This is a friendly reminder from *${businessName}*.\n\n` +
    `You have an outstanding balance of *${formatNaira(totalOwed)}*.\n\n` +
    `Please contact them at your convenience:\n` +
    `📞 ${ownerPhone}\n\n` +
    `_This is an automated reminder sent via FLOIN._`
}

/**
 * Send debt reminder to customer
 * Returns success status and message
 */
export async function sendDebtReminder(
  debt: Debt,
  businessName: string,
  ownerPhone: string
): Promise<{ success: boolean; message: string; error?: string }> {
  try {
    if (!debt.customer_phone) {
      return {
        success: false,
        message: `❌ No phone number saved for ${debt.customer_name}.\n\n` +
          `To send reminders, save their number:\n` +
          `"${debt.customer_name} phone is 080..."`
      }
    }

    // Calculate total owed by this customer
    const customerDebts = await getCustomerDebts(debt.business_id, debt.customer_name)
    const totalOwed = customerDebts.reduce((sum, d) => sum + d.balance_kobo, 0)

    // Send reminder
    const reminderMessage = formatDebtReminderMessage(businessName, ownerPhone, totalOwed)
    const result = await sendMessage(debt.customer_phone, reminderMessage)

    if (!result.success) {
      return {
        success: false,
        message: `❌ Failed to send reminder to ${debt.customer_name}`,
        error: result.error
      }
    }

    // Log the reminder (for tracking - prevent spam)
    // TODO: Create reminders_sent table to track and limit frequency

    return {
      success: true,
      message: `✅ *Reminder sent to ${debt.customer_name}!*\n\n` +
        `They've been notified about ${formatNaira(totalOwed)}.\n\n` +
        `💡 Wait a few days before sending another reminder.`
    }
  } catch (error) {
    console.error('Error sending debt reminder:', error)
    return {
      success: false,
      message: '❌ Failed to send reminder',
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Save customer phone number for future reminders
 * Uses fuzzy matching to find the customer
 */
export async function saveCustomerPhone(
  businessId: string,
  customerName: string,
  phoneNumber: string
): Promise<{ success: boolean; error?: string; matchedName?: string }> {
  try {
    // Find matching customer names
    const { matches } = await findCustomerNameMatches(businessId, customerName)

    if (matches.length === 0) {
      return {
        success: false,
        error: `No debtor found matching "${customerName}"`
      }
    }

    if (matches.length > 1) {
      return {
        success: false,
        error: `Multiple debtors match "${customerName}": ${matches.join(', ')}. Please be more specific.`
      }
    }

    // Exactly one match - update phone for this customer
    const matchedName = matches[0]

    const { error } = await supabase
      .from('whatsapp_debts')
      .update({ customer_phone: phoneNumber })
      .eq('business_id', businessId)
      .eq('customer_name', matchedName)
      .in('status', ['outstanding', 'partial'])

    if (error) throw error

    return { success: true, matchedName }
  } catch (error) {
    console.error('Error saving customer phone:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Get debt recovery stats (for success stories)
 */
export async function getRecoveryStats(
  businessId: string,
  monthYear?: string
): Promise<{
  totalRecovered: number
  paymentsCount: number
  averagePayment: number
}> {
  try {
    const month = monthYear || new Date().toISOString().slice(0, 7) // YYYY-MM

    // Get all debt payments for the month
    const { data: payments, error } = await supabase
      .from('whatsapp_debt_payments')
      .select('amount_kobo, whatsapp_debts!inner(business_id)')
      .eq('whatsapp_debts.business_id', businessId)
      .gte('payment_date', `${month}-01`)
      .lte('payment_date', `${month}-31`)

    if (error) throw error

    const totalRecovered = (payments || []).reduce((sum, p) => sum + p.amount_kobo, 0)
    const paymentsCount = payments?.length || 0
    const averagePayment = paymentsCount > 0 ? totalRecovered / paymentsCount : 0

    return {
      totalRecovered,
      paymentsCount,
      averagePayment
    }
  } catch (error) {
    console.error('Error getting recovery stats:', error)
    return {
      totalRecovered: 0,
      paymentsCount: 0,
      averagePayment: 0
    }
  }
}
