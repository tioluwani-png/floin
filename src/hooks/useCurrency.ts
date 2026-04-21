import { useStore } from '@/store'
import { getCurrency } from '@/lib/constants'
import { formatCurrency } from '@/lib/utils'

export function useCurrency() {
  const business = useStore((s) => s.business)
  const cur = getCurrency(business?.currency)

  return {
    code: cur.code,
    symbol: cur.symbol,
    name: cur.name,
    locale: cur.locale,
    format: (amount: number) => formatCurrency(amount, cur.code),
  }
}
