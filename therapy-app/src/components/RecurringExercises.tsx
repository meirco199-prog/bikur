import { useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  FREQUENCY_LABELS,
  type Frequency,
  type RecurringExercise,
} from '../types'
import { Modal } from './ui/Modal'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { EmptyState } from './ui/EmptyState'
import { formatDate, isPast } from '../lib/date'

// ===== תרגול שוטף / קבוע =====
// תרגול חוזר לילד (יומי / שבועי / חד פעמי) עם שם, הנחיה, תאריך יעד,
// סטטוס ביצוע והערת מטפל. מוצגים התרגולים הפעילים.

const FREQS: Frequency[] = ['daily', 'weekly', 'once']

export function RecurringExercises({ childId }: { childId: string }) {
  const { data, addRecurring, updateRecurring, deleteRecurring } = useApp()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<RecurringExercise | null>(null)
  const [toDelete, setToDelete] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [instruction, setInstruction] = useState('')
  const [frequency, setFrequency] = useState<Frequency>('weekly')
  const [dueDate, setDueDate] = useState('')
  const [therapistNote, setTherapistNote] = useState('')

  const items = useMemo(
    () =>
      data.recurring
        .filter((r) => r.childId === childId)
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === 'open' ? -1 : 1
          return +new Date(a.dueDate) - +new Date(b.dueDate)
        }),
    [data.recurring, childId],
  )

  const openForm = (r?: RecurringExercise) => {
    if (r) {
      setEditing(r)
      setName(r.name)
      setInstruction(r.instruction)
      setFrequency(r.frequency)
      setDueDate(r.dueDate)
      setTherapistNote(r.therapistNote)
    } else {
      setEditing(null)
      setName('')
      setInstruction('')
      setFrequency('weekly')
      const d = new Date()
      d.setDate(d.getDate() + 7)
      setDueDate(d.toISOString().slice(0, 10))
      setTherapistNote('')
    }
    setShowForm(true)
  }

  const submit = () => {
    if (!name.trim()) return
    if (editing) {
      updateRecurring(editing.id, {
        name: name.trim(),
        instruction: instruction.trim(),
        frequency,
        dueDate,
        therapistNote: therapistNote.trim(),
      })
    } else {
      addRecurring({
        childId,
        name: name.trim(),
        instruction: instruction.trim(),
        frequency,
        dueDate,
        status: 'open',
        therapistNote: therapistNote.trim(),
      })
    }
    setShowForm(false)
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-calm-800">🔁 תרגול שוטף</h2>
        <button className="btn-primary" onClick={() => openForm()}>
          ＋ תרגול שוטף חדש
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="🔁"
          title="אין תרגולים שוטפים"
          hint="הגדירו תרגול קבוע — יומי או שבועי"
        />
      ) : (
        <div className="space-y-3">
          {items.map((r) => {
            const done = r.status === 'done'
            const overdue = !done && isPast(r.dueDate + 'T23:59:59')
            return (
              <div
                key={r.id}
                className={`card p-4 ${done ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() =>
                      updateRecurring(r.id, {
                        status: done ? 'open' : 'done',
                      })
                    }
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
                      done
                        ? 'border-mint-400 bg-mint-400 text-white'
                        : 'border-calm-300 hover:border-mint-400'
                    }`}
                    aria-label={done ? 'סמן כפעיל' : 'סמן כבוצע'}
                  >
                    {done && '✓'}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3
                        className={`font-semibold text-calm-800 ${
                          done ? 'line-through' : ''
                        }`}
                      >
                        {r.name}
                      </h3>
                      <span className="badge bg-mint-100 text-mint-500">
                        {FREQUENCY_LABELS[r.frequency]}
                      </span>
                      <span
                        className={`badge ${
                          done
                            ? 'bg-mint-100 text-mint-500'
                            : overdue
                              ? 'bg-warmth-100 text-warmth-500'
                              : 'bg-calm-100 text-calm-600'
                        }`}
                      >
                        {done ? 'בוצע' : `יעד: ${formatDate(r.dueDate)}`}
                      </span>
                    </div>
                    {r.instruction && (
                      <p className="mt-1 text-sm text-calm-600">
                        {r.instruction}
                      </p>
                    )}
                    {r.therapistNote && (
                      <p className="mt-1.5 rounded-lg bg-calm-50 px-3 py-2 text-sm text-calm-500">
                        💬 הערת מטפל: {r.therapistNote}
                      </p>
                    )}
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
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? 'עריכת תרגול שוטף' : 'תרגול שוטף חדש'}
      >
        <div className="space-y-4">
          <div>
            <label className="label">שם התרגול *</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="לדוגמה: יומן רגשות"
              autoFocus
            />
          </div>
          <div>
            <label className="label">הנחיה לילד</label>
            <textarea
              className="input min-h-[70px] resize-y"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="מה על הילד/ה לעשות..."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">תדירות</label>
              <select
                className="input"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
              >
                {FREQS.map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABELS[f]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">תאריך יעד</label>
              <input
                className="input"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="label">הערת מטפל</label>
            <textarea
              className="input min-h-[60px] resize-y"
              value={therapistNote}
              onChange={(e) => setTherapistNote(e.target.value)}
              placeholder="הערות פנימיות למעקב..."
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
        message="למחוק את התרגול השוטף?"
        onConfirm={() => {
          if (toDelete) deleteRecurring(toDelete)
          setToDelete(null)
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}
