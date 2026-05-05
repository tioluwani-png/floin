'use client'

import { getCurrentMonthYear, getMonthLabel, getPrevMonth, getNextMonth } from '@/lib/utils'

interface MonthNavigatorProps {
  selectedMonth: string
  onMonthChange: (month: string) => void
}

export function MonthNavigator({ selectedMonth, onMonthChange }: MonthNavigatorProps) {
  const isCurrentMonth = selectedMonth === getCurrentMonthYear()

  return (
    <div className="inline-flex items-center gap-1 rounded-xl bg-white px-1.5 py-1 shadow-sm border border-border/40">
      <button
        onClick={() => onMonthChange(getPrevMonth(selectedMonth))}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-dark transition-all hover:bg-floin-green-light hover:text-floin-green-dark active:scale-90"
        aria-label="Previous month"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
        </svg>
      </button>
      <span className="min-w-[130px] text-center text-sm font-semibold text-foreground">
        {getMonthLabel(selectedMonth)}
      </span>
      <button
        onClick={() => onMonthChange(getNextMonth(selectedMonth))}
        disabled={isCurrentMonth}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-dark transition-all hover:bg-floin-green-light hover:text-floin-green-dark active:scale-90 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-muted-dark"
        aria-label="Next month"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  )
}
