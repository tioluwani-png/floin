'use client'

import { SALES_CHANNELS } from '@/lib/constants'
import { getCurrency } from '@/lib/constants'

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
  currencyCode: string
  logoBase64: string | null
  businessType: string
}

const CHART_COLORS = ['#00c896', '#6366f1', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316']

export function ExportButton(props: ExportButtonProps) {
  const {
    monthLabel, businessName, revenue, expenses, profit, margin,
    units, salesCount, channelData, expenseBreakdown,
    directUnits, distributorUnits, avgOrder,
    currencyCode, logoBase64, businessType,
  } = props

  const cur = getCurrency(currencyCode)
  function fmt(n: number) {
    return `${cur.symbol}${n.toLocaleString(cur.locale)}`
  }

  function generateSVGBarChart() {
    const entries = Object.entries(channelData).sort(([, a], [, b]) => b - a)
    if (entries.length === 0) return ''
    const maxVal = Math.max(...entries.map(([, v]) => v))
    const barH = 32
    const gap = 12
    const svgH = entries.length * (barH + gap) + 10
    const labelW = 110
    const chartW = 380

    const bars = entries.map(([id, amount], i) => {
      const ch = SALES_CHANNELS.find(c => c.id === id)
      const w = maxVal > 0 ? (amount / maxVal) * chartW : 0
      const y = i * (barH + gap)
      const color = CHART_COLORS[i % CHART_COLORS.length]
      return `
        <text x="0" y="${y + 20}" font-size="11" fill="#64748b" font-family="system-ui">${ch?.label || id}</text>
        <rect x="${labelW}" y="${y + 2}" width="${w}" height="${barH - 4}" rx="6" fill="${color}" opacity="0.85"/>
        <text x="${labelW + w + 8}" y="${y + 20}" font-size="11" fill="#334155" font-weight="600" font-family="system-ui">${fmt(amount)}</text>`
    }).join('')

    return `<svg width="100%" viewBox="0 0 600 ${svgH}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`
  }

  function generateSVGDonutChart() {
    if (expenseBreakdown.length === 0) return ''
    const total = expenseBreakdown.reduce((s, e) => s + e.amount, 0)
    if (total === 0) return ''

    const cx = 100, cy = 100, r = 80, innerR = 50
    let startAngle = -90
    const paths: string[] = []

    expenseBreakdown.forEach((item, i) => {
      const pct = item.amount / total
      const angle = pct * 360
      const endAngle = startAngle + angle
      const largeArc = angle > 180 ? 1 : 0

      const x1 = cx + r * Math.cos((startAngle * Math.PI) / 180)
      const y1 = cy + r * Math.sin((startAngle * Math.PI) / 180)
      const x2 = cx + r * Math.cos((endAngle * Math.PI) / 180)
      const y2 = cy + r * Math.sin((endAngle * Math.PI) / 180)
      const ix1 = cx + innerR * Math.cos((endAngle * Math.PI) / 180)
      const iy1 = cy + innerR * Math.sin((endAngle * Math.PI) / 180)
      const ix2 = cx + innerR * Math.cos((startAngle * Math.PI) / 180)
      const iy2 = cy + innerR * Math.sin((startAngle * Math.PI) / 180)

      const color = CHART_COLORS[i % CHART_COLORS.length]
      paths.push(`<path d="M${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} L${ix1},${iy1} A${innerR},${innerR} 0 ${largeArc},0 ${ix2},${iy2} Z" fill="${color}" opacity="0.85"/>`)
      startAngle = endAngle
    })

    const legend = expenseBreakdown.map((item, i) => {
      const color = CHART_COLORS[i % CHART_COLORS.length]
      const pct = total > 0 ? ((item.amount / total) * 100).toFixed(0) : '0'
      return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
        <span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${color};flex-shrink:0;"></span>
        <span style="font-size:12px;color:#334155;flex:1;">${item.label}</span>
        <span style="font-size:12px;font-weight:600;color:#0f172a;">${pct}%</span>
      </div>`
    }).join('')

    return `<div style="display:flex;align-items:center;gap:32px;margin-top:16px;">
      <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        ${paths.join('')}
        <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="22" font-weight="800" fill="#0f172a" font-family="system-ui">${fmt(total)}</text>
        <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="#94a3b8" font-family="system-ui">TOTAL</text>
      </svg>
      <div style="flex:1;">${legend}</div>
    </div>`
  }

  function pageHeader(pageNum: number, totalPages: number) {
    const logoHtml = logoBase64
      ? `<img src="${logoBase64}" style="width:28px;height:28px;border-radius:8px;object-fit:cover;" />`
      : `<div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#00c896,#00a67c);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;">${businessName[0]?.toUpperCase() || 'B'}</div>`
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:16px;border-bottom:2px solid #f1f5f9;margin-bottom:28px;">
      <div style="display:flex;align-items:center;gap:10px;">
        ${logoHtml}
        <span style="font-size:14px;font-weight:700;color:#0f172a;">${businessName}</span>
        <span style="font-size:11px;color:#94a3b8;margin-left:4px;">${monthLabel}</span>
      </div>
      <span style="font-size:10px;color:#94a3b8;">Page ${pageNum} of ${totalPages}</span>
    </div>`
  }

  function generatePDFContent() {
    const profitColor = profit >= 0 ? '#059669' : '#dc2626'
    const profitBg = profit >= 0 ? '#ecfdf5' : '#fef2f2'
    const profitLabel = profit >= 0 ? 'Profit' : 'Loss'
    const sortedChannels = Object.entries(channelData).sort(([, a], [, b]) => b - a)
    const topChannel = sortedChannels[0]
    const topChannelInfo = topChannel ? SALES_CHANNELS.find(c => c.id === topChannel[0]) : null
    const topExpense = [...expenseBreakdown].sort((a, b) => b.amount - a.amount)[0]
    const costRatio = revenue > 0 ? ((expenses / revenue) * 100).toFixed(1) : '0'
    const totalPages = 5 + (expenseBreakdown.length > 0 ? 1 : 0)

    // Build insights
    const insights: { icon: string; title: string; text: string; color: string }[] = []

    if (margin > 30) {
      insights.push({ icon: '🟢', title: 'Healthy Margins', text: `Your profit margin of ${margin.toFixed(1)}% is strong. You're managing costs effectively relative to revenue.`, color: '#059669' })
    } else if (margin > 10) {
      insights.push({ icon: '🟡', title: 'Moderate Margins', text: `Your profit margin of ${margin.toFixed(1)}% is decent but has room for improvement. Look for opportunities to reduce costs or increase prices.`, color: '#d97706' })
    } else if (margin > 0) {
      insights.push({ icon: '🟠', title: 'Thin Margins', text: `Your profit margin of ${margin.toFixed(1)}% is thin. Consider reviewing pricing strategy and reducing unnecessary expenses.`, color: '#ea580c' })
    } else if (profit < 0) {
      insights.push({ icon: '🔴', title: 'Operating at a Loss', text: `You are currently spending more than you earn. Urgently review your expense categories and find ways to boost revenue.`, color: '#dc2626' })
    }

    if (topChannelInfo && topChannel) {
      const pct = revenue > 0 ? ((topChannel[1] / revenue) * 100).toFixed(0) : '0'
      insights.push({ icon: '📊', title: 'Top Channel', text: `${topChannelInfo.label} drives ${pct}% of your revenue. ${parseInt(pct) > 60 ? 'Consider diversifying to reduce dependency on a single channel.' : 'Good channel diversification across your sales mix.'}`, color: '#6366f1' })
    }

    if (topExpense && expenses > 0) {
      const pct = ((topExpense.amount / expenses) * 100).toFixed(0)
      insights.push({ icon: '💸', title: 'Biggest Expense', text: `${topExpense.label} accounts for ${pct}% of your total spending (${fmt(topExpense.amount)}). ${parseInt(pct) > 40 ? 'This is a significant portion — evaluate if there are cost-saving alternatives.' : 'This is within a reasonable range.'}`, color: '#ec4899' })
    }

    if (avgOrder > 0) {
      insights.push({ icon: '🛒', title: 'Average Order Value', text: `Each transaction averages ${fmt(Math.round(avgOrder))} across ${salesCount} orders. ${businessType === 'product' ? 'Consider bundling products to increase this metric.' : 'Consider offering premium tiers to boost order value.'}`, color: '#06b6d4' })
    }

    if (distributorUnits > 0 && directUnits > 0) {
      const directPct = ((directUnits / (directUnits + distributorUnits)) * 100).toFixed(0)
      insights.push({ icon: '🏪', title: 'Sales Distribution', text: `${directPct}% of units sold through direct channels. Direct sales typically yield higher margins — ${parseInt(directPct) > 70 ? 'great direct-to-customer focus!' : 'consider growing your direct channel presence.'}`, color: '#8b5cf6' })
    }

    const insightCards = insights.map(i => `
      <div style="padding:16px;border-radius:12px;border:1px solid #f1f5f9;background:#fff;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:16px;">${i.icon}</span>
          <span style="font-size:13px;font-weight:700;color:${i.color};">${i.title}</span>
        </div>
        <p style="font-size:12px;color:#475569;line-height:1.7;margin:0;">${i.text}</p>
      </div>`).join('')

    const channelTableRows = sortedChannels.map(([id, amount], i) => {
      const ch = SALES_CHANNELS.find(c => c.id === id)
      const pct = revenue > 0 ? ((amount / revenue) * 100).toFixed(1) : '0'
      const barW = revenue > 0 ? (amount / revenue) * 100 : 0
      return `<tr>
        <td style="padding:12px;border-bottom:1px solid #f1f5f9;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${CHART_COLORS[i % CHART_COLORS.length]};"></span>
            <span style="font-size:13px;font-weight:500;">${ch?.icon || ''} ${ch?.label || id}</span>
          </div>
        </td>
        <td style="padding:12px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;font-weight:600;">${fmt(amount)}</td>
        <td style="padding:12px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;color:#64748b;">${pct}%</td>
        <td style="padding:12px;border-bottom:1px solid #f1f5f9;width:120px;">
          <div style="height:6px;border-radius:3px;background:#f1f5f9;overflow:hidden;">
            <div style="height:100%;width:${barW}%;border-radius:3px;background:${CHART_COLORS[i % CHART_COLORS.length]};"></div>
          </div>
        </td>
      </tr>`
    }).join('')

    const expenseTableRows = expenseBreakdown.map(({ label, amount }, i) => {
      const pct = expenses > 0 ? ((amount / expenses) * 100).toFixed(1) : '0'
      return `<tr>
        <td style="padding:12px;border-bottom:1px solid #f1f5f9;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${CHART_COLORS[i % CHART_COLORS.length]};"></span>
            <span style="font-size:13px;font-weight:500;">${label}</span>
          </div>
        </td>
        <td style="padding:12px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;font-weight:600;">${fmt(amount)}</td>
        <td style="padding:12px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;color:#64748b;">${pct}%</td>
      </tr>`
    }).join('')

    const logoEl = logoBase64
      ? `<img src="${logoBase64}" style="width:80px;height:80px;border-radius:20px;object-fit:cover;box-shadow:0 8px 30px rgba(0,0,0,0.12);" />`
      : `<div style="width:80px;height:80px;border-radius:20px;background:linear-gradient(135deg,#00c896,#00a67c);display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:800;color:#fff;box-shadow:0 8px 30px rgba(0,200,150,0.3);">${businessName[0]?.toUpperCase() || 'B'}</div>`

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${businessName} — ${monthLabel} Report</title>
  <style>
    @media print {
      body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .page-break { page-break-before: always; }
      .no-break { page-break-inside: avoid; }
    }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; color:#0f172a; background:#fff; }
    .page { max-width:680px; margin:0 auto; padding:48px 40px; min-height:100vh; position:relative; }
    table { width:100%; border-collapse:collapse; }
    thead th { padding:10px 12px; text-align:left; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; border-bottom:2px solid #e2e8f0; }
    thead th:nth-child(2), thead th:nth-child(3) { text-align:right; }
  </style>
</head>
<body>

  <!-- PAGE 1: COVER -->
  <div class="page" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:linear-gradient(180deg,#fafffe 0%,#f0fdf8 50%,#ecfdf5 100%);">
    <div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#00c896,#6366f1,#00c896);"></div>
    ${logoEl}
    <h1 style="margin-top:28px;font-size:32px;font-weight:800;letter-spacing:-0.5px;color:#0f172a;">${businessName}</h1>
    <div style="margin-top:12px;display:inline-block;border-radius:100px;background:linear-gradient(135deg,#00c896,#00a67c);padding:8px 24px;">
      <span style="font-size:14px;font-weight:600;color:#fff;">Monthly Financial Report</span>
    </div>
    <p style="margin-top:16px;font-size:18px;font-weight:600;color:#64748b;">${monthLabel}</p>
    <div style="margin-top:48px;padding:20px 32px;border-radius:16px;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,0.06);display:inline-flex;gap:40px;">
      <div>
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;">Revenue</div>
        <div style="font-size:20px;font-weight:800;color:#059669;margin-top:4px;">${fmt(revenue)}</div>
      </div>
      <div style="width:1px;background:#e2e8f0;"></div>
      <div>
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;">Net ${profitLabel}</div>
        <div style="font-size:20px;font-weight:800;color:${profitColor};margin-top:4px;">${fmt(Math.abs(profit))}</div>
      </div>
      <div style="width:1px;background:#e2e8f0;"></div>
      <div>
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;">Margin</div>
        <div style="font-size:20px;font-weight:800;color:${profitColor};margin-top:4px;">${margin.toFixed(1)}%</div>
      </div>
    </div>
    <div style="position:absolute;bottom:32px;font-size:11px;color:#94a3b8;">
      Generated on ${new Date().toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      <div style="margin-top:4px;display:flex;align-items:center;justify-content:center;gap:4px;">
        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#00c896;"></span>
        Powered by Floin
      </div>
    </div>
  </div>

  <!-- PAGE 2: EXECUTIVE SUMMARY -->
  <div class="page page-break">
    ${pageHeader(2, totalPages)}
    <h2 style="font-size:22px;font-weight:800;letter-spacing:-0.3px;">Executive Summary</h2>
    <p style="font-size:13px;color:#64748b;margin-top:4px;">Overview of your financial performance for ${monthLabel}.</p>

    <!-- Hero card -->
    <div style="margin-top:24px;border-radius:20px;padding:32px;background:${profitBg};text-align:center;" class="no-break">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${profitColor};">Net ${profitLabel}</div>
      <div style="font-size:42px;font-weight:800;color:${profitColor};margin-top:8px;letter-spacing:-1px;">${fmt(Math.abs(profit))}</div>
      <div style="margin-top:12px;display:flex;justify-content:center;gap:20px;">
        <span style="display:inline-block;border-radius:100px;background:${profit >= 0 ? 'rgba(5,150,105,0.1)' : 'rgba(220,38,38,0.1)'};padding:6px 16px;font-size:12px;font-weight:600;color:${profitColor};">${margin.toFixed(1)}% margin</span>
        <span style="display:inline-block;border-radius:100px;background:rgba(100,116,139,0.08);padding:6px 16px;font-size:12px;font-weight:600;color:#475569;">Cost Ratio: ${costRatio}%</span>
      </div>
    </div>

    <!-- Metrics grid -->
    <div style="margin-top:24px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;" class="no-break">
      <div style="border-radius:14px;padding:20px;background:#f0fdf4;border:1px solid #dcfce7;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#059669;">Revenue</div>
        <div style="font-size:22px;font-weight:800;color:#059669;margin-top:6px;">${fmt(revenue)}</div>
      </div>
      <div style="border-radius:14px;padding:20px;background:#fef2f2;border:1px solid #fecaca;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#dc2626;">Expenses</div>
        <div style="font-size:22px;font-weight:800;color:#dc2626;margin-top:6px;">${fmt(expenses)}</div>
      </div>
      <div style="border-radius:14px;padding:20px;background:#f8fafc;border:1px solid #e2e8f0;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#64748b;">Units Sold</div>
        <div style="font-size:22px;font-weight:800;color:#0f172a;margin-top:6px;">${units}</div>
      </div>
      <div style="border-radius:14px;padding:20px;background:#f8fafc;border:1px solid #e2e8f0;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#64748b;">Transactions</div>
        <div style="font-size:22px;font-weight:800;color:#0f172a;margin-top:6px;">${salesCount}</div>
      </div>
      <div style="border-radius:14px;padding:20px;background:#f8fafc;border:1px solid #e2e8f0;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#64748b;">Avg Order</div>
        <div style="font-size:22px;font-weight:800;color:#0f172a;margin-top:6px;">${fmt(Math.round(avgOrder))}</div>
      </div>
      <div style="border-radius:14px;padding:20px;background:#f8fafc;border:1px solid #e2e8f0;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#64748b;">Channels</div>
        <div style="font-size:22px;font-weight:800;color:#0f172a;margin-top:6px;">${sortedChannels.length}</div>
      </div>
    </div>

    <!-- Revenue vs Expenses bar -->
    <div style="margin-top:24px;" class="no-break">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:12px;">Revenue vs Expenses</div>
      <div style="display:flex;gap:8px;align-items:end;height:32px;">
        <div style="flex:${revenue > 0 || expenses > 0 ? revenue / (revenue + expenses) : 0.5};height:100%;border-radius:8px 0 0 8px;background:linear-gradient(90deg,#059669,#34d399);position:relative;">
          <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:11px;font-weight:700;color:#fff;">${revenue > 0 && expenses > 0 ? `${(revenue / (revenue + expenses) * 100).toFixed(0)}% Revenue` : 'Revenue'}</span>
        </div>
        <div style="flex:${revenue > 0 || expenses > 0 ? expenses / (revenue + expenses) : 0.5};height:100%;border-radius:0 8px 8px 0;background:linear-gradient(90deg,#f87171,#dc2626);position:relative;">
          <span style="position:absolute;right:12px;top:50%;transform:translateY(-50%);font-size:11px;font-weight:700;color:#fff;">${revenue > 0 && expenses > 0 ? `${(expenses / (revenue + expenses) * 100).toFixed(0)}% Expenses` : 'Expenses'}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- PAGE 3: REVENUE ANALYSIS -->
  <div class="page page-break">
    ${pageHeader(3, totalPages)}
    <h2 style="font-size:22px;font-weight:800;letter-spacing:-0.3px;">Revenue Analysis</h2>
    <p style="font-size:13px;color:#64748b;margin-top:4px;">Breakdown of revenue across your sales channels.</p>

    ${sortedChannels.length > 0 ? `
    <!-- Bar chart -->
    <div style="margin-top:24px;padding:24px;border-radius:16px;background:#f8fafc;border:1px solid #f1f5f9;" class="no-break">
      ${generateSVGBarChart()}
    </div>

    <!-- Channel table -->
    <div style="margin-top:20px;" class="no-break">
      <table>
        <thead>
          <tr>
            <th>Channel</th>
            <th>Revenue</th>
            <th>Share</th>
            <th style="text-align:left;">Distribution</th>
          </tr>
        </thead>
        <tbody>
          ${channelTableRows}
        </tbody>
        <tfoot>
          <tr>
            <td style="padding:14px 12px;border-top:2px solid #e2e8f0;font-weight:700;font-size:13px;">Total</td>
            <td style="padding:14px 12px;border-top:2px solid #e2e8f0;font-weight:700;font-size:13px;text-align:right;">${fmt(revenue)}</td>
            <td style="padding:14px 12px;border-top:2px solid #e2e8f0;font-weight:700;font-size:13px;text-align:right;">100%</td>
            <td style="border-top:2px solid #e2e8f0;"></td>
          </tr>
        </tfoot>
      </table>
    </div>` : '<div style="margin-top:40px;text-align:center;color:#94a3b8;font-size:14px;">No channel data available this month.</div>'}

    <!-- Units split -->
    ${units > 0 ? `
    <div style="margin-top:24px;display:grid;grid-template-columns:1fr 1fr;gap:12px;" class="no-break">
      <div style="border-radius:14px;padding:20px;background:#f0fdf4;border:1px solid #dcfce7;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#059669;">Direct Sales</div>
        <div style="font-size:26px;font-weight:800;color:#059669;margin-top:6px;">${directUnits} <span style="font-size:14px;font-weight:600;">units</span></div>
        <div style="font-size:11px;color:#64748b;margin-top:4px;">${units > 0 ? ((directUnits / units) * 100).toFixed(0) : 0}% of total</div>
      </div>
      <div style="border-radius:14px;padding:20px;background:#faf5ff;border:1px solid #e9d5ff;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#7c3aed;">Distributor</div>
        <div style="font-size:26px;font-weight:800;color:#7c3aed;margin-top:6px;">${distributorUnits} <span style="font-size:14px;font-weight:600;">units</span></div>
        <div style="font-size:11px;color:#64748b;margin-top:4px;">${units > 0 ? ((distributorUnits / units) * 100).toFixed(0) : 0}% of total</div>
      </div>
    </div>` : ''}
  </div>

  ${expenseBreakdown.length > 0 ? `
  <!-- PAGE 4: EXPENSE ANALYSIS -->
  <div class="page page-break">
    ${pageHeader(4, totalPages)}
    <h2 style="font-size:22px;font-weight:800;letter-spacing:-0.3px;">Expense Analysis</h2>
    <p style="font-size:13px;color:#64748b;margin-top:4px;">Where your money is going this month.</p>

    <!-- Donut chart -->
    <div style="margin-top:20px;padding:24px;border-radius:16px;background:#f8fafc;border:1px solid #f1f5f9;" class="no-break">
      ${generateSVGDonutChart()}
    </div>

    <!-- Expense table -->
    <div style="margin-top:20px;" class="no-break">
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Amount</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          ${expenseTableRows}
        </tbody>
        <tfoot>
          <tr>
            <td style="padding:14px 12px;border-top:2px solid #e2e8f0;font-weight:700;font-size:13px;">Total Expenses</td>
            <td style="padding:14px 12px;border-top:2px solid #e2e8f0;font-weight:700;font-size:13px;text-align:right;color:#dc2626;">${fmt(expenses)}</td>
            <td style="padding:14px 12px;border-top:2px solid #e2e8f0;font-weight:700;font-size:13px;text-align:right;">100%</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- Cost ratio indicator -->
    <div style="margin-top:24px;border-radius:14px;padding:20px;background:${parseFloat(costRatio) > 80 ? '#fef2f2' : parseFloat(costRatio) > 60 ? '#fffbeb' : '#f0fdf4'};border:1px solid ${parseFloat(costRatio) > 80 ? '#fecaca' : parseFloat(costRatio) > 60 ? '#fde68a' : '#dcfce7'};" class="no-break">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#64748b;">Cost-to-Revenue Ratio</div>
          <div style="font-size:28px;font-weight:800;margin-top:4px;color:${parseFloat(costRatio) > 80 ? '#dc2626' : parseFloat(costRatio) > 60 ? '#d97706' : '#059669'};">${costRatio}%</div>
        </div>
        <div style="font-size:12px;color:#475569;max-width:260px;text-align:right;line-height:1.5;">
          ${parseFloat(costRatio) > 80 ? 'Your expenses consume most of your revenue. Cost reduction should be a priority.' : parseFloat(costRatio) > 60 ? 'Your cost ratio is moderate. There may be opportunities to improve efficiency.' : 'Good cost management. Your expenses are well-controlled relative to revenue.'}
        </div>
      </div>
    </div>
  </div>` : ''}

  <!-- PAGE 5: INSIGHTS & RECOMMENDATIONS -->
  <div class="page page-break">
    ${pageHeader(expenseBreakdown.length > 0 ? 5 : 4, totalPages)}
    <h2 style="font-size:22px;font-weight:800;letter-spacing:-0.3px;">Insights & Recommendations</h2>
    <p style="font-size:13px;color:#64748b;margin-top:4px;">Key takeaways and actionable advice based on your data.</p>

    <div style="margin-top:24px;display:grid;grid-template-columns:1fr;gap:12px;">
      ${insightCards || '<div style="padding:40px;text-align:center;color:#94a3b8;font-size:14px;">Add more sales and expense data to unlock insights.</div>'}
    </div>

    <!-- Quick tips -->
    <div style="margin-top:32px;padding:24px;border-radius:16px;background:linear-gradient(135deg,#eff6ff,#eef2ff);border:1px solid #dbeafe;" class="no-break">
      <div style="font-size:13px;font-weight:700;color:#3b82f6;margin-bottom:12px;">💡 Quick Tips for Next Month</div>
      <ul style="list-style:none;padding:0;margin:0;">
        <li style="padding:6px 0;font-size:12px;color:#475569;line-height:1.6;">→ Review your top-performing channel and double down on what works.</li>
        <li style="padding:6px 0;font-size:12px;color:#475569;line-height:1.6;">→ Set a target to reduce your largest expense category by 5-10%.</li>
        <li style="padding:6px 0;font-size:12px;color:#475569;line-height:1.6;">→ Log every sale consistently to get the most accurate picture.</li>
        ${margin < 20 ? '<li style="padding:6px 0;font-size:12px;color:#475569;line-height:1.6;">→ Consider raising prices slightly — even a small increase can significantly improve margins.</li>' : ''}
        ${sortedChannels.length <= 2 ? '<li style="padding:6px 0;font-size:12px;color:#475569;line-height:1.6;">→ Explore adding a new sales channel to diversify your revenue sources.</li>' : ''}
      </ul>
    </div>
  </div>

  <!-- PAGE 6: CONCLUSION -->
  <div class="page page-break" style="display:flex;flex-direction:column;">
    ${pageHeader(totalPages, totalPages)}
    <h2 style="font-size:22px;font-weight:800;letter-spacing:-0.3px;">Summary & Outlook</h2>
    <p style="font-size:13px;color:#64748b;margin-top:4px;">Closing summary for ${monthLabel}.</p>

    <!-- Summary cards -->
    <div style="margin-top:24px;display:grid;grid-template-columns:1fr 1fr;gap:12px;" class="no-break">
      <div style="border-radius:16px;padding:24px;background:linear-gradient(135deg,#059669,#00a67c);color:#fff;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;opacity:0.8;">Total Revenue</div>
        <div style="font-size:28px;font-weight:800;margin-top:8px;">${fmt(revenue)}</div>
        <div style="font-size:11px;opacity:0.8;margin-top:4px;">${salesCount} transactions</div>
      </div>
      <div style="border-radius:16px;padding:24px;background:linear-gradient(135deg,${profit >= 0 ? '#059669,#10b981' : '#dc2626,#ef4444'});color:#fff;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;opacity:0.8;">Net ${profitLabel}</div>
        <div style="font-size:28px;font-weight:800;margin-top:8px;">${fmt(Math.abs(profit))}</div>
        <div style="font-size:11px;opacity:0.8;margin-top:4px;">${margin.toFixed(1)}% margin</div>
      </div>
    </div>

    <div style="margin-top:24px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;" class="no-break">
      <div style="border-radius:14px;padding:20px;background:#f8fafc;border:1px solid #e2e8f0;text-align:center;">
        <div style="font-size:24px;font-weight:800;">${units}</div>
        <div style="font-size:10px;font-weight:600;color:#94a3b8;margin-top:4px;">UNITS SOLD</div>
      </div>
      <div style="border-radius:14px;padding:20px;background:#f8fafc;border:1px solid #e2e8f0;text-align:center;">
        <div style="font-size:24px;font-weight:800;">${sortedChannels.length}</div>
        <div style="font-size:10px;font-weight:600;color:#94a3b8;margin-top:4px;">CHANNELS</div>
      </div>
      <div style="border-radius:14px;padding:20px;background:#f8fafc;border:1px solid #e2e8f0;text-align:center;">
        <div style="font-size:24px;font-weight:800;">${fmt(Math.round(avgOrder))}</div>
        <div style="font-size:10px;font-weight:600;color:#94a3b8;margin-top:4px;">AVG ORDER</div>
      </div>
    </div>

    <!-- Forward note -->
    <div style="margin-top:32px;padding:28px;border-radius:16px;background:linear-gradient(135deg,#f0fdf8,#ecfdf5);border:1px solid #d1fae5;" class="no-break">
      <p style="font-size:14px;color:#065f46;line-height:1.8;margin:0;">
        ${profit >= 0
          ? `Great work this month! Your business generated <strong>${fmt(revenue)}</strong> in revenue with a healthy <strong>${margin.toFixed(1)}%</strong> profit margin. Keep tracking consistently and look for opportunities to grow your top-performing channels while keeping costs lean.`
          : `This month was challenging with expenses exceeding revenue. Focus on identifying your most profitable products/services and channels, and look for quick wins to reduce your biggest expense categories. Every month is a fresh start — keep tracking and adjusting.`
        }
      </p>
    </div>

    <!-- Footer -->
    <div style="flex:1;display:flex;align-items:end;justify-content:center;padding-top:40px;">
      <div style="text-align:center;">
        <div style="font-size:11px;color:#94a3b8;">
          ${businessName} · ${monthLabel} Financial Report
        </div>
        <div style="margin-top:6px;display:flex;align-items:center;justify-content:center;gap:4px;">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#00c896;"></span>
          <span style="font-size:11px;color:#94a3b8;">Powered by Floin</span>
        </div>
        <div style="margin-top:4px;font-size:10px;color:#cbd5e1;">
          ${new Date().toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>
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
    setTimeout(() => printWindow.print(), 500)
  }

  function handleExportCSV() {
    const rows: string[][] = [
      ['Metric', 'Value'],
      ['Business', businessName],
      ['Period', monthLabel],
      ['Currency', `${cur.name} (${cur.symbol})`],
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
