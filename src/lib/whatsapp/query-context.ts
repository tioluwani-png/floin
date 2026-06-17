/**
 * Query Context Manager
 * Tracks the last metric queried by each user to enable contextual period changes
 *
 * Enables: "What's my profit today?" → "How about this month?" (infers profit for month)
 */

interface QueryContext {
  metric: 'sales' | 'expenses' | 'profit' | 'withdrawals' | 'balance' | 'debts' | 'summary'
  timeRef: 'today' | 'yesterday' | 'this_week' | 'this_month'
  timestamp: number  // When this query was made
}

// In-memory cache (ephemeral - resets on server restart, which is fine for this use case)
const contextCache = new Map<string, QueryContext>()

// Context expires after 5 minutes of inactivity
const CONTEXT_TTL_MS = 5 * 60 * 1000

/**
 * Save the last query context for a user
 */
export function saveQueryContext(
  waPhone: string,
  metric: 'sales' | 'expenses' | 'profit' | 'withdrawals' | 'balance' | 'debts' | 'summary',
  timeRef: 'today' | 'yesterday' | 'this_week' | 'this_month'
): void {
  contextCache.set(waPhone, {
    metric,
    timeRef,
    timestamp: Date.now()
  })
}

/**
 * Get the last query context for a user (if not expired)
 * Returns null if no context or context is stale
 */
export function getQueryContext(waPhone: string): QueryContext | null {
  const context = contextCache.get(waPhone)
  if (!context) return null

  // Check if context is stale
  const age = Date.now() - context.timestamp
  if (age > CONTEXT_TTL_MS) {
    contextCache.delete(waPhone)
    return null
  }

  return context
}

/**
 * Clear context for a user (e.g., when they ask a completely new type of question)
 */
export function clearQueryContext(waPhone: string): void {
  contextCache.delete(waPhone)
}

/**
 * Detect if a query is asking for a period change without specifying a metric
 * E.g., "how about this month?", "what about yesterday?", "and this week?"
 */
export function isPeriodChangeQuery(query: string): {
  isPeriodChange: boolean
  timeRef: 'today' | 'yesterday' | 'this_week' | 'this_month' | null
} {
  const normalized = query.toLowerCase().trim()

  // Period change indicators: "how about", "what about", "and", "show me", etc.
  const hasPeriodChangeIndicator =
    /^(how about|what about|and|show me|wetin be|wetin happen|how much|what i make|what i get|my money|abeg show)/i.test(normalized)

  // No specific metric mentioned (no "sales", "expenses", "profit" etc.)
  const hasNoMetric =
    !normalized.includes('sale') &&
    !normalized.includes('expense') &&
    !normalized.includes('spend') &&
    !normalized.includes('profit') &&
    !normalized.includes('gain') &&
    !normalized.includes('balance') &&
    !normalized.includes('cash') &&
    !normalized.includes('drawer') &&
    !normalized.includes('withdraw') &&
    !normalized.includes('owe') &&
    !normalized.includes('debt')

  // Must have a time period
  let timeRef: 'today' | 'yesterday' | 'this_week' | 'this_month' | null = null
  if (normalized.includes('yesterday')) {
    timeRef = 'yesterday'
  } else if (normalized.includes('week')) {
    timeRef = 'this_week'
  } else if (normalized.includes('month')) {
    timeRef = 'this_month'
  } else if (normalized.includes('today')) {
    timeRef = 'today'
  }

  const isPeriodChange = hasPeriodChangeIndicator && hasNoMetric && timeRef !== null

  return { isPeriodChange, timeRef }
}
