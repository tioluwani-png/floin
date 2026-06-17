# FLOIN WhatsApp Bot - Current Status & Memory

## Latest Session Summary (June 2026)

### CRITICAL BUGS FIXED

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

---

## Current Architecture

### Money Event Types

| Event Type | Revenue? | Cash Effect | Creates Receivable? | Table |
|------------|----------|-------------|---------------------|-------|
| `cash_sale` | ✅ YES | + cash | No | sales_entries |
| `credit_sale` | ✅ YES | none | Yes (is_loan=false) | sales_entries + whatsapp_debts |
| `loan_given` | ❌ NO | - cash | Yes (is_loan=true) | whatsapp_debts ONLY |
| `expense` | ❌ NO | - cash | No | (to be implemented) |
| `owner_withdraw` | ❌ NO | - cash | No | owner_withdrawals |
| `debt_repaid` | ❌ NO | + cash | Reduces receivable | whatsapp_debt_payments |

### Database Schema

**Pending Migrations** (must be run in Supabase):
1. `005_owner_withdrawals.sql` - Owner withdrawal tracking
2. `006_onboarding_and_clarification.sql` - Onboarding states + clarification context
3. `007_language_preference.sql` - Pidgin/English language support
4. `008_loan_given_fix.sql` - Loan vs sale separation

**Key Tables**:
- `whatsapp_users` - User profiles with onboarding_state, language_pref
- `whatsapp_messages_raw` - All incoming messages (dedupe)
- `whatsapp_pending_actions` - Confirm-before-commit workflow
- `whatsapp_debts` - Credit sales AND loans (is_loan flag distinguishes)
- `whatsapp_debt_payments` - Payment history
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

---

## Known Issues / TODO

1. **Expenses table not implemented** - Currently defaults to ₦0
2. **Daily summaries** - Cron job exists but needs update with 3 concepts
3. **Team members** - WhatsApp access for multiple users per business
4. **Multi-business** - Switching between businesses not implemented
5. **Payment gate** - Trial expiry and Paystack integration (Phase 1 Week 6)

---

## Key Files Modified (This Session)

### Database
- `supabase/migrations/006_onboarding_and_clarification.sql` (NEW)
- `supabase/migrations/007_language_preference.sql` (NEW)
- `supabase/migrations/008_loan_given_fix.sql` (NEW)

### Core Logic
- `src/lib/whatsapp/llm-parser.ts` - Claude Sonnet 4.6, loan_given intent, language mirroring
- `src/lib/whatsapp/router.ts` - Query routing, cash calculation, 3 concepts separation
- `src/lib/whatsapp/confirmation.ts` - Tolerant matching, loan_given confirmation
- `src/lib/whatsapp/commit.ts` - commitLoanGiven(), timezone fixes

### Key Functions
- `calculateCashInDrawer()` - SQL-based cash position (router.ts:699)
- `getTotalReceivables()` - Sum outstanding debts (router.ts:763)
- `handleSpecificQuery()` - Metric + time routing (router.ts:524)
- `handleOnboarding()` - State machine (router.ts:643)
- `handleConfirmationReply()` - Tolerant matching (router.ts:265)
- `commitLoanGiven()` - Creates debt, no sale (commit.ts:417)

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

---

Last Updated: June 17, 2026
Current Status: ✅ Production Ready (pending migrations)
