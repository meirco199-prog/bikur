import { useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  EXERCISE_TYPE_ICONS,
  EXERCISE_TYPE_LABELS,
  type Exercise,
  type ExerciseType,
} from '../types'
import { Modal } from './ui/Modal'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { EmptyState } from './ui/EmptyState'
import { DrawingBoard } from './DrawingBoard'
import { formatDate } from '../lib/date'

// ===== אזור "תרגול רגשי" בפרופיל הילד =====
// יצירת תרגול חדש, בחירת סוג, ולתרגול ציור — פתיחת לוח הציור.
// כל תרגול נשמר תחת הילד; מוצגת היסטוריית תרגולים.

const TYPES: ExerciseType[] = [
  'drawing',
  'free-writing',
  'questionnaire',
  'homework',
  'breathing',
  'emotions',
]

// הצעות הנחיה לפי סוג תרגול — מקלות על המטפל
const SUGGESTIONS: Record<ExerciseType, string> = {
  drawing: 'צייר/י איך את/ה מרגיש/ה היום',
  'free-writing': 'כתוב/כתבי על משהו שגרם לך לחייך השבוע',
  questionnaire: 'דרג/י מ-1 עד 10: כמה הרגשת רגוע/ה היום?',
  homework: 'תרגל/י את הכלי שלמדנו פעם אחת השבוע',
  breathing: 'נשימת בלון: שאיפה 4 שניות, עצירה 2, נשיפה 6 — חמש פעמים',
  emotions: 'זהה/זהי שלושה רגשות שהרגשת היום ומה גרם להם',
}

