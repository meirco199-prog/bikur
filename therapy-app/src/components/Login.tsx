import { useState } from 'react'
import { useAuth, DEFAULT_USER, DEFAULT_PASS } from '../context/AuthContext'

// מסך התחברות בסיסי
export function Login() {
  const { login } = useAuth()
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!login(user, pass)) {
      setError('שם משתמש או סיסמה שגויים')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-bl from-calm-100 via-calm-50 to-mint-50 p-4">
      <div className="card w-full max-w-md p-8 animate-in">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-calm-500 text-3xl shadow-soft">
            🫧
          </div>
          <h1 className="text-2xl font-bold text-calm-800">מרחב רגוע</h1>
          <p className="mt-1 text-sm text-calm-500">
            ניהול טיפולים וליווי רגשי לילדים
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label">שם משתמש</label>
            <input
              className="input"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="הקלד שם משתמש"
              autoFocus
            />
          </div>
          <div>
            <label className="label">סיסמה</label>
            <input
              className="input"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="הקלד סיסמה"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-warmth-100 px-3 py-2 text-sm text-warmth-500">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full">
            כניסה
          </button>
        </form>

        <div className="mt-6 rounded-xl bg-calm-50 px-4 py-3 text-center text-xs text-calm-400">
          פרטי כניסה לדוגמה — משתמש:{' '}
          <span className="font-mono font-semibold text-calm-600">
            {DEFAULT_USER}
          </span>{' '}
          · סיסמה:{' '}
          <span className="font-mono font-semibold text-calm-600">
            {DEFAULT_PASS}
          </span>
        </div>
      </div>
    </div>
  )
}
