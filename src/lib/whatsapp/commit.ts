/**
 * Transaction Commit
 * Commits confirmed pending actions to the database
 */

import { createClient } from '@supabase/supabase-js'
import { PendingAction } from './confirmation'
import { sendMessage, formatNaira } from './api-client'
import { validateCustomerName, cleanDisplayName } from './name-utils'

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

        // NEW: Use detailed allocation summary if available
        if (paymentResult.allocationResult && pendingAction.intent_data.party) {
          const { formatPaymentSummary } = await import('./debt-payment-allocator')
          message = formatPaymentSummary(
            pendingAction.intent_data.party,
            paymentAmount,
            paymentResult.allocationResult
          )
        } else {
          // Fallback to simple message
          message = `✅ Payment recorded! ${formatNaira(paymentAmount)}`
        }
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

      case 'write_off':
        const writeOffResult = await commitWriteOff(pendingAction)
        if (!writeOffResult.success) return writeOffResult
        committedId = writeOffResult.recordId!
        message = writeOffResult.message!
        break

      case 'delete_entry':
        const deleteResult = await commitDeleteEntry(pendingAction)
        if (!deleteResult.success) return deleteResult
        committedId = deleteResult.recordId!
        message = deleteResult.message!
        break

      case 'edit_entry':
        const editResult = await commitEditEntry(pendingAction)
        if (!editResult.success) return editResult
        committedId = editResult.recordId!
        message = editResult.message!
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
      // Validate customer name (backend guard against pronouns/non-names)
      const nameValidation = validateCustomerName(intent.party)
      if (!nameValidation.valid) {
        return {
          success: false,
          error: `Invalid customer name: ${nameValidation.error}`
        }
      }

      const debtId = generateId()
      const cleanName = cleanDisplayName(intent.party!)

      await supabase
        .from('whatsapp_debts')
        .insert({
          id: debtId,
          business_id: pending.business_id,
          customer_name: cleanName,  // Use cleaned display name
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
 * Commit an expense to whatsapp_expenses table
 */
async function commitExpense(
  pending: PendingAction
): Promise<{ success: boolean; recordId?: string; error?: string }> {
  try {
    const intent = pending.intent_data

    // Calculate total from items (same as sale logic)
    const totalKobo = intent.items.reduce((sum: number, item: any) => {
      if (!item.amount_kobo) return sum
      const itemTotal = item.amount_basis === 'unit' && item.qty
        ? item.amount_kobo * item.qty
        : item.amount_kobo
      return sum + itemTotal
    }, 0) || intent.amount_kobo || 0

    if (totalKobo === 0) {
      return { success: false, error: 'Expense amount is required' }
    }

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

    const expenseId = generateId()

    const { error: expenseError } = await supabase
      .from('whatsapp_expenses')
      .insert({
        id: expenseId,
        business_id: pending.business_id,
        amount_kobo: totalKobo,
        expense_date: getDateString(intent.time_ref),
        note: intent.note || intent.items[0]?.description || null,
        created_at: new Date().toISOString()
      })

    if (expenseError) {
      console.error('Failed to insert expense:', expenseError)
      return { success: false, error: expenseError.message }
    }

    return { success: true, recordId: expenseId }
  } catch (error) {
    console.error('Error committing expense:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Commit a debt payment
 * FIXED: Now applies payment across ALL of customer's debts, not just the first one
 */
async function commitDebtPayment(
  pending: PendingAction
): Promise<{ success: boolean; recordId?: string; error?: string; allocationResult?: any }> {
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

    if (paymentKobo <= 0) {
      return { success: false, error: 'Payment amount must be greater than zero' }
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

    // NEW: Use payment allocator to apply across ALL debts
    const { applyPaymentToCustomerDebts } = await import('./debt-payment-allocator')

    const allocationResult = await applyPaymentToCustomerDebts(
      pending.business_id,
      intent.party,
      paymentKobo,
      getDateString(intent.time_ref),
      intent.note
    )

    if (!allocationResult.success) {
      return { success: false, error: allocationResult.error }
    }

    // Return success with allocation details (for receipt message)
    return {
      success: true,
      recordId: allocationResult.appliedToDebts[0]?.debtId || generateId(),
      allocationResult
    }

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

    // Validate customer name (backend guard against pronouns/non-names)
    const nameValidation = validateCustomerName(intent.party)
    if (!nameValidation.valid) {
      return {
        success: false,
        error: `Invalid borrower name: ${nameValidation.error}`
      }
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
    const cleanName = cleanDisplayName(intent.party)

    await supabase
      .from('whatsapp_debts')
      .insert({
        id: debtId,
        business_id: pending.business_id,
        customer_name: cleanName,  // Use cleaned display name
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

/**
 * Commit a write-off (forgive debt without payment)
 */
async function commitWriteOff(
  pending: PendingAction
): Promise<{ success: boolean; recordId?: string; error?: string; message?: string }> {
  try {
    const debtIds = pending.intent_data.debts as string[]
    const debtorName = pending.intent_data.party as string
    const totalAmount = pending.intent_data.amount_kobo as number

    if (!debtIds || debtIds.length === 0) {
      return { success: false, error: 'No debts to write off' }
    }

    // Mark all debts as written_off
    const { error: updateError } = await supabase
      .from('whatsapp_debts')
      .update({
        balance_kobo: 0,
        status: 'written_off',
        updated_at: new Date().toISOString()
      })
      .in('id', debtIds)

    if (updateError) {
      console.error('Failed to write off debts:', updateError)
      return { success: false, error: updateError.message }
    }

    const message = `✅ *Debt written off!*\n\n` +
      `👤 ${debtorName}\n` +
      `💰 Amount forgiven: ${formatNaira(totalAmount)}\n` +
      `📝 Debts cleared: ${debtIds.length}\n\n` +
      `⚠️ No cash was added (this is a write-off, not a payment).`

    return { success: true, recordId: debtIds[0], message }
  } catch (error) {
    console.error('Error committing write-off:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Commit a delete entry (soft delete/void)
 */
async function commitDeleteEntry(
  pending: PendingAction
): Promise<{ success: boolean; recordId?: string; error?: string; message?: string }> {
  try {
    const entryType = pending.intent_data.entry_type as 'sale' | 'expense'
    const entryId = pending.intent_data.entry_id as string

    if (entryType === 'sale') {
      // Delete sale entry (hard delete for now - can add soft delete/voided column later)
      const { error } = await supabase
        .from('sales_entries')
        .delete()
        .eq('id', entryId)

      if (error) {
        console.error('Failed to delete sale:', error)
        return { success: false, error: error.message }
      }

      const message = `✅ Sale deleted!\n\n` +
        `The entry has been removed from your totals.`

      return { success: true, recordId: entryId, message }

    } else if (entryType === 'expense') {
      // Delete expense entry (hard delete for now - can add soft delete/voided column later)
      const { error } = await supabase
        .from('whatsapp_expenses')
        .delete()
        .eq('id', entryId)

      if (error) {
        console.error('Failed to delete expense:', error)
        return { success: false, error: error.message }
      }

      const message = `✅ Expense deleted!\n\n` +
        `The entry has been removed from your totals.`

      return { success: true, recordId: entryId, message }
    }

    return { success: false, error: 'Unknown entry type' }
  } catch (error) {
    console.error('Error committing delete:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Commit an edit entry (update amount)
 */
async function commitEditEntry(
  pending: PendingAction
): Promise<{ success: boolean; recordId?: string; error?: string; message?: string }> {
  try {
    const entryType = pending.intent_data.entry_type as 'sale' | 'expense'
    const entryId = pending.intent_data.entry_id as string
    const oldAmountKobo = pending.intent_data.old_amount_kobo as number
    const newAmountKobo = pending.intent_data.new_amount_kobo as number

    if (entryType === 'sale') {
      // Update sale amount (stored in naira)
      const { error } = await supabase
        .from('sales_entries')
        .update({
          amount: newAmountKobo / 100,
          updated_at: new Date().toISOString()
        })
        .eq('id', entryId)

      if (error) {
        console.error('Failed to edit sale:', error)
        return { success: false, error: error.message }
      }

    } else if (entryType === 'expense') {
      // Update expense amount (stored in kobo)
      const { error } = await supabase
        .from('whatsapp_expenses')
        .update({
          amount_kobo: newAmountKobo,
          updated_at: new Date().toISOString()
        })
        .eq('id', entryId)

      if (error) {
        console.error('Failed to edit expense:', error)
        return { success: false, error: error.message }
      }
    } else {
      return { success: false, error: 'Unknown entry type' }
    }

    const message = `✅ Entry updated!\n\n` +
      `Type: ${entryType === 'sale' ? 'Sale' : 'Expense'}\n` +
      `Old: ${formatNaira(oldAmountKobo)}\n` +
      `New: ${formatNaira(newAmountKobo)}`

    return { success: true, recordId: entryId, message }
  } catch (error) {
    console.error('Error committing edit:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}
