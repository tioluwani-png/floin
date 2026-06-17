/**
 * Debt Cleanup Utility
 * Fixes ghost debtors created by pronoun-as-name bug (her, him, oga, customer, etc.)
 * Merges split debts for the same person
 */

import { createClient } from '@supabase/supabase-js'
import { isNonName, normalizeName, cleanDisplayName } from './name-utils'
import { formatNaira } from './api-client'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

interface BadDebt {
  id: string
  business_id: string
  customer_name: string
  balance_kobo: number
  amount_kobo: number
  sale_date: string
  status: string
}

interface CleanupResult {
  totalBadDebtors: number
  renamed: number
  merged: number
  flaggedForUser: Array<{
    name: string
    balance: number
    count: number
  }>
}

/**
 * Find all debts with pronoun/generic names in a business
 */
export async function findBadDebtorNames(businessId: string): Promise<BadDebt[]> {
  try {
    const { data: debts, error } = await supabase
      .from('whatsapp_debts')
      .select('*')
      .eq('business_id', businessId)
      .in('status', ['outstanding', 'partial'])

    if (error) throw error

    // Filter to only those with non-names
    const badDebts = (debts || []).filter((debt: any) =>
      isNonName(debt.customer_name)
    ) as BadDebt[]

    return badDebts
  } catch (error) {
    console.error('Error finding bad debtor names:', error)
    return []
  }
}

/**
 * Try to match a bad debt to a real debtor by context
 * Heuristics:
 * 1. Same amount and close date → likely same debt
 * 2. Only one other debtor in system → likely them
 */
async function matchBadDebtToRealDebtor(
  badDebt: BadDebt,
  businessId: string
): Promise<string | null> {
  try {
    // Get all valid debtors (non-pronouns)
    const { data: allDebts } = await supabase
      .from('whatsapp_debts')
      .select('customer_name, amount_kobo, sale_date, balance_kobo')
      .eq('business_id', businessId)
      .in('status', ['outstanding', 'partial'])

    if (!allDebts || allDebts.length === 0) return null

    const validDebts = allDebts.filter((d: any) => !isNonName(d.customer_name))
    const uniqueDebtors = [...new Set(validDebts.map((d: any) => d.customer_name))]

    // Heuristic 1: Only one valid debtor → probably them
    if (uniqueDebtors.length === 1) {
      console.log(`  Only one valid debtor (${uniqueDebtors[0]}), matching "${badDebt.customer_name}" to them`)
      return uniqueDebtors[0]
    }

    // Heuristic 2: Find debt with same amount within 7 days
    const badDate = new Date(badDebt.sale_date)
    for (const debt of validDebts) {
      const debtDate = new Date(debt.sale_date)
      const daysDiff = Math.abs((badDate.getTime() - debtDate.getTime()) / (1000 * 60 * 60 * 24))

      if (debt.amount_kobo === badDebt.amount_kobo && daysDiff <= 7) {
        console.log(`  Found matching debt: ${debt.customer_name} (same amount, ${daysDiff.toFixed(0)} days apart)`)
        return debt.customer_name
      }
    }

    // No confident match
    return null
  } catch (error) {
    console.error('Error matching bad debt:', error)
    return null
  }
}

/**
 * Merge a bad debt into a real debtor's account
 */
async function mergeBadDebt(
  badDebtId: string,
  targetDebtorName: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('whatsapp_debts')
      .update({
        customer_name: targetDebtorName,
        updated_at: new Date().toISOString()
      })
      .eq('id', badDebtId)

    if (error) throw error

    console.log(`  ✅ Merged debt ${badDebtId} into ${targetDebtorName}`)
    return true
  } catch (error) {
    console.error('Error merging bad debt:', error)
    return false
  }
}

/**
 * Automated cleanup: merge bad debts where we have high confidence
 * Returns debts that need user clarification
 */
