# FLOIN WhatsApp Bot - Current Status & Memory

## Latest Session Summary (June 17, 2026)

### CRITICAL BUGS FIXED (Session 3 - Most Recent)

#### 1. Money Categorization Bug (FIXED)
**Problem**: Cash loans were being recorded as credit SALES, inflating revenue.
- "I gave Clara 10k cash loan" → recorded as sale (+₦10k revenue) ❌

**Solution**: Introduced `loan_given` as separate intent
- New action type: `loan_given` (distinct from `sale`)
- Database: Added `is_loan` boolean to `whatsapp_debts` table
- Credit sale (goods): IS revenue → creates sales_entries row
- Loan given (cash): NOT revenue → creates debt only, NO sales row
- Migration: `008_loan_given_fix.sql`

#### 2. Query Routing Bug (FIXED)
**Problem**: All queries returned generic sales summary, ignoring actual question.
- "what are my expenses?" → returned SALES summary ❌

**Solution**: Proper metric + time detection
- Metrics: sales, expenses, profit, withdrawals, balance, debts, summary
- Time refs: today, yesterday, this_week, this_month
- Each query gets SPECIFIC calculation and answer

#### 3. Visibility Bug (FIXED)
**Problem**: Loans/withdrawals reduce cash but didn't show in summaries.
- Users thought app lost track of money when they lent ₦10k

**Solution**: THREE distinct concepts now clearly separated:

**PROFIT** = sales revenue − business expenses
- NOT reduced by owner withdrawals or loans (not business costs)
- `profitKobo = salesKobo - expensesKobo`

**CASH IN DRAWER** = physical money position (SQL-based)
- Formula: `cash_sales + debt_repayments − expenses − withdrawals − loans_given`
- Function: `calculateCashInDrawer()` in router.ts:699-761
- Shows exactly what's physically in the drawer

**RECEIVABLES** = money owed TO user
- Both credit sales (is_loan=false) AND loans (is_loan=true)
- Function: `getTotalReceivables()` in router.ts:763-775

#### 4. Confirmation Flow Bug (FIXED)
**Problem**: Button said "✅ Confirm" but code only accepted "yes"/"1"
- User clicks "Confirm" → "You have a pending sale" error ❌

**Solution**: Tolerant regex-based matching
- Accepts: confirm, Confirm, 1, yes, ok, sure, save, na so, e correct, ✅
- Accepts: 2, cancel, no, delete, forget, wrong, e no correct, ❌
- Wording updated: "Reply *1* to save ✅ or *2* to cancel ❌"

#### 5. Timezone Bug (FIXED)
**Problem**: "Today's total: ₦0" after saving sale
- Date mismatch: commitSale used UTC, getTodayTotal used Lagos time

**Solution**: All dates now use Lagos timezone consistently
- `toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })`

#### 6. Deprecated Model (FIXED)
**Problem**: Claude model `claude-3-5-sonnet-20241022` returned 404 errors

**Solution**: Updated to `claude-sonnet-4-6`

#### 7. Cash in Drawer Missing Expenses (FIXED)
**Problem**: Expenses were not subtracted from cash in drawer calculation
- User logged ₦150k expense, asked "how much I have left"
- Cash showed ₦770k (wrong), should be ₦620k
- Correct: 785k sales - 150k expense - 5k withdrawal - 10k loan = ₦620k

**Solution**: Updated calculateCashInDrawer() to query and subtract expenses
- Now queries `whatsapp_expenses` table
- Formula: `cash = cash_sales + debt_repayments - expenses - withdrawals - loans_given`
- Expenses always shown in breakdown (not conditional)

#### 8. Pending Confirmations Blocking New Messages (FIXED)
**Problem**: When expense was pending, user's query was blocked
- Pending expense awaiting confirmation
- User asked "How much do I have left?"
- Bot just repeated "Reply 1 to save or 2 to cancel" (annoying!)

