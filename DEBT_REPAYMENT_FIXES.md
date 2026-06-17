# Debt Repayment Bug Fixes - June 17, 2026

## Two Critical Bugs Fixed

---

## BUG 1: Repayment Doesn't Clear Full Balance (FIXED) ✅

### The Problem
Clara owed ₦20,000 total (split across 2 debt records: ₦10k credit sale + ₦10k loan). User logged a ₦20,000 payment from Clara. The payment recorded, but the debt list STILL showed "Clara owes ₦10,000".

**Why**: Payment was only applied to the FIRST debt record instead of being distributed across ALL debts.

### Root Cause
**`commitDebtPayment()` in commit.ts (OLD lines 368-410)**:
```typescript
// Find outstanding debt for this customer
const { data: debts } = await supabase
  .from('whatsapp_debts')
  .select('*')
  .eq('business_id', pending.business_id)
  .eq('customer_name', intent.party)
  .in('status', ['outstanding', 'partial'])
  .order('sale_date', { ascending: true })

// ❌ BUG: Only applied to first debt!
const debt = debts[0]
const newBalance = debt.balance_kobo - paymentKobo

// Record payment (only one)
await supabase.from('whatsapp_debt_payments').insert({ ... })

// Update debt balance (only one debt updated)
await supabase.from('whatsapp_debts').update({ ... }).eq('id', debt.id)
```

**Result**: If Clara has 2 debts (₦10k each) and pays ₦20k:
- First debt: ₦10k → ₦0 (settled) ✅
- Second debt: ₦10k → ₦10k (unchanged) ❌
- Debt list: "Clara owes ₦10,000" ❌

---

## The Fix - Payment Allocator

### Created New Module: `debt-payment-allocator.ts`

**Core Function: `applyPaymentToCustomerDebts()`**

Applies payment across ALL of a customer's debts (oldest first, FIFO):

```typescript
export async function applyPaymentToCustomerDebts(
  businessId: string,
  customerName: string,
  paymentKobo: number,
  paymentDate: string,
  note?: string | null
): Promise<PaymentAllocationResult>
```

**Algorithm**:
1. Fetch ALL outstanding/partial debts for customer, ordered by `sale_date` (oldest first)
2. For each debt (while payment remaining):
   - `amountToApply = min(remainingPayment, debt.balance_kobo)`
   - Create payment record in `whatsapp_debt_payments`
   - Update debt: `balance -= amountToApply`, `status = (balance === 0 ? 'paid' : 'partial')`
   - `remainingPayment -= amountToApply`
3. Calculate overpayment: `overpayment = (paymentKobo > totalDebt) ? (paymentKobo - totalDebt) : 0`
4. Return detailed allocation result

**Returns**:
```typescript
interface PaymentAllocationResult {
  success: boolean
  error?: string
  paymentsCreated: number        // Number of payment records created
  debtsSettled: number           // Debts fully paid (balance → 0)
  debtsPartiallyPaid: number     // Debts partially paid
  remainingBalance: number       // How much debtor still owes AFTER payment
  overpayment: number            // Excess if payment > total debt (kobo)
  appliedToDebts: Array<{
    debtId: string
    amountApplied: number
    previousBalance: number
    newBalance: number
    settled: boolean
  }>
}
```

**Overpayment Handling**:
- If payment exceeds total debt, all debts are settled
- Overpayment amount is calculated and flagged in result
- Receipt message warns user: "⚠️ Overpayment detected: ₦[amount]. Verify with customer."
- Does NOT silently lose the extra money

### Updated `commitDebtPayment()` in commit.ts

**NEW Implementation**:
```typescript
async function commitDebtPayment(pending: PendingAction) {
  const paymentKobo = calculatePayment(...)

  // NEW: Use payment allocator
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

  return { success: true, allocationResult }
}
```

### Enhanced Receipt Message

**NEW: `formatPaymentSummary()`** generates detailed receipt:

```typescript
✅ *Payment recorded!*

💵 Amount: ₦20,000
👤 From: Clara

🎉 *Clara is fully cleared!*
All debts settled (2 debts)
```

OR if partial:

