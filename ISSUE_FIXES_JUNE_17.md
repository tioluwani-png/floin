# FLOIN Bot Fixes - June 17, 2026

## Issues Fixed

### ISSUE 1: Cash in Drawer Missing Business Expenses ✅

**Problem**: Expenses were not being subtracted from cash in drawer calculation.
- User logged ₦150,000 ads expense
- Asked "how much do I have left from today's sales?"
- Cash in Drawer showed ₦770,000 (wrong)
- Correct: ₦620,000 (785k sales - 150k expense - 5k withdrawal - 10k loan)

**Root Cause**:
- `commitExpense()` was a stub that didn't save to database
- `calculateCashInDrawer()` hardcoded `expensesKobo = 0`
- No `whatsapp_expenses` table existed

**Fix Applied**:

1. **New Migration**: `009_whatsapp_expenses.sql`
   - Creates `whatsapp_expenses` table
   - Tracks individual expense entries (not monthly aggregates)
   - Schema: business_id, amount_kobo, expense_date, category, note

2. **Updated `commit.ts`** (lines 259-321)
   - Implemented full `commitExpense()` function
   - Calculates total from items
   - Saves to `whatsapp_expenses` table
   - Uses Lagos timezone for dates

3. **Updated `router.ts`** (line 751-758)
   - `calculateCashInDrawer()` now queries expenses from database
   - Formula: cash_sales + debt_repayments - **expenses** - withdrawals - loans_given

4. **Updated Cash Breakdown Display** (line 685)
   - Expenses now ALWAYS shown (not conditional)
   - Format: `Expenses: -₦150,000`

**Expected Result**:
```
💵 Cash in Drawer today

₦620,000

Breakdown:
Cash sales: +₦785,000
Expenses: -₦150,000
Withdrawals: -₦5,000
Loans given: -₦10,000

📌 This is physical money, not profit
```

---

### ISSUE 2: Pending Confirmations Blocking New Messages ✅

**Problem**: When expense was pending, user's query was blocked.
- User had pending ₦150,000 expense awaiting confirmation
- User asked "How much do I have left from today's sales?"
- Bot just repeated "Reply 1 to save or 2 to cancel" (annoying!)
- Query was never answered

**Root Cause**:
- `routeMessage()` checked for pending first
- If pending existed, immediately called `handleConfirmationReply()` and returned
- Any message that wasn't YES/NO/correction was treated as error
- New intents (queries, greetings, transactions) were blocked

**Fix Applied - AUTO-SAVE POLICY**:

When a pending confirmation exists AND user sends a clear NEW intent (query, greeting, new transaction):
1. **Auto-save the pending entry silently** (it was already shown, low risk)
2. **Process the new message normally**
3. **Prepend a tiny note** so user knows what happened

**Code Changes**:

1. **Updated `confirmation.ts`** (line 77)
   - Reduced expiry from 1 hour to **30 minutes**

2. **Updated `router.ts` - routeMessage()** (lines 194-204)
   - Parse confirmation reply BEFORE blocking
   - Get back both `isConfirmation` boolean AND `autoSaveMessage` string
   - If not a confirmation, fall through with autoSavePrefix

3. **Rewrote `handleConfirmationReply()`** (lines 271-379)
   - **Returns object**: `{ isConfirmation: boolean, autoSaveMessage?: string }`
   - First checks YES/NO patterns → returns `{ isConfirmation: true }`
   - Checks correction patterns → returns `{ isConfirmation: true }`
   - **Then parses message as NEW intent using LLM**
   - If high-confidence new intent (query, sale, expense, greeting, etc.):
     - Auto-saves pending via `commitPendingAction()`
     - Returns `{ isConfirmation: false, autoSaveMessage: "✅ Saved..." }`
   - Only re-prompts if message is genuinely unclear

4. **Updated `handleQuery()` and `handleSpecificQuery()`**
   - Added `autoSavePrefix` parameter
   - Prepends to all query responses

5. **Updated `handleSaleIntent()`**
   - Added `autoSavePrefix` parameter
   - Passes to `handleQuery()` for parsed query intents

**Expected Behavior**:
```
User: [has pending ₦150,000 ads expense]
User: "How much do I have left from today's sales?"

Bot:
✅ Saved your pending ₦150,000 expense first.

💵 Cash in Drawer today

₦620,000

Breakdown:
Cash sales: +₦785,000
Expenses: -₦150,000
Withdrawals: -₦5,000
Loans given: -₦10,000

📌 This is physical money, not profit
```

---

## New SQL Formulas

