# Onboarding & Clarification Context Fix

## Summary
Fixed two critical bugs in the WhatsApp bot:
1. **Onboarding State Machine** - Users now go through proper onboarding instead of jumping straight to the parser
2. **Clarification Context** - Bot remembers partial parses during multi-turn clarifications

## Bug 1: Onboarding State Machine

### Problem
Users were going straight to the LLM parser without being asked for their name or business name. The old onboarding was too simplistic and didn't guide users properly.

### Solution
Implemented a proper state machine with these states:
- `new` → Ask for user's name
- `asked_name` → Ask for business name
- `asked_biz` → Ask for first sale
- `first_sale` → User enters first transaction
- `done` → Onboarding complete

### Implementation

**Database Changes** (`006_onboarding_and_clarification.sql`):
- Added `onboarding_state` column to `whatsapp_users` table
- Added `owner_name` column to store user's name
- Set existing users to `onboarding_state='done'`

**Router Changes** (`router.ts`):
- Updated `WhatsAppUser` interface to include `onboarding_state` and `owner_name`
- Changed onboarding check from `!waUser.onboarding_completed_at` to `waUser.onboarding_state !== 'done'`
- Completely rewrote `handleOnboarding()` function:
  - Returns `boolean` (true if message was consumed)
  - Implements state transitions with proper messages
  - Only asks LLM parser when state is `first_sale` or `done`

**Commit Changes** (`commit.ts`):
- Added logic to mark `onboarding_state='done'` when user confirms first transaction
- Also sets `onboarding_completed_at` timestamp

### Flow Example

```
User: "Hi"
Bot: "👋 Welcome to FLOIN! I'm your bookkeeping assistant... First, what's your name?"
State: new → asked_name

User: "Tunde"
Bot: "Nice to meet you, Tunde! 😊 What's the name of your business?"
State: asked_name → asked_biz

User: "Jollof Shop"
Bot: "Perfect! 🎉 Jollof Shop is all set up. Now, tell me about your first sale today..."
State: asked_biz → first_sale

User: "Sold 3 bags 45k"
Bot: [Sends confirmation] "📝 Confirm this sale?..."
State: first_sale (still)

User: "Yes"
Bot: "✅ Sale saved! Today's total: ₦45,000"
State: first_sale → done
```

## Bug 2: Clarification Context

### Problem
When the LLM asked for clarification (e.g., "How much?"), the next user message was parsed without context. Example:

```
User: "I sold 3 bags of ice cream"
Bot: "How much?" [partial_parse lost]
User: "5000"
Bot: [Parses "5000" alone, forgets about ice cream]
```

### Solution
Implemented clarification context with partial parse preservation and LLM merge mode.

### Implementation

**Database Changes** (`006_onboarding_and_clarification.sql`):
- Added `'clarifying'` as valid `action_type` in `whatsapp_pending_actions`
- Added `partial_parse` jsonb column to store incomplete intent

**Parser Changes** (`llm-parser.ts`):
- Added optional `partialParse` parameter to `parseMessage()`
- Implemented merge mode: when `partialParse` is provided, sends it to LLM with instructions to merge
- LLM receives both the partial parse and the new reply, returns complete merged intent

**Router Changes** (`router.ts`):
- `handleSaleIntent()` now checks for active clarification context first
- If clarification exists:
  - **Shortcut mode**: If reply is just a number (e.g., "5000", "45k"), directly merge it as the amount
  - **LLM merge mode**: Otherwise, call `parseMessage()` with partial parse
- When LLM needs clarification:
  - Creates a `action_type='clarifying'` pending action
  - Stores full intent as `partial_parse`
  - 10-minute expiry (shorter than regular confirmations)
- After merge, deletes the clarification pending action

**Type Changes** (`confirmation.ts`):
- Updated `PendingAction` interface to include `'clarifying'` action type
- Added `partial_parse?: Partial<ParsedIntent>` field

### Flow Example

