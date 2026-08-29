/* ============================================================
   settings.js — הגדרות, גיבוי, פרטיות ויומן פעולות
   ============================================================ */

import { el, fmtDateTime, setMoneyPrecision } from '../core/util.js';
import { buildDemoState } from '../core/seed.js';
import { defaultCategories, defaultAccounts } from '../core/schema.js';
import { monthsWithData } from '../domain/finance.js';
import { sectionCard, emptyState, toast, field, input, switchField, segmented, confirmDialog, dataTable } from '../ui/components.js';
import { exportBackup, readBackupFile, exportTransactionsCsv, exportMonthlySummaryCsv, exportMonthPdf } from '../ui/exporters.js';

export default function renderSettings(ctx) {
  const state = ctx.store.state;
  const s = state.settings;

  const node = el('div', { class: 'col', style: { gap: '18px' } });

  /* ---------- תצוגה ---------- */
  node.append(sectionCard('תצוגה', {
    body: el('div', { class: 'col', style: { gap: '15px' } }, [
      field('ערכת נושא', segmented([
        { value: 'light', label: 'בהיר', icon: '☀️' },
        { value: 'dark', label: 'כהה', icon: '🌙' },
        { value: 'auto', label: 'לפי המערכת', icon: '🖥' },
      ], s.theme, (v) => {
        ctx.store.setSetting('theme', v);
        const t = v === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : v;
        document.documentElement.dataset.theme = t;
        ctx.refresh();
      })),
      field('מרחב ברירת מחדל בפתיחה', segmented([
        { value: 'personal', label: 'פרטי', icon: '🏠' },
        { value: 'business', label: 'עסקי', icon: '🏢' },
        { value: 'all', label: 'סיכום כולל', icon: '🌐' },
      ], s.lastSpace || 'personal', (v) => ctx.store.setSetting('lastSpace', v))),
      switchField('הצגת אגורות בסכומים', s.showCents, (v) => {
        ctx.store.setSetting('showCents', v);
        setMoneyPrecision(v);
        ctx.refresh();
      }),
    ]),
  }));

  /* ---------- ייבוא ופרטיות ---------- */
  node.append(sectionCard('ייבוא ופרטיות', {
    sub: 'המידע הפיננסי שלכם נשמר במכשיר הזה בלבד',
    body: el('div', { class: 'col', style: { gap: '15px' } }, [
      switchField('מחיקת הקובץ המקורי אחרי העיבוד', s.deleteSourceFileAfterImport,
        (v) => ctx.store.setSetting('deleteSourceFileAfterImport', v)),
      switchField('העתקה אוטומטית של הוצאות קבועות לחודש הבא', s.autoCopyFixed,
        (v) => ctx.store.setSetting('autoCopyFixed', v)),
      el('div', { class: 'card pad-sm', style: { background: 'var(--surface-2)' } }, [
        el('div', { class: 'bold small mb-3', text: 'מה נשמר ומה לא' }),
        el('ul', { class: 'col', style: { gap: '7px' } }, [
          privacyItem('✅', 'תנועות, קטגוריות, תקציבים והגדרות — נשמרים מקומית בדפדפן'),
          privacyItem('✅', '4 ספרות אחרונות של כרטיס בלבד, לזיהוי מקור התנועה'),
          privacyItem('✅', 'תיעוד מקור לכל תנועה: ידני, ייבוא, שכפול או תנועה חוזרת'),
          privacyItem('🚫', 'מספר חשבון או כרטיס מלא — לא נשמר כלל'),
          privacyItem('🚫', 'סיסמאות בנק או פרטי כניסה — לא נשמרים ולא נדרשים'),
          privacyItem('🚫', 'שליחת מסמכים לשירות חיצוני — הקבצים מעובדים בדפדפן בלבד'),
        ]),
      ]),
    ]),
  }));

  /* ---------- AI ---------- */
  node.append(sectionCard('סיוע AI (רשות)', {
    sub: 'לזיהוי בתי עסק וניסוח תובנות בלבד — לעולם לא לחישובים',
    body: el('div', { class: 'col', style: { gap: '13px' } }, [
      el('div', { class: 'card pad-sm', style: { background: 'var(--warn-soft)' } }, [
        el('div', { class: 'small', style: { lineHeight: '1.65' },
          text: 'כל סכום, יתרה, אחוז, ממוצע ותחזית מחושבים בקוד דטרמיניסטי בלבד. גם כאשר סיוע AI פעיל, הוא משמש אך ורק להצעת קטגוריה או לניסוח משפט — לעולם לא לחישוב כספי.' }),
      ]),
      switchField('הפעלת סיוע AI לזיהוי בתי עסק', s.aiEnabled, (v) => { ctx.store.setSetting('aiEnabled', v); ctx.refresh(); }),
      s.aiEnabled
        ? field('כתובת שירות ה-AI (Worker)', input({
            value: s.aiEndpoint || '', placeholder: 'https://…workers.dev',
            onchange: (e) => ctx.store.setSetting('aiEndpoint', e.target.value.trim()),
          }), { hint: 'הקריאות עוברות דרך Worker משלכם — מפתחות API לא נשמרים בצד הלקוח' })
        : null,
    ].filter(Boolean)),
  }));

  /* ---------- ייצוא וגיבוי ---------- */
  const restoreInput = el('input', {
    type: 'file', accept: '.json', style: { display: 'none' },
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = await readBackupFile(file);
        const ok = await confirmDialog({
          title: 'שחזור מגיבוי',
          message: `הגיבוי מכיל ${data.transactions.length} תנועות ו-${data.categories?.length || 0} קטגוריות. השחזור יחליף את כל הנתונים הקיימים. להמשיך?`,
          confirmText: 'שחזר', danger: true,
        });
        if (!ok) return;
        ctx.store.replaceState(data);
        ctx.refresh();
        toast(`שוחזרו ${data.transactions.length} תנועות`);
      } catch (err) {
        toast(err.message, { type: 'err' });
      }
      e.target.value = '';
    },
  });

  node.append(sectionCard('ייצוא וגיבוי', {
    body: el('div', { class: 'col', style: { gap: '13px' } }, [
      el('div', { class: 'row wrap', style: { gap: '8px' } }, [
        el('button', { class: 'btn', text: '⬇ ייצוא כל התנועות (Excel/CSV)',
          onclick: () => exportTransactionsCsv(state.transactions, state) }),
        el('button', { class: 'btn', text: '⬇ סיכום חודשי מרוכז',
          onclick: () => exportMonthlySummaryCsv(state, ctx.space) }),
        el('button', { class: 'btn', text: '🖨 דוח PDF לחודש הנוכחי',
          onclick: () => exportMonthPdf(state, ctx.month, ctx.space) }),
      ]),
      el('div', { class: 'row wrap', style: { gap: '8px' } }, [
        el('button', { class: 'btn primary', text: '💾 הורדת גיבוי מלא', onclick: () => exportBackup(state) }),
        el('button', { class: 'btn', text: '📤 שחזור מגיבוי', onclick: () => restoreInput.click() }),
        restoreInput,
      ]),
      el('div', { class: 'tiny muted-2', text: 'הגיבוי הוא קובץ JSON יחיד שמכיל את כל הנתונים. מומלץ לשמור עותק אחת לחודש.' }),
    ]),
  }));

  /* ---------- נתונים ---------- */
  const stats = [
    ['תנועות', state.transactions.length],
    ['קטגוריות', state.categories.length],
    ['חשבונות', state.accounts.length],
    ['תקציבים', state.budgets.length],
    ['חוקי סיווג', state.merchantRules.length],
    ['ייבואים', state.imports.length],
    ['חודשים עם נתונים', monthsWithData(state.transactions).length],
  ];

  node.append(sectionCard('נתונים', {
    body: el('div', { class: 'col', style: { gap: '14px' } }, [
      el('div', { class: 'row wrap', style: { gap: '8px' } },
        stats.map(([l, v]) => el('span', { class: 'chip', text: `${l}: ${v.toLocaleString('he-IL')}` }))),
      el('div', { class: 'row wrap', style: { gap: '8px' } }, [
        el('button', { class: 'btn sm', text: '🎬 טעינת נתוני הדגמה', onclick: () => loadDemo(ctx) }),
        el('button', { class: 'btn sm', text: '🧹 מחיקת כל התנועות', onclick: () => clearTransactions(ctx) }),
        el('button', { class: 'btn sm danger', text: '⚠ מחיקת כל הנתונים', onclick: () => wipeAll(ctx) }),
      ]),
    ]),
  }));

  /* ---------- יומן פעולות ---------- */
  const audit = (state.audit || []).slice(0, 40);
  node.append(sectionCard('יומן פעולות', {
    sub: 'תיעוד שינויים משמעותיים בנתונים',
    pad: false,
    body: audit.length
      ? dataTable([
          { label: 'מתי', width: '150px', render: (a) => el('span', { class: 'tiny muted num nowrap', text: fmtDateTime(a.ts) }) },
          { label: 'פעולה', width: '120px', render: (a) => el('span', { class: 'chip', text: actionLabel(a.action) }) },
          { label: 'ישות', width: '120px', render: (a) => el('span', { class: 'tiny muted', text: entityLabel(a.entity) }) },
          { label: 'פרטים', render: (a) => el('span', { class: 'small truncate', text: a.details }) },
        ], audit)
      : emptyState({ icon: '📜', text: 'אין עדיין פעולות מתועדות.' }),
  }));

  /* ---------- אודות ---------- */
  node.append(sectionCard('אודות', {
    body: el('div', { class: 'col', style: { gap: '8px' } }, [
      el('div', { class: 'small muted', text: 'אפליקציית ניהול הכנסות והוצאות — עסקי ופרטי.' }),
      el('div', { class: 'tiny muted-2', text: 'הנתונים נשמרים בדפדפן (localStorage). שכבת הנתונים בנויה כך שניתן להחליף אותה ל-Supabase/PostgreSQL בשינוי שורה אחת, ללא שינוי בשאר האפליקציה.' }),
      el('div', { class: 'tiny muted-2', text: 'קיצורי מקלדת: N — תנועה חדשה · ← → — מעבר בין חודשים · Ctrl+Z — ביטול פעולה אחרונה.' }),
    ]),
  }));

  return { node, topbar: { title: 'הגדרות', showMonth: false } };
}

