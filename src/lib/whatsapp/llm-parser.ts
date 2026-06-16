/**
 * LLM Parser for WhatsApp Messages
 * Uses Anthropic Claude to parse natural language (English + Pidgin) into structured intents
 */

import Anthropic from '@anthropic-ai/sdk'
import Ajv, { JSONSchemaType } from 'ajv'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

const ajv = new Ajv()

// Parsed intent structure
export interface ParsedIntent {
  intent: 'sale' | 'expense' | 'debt_payment' | 'withdrawal' | 'query' | 'unclear'
  amount_kobo: number
  units: number
  note: string
  date: string  // YYYY-MM-DD
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
  customer_name?: string  // For credit sales
  query_text?: string  // For query intents
}

// JSON schema for validation
const intentSchema: JSONSchemaType<ParsedIntent> = {
  type: 'object',
  required: ['intent', 'amount_kobo', 'units', 'note', 'date', 'confidence', 'reasoning'],
  properties: {
    intent: {
      type: 'string',
      enum: ['sale', 'expense', 'debt_payment', 'withdrawal', 'query', 'unclear']
    },
    amount_kobo: {
      type: 'number',
      minimum: 0
    },
    units: {
      type: 'number',
      minimum: 1
    },
    note: {
      type: 'string',
      maxLength: 500
    },
    date: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}$'
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low']
    },
    reasoning: {
      type: 'string'
    },
    customer_name: {
      type: 'string',
      nullable: true
    },
    query_text: {
      type: 'string',
      nullable: true
    }
  },
  additionalProperties: false
}

const validateIntent = ajv.compile(intentSchema)

/**
 * System prompt for Claude
 */
const SYSTEM_PROMPT = `You are Ada, a helpful bookkeeping assistant for Nigerian small businesses.

## LANGUAGE SUPPORT
You understand both English and Nigerian Pidgin fluently. Treat both languages equally.

Common Pidgin expressions:
- "I sell..." / "I don sell..." = "I sold..."
- "I collect" / "I don collect" = "I received"
- "Oga [name]" / "Mama [name]" = Customer titles
- "carry am" / "carry on credit" = "took it on credit"
- "pay later" / "go pay later" = "will pay later"
- "wetin" = "what"
- "how much" / "how person" = "how much/many"

## MONEY HANDLING (CRITICAL)
- ALWAYS convert amounts to KOBO (multiply Naira by 100)
- NEVER use floating point for money
- Kobo are integers only

Conversion examples:
- "₦5,000" or "5000 naira" → 500000 kobo
- "50 naira" → 5000 kobo
- "5k" → 500000 kobo
- "2.5k" or "2500" → 250000 kobo
- "1.2m" → 120000000 kobo
- "45k" → 4500000 kobo

## INTENT CLASSIFICATION

### SALE Intent
Messages about selling products or services:
- "Sold 3 bags for 45k"
- "I don sell 2 charger 5000"
- "Make sale today 15k"

### EXPENSE Intent
Messages about business costs:
- "Buy fuel 3500"
- "Spent 10k for packaging"
- "I buy material 20k"

### DEBT_PAYMENT Intent
Customer paying back credit:
- "Mama Nkechi don pay her 15k"
- "Received payment from Oga Musa 8k"
- "Customer paid 5000"

### WITHDRAWAL Intent
Owner taking money from business for personal use (NOT a business expense):
- "I took 20k for myself"
- "I carry 15k go house"
- "Withdrew 30k for personal"
- "I remove 10k"
IMPORTANT: This is personal withdrawal, not business expense!

### QUERY Intent
Questions about the business:
- "How much I make today?"
- "Wetin be my profit this week?"
- "Who dey owe me?"
- "Show me summary"

### UNCLEAR Intent
Ambiguous or off-topic messages

## DEFAULT VALUES
- Date: TODAY if not specified in message
- Units: 1 if not specified
- Note: Extract product/service description or customer name

## CONFIDENCE LEVELS
- HIGH: Clear amount + clear description
- MEDIUM: Amount present but description vague
- LOW: Missing amount OR very ambiguous

## OUTPUT FORMAT
Return ONLY valid JSON. No markdown, no explanation outside JSON.

{
  "intent": "sale" | "expense" | "debt_payment" | "withdrawal" | "query" | "unclear",
  "amount_kobo": <integer in kobo>,
  "units": <integer, default 1>,
  "note": "<description or customer name>",
  "date": "YYYY-MM-DD",
  "confidence": "high" | "medium" | "low",
  "reasoning": "<brief explanation of your parsing>",
  "customer_name": "<name if credit sale or debt payment>",
  "query_text": "<rephrased query if intent=query>"
}

## EXAMPLES

Input: "Sold 3 bags of rice for 45k to Mrs Adeyemi"
{
  "intent": "sale",
  "amount_kobo": 4500000,
  "units": 3,
  "note": "Mrs Adeyemi - rice bags",
  "date": "2026-06-16",
  "confidence": "high",
  "reasoning": "Clear sale with amount, quantity, and customer name"
}

Input: "I don sell akara 500 naira for dis morning"
{
  "intent": "sale",
  "amount_kobo": 50000,
  "units": 1,
  "note": "akara",
  "date": "2026-06-16",
  "confidence": "high",
  "reasoning": "Pidgin sale statement with clear amount and product"
}

Input: "Oga Musa carry 2 power bank on credit 8k"
{
  "intent": "sale",
  "amount_kobo": 800000,
  "units": 2,
  "note": "power bank (credit)",
  "date": "2026-06-16",
  "confidence": "high",
  "reasoning": "Credit sale - customer took items to pay later",
  "customer_name": "Oga Musa"
}

Input: "How much I make this week?"
{
  "intent": "query",
  "amount_kobo": 0,
  "units": 1,
  "note": "weekly earnings query",
  "date": "2026-06-16",
  "confidence": "high",
  "reasoning": "User asking for weekly sales total",
  "query_text": "total sales this week"
}

Input: "buy fuel 3500"
{
  "intent": "expense",
  "amount_kobo": 350000,
  "units": 1,
  "note": "fuel",
  "date": "2026-06-16",
  "confidence": "high",
  "reasoning": "Clear expense for fuel purchase"
}

Input: "I took 20k for myself"
{
  "intent": "withdrawal",
  "amount_kobo": 2000000,
  "units": 1,
  "note": "personal withdrawal",
  "date": "2026-06-16",
  "confidence": "high",
  "reasoning": "Owner withdrawing money for personal use, not business expense"
}

Now parse the user's message.`

