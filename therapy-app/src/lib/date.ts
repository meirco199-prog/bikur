// ===== כלי עזר לתאריכים בעברית =====

const dtf = new Intl.DateTimeFormat('he-IL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const dtfTime = new Intl.DateTimeFormat('he-IL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** פורמט תאריך: 24/06/2026 */
export function formatDate(iso: string): string {
  if (!iso) return ''
  return dtf.format(new Date(iso))
}

/** פורמט תאריך ושעה: 24/06/2026, 14:30 */
export function formatDateTime(iso: string): string {
  if (!iso) return ''
  return dtfTime.format(new Date(iso))
}

/** תיאור יחסי: "בעוד 3 ימים" / "עבר לפני יום" */
export function relativeTime(iso: string): string {
  if (!iso) return ''
  const target = new Date(iso).getTime()
  const now = Date.now()
  const diffMs = target - now
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
  const rtf = new Intl.RelativeTimeFormat('he-IL', { numeric: 'auto' })

  if (Math.abs(diffDays) >= 1) return rtf.format(diffDays, 'day')
  const diffHours = Math.round(diffMs / (1000 * 60 * 60))
  if (Math.abs(diffHours) >= 1) return rtf.format(diffHours, 'hour')
  const diffMin = Math.round(diffMs / (1000 * 60))
  return rtf.format(diffMin, 'minute')
}

/** האם התאריך בעבר */
export function isPast(iso: string): boolean {
  return new Date(iso).getTime() < Date.now()
}

/** המרת ISO ל-value עבור input מסוג datetime-local */
export function toDateTimeLocal(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}
