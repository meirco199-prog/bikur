import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AppProvider, useApp } from './context/AppContext'
import { Login } from './components/Login'
import { Layout } from './components/Layout'
import { Dashboard } from './components/Dashboard'
import { ChildrenList } from './components/ChildrenList'
import { ChildProfile } from './components/ChildProfile'

// שורש האפליקציה — אימות, ניתוב, וטעינת נתונים
export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}

// מציג מסך התחברות עד שהמשתמש מאומת
function Gate() {
  const { isAuthed } = useAuth()
  if (!isAuthed) return <Login />
  return (
    <AppProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProvider>
  )
}

function AppRoutes() {
  const { loading } = useApp()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center text-calm-400">
          <div className="mb-2 text-4xl">🫧</div>
          טוען נתונים...
        </div>
      </div>
    )
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/children" element={<ChildrenList />} />
        <Route path="/children/:id" element={<ChildProfile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
