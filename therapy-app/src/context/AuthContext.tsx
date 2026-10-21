import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

// ===== ניהול התחברות בסיסי =====
// מימוש מקומי פשוט (סיסמה נשמרת מקומית). מבודד בכוונה כדי שבעתיד
// אפשר יהיה להחליפו באימות שרת אמיתי (JWT / OAuth) ללא שינוי בשאר האפליקציה.

const AUTH_KEY = 'therapy-app-auth'
const CRED_KEY = 'therapy-app-cred'

// פרטי כניסה ברירת מחדל (לשלב הפיתוח)
const DEFAULT_USER = 'admin'
const DEFAULT_PASS = '1234'

interface AuthContextValue {
  isAuthed: boolean
  login: (user: string, pass: string) => boolean
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function getCreds(): { user: string; pass: string } {
  try {
    const raw = localStorage.getItem(CRED_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  return { user: DEFAULT_USER, pass: DEFAULT_PASS }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthed, setIsAuthed] = useState(false)

  useEffect(() => {
    setIsAuthed(sessionStorage.getItem(AUTH_KEY) === '1')
  }, [])

  const login = (user: string, pass: string): boolean => {
    const creds = getCreds()
    if (user.trim() === creds.user && pass === creds.pass) {
      sessionStorage.setItem(AUTH_KEY, '1')
      setIsAuthed(true)
      return true
    }
    return false
  }

  const logout = () => {
    sessionStorage.removeItem(AUTH_KEY)
    setIsAuthed(false)
  }

  return (
    <AuthContext.Provider value={{ isAuthed, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export { DEFAULT_USER, DEFAULT_PASS }
