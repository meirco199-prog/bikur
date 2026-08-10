import { useState } from 'react'
import type { Child } from '../types'

// טופס הוספה/עריכה של ילד
export interface ChildFormValues {
  fullName: string
  age: number | ''
  grade: string
  generalNotes: string
  contactName: string
}

export function ChildForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Child
  onSubmit: (values: ChildFormValues) => void
  onCancel: () => void
}) {
  const [values, setValues] = useState<ChildFormValues>({
    fullName: initial?.fullName ?? '',
    age: initial?.age ?? '',
    grade: initial?.grade ?? '',
    generalNotes: initial?.generalNotes ?? '',
    contactName: initial?.contactName ?? '',
  })
  const [error, setError] = useState('')

  const set = <K extends keyof ChildFormValues>(
    key: K,
    val: ChildFormValues[K],
  ) => setValues((v) => ({ ...v, [key]: val }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!values.fullName.trim()) {
      setError('יש להזין שם מלא')
      return
    }
    onSubmit({ ...values, fullName: values.fullName.trim() })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label">שם מלא *</label>
        <input
          className="input"
          value={values.fullName}
          onChange={(e) => set('fullName', e.target.value)}
          placeholder="שם הילד/ה"
          autoFocus
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">גיל</label>
          <input
            className="input"
            type="number"
            min={0}
            max={120}
            value={values.age}
            onChange={(e) =>
              set('age', e.target.value === '' ? '' : Number(e.target.value))
            }
            placeholder="גיל"
          />
        </div>
        <div>
          <label className="label">כיתה</label>
          <input
            className="input"
            value={values.grade}
            onChange={(e) => set('grade', e.target.value)}
            placeholder="לדוגמה: ג'"
          />
        </div>
      </div>

      <div>
        <label className="label">שם הורה / איש קשר</label>
        <input
          className="input"
          value={values.contactName}
          onChange={(e) => set('contactName', e.target.value)}
          placeholder="שם וטלפון"
        />
      </div>

      <div>
        <label className="label">הערות כלליות</label>
        <textarea
          className="input min-h-[90px] resize-y"
          value={values.generalNotes}
          onChange={(e) => set('generalNotes', e.target.value)}
          placeholder="רקע כללי, מטרות טיפול, נושאים מרכזיים..."
        />
      </div>

      {error && (
        <p className="rounded-lg bg-warmth-100 px-3 py-2 text-sm text-warmth-500">
          {error}
        </p>
      )}

      <div className="flex justify-start gap-2 pt-1">
        <button type="submit" className="btn-primary">
          שמירה
        </button>
        <button type="button" className="btn-soft" onClick={onCancel}>
          ביטול
        </button>
      </div>
    </form>
  )
}
