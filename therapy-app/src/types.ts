// ===== טיפוסי הנתונים המרכזיים של המערכת =====

/** קטגוריות קבצים בתיקייה האישית של הילד */
export type FileCategory = 'document' | 'presentation' | 'image' | 'drawing'

/** סוגי תרגול רגשי */
export type ExerciseType =
  | 'drawing' // ציור
  | 'free-writing' // כתיבה חופשית
  | 'questionnaire' // שאלון רגשי
  | 'homework' // משימת בית
  | 'breathing' // תרגול נשימות
  | 'emotions' // תרגול הכרת רגשות

/** סטטוס כללי לפריטים עם מצב פתוח/בוצע */
export type Status = 'open' | 'done'

/** תדירות לתרגול שוטף */
export type Frequency = 'daily' | 'weekly' | 'once'

/** ילד במערכת */
export interface Child {
  id: string
  fullName: string
  age: number | ''
  grade: string
  generalNotes: string
  contactName: string
  createdAt: string
  updatedAt: string
}

/** קובץ בתיקייה האישית (מסמך / מצגת / תמונה / ציור) */
export interface FileItem {
  id: string
  childId: string
  name: string
  category: FileCategory
  mimeType: string
  /** תוכן הקובץ כ-Data URL (base64) */
  dataUrl: string
  size: number
  createdAt: string
}

/** הערה טיפולית */
export interface TherapeuticNote {
  id: string
  childId: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

/** מזכורת / משימה */
export interface Reminder {
  id: string
  childId: string
  title: string
  description: string
  /** תאריך ושעה כ-ISO string */
  dueAt: string
  status: Status
  createdAt: string
}

/** תרגול רגשי (היסטוריה) */
export interface Exercise {
  id: string
  childId: string
  type: ExerciseType
  title: string
  instruction: string
  /** תוכן טקסטואלי (לכתיבה חופשית / שאלון / נשימות וכו') */
  content: string
  /** מזהה קובץ ציור משויך (לתרגול מסוג ציור) */
  drawingFileId?: string
  createdAt: string
}

/** תרגול שוטף / קבוע */
export interface RecurringExercise {
  id: string
  childId: string
  name: string
  instruction: string
  frequency: Frequency
  /** תאריך יעד כ-ISO date */
  dueDate: string
  status: Status
  therapistNote: string
  createdAt: string
}

/** מבנה הנתונים המלא הנשמר בכונן (IndexedDB / LocalStorage) */
export interface AppData {
  children: Child[]
  files: FileItem[]
  notes: TherapeuticNote[]
  reminders: Reminder[]
  exercises: Exercise[]
  recurring: RecurringExercise[]
  version: number
}

export const EXERCISE_TYPE_LABELS: Record<ExerciseType, string> = {
  drawing: 'ציור',
  'free-writing': 'כתיבה חופשית',
  questionnaire: 'שאלון רגשי',
  homework: 'משימת בית',
  breathing: 'תרגול נשימות',
  emotions: 'הכרת רגשות',
}

export const EXERCISE_TYPE_ICONS: Record<ExerciseType, string> = {
  drawing: '🎨',
  'free-writing': '✍️',
  questionnaire: '📋',
  homework: '🏠',
  breathing: '🌬️',
  emotions: '💗',
}

export const FILE_CATEGORY_LABELS: Record<FileCategory, string> = {
  document: 'מסמכים',
  presentation: 'מצגות',
  image: 'תמונות',
  drawing: 'ציורים',
}

export const FILE_CATEGORY_ICONS: Record<FileCategory, string> = {
  document: '📄',
  presentation: '📊',
  image: '🖼️',
  drawing: '🎨',
}

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: 'פעם ביום',
  weekly: 'פעם בשבוע',
  once: 'חד פעמי',
}