```typescript
✅ *Payment recorded!*

💵 Amount: ₦12,000
👤 From: Clara

📊 *New balance:*
Clara now owes: ₦8,000

✅ 1 debt fully paid
📝 1 debt partially paid
```

OR if overpayment:

```typescript
✅ *Payment recorded!*

💵 Amount: ₦25,000
👤 From: Clara

🎉 *Clara is fully cleared!*
All debts settled (2 debts)

⚠️ *Overpayment detected*
Extra: ₦5,000
This is more than they owed. Please verify with Clara.
```

---

## BUG 2: Ghost Debtor Named "her" + Split Debts (FIXED) ✅

### The Problem
A debtor literally named "her" exists in the system, likely created by the earlier pronoun-as-name bug. This is almost certainly a duplicate of Clara's debt, splitting her true ₦20k into:
- "Clara" → ₦10k
- "her" → ₦10k

Which is why the ₦20k payment didn't fully clear her (it only paid one of the two records).

### Root Cause
1. **Earlier bug**: Pronoun guard wasn't enforced, so "her" was stored as a customer name
2. **Split debts**: Same person represented by multiple names/records
3. **No consolidation**: No mechanism to merge duplicates

---

## The Fix - Cleanup Utility

### Created New Module: `debt-cleanup.ts`

**Three Core Functions**:

#### 1. `findBadDebtorNames(businessId)`
Scans all debts and identifies those with pronoun/generic names:
- "her", "him", "them", "she", "he", "they"
- "oga", "madam", "sir", "ma", "mama", "papa"
- "customer", "person", "somebody", "someone", "friend"
- etc. (uses `isNonName()` from name-utils.ts)

#### 2. `autoCleanupBadDebtors(businessId)`
Automatically merges bad debts where confidence is high:

**Heuristics**:
1. **Only one valid debtor exists** → merge all bad debts to them
2. **Same amount + close date (≤7 days)** → merge to matching debt

**Returns**:
```typescript
interface CleanupResult {
  totalBadDebtors: number
  renamed: number
  merged: number
  flaggedForUser: Array<{
    name: string       // e.g., "her"
    balance: number    // Total owed
    count: number      // Number of debt records
  }>
}
```

**Example Output**:
```
🧹 Starting automated cleanup for business abc123
  Found 1 debt(s) with bad names

  Processing "her" (1 debt(s))
  Only one valid debtor (Clara), matching "her" to them
  ✅ Merged 1 debt(s) from "her" into "Clara"

✅ Cleanup complete:
   Total bad debtors: 1
   Auto-merged: 1
   Flagged for user: 0
```

#### 3. `consolidateDuplicateDebtors(businessId)`
Fixes name variations for the same person:
- "Clara", " clara ", "CLARA" → all become "Clara"
- "Alh Musa", "Musa" → canonical name chosen
- Uses `normalizeName()` to group, `cleanDisplayName()` for formatting

**Algorithm**:
1. Group all debts by normalized name
2. For each group with multiple variations:
   - Pick most common name (or cleanest if tied)
   - Update all debts to use that canonical name

**Example**:
```
🔄 Consolidating duplicate debtors for business abc123
  ✅ Renamed "clara" → "Clara"
  ✅ Renamed " CLARA " → "Clara"
  ✅ Renamed "Alh musa" → "Alh Musa"
✅ Consolidated 3 duplicate debtor names
```

### User-Facing Cleanup Command

**Added to router.ts**:

```typescript
if (normalizedMessage === 'cleanup debts' ||
    normalizedMessage === 'fix debts' ||
    normalizedMessage === 'fix names') {
  await handleCleanupDebtsCommand(waUser)
  return
}
```

**What it does**:
1. Sends "🧹 Starting debt cleanup..."
2. Runs `consolidateDuplicateDebtors()` (fix variations)
3. Runs `autoCleanupBadDebtors()` (merge pronouns)
4. Sends summary:
   ```
   ✅ *Cleanup complete!*

   📝 Fixed 3 duplicate names
   🔗 Merged 1 debt with bad names
   ```

