import { type ReactNode, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// פריסה ראשית עם ניווט צדדי — מותאמת למחשב, טאבלט ומובייל
const NAV = [
  { to: '/', label: 'דשבורד', icon: '🏠', end: true },
  { to: '/children', label: 'הילדים', icon: '🧒', end: false },
]

export function Layout({ children }: { children: ReactNode }) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  const navItems = (
    <nav className="space-y-1">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
              isActive
                ? 'bg-calm-500 text-white shadow-soft'
                : 'text-calm-600 hover:bg-calm-100'
            }`
          }
        >
          <span className="text-lg">{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen lg:flex">
      {/* סרגל צד — דסקטופ */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:border-l lg:border-calm-100 lg:bg-white lg:p-4">
        <Brand />
        <div className="mt-6 flex-1">{navItems}</div>
        <LogoutButton onLogout={() => logout()} />
      </aside>

      {/* כותרת עליונה — מובייל */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-calm-100 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="rounded-lg p-2 text-calm-600 hover:bg-calm-100"
          aria-label="תפריט"
        >
          ☰
        </button>
        <Brand compact />
        <button
          onClick={() => logout()}
          className="rounded-lg p-2 text-calm-400 hover:bg-calm-100"
          aria-label="התנתק"
        >
          ⎋
        </button>
      </header>

      {/* תפריט נפתח — מובייל */}
      {mobileOpen && (
        <div className="border-b border-calm-100 bg-white px-4 py-3 lg:hidden">
          {navItems}
        </div>
      )}

      {/* תוכן ראשי */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>

      {/* כפתור מהיר צף — מובייל */}
      <button
        onClick={() => navigate('/children?add=1')}
        className="btn-primary fixed bottom-5 left-5 z-30 h-14 w-14 rounded-full !p-0 text-2xl shadow-soft lg:hidden"
        aria-label="הוסף ילד"
      >
        +
      </button>
    </div>
  )
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-calm-500 text-xl shadow-soft">
        🫧
      </div>
      {!compact && (
        <div>
          <p className="font-bold leading-tight text-calm-800">מרחב רגוע</p>
          <p className="text-xs text-calm-400">ליווי רגשי לילדים</p>
        </div>
      )}
    </div>
  )
}

function LogoutButton({ onLogout }: { onLogout: () => void }) {
  return (
    <button
      onClick={onLogout}
      className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-calm-500 transition hover:bg-warmth-50 hover:text-warmth-500"
    >
      <span className="text-lg">⎋</span>
      התנתקות
    </button>
  )
}
