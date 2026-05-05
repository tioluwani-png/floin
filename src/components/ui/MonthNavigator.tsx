'use client'

import { getCurrentMonthYear, getMonthLabel, getPrevMonth, getNextMonth } from '@/lib/utils'

interface MonthNavigatorProps {
  selectedMonth: string
  onMonthChange: (month: string) => void
}

export function MonthNavigator({ selectedMonth, onMonthChange }: MonthNavigatorProps) {
  const isCurrentMonth = selectedMonth === getCurrentMonthYear()

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onMonthChange(getPrevMonth(selectedMonth))}
        className="flex h-8 w-8 items-center justify-center rounded-xl bg-background text-muted-dark ring-1 ring-border transition-all hover:bg-floin-green-light hover:text-floin-green-dark hover:ring-floin-green/30 active:scale-95"
        aria-label="Previous month"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
          <path fillRule="evenodd" d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
        </svg>
      </button>
      <span className="min-w-[140px] text-center text-xs font-medium text-muted uppercase tracking-wider">
        {getMonthLabel(selectedMonth)}
      </span>
      <button
        onClick={() => onMonthChange(getNextMonth(selectedMonth))}
        disabled={isCurrentMonth}
        className="flex h-8 w-8 items-center justify-center rounded-xl bg-background text-muted-dark ring-1 ring-border transition-all hover:bg-floin-green-light hover:text-floin-green-dark hover:ring-floin-green/30 active:scale-95 disabled:opacity-30 disabled:hover:bg-background disabled:hover:text-muted-dark disabled:hover:ring-border"
        aria-label="Next month"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
          <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  )
}
