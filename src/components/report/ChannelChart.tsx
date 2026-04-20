'use client'

import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from 'chart.js'
import { SALES_CHANNELS } from '@/lib/constants'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

interface ChannelChartProps {
  channelData: Record<string, number>
}

export function ChannelChart({ channelData }: ChannelChartProps) {
  const labels = Object.keys(channelData).map(
    (id) => SALES_CHANNELS.find((c) => c.id === id)?.label || id
  )
  const values = Object.values(channelData)

  const data = {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: (ctx: { dataIndex: number }) => {
          const colors = ['#00c896', '#7c5cfc', '#3b82f6', '#f59e0b', '#f43f5e', '#06b6d4', '#8b5cf6', '#10b981']
          return colors[ctx.dataIndex % colors.length]
        },
        borderRadius: 8,
        maxBarThickness: 36,
        borderSkipped: false,
      },
    ],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0f172a', cornerRadius: 8, padding: 10, titleFont: { size: 11 }, bodyFont: { size: 12 } } },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10 }, color: '#94a3b8' } },
      y: { grid: { color: '#f1f5f9', drawBorder: false }, border: { display: false }, ticks: { font: { size: 10 }, color: '#94a3b8' } },
    },
  }

  return <Bar data={data} options={options} />
}
