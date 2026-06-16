/**
 * Monthly PDF Report Generator
 * Creates beautiful, shareable monthly business reports
 */

import React from 'react'
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer'
import { createClient } from '@supabase/supabase-js'

// Server-side Supabase client
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

interface MonthlyReportData {
  businessName: string
  currency: string
  month: string // "2026-06"
  monthLabel: string // "June 2026"

  // Sales
  totalSalesKobo: number
  salesCount: number
  totalUnits: number

  // By channel
  salesByChannel: Array<{ channel: string; amount: number; count: number }>

  // Expenses (Phase 2 - basic for now)
  totalExpensesKobo: number

  // Withdrawals
  totalWithdrawalsKobo: number
  withdrawalCount: number

  // Debts
  totalDebtsOwedKobo: number
  debtorsCount: number

  // Calculated
  profitKobo: number
  profitMargin: number

  // Previous month comparison
  previousMonthSalesKobo?: number
  growthPercent?: number
}

/**
 * Fetch monthly report data
 */
export async function fetchMonthlyReportData(
  businessId: string,
  monthYear: string // "2026-06"
): Promise<MonthlyReportData | null> {
  try {
    // Get business info
    const { data: business } = await supabase
      .from('businesses')
      .select('name, currency')
      .eq('id', businessId)
      .single()

    if (!business) return null

    // Date range for the month
    const [year, month] = monthYear.split('-')
    const startDate = `${monthYear}-01`
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate()
    const endDate = `${monthYear}-${String(lastDay).padStart(2, '0')}`

    // Fetch sales
    const { data: sales } = await supabase
      .from('sales_entries')
      .select('amount, units, channel')
      .eq('business_id', businessId)
      .gte('date', startDate)
      .lte('date', endDate)

    const totalNaira = (sales || []).reduce((sum, s) => sum + Number(s.amount), 0)
    const totalSalesKobo = Math.round(totalNaira * 100)
    const salesCount = sales?.length || 0
    const totalUnits = (sales || []).reduce((sum, s) => sum + s.units, 0)

    // Sales by channel
    const channelTotals: Record<string, { amount: number; count: number }> = {}
    sales?.forEach(s => {
      const channel = s.channel || 'other'
      if (!channelTotals[channel]) {
        channelTotals[channel] = { amount: 0, count: 0 }
      }
      channelTotals[channel].amount += Math.round(Number(s.amount) * 100)
      channelTotals[channel].count += 1
    })

    const salesByChannel = Object.entries(channelTotals)
      .map(([channel, data]) => ({ channel, ...data }))
      .sort((a, b) => b.amount - a.amount)

    // Fetch withdrawals
    const { data: withdrawals } = await supabase
      .from('owner_withdrawals')
      .select('amount_kobo')
      .eq('business_id', businessId)
      .gte('withdrawal_date', startDate)
      .lte('withdrawal_date', endDate)

    const totalWithdrawalsKobo = (withdrawals || []).reduce((sum, w) => sum + w.amount_kobo, 0)
    const withdrawalCount = withdrawals?.length || 0

    // Fetch outstanding debts (current, not month-specific)
    const { data: debts } = await supabase
      .from('whatsapp_debts')
      .select('balance_kobo')
      .eq('business_id', businessId)
      .in('status', ['outstanding', 'partial'])

    const totalDebtsOwedKobo = (debts || []).reduce((sum, d) => sum + d.balance_kobo, 0)
    const debtorsCount = debts?.length || 0

    // Expenses (TODO: Implement proper expense tracking in Phase 2)
    const totalExpensesKobo = 0

    // Calculate profit
    const profitKobo = totalSalesKobo - totalExpensesKobo - totalWithdrawalsKobo
    const profitMargin = totalSalesKobo > 0 ? (profitKobo / totalSalesKobo) * 100 : 0

    // Previous month comparison
    const prevMonth = getPreviousMonth(monthYear)
    const prevStartDate = `${prevMonth}-01`
    const [prevYear, prevMonthNum] = prevMonth.split('-')
    const prevLastDay = new Date(parseInt(prevYear), parseInt(prevMonthNum), 0).getDate()
    const prevEndDate = `${prevMonth}-${String(prevLastDay).padStart(2, '0')}`

    const { data: prevSales } = await supabase
      .from('sales_entries')
      .select('amount')
      .eq('business_id', businessId)
      .gte('date', prevStartDate)
      .lte('date', prevEndDate)

    const previousMonthSalesKobo = prevSales
      ? Math.round(prevSales.reduce((sum, s) => sum + Number(s.amount), 0) * 100)
      : undefined

    const growthPercent = previousMonthSalesKobo && previousMonthSalesKobo > 0
      ? ((totalSalesKobo - previousMonthSalesKobo) / previousMonthSalesKobo) * 100
      : undefined

    // Format month label
    const monthLabel = new Date(`${monthYear}-15`).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric'
    })

    return {
      businessName: business.name,
      currency: business.currency || 'NGN',
      month: monthYear,
      monthLabel,
      totalSalesKobo,
      salesCount,
      totalUnits,
      salesByChannel,
      totalExpensesKobo,
      totalWithdrawalsKobo,
      withdrawalCount,
      totalDebtsOwedKobo,
      debtorsCount,
      profitKobo,
      profitMargin,
      previousMonthSalesKobo,
      growthPercent
    }

  } catch (error) {
    console.error('Error fetching report data:', error)
    return null
  }
}

