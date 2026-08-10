import { type ReactNode } from 'react'

// מצב ריק ידידותי כשאין עדיין נתונים
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: string
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-calm-200 bg-calm-50/50 px-6 py-12 text-center">
      <div className="mb-3 text-5xl opacity-80">{icon}</div>
      <p className="font-medium text-calm-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-calm-400">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
