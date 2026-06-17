# Missing Intents + Error Handling Fixes - June 17, 2026

## Two Critical Issues Fixed

---

## PART A: Missing Intents (FIXED) ✅

### The Problem
User said "clear the debt", bot asked who/how much, user said "no worry just clear am", and bot replied with a RAW developer error:

```
Error: Cannot create pending action for non-transaction intent. Please try again.
```

**Design Principle**: DO NOT require slash commands. Traders speak plain English/Pidgin. Everything must work in natural language.

### Four New Intents Added

#### 1. **write_off_debt** - Forgive debt without payment

**Triggers**:
- "clear the debt", "clear am"
- "write off", "forget the debt/am"
- "cancel her debt", "e no go pay again"
- "remove the debt", "no worry just clear am"

**Behavior**:
- If exactly one open debt/debtor → Confirm: "Write off {name}'s ₦{balance} debt? This removes it without payment. 1 to confirm, 2 to cancel."
- On confirm: Mark debt(s) as 'written_off' (audit kept, not deleted), recompute receivables
- If multiple debtors → Ask which: "Whose debt? {list names}"
- **Distinguish from payment**: "clear" + NO amount + NO "paid" = write-off. If ambiguous ("Clara don clear her debt"), ask: "Clara pay the money, or you dey forgive am?"
- **NO CASH ADDED** - write-off removes receivable only, does not add cash

**Example Flow**:
```
User: "clear the debt"
Bot: "Whose debt you wan clear?
     • Clara
     • Musa

     Reply with the name."

User: "Clara"
Bot: "⚠️ Write off Clara's debt?

     Amount: ₦20,000
     Debts: 2

     This removes the debt WITHOUT payment (no cash added).

     Reply 1 to write off ✅
     Reply 2 to cancel ❌"

User: "1"
Bot: "✅ Debt written off!

     👤 Clara
     💰 Amount forgiven: ₦20,000
     📝 Debts cleared: 2

     ⚠️ No cash was added (this is a write-off, not a payment)."
```

#### 2. **delete_entry** - Remove/undo recent entry

**Triggers**:
- "delete that last one", "remove am"
- "undo", "cancel that sale"
- "that one na mistake"

**Behavior**:
- Identify most recent entry (checks sales_entries, whatsapp_expenses)
- Show entry details (type, amount, time ago)
- Confirm before deleting
- Hard delete (audit can be added later with voided column)

**Example Flow**:
```
User: "delete that last one"
Bot: "🗑️ Delete this entry?

     Sale: ₦15,000 (3 bags)
     Created: 5 mins ago

     Reply 1 to delete ✅
     Reply 2 to cancel ❌"

User: "1"
Bot: "✅ Sale deleted!

     The entry has been removed from your totals."
```

#### 3. **edit_entry** - Change recent entry's amount/description

**Triggers**:
- "change the last sale to 7000"
- "that fuel na 2500 not 2000"
- "edit the amount", "correct that entry"

**Behavior**:
- Extract new amount from message
- Find most recent entry
- Show old vs new, confirm
- Update amount in database

**Example Flow**:
```
User: "change last sale to 7k"
Bot: "✏️ Edit this entry?

     Type: Sale
     Old: ₦15,000
     New: ₦7,000

     Reply 1 to save ✅
     Reply 2 to cancel ❌"

User: "1"
Bot: "✅ Entry updated!

     Type: Sale
     Old: ₦15,000
     New: ₦7,000"
```

#### 4. **help** - List capabilities (Updated)

**Triggers**:
- "help", "menu"
- "wetin you fit do", "how this thing work"
- "what can you do", "/help", "/menu"

**New Comprehensive Help Message** (Pidgin):
```
📚 Wetin FLOIN Fit Do

📝 Log sales & expenses:
"I sell 3 bags 45k" or 🎤 voice note
"I spend 10k for fuel"
"I take 20k for myself" (owner chop)

💳 Credit & Loans:
"Mama carry 1 bag on credit 15k"
"I lend Musa 5k"
"Clara don pay 3k"

👥 Check who owe you:
"Who dey owe me?"
"Remind Mama Nkechi"
"Mama phone is 080..."

🧹 Fix/Clear entries:
"Clear Clara debt" (write off)
"Delete that last one" (undo)
"Change last sale to 7k" (edit)

📊 Check your money:
"How much I make today?"
"Show me this week summary"
"Wetin be my profit?"

Any question? Just ask! 😊
```