/**
 * Get previous month in YYYY-MM format
 */
function getPreviousMonth(monthYear: string): string {
  const [year, month] = monthYear.split('-').map(Number)
  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear = month === 1 ? year - 1 : year
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`
}

/**
 * Format currency
 */
function formatCurrency(kobo: number, currency: string = 'NGN'): string {
  const amount = kobo / 100
  const symbol = currency === 'NGN' ? '₦' : currency

  return `${symbol}${amount.toLocaleString('en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })}`
}

/**
 * PDF Styles
 */
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
    backgroundColor: '#ffffff'
  },
  header: {
    marginBottom: 20,
    borderBottom: '2 solid #00c896',
    paddingBottom: 15
  },
  businessName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 5
  },
  monthLabel: {
    fontSize: 14,
    color: '#666666'
  },
  section: {
    marginBottom: 20
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#00c896',
    marginBottom: 10,
    textTransform: 'uppercase'
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
    paddingVertical: 4
  },
  label: {
    fontSize: 10,
    color: '#4a4a4a'
  },
  value: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#1a1a1a'
  },
  highlight: {
    backgroundColor: '#f0fdf9',
    padding: 15,
    borderRadius: 4,
    marginBottom: 15
  },
  profitLabel: {
    fontSize: 12,
    color: '#666666',
    marginBottom: 5
  },
  profitValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#00c896'
  },
  growth: {
    fontSize: 10,
    color: '#00c896',
    marginTop: 5
  },
  divider: {
    borderBottom: '1 solid #e5e5e5',
    marginVertical: 10
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: 'center',
    color: '#999999',
    fontSize: 8,
    borderTop: '1 solid #e5e5e5',
    paddingTop: 10
  },
  brandFooter: {
    fontSize: 9,
    color: '#00c896',
    marginBottom: 3
  }
})

/**
 * PDF Document Component
 */
