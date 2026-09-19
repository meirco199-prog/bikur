// אווטאר עם ראשי תיבות וצבע יציב לפי שם הילד
const PALETTE = [
  'bg-calm-200 text-calm-700',
  'bg-mint-200 text-mint-500',
  'bg-warmth-200 text-warmth-500',
  'bg-calm-300 text-calm-800',
]

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2)
  return parts[0][0] + parts[1][0]
}

function colorFor(name: string): string {
  let sum = 0
  for (const ch of name) sum += ch.charCodeAt(0)
  return PALETTE[sum % PALETTE.length]
}

export function Avatar({
  name,
  size = 'md',
}: {
  name: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizes = {
    sm: 'h-9 w-9 text-sm',
    md: 'h-12 w-12 text-base',
    lg: 'h-16 w-16 text-xl',
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${sizes[size]} ${colorFor(
        name,
      )}`}
    >
      {initials(name)}
    </div>
  )
}
