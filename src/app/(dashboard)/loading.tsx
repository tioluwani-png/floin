export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-md px-5 pt-8">
      <div className="h-3 w-20 rounded-full animate-shimmer" />
      <div className="mt-2 h-7 w-32 rounded-lg animate-shimmer" />
      <div className="mt-5 grid grid-cols-3 gap-2">
        <div className="h-20 rounded-2xl animate-shimmer" />
        <div className="h-20 rounded-2xl animate-shimmer" />
        <div className="h-20 rounded-2xl animate-shimmer" />
      </div>
      <div className="mt-6 h-14 rounded-2xl animate-shimmer" />
      <div className="mt-6 space-y-2">
        <div className="h-20 rounded-2xl animate-shimmer" />
        <div className="h-20 rounded-2xl animate-shimmer" />
        <div className="h-20 rounded-2xl animate-shimmer" />
      </div>
    </div>
  )
}
