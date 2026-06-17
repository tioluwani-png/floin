/**
 * Debt Payment Allocator
 * Applies payments across ALL of a debtor's outstanding balances
 *
 * Fixes BUG: payment only applied to first debt instead of distributing across all debts
 */

import { createClient } from '@supabase/supabase-js'

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

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

interface Debt {
  id: string
  business_id: string
  customer_name: string
  amount_kobo: number
  balance_kobo: number
  sale_date: string
  status: 'outstanding' | 'partial' | 'paid'
}

interface PaymentAllocationResult {
  success: boolean
  error?: string
  paymentsCreated: number
  debtsSettled: number
  debtsPartiallyPaid: number
  remainingBalance: number  // How much debtor still owes AFTER this payment
  overpayment: number       // Excess if payment > total debt (kobo)
  appliedToDebts: Array<{
    debtId: string
    amountApplied: number
    previousBalance: number
    newBalance: number
    settled: boolean
  }>
}

/**
 * Apply a payment across ALL of a customer's outstanding debts
 * Pays oldest debts first (FIFO) until payment is exhausted
 *
 * @param businessId - The business ID
 * @param customerName - Customer name (exact match - caller should handle fuzzy matching)
 * @param paymentKobo - Total payment amount in kobo
 * @param paymentDate - Payment date (YYYY-MM-DD format)
 * @param note - Optional payment note
 * @returns PaymentAllocationResult with details of allocation
 */
export async function applyPaymentToCustomerDebts(
  businessId: string,
  customerName: string,
  paymentKobo: number,
  paymentDate: string,
  note?: string | null
): Promise<PaymentAllocationResult> {
  try {
    console.log(`💰 Applying ₦${paymentKobo / 100} payment from ${customerName}`)

    // 1. Fetch ALL outstanding/partial debts for this customer, oldest first
    const { data: debts, error: debtError } = await supabase
      .from('whatsapp_debts')
      .select('*')
      .eq('business_id', businessId)
      .eq('customer_name', customerName)
      .in('status', ['outstanding', 'partial'])
      .order('sale_date', { ascending: true })  // FIFO - oldest first

    if (debtError) {
      console.error('Error fetching debts:', debtError)
      return { success: false, error: debtError.message, paymentsCreated: 0, debtsSettled: 0, debtsPartiallyPaid: 0, remainingBalance: 0, overpayment: 0, appliedToDebts: [] }
    }

    if (!debts || debts.length === 0) {
      return {
        success: false,
        error: `No outstanding debts found for ${customerName}`,
        paymentsCreated: 0,
        debtsSettled: 0,
        debtsPartiallyPaid: 0,
        remainingBalance: 0,
        overpayment: 0,
        appliedToDebts: []
      }
    }

    const totalDebt = debts.reduce((sum, d) => sum + d.balance_kobo, 0)
    console.log(`  Total outstanding: ₦${totalDebt / 100} across ${debts.length} debt(s)`)

    // 2. Apply payment across debts until exhausted
    let remainingPayment = paymentKobo
    let debtsSettled = 0
    let debtsPartiallyPaid = 0
    const appliedToDebts: PaymentAllocationResult['appliedToDebts'] = []

    for (const debt of debts) {
      if (remainingPayment <= 0) break

      const previousBalance = debt.balance_kobo
      const amountToApply = Math.min(remainingPayment, debt.balance_kobo)
      const newBalance = debt.balance_kobo - amountToApply
      const settled = newBalance <= 0

      console.log(`  Applying ₦${amountToApply / 100} to debt ${debt.id} (balance: ₦${previousBalance / 100})`)

      // 3. Create payment record
      const paymentId = generateId()
      const { error: paymentError } = await supabase
        .from('whatsapp_debt_payments')
        .insert({
          id: paymentId,
          debt_id: debt.id,
          amount_kobo: amountToApply,
          payment_date: paymentDate,
          note: note || null,
          created_at: new Date().toISOString()
        })

      if (paymentError) {
        console.error('Failed to create payment record:', paymentError)
        // Continue anyway - we want to process other debts
      }

      // 4. Update debt balance and status
      const newStatus = settled ? 'paid' : 'partial'
      const { error: updateError } = await supabase
        .from('whatsapp_debts')
        .update({
          balance_kobo: Math.max(0, newBalance),
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', debt.id)

      if (updateError) {
        console.error('Failed to update debt:', updateError)
        // Continue anyway
      }

      // Track what we did
      appliedToDebts.push({
        debtId: debt.id,
        amountApplied: amountToApply,
        previousBalance,
        newBalance: Math.max(0, newBalance),
        settled
      })

      if (settled) {
        debtsSettled++
      } else {
        debtsPartiallyPaid++
      }

      remainingPayment -= amountToApply
    }

    // 5. Calculate final state
    const remainingBalance = Math.max(0, totalDebt - paymentKobo)
    const overpayment = paymentKobo > totalDebt ? (paymentKobo - totalDebt) : 0

    console.log(`  ✅ Payment applied: ${debtsSettled} settled, ${debtsPartiallyPaid} partial`)
    console.log(`  Remaining balance: ₦${remainingBalance / 100}`)
    if (overpayment > 0) {
      console.log(`  ⚠️ Overpayment: ₦${overpayment / 100}`)
    }

    return {
      success: true,
      paymentsCreated: appliedToDebts.length,
      debtsSettled,
      debtsPartiallyPaid,
      remainingBalance,
      overpayment,
      appliedToDebts
    }

  } catch (error) {
    console.error('Error applying payment:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      paymentsCreated: 0,
      debtsSettled: 0,
      debtsPartiallyPaid: 0,
      remainingBalance: 0,
      overpayment: 0,
      appliedToDebts: []
    }
  }
}

/**
 * Get formatted summary of payment allocation for user confirmation/receipt
 */
export function formatPaymentSummary(
  customerName: string,
  paymentKobo: number,
  result: PaymentAllocationResult
): string {
  if (!result.success) {
    return `❌ Payment failed: ${result.error}`
  }

  let message = `✅ *Payment recorded!*\n\n`
  message += `💵 Amount: ₦${(paymentKobo / 100).toLocaleString()}\n`
  message += `👤 From: ${customerName}\n\n`

  // Status summary
  if (result.remainingBalance === 0) {
    message += `🎉 *${customerName} is fully cleared!*\n`
    message += `All debts settled (${result.debtsSettled} debt${result.debtsSettled === 1 ? '' : 's'})\n\n`
  } else {
    message += `📊 *New balance:*\n`
    message += `${customerName} now owes: ₦${(result.remainingBalance / 100).toLocaleString()}\n\n`

    if (result.debtsSettled > 0) {
      message += `✅ ${result.debtsSettled} debt${result.debtsSettled === 1 ? '' : 's'} fully paid\n`
    }
    if (result.debtsPartiallyPaid > 0) {
      message += `📝 ${result.debtsPartiallyPaid} debt${result.debtsPartiallyPaid === 1 ? '' : 's'} partially paid\n`
    }
    message += `\n`
  }

  // Overpayment warning
  if (result.overpayment > 0) {
    message += `⚠️ *Overpayment detected*\n`
    message += `Extra: ₦${(result.overpayment / 100).toLocaleString()}\n`
    message += `This is more than they owed. Please verify with ${customerName}.\n\n`
  }

  return message
}
