import type { AppData } from '../types'

// ===== שכבת אחסון מקומית =====
// כל המידע נשמר ב-IndexedDB (תומך בקבצים גדולים, ללא מגבלת 5MB של LocalStorage).
// אם IndexedDB אינו זמין — נופלים חזרה ל-LocalStorage.
// השכבה הזו מבודדת לחלוטין, כך שבעתיד אפשר להחליף אותה בקריאות לשרת
// (REST / Firebase / Supabase) מבלי לגעת בשאר האפליקציה.

const DB_NAME = 'therapy-app-db'
const STORE_NAME = 'app-state'
const STATE_KEY = 'state'
const LS_KEY = 'therapy-app-state'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function idbGet(): Promise<AppData | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(STATE_KEY)
    req.onsuccess = () => resolve((req.result as AppData) ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(data: AppData): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(data, STATE_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined'
  } catch {
    return false
  }
}

/** טעינת כל הנתונים מהאחסון */
export async function loadData(): Promise<AppData | null> {
  if (hasIndexedDb()) {
    try {
      return await idbGet()
    } catch (e) {
      console.warn('IndexedDB load failed, falling back to localStorage', e)
    }
  }
  const raw = localStorage.getItem(LS_KEY)
  return raw ? (JSON.parse(raw) as AppData) : null
}

/** שמירת כל הנתונים לאחסון */
export async function saveData(data: AppData): Promise<void> {
  if (hasIndexedDb()) {
    try {
      await idbSet(data)
      return
    } catch (e) {
      console.warn('IndexedDB save failed, falling back to localStorage', e)
    }
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data))
  } catch (e) {
    console.error('שמירת הנתונים נכשלה (ייתכן שחרגתם ממכסת האחסון)', e)
    throw e
  }
}

/** המרת קובץ ל-Data URL (base64) לצורך אחסון */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** יצירת מזהה ייחודי */
export function uid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
  )
}
