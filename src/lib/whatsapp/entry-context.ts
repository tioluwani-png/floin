/**
 * Entry List Context Tracking
 * Stores the last shown entry list so "edit 2" / "delete 3" can resolve correctly
 */

interface EntryReference {
  listNumber: number
  entryType: 'sale' | 'expense' | 'loan' | 'withdrawal'
  entryId: string
  description: string
  amountKobo: number
  date: string
}

interface EntryListContext {
  waPhone: string
  entries: EntryReference[]
  timeRef: string
  shownAt: number // timestamp
}

// In-memory store with 10-minute TTL
const entryContextStore = new Map<string, EntryListContext>()
const CONTEXT_TTL_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Save entry list context after showing list
 */
export function saveEntryListContext(
  waPhone: string,
  entries: EntryReference[],
  timeRef: string
): void {
  entryContextStore.set(waPhone, {
    waPhone,
    entries,
    timeRef,
    shownAt: Date.now()
  })
}

/**
 * Get entry list context (returns null if expired or not found)
 */
export function getEntryListContext(waPhone: string): EntryListContext | null {
  const context = entryContextStore.get(waPhone)
  if (!context) return null

  // Check if expired
  if (Date.now() - context.shownAt > CONTEXT_TTL_MS) {
    entryContextStore.delete(waPhone)
    return null
  }

  return context
}

/**
 * Resolve entry by list number
 */
export function resolveEntryByNumber(
  waPhone: string,
  listNumber: number
): EntryReference | null {
  const context = getEntryListContext(waPhone)
  if (!context) return null

  // List numbers are 1-indexed
  const entry = context.entries[listNumber - 1]
  return entry || null
}

/**
 * Clear entry list context
 */
export function clearEntryListContext(waPhone: string): void {
  entryContextStore.delete(waPhone)
}

/**
 * Cleanup expired contexts (call periodically)
 */
export function cleanupExpiredEntryContexts(): number {
  let removed = 0
  const now = Date.now()

  for (const [phone, context] of entryContextStore.entries()) {
    if (now - context.shownAt > CONTEXT_TTL_MS) {
      entryContextStore.delete(phone)
      removed++
    }
  }

  return removed
}