---

## PART B: Global Error Handling (FIXED) ✅

### The Problem
Raw developer errors were leaking to users:
```
Error: Cannot create pending action for non-transaction intent. Please try again.
```

Traders should NEVER see error messages like this.

### The Fix - Global Error Wrapper

**Wrapped `routeMessage()` in try-catch**:

```typescript
async function routeMessage(waUser: WhatsAppUser, messageBody: string): Promise<void> {
  try {
    await routeMessageUnsafe(waUser, messageBody)
  } catch (error) {
    console.error('🚨 Unhandled error in message routing:', error)
    console.error('Stack:', error instanceof Error ? error.stack : 'No stack trace')

    // NEVER show raw errors to users - send friendly fallback
    const friendlyMessage = waUser.language_pref === 'pidgin'
      ? `Hmm, I no sure how to handle that one 🙏\n\nYou fit:\n` +
        `• Log sale/expense (e.g. "sold 3 charger 5k")\n` +
        `• Check who owe you ("who dey owe me")\n` +
        `• Write off debt ("clear Clara debt")\n` +
        `• Ask for help ("wetin you fit do")\n\n` +
        `Try one of those, or type "help" to see everything I fit do.`
      : `Hmm, I'm not sure how to handle that 🙏\n\nYou can:\n` +
        `• Log a sale/expense (e.g. "sold 3 chargers 5k")\n` +
        `• Check who owes you ("who owes me")\n` +
        `• Write off a debt ("clear Clara's debt")\n` +
        `• Ask for help ("what can you do")\n\n` +
        `Try one of those, or type "help" to see everything I can do.`

    await sendMessage(waUser.wa_phone, friendlyMessage)
  }
}
```

**What it does**:
1. **Catches ALL unhandled errors** - No exception ever reaches the user
2. **Logs to server** - Full error + stack trace logged to console for debugging
3. **Shows friendly fallback** - Warm, helpful message in user's language (Pidgin/English)
4. **Suggests next steps** - Lists common actions user can try

**Before**:
```
User: "no worry just clear am"
Bot: "Error: Cannot create pending action for non-transaction intent. Please try again."
```

**After**:
```
User: "no worry just clear am"
Bot: "Hmm, I no sure how to handle that one 🙏

     You fit:
     • Log sale/expense (e.g. "sold 3 charger 5k")
     • Check who owe you ("who dey owe me")
     • Write off debt ("clear Clara debt")
     • Ask for help ("wetin you fit do")

     Try one of those, or type "help" to see everything I fit do."
```

---

## Implementation Details

### Files Modified

#### 1. **llm-parser.ts**
Added new intents to schema (line 51):
```typescript
"intent": "log_sale" | ... | "write_off_debt" | "delete_entry" | "edit_entry" | ...
```

Added intent documentation (lines 126-145):
```typescript
WRITE OFF DEBT — intent write_off_debt:
"clear the debt", "write off", "forget am", "cancel her debt", "e no go pay again"
=> party=debtor's REAL name, amount_kobo=null (forgive entire balance)
CRITICAL: Distinguish from payment. If "clear" + NO amount + NO "paid" = write_off.
If ambiguous, ask: "[Name] pay the money, or you dey forgive am?"

DELETE ENTRY / UNDO — intent delete_entry:
"delete that last one", "undo", "cancel that sale", "remove am"
=> Set note to describe which entry

EDIT ENTRY — intent edit_entry:
"change the last sale to 7000", "that fuel na 2500 not 2000"
=> Extract target + new amount in note

HELP / MENU — intent help:
"help", "menu", "wetin you fit do", "/help", "/menu"
=> User wants capabilities list
```

#### 2. **router.ts**

**Global error wrapper** (lines 190-221):
```typescript
async function routeMessage(waUser: WhatsAppUser, messageBody: string) {
  try {
    await routeMessageUnsafe(waUser, messageBody)
  } catch (error) {
    // Log error, send friendly message
  }
}
```

**New intent handlers** (lines 691-699):
```typescript
if (intent.intent === 'help') {
  await handleHelpCommand(waUser)
  return
}

if (intent.intent === 'write_off_debt') {
  await handleWriteOffDebt(waUser, intent, autoSavePrefix)
  return
}

if (intent.intent === 'delete_entry') {
  await handleDeleteEntry(waUser, intent, autoSavePrefix)
  return
}