### Cash in Drawer (router.ts:715-777)
```sql
-- Cash sales (+)
SELECT SUM(amount * 100) FROM sales_entries
WHERE business_id = ? AND date BETWEEN ? AND ?

-- Debt repayments received (+)
SELECT SUM(amount_kobo) FROM whatsapp_debt_payments
WHERE debt_id IN (SELECT id FROM whatsapp_debts WHERE business_id = ?)
AND payment_date BETWEEN ? AND ?

-- Expenses (-)
SELECT SUM(amount_kobo) FROM whatsapp_expenses
WHERE business_id = ? AND expense_date BETWEEN ? AND ?

-- Withdrawals (-)
SELECT SUM(amount_kobo) FROM owner_withdrawals
WHERE business_id = ? AND withdrawal_date BETWEEN ? AND ?

-- Loans given (-)
SELECT SUM(amount_kobo) FROM whatsapp_debts
WHERE business_id = ? AND is_loan = true
AND sale_date BETWEEN ? AND ?

-- Final calculation:
cash_in_drawer = cash_sales + debt_repayments - expenses - withdrawals - loans_given
```

---

## Files Changed

### New File
- `supabase/migrations/009_whatsapp_expenses.sql` - Expense tracking table

### Modified Files
1. `src/lib/whatsapp/commit.ts`
   - Lines 259-321: Implemented `commitExpense()` with database insert

2. `src/lib/whatsapp/router.ts`
   - Line 77: Updated expiry comment
   - Lines 194-204: Updated `routeMessage()` pending check with auto-save flow
   - Lines 271-379: Rewrote `handleConfirmationReply()` with LLM parsing
   - Line 387: Added `autoSavePrefix` parameter to `handleSaleIntent()`
   - Line 504: Pass `autoSavePrefix` to `handleQuery()` in sale intent handler
   - Line 544: Added `autoSavePrefix` parameter to `handleQuery()`
   - Line 581-585: Added `autoSavePrefix` parameter to `handleSpecificQuery()`
   - Line 685: Removed conditional for expenses (always show)
   - Line 715: Prepend `autoSavePrefix` to query response
   - Lines 751-758: Query expenses from database (was hardcoded 0)

3. `src/lib/whatsapp/confirmation.ts`
   - Line 77: Changed expiry from 60 min to 30 min

---

## Test Cases

### Test 1: Expense Subtracts from Cash ✅
**Steps**:
1. Log sale: "I sold 785,000"
2. Confirm: "1"
3. Log expense: "I spent 150k on ads"
4. Confirm: "1"
5. Log withdrawal: "I take 5k for myself"
6. Confirm: "1"
7. Log loan: "I gave Clara 10k"
8. Confirm: "1"
9. Query: "how much do I have left from today's sales?"

**Expected**: Cash in drawer = ₦620,000 with full breakdown showing all 4 items

---

### Test 2: Pending + Query = Auto-Save ✅
**Steps**:
1. Log expense: "I spent 150k on ads"
2. **DON'T confirm** (pending)
3. Ask query: "How much do I have left from today's sales?"

**Expected**:
```
✅ Saved your pending ₦150,000 expense first.

💵 Cash in Drawer today
₦620,000
...
```

---

### Test 3: Pending + New Sale = Auto-Save ✅
**Steps**:
1. Log sale: "I sold 5000"
2. **DON'T confirm** (pending)
3. Log new sale: "I also sold 3000"

**Expected**: First sale auto-saved, new sale creates new pending confirmation

---

### Test 4: Confirmation Still Works ✅
**Steps**:
1. Log sale: "I sold 5000"
2. Reply: "1"

**Expected**: Saved normally (unchanged)

---

### Test 5: Rejection Still Works ✅
**Steps**:
1. Log sale: "I sold 5000"
2. Reply: "2"

**Expected**: Cancelled (unchanged)

---

### Test 6: Correction Still Works ✅
**Steps**:
1. Log sale: "I sold 5000"
2. Reply: "no na 4500"

**Expected**: Cancelled, prompted to send correct amount (unchanged)

---

## Database Migration Required

**CRITICAL**: Apply this migration to Supabase BEFORE deploying:

```bash
# In Supabase SQL Editor, run:
# File: supabase/migrations/009_whatsapp_expenses.sql
```

Or via CLI:
```bash
cd floin
supabase db push
```

---

## Summary

Both issues are now **FIXED**:

1. ✅ **Cash calculation** - Expenses are queried from database and subtracted
2. ✅ **Pending blocking** - Auto-save policy keeps conversation flowing

The bot now behaves like a human clerk:
- Doesn't trap users in confirmation loops
- Auto-saves low-risk pending entries when new intents arrive
- Shows clear notification when auto-save happens
- Accurately tracks all money movements (sales, expenses, withdrawals, loans)

---

Last Updated: June 17, 2026
Build Status: ✅ Compiled successfully
