import { useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import type { Reminder } from '../types'
import { Modal } from './ui/Modal'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { EmptyState } from './ui/EmptyState'
import { formatDateTime, isPast, relativeTime, toDateTimeLocal } from '../lib/date'

// מזכורות ומשימות של הילד
export function Reminders({ childId }: { childId: string }) {
  const { data, addReminder, updateReminder, deleteReminder } = useApp()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Reminder | null>(null)
  const [toDelete, setToDelete] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueAt, setDueAt] = useState('')

  const reminders = useMemo(
    () =>
      data.reminders
        .filter((r) => r.childId === childId)
        .sort((a, b) => {
          // פתוחות קודם, ואז לפי תאריך
          if (a.status !== b.status) return a.status === 'open' ? -1 : 1
          return +new Date(a.dueAt) - +new Date(b.dueAt)
        }),
    [data.reminders, childId],
  )

  const openForm = (r?: Reminder) => {
    if (r) {
      setEditing(r)
      setTitle(r.title)
      setDescription(r.description)
      setDueAt(toDateTimeLocal(r.dueAt))
    } else {
      setEditing(null)
      setTitle('')
      setDescription('')
      // ברירת מחדל: מחר בשעה 10:00
      const d = new Date()
      d.setDate(d.getDate() + 1)
      d.setHours(10, 0, 0, 0)
      setDueAt(toDateTimeLocal(d.toISOString()))
    }
    setShowForm(true)
  }

  const submit = () => {
    if (!title.trim() || !dueAt) return
    const iso = new Date(dueAt).toISOString()
    if (editing) {
      updateReminder(editing.id, {
        title: title.trim(),
        description: description.trim(),
        dueAt: iso,
      })
    } else {
      addReminder({
        childId,
        title: title.trim(),
        description: description.trim(),
        dueAt: iso,
        status: 'open',
      })
    }
    setShowForm(false)
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-calm-800">⏰ מזכורות ומשימות</h2>
        <button className="btn-primary" onClick={() => openForm()}>
          ＋ מזכורת חדשה
        </button>
      </div>

      {reminders.length === 0 ? (
        <EmptyState
          icon="⏰"
          title="אין מזכורות"
          hint="הוסיפו מזכורת ראשונה לילד/ה"
        />
      ) : (
        <div className="space-y-3">
          {reminders.map((r) => {
            const done = r.status === 'done'
            const overdue = !done && isPast(r.dueAt)
            return (
              <div
                key={r.id}
                className={`card flex items-start gap-3 p-4 ${
                  done ? 'opacity-60' : ''
                }`}
              >
                <button
                  onClick={() =>
                    updateReminder(r.id, {
                      status: done ? 'open' : 'done',
                    })
                  }
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
                    done
                      ? 'border-mint-400 bg-mint-400 text-white'
                      : 'border-calm-300 hover:border-mint-400'
                  }`}
                  aria-label={done ? 'סמן כפתוח' : 'סמן כבוצע'}
                >
                  {done && '✓'}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className={`font-medium text-calm-800 ${
                        done ? 'line-through' : ''
                      }`}
                    >
                      {r.title}
                    </p>
                    <span
                      className={`badge ${
                        done
                          ? 'bg-mint-100 text-mint-500'
                          : overdue
                            ? 'bg-warmth-100 text-warmth-500'
                            : 'bg-calm-100 text-calm-600'
                      }`}
                    >
                      {done ? 'בוצע' : relativeTime(r.dueAt)}
                    </span>
                  </div>
                  {r.description && (
                    <p className="mt-1 text-sm text-calm-500">{r.description}</p>
                  )}
                  <p className="mt-1 text-xs text-calm-400">
                    🗓 {formatDateTime(r.dueAt)}
                  </p>
                </div>

                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => openForm(r)}
                    className="rounded-lg p-1.5 text-calm-400 hover:bg-calm-100 hover:text-calm-700"
                    aria-label="ערוך"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => setToDelete(r.id)}
                    className="rounded-lg p-1.5 text-calm-400 hover:bg-warmth-50 hover:text-warmth-500"
                    aria-label="מחק"
                  >
                    🗑
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? 'עריכת מזכורת' : 'מזכורת חדשה'}
      >
        <div className="space-y-4">
          <div>
            <label className="label">כותרת *</label>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="נושא המזכורת"
              autoFocus
            />
          </div>
          <div>
            <label className="label">תאריך ושעה *</label>
            <input
              className="input"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>
          <div>
            <label className="label">תיאור</label>
            <textarea
              className="input min-h-[80px] resize-y"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="פרטים נוספים..."
            />
          </div>
          <div className="flex justify-start gap-2">
            <button className="btn-primary" onClick={submit}>
              שמירה
            </button>
            <button className="btn-soft" onClick={() => setShowForm(false)}>
              ביטול
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        message="למחוק את המזכורת?"
        onConfirm={() => {
          if (toDelete) deleteReminder(toDelete)
          setToDelete(null)
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}
