/**
 * Name Utilities for Debtor/Party Name Handling
 * Provides normalization, validation, and matching for customer names
 */

// Non-names that should NEVER be stored as customer names
const NON_NAMES = [
  'her', 'him', 'them', 'she', 'he', 'they', 'you',
  'oga', 'madam', 'sir', 'ma', 'mama', 'papa',
  'customer', 'person', 'somebody', 'someone', 'friend',
  'guy', 'man', 'woman', 'boy', 'girl',
  'brother', 'sister', 'uncle', 'aunty', 'auntie'
]

/**
 * Normalize a name for matching
 * - Trim whitespace
 * - Convert to lowercase
 * - Collapse multiple spaces to single space
 * - Remove common prefixes that don't affect identity
 */
export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ') // collapse spaces
    .replace(/^(mr|mrs|ms|dr|alhaji|alh|chief)\.?\s+/i, '') // strip titles
}

/**
 * Check if a name is a pronoun or generic term (non-name)
 */
export function isNonName(name: string): boolean {
  const normalized = normalizeName(name)
  return NON_NAMES.includes(normalized)
}

/**
 * Validate a name before storing as a debtor/party name
 * Returns { valid: boolean, error?: string }
 */
export function validateCustomerName(name: string | null | undefined): {
  valid: boolean
  error?: string
} {
  if (!name || !name.trim()) {
    return {
      valid: false,
      error: 'Name is required'
    }
  }

  if (isNonName(name)) {
    return {
      valid: false,
      error: `"${name}" is not a valid name. Please provide the person's actual name.`
    }
  }

  // Check if name is too short (likely not a real name)
  if (name.trim().length < 2) {
    return {
      valid: false,
      error: 'Name is too short. Please provide a full name.'
    }
  }

  return { valid: true }
}

/**
 * Clean and format a display name (preserve case, remove extra spaces)
 */
export function cleanDisplayName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    // Capitalize first letter of each word
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Match a search name against stored names (fuzzy/partial matching)
 * Returns all matching names from the list
 */
export function findMatchingNames(
  searchName: string,
  storedNames: string[]
): string[] {
  const normalizedSearch = normalizeName(searchName)

  // First: try exact normalized match
  const exactMatches = storedNames.filter(
    name => normalizeName(name) === normalizedSearch
  )

  if (exactMatches.length > 0) {
    return exactMatches
  }

  // Second: try partial/contains match (search is substring of stored name)
  const partialMatches = storedNames.filter(
    name => normalizeName(name).includes(normalizedSearch)
  )

  if (partialMatches.length > 0) {
    return partialMatches
  }

  // Third: try reverse partial (stored name is substring of search)
  const reverseMatches = storedNames.filter(
    name => normalizedSearch.includes(normalizeName(name))
  )

  return reverseMatches
}

/**
 * Resolve a pronoun to a real name from context
 * Used when user says "remind her" and we need to resolve "her" to "Clara"
 */
export function resolvePronoun(
  pronoun: string,
  recentContext: { party?: string | null; customer_name?: string | null }[]
): string | null {
  if (!isNonName(pronoun)) {
    return null // Not a pronoun, return null
  }

  // Look for the most recent real name in context
  for (const ctx of recentContext) {
    const name = ctx.party || ctx.customer_name
    if (name && !isNonName(name)) {
      return name // Found a real name to resolve to
    }
  }

  return null // Could not resolve
}

/**
 * Format a clarification question when name is unclear
 */
export function getNameClarificationQuestion(language: 'pidgin' | 'english' = 'pidgin'): string {
  if (language === 'pidgin') {
    return 'Who be the person? Wetin be him/her name?'
  }
  return 'Who is the person? What is their name?'
}
