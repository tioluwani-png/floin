'use client'

import { SALES_CHANNELS, CURRENCY } from '@/lib/constants'

interface ExportButtonProps {
  monthLabel: string
  businessName: string
  revenue: number
  expenses: number
  profit: number
  margin: number
  units: number
  salesCount: number
  channelData: Record<string, number>
  expenseBreakdown: { label: string; amount: number }[]
  directUnits: number
  distributorUnits: number
  avgOrder: number
}

function fmt(n: number) {
  return `${CURRENCY.symbol}${n.toLocaleString('en-NG')}`
}

export function ExportButton(props: ExportButtonProps) {
  const {
    monthLabel, businessName, revenue, expenses, profit, margin,
    units, salesCount, channelData, expenseBreakdown,
    directUnits, distributorUnits, avgOrder,
  } = props

  function generatePDFContent() {
    const profitColor = profit >= 0 ? '#059669' : '#dc2626'
    const profitBg = profit >= 0 ? '#ecfdf5' : '#fef2f2'
    const profitLabel = profit >= 0 ? 'Profit' : 'Loss'
    const sortedChannels = Object.entries(channelData).sort(([, a], [, b]) => b - a)
    const topChannel = sortedChannels[0]
    const topChannelInfo = topChannel ? SALES_CHANNELS.find(c => c.id === topChannel[0]) : null
    const topExpense = [...expenseBreakdown].sort((a, b) => b.amount - a.amount)[0]
    const costRatio = revenue > 0 ? ((expenses / revenue) * 100).toFixed(1) : '0'

    const channelRows = sortedChannels.map(([id, amount]) => {
      const ch = SALES_CHANNELS.find(c => c.id === id)
      const pct = revenue > 0 ? ((amount / revenue) * 100).toFixed(1) : '0'
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${ch?.icon || ''} ${ch?.label || id}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;text-align:right;font-weight:600;">${fmt(amount)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;text-align:right;color:#64748b;">${pct}%</td>
        </tr>`
    }).join('')

    const expenseRows = expenseBreakdown.map(({ label, amount }) => {
      const pct = expenses > 0 ? ((amount / expenses) * 100).toFixed(1) : '0'
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${label}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;text-align:right;font-weight:600;">${fmt(amount)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;text-align:right;color:#64748b;">${pct}%</td>
        </tr>`
    }).join('')

    // Build insights
    const insights: string[] = []
    if (topChannelInfo && topChannel) {
      const pct = revenue > 0 ? ((topChannel[1] / revenue) * 100).toFixed(0) : '0'
      insights.push(`<strong>${topChannelInfo.label}</strong> is your top-performing channel, contributing <strong>${pct}%</strong> of total revenue.`)
    }
    if (margin > 30) {
      insights.push(`Your profit margin of <strong>${margin.toFixed(1)}%</strong> is healthy. Keep up the strong cost management.`)
    } else if (margin > 0) {
      insights.push(`Your profit margin is <strong>${margin.toFixed(1)}%</strong>. Consider reviewing your expenses to improve profitability.`)
    } else if (margin < 0) {
      insights.push(`You are currently running at a <strong>loss</strong>. Urgently review your expenses or find ways to increase revenue.`)
    }
    if (topExpense && expenses > 0) {
      const pct = ((topExpense.amount / expenses) * 100).toFixed(0)
      insights.push(`Your largest expense is <strong>${topExpense.label}</strong> at <strong>${pct}%</strong> of total spending.`)
    }
    if (distributorUnits > 0 && directUnits > 0) {
      const ratio = (directUnits / (directUnits + distributorUnits) * 100).toFixed(0)
      insights.push(`<strong>${ratio}%</strong> of your units sold are through direct channels (non-distributor).`)
    }
    if (avgOrder > 0) {
      insights.push(`Your average order value is <strong>${fmt(Math.round(avgOrder))}</strong> across <strong>${salesCount}</strong> transactions.`)
    }

    const insightItems = insights.map(i => `<li style="padding:6px 0;font-size:13px;color:#334155;line-height:1.6;">${i}</li>`).join('')

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${businessName} — ${monthLabel} Report</title>
  <style>
    @media print {
      body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .page-break { page-break-before: always; }
    }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:#0f172a; background:#fff; }
    .container { max-width:640px; margin:0 auto; padding:40px 32px; }
    .header { text-align:center; padding-bottom:32px; border-bottom:2px solid #f1f5f9; }
    .logo { display:inline-flex; align-items:center; justify-content:center; width:48px; height:48px; border-radius:14px; background:linear-gradient(135deg,#00c896,#00a67c); color:#fff; font-weight:800; font-size:20px; }
    .biz-name { margin-top:12px; font-size:22px; font-weight:800; letter-spacing:-0.3px; }
    .report-period { margin-top:4px; font-size:13px; color:#94a3b8; font-weight:500; }
    .section { margin-top:32px; }
    .section-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1.2px; color:#94a3b8; margin-bottom:16px; }
    .hero { border-radius:16px; padding:28px 24px; text-align:center; }
    .hero-amount { font-size:36px; font-weight:800; letter-spacing:-0.5px; }
    .hero-label { font-size:12px; font-weight:600; margin-top:4px; text-transform:uppercase; letter-spacing:0.8px; }
    .metrics-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; }
    .metric-card { border-radius:12px; padding:16px; background:#f8fafc; border:1px solid #f1f5f9; }
    .metric-value { font-size:18px; font-weight:700; margin-top:4px; }
    .metric-label { font-size:11px; font-weight:600; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; }
    table { width:100%; border-collapse:collapse; }
    thead th { padding:10px 12px; text-align:left; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:#94a3b8; border-bottom:2px solid #e2e8f0; }
    thead th:last-child, thead th:nth-child(2) { text-align:right; }
    .table-total td { padding:12px; border-top:2px solid #e2e8f0; font-weight:700; font-size:14px; }
    .pnl-bar { display:flex; height:24px; border-radius:8px; overflow:hidden; margin-top:8px; }
    .pnl-revenue { background:#059669; }
    .pnl-expense { background:#dc2626; }
    .insight-list { list-style:none; padding:0; }
    .insight-list li::before { content:'→'; color:#00c896; font-weight:700; margin-right:8px; }
    .footer { margin-top:48px; padding-top:20px; border-top:1px solid #f1f5f9; text-align:center; font-size:11px; color:#94a3b8; }
    .watermark { display:inline-flex; align-items:center; gap:4px; margin-top:4px; }
    .watermark-dot { width:6px; height:6px; border-radius:50%; background:#00c896; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <div class="logo">${businessName[0].toUpperCase()}</div>
      <div class="biz-name">${businessName}</div>
      <div class="report-period">Monthly Financial Report — ${monthLabel}</div>
    </div>

    <!-- Executive Summary -->
    <div class="section">
      <div class="section-title">Executive Summary</div>
      <div class="hero" style="background:${profitBg};">
        <div class="hero-label" style="color:${profitColor};">Net ${profitLabel}</div>
        <div class="hero-amount" style="color:${profitColor};">${fmt(Math.abs(profit))}</div>
        <div style="margin-top:12px;display:flex;justify-content:center;gap:24px;">
          <span style="font-size:12px;color:#64748b;">Margin: <strong style="color:${profitColor}">${margin.toFixed(1)}%</strong></span>
          <span style="font-size:12px;color:#64748b;">Cost Ratio: <strong>${costRatio}%</strong></span>
        </div>
      </div>
    </div>

    <!-- Key Metrics -->
    <div class="section">
      <div class="section-title">Key Metrics</div>
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-label">Revenue</div>
          <div class="metric-value" style="color:#059669;">${fmt(revenue)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Expenses</div>
          <div class="metric-value" style="color:#dc2626;">${fmt(expenses)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Units Sold</div>
          <div class="metric-value">${units}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Transactions</div>
          <div class="metric-value">${salesCount}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Avg Order</div>
          <div class="metric-value">${fmt(Math.round(avgOrder))}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Channels</div>
          <div class="metric-value">${sortedChannels.length}</div>
        </div>
      </div>
    </div>

    <!-- Revenue vs Expenses visual -->
    <div class="section">
      <div class="section-title">Revenue vs Expenses</div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
        <span style="color:#059669;font-weight:600;">Revenue ${revenue > 0 && expenses > 0 ? `(${(revenue / (revenue + expenses) * 100).toFixed(0)}%)` : ''}</span>
        <span style="color:#dc2626;font-weight:600;">Expenses ${revenue > 0 && expenses > 0 ? `(${(expenses / (revenue + expenses) * 100).toFixed(0)}%)` : ''}</span>
      </div>
      <div class="pnl-bar">
        <div class="pnl-revenue" style="width:${revenue > 0 || expenses > 0 ? (revenue / (revenue + expenses) * 100).toFixed(1) : 50}%;"></div>
        <div class="pnl-expense" style="width:${revenue > 0 || expenses > 0 ? (expenses / (revenue + expenses) * 100).toFixed(1) : 50}%;"></div>
      </div>
    </div>

    ${sortedChannels.length > 0 ? `
    <!-- Channel Performance -->
    <div class="section">
      <div class="section-title">Revenue by Channel</div>
      <table>
        <thead>
          <tr>
            <th>Channel</th>
            <th>Revenue</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          ${channelRows}
        </tbody>
        <tfoot>
          <tr class="table-total">
            <td>Total</td>
            <td style="text-align:right;">${fmt(revenue)}</td>
            <td style="text-align:right;">100%</td>
          </tr>
        </tfoot>
      </table>
      ${units > 0 ? `
      <div style="margin-top:16px;display:flex;gap:16px;">
        <div style="flex:1;padding:12px;border-radius:10px;background:#f8fafc;border:1px solid #f1f5f9;">
          <div style="font-size:11px;color:#94a3b8;font-weight:600;">DIRECT SALES</div>
          <div style="font-size:16px;font-weight:700;margin-top:2px;">${directUnits} units</div>
        </div>
        <div style="flex:1;padding:12px;border-radius:10px;background:#f8fafc;border:1px solid #f1f5f9;">
          <div style="font-size:11px;color:#94a3b8;font-weight:600;">DISTRIBUTOR</div>
          <div style="font-size:16px;font-weight:700;margin-top:2px;">${distributorUnits} units</div>
        </div>
      </div>` : ''}
    </div>` : ''}

    ${expenseBreakdown.length > 0 ? `
    <!-- Expense Breakdown -->
    <div class="section">
      <div class="section-title">Expense Breakdown</div>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Amount</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          ${expenseRows}
        </tbody>
        <tfoot>
          <tr class="table-total">
            <td>Total</td>
            <td style="text-align:right;color:#dc2626;">${fmt(expenses)}</td>
            <td style="text-align:right;">100%</td>
          </tr>
        </tfoot>
      </table>
    </div>` : ''}

    ${insights.length > 0 ? `
    <!-- Insights -->
    <div class="section">
      <div class="section-title">Insights & Observations</div>
      <ul class="insight-list">
        ${insightItems}
      </ul>
    </div>` : ''}

    <!-- Footer -->
    <div class="footer">
      <div>Report generated on ${new Date().toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
      <div class="watermark"><span class="watermark-dot"></span> Powered by Floin</div>
    </div>
  </div>
</body>
</html>`
  }

  function handleExportPDF() {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return
    printWindow.document.write(generatePDFContent())
    printWindow.document.close()
    setTimeout(() => printWindow.print(), 300)
  }

  function handleExportCSV() {
    const rows: string[][] = [
      ['Metric', 'Value'],
      ['Business', businessName],
      ['Period', monthLabel],
      [''],
      ['Revenue', revenue.toString()],
      ['Expenses', expenses.toString()],
      ['Net Profit', profit.toString()],
      ['Profit Margin', `${margin.toFixed(1)}%`],
      ['Units Sold', units.toString()],
      ['Transactions', salesCount.toString()],
      ['Average Order', avgOrder.toFixed(2)],
      [''],
      ['Channel', 'Revenue', 'Share'],
    ]

    const sortedChannels = Object.entries(channelData).sort(([, a], [, b]) => b - a)
    sortedChannels.forEach(([id, amount]) => {
      const ch = SALES_CHANNELS.find(c => c.id === id)
      const pct = revenue > 0 ? ((amount / revenue) * 100).toFixed(1) : '0'
      rows.push([ch?.label || id, amount.toString(), `${pct}%`])
    })

    rows.push([''], ['Expense Category', 'Amount', 'Share'])
    expenseBreakdown.forEach(({ label, amount }) => {
      const pct = expenses > 0 ? ((amount / expenses) * 100).toFixed(1) : '0'
      rows.push([label, amount.toString(), `${pct}%`])
    })

    const csv = rows.map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${businessName.toLowerCase().replace(/\s+/g, '-')}-report-${monthLabel.toLowerCase().replace(/\s/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex gap-1.5">
      <button
        onClick={handleExportPDF}
        className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-medium text-muted-dark shadow-sm border border-border/40 transition-all hover:shadow-md hover:text-foreground active:scale-95"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
          <path fillRule="evenodd" d="M4 2a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V6.621a1.5 1.5 0 0 0-.44-1.06L9.94 2.439A1.5 1.5 0 0 0 8.878 2H4Zm1 5.75A.75.75 0 0 1 5.75 7h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 7.75Zm0 3a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
        </svg>
        PDF
      </button>
      <button
        onClick={handleExportCSV}
        className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-medium text-muted-dark shadow-sm border border-border/40 transition-all hover:shadow-md hover:text-foreground active:scale-95"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
          <path d="M8.75 2.75a.75.75 0 0 0-1.5 0v5.69L5.03 6.22a.75.75 0 0 0-1.06 1.06l3.5 3.5a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 0 0-1.06-1.06L8.75 8.44V2.75Z" />
          <path d="M3.5 9.75a.75.75 0 0 0-1.5 0v1.5A2.75 2.75 0 0 0 4.75 14h6.5A2.75 2.75 0 0 0 14 11.25v-1.5a.75.75 0 0 0-1.5 0v1.5c0 .69-.56 1.25-1.25 1.25h-6.5c-.69 0-1.25-.56-1.25-1.25v-1.5Z" />
        </svg>
        CSV
      </button>
    </div>
  )
}