function privacyItem(icon, text) {
  return el('li', { class: 'row', style: { gap: '8px', alignItems: 'flex-start' } }, [
    el('span', { text: icon }),
    el('span', { class: 'small muted', style: { lineHeight: '1.5' }, text }),
  ]);
}

function actionLabel(a) {
  return {
    create: 'יצירה', 'create-bulk': 'יצירה מרובה', update: 'עדכון', 'update-bulk': 'עדכון מרובה',
    delete: 'מחיקה', 'delete-bulk': 'מחיקה מרובה', undo: 'ביטול', import: 'ייבוא',
    seed: 'נתוני הדגמה', reorder: 'שינוי סדר',
  }[a] || a;
}

function entityLabel(e) {
  return {
    transactions: 'תנועות', categories: 'קטגוריות', accounts: 'חשבונות',
    budgets: 'תקציבים', merchantRules: 'חוקי סיווג', imports: 'ייבוא', system: 'מערכת',
  }[e] || e;
}

/* ============================================================
   פעולות על הנתונים
   ============================================================ */
async function loadDemo(ctx) {
  const ok = await confirmDialog({
    title: 'טעינת נתוני הדגמה',
    message: 'הפעולה תחליף את כל הנתונים הקיימים ב-8 חודשי נתוני הדגמה. מומלץ להוריד גיבוי קודם. להמשיך?',
    confirmText: 'טען הדגמה', danger: true,
  });
  if (!ok) return;
  ctx.store.replaceState(buildDemoState());
  ctx.refresh();
  toast('נתוני ההדגמה נטענו');
}

