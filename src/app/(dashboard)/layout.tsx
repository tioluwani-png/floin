import { BottomNav } from '@/components/layout/BottomNav'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex-1 pb-24">
        <div className="mx-auto max-w-md px-5 pt-8 pb-6">
          {children}
        </div>
      </main>
      <BottomNav />
    </div>
  )
}
