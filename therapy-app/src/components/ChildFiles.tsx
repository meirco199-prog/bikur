import { useMemo, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  FILE_CATEGORY_ICONS,
  FILE_CATEGORY_LABELS,
  type FileCategory,
  type FileItem,
} from '../types'
import { fileToDataUrl } from '../lib/storage'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { EmptyState } from './ui/EmptyState'
import { Modal } from './ui/Modal'
import { formatDate } from '../lib/date'

// תיקייה אישית — ניהול קבצים והערות טיפוליות של הילד
const CATEGORIES: FileCategory[] = ['document', 'presentation', 'image', 'drawing']

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ב׳`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} ק״ב`
  return `${(bytes / 1024 / 1024).toFixed(1)} מ״ב`
}

export function ChildFiles({ childId }: { childId: string }) {
  const { data, addFile, deleteFile, addNote, updateNote, deleteNote } = useApp()
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploadCategory, setUploadCategory] = useState<FileCategory>('document')
  const [activeCategory, setActiveCategory] = useState<FileCategory | 'all'>(
    'all',
  )
  const [fileToDelete, setFileToDelete] = useState<FileItem | null>(null)
  const [preview, setPreview] = useState<FileItem | null>(null)
  const [uploadError, setUploadError] = useState('')

  // הערות
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [noteTitle, setNoteTitle] = useState('')
  const [noteContent, setNoteContent] = useState('')

  const files = useMemo(
    () =>
      data.files
        .filter((f) => f.childId === childId)
        .filter((f) => activeCategory === 'all' || f.category === activeCategory)
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [data.files, childId, activeCategory],
  )

  const notes = useMemo(
    () =>
      data.notes
        .filter((n) => n.childId === childId)
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    [data.notes, childId],
  )

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files
    if (!list || list.length === 0) return
    setUploadError('')
    try {
      for (const file of Array.from(list)) {
        // מגבלת גודל ידידותית כדי לא לחרוג ממכסת האחסון
        if (file.size > 8 * 1024 * 1024) {
          setUploadError(`הקובץ "${file.name}" גדול מ-8 מ״ב ולא הועלה.`)
          continue
        }
        const dataUrl = await fileToDataUrl(file)
        const inferred: FileCategory = file.type.startsWith('image/')
          ? uploadCategory === 'drawing'
            ? 'drawing'
            : 'image'
          : uploadCategory
        addFile({
          childId,
          name: file.name,
          category: inferred,
          mimeType: file.type || 'application/octet-stream',
          dataUrl,
          size: file.size,
        })
      }
    } catch {
      setUploadError('אירעה שגיאה בהעלאת הקובץ.')
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const startEditNote = (id: string, title: string, content: string) => {
    setEditingNote(id)
    setNoteTitle(title)
    setNoteContent(content)
    setShowNoteForm(true)
  }

  const submitNote = () => {
    if (!noteTitle.trim() && !noteContent.trim()) return
    if (editingNote) {
      updateNote(editingNote, {
        title: noteTitle.trim() || 'ללא כותרת',
        content: noteContent.trim(),
      })
    } else {
      addNote({
        childId,
        title: noteTitle.trim() || 'ללא כותרת',
        content: noteContent.trim(),
      })
    }
    closeNoteForm()
  }

  const closeNoteForm = () => {
    setShowNoteForm(false)
    setEditingNote(null)
    setNoteTitle('')
    setNoteContent('')
  }

  return (
    <div className="space-y-8">
      {/* ===== קבצים ===== */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-calm-800">
            📁 קבצים ומסמכים
          </h2>
          <div className="flex items-center gap-2">
            <select
              className="input !w-auto !py-2 text-sm"
              value={uploadCategory}
              onChange={(e) =>
                setUploadCategory(e.target.value as FileCategory)
              }
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {FILE_CATEGORY_ICONS[c]} {FILE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
            <button
              className="btn-primary"
              onClick={() => fileInput.current?.click()}
            >
              ⬆ העלאה
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={onPickFile}
            />
          </div>
        </div>

        {uploadError && (
          <p className="mb-3 rounded-lg bg-warmth-100 px-3 py-2 text-sm text-warmth-500">
            {uploadError}
          </p>
        )}

        {/* סינון לפי קטגוריה */}
        <div className="mb-4 flex flex-wrap gap-2">
          <CategoryChip
            active={activeCategory === 'all'}
            onClick={() => setActiveCategory('all')}
            label="הכל"
            icon="🗂"
          />
          {CATEGORIES.map((c) => (
            <CategoryChip
              key={c}
              active={activeCategory === c}
              onClick={() => setActiveCategory(c)}
              label={FILE_CATEGORY_LABELS[c]}
              icon={FILE_CATEGORY_ICONS[c]}
            />
          ))}
        </div>

        {files.length === 0 ? (
          <EmptyState
            icon="📂"
            title="אין קבצים בקטגוריה זו"
            hint="העלו מסמכים, מצגות או תמונות"
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {files.map((f) => (
              <div key={f.id} className="card group relative overflow-hidden">
                <button
                  onClick={() => setPreview(f)}
                  className="block w-full text-right"
                >
                  <div className="flex h-28 items-center justify-center bg-calm-50">
                    {f.mimeType.startsWith('image/') ? (
                      <img
                        src={f.dataUrl}
                        alt={f.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-4xl">
                        {FILE_CATEGORY_ICONS[f.category]}
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="truncate text-sm font-medium text-calm-700">
                      {f.name}
                    </p>
                    <p className="text-xs text-calm-400">
                      {formatDate(f.createdAt)} · {humanSize(f.size)}
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => setFileToDelete(f)}
                  className="absolute left-2 top-2 rounded-lg bg-white/90 p-1.5 text-calm-400 opacity-0 transition hover:text-warmth-500 group-hover:opacity-100"
                  aria-label="מחק קובץ"
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ===== הערות טיפוליות ===== */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-calm-800">
            📝 הערות טיפוליות
          </h2>
          <button
            className="btn-mint"
            onClick={() => {
              closeNoteForm()
              setShowNoteForm(true)
            }}
          >
            ＋ הערה חדשה
          </button>
        </div>

        {notes.length === 0 ? (
          <EmptyState icon="🗒" title="אין עדיין הערות" />
        ) : (
          <div className="space-y-3">
            {notes.map((n) => (
              <div key={n.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold text-calm-800">{n.title}</h3>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => startEditNote(n.id, n.title, n.content)}
                      className="rounded-lg p-1.5 text-calm-400 hover:bg-calm-100 hover:text-calm-700"
                      aria-label="ערוך"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => setNoteToDelete(n.id)}
                      className="rounded-lg p-1.5 text-calm-400 hover:bg-warmth-50 hover:text-warmth-500"
                      aria-label="מחק"
                    >
                      🗑
                    </button>
                  </div>
                </div>
                {n.content && (
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-calm-600">
                    {n.content}
                  </p>
                )}
                <p className="mt-2 text-xs text-calm-300">
                  עודכן {formatDate(n.updatedAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* תצוגה מקדימה / הורדת קובץ */}
      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title={preview?.name ?? ''}
        maxWidth="max-w-2xl"
      >
        {preview && (
          <div className="space-y-4">
            {preview.mimeType.startsWith('image/') ? (
              <img
                src={preview.dataUrl}
                alt={preview.name}
                className="mx-auto max-h-[60vh] rounded-xl"
              />
            ) : (
              <div className="rounded-xl bg-calm-50 p-8 text-center">
                <div className="text-5xl">
                  {FILE_CATEGORY_ICONS[preview.category]}
                </div>
                <p className="mt-3 text-calm-500">
                  אין תצוגה מקדימה לסוג קובץ זה
                </p>
              </div>
            )}
            <a
              href={preview.dataUrl}
              download={preview.name}
              className="btn-primary"
            >
              ⬇ הורדת הקובץ
            </a>
          </div>
        )}
      </Modal>

      {/* טופס הערה */}
      <Modal
        open={showNoteForm}
        onClose={closeNoteForm}
        title={editingNote ? 'עריכת הערה' : 'הערה טיפולית חדשה'}
      >
        <div className="space-y-4">
          <div>
            <label className="label">כותרת</label>
            <input
              className="input"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              placeholder="נושא ההערה"
              autoFocus
            />
          </div>
          <div>
            <label className="label">תוכן</label>
            <textarea
              className="input min-h-[120px] resize-y"
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="פירוט ההערה הטיפולית..."
            />
          </div>
          <div className="flex justify-start gap-2">
            <button className="btn-primary" onClick={submitNote}>
              שמירה
            </button>
            <button className="btn-soft" onClick={closeNoteForm}>
              ביטול
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!fileToDelete}
        message={`למחוק את הקובץ "${fileToDelete?.name}"?`}
        onConfirm={() => {
          if (fileToDelete) deleteFile(fileToDelete.id)
          setFileToDelete(null)
        }}
        onCancel={() => setFileToDelete(null)}
      />

      <ConfirmDialog
        open={!!noteToDelete}
        message="למחוק את ההערה הטיפולית?"
        onConfirm={() => {
          if (noteToDelete) deleteNote(noteToDelete)
          setNoteToDelete(null)
        }}
        onCancel={() => setNoteToDelete(null)}
      />
    </div>
  )
}

function CategoryChip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon: string
}) {
  return (
    <button
      onClick={onClick}
      className={`chip ${
        active
          ? 'border-calm-400 bg-calm-500 text-white'
          : 'border-calm-200 bg-white text-calm-600 hover:bg-calm-50'
      }`}
    >
      <span>{icon}</span>
      {label}
    </button>
  )
}
