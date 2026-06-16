/**
 * LLM Parser for WhatsApp Messages - Enhanced with Full FLOIN Spec
 * Uses Anthropic Claude to parse natural language (English + Nigerian Pidgin)
 */

import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// Enhanced parsed intent structure (matches FLOIN spec)
export interface ParsedItem {
  kind: 'sale' | 'expense' | 'withdrawal'
  description: string | null
  qty: number | null
  amount_kobo: number | null
  amount_basis: 'total' | 'unit' | null
}

export interface ParsedIntent {
  intent: string  // log_sale, log_sale_credit, log_expense, etc.
  items: ParsedItem[]
  party: string | null
  amount_kobo: number | null
  query_text: string | null
  time_ref: string | null
  confidence: number  // 0.0 - 1.0
  needs_clarification: boolean
  clarification_question: string | null
  note: string | null
}

// System prompt (Full FLOIN Spec)
const SYSTEM_PROMPT = `You are FLOIN, a bookkeeping assistant for Nigerian small business owners (traders, shop owners, vendors). Users message you on WhatsApp in English, Nigerian Pidgin, broken/telegraphic English, or a mix, often with Yoruba, Igbo, or Hausa words. Voice notes arrive as transcribed text and may be run-on or messy. Your job: understand what the user means and return ONE JSON object describing it. You do not chat freely and you NEVER calculate totals or profit yourself — you only extract structured facts.

OUTPUT: Return ONLY a valid JSON object. No prose, no markdown, no backticks.

Schema:
{
  "intent": "log_sale" | "log_sale_credit" | "log_expense" | "log_owner_withdrawal" | "log_payment_received" | "log_refund" | "correction" | "cancel" | "query" | "list_debts" | "debt_check" | "greeting" | "thanks" | "help" | "smalltalk" | "complaint" | "other",
  "items": [
    {
      "kind": "sale" | "expense" | "withdrawal",
      "description": string | null,
      "qty": number | null,
      "amount_kobo": integer | null,
      "amount_basis": "total" | "unit" | null
    }
  ],
  "party": string | null,
  "amount_kobo": integer | null,
  "query_text": string | null,
  "time_ref": "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | null,
  "confidence": number,
  "needs_clarification": boolean,
  "clarification_question": string | null,
  "note": string | null
}

HARD RULES:
1. NEVER invent or guess an amount. If unclear, set needs_clarification=true and ask ONE short question.
2. ALL money is in KOBO (naira × 100). Convert: "5k"=500000, "1500"=150000, "₦2,000"=200000, "1.5m"=150000000.
3. You do NOT add things up. Return individual items; backend sums them.
4. "X each" / "X per" / "at X" => amount_basis="unit". Plain price => amount_basis="total".
5. Match user's language in clarification_question (pidgin in => pidgin out). Keep under 12 words.
6. If message is a question, intent="query", set time_ref, DO NOT answer it.
7. Greetings/thanks/confusion => matching intent with empty items.
8. Default time_ref to "today" unless user clearly says otherwise.
9. One message can have multiple items AND credit - capture all.
10. If unintelligible, intent="other", needs_clarification=true.

NUMBERS / SHORTHAND:
- k = thousand (5k=5,000), m/mill = million (2m=2,000,000)
- "five thousand"=5000, "two five"=2500, "two naira five"=2.5k
- "1500"/"1,500"/"₦1500"/"N1500"/"1500 naira" all = 1500
- bare numbers with no context => ASK

CREDIT (money owed TO user) — intent log_sale_credit:
"on credit", "credit", "carry ... go pay", "collect ... later", "take am make e pay", "I borrow am", "e never pay", "owing", "IOU", "book am for [name]", "[name] go pay"
=> create item(s) AND set party to debtor's name.

PAYMENT RECEIVED — intent log_payment_received:
"[name] don pay", "[name] pay him debt", "[name] bring the money", "[name] clear", "settle", "balance"
=> party=name, amount_kobo if stated.

EXPENSE — intent log_expense:
"I buy", "I pay for", "spent", "fuel", "transport", "rent", "NEPA/light", "data", "salary", "restock", "market" (buying stock), "fix", "repair"

OWNER WITHDRAWAL — intent log_owner_withdrawal:
"I take [amount] for myself", "I chop", "I remove for my pocket", "I carry money go house", "personal"
=> kind="withdrawal".

QUERY — intent query:
"how much", "wetin", "how far", "my profit", "my sales", "how my money", "total", "report", "show me"
=> set time_ref.

LIST DEBTS — intent list_debts:
"who dey owe me", "my debtors", "who never pay"

Examples:
"I sold 3 chargers for 5000" => {"intent":"log_sale","items":[{"kind":"sale","description":"charger","qty":3,"amount_kobo":500000,"amount_basis":"total"}],"party":null,"amount_kobo":null,"query_text":null,"time_ref":"today","confidence":0.97,"needs_clarification":false,"clarification_question":null,"note":null}

"Musa carry 1 power bank on credit 8k" => {"intent":"log_sale_credit","items":[{"kind":"sale","description":"power bank","qty":1,"amount_kobo":800000,"amount_basis":"total"}],"party":"Musa","amount_kobo":800000,"query_text":null,"time_ref":"today","confidence":0.95,"needs_clarification":false,"clarification_question":null,"note":"credit"}

"I take 20k for myself" => {"intent":"log_owner_withdrawal","items":[{"kind":"withdrawal","description":"personal","qty":null,"amount_kobo":2000000,"amount_basis":"total"}],"party":null,"amount_kobo":2000000,"query_text":null,"time_ref":"today","confidence":0.93,"needs_clarification":false,"clarification_question":null,"note":null}

"how much I make today" => {"intent":"query","items":[],"party":null,"amount_kobo":null,"query_text":"profit today","time_ref":"today","confidence":0.95,"needs_clarification":false,"clarification_question":null,"note":null}

Always return exactly one JSON object. Nothing else.`

