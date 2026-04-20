'use client'

import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler)

interface MonthData {
  monthYear: string
  revenue: number
  expenses: number
  profit: number
}

interface TrendChartProps {
  months: MonthData[]
}

export function TrendChart({ months }: TrendChartProps) {
  const labels = months.map((m) => {
    const [, month] = m.monthYear.split('-')
    const date = new Date(2024, parseInt(month) - 1)
    return date.toLocaleDateString('en-NG', { month: 'short' })
  })

  const data = {
    labels,
    datasets: [
      {
        label: 'Revenue',
        data: months.map((m) => m.revenue),
        borderColor: '#00c896',
        backgroundColor: 'rgba(0, 200, 150, 0.08)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: '#00c896',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        borderWidth: 2.5,
      },
      {
        label: 'Expenses',
        data: months.map((m) => m.expenses),
        borderColor: '#f43f5e',
        backgroundColor: 'rgba(244, 63, 94, 0.05)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: '#f43f5e',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        borderWidth: 2.5,
      },
      {
        label: 'Profit',
        data: months.map((m) => m.profit),
        borderColor: '#7c5cfc',
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: '#7c5cfc',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        borderWidth: 2,
        borderDash: [5, 5],
      },
    ],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { display: true, position: 'bottom' as const, labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'circle', font: { size: 11 }, padding: 16, color: '#64748b' } },
      tooltip: { backgroundColor: '#0f172a', cornerRadius: 8, padding: 10, titleFont: { size: 11 }, bodyFont: { size: 12 } },
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10 }, color: '#94a3b8' } },
      y: { grid: { color: '#f1f5f9', drawBorder: false }, border: { display: false }, ticks: { font: { size: 10 }, color: '#94a3b8' } },
    },
  }

  return <Line data={data} options={options} />
}