async function clearTransactions(ctx) {
  const n = ctx.store.state.transactions.length;
  const ok = await confirmDialog({
    title: 'מחיקת כל התנועות',
    message: `${n} תנועות יימחקו. הקטגוריות, החשבונות והתקציבים יישמרו. להמשיך?`,
    confirmText: 'מחק תנועות', danger: true,
  });
  if (!ok) return;
  ctx.store.removeMany('transactions', ctx.store.state.transactions.map((t) => t.id));
  ctx.refresh();
  toast(`${n} תנועות נמחקו`, { undo: () => { ctx.store.undo(); ctx.refresh(); } });
}

async function wipeAll(ctx) {
  const ok = await confirmDialog({
    title: 'מחיקת כל הנתונים',
    message: 'כל התנועות, הקטגוריות, החשבונות, התקציבים והחוקים יימחקו לצמיתות. פעולה זו אינה ניתנת לביטול. להמשיך?',
    confirmText: 'מחק הכול', danger: true,
  });
  if (!ok) return;
  const ok2 = await confirmDialog({
    title: 'אישור אחרון',
    message: 'האם להוריד גיבוי לפני המחיקה? לחיצה על "ביטול" תמחק ללא גיבוי.',
    confirmText: 'הורד גיבוי ומחק', cancelText: 'מחק ללא גיבוי',
  });
  if (ok2) exportBackup(ctx.store.state);
  await ctx.store.wipe();
  ctx.store.bulkInsert('categories', defaultCategories(), { audit: false });
  ctx.store.bulkInsert('accounts', defaultAccounts(), { audit: false });
  ctx.refresh();
  toast('כל הנתונים נמחקו. נטענו קטגוריות וחשבונות ברירת מחדל.');
}