/**
 * Parse a WhatsApp message into structured intent
 */
export async function parseMessage(
  messageText: string,
  context?: {
    businessName?: string
    currency?: string
    recentSales?: Array<{ date: string; amount: number; note: string }>
  }
): Promise<ParsedIntent> {
  try {
    // Get today's date in Lagos timezone
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Africa/Lagos'
    })

    // Build user message with context
    let userMessage = `Message: "${messageText}"\n\nToday's date: ${today}`

    if (context?.businessName) {
      userMessage += `\nBusiness: ${context.businessName}`
    }

    if (context?.currency) {
      userMessage += `\nCurrency: ${context.currency}`
    }

    if (context?.recentSales && context.recentSales.length > 0) {
      userMessage += '\n\nRecent sales for context:\n'
      userMessage += context.recentSales
        .slice(0, 5)
        .map(s => `- ${s.date}: ₦${s.amount} - ${s.note}`)
        .join('\n')
    }

    // Call Claude API
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      temperature: 0,  // Deterministic
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: userMessage
      }]
    })

    // Extract text from response
    const responseText = message.content[0].type === 'text'
      ? message.content[0].text
      : ''

    if (!responseText) {
      throw new Error('Empty response from Claude')
    }

    // Extract JSON from response (handles code blocks or raw JSON)
    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) ||
                      responseText.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      console.error('No JSON found in Claude response:', responseText)
      throw new Error('No JSON in LLM response')
    }

    const jsonString = jsonMatch[1] || jsonMatch[0]
    const parsed = JSON.parse(jsonString) as ParsedIntent

    // Validate with Ajv
    if (!validateIntent(parsed)) {
      console.error('Schema validation failed:', validateIntent.errors)
      throw new Error(`Invalid intent schema: ${ajv.errorsText(validateIntent.errors)}`)
    }

    // Additional business logic validation
    if (parsed.amount_kobo < 0) {
      throw new Error('Amount cannot be negative')
    }

    if (parsed.amount_kobo > 10_000_000_00) {
      // Flag amounts over 100M Naira as suspicious
      parsed.confidence = 'low'
      parsed.reasoning += ' (Very large amount - needs confirmation)'
    }

    if (parsed.units < 1) {
      parsed.units = 1
    }

    return parsed

  } catch (error) {
    console.error('Parse error:', error)

    // Return unclear intent on error
    return {
      intent: 'unclear',
      amount_kobo: 0,
      units: 1,
      note: messageText.substring(0, 100),
      date: new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }),
      confidence: 'low',
      reasoning: `Failed to parse: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}

/**
 * Parse amount shortcuts (5k, 2.5m, etc.) to kobo
 * Utility function for testing and manual parsing
 */
export function parseAmountToKobo(amountStr: string): number {
  const cleaned = amountStr.toLowerCase().replace(/[₦,\s]/g, '')

  // Check for k (thousands)
  if (cleaned.includes('k')) {
    const num = parseFloat(cleaned.replace('k', ''))
    return Math.round(num * 1000 * 100)  // Convert to kobo
  }

  // Check for m (millions)
  if (cleaned.includes('m')) {
    const num = parseFloat(cleaned.replace('m', ''))
    return Math.round(num * 1000000 * 100)  // Convert to kobo
  }

  // Plain number
  const num = parseFloat(cleaned)
  return Math.round(num * 100)  // Convert to kobo
}