export function EmotionalExercises({ childId }: { childId: string }) {
  const {
    data,
    addExercise,
    updateExercise,
    deleteExercise,
    addFile,
    deleteFile,
  } = useApp()

  const [showForm, setShowForm] = useState(false)
  const [type, setType] = useState<ExerciseType>('drawing')
  const [title, setTitle] = useState('')
  const [instruction, setInstruction] = useState('')
  const [content, setContent] = useState('')

  const [toDelete, setToDelete] = useState<string | null>(null)
  // ניהול לוח הציור: שומר את התרגול שעבורו פתחנו את הלוח
  const [drawingFor, setDrawingFor] = useState<Exercise | null>(null)
  const [viewImage, setViewImage] = useState<string | null>(null)

  const exercises = useMemo(
    () =>
      data.exercises
        .filter((e) => e.childId === childId)
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [data.exercises, childId],
  )

  const fileById = (id?: string) =>
    id ? data.files.find((f) => f.id === id) : undefined

  const openForm = () => {
    setType('drawing')
    setTitle('')
    setInstruction('')
    setContent('')
    setShowForm(true)
  }

  const submit = () => {
    const finalTitle =
      title.trim() || EXERCISE_TYPE_LABELS[type] // ברירת מחדל לפי הסוג
    const finalInstruction = instruction.trim() || SUGGESTIONS[type]
    const id = addExercise({
      childId,
      type,
      title: finalTitle,
      instruction: finalInstruction,
      content: content.trim(),
    })
    setShowForm(false)

    // לתרגול ציור — נפתח מיד את לוח הציור
    if (type === 'drawing') {
      const created: Exercise = {
        id,
        childId,
        type,
        title: finalTitle,
        instruction: finalInstruction,
        content: '',
        createdAt: new Date().toISOString(),
      }
      setDrawingFor(created)
    }
  }

  // שמירת ציור: הופך ל-FileItem בקטגוריית "ציורים" ומקושר לתרגול
  const handleSaveDrawing = (dataUrl: string) => {
    if (!drawingFor) return
    // אם קיים ציור קודם לתרגול — מסירים אותו ומחליפים
    const prev = fileById(drawingFor.drawingFileId)
    if (prev) deleteFile(prev.id)

    const fileId = addFile({
      childId,
      name: `ציור — ${drawingFor.title}.png`,
      category: 'drawing',
      mimeType: 'image/png',
      dataUrl,
      size: Math.round((dataUrl.length * 3) / 4),
    })
    updateExercise(drawingFor.id, { drawingFileId: fileId })
    setDrawingFor(null)
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-calm-800">💗 תרגול רגשי</h2>
        <button className="btn-primary" onClick={openForm}>
          ＋ תרגול חדש
        </button>
      </div>

      {exercises.length === 0 ? (
        <EmptyState
          icon="💗"
          title="אין עדיין תרגולים"
          hint="צרו תרגול רגשי ראשון — ציור, כתיבה, נשימות ועוד"
        />
      ) : (
        <div className="space-y-3">
          {exercises.map((ex) => {
            const file = fileById(ex.drawingFileId)
            return (
              <div key={ex.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-calm-50 text-2xl">
                    {EXERCISE_TYPE_ICONS[ex.type]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-calm-800">{ex.title}</h3>
                      <span className="badge bg-calm-100 text-calm-600">
                        {EXERCISE_TYPE_LABELS[ex.type]}
                      </span>
                    </div>
                    {ex.instruction && (
                      <p className="mt-1 text-sm text-calm-600">
                        {ex.instruction}
                      </p>
                    )}
                    {ex.content && (
                      <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-calm-50 px-3 py-2 text-sm text-calm-600">
                        {ex.content}
                      </p>
                    )}

                    {/* ציור משויך */}
                    {ex.type === 'drawing' && (
                      <div className="mt-3">
                        {file ? (
                          <button
                            onClick={() => setViewImage(file.dataUrl)}
                            className="block overflow-hidden rounded-xl border border-calm-100"
                          >
                            <img
                              src={file.dataUrl}
                              alt={ex.title}
                              className="h-32 w-auto object-cover"
                            />
                          </button>
                        ) : (
                          <div className="inline-flex items-center gap-2 rounded-xl border-2 border-dashed border-calm-200 bg-calm-50/50 px-4 py-3 text-sm text-calm-400">
                            🖼 מקום שמור לציור — עדיין לא צויר
                          </div>
                        )}
                        <div className="mt-2">
                          <button
                            className="btn-soft !py-1.5 text-sm"
                            onClick={() => setDrawingFor(ex)}
                          >
                            {file ? '✎ עריכת הציור' : '🎨 פתיחת לוח ציור'}
                          </button>
                        </div>
                      </div>
                    )}

                    <p className="mt-2 text-xs text-calm-300">
                      נוצר {formatDate(ex.createdAt)}
                    </p>
                  </div>

                  <button
                    onClick={() => setToDelete(ex.id)}
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

      {/* טופס יצירת תרגול */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="תרגול רגשי חדש"
      >
        <div className="space-y-4">
          <div>
            <label className="label">סוג התרגול</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setType(t)
                    if (!instruction.trim()) setInstruction('')
                  }}
                  className={`flex flex-col items-center gap-1 rounded-xl border-2 px-2 py-3 text-sm transition ${
                    type === t
                      ? 'border-calm-400 bg-calm-50 text-calm-800'
                      : 'border-calm-100 text-calm-500 hover:border-calm-200'
                  }`}
                >
                  <span className="text-2xl">{EXERCISE_TYPE_ICONS[t]}</span>
                  {EXERCISE_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">שם התרגול</label>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={EXERCISE_TYPE_LABELS[type]}
            />
          </div>

          <div>
            <label className="label">הנחיה לילד</label>
            <textarea
              className="input min-h-[70px] resize-y"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={SUGGESTIONS[type]}
            />
          </div>

          {type !== 'drawing' && (
            <div>
              <label className="label">תיעוד / תשובת הילד (אופציונלי)</label>
              <textarea
                className="input min-h-[70px] resize-y"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="ניתן לתעד כאן את תוצאת התרגול..."
              />
            </div>
          )}

          {type === 'drawing' && (
            <p className="rounded-lg bg-mint-50 px-3 py-2 text-sm text-mint-500">
              🎨 לאחר השמירה ייפתח לוח הציור, והציור יישמר בתיקיית הילד/ה.
            </p>
          )}

          <div className="flex justify-start gap-2">
            <button className="btn-primary" onClick={submit}>
              {type === 'drawing' ? 'יצירה ופתיחת לוח' : 'שמירה'}
            </button>
            <button className="btn-soft" onClick={() => setShowForm(false)}>
              ביטול
            </button>
          </div>
        </div>
      </Modal>

      {/* לוח הציור */}
      {drawingFor && (
        <DrawingBoard
          prompt={drawingFor.instruction || drawingFor.title}
          initialImage={fileById(drawingFor.drawingFileId)?.dataUrl}
          onSave={handleSaveDrawing}
          onClose={() => setDrawingFor(null)}
        />
      )}

      {/* תצוגת ציור מוגדל */}
      <Modal
        open={!!viewImage}
        onClose={() => setViewImage(null)}
        title="ציור"
        maxWidth="max-w-2xl"
      >
        {viewImage && (
          <img src={viewImage} alt="ציור" className="mx-auto rounded-xl" />
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        message="למחוק את התרגול? (הציור המשויך יישאר בתיקיית הקבצים)"
        onConfirm={() => {
          if (toDelete) deleteExercise(toDelete)
          setToDelete(null)
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}
