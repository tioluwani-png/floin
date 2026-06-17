/**
 * Transaction Commit
 * Commits confirmed pending actions to the database
 */

import { createClient } from '@supabase/supabase-js'
import { PendingAction } from './confirmation'
import { sendMessage, formatNaira } from './api-client'

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

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Commit a pending action to the database
 */
export async function commitPendingAction(
  pendingId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Fetch the pending action
    const { data: pending, error: fetchError } = await supabase
      .from('whatsapp_pending_actions')
      .select('*')
      .eq('id', pendingId)
      .single()

    if (fetchError || !pending) {
      return { success: false, error: 'Pending action not found' }
    }

    const pendingAction = pending as PendingAction

    // Check status
    if (pendingAction.status !== 'pending') {
      return { success: false, error: `Action already ${pendingAction.status}` }
    }

    // Check expiry
    if (new Date(pendingAction.expires_at) < new Date()) {
      await supabase
        .from('whatsapp_pending_actions')
        .update({ status: 'expired' })
        .eq('id', pendingId)

      return { success: false, error: 'Action expired' }
    }

    // Calculate total from items array or use top-level amount_kobo
    const getTotalKobo = (intent: any): number => {
      if (intent.items && intent.items.length > 0) {
        return intent.items.reduce((sum: number, item: any) => {
          if (!item.amount_kobo) return sum
          const itemTotal = item.amount_basis === 'unit' && item.qty
            ? item.amount_kobo * item.qty
            : item.amount_kobo
          return sum + itemTotal
        }, 0)
      }
      return intent.amount_kobo || 0
    }

    // Commit based on action type
    let committedId: string
    let message: string

    switch (pendingAction.action_type) {
      case 'sale':
        const saleResult = await commitSale(pendingAction)
        if (!saleResult.success) return saleResult
        committedId = saleResult.recordId!
        message = await formatSaleReceipt(pendingAction)
        break

      case 'expense':
        const expenseResult = await commitExpense(pendingAction)
        if (!expenseResult.success) return expenseResult
        committedId = expenseResult.recordId!
        const expenseAmount = getTotalKobo(pendingAction.intent_data)
        message = `✅ Expense saved! ${formatNaira(expenseAmount)}`
        break

      case 'debt_payment':
        const paymentResult = await commitDebtPayment(pendingAction)
        if (!paymentResult.success) return paymentResult
        committedId = paymentResult.recordId!
        const paymentAmount = getTotalKobo(pendingAction.intent_data)
        message = `✅ Payment recorded! ${formatNaira(paymentAmount)}`
        break

      case 'withdrawal':
        const withdrawalResult = await commitWithdrawal(pendingAction)
        if (!withdrawalResult.success) return withdrawalResult
        committedId = withdrawalResult.recordId!
        const withdrawalAmount = getTotalKobo(pendingAction.intent_data)
        message = `✅ Withdrawal recorded! ${formatNaira(withdrawalAmount)}\n\nThis is tracked separately from business expenses.`
        break

      case 'loan_given':
        const loanResult = await commitLoanGiven(pendingAction)
        if (!loanResult.success) return loanResult
        committedId = loanResult.recordId!
        const loanAmount = getTotalKobo(pendingAction.intent_data)
        message = `✅ Loan recorded!\n\n💸 ${formatNaira(loanAmount)} lent to ${pendingAction.intent_data.party}\n\n⚠️ This is NOT counted as a sale.`
        break

      default:
        return { success: false, error: 'Unknown action type' }
    }

    // Update pending action status
    await supabase
      .from('whatsapp_pending_actions')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        committed_record_id: committedId
      })
      .eq('id', pendingId)

    // Send receipt to user
    await sendMessage(pendingAction.wa_phone, message)

    // Mark onboarding as complete if this is first transaction (state = first_sale)
    const { data: waUser } = await supabase
      .from('whatsapp_users')
      .select('onboarding_state')
      .eq('wa_phone', pendingAction.wa_phone)
      .single()

    if (waUser && waUser.onboarding_state === 'first_sale') {
      await supabase
        .from('whatsapp_users')
        .update({
          onboarding_state: 'done',
          onboarding_completed_at: new Date().toISOString()
        })
        .eq('wa_phone', pendingAction.wa_phone)

      console.log('✅ Onboarding complete for', pendingAction.wa_phone)
    }

    return { success: true }

  } catch (error) {
    console.error('Error committing pending action:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Commit a sale to sales_entries table
 */
async function commitSale(
  pending: PendingAction
): Promise<{ success: boolean; recordId?: string; error?: string }> {
  try {
    const intent = pending.intent_data

    // Calculate total from items
    const totalKobo = intent.items && intent.items.length > 0
      ? intent.items.reduce((sum: number, item: any) => {
          if (item.kind !== 'sale' || !item.amount_kobo) return sum
          const itemTotal = item.amount_basis === 'unit' && item.qty
            ? item.amount_kobo * item.qty
            : item.amount_kobo
          return sum + itemTotal
        }, 0)
      : (intent.amount_kobo || 0)

    // Get total units
    const totalUnits = intent.items && intent.items.length > 0
      ? intent.items.reduce((sum: number, item: any) => sum + (item.qty || 1), 0)
      : 1

    // Convert time_ref to actual date (using Lagos timezone)
    const getDateString = (timeRef: string | null): string => {
      const today = new Date()
      if (!timeRef || timeRef === 'today') {
        return today.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
      }
      if (timeRef === 'yesterday') {
        const yesterday = new Date(today)
        yesterday.setDate(yesterday.getDate() - 1)
        return yesterday.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
      }
      // For other time refs, default to today
      return today.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
    }

    const saleId = generateId()
    const amountNaira = totalKobo / 100  // Convert to naira
    const isCredit = Boolean(intent.party)  // party instead of customer_name

    const { error: saleError } = await supabase
      .from('sales_entries')
      .insert({
        id: saleId,
        business_id: pending.business_id,
        date: getDateString(intent.time_ref),
        channel: 'whatsapp',
        units: totalUnits,
        amount: amountNaira,
        delivery_fee: 0,
        note: intent.note || '',
        created_at: new Date().toISOString()
      })

    if (saleError) {
      console.error('Failed to insert sale:', saleError)
      return { success: false, error: saleError.message }
    }

    // If credit sale, create debt record
    if (isCredit) {
      const debtId = generateId()

      await supabase
        .from('whatsapp_debts')
        .insert({
          id: debtId,
          business_id: pending.business_id,
          customer_name: intent.party!,  // party instead of customer_name
          amount_kobo: totalKobo,
          balance_kobo: totalKobo,
          sale_date: getDateString(intent.time_ref),
          note: intent.note,
          status: 'outstanding',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
    }

    return { success: true, recordId: saleId }
  } catch (error) {
    console.error('Error committing sale:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Commit an expense (Phase 2 - for now just log it)
 */
async function commitExpense(
  pending: PendingAction
): Promise<{ success: boolean; recordId?: string; error?: string }> {
  // TODO: Implement expense tracking
  // For Phase 1, we'll just acknowledge it
  // Phase 2: Update expense_months table
  console.log('Expense recorded (not yet implemented):', pending.intent_data)
  return { success: true, recordId: generateId() }
}

/**
 * Commit a debt payment
 */
async function commitDebtPayment(
  pending: PendingAction
): Promise<{ success: boolean; recordId?: string; error?: string }> {
  try {
    const intent = pending.intent_data

    if (!intent.party) {  // party instead of customer_name
      return { success: false, error: 'Customer name required for debt payment' }
    }

    // Calculate payment amount from items or top-level
    const paymentKobo = intent.items && intent.items.length > 0
      ? intent.items.reduce((sum: number, item: any) => {
          if (!item.amount_kobo) return sum
          return sum + item.amount_kobo
        }, 0)
      : (intent.amount_kobo || 0)

    // Convert time_ref to date (using Lagos timezone)
    const getDateString = (timeRef: string | null): string => {
      const today = new Date()
      if (!timeRef || timeRef === 'today') {
        return today.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
      }
      if (timeRef === 'yesterday') {
        const yesterday = new Date(today)
        yesterday.setDate(yesterday.getDate() - 1)
        return yesterday.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
      }
      return today.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
    }

    // Find outstanding debt for this customer
    const { data: debts, error: debtError } = await supabase
      .from('whatsapp_debts')
      .select('*')
      .eq('business_id', pending.business_id)
      .eq('customer_name', intent.party)  // party instead of customer_name
      .in('status', ['outstanding', 'partial'])
      .order('sale_date', { ascending: true })

    if (debtError || !debts || debts.length === 0) {
      return { success: false, error: 'No outstanding debt found for this customer' }
    }

    // Apply payment to oldest debt first
    const debt = debts[0]
    const paymentId = generateId()
    const newBalance = debt.balance_kobo - paymentKobo

    // Record payment
    await supabase
      .from('whatsapp_debt_payments')
      .insert({
        id: paymentId,
        debt_id: debt.id,
        amount_kobo: paymentKobo,
        payment_date: getDateString(intent.time_ref),
        note: intent.note,
        created_at: new Date().toISOString()
      })

    // Update debt balance
    const newStatus = newBalance <= 0 ? 'paid' : 'partial'

    await supabase
      .from('whatsapp_debts')
      .update({
        balance_kobo: Math.max(0, newBalance),
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', debt.id)

    return { success: true, recordId: paymentId }
  } catch (error) {
    console.error('Error committing debt payment:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Commit an owner withdrawal
 */
async function commitWithdrawal(
  pending: PendingAction
): Promise<{ success: boolean; recordId?: string; error?: string }> {
  try {
    const intent = pending.intent_data
    const withdrawalId = generateId()

    // Calculate total from items or use top-level amount
    const totalKobo = intent.items && intent.items.length > 0
      ? intent.items.reduce((sum: number, item: any) => {
          if (item.kind !== 'withdrawal' || !item.amount_kobo) return sum
          return sum + item.amount_kobo
        }, 0)
      : (intent.amount_kobo || 0)

    // Convert time_ref to date (using Lagos timezone)
    const getDateString = (timeRef: string | null): string => {
      const today = new Date()
      if (!timeRef || timeRef === 'today') {
        return today.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
      }
      if (timeRef === 'yesterday') {
        const yesterday = new Date(today)
        yesterday.setDate(yesterday.getDate() - 1)
        return yesterday.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
      }
      return today.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
    }

    const { error: withdrawalError } = await supabase
      .from('owner_withdrawals')
      .insert({
        id: withdrawalId,
        business_id: pending.business_id,
        amount_kobo: totalKobo,
        withdrawal_date: getDateString(intent.time_ref),
        note: intent.note || 'Personal withdrawal',
        created_at: new Date().toISOString()
      })

    if (withdrawalError) {
      console.error('Failed to insert withdrawal:', withdrawalError)
      return { success: false, error: withdrawalError.message }
    }

    return { success: true, recordId: withdrawalId }
  } catch (error) {
    console.error('Error committing withdrawal:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Commit a loan given (cash lent out - NOT a sale, NOT revenue)
 */
async function commitLoanGiven(
  pending: PendingAction
): Promise<{ success: boolean; recordId?: string; error?: string }> {
  try {
    const intent = pending.intent_data

    if (!intent.party) {
      return { success: false, error: 'Borrower name required for loan' }
    }

    // Calculate loan amount
    const loanKobo = intent.amount_kobo || 0

    if (loanKobo <= 0) {
      return { success: false, error: 'Loan amount required' }
    }

    // Convert time_ref to date (using Lagos timezone)
    const getDateString = (timeRef: string | null): string => {
      const today = new Date()
      if (!timeRef || timeRef === 'today') {
        return today.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
      }
      if (timeRef === 'yesterday') {
        const yesterday = new Date(today)
        yesterday.setDate(yesterday.getDate() - 1)
        return yesterday.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
      }
      return today.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
    }

    // Create debt record with is_loan=true (to distinguish from credit sales)
    const debtId = generateId()

    await supabase
      .from('whatsapp_debts')
      .insert({
        id: debtId,
        business_id: pending.business_id,
        customer_name: intent.party,
        amount_kobo: loanKobo,
        balance_kobo: loanKobo,
        sale_date: getDateString(intent.time_ref),
        note: intent.note || 'Cash loan',
        status: 'outstanding',
        is_loan: true,  // CRITICAL: marks as loan, NOT credit sale
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })

    // NOTE: Do NOT create a sales_entries row - loans are NOT sales!
    // This is the key difference from credit sales.

    return { success: true, recordId: debtId }
  } catch (error) {
    console.error('Error committing loan:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Format sale receipt with today's total
 */
async function formatSaleReceipt(pending: PendingAction): Promise<string> {
  const intent = pending.intent_data

  // Calculate total from items
  const totalKobo = intent.items && intent.items.length > 0
    ? intent.items.reduce((sum: number, item: any) => {
        if (item.kind !== 'sale' || !item.amount_kobo) return sum
        const itemTotal = item.amount_basis === 'unit' && item.qty
          ? item.amount_kobo * item.qty
          : item.amount_kobo
        return sum + itemTotal
      }, 0)
    : (intent.amount_kobo || 0)

  const totalUnits = intent.items && intent.items.length > 0
    ? intent.items.reduce((sum: number, item: any) => sum + (item.qty || 1), 0)
    : 1

  const amount = formatNaira(totalKobo)

  // Get today's total
  const todayTotal = await getTodayTotal(pending.business_id)

  let message = `✅ *Sale saved!*\n\n`
  message += `${amount} × ${totalUnits} unit${totalUnits > 1 ? 's' : ''}\n`

  if (intent.party) {  // party instead of customer_name
    message += `\n💳 Credit to ${intent.party}\n`
  }

  message += `\n📊 *Today's total:* ${formatNaira(todayTotal)}`

  return message
}

/**
 * Get today's total sales for a business (in kobo)
 */
async function getTodayTotal(businessId: string): Promise<number> {
  try {
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Africa/Lagos'
    })

    const { data, error } = await supabase
      .from('sales_entries')
      .select('amount')
      .eq('business_id', businessId)
      .eq('date', today)

    if (error) throw error

    const totalNaira = (data || []).reduce((sum, entry) => sum + Number(entry.amount), 0)
    return Math.round(totalNaira * 100) // Convert to kobo
  } catch (error) {
    console.error('Error calculating today total:', error)
    return 0
  }
}