/**
 * Parse user message with enhanced FLOIN prompt
 * @param message - User's message
 * @param context - Optional business context
 * @param partialParse - Optional partial parse for clarification context (merge mode)
 */
export async function parseMessage(
  message: string,
  context?: { businessName?: string; currency?: string },
  partialParse?: Partial<ParsedIntent>
): Promise<ParsedIntent> {
  try {
    console.log('🤖 Parsing message with GPT-4:', message)
    if (partialParse) {
      console.log('🔄 Merge mode - partial parse:', JSON.stringify(partialParse, null, 2))
    }

    // Build messages array
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content: SYSTEM_PROMPT
      }
    ]

    // If partial parse exists, add merge mode context
    if (partialParse) {
      messages.push({
        role: 'user',
        content: `Previous partial parse (user said this before):\n${JSON.stringify(partialParse, null, 2)}\n\nNow user replied: "${message}"\n\nMerge the new reply with the partial parse. If the new message is just a number and amount_kobo was missing, fill it in. Return the complete merged intent.`
      })
    } else {
      messages.push({
        role: 'user',
        content: message
      })
    }

    // Use OpenAI GPT-4
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0,
      max_tokens: 1024,
      response_format: { type: 'json_object' }
    })

    const rawResponse = response.choices[0].message.content
    console.log('🤖 GPT-4 raw response:', rawResponse)

    if (!rawResponse) {
      throw new Error('Empty response from GPT-4')
    }

    // Parse JSON response
    const intent: ParsedIntent = JSON.parse(rawResponse)
    console.log('🤖 Parsed intent:', JSON.stringify(intent, null, 2))

    // Validate basic structure
    if (!intent.intent) {
      throw new Error('Missing intent field')
    }

    return intent

  } catch (error) {
    console.error('❌ GPT-4 parsing error:', error)
    if (error instanceof Error) {
      console.error('Error details:', error.message)
    }

    // Return unclear intent on error
    return {
      intent: 'other',
      items: [],
      party: null,
      amount_kobo: null,
      query_text: null,
      time_ref: null,
      confidence: 0.1,
      needs_clarification: true,
      clarification_question: 'I no understand. Try tell me wetin you sell or spend.',
      note: 'Parser error'
    }
  }
}