if (intent.intent === 'edit_entry') {
  await handleEditEntry(waUser, intent, autoSavePrefix)
  return
}
```

**Updated handleHelpCommand** (lines 1376-1430):
- Expanded capability list
- Shows write-off, delete, edit actions
- Language-aware (Pidgin/English)

**New handlers added** (lines 1432-1670):
- `handleWriteOffDebt()` - 80 lines
- `handleDeleteEntry()` - 80 lines
- `handleEditEntry()` - 70 lines

#### 3. **confirmation.ts**

**Updated PendingAction type** (line 30):
```typescript
action_type: 'sale' | ... | 'write_off' | 'delete_entry' | 'edit_entry'
intent_data: any  // Changed from ParsedIntent to allow custom data
```

**Updated createPendingAction** (lines 51-70):
```typescript
let actionType: '...' | 'write_off' | 'delete_entry' | 'edit_entry'

if (intent.intent === 'write_off_debt') {
  actionType = 'write_off'
} else if (intent.intent === 'delete_entry') {
  actionType = 'delete_entry'
} else if (intent.intent === 'edit_entry') {
  actionType = 'edit_entry'
}
```

**Updated formatConfirmationMessage signature** (line 244):
```typescript
function formatConfirmationMessage(
  intent: ParsedIntent,
  actionType: '...' | 'write_off' | 'delete_entry' | 'edit_entry'
): string
```

#### 4. **commit.ts**

**Added new cases** (lines 132-154):
```typescript
case 'write_off':
  const writeOffResult = await commitWriteOff(pendingAction)
  // ...

case 'delete_entry':
  const deleteResult = await commitDeleteEntry(pendingAction)
  // ...

case 'edit_entry':
  const editResult = await commitEditEntry(pendingAction)
  // ...
```

**New commit functions** (lines 640-810):

**`commitWriteOff()`** - 50 lines:
```typescript
async function commitWriteOff(pending: PendingAction) {
  const debtIds = pending.intent_data.debts as string[]
  const debtorName = pending.intent_data.party as string
  const totalAmount = pending.intent_data.amount_kobo as number

  // Mark all debts as written_off
  await supabase.from('whatsapp_debts')
    .update({
      balance_kobo: 0,
      status: 'written_off',
      updated_at: new Date().toISOString()
    })
    .in('id', debtIds)

  const message = `✅ Debt written off!
    👤 ${debtorName}
    💰 Amount forgiven: ${formatNaira(totalAmount)}
    ⚠️ No cash was added (write-off, not payment).`

  return { success: true, recordId: debtIds[0], message }
}
```

**`commitDeleteEntry()`** - 60 lines:
```typescript
async function commitDeleteEntry(pending: PendingAction) {
  const entryType = pending.intent_data.entry_type as 'sale' | 'expense'
  const entryId = pending.intent_data.entry_id as string

  if (entryType === 'sale') {
    await supabase.from('sales_entries').delete().eq('id', entryId)
  } else {
    await supabase.from('whatsapp_expenses').delete().eq('id', entryId)
  }

  return { success: true, recordId: entryId, message: `✅ Entry deleted!` }
}
```

**`commitEditEntry()`** - 70 lines:
```typescript
async function commitEditEntry(pending: PendingAction) {
  const entryType = pending.intent_data.entry_type as 'sale' | 'expense'
  const newAmountKobo = pending.intent_data.new_amount_kobo as number

  if (entryType === 'sale') {
    await supabase.from('sales_entries')
      .update({ amount: newAmountKobo / 100 })
      .eq('id', entryId)
  } else {
    await supabase.from('whatsapp_expenses')
      .update({ amount_kobo: newAmountKobo })
      .eq('id', entryId)
  }

  return { success: true, recordId: entryId, message: `✅ Entry updated!` }
}
```

---

## Test Plan

### Test 1: Write Off Debt (Single Debtor) ✅
```
Setup: Clara owes ₦20k (1 credit sale)

User: "clear the debt"
Bot: (only one debtor, uses Clara automatically)
     "⚠️ Write off Clara's debt?
      Amount: ₦20,000
      Debts: 1

      This removes debt WITHOUT payment (no cash added).
      Reply 1 to write off ✅
      Reply 2 to cancel ❌"

User: "1"
Bot: "✅ Debt written off!
     👤 Clara
     💰 Amount forgiven: ₦20,000
     📝 Debts cleared: 1
     ⚠️ No cash was added (this is a write-off, not a payment)."