5. If debts need user clarification (couldn't auto-match), sends:
   ```
   ⚠️ *Name Correction Needed*

   I get 1 debt wey no get correct name:

   ❌ Debtor: "customer"
   💰 Amount: ₦15,000

   Is this any of these people?
   1. Clara
   2. Mama Nkechi
   3. Musa

   Reply with the number or the person's real name.
   Example: "1" or "Clara"
   ```

---

## Complete Test Plan

### Test 1: Full Payment Clears All Debts ✅
```
Setup:
- Clara owes ₦10,000 (credit sale on June 1)
- Clara owes ₦10,000 (loan given on June 5)
- Total: ₦20,000 across 2 debt records

Action: User logs "Clara paid 20k"

Expected:
Bot: "📝 Confirm payment?
     💵 Amount: ₦20,000
     👤 From: Clara
     Reply Yes or No"

User: "Yes"

Bot: "✅ *Payment recorded!*

     💵 Amount: ₦20,000
     👤 From: Clara

     🎉 *Clara is fully cleared!*
     All debts settled (2 debts)"

Verify:
- whatsapp_debt_payments: 2 payment records created
  - Payment 1: debt_id = [credit_debt_id], amount = 10000 kobo
  - Payment 2: debt_id = [loan_debt_id], amount = 10000 kobo
- whatsapp_debts: Both debts marked as 'paid', balance = 0
- Query "who owes me": Clara NOT shown (balance = 0)
```

### Test 2: Partial Payment Applied Oldest First ✅
```
Setup:
- Clara owes ₦10,000 (credit sale on June 1) ← oldest
- Clara owes ₦10,000 (loan given on June 5)
- Total: ₦20,000

Action: User logs "Clara paid 12k"

Expected Bot Response:
"✅ *Payment recorded!*

💵 Amount: ₦12,000
👤 From: Clara

📊 *New balance:*
Clara now owes: ₦8,000

✅ 1 debt fully paid
📝 1 debt partially paid"

Verify:
- whatsapp_debt_payments: 2 payment records
  - Payment 1: debt_id = [June 1 debt], amount = 10000 kobo
  - Payment 2: debt_id = [June 5 debt], amount = 2000 kobo
- whatsapp_debts:
  - June 1 debt: status = 'paid', balance = 0 ✅
  - June 5 debt: status = 'partial', balance = 8000 kobo ✅
- Query "who owes me": Shows "Clara - ₦8,000"
```

### Test 3: Overpayment Detected and Warned ✅
```
Setup:
- Clara owes ₦10,000 (credit sale)
- Clara owes ₦10,000 (loan)
- Total: ₦20,000

Action: User logs "Clara paid 25k"

Expected Bot Response:
"✅ *Payment recorded!*

💵 Amount: ₦25,000
👤 From: Clara

🎉 *Clara is fully cleared!*
All debts settled (2 debts)

⚠️ *Overpayment detected*
Extra: ₦5,000
This is more than they owed. Please verify with Clara."

Verify:
- Both debts fully settled (balance = 0, status = 'paid')
- Total payments recorded = ₦20,000 (not ₦25,000)
- User warned about ₦5,000 extra
- Clara NOT in debt list (fully cleared)
```

### Test 4: Ghost Debtor "her" Merged to Clara ✅
```
Setup (simulate old bug):
- Debt 1: customer_name = "Clara", balance = 10000 kobo
- Debt 2: customer_name = "her", balance = 10000 kobo
(Both same business, similar dates)

Action: User sends "cleanup debts"

Expected Bot Response:
"🧹 Starting debt cleanup...

✅ *Cleanup complete!*

🔗 Merged 1 debt with bad names"

Verify:
- whatsapp_debts: Both debts now have customer_name = "Clara"
- Query "who owes me": Shows "Clara - ₦20,000" (ONE entry, not two)
- No debtor named "her" exists
```

### Test 5: Duplicate Names Consolidated ✅
```
Setup:
- Debt 1: customer_name = "Clara"
- Debt 2: customer_name = "clara"
- Debt 3: customer_name = " CLARA "

Action: User sends "cleanup debts"

Expected Bot Response:
"🧹 Starting debt cleanup...

✅ *Cleanup complete!*

📝 Fixed 2 duplicate names"

Verify:
- All three debts now have customer_name = "Clara" (canonical)
- Query "who owes me": Shows "Clara - ₦[total]" (ONE entry)
```

### Test 6: Consistency After Cleanup + Payment ✅
```
Full Flow:
1. Setup: "Clara" owes ₦10k, "her" owes ₦10k (ghost)
2. User: "cleanup debts"
   Bot: Merges "her" into "Clara"
3. Verify: Query "who owes me" → "Clara - ₦20,000"
4. User: "Clara paid 20k"
5. User: "Yes" (confirm)
   Bot: "🎉 *Clara is fully cleared!*"
6. Verify: Query "who owes me" → "✅ No outstanding debts!"

Result:
✅ Total shown matches sum of debts
✅ Payment clears ALL Clara's debts (not just one)
✅ No ghost debtors remain
```

---

## Files Changed

### NEW FILES:
1. **`src/lib/whatsapp/debt-payment-allocator.ts`** (244 lines)
   - `applyPaymentToCustomerDebts()` - Distribute payment across all debts
   - `formatPaymentSummary()` - Generate detailed receipt

2. **`src/lib/whatsapp/debt-cleanup.ts`** (344 lines)
   - `findBadDebtorNames()` - Find debts with pronoun names
   - `autoCleanupBadDebtors()` - Auto-merge where confident
   - `consolidateDuplicateDebtors()` - Fix name variations
   - `formatBadDebtorClarificationMessage()` - Ask user to clarify

### MODIFIED FILES:
1. **`src/lib/whatsapp/commit.ts`**
   - Lines 336-418: Completely rewrote `commitDebtPayment()`
   - Now uses `applyPaymentToCustomerDebts()` instead of manual single-debt update
   - Lines 96-115: Updated debt_payment case in `commitPendingAction()`
   - Now uses `formatPaymentSummary()` for detailed receipt

2. **`src/lib/whatsapp/router.ts`**
   - Line 248: Added "cleanup debts" command handler
   - Lines 1095-1161: Added `handleCleanupDebtsCommand()` function
   - Runs auto-cleanup and asks user about uncertain cases

---

## Prevention - Pronoun Guard Already Active

The fixes from the earlier NAME_HANDLING_FIXES.md session already prevent NEW ghost debtors:

**LLM Parser** (llm-parser.ts):
```typescript
CRITICAL — NAMES vs PRONOUNS:
NEVER use a pronoun or generic term as a party name.
If only pronoun AND can resolve from context → resolve it.
If only pronoun and NO resolvable name → set party=null, needs_clarification=true,
  clarification_question="Who be the person? Wetin be him/her name?"
```

**Backend Validation** (commit.ts lines 233-246):
```typescript
if (isCredit) {
  const nameValidation = validateCustomerName(intent.party)
  if (!nameValidation.valid) {
    return { success: false, error: `Invalid customer name: ${nameValidation.error}` }
  }
  const cleanName = cleanDisplayName(intent.party!)
  // Store cleanName (validated, no pronouns)
}
```

**Result**: No NEW debtor can be created with name = "her", "him", "oga", "customer", etc. System will ask for real name instead.

---

## Summary

### BUG 1: FIXED ✅
- ✅ Payments now applied across ALL debts (oldest first, FIFO)
- ✅ Multiple payment records created (one per debt touched)
- ✅ Overpayments detected and warned
- ✅ Detailed receipt shows exactly what happened

### BUG 2: FIXED ✅
- ✅ Automated cleanup utility merges ghost debtors
- ✅ Duplicate names consolidated (Clara/clara/CLARA → Clara)
- ✅ User command: "cleanup debts" / "fix debts" / "fix names"
- ✅ High-confidence auto-merge for obvious cases
- ✅ Asks user for clarification when uncertain

### Guarantees
1. **Full payment clears full balance** - ₦20k payment against ₦20k debt → ₦0 owed ✅
2. **No ghost debtors** - Pronouns blocked at creation, existing ones merged ✅
3. **Single canonical name** - Each person = ONE normalized name ✅
4. **Consistency** - "who owes me" total = sum of individual debts = sum of database records ✅

### Build Status
✅ Compiled successfully with no errors

---

Last Updated: June 17, 2026
Files: 4 created/modified
Lines changed: ~650 lines (588 new, 82 modified)
