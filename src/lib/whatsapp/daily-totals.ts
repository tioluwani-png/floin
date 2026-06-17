/**
 * Daily Totals - Single Source of Truth
 * ONE function that computes ALL daily figures from the same confirmed data
 * Ensures consistency across all reports (summary, profit, expenses, cash, etc.)
 */

import { createClient } from '@supabase/supabase-js'

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

export interface DailyTotals {
  // Raw amounts (in kobo)
  salesKobo: number              // cash + credit sales
  expensesKobo: number           // business expenses
  loansGivenKobo: number         // cash loans given out
  withdrawalsKobo: number        // owner personal withdrawals
  debtRepaymentsKobo: number     // debt repayments received

  // Calculated amounts
  profitKobo: number             // sales - expenses
  cashInDrawerKobo: number       // cash sales + repayments - expenses - withdrawals - loans

  // Receivables info
  receivablesKobo: number        // total outstanding debts
  debtorCount: number            // number of people who owe money
}

/**
 * Get all daily totals for a business and date range
 * This is the SINGLE SOURCE OF TRUTH for all money calculations
 *
 * @param businessId - The business ID
 * @param startDate - Start date in YYYY-MM-DD format (Lagos timezone)
 * @param endDate - End date in YYYY-MM-DD format (Lagos timezone)
 * @returns DailyTotals object with all figures
 */
export async function getDailyTotals(
  businessId: string,
  startDate: string,
  endDate: string
): Promise<DailyTotals> {
  try {
    // 1. SALES (cash + credit) from sales_entries
    // All confirmed sales are in sales_entries table
    const { data: sales } = await supabase
      .from('sales_entries')
      .select('amount')
      .eq('business_id', businessId)
      .gte('date', startDate)
      .lte('date', endDate)

    const salesKobo = (sales || []).reduce((sum, s) => sum + Number(s.amount) * 100, 0)

    // 2. EXPENSES from whatsapp_expenses
    // All confirmed expenses are in whatsapp_expenses table
    const { data: expenses } = await supabase
      .from('whatsapp_expenses')
      .select('amount_kobo')
      .eq('business_id', businessId)
      .gte('expense_date', startDate)
      .lte('expense_date', endDate)

    const expensesKobo = (expenses || []).reduce((sum, e) => sum + e.amount_kobo, 0)

    // 3. OWNER WITHDRAWALS from owner_withdrawals
    const { data: withdrawals } = await supabase
      .from('owner_withdrawals')
      .select('amount_kobo')
      .eq('business_id', businessId)
      .gte('withdrawal_date', startDate)
      .lte('withdrawal_date', endDate)

    const withdrawalsKobo = (withdrawals || []).reduce((sum, w) => sum + w.amount_kobo, 0)

    // 4. LOANS GIVEN from whatsapp_debts (where is_loan=true)
    const { data: loans } = await supabase
      .from('whatsapp_debts')
      .select('amount_kobo')
      .eq('business_id', businessId)
      .eq('is_loan', true)
      .gte('sale_date', startDate)
      .lte('sale_date', endDate)

    const loansGivenKobo = (loans || []).reduce((sum, l) => sum + l.amount_kobo, 0)

    // 5. DEBT REPAYMENTS received
    // First get debt IDs for this business
    const { data: businessDebts } = await supabase
      .from('whatsapp_debts')
      .select('id')
      .eq('business_id', businessId)

    const debtIds = (businessDebts || []).map(d => d.id)

    // Then get payments for those debts in date range
    const { data: repayments } = debtIds.length > 0
      ? await supabase
          .from('whatsapp_debt_payments')
          .select('amount_kobo')
          .in('debt_id', debtIds)
          .gte('payment_date', startDate)
          .lte('payment_date', endDate)
      : { data: [] }

    const debtRepaymentsKobo = (repayments || []).reduce((sum, p) => sum + p.amount_kobo, 0)

    // 6. RECEIVABLES (current outstanding balances)
    const { data: outstandingDebts } = await supabase
      .from('whatsapp_debts')
      .select('balance_kobo, customer_name')
      .eq('business_id', businessId)
      .in('status', ['outstanding', 'partial'])

    const receivablesKobo = (outstandingDebts || []).reduce((sum, d) => sum + d.balance_kobo, 0)
    const debtorCount = outstandingDebts?.length || 0

    // CALCULATED AMOUNTS
    // Profit = sales revenue - business expenses
    // NOT reduced by withdrawals (personal) or loans (not expenses)
    const profitKobo = salesKobo - expensesKobo

    // Cash in Drawer = physical money position
    // + cash sales + repayments received
    // - expenses - owner withdrawals - loans given out
    // Credit sales don't affect cash (no money moved yet)
    const cashInDrawerKobo = salesKobo + debtRepaymentsKobo - expensesKobo - withdrawalsKobo - loansGivenKobo

    return {
      salesKobo,
      expensesKobo,
      loansGivenKobo,
      withdrawalsKobo,
      debtRepaymentsKobo,
      profitKobo,
      cashInDrawerKobo,
      receivablesKobo,
      debtorCount
    }

  } catch (error) {
    console.error('Error calculating daily totals:', error)
    // Return zeros on error (safe fallback)
    return {
      salesKobo: 0,
      expensesKobo: 0,
      loansGivenKobo: 0,
      withdrawalsKobo: 0,
      debtRepaymentsKobo: 0,
      profitKobo: 0,
      cashInDrawerKobo: 0,
      receivablesKobo: 0,
      debtorCount: 0
    }
  }
}

/**
 * Get date range for common time references
 */
export function getDateRange(timeRef: 'today' | 'yesterday' | 'this_week' | 'this_month'): {
  start: string
  end: string
} {
  const today = new Date()
  const formatter = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })

  switch (timeRef) {
    case 'today':
      return { start: formatter(today), end: formatter(today) }

    case 'yesterday': {
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      return { start: formatter(yesterday), end: formatter(yesterday) }
    }

    case 'this_week': {
      const weekStart = new Date(today)
      weekStart.setDate(today.getDate() - today.getDay()) // Sunday
      return { start: formatter(weekStart), end: formatter(today) }
    }

    case 'this_month': {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
      return { start: formatter(monthStart), end: formatter(today) }
    }

    default:
      return { start: formatter(today), end: formatter(today) }
  }
}
