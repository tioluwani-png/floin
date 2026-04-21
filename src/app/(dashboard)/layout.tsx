import { BottomNav } from '@/components/layout/BottomNav'
import { GuestBanner } from '@/components/layout/GuestBanner'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex-1 pb-24">
        <div className="mx-auto max-w-md px-5 pt-6 pb-6">
          <GuestBanner />
          {children}
        </div>
      </main>
      <BottomNav />
    </div>
  )
}