**Solution**: Auto-save policy implemented
- Parse message to detect if it's a NEW intent (query, greeting, transaction)
- If new intent with confidence >0.7 → auto-save pending, process new message
- Prepend notification: "✅ Saved your pending ₦150k expense first.\n\n"
- Only re-prompt if message is genuinely ambiguous
- Reduced pending expiry from 1 hour to 30 minutes

#### 9. Pronouns Saved as Debtor Names (FIXED)
**Problem**: Pronouns like "her", "him", "oga", "customer" stored as literal names
- Debt list showed debtor named "her" owing ₦10k

**Solution**: Name validation and rejection system
- Created `name-utils.ts` with NON_NAMES list (pronouns/generic terms)
- LLM parser rejects pronouns, asks "Who be the person? Wetin be him/her name?"
- Backend validation guard in commitSale() and commitLoanGiven()
- Names cleaned and capitalized consistently

#### 10. Debt Count Mismatch (FIXED)
**Problem**: Header said "Outstanding Debts (3)" but only 2 rows shown
- Counted raw debt records vs grouped customers

**Solution**: Fixed formatDebtListMessage() calculation
- Count unique customers, not total debt records
- Count and total calculated from SAME grouped data
- Header count always matches rows displayed

#### 11. Case-Sensitive Debtor Lookup (FIXED)
**Problem**: "remind Clara" worked, but "remind clara" failed
- Exact match query: case-sensitive, no fuzzy matching

**Solution**: Fuzzy matching for all debt operations
- 3-tier matching: exact normalized → contains → reverse contains
- "clara" = "Clara" = "CLARA" = " Clara "
- "musa" finds "Alh Musa" (partial match)
- Disambiguation when multiple matches found
- Updated: handleRemindCommand, handleMarkPaidCommand, saveCustomerPhone

#### 12. Expenses Consistency Bug (FIXED) - CRITICAL
**Problem**: After confirming ₦150k expense:
- Expenses showed ₦0 (WRONG)
- Profit showed ₦785k (WRONG, should be ₦635k)
- Cash showed ₦620k (CORRECT)
- Same expense counted in cash but NOT in expenses/profit!

**Root Cause**: router.ts line 610 hardcoded `expensesKobo = 0`
- Cash calculation queried expenses from DB ✅
- Summary/profit/expenses display used hardcoded 0 ❌
- Multiple separate queries with inconsistent logic

**Solution**: Single source of truth - getDailyTotals()
- Created `daily-totals.ts` module
- ONE function computes ALL figures from same queries
- Returns: sales, expenses, loans, withdrawals, repayments, profit, cash, receivables
- All reports now call getDailyTotals() and read from same object
- Mathematical guarantee: expenses/profit/cash can NEVER disagree

---

## Current Architecture

### Money Event Types

| Event Type | Revenue? | Cash Effect | Creates Receivable? | Table |
|------------|----------|-------------|---------------------|-------|
| `cash_sale` | ✅ YES | + cash | No | sales_entries |
| `credit_sale` | ✅ YES | none | Yes (is_loan=false) | sales_entries + whatsapp_debts |
| `loan_given` | ❌ NO | - cash | Yes (is_loan=true) | whatsapp_debts ONLY |
| `expense` | ❌ NO | - cash | No | whatsapp_expenses ✅ |
| `owner_withdraw` | ❌ NO | - cash | No | owner_withdrawals |
| `debt_repaid` | ❌ NO | + cash | Reduces receivable | whatsapp_debt_payments |

### Database Schema

**Pending Migrations** (must be run in Supabase):
1. `005_owner_withdrawals.sql` - Owner withdrawal tracking
2. `006_onboarding_and_clarification.sql` - Onboarding states + clarification context
3. `007_language_preference.sql` - Pidgin/English language support
4. `008_loan_given_fix.sql` - Loan vs sale separation (is_loan flag)
5. `009_whatsapp_expenses.sql` - Individual expense tracking table ✅ CRITICAL