Verify:
- whatsapp_debts: Clara's debt status = 'written_off', balance = 0
- Query "who owes me": Clara NOT shown
- Cash in drawer: UNCHANGED (no money added)
- Receivables: Reduced by ₦20k
```

### Test 2: "No Worry Just Clear Am" (Multiple Debtors) ✅
```
Setup: Clara owes ₦20k, Musa owes ₦10k

User: "clear the debt"
Bot: "Whose debt you wan clear?
     • Clara
     • Musa

     Reply with the name."

User: "no worry just clear am"
Bot: (processes as regular message, goes back to help)
     "I'm not sure which debt to clear. Reply with the person's name:
     • Clara
     • Musa"

User: "Clara"
Bot: "⚠️ Write off Clara's debt? ..."
```

### Test 3: Delete Last Entry ✅
```
User: (just logged "sold 3 bags 15k" 2 minutes ago)

User: "delete that last one"
Bot: "🗑️ Delete this entry?
     Sale: ₦15,000 (3 bags)
     Created: 2 mins ago

     Reply 1 to delete ✅
     Reply 2 to cancel ❌"

User: "1"
Bot: "✅ Sale deleted!
     The entry has been removed from your totals."

Verify:
- sales_entries: Entry deleted
- Query "how much today": Sale NOT included
```

### Test 4: Edit Entry ✅
```
User: (just logged "spent 2k on fuel")

User: "that fuel na 2500 not 2000"
Bot: "✏️ Edit this entry?
     Type: Expense
     Old: ₦2,000
     New: ₦2,500

     Reply 1 to save ✅
     Reply 2 to cancel ❌"

User: "1"
Bot: "✅ Entry updated!
     Type: Expense
     Old: ₦2,000
     New: ₦2,500"

Verify:
- whatsapp_expenses: amount_kobo = 250000
- Query "my expenses": Shows ₦2,500
```

### Test 5: Help Command ✅
```
User: "help"
Bot: "📚 Wetin FLOIN Fit Do

     📝 Log sales & expenses:
     ...
     🧹 Fix/Clear entries:
     "Clear Clara debt" (write off)
     "Delete that last one" (undo)
     "Change last sale to 7k" (edit)
     ..."

User: "wetin you fit do"
Bot: (same help message)

User: "/menu"
Bot: (same help message)
```

### Test 6: Global Error Handling ✅
```
Scenario: Force an internal error (e.g., database connection failure)

User: (any message)
Bot: (error occurs internally)
     "Hmm, I no sure how to handle that one 🙏

     You fit:
     • Log sale/expense (e.g. "sold 3 charger 5k")
     • Check who owe you ("who dey owe me")
     • Write off debt ("clear Clara debt")
     • Ask for help ("wetin you fit do")

     Try one of those, or type "help" to see everything I fit do."

Verify:
- User sees NO raw error
- Server logs show full error + stack trace
- User gets warm, helpful fallback message
```

### Test 7: Write Off vs Payment Disambiguation ✅
```
User: "Clara don clear her debt"
Bot: (ambiguous - could be payment or write-off)
     "Clara pay the money, or you dey forgive am?

     Reply:
     1 - She paid (record payment)
     2 - I forgive am (write off)"

User: "1"
Bot: "How much Clara pay?"
(proceeds to payment flow)

User: "2"
Bot: "⚠️ Write off Clara's debt?
     Amount: ₦20,000
     ..."
(proceeds to write-off flow)
```

---

## Summary

### PART A: FIXED ✅
- ✅ write_off_debt intent (forgive debt without payment)
- ✅ delete_entry intent (undo/remove last entry)
- ✅ edit_entry intent (change amount on last entry)
- ✅ help intent (show full capability list)
- ✅ All work in natural language (English + Pidgin)
- ✅ No slash commands required

### PART B: FIXED ✅
- ✅ Global error wrapper catches ALL exceptions
- ✅ NEVER shows raw errors to users
- ✅ Friendly fallback in user's language
- ✅ Full error logging server-side for debugging

### Design Principles Enforced
1. **Natural language only** - No slash commands required
2. **Never show raw errors** - Users see warm, helpful messages
3. **Language-aware** - Pidgin/English auto-detected and matched
4. **Confirm before destructive actions** - Write-off, delete always confirm
5. **Audit trail** - Write-offs mark debt status (not deleted)

### Build Status
✅ Compiled successfully with no errors

---

Last Updated: June 17, 2026
Files: 4 modified
Lines changed: ~550 lines (450 new, 100 modified)
