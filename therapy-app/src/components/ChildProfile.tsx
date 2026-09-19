import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { Avatar } from './ui/Avatar'
import { Modal } from './ui/Modal'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { ChildForm } from './ChildForm'
import { ChildFiles } from './ChildFiles'
import { Reminders } from './Reminders'
import { EmotionalExercises } from './EmotionalExercises'
import { RecurringExercises } from './RecurringExercises'
import { formatDate, relativeTime } from '../lib/date'

// פרופיל אישי של ילד — עם כרטיסיות לכל אזור
type Tab = 'files' | 'reminders' | 'exercises' | 'recurring'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'files', label: 'תיקייה אישית', icon: '📁' },
  { key: 'reminders', label: 'מזכורות', icon: '⏰' },
  { key: 'exercises', label: 'תרגול רגשי', icon: '💗' },
  { key: 'recurring', label: 'תרגול שוטף', icon: '🔁' },
]

export function ChildProfile() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { data, getChild, updateChild, deleteChild } = useApp()
  const [params, setParams] = useSearchParams()
  const [showEdit, setShowEdit] = useState(false)
  const [showDelete, setShowDelete] = useState(false)

  const child = getChild(id)

  const activeTab = (params.get('tab') as Tab) || 'files'
  const setTab = (t: Tab) => {
    params.set('tab', t)
    setParams(params, { replace: true })
  }

  // ספירות לתגיות הכרטיסיות
  const counts = useMemo(
    () => ({
      files: data.files.filter((f) => f.childId === id).length,
      reminders: data.reminders.filter(
        (r) => r.childId === id && r.status === 'open',
      ).length,
      exercises: data.exercises.filter((e) => e.childId === id).length,
      recurring: data.recurring.filter(
        (r) => r.childId === id && r.status === 'open',
      ).length,
    }),
    [data, id],
  )

  if (!child) {
    return (
      <div className="card p-8 text-center">
        <p className="text-calm-600">הילד/ה לא נמצא/ה.</p>
        <Link to="/children" className="btn-primary mt-4">
          חזרה לרשימה
        </Link>
      </div>
    )
  }

  return (
    <div>
      {/* פירורי לחם */}
      <div className="mb-4 flex items-center gap-2 text-sm text-calm-400">
        <Link to="/children" className="hover:text-calm-600">
          הילדים
        </Link>
        <span>›</span>
        <span className="text-calm-600">{child.fullName}</span>
      </div>

      {/* כרטיס פרטי הילד */}
      <div className="card mb-6 p-5">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={child.fullName} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-calm-800">
              {child.fullName}
            </h1>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-calm-500">
              {child.age !== '' && <span>גיל {child.age}</span>}
              {child.grade && <span>כיתה {child.grade}</span>}
              {child.contactName && <span>👤 {child.contactName}</span>}
            </div>
            {child.generalNotes && (
              <p className="mt-3 whitespace-pre-wrap rounded-xl bg-calm-50 px-4 py-3 text-sm text-calm-600">
                {child.generalNotes}
              </p>
            )}
            <p className="mt-2 text-xs text-calm-300">
              נוצר {formatDate(child.createdAt)} · עודכן{' '}
              {relativeTime(child.updatedAt)}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-soft" onClick={() => setShowEdit(true)}>
              ✎ עריכה
            </button>
            <button
              className="btn-ghost text-warmth-500 hover:bg-warmth-50"
              onClick={() => setShowDelete(true)}
            >
              🗑
            </button>
          </div>
        </div>
      </div>

      {/* כרטיסיות */}
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const count = counts[t.key]
          const active = activeTab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                active
                  ? 'bg-calm-500 text-white shadow-soft'
                  : 'bg-white text-calm-600 hover:bg-calm-100'
              }`}
            >
              <span>{t.icon}</span>
              {t.label}
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 text-xs ${
                    active ? 'bg-white/25' : 'bg-calm-100 text-calm-500'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* תוכן הכרטיסייה הפעילה */}
      <div className="animate-in">
        {activeTab === 'files' && <ChildFiles childId={id} />}
        {activeTab === 'reminders' && <Reminders childId={id} />}
        {activeTab === 'exercises' && <EmotionalExercises childId={id} />}
        {activeTab === 'recurring' && <RecurringExercises childId={id} />}
      </div>

      {/* עריכת פרטי ילד */}
      <Modal
        open={showEdit}
        onClose={() => setShowEdit(false)}
        title="עריכת פרטי הילד/ה"
      >
        <ChildForm
          initial={child}
          onCancel={() => setShowEdit(false)}
          onSubmit={(values) => {
            updateChild(id, values)
            setShowEdit(false)
          }}
        />
      </Modal>

      <ConfirmDialog
        open={showDelete}
        message={`האם למחוק את "${child.fullName}"? כל הקבצים, ההערות, המזכורות והתרגולים יימחקו לצמיתות.`}
        confirmLabel="מחק לצמיתות"
        onConfirm={() => {
          deleteChild(id)
          navigate('/children')
        }}
        onCancel={() => setShowDelete(false)}
      />
    </div>
  )
}