**Key Tables**:
- `whatsapp_users` - User profiles with onboarding_state, language_pref
- `whatsapp_messages_raw` - All incoming messages (dedupe)
- `whatsapp_pending_actions` - Confirm-before-commit workflow
- `whatsapp_debts` - Credit sales AND loans (is_loan flag distinguishes)
- `whatsapp_debt_payments` - Payment history
- `whatsapp_expenses` - Individual expense entries (business costs) ✅ NEW
- `owner_withdrawals` - Personal withdrawals
- `sales_entries` - Actual sales (cash + credit sales only, NO loans)

### Parser Intents

**LLM Model**: `claude-sonnet-4-6`
**Supported Intents**:
- `log_sale` - Cash sale
- `log_sale_credit` - Credit sale (goods on credit)
- `log_loan_given` - Cash loan (NOT revenue)
- `log_expense` - Business expense
- `log_owner_withdrawal` - Personal withdrawal
- `log_payment_received` - Debt repayment
- `query` - Balance/profit/expenses questions
- `list_debts` - Who owes me
- `greeting`, `thanks`, `help`, etc.

**Critical Distinctions**:
- Credit sale: "[name] took [GOODS] on credit" → IS revenue
- Loan: "I gave/lent [name] [amount]" → NOT revenue
- Bot asks if ambiguous: "You go collect am back, or na gift?"

### Onboarding Flow

States: `new → asked_name → asked_lang → asked_biz → first_sale → done`

```
1. new → "What's your name?"
2. asked_name → "You wan make I dey yarn with you for Pidgin or English? Reply 1 for Pidgin, 2 for English"
3. asked_lang → (Pidgin) "Wetin you dey sell?" OR (English) "What do you sell?"
4. asked_biz → "Log your first sale..."
5. first_sale → After first confirmation → done
```

### Language Support

**Two-layer system**:
1. **Per-message mirroring** - LLM adapts to current message's register
2. **Per-user preference** - Saved choice for pushed messages

**Supported**:
- Nigerian Pidgin
- Nigerian English (warm, not stiff)
- Code-switching (user can mix)

**Storage**: `language_pref` column ('pidgin' | 'english' | 'auto')

### Confirmation Flow

**Tolerant Matching**:
```typescript
YES: /\b(1|yes|y|yeah|confirm|ok|sure|save|na so|e correct)\b|✅/i
NO: /\b(2|no|cancel|delete|forget|wrong|no mind|e no correct)\b|❌/i
```

**Wording**: "Reply *1* to save ✅ or *2* to cancel ❌"

### Query Routing

**Metrics Detected**:
- `expenses` → Business expenses only (excludes loans/withdrawals)
  - Shows helpful note if loan given today
- `profit` → Sales − expenses (unaffected by loans/withdrawals)
- `balance/cash` → Cash in drawer (reflects ALL money in/out)
- `sales` → Sales revenue
- `withdrawals` → Owner withdrawals
- `debts` → Receivables list

**Time Periods**: today, yesterday, this_week, this_month

**Example Responses**:
```
"expenses today" →
  📉 Expenses today: ₦2,000
  📌 No business expenses recorded
  💡 Note: ₦10,000 you lent to Clara is tracked in your debt book
  and reduces your cash, but it's not an expense (you'll get it back).

"balance today" →
  💵 Cash in Drawer today: ₦38,000
  Breakdown:
  Cash sales: +₦50,000
  Expenses: -₦2,000
  Loans given: -₦10,000
  📌 This is physical money, not profit

"profit today" →
  📊 Profit today:
  Sales: ₦50,000
  Expenses: ₦2,000
  💵 Profit: ₦48,000

"summary" →
  📊 Today — Jun 17
  💰 Sales: ₦50,000
  📉 Expenses: ₦2,000
  💸 Lent out: ₦10,000

  🟢 Profit: ₦48,000 (sales − expenses)
  💵 Cash in drawer: ₦38,000
  📌 Owed to you: ₦10,000 (1 person)
```

---

## Environment Variables

**Required in Vercel/Production**:
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# WhatsApp Cloud API
WHATSAPP_TOKEN=                    # Permanent system user token
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=

# LLM
ANTHROPIC_API_KEY=                 # For Claude Sonnet 4.6

