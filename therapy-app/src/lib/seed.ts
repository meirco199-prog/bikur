import type { AppData } from '../types'
import { uid } from './storage'

// ===== נתוני דוגמה ראשוניים =====
// נטענים פעם אחת בהפעלה הראשונה. כוללים 2 ילדים, מסמך, מזכורת,
// תרגול רגשי וציור לדוגמה (מקום שמור) לכל אחד.

// מסמך טקסט קטן כ-Data URL (קובץ דוגמה אמיתי הניתן להורדה)
function textDoc(text: string): string {
  return 'data:text/plain;charset=utf-8,' + encodeURIComponent(text)
}

// ציור דוגמה — תמונת SVG פשוטה כ-Data URL (מקום שמור לציור)
function placeholderDrawing(label: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'>
    <rect width='400' height='300' fill='#f0faf6'/>
    <circle cx='200' cy='130' r='60' fill='#fbe9e2' stroke='#e68a6b' stroke-width='3'/>
    <circle cx='180' cy='120' r='6' fill='#3b5c77'/>
    <circle cx='220' cy='120' r='6' fill='#3b5c77'/>
    <path d='M175 150 Q200 175 225 150' stroke='#3b5c77' stroke-width='3' fill='none' stroke-linecap='round'/>
    <text x='200' y='250' font-family='Arial' font-size='20' fill='#477192' text-anchor='middle'>${label}</text>
  </svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

export function buildSeedData(): AppData {
  const now = new Date()
  const iso = (d: Date) => d.toISOString()
  const daysFromNow = (n: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + n)
    return d
  }

  // ----- ילד 1 -----
  const child1Id = uid()
  // ----- ילד 2 -----
  const child2Id = uid()

  const drawing1Id = uid()
  const drawing2Id = uid()

  return {
    version: 1,
    children: [
      {
        id: child1Id,
        fullName: 'נועה לוי',
        age: 8,
        grade: "ג'",
        generalNotes:
          'ילדה רגישה ויצירתית, מתקשה לעיתים בוויסות רגשי במצבי לחץ. אוהבת ציור וסיפורים.',
        contactName: 'מיכל לוי (אמא) · 050-1234567',
        createdAt: iso(daysFromNow(-30)),
        updatedAt: iso(daysFromNow(-2)),
      },
      {
        id: child2Id,
        fullName: 'איתי כהן',
        age: 10,
        grade: "ה'",
        generalNotes:
          'ילד מופנם, עובד יפה דרך משימות מובנות ותרגולי נשימה. מתחבר לכלים גרפיים.',
        contactName: 'דנה כהן (אמא) · 052-7654321',
        createdAt: iso(daysFromNow(-20)),
        updatedAt: iso(daysFromNow(-1)),
      },
    ],
    files: [
      {
        id: uid(),
        childId: child1Id,
        name: 'סיכום פגישה ראשונה.txt',
        category: 'document',
        mimeType: 'text/plain',
        dataUrl: textDoc(
          'סיכום פגישה ראשונה — נועה לוי\n\nנושאים שעלו: התמודדות עם חרדת בחינות, קושי בפרידה בבוקר.\nמטרות לטיפול: חיזוק תחושת מסוגלות, פיתוח כלים לוויסות.\nהמלצות: תרגול נשימות יומי, יומן רגשות.',
        ),
        size: 280,
        createdAt: iso(daysFromNow(-29)),
      },
      {
        id: drawing1Id,
        childId: child1Id,
        name: 'ציור — איך אני מרגישה היום.svg',
        category: 'drawing',
        mimeType: 'image/svg+xml',
        dataUrl: placeholderDrawing('איך אני מרגישה היום'),
        size: 600,
        createdAt: iso(daysFromNow(-3)),
      },
      {
        id: uid(),
        childId: child2Id,
        name: 'תכנית התערבות.txt',
        category: 'document',
        mimeType: 'text/plain',
        dataUrl: textDoc(
          'תכנית התערבות — איתי כהן\n\nתחומי עבודה: זיהוי רגשות, ויסות חרדה.\nתדירות מפגשים: שבועי.\nכלים: כרטיסיות רגשות, תרגול נשימות "בלון", משימות בית מובנות.',
        ),
        size: 240,
        createdAt: iso(daysFromNow(-19)),
      },
      {
        id: drawing2Id,
        childId: child2Id,
        name: 'ציור — המקום הבטוח שלי.svg',
        category: 'drawing',
        mimeType: 'image/svg+xml',
        dataUrl: placeholderDrawing('המקום הבטוח שלי'),
        size: 600,
        createdAt: iso(daysFromNow(-5)),
      },
    ],
    notes: [
      {
        id: uid(),
        childId: child1Id,
        title: 'התקדמות בוויסות',
        content:
          'נועה הצליחה השבוע להשתמש בתרגול הנשימה לבד לפני מבחן. דיווחה על תחושת רוגע. להמשיך לחזק.',
        createdAt: iso(daysFromNow(-2)),
        updatedAt: iso(daysFromNow(-2)),
      },
    ],
    reminders: [
      {
        id: uid(),
        childId: child1Id,
        title: 'שיחת מעקב עם ההורים',
        description: 'לעדכן את אמא לגבי ההתקדמות ולתאם המשך.',
        dueAt: iso(daysFromNow(2)),
        status: 'open',
        createdAt: iso(daysFromNow(-1)),
      },
      {
        id: uid(),
        childId: child2Id,
        title: 'להכין כרטיסיות רגשות',
        description: 'להדפיס ערכת כרטיסיות לקראת המפגש הבא.',
        dueAt: iso(daysFromNow(4)),
        status: 'open',
        createdAt: iso(daysFromNow(-1)),
      },
    ],
    exercises: [
      {
        id: uid(),
        childId: child1Id,
        type: 'drawing',
        title: 'צייר את הרגש שלך',
        instruction: 'ציירי איך את מרגישה היום — בכל צבע שמתאים לך.',
        content: '',
        drawingFileId: drawing1Id,
        createdAt: iso(daysFromNow(-3)),
      },
      {
        id: uid(),
        childId: child2Id,
        type: 'breathing',
        title: 'תרגול נשימת בלון',
        instruction:
          'דמיין שיש לך בלון בבטן. שאף אוויר ונפח אותו לאט (4 שניות), עצור (2 שניות), ונשוף לאט (6 שניות). חזור 5 פעמים.',
        content: 'בוצע פעמיים השבוע, דיווח על תחושת רוגע.',
        createdAt: iso(daysFromNow(-4)),
      },
    ],
    recurring: [
      {
        id: uid(),
        childId: child1Id,
        name: 'יומן רגשות יומי',
        instruction: 'בכל ערב לכתוב משפט אחד על הרגש החזק ביותר של היום.',
        frequency: 'daily',
        dueDate: iso(daysFromNow(7)).slice(0, 10),
        status: 'open',
        therapistNote: 'לבדוק יחד בכל מפגש.',
        createdAt: iso(daysFromNow(-10)),
      },
      {
        id: uid(),
        childId: child2Id,
        name: 'תרגול נשימות שבועי',
        instruction: 'לתרגל את נשימת הבלון 3 פעמים בשבוע.',
        frequency: 'weekly',
        dueDate: iso(daysFromNow(5)).slice(0, 10),
        status: 'open',
        therapistNote: '',
        createdAt: iso(daysFromNow(-12)),
      },
    ],
  }
}
