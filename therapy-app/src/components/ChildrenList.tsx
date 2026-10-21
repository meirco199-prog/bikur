import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { Avatar } from './ui/Avatar'
import { Modal } from './ui/Modal'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { ChildForm } from './ChildForm'
import { EmptyState } from './ui/EmptyState'
import { relativeTime } from '../lib/date'

// רשימת הילדים — כרטיסיות עם חיפוש והוספה מהירה
export function ChildrenList() {
  const { data, addChild, deleteChild } = useApp()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const [toDelete, setToDelete] = useState<string | null>(null)

  // פתיחת טופס הוספה דרך פרמטר ?add=1 (מהכפתור הצף)
  useEffect(() => {
    if (params.get('add') === '1') {
      setShowAdd(true)
      params.delete('add')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  const filtered = useMemo(() => {
    const q = search.trim()
    if (!q) return data.children
    return data.children.filter(
      (c) =>
        c.fullName.includes(q) ||
        c.grade.includes(q) ||
        c.contactName.includes(q),
    )
  }, [data.children, search])

  const counts = (childId: string) => ({
    files: data.files.filter((f) => f.childId === childId).length,
    reminders: data.reminders.filter(
      (r) => r.childId === childId && r.status === 'open',
    ).length,
    exercises: data.exercises.filter((e) => e.childId === childId).length,
  })

  const childToDelete = data.children.find((c) => c.id === toDelete)

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-calm-800">הילדים</h1>
          <p className="text-sm text-calm-400">
            {data.children.length} ילדים במערכת
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>
          <span className="text-lg">＋</span> הוספת ילד
        </button>
      </div>

      {data.children.length > 0 && (
        <div className="mb-5">
          <input
            className="input max-w-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 חיפוש לפי שם, כיתה או איש קשר"
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon="🧒"
          title={
            data.children.length === 0
              ? 'עדיין אין ילדים במערכת'
              : 'לא נמצאו תוצאות'
          }
          hint={
            data.children.length === 0
              ? 'הוסיפו את הילד הראשון כדי להתחיל'
              : 'נסו חיפוש אחר'
          }
          action={
            data.children.length === 0 && (
              <button className="btn-primary" onClick={() => setShowAdd(true)}>
                הוספת ילד
              </button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((child) => {
            const c = counts(child.id)
            return (
              <div
                key={child.id}
                className="card group relative p-5 transition hover:shadow-soft"
              >
                <Link to={`/children/${child.id}`} className="block">
                  <div className="flex items-center gap-3">
                    <Avatar name={child.fullName} size="lg" />
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold text-calm-800">
                        {child.fullName}
                      </p>
                      <p className="text-sm text-calm-400">
                        {child.age !== '' && `גיל ${child.age}`}
                        {child.age !== '' && child.grade && ' · '}
                        {child.grade && `כיתה ${child.grade}`}
                      </p>
                    </div>
                  </div>

                  {child.generalNotes && (
                    <p className="mt-3 line-clamp-2 text-sm text-calm-500">
                      {child.generalNotes}
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    <span className="badge bg-calm-100 text-calm-600">
                      📄 {c.files} קבצים
                    </span>
                    <span className="badge bg-warmth-100 text-warmth-500">
                      ⏰ {c.reminders} מזכורות
                    </span>
                    <span className="badge bg-mint-100 text-mint-500">
                      💗 {c.exercises} תרגולים
                    </span>
                  </div>

                  <p className="mt-3 text-xs text-calm-300">
                    פעילות אחרונה {relativeTime(child.updatedAt)}
                  </p>
                </Link>

                <button
                  onClick={() => setToDelete(child.id)}
                  className="absolute left-3 top-3 rounded-lg p-1.5 text-calm-300 opacity-0 transition hover:bg-warmth-50 hover:text-warmth-500 group-hover:opacity-100"
                  aria-label="מחק ילד"
                  title="מחיקת ילד"
                >
                  🗑
                </button>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="הוספת ילד חדש"
      >
        <ChildForm
          onCancel={() => setShowAdd(false)}
          onSubmit={(values) => {
            const id = addChild(values)
            setShowAdd(false)
            navigate(`/children/${id}`)
          }}
        />
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        message={`האם למחוק את "${childToDelete?.fullName}"? פעולה זו תמחק לצמיתות את כל הקבצים, ההערות, המזכורות והתרגולים של הילד/ה. לא ניתן לשחזר.`}
        confirmLabel="מחק לצמיתות"
        onConfirm={() => {
          if (toDelete) deleteChild(toDelete)
          setToDelete(null)
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}