# Voice transcription
OPENAI_API_KEY=                    # For Whisper

# Cron
CRON_SECRET=

# Payment (future)
PAYSTACK_SECRET_KEY=
```

---

## Testing Checklist

### Onboarding
- [ ] New user gets asked for name
- [ ] After name, asked Pidgin (1) or English (2)
- [ ] After language, asked for business name (in chosen language)
- [ ] After business name, prompted to log first sale
- [ ] First sale confirmation marks onboarding_state='done'

### Confirmation Flow
- [ ] "confirm" / "Confirm" / "1" / "yes" / "ok" all work
- [ ] "cancel" / "2" / "no" all work
- [ ] "na so" (Pidgin) confirms
- [ ] "e no correct" (Pidgin) cancels

### Money Categorization
- [ ] "I gave Clara 10k cash loan" → loan_given (NOT sale)
- [ ] "Musa took 2 cases on credit 3k" → credit_sale (IS sale)
- [ ] Sales total excludes loans
- [ ] Cash in drawer reflects loan leaving
- [ ] Receivables includes both credit sales and loans

### Query Routing
- [ ] "what are my expenses" → shows expenses only (NOT loans)
- [ ] "what's my balance" → shows cash in drawer
- [ ] "what's my profit" → shows sales − expenses
- [ ] "who owes me" → lists all receivables (credit + loans)
- [ ] Helpful note appears when expenses queried after loan

### Three Concepts
- [ ] Profit unchanged by loans/withdrawals
- [ ] Cash drops when money physically leaves
- [ ] Receivables increase when loan given
- [ ] Summary shows all three clearly separated

### Expenses & Consistency (Critical)
- [ ] Log expense (150k ads) → confirm → expenses shows ₦150k
- [ ] After expense: profit = sales - 150k (expenses subtracted)
- [ ] After expense: cash = sales - 150k - withdrawals - loans (expenses subtracted)
- [ ] Summary shows: Expenses ₦150k, Profit correct, Cash correct (all three agree)
- [ ] "what are my expenses" → shows ₦150k (not ₦0)

### Auto-Save Pending
- [ ] Log expense (pending) → ask query → expense auto-saved, query answered
- [ ] Auto-save message prepended: "✅ Saved your pending ₦150k expense first."
- [ ] No more "Reply 1 to save" nag loops when asking queries

### Name Handling
- [ ] "I gave him 5k" → asks "Who be the person? Wetin be him/her name?"
- [ ] No debtor named "her" / "him" / "oga" ever created
- [ ] "remind clara" / "remind CLARA" / "remind Clara" → all find Clara
- [ ] "remind musa" → finds "Alh Musa" (partial match)
- [ ] Debt list header count matches rows shown
- [ ] "Clara don pay 5k" → matches Clara (case-insensitive)

---

## Known Issues / TODO

1. ~~**Expenses table not implemented**~~ - ✅ FIXED (migration 009)
2. **Daily summaries** - Cron job exists but needs update with getDailyTotals()
3. **Team members** - WhatsApp access for multiple users per business
4. **Multi-business** - Switching between businesses not implemented
5. **Payment gate** - Trial expiry and Paystack integration (Phase 1 Week 6)

---

## Key Files Modified (All Sessions)

### Database Migrations
- `supabase/migrations/005_owner_withdrawals.sql` - Owner withdrawal tracking
- `supabase/migrations/006_onboarding_and_clarification.sql` - Onboarding states + clarification
- `supabase/migrations/007_language_preference.sql` - Pidgin/English support
- `supabase/migrations/008_loan_given_fix.sql` - Loan vs sale separation (is_loan flag)
- `supabase/migrations/009_whatsapp_expenses.sql` - Individual expense tracking ✅ NEW

### New Modules (Session 3)
- `src/lib/whatsapp/daily-totals.ts` - **SINGLE SOURCE OF TRUTH** for all money calculations ✅ CRITICAL
  - `getDailyTotals()` - Unified function, computes sales/expenses/profit/cash/receivables
  - `getDateRange()` - Date range helper
  - Ensures expenses/profit/cash can NEVER disagree
- `src/lib/whatsapp/name-utils.ts` - Name validation, normalization, fuzzy matching ✅ NEW
  - `validateCustomerName()` - Reject pronouns/generic terms
  - `normalizeName()` - Lowercase, trim, collapse spaces
  - `findMatchingNames()` - 3-tier fuzzy matching
  - `cleanDisplayName()` - Capitalize properly

### Core Logic
- `src/lib/whatsapp/llm-parser.ts` - Claude Sonnet 4.6, loan_given intent, language mirroring, pronoun rejection ✅
- `src/lib/whatsapp/router.ts` - Query routing, getDailyTotals integration, auto-save, fuzzy name matching ✅
- `src/lib/whatsapp/confirmation.ts` - Tolerant matching, 30min expiry, loan_given confirmation
- `src/lib/whatsapp/commit.ts` - commitExpense(), commitLoanGiven(), name validation, timezone fixes ✅
- `src/lib/whatsapp/debt-manager.ts` - Fuzzy customer matching, fixed debt count calculation ✅

### Key Functions (Updated)
- `getDailyTotals()` - **SINGLE SOURCE** for all money calculations (daily-totals.ts) ✅ NEW
- `handleSpecificQuery()` - Uses getDailyTotals(), all metrics from same source (router.ts) ✅ UPDATED
- `handleConfirmationReply()` - Auto-save policy, returns boolean + autoSaveMessage (router.ts) ✅ UPDATED
- `handleRemindCommand()` - Fuzzy matching, disambiguation (router.ts) ✅ UPDATED
- `handleMarkPaidCommand()` - Fuzzy matching, disambiguation (router.ts) ✅ UPDATED
- `commitExpense()` - Actually saves to whatsapp_expenses table (commit.ts) ✅ UPDATED
- `commitSale()` / `commitLoanGiven()` - Name validation guards (commit.ts) ✅ UPDATED
- `getCustomerDebts()` - Fuzzy matching instead of exact match (debt-manager.ts) ✅ UPDATED
- `formatDebtListMessage()` - Count = unique customers, not records (debt-manager.ts) ✅ UPDATED
- ~~`calculateCashInDrawer()`~~ - Moved to getDailyTotals() ✅ REFACTORED
- ~~`getTotalReceivables()`~~ - Moved to getDailyTotals() ✅ REFACTORED

---

## Critical Reminders

⚠️ **Never conflate the three concepts**:
- Profit = business performance (sales − expenses)
- Cash = physical money (what's in drawer)
- Receivables = money owed to you

⚠️ **Loans are NOT sales**:
- `is_loan=true` in whatsapp_debts
- NO sales_entries row created
- NOT counted in revenue

⚠️ **All dates use Lagos timezone**:
- `toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })`

⚠️ **Confirmation wording must match code**:
- "Reply *1* to save ✅ or *2* to cancel ❌"

⚠️ **Money always in kobo internally**:
- Convert to naira only for sales_entries table
- All calculations use integers (kobo) for precision

⚠️ **CRITICAL - Always use getDailyTotals() for money calculations**:
- NEVER create separate queries for sales/expenses/profit/cash
- ALL reports must call `getDailyTotals()` and read from returned object
- This is the ONLY way to ensure consistency
- Mathematical guarantee: expenses/profit/cash can NEVER disagree

⚠️ **Names must be validated**:
- NEVER store pronouns (her, him, oga, customer) as customer names
- All debtor writes go through `validateCustomerName()`
- All debtor lookups use fuzzy matching via `findMatchingNames()`
- Backend validation guard in commitSale() and commitLoanGiven()

---

Last Updated: June 17, 2026 (Session 3)
Current Status: ✅ Production Ready
Build Status: ✅ Compiled successfully
Critical Bugs: 12 fixed (money categorization, query routing, visibility, confirmation, timezone, model, cash, auto-save, pronouns, debt count, fuzzy matching, consistency)