const MonthlyReportPDF: React.FC<{ data: MonthlyReportData }> = ({ data }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.businessName}>{data.businessName}</Text>
        <Text style={styles.monthLabel}>Monthly Report - {data.monthLabel}</Text>
      </View>

      {/* Profit Highlight */}
      <View style={styles.highlight}>
        <Text style={styles.profitLabel}>Net Profit</Text>
        <Text style={styles.profitValue}>
          {formatCurrency(data.profitKobo, data.currency)}
        </Text>
        {data.growthPercent !== undefined && (
          <Text style={styles.growth}>
            {data.growthPercent >= 0 ? '↑' : '↓'} {Math.abs(data.growthPercent).toFixed(1)}% vs last month
          </Text>
        )}
      </View>

      {/* Revenue Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Revenue</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Total Sales</Text>
          <Text style={styles.value}>{formatCurrency(data.totalSalesKobo, data.currency)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Transactions</Text>
          <Text style={styles.value}>{data.salesCount}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Units Sold</Text>
          <Text style={styles.value}>{data.totalUnits}</Text>
        </View>
        {data.previousMonthSalesKobo && (
          <View style={styles.row}>
            <Text style={styles.label}>vs Previous Month</Text>
            <Text style={styles.value}>
              {formatCurrency(data.previousMonthSalesKobo, data.currency)}
            </Text>
          </View>
        )}
      </View>

      {/* Sales by Channel */}
      {data.salesByChannel.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sales by Channel</Text>
          {data.salesByChannel.map((channel, index) => (
            <View key={index} style={styles.row}>
              <Text style={styles.label}>
                {channel.channel.charAt(0).toUpperCase() + channel.channel.slice(1)} ({channel.count})
              </Text>
              <Text style={styles.value}>{formatCurrency(channel.amount, data.currency)}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.divider} />

      {/* Expenses & Withdrawals */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Outflows</Text>
        {data.totalExpensesKobo > 0 && (
          <View style={styles.row}>
            <Text style={styles.label}>Business Expenses</Text>
            <Text style={styles.value}>{formatCurrency(data.totalExpensesKobo, data.currency)}</Text>
          </View>
        )}
        {data.totalWithdrawalsKobo > 0 && (
          <View style={styles.row}>
            <Text style={styles.label}>Owner Withdrawals ({data.withdrawalCount})</Text>
            <Text style={styles.value}>{formatCurrency(data.totalWithdrawalsKobo, data.currency)}</Text>
          </View>
        )}
      </View>

      {/* Debts */}
      {data.totalDebtsOwedKobo > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Outstanding Debts</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Total Owed ({data.debtorsCount} customers)</Text>
            <Text style={styles.value}>{formatCurrency(data.totalDebtsOwedKobo, data.currency)}</Text>
          </View>
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.brandFooter}>📊 Generated by FLOIN - WhatsApp AI Bookkeeping</Text>
        <Text>Text your sales, FLOIN keeps the books • floin.app</Text>
      </View>
    </Page>
  </Document>
)

/**
 * Generate PDF Buffer
 */
export async function generateMonthlyReportPDF(
  businessId: string,
  monthYear: string
): Promise<Buffer | null> {
  try {
    console.log(`📄 Generating PDF report for ${businessId} - ${monthYear}`)

    // Fetch report data
    const data = await fetchMonthlyReportData(businessId, monthYear)

    if (!data) {
      console.error('Failed to fetch report data')
      return null
    }

    // Generate PDF
    const doc = React.createElement(MonthlyReportPDF, { data })
    const pdfBlob = await pdf(doc).toBlob()
    const buffer = Buffer.from(await pdfBlob.arrayBuffer())

    console.log(`✅ PDF generated: ${buffer.length} bytes`)

    return buffer

  } catch (error) {
    console.error('Error generating PDF:', error)
    return null
  }
}

/**
 * Upload PDF to Supabase Storage
 */
export async function uploadPDFToStorage(
  pdfBuffer: Buffer,
  businessId: string,
  monthYear: string
): Promise<string | null> {
  try {
    const fileName = `${businessId}/${monthYear}-report.pdf`

    const { data, error } = await supabase.storage
      .from('monthly-reports')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      })

    if (error) {
      console.error('Failed to upload PDF:', error)
      return null
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('monthly-reports')
      .getPublicUrl(fileName)

    return urlData.publicUrl

  } catch (error) {
    console.error('Error uploading PDF:', error)
    return null
  }
}
