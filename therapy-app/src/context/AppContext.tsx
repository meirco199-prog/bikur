import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  AppData,
  Child,
  Exercise,
  FileItem,
  RecurringExercise,
  Reminder,
  TherapeuticNote,
} from '../types'
import { loadData, saveData, uid } from '../lib/storage'
import { buildSeedData } from '../lib/seed'

// ===== ניהול המצב המרכזי של האפליקציה =====
// מחזיק את כל הנתונים, טוען מהאחסון בהפעלה ושומר אוטומטית בכל שינוי.
// כל הקומפוננטות ניגשות לנתונים ולפעולות דרך ה-hook useApp().

interface AppContextValue {
  data: AppData
  loading: boolean

  // ילדים
  addChild: (c: Omit<Child, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateChild: (id: string, patch: Partial<Child>) => void
  deleteChild: (id: string) => void
  getChild: (id: string) => Child | undefined

  // קבצים
  addFile: (f: Omit<FileItem, 'id' | 'createdAt'>) => string
  deleteFile: (id: string) => void

  // הערות טיפוליות
  addNote: (n: Omit<TherapeuticNote, 'id' | 'createdAt' | 'updatedAt'>) => void
  updateNote: (id: string, patch: Partial<TherapeuticNote>) => void
  deleteNote: (id: string) => void

  // מזכורות
  addReminder: (r: Omit<Reminder, 'id' | 'createdAt'>) => void
  updateReminder: (id: string, patch: Partial<Reminder>) => void
  deleteReminder: (id: string) => void

  // תרגול רגשי
  addExercise: (e: Omit<Exercise, 'id' | 'createdAt'>) => string
  updateExercise: (id: string, patch: Partial<Exercise>) => void
  deleteExercise: (id: string) => void

  // תרגול שוטף
  addRecurring: (r: Omit<RecurringExercise, 'id' | 'createdAt'>) => void
  updateRecurring: (id: string, patch: Partial<RecurringExercise>) => void
  deleteRecurring: (id: string) => void
}

const emptyData: AppData = {
  children: [],
  files: [],
  notes: [],
  reminders: [],
  exercises: [],
  recurring: [],
  version: 1,
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(emptyData)
  const [loading, setLoading] = useState(true)
  const isLoaded = useRef(false)

  // טעינה ראשונית
  useEffect(() => {
    ;(async () => {
      const stored = await loadData()
      if (stored) {
        setData({ ...emptyData, ...stored })
      } else {
        const seed = buildSeedData()
        setData(seed)
        await saveData(seed)
      }
      isLoaded.current = true
      setLoading(false)
    })()
  }, [])

  // שמירה אוטומטית בכל שינוי (לאחר הטעינה הראשונית)
  useEffect(() => {
    if (!isLoaded.current) return
    saveData(data).catch((e) => console.error('Auto-save failed', e))
  }, [data])

  const now = () => new Date().toISOString()

  // מסמן פעילות אחרונה אצל הילד
  const touchChild = (childId: string, list: Child[]): Child[] =>
    list.map((c) => (c.id === childId ? { ...c, updatedAt: now() } : c))

  const value: AppContextValue = {
    data,
    loading,

    addChild(c) {
      const id = uid()
      const child: Child = { ...c, id, createdAt: now(), updatedAt: now() }
      setData((d) => ({ ...d, children: [child, ...d.children] }))
      return id
    },
    updateChild(id, patch) {
      setData((d) => ({
        ...d,
        children: d.children.map((c) =>
          c.id === id ? { ...c, ...patch, updatedAt: now() } : c,
        ),
      }))
    },
    deleteChild(id) {
      // מחיקה מבטלת גם את כל הנתונים המשויכים לילד — בידוד מלא בין ילדים
      setData((d) => ({
        ...d,
        children: d.children.filter((c) => c.id !== id),
        files: d.files.filter((f) => f.childId !== id),
        notes: d.notes.filter((n) => n.childId !== id),
        reminders: d.reminders.filter((r) => r.childId !== id),
        exercises: d.exercises.filter((e) => e.childId !== id),
        recurring: d.recurring.filter((r) => r.childId !== id),
      }))
    },
    getChild(id) {
      return data.children.find((c) => c.id === id)
    },

    addFile(f) {
      const id = uid()
      const file: FileItem = { ...f, id, createdAt: now() }
      setData((d) => ({
        ...d,
        files: [file, ...d.files],
        children: touchChild(f.childId, d.children),
      }))
      return id
    },
    deleteFile(id) {
      setData((d) => ({ ...d, files: d.files.filter((f) => f.id !== id) }))
    },

    addNote(n) {
      const note: TherapeuticNote = {
        ...n,
        id: uid(),
        createdAt: now(),
        updatedAt: now(),
      }
      setData((d) => ({
        ...d,
        notes: [note, ...d.notes],
        children: touchChild(n.childId, d.children),
      }))
    },
    updateNote(id, patch) {
      setData((d) => ({
        ...d,
        notes: d.notes.map((n) =>
          n.id === id ? { ...n, ...patch, updatedAt: now() } : n,
        ),
      }))
    },
    deleteNote(id) {
      setData((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== id) }))
    },

    addReminder(r) {
      const reminder: Reminder = { ...r, id: uid(), createdAt: now() }
      setData((d) => ({
        ...d,
        reminders: [reminder, ...d.reminders],
        children: touchChild(r.childId, d.children),
      }))
    },
    updateReminder(id, patch) {
      setData((d) => ({
        ...d,
        reminders: d.reminders.map((r) =>
          r.id === id ? { ...r, ...patch } : r,
        ),
      }))
    },
    deleteReminder(id) {
      setData((d) => ({
        ...d,
        reminders: d.reminders.filter((r) => r.id !== id),
      }))
    },

    addExercise(e) {
      const id = uid()
      const exercise: Exercise = { ...e, id, createdAt: now() }
      setData((d) => ({
        ...d,
        exercises: [exercise, ...d.exercises],
        children: touchChild(e.childId, d.children),
      }))
      return id
    },
    updateExercise(id, patch) {
      setData((d) => ({
        ...d,
        exercises: d.exercises.map((e) =>
          e.id === id ? { ...e, ...patch } : e,
        ),
      }))
    },
    deleteExercise(id) {
      setData((d) => ({
        ...d,
        exercises: d.exercises.filter((e) => e.id !== id),
      }))
    },

    addRecurring(r) {
      const rec: RecurringExercise = { ...r, id: uid(), createdAt: now() }
      setData((d) => ({
        ...d,
        recurring: [rec, ...d.recurring],
        children: touchChild(r.childId, d.children),
      }))
    },
    updateRecurring(id, patch) {
      setData((d) => ({
        ...d,
        recurring: d.recurring.map((r) =>
          r.id === id ? { ...r, ...patch } : r,
        ),
      }))
    },
    deleteRecurring(id) {
      setData((d) => ({
        ...d,
        recurring: d.recurring.filter((r) => r.id !== id),
      }))
    },
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