```
User: "I sold 3 bags of ice cream"
LLM: {intent: "log_sale", items: [{qty: 3, description: "ice cream", amount_kobo: null}], needs_clarification: true}
Bot: "How much?"
[Stores partial_parse in whatsapp_pending_actions with action_type='clarifying']

User: "5000"
[Router finds clarification context]
[Shortcut mode: plain number detected]
[Merges: amount_kobo = 5000 * 100 = 500000 kobo]
Result: {qty: 3, description: "ice cream", amount_kobo: 500000}
Bot: "📝 Confirm this sale? 📦 3 ice cream: ₦5,000..."
```

### Merge Mode LLM Prompt

When partial parse exists, the LLM receives:
```
Previous partial parse (user said this before):
{intent: "log_sale", items: [{qty: 3, description: "ice cream", amount_kobo: null}], ...}

Now user replied: "five thousand"

Merge the new reply with the partial parse. If the new message is just a number
and amount_kobo was missing, fill it in. Return the complete merged intent.
```

## Files Changed

### New Files
- `supabase/migrations/006_onboarding_and_clarification.sql` - Database schema updates

### Modified Files
- `src/lib/whatsapp/llm-parser.ts` - Added merge mode support
- `src/lib/whatsapp/router.ts` - Onboarding state machine + clarification context
- `src/lib/whatsapp/commit.ts` - Mark onboarding done on first commit
- `src/lib/whatsapp/confirmation.ts` - Updated types for clarifying action

## Testing Checklist

### Onboarding
- [ ] New user gets asked for name first
- [ ] After name, asked for business name
- [ ] After business name, asked to log first sale
- [ ] First sale confirmation marks onboarding as done
- [ ] Existing users skip onboarding (state already 'done')

### Clarification
- [ ] "I sold 3 bags of ice cream" → Bot asks "How much?"
- [ ] Reply "5000" → Bot remembers ice cream, creates confirmation for "3 bags ice cream ₦5,000"
- [ ] Shortcut works: plain numbers like "45k", "2500", "1.5m"
- [ ] Complex clarifications use LLM merge mode
- [ ] Expired clarifications (10 min) are cleaned up
- [ ] No memory leaks from pending clarifications

## Key Technical Details

### State Machine Gate
The onboarding check happens **before** the LLM parser in `routeMessage()`:
```typescript
// Onboarding flow - must come before parser
if (waUser.onboarding_state !== 'done') {
  const consumed = await handleOnboarding(waUser, messageBody)
  if (consumed) return  // Don't pass to parser
}
```

This ensures the LLM never sees onboarding questions like "What's your name?"

### Clarification Shortcut
Plain number detection regex:
```typescript
const numberMatch = messageBody.match(/^(\d+\.?\d*)[kKmM]?$/)
```
Matches: "5000", "45k", "2.5m", "1500"
Doesn't match: "five thousand" (uses LLM), "5000 naira today" (uses LLM)

### Money Conversion in Shortcut
```typescript
if (suffix.includes('k')) {
  amountKobo = value * 1000 * 100  // k = thousand
} else if (suffix.includes('m')) {
  amountKobo = value * 1000000 * 100  // m = million
} else {
  amountKobo = value * 100  // plain number
}
```

All internal processing uses **kobo** (integers) for precision.

## Impact

### User Experience
- ✅ Proper onboarding with guided questions
- ✅ Bot remembers context during clarifications
- ✅ Faster clarification resolution (shortcut for plain numbers)
- ✅ No more "I don't understand" after giving requested info

### Code Quality
- ✅ Proper state machine pattern
- ✅ Clear separation of concerns (onboarding vs parsing)
- ✅ Type-safe clarification handling
- ✅ Self-cleaning (expired clarifications)

## Next Steps

Optional enhancements:
1. Add name personalization in messages ("Hi Tunde, here's your summary...")
2. Allow editing business name after onboarding
3. Support multiple clarification turns (currently assumes single turn)
4. Add analytics for clarification success rate
