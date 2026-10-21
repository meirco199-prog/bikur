import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { Avatar } from './ui/Avatar'
import { EmptyState } from './ui/EmptyState'
import { formatDateTime, isPast, relativeTime } from '../lib/date'

// דשבורד ראשי — סיכום פעילות המערכת
export function Dashboard() {
  const { data } = useApp()
  const navigate = useNavigate()

  const stats = useMemo(() => {
    const openReminders = data.reminders.filter((r) => r.status === 'open')
    const openRecurring = data.recurring.filter((r) => r.status === 'open')
    return {
      children: data.children.length,
      openReminders: openReminders.length,
      openExercises: openRecurring.length,
      totalExercises: data.exercises.length,
    }
  }, [data])

  // מזכורות קרובות (פתוחות, ממוינות לפי תאריך)
  const upcomingReminders = useMemo(
    () =>
      data.reminders
        .filter((r) => r.status === 'open')
        .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt))
        .slice(0, 5),
    [data.reminders],
  )

  // תרגולים שוטפים פתוחים
  const openRecurring = useMemo(
    () => data.recurring.filter((r) => r.status === 'open').slice(0, 5),
    [data.recurring],
  )

  // ילדים עם פעילות אחרונה
  const recentChildren = useMemo(
    () =>
      [...data.children]
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
        .slice(0, 5),
    [data.children],
  )

  const childName = (id: string) =>
    data.children.find((c) => c.id === id)?.fullName ?? 'ילד/ה'

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-calm-800">דשבורד</h1>
          <p className="text-sm text-calm-400">סקירה כללית של הפעילות</p>
        </div>
        <button
          className="btn-primary"
          onClick={() => navigate('/children?add=1')}
        >
          <span className="text-lg">＋</span> הוספת ילד
        </button>
      </div>

      {/* כרטיסי סטטיסטיקה */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon="🧒" label="ילדים במערכת" value={stats.children} tone="calm" />
        <StatCard
          icon="⏰"
          label="מזכורות פתוחות"
          value={stats.openReminders}
          tone="warmth"
        />
        <StatCard
          icon="🔁"
          label="תרגולים שוטפים"
          value={stats.openExercises}
          tone="mint"
        />
        <StatCard
          icon="💗"
          label="סה״כ תרגולים"
          value={stats.totalExercises}
          tone="calm"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* מזכורות קרובות */}
        <section className="card p-5">
          <h2 className="mb-4 flex items-center gap-2 font-semibold text-calm-800">
            ⏰ מזכורות קרובות
          </h2>
          {upcomingReminders.length === 0 ? (
            <EmptyState icon="🌿" title="אין מזכורות פתוחות" />
          ) : (
            <ul className="space-y-2">
              {upcomingReminders.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/children/${r.childId}?tab=reminders`}
                    className="flex items-center justify-between rounded-xl border border-calm-100 px-3.5 py-2.5 transition hover:bg-calm-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-calm-700">
                        {r.title}
                      </p>
                      <p className="text-xs text-calm-400">
                        {childName(r.childId)} · {formatDateTime(r.dueAt)}
                      </p>
                    </div>
                    <span
                      className={`badge shrink-0 ${
                        isPast(r.dueAt)
                          ? 'bg-warmth-100 text-warmth-500'
                          : 'bg-calm-100 text-calm-600'
                      }`}
                    >
                      {relativeTime(r.dueAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* תרגולים שוטפים פתוחים */}
        <section className="card p-5">
          <h2 className="mb-4 flex items-center gap-2 font-semibold text-calm-800">
            🔁 תרגולים שוטפים פתוחים
          </h2>
          {openRecurring.length === 0 ? (
            <EmptyState icon="🌿" title="אין תרגולים פתוחים" />
          ) : (
            <ul className="space-y-2">
              {openRecurring.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/children/${r.childId}?tab=recurring`}
                    className="flex items-center justify-between rounded-xl border border-calm-100 px-3.5 py-2.5 transition hover:bg-calm-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-calm-700">
                        {r.name}
                      </p>
                      <p className="text-xs text-calm-400">
                        {childName(r.childId)}
                      </p>
                    </div>
                    <span className="badge shrink-0 bg-mint-100 text-mint-500">
                      {r.frequency === 'daily'
                        ? 'יומי'
                        : r.frequency === 'weekly'
                          ? 'שבועי'
                          : 'חד פעמי'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ילדים עם פעילות אחרונה */}
        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-4 flex items-center gap-2 font-semibold text-calm-800">
            ✨ ילדים עם פעילות אחרונה
          </h2>
          {recentChildren.length === 0 ? (
            <EmptyState
              icon="🧒"
              title="עדיין אין ילדים"
              action={
                <button
                  className="btn-primary"
                  onClick={() => navigate('/children?add=1')}
                >
                  הוספת ילד
                </button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recentChildren.map((c) => (
                <Link
                  key={c.id}
                  to={`/children/${c.id}`}
                  className="flex items-center gap-3 rounded-xl border border-calm-100 px-3.5 py-3 transition hover:bg-calm-50"
                >
                  <Avatar name={c.fullName} />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-calm-700">
                      {c.fullName}
                    </p>
                    <p className="text-xs text-calm-400">
                      עודכן {relativeTime(c.updatedAt)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string
  label: string
  value: number
  tone: 'calm' | 'warmth' | 'mint'
}) {
  const tones = {
    calm: 'bg-calm-100 text-calm-600',
    warmth: 'bg-warmth-100 text-warmth-500',
    mint: 'bg-mint-100 text-mint-500',
  }
  return (
    <div className="card flex items-center gap-3 p-4">
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-xl text-2xl ${tones[tone]}`}
      >
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-calm-800">{value}</p>
        <p className="text-xs text-calm-400">{label}</p>
      </div>
    </div>
  )
}