export async function autoCleanupBadDebtors(
  businessId: string
): Promise<CleanupResult> {
  console.log(`🧹 Starting automated cleanup for business ${businessId}`)

  const badDebts = await findBadDebtorNames(businessId)
  console.log(`  Found ${badDebts.length} debt(s) with bad names`)

  const result: CleanupResult = {
    totalBadDebtors: badDebts.length,
    renamed: 0,
    merged: 0,
    flaggedForUser: []
  }

  if (badDebts.length === 0) {
    return result
  }

  // Group bad debts by name
  const badDebtsByName: Record<string, BadDebt[]> = {}
  badDebts.forEach(debt => {
    if (!badDebtsByName[debt.customer_name]) {
      badDebtsByName[debt.customer_name] = []
    }
    badDebtsByName[debt.customer_name].push(debt)
  })

  // Process each bad debtor
  for (const [badName, debts] of Object.entries(badDebtsByName)) {
    console.log(`\n  Processing "${badName}" (${debts.length} debt(s))`)

    // Try to find a match
    const matchedName = await matchBadDebtToRealDebtor(debts[0], businessId)

    if (matchedName) {
      // High confidence match - merge automatically
      let mergedCount = 0
      for (const debt of debts) {
        const success = await mergeBadDebt(debt.id, matchedName)
        if (success) mergedCount++
      }

      if (mergedCount > 0) {
        result.merged += mergedCount
        console.log(`  ✅ Merged ${mergedCount} debt(s) from "${badName}" into "${matchedName}"`)
      }
    } else {
      // No confident match - flag for user
      const totalBalance = debts.reduce((sum, d) => sum + d.balance_kobo, 0)
      result.flaggedForUser.push({
        name: badName,
        balance: totalBalance,
        count: debts.length
      })
      console.log(`  ⚠️ Flagged "${badName}" for user clarification (₦${totalBalance / 100})`)
    }
  }

  console.log(`\n✅ Cleanup complete:`)
  console.log(`   Total bad debtors: ${result.totalBadDebtors}`)
  console.log(`   Auto-merged: ${result.merged}`)
  console.log(`   Flagged for user: ${result.flaggedForUser.length}`)

  return result
}

/**
 * Format message asking user to clarify a bad debtor name
 */
export function formatBadDebtorClarificationMessage(
  badName: string,
  balance: number,
  count: number,
  validDebtorNames: string[]
): string {
  let message = `⚠️ *Name Correction Needed*\n\n`
  message += `I get ${count} debt${count === 1 ? '' : 's'} wey no get correct name:\n\n`
  message += `❌ Debtor: "${badName}"\n`
  message += `💰 Amount: ${formatNaira(balance)}\n\n`

  if (validDebtorNames.length > 0) {
    message += `Is this any of these people?\n`
    validDebtorNames.forEach((name, idx) => {
      message += `${idx + 1}. ${name}\n`
    })
    message += `\n`
    message += `Reply with the number or the person's real name.\n`
    message += `Example: "1" or "${validDebtorNames[0]}"\n\n`
  } else {
    message += `Who be the person? Wetin be him/her real name?\n\n`
    message += `Reply with their name to fix this debt.\n\n`
  }

  message += `_(This message helps clean up old data)_`

  return message
}

/**
 * Consolidate duplicate debts for the same normalized name
 * E.g., "Clara", " clara ", "CLARA" → all become "Clara"
 */
export async function consolidateDuplicateDebtors(
  businessId: string
): Promise<{ consolidated: number }> {
  console.log(`🔄 Consolidating duplicate debtors for business ${businessId}`)

  try {
    const { data: allDebts } = await supabase
      .from('whatsapp_debts')
      .select('*')
      .eq('business_id', businessId)
      .in('status', ['outstanding', 'partial'])

    if (!allDebts || allDebts.length === 0) {
      return { consolidated: 0 }
    }

    // Group by normalized name
    const debtsByNormalized: Record<string, any[]> = {}
    allDebts.forEach(debt => {
      const normalized = normalizeName(debt.customer_name)
      if (!debtsByNormalized[normalized]) {
        debtsByNormalized[normalized] = []
      }
      debtsByNormalized[normalized].push(debt)
    })

    let consolidated = 0

    // For each normalized group with multiple variations
    for (const [normalized, debts] of Object.entries(debtsByNormalized)) {
      if (debts.length <= 1) continue  // No duplicates

      // Find the "best" name (most common, or cleanest)
      const nameCounts: Record<string, number> = {}
      debts.forEach(debt => {
        nameCounts[debt.customer_name] = (nameCounts[debt.customer_name] || 0) + 1
      })

      // Pick most common name, or if tied, the cleanest
      const sortedNames = Object.entries(nameCounts)
        .sort((a, b) => b[1] - a[1])  // Sort by count descending

      const canonicalName = cleanDisplayName(sortedNames[0][0])

      // Update all debts to use canonical name
      for (const debt of debts) {
        if (debt.customer_name !== canonicalName) {
          await supabase
            .from('whatsapp_debts')
            .update({
              customer_name: canonicalName,
              updated_at: new Date().toISOString()
            })
            .eq('id', debt.id)

          consolidated++
          console.log(`  ✅ Renamed "${debt.customer_name}" → "${canonicalName}"`)
        }
      }
    }

    console.log(`✅ Consolidated ${consolidated} duplicate debtor names`)
    return { consolidated }

  } catch (error) {
    console.error('Error consolidating duplicates:', error)
    return { consolidated: 0 }
  }
}
