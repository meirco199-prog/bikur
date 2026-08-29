/* ============================================================
   import.js — מרכז הייבוא והסנכרון
   ------------------------------------------------------------
   העלאת קבצים → זיהוי → סיווג → מסך אישור → שמירה.
   שום תנועה לא נכנסת לנתונים בלי אישור מפורש.
   ============================================================ */

import { el, money, fmtDate, monthLabel, normalizeMerchant } from '../core/util.js';
import { processFile, commitRows } from '../importer/pipeline.js';
import { summarizeBatch } from '../importer/dedupe.js';
import { derivePattern } from '../importer/classify.js';
import { newMerchantRule, ACCOUNT_TYPES } from '../core/schema.js';
import {
  sectionCard, emptyState, toast, modal, field, select, input, switchField,
  segmented, confidenceBadge, catIcon, spaceChip, confirmDialog, categorySelect, dataTable,
} from '../ui/components.js';

/* מצב הייבוא הפעיל — נשמר בין רינדורים */
let staging = null;   // { batch, rows, summary, warnings, fileName }
let reviewFilter = 'all';

export default function renderImport(ctx) {
  const state = ctx.store.state;
  const node = el('div', { class: 'col', style: { gap: '18px' } });

  if (staging) {
    node.append(buildReviewScreen(ctx));
    return { node, topbar: { title: 'אישור ייבוא', sub: staging.fileName, showMonth: false, actions: [
      el('button', { class: 'btn sm ghost', text: '✕ ביטול הייבוא', onclick: () => cancelStaging(ctx) }),
    ] } };
  }

  node.append(buildUploader(ctx));
  node.append(buildSyncSection(ctx));
  node.append(buildRulesSection(ctx));
  node.append(buildHistorySection(ctx));

  return { node, topbar: { title: 'ייבוא וסנכרון', sub: `${state.imports.length} ייבואים בהיסטוריה`, showMonth: false } };
}

/* ============================================================
   1. אזור ההעלאה
   ============================================================ */
function buildUploader(ctx) {
  const state = ctx.store.state;
  let accountId = state.accounts.find((a) => a.type === 'checking' && a.space === (ctx.space === 'all' ? 'personal' : ctx.space))?.id
    || state.accounts[0]?.id || null;
  let sourceKind = 'bank';

  const fileInput = el('input', {
    type: 'file', accept: '.csv,.txt,.tsv,.xlsx,.xls,.xlsm,.pdf', multiple: true,
    style: { display: 'none' },
    onchange: (e) => handleFiles(ctx, [...e.target.files], { accountId, sourceKind }),
  });

  const dz = el('div', { class: 'dropzone', onclick: () => fileInput.click() }, [
    el('div', { class: 'dz-icon', text: '📄' }),
    el('div', { class: 'dz-title', text: 'גררו לכאן דוח בנק או פירוט אשראי' }),
    el('div', { class: 'dz-sub', text: 'או לחצו לבחירת קובץ · נתמכים CSV, Excel ו-PDF · הקובץ מעובד במכשיר שלכם בלבד' }),
  ]);

  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag');
    handleFiles(ctx, [...e.dataTransfer.files], { accountId, sourceKind });
  });

  const accSelect = select(
    state.accounts.filter((a) => !a.archived).map((a) => ({
      value: a.id,
      label: `${ACCOUNT_TYPES[a.type]?.icon || ''} ${a.name}${a.last4 ? ` ••${a.last4}` : ''} — ${a.space === 'business' ? 'עסקי' : 'פרטי'}`,
    })),
    { value: accountId, onchange: (e) => {
      accountId = e.target.value;
      const a = state.accounts.find((x) => x.id === accountId);
      sourceKind = a?.type === 'credit' ? 'credit' : a?.type === 'wallet' ? 'wallet' : 'bank';
      kindSeg.replaceChildren(buildKindSeg());
    } },
  );

  const buildKindSeg = () => segmented([
    { value: 'bank', label: 'דף עו״ש', icon: '🏦' },
    { value: 'credit', label: 'פירוט אשראי', icon: '💳' },
    { value: 'wallet', label: 'ארנק דיגיטלי', icon: '📱' },
  ], sourceKind, (v) => { sourceKind = v; });
  const kindSeg = el('div', {}, [buildKindSeg()]);

  return sectionCard('העלאת דוח', {
    sub: 'המערכת תזהה את העמודות, תסווג את התנועות ותציג מסך אישור לפני השמירה',
    body: el('div', { class: 'col', style: { gap: '14px' } }, [
      el('div', { class: 'form-grid' }, [
        field('לאיזה חשבון או כרטיס שייך הקובץ?', accSelect),
        field('סוג הדוח', kindSeg),
      ]),
      dz,
      fileInput,
      el('div', { class: 'tiny muted-2' }, [
        'טיפ: רוב הבנקים וחברות האשראי מאפשרים ייצוא ל-CSV או Excel — פורמטים אלה מזוהים בדיוק הגבוה ביותר. קבצי PDF נתמכים גם הם, אך מומלץ לעבור על התוצאות.',
      ]),
    ]),
  });
}

async function handleFiles(ctx, files, opts) {
  if (!files.length) return;
  const loading = toast(`מעבד ${files.length > 1 ? files.length + ' קבצים' : 'קובץ'}…`, { type: 'info', ms: 60000 });
  try {
    let allRows = [];
    let batch = null;
    const warnings = [];
    for (const file of files) {
      const res = await processFile(file, ctx.store.state, opts);
      if (!batch) batch = res.batch;
      else {
        batch.fileName += `, ${res.batch.fileName}`;
        batch.rowCount += res.batch.rowCount;
        if (res.batch.periodFrom && (!batch.periodFrom || res.batch.periodFrom < batch.periodFrom)) batch.periodFrom = res.batch.periodFrom;
        if (res.batch.periodTo && (!batch.periodTo || res.batch.periodTo > batch.periodTo)) batch.periodTo = res.batch.periodTo;
      }
      allRows = allRows.concat(res.rows);
      warnings.push(...res.warnings);
    }
    loading();
    if (!allRows.length) {
      toast('לא נמצאו תנועות בקובץ', { type: 'err' });
      return;
    }
    staging = {
      batch, rows: allRows, warnings,
      fileName: files.map((f) => f.name).join(', '),
      summary: summarizeBatch(allRows),
      sourceKind: opts.sourceKind,
      monthsOff: new Set(),
    };
    reviewFilter = 'all';
    ctx.refresh();
    toast(`נמצאו ${allRows.length} תנועות`, { type: 'ok' });
  } catch (err) {
    loading();
    console.error(err);
    toast(err.message || 'עיבוד הקובץ נכשל', { type: 'err', ms: 6000 });
  }
}

/* ============================================================
   2. מסך אישור הייבוא
   ============================================================ */
function buildReviewScreen(ctx) {
  const state = ctx.store.state;
  const s = summarizeBatch(staging.rows);
  staging.summary = s;

  const wrap = el('div', { class: 'col', style: { gap: '16px' } });

  /* --- כותרת וסיכום --- */
  wrap.append(el('div', { class: 'card' }, [
    el('div', { class: 'row-between wrap', style: { gap: '12px' } }, [
      el('div', {}, [
        el('h2', { text: `נמצאו ${staging.rows.length} תנועות` }),
        el('div', { class: 'card-sub', text: `${staging.fileName}${staging.batch.periodFrom ? ` · ${fmtDate(staging.batch.periodFrom)} – ${fmtDate(staging.batch.periodTo)}` : ''}` }),
      ]),
      el('div', { class: 'row wrap', style: { gap: '7px' } }, [
        el('span', { class: 'chip pos', text: `${s.ready} מוכנות` }),
        s.review ? el('span', { class: 'chip warn', text: `${s.review} דורשות בדיקה` }) : null,
        s.duplicates ? el('span', { class: 'chip neg', text: `${s.duplicates} כפילויות` }) : null,
        s.settlements ? el('span', { class: 'chip', text: `${s.settlements} חיובים מרוכזים` }) : null,
        s.transfers ? el('span', { class: 'chip', text: `${s.transfers} העברות פנימיות` }) : null,
        s.refunds ? el('span', { class: 'chip', text: `${s.refunds} זיכויים` }) : null,
        s.installments ? el('span', { class: 'chip', text: `${s.installments} תשלומים` }) : null,
      ]),
    ]),
    staging.warnings.length ? el('div', { class: 'mt-4' }, staging.warnings.map((w) =>
      el('div', { class: 'chip warn', style: { marginInlineEnd: '6px', whiteSpace: 'normal' }, text: `⚠ ${w}` }))) : null,
    el('div', { class: 'row wrap mt-4', style: { gap: '8px' } }, [
      el('span', { class: 'small muted grow' }, [
        `סה״כ לייבוא: `,
        el('b', { class: 'pos', text: money(s.income) }),
        ' הכנסות, ',
        el('b', { class: 'neg', text: money(s.expense) }),
        ' הוצאות',
      ]),
      el('button', { class: 'btn sm', text: '✓ סימון הכול', onclick: () => { staging.rows.forEach((r) => { if (!r.duplicate) r.selected = true; }); ctx.refresh(); } }),
      el('button', { class: 'btn sm ghost', text: '✕ ניקוי בחירה', onclick: () => { staging.rows.forEach((r) => { r.selected = false; }); ctx.refresh(); } }),
      s.review ? el('button', { class: 'btn sm', text: `❓ סיווג ${s.review} החריגים`, onclick: () => openLearningFlow(ctx) }) : null,
    ]),
  ]));

  /* --- בחירת חודשים לייבוא --- */
  wrap.append(buildMonthPicker(ctx));

  /* --- סינון תצוגה --- */
  const counts = {
    all: staging.rows.length,
    review: staging.rows.filter((r) => (r.needsReview || r.needsSpaceReview) && !r.duplicate).length,
    duplicates: staging.rows.filter((r) => r.duplicate).length,
    special: staging.rows.filter((r) => r.isSettlement || r.internalTransfer || r.isRefund || r.installment).length,
    ready: staging.rows.filter((r) => !r.duplicate && !r.needsReview && !r.needsSpaceReview).length,
  };
  wrap.append(el('div', { class: 'row wrap', style: { gap: '7px' } }, [
    filterChip('all', `הכול (${counts.all})`, ctx),
    counts.review ? filterChip('review', `דורשות בדיקה (${counts.review})`, ctx, 'warn') : null,
    counts.duplicates ? filterChip('duplicates', `כפילויות (${counts.duplicates})`, ctx, 'neg') : null,
    counts.special ? filterChip('special', `מיוחדות (${counts.special})`, ctx, 'info') : null,
    counts.ready ? filterChip('ready', `מוכנות (${counts.ready})`, ctx, 'pos') : null,
  ]));

  /* --- הטבלה: הפחות בטוחות ראשונות --- */
  let rows = staging.rows.slice();
  if (reviewFilter === 'review') rows = rows.filter((r) => (r.needsReview || r.needsSpaceReview) && !r.duplicate);
  else if (reviewFilter === 'duplicates') rows = rows.filter((r) => r.duplicate);
  else if (reviewFilter === 'special') rows = rows.filter((r) => r.isSettlement || r.internalTransfer || r.isRefund || r.installment);
  else if (reviewFilter === 'ready') rows = rows.filter((r) => !r.duplicate && !r.needsReview && !r.needsSpaceReview);

  rows.sort((a, b) => {
    const rank = (r) => (r.duplicate ? 1 : 0) + (r.needsReview || r.needsSpaceReview ? 0 : 2);
    return rank(a) - rank(b) || a.confidence - b.confidence || a.date.localeCompare(b.date);
  });

  wrap.append(sectionCard('', { pad: false, body: buildReviewTable(ctx, rows) }));

  /* --- פעולות סיום --- */
  const willImport = staging.rows.filter((r) => r.selected && (!r.duplicate || r.forceImport)).length;
  wrap.append(el('div', { class: 'card', style: { position: 'sticky', bottom: '12px', zIndex: 20 } }, [
    el('div', { class: 'row wrap', style: { gap: '10px' } }, [
      el('div', { class: 'grow' }, [
        el('div', { class: 'bold', text: `${willImport} תנועות ייווספו` }),
        el('div', { class: 'tiny muted-2', text: 'הקטגוריות שתשנו יילמדו ויחולו אוטומטית בייבוא הבא' }),
      ]),
      el('button', { class: 'btn ghost', text: 'ביטול', onclick: () => cancelStaging(ctx) }),
      el('button', { class: 'btn primary lg', text: `אישור וייבוא ${willImport} תנועות`, onclick: () => commitStaging(ctx), disabled: willImport === 0 }),
    ]),
  ]));

  return wrap;
}

/**
 * בורר חודשים — דוח בנק מכסה לא פעם חצי שנה, ולא תמיד רוצים לייבא הכול.
 * ביטול סימון של חודש מוריד את כל תנועותיו מהייבוא.
 */
function buildMonthPicker(ctx) {
  const counts = new Map();
  for (const r of staging.rows) {
    if (!counts.has(r.month)) counts.set(r.month, { total: 0, income: 0, expense: 0, duplicates: 0 });
    const c = counts.get(r.month);
    c.total++;
    if (r.duplicate) { c.duplicates++; continue; }
    if (r.internalTransfer || r.isSettlement) continue;
    if (r.direction === 'income') c.income += Math.abs(r.amount);
    else c.expense += Math.abs(r.amount);
  }
  const months = [...counts.keys()].sort();
  if (months.length < 2) return el('div');

  const setMonth = (m, on) => {
    if (on) staging.monthsOff.delete(m); else staging.monthsOff.add(m);
    for (const r of staging.rows) {
      if (r.month !== m) continue;
      r.selected = on && !r.duplicate;
    }
    ctx.refresh();
  };

  return el('div', { class: 'card pad-sm' }, [
    el('div', { class: 'row wrap', style: { gap: '10px', marginBottom: '10px' } }, [
      el('div', { class: 'grow' }, [
        el('div', { class: 'bold small', text: `הדוח מכסה ${months.length} חודשים` }),
        el('div', { class: 'tiny muted-2', text: 'בחרו אילו חודשים לייבא. כל תנועה נשמרת לחודש שלה בנפרד.' }),
      ]),
      el('button', { class: 'btn xs', text: 'סמן הכול',
        onclick: () => { months.forEach((m) => staging.monthsOff.delete(m)); staging.rows.forEach((r) => { r.selected = !r.duplicate; }); ctx.refresh(); } }),
      el('button', { class: 'btn xs', text: 'רק החודשיים האחרונים',
        onclick: () => {
          const keep = new Set(months.slice(-2));
          months.forEach((m) => (keep.has(m) ? staging.monthsOff.delete(m) : staging.monthsOff.add(m)));
          staging.rows.forEach((r) => { r.selected = keep.has(r.month) && !r.duplicate; });
          ctx.refresh();
        } }),
    ]),
    el('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '8px' } },
      months.map((m) => {
        const c = counts.get(m);
        const on = !staging.monthsOff.has(m);
        const cb = el('input', { type: 'checkbox', onchange: (e) => setMonth(m, e.target.checked) });
        cb.checked = on;
        return el('label', {
          class: 'card pad-sm',
          style: {
            cursor: 'pointer', margin: 0,
            borderColor: on ? 'var(--brand-500)' : 'var(--line)',
            opacity: on ? 1 : 0.55,
          },
        }, [
          el('div', { class: 'row', style: { gap: '8px' } }, [
            cb,
            el('div', { class: 'grow', style: { minWidth: 0 } }, [
              el('div', { class: 'small bold', text: monthLabel(m) }),
              el('div', { class: 'tiny muted-2', text: c.duplicates ? `${c.total} תנועות · ${c.duplicates} כפילויות` : `${c.total} תנועות` }),
            ]),
          ]),
          el('div', { class: 'row', style: { gap: '6px', marginTop: '7px' } }, [
            el('span', { class: 'tiny pos num', text: `+${money(c.income)}` }),
            el('span', { class: 'tiny neg num', text: `−${money(c.expense)}` }),
          ]),
        ]);
      })),
  ]);
}

function filterChip(id, label, ctx, tone = '') {
  return el('button', {
    class: `chip clickable ${reviewFilter === id ? 'brand' : tone}`,
    style: reviewFilter === id ? { outline: '2px solid var(--brand-500)' } : null,
    onclick: () => { reviewFilter = id; ctx.refresh(); },
    text: label,
  });
}

function buildReviewTable(ctx, rows) {
  const state = ctx.store.state;
  if (!rows.length) return emptyState({ icon: '✅', text: 'אין תנועות בקטגוריה הזו.' });

  const columns = [
    { label: '', width: '34px', render: (r) => {
      const c = el('input', { type: 'checkbox', onchange: (e) => {
        r.selected = e.target.checked;
        if (r.duplicate && e.target.checked) r.forceImport = true;
        ctx.refresh();
      } });
      c.checked = !!r.selected;
      return c;
    } },
    { label: 'תאריך', width: '92px', render: (r) => el('div', {}, [
      el('div', { class: 'num small nowrap', text: fmtDate(r.date) }),
      r.billingDate && r.billingDate !== r.date ? el('div', { class: 'tiny muted-2 nowrap', text: `חיוב ${fmtDate(r.billingDate)}` }) : null,
    ]) },
    { label: 'בית עסק', render: (r) => el('div', { style: { minWidth: 0 } }, [
      el('div', { class: 'small bold truncate', text: r.merchant || '—' }),
      el('div', { class: 'tiny muted-2 truncate', title: r.reason }, [
        r.reason,
        r.installment ? el('span', { class: 'chip', style: { marginInlineStart: '5px' }, text: `תשלום ${r.installment.current}/${r.installment.total}` }) : null,
        r.cardLast4 ? el('span', { class: 'chip', style: { marginInlineStart: '5px' }, text: `••${r.cardLast4}` }) : null,
      ]),
      r.duplicate ? el('div', { class: 'chip neg', style: { marginTop: '4px', whiteSpace: 'normal' }, text: `⚠ ${r.duplicate.label}: ${r.duplicate.reason}` }) : null,
    ]) },
    { label: 'סכום', align: 'end', width: '104px', render: (r) => el('span', {
      class: 'bold num nowrap',
      style: { color: r.isSettlement || r.internalTransfer ? 'var(--text-3)' : r.direction === 'income' ? 'var(--pos)' : 'var(--neg)' },
      text: money(r.amount),
    }) },
    { label: 'סוג', width: '96px', render: (r) => {
      const seg = el('select', { class: 'select', style: { padding: '4px 7px', fontSize: '12.5px' },
        onchange: (e) => { r.direction = e.target.value; r.userDecided = true; ctx.refresh(); } });
      [['expense', 'הוצאה'], ['income', 'הכנסה']].forEach(([v, l]) => {
        const o = el('option', { value: v, text: l });
        if (r.direction === v) o.selected = true;
        seg.append(o);
      });
      return el('div', { class: 'col', style: { gap: '3px' } }, [
        seg,
        r.isSettlement ? el('span', { class: 'chip', title: 'חיוב אשראי מרוכז — ייספר כהוצאה כל עוד לא יובא פירוט העסקאות של הכרטיס, וייעלם מעצמו כשיובא', text: '🧾 מרוכז' })
          : r.internalTransfer ? el('span', { class: 'chip', title: 'לא ייספר בחישובים', text: '↔ העברה' })
          : r.isRefund ? el('span', { class: 'chip pos', text: '↩ זיכוי' }) : null,
      ]);
    } },
    { label: 'קטגוריה מוצעת', width: '184px', render: (r) => categorySelect(state.categories, {
      value: r.categoryId || '',
      space: r.space,
      kind: r.direction === 'income' ? 'income' : 'expense',
      placeholder: 'בחר קטגוריה',
      style: 'padding:5px 8px;font-size:13px',
      onchange: (e) => {
        r.categoryId = e.target.value;
        r.userDecided = true;
        r.needsReview = false;
        r.confidence = 100;
        ctx.refresh();
      },
    }) },
    { label: 'עסקי / פרטי', width: '118px', render: (r) => {
      const sel = select([{ value: 'personal', label: '🏠 פרטי' }, { value: 'business', label: '🏢 עסקי' }], {
        value: r.space, style: 'padding:5px 8px;font-size:13px',
        onchange: (e) => {
          r.space = e.target.value;
          r.userDecided = true;
          r.needsSpaceReview = false;
          const cat = state.categories.find((c) => c.id === r.categoryId);
          if (!cat || cat.space !== r.space) {
            const kind = r.direction === 'income' ? 'income' : 'expense';
            const match = state.categories.find((c) => c.space === r.space && c.kind === kind && c.name === cat?.name)
              || state.categories.find((c) => c.space === r.space && c.kind === kind && ['אחר', 'הוצאות אחרות', 'הכנסות אחרות'].includes(c.name));
            r.categoryId = match?.id || null;
          }
          ctx.refresh();
        },
      });
      return el('div', { class: 'col', style: { gap: '3px' } }, [
        sel,
        r.needsSpaceReview ? el('span', { class: 'chip warn', text: 'דרוש אישור' }) : null,
      ]);
    } },
    { label: 'ביטחון', width: '96px', render: (r) => confidenceBadge(r.confidence) },
    { label: 'סטטוס', width: '104px', render: (r) => {
      if (r.duplicate) {
        return el('div', { class: 'col', style: { gap: '3px' } }, [
          el('span', { class: 'chip neg', text: r.forceImport ? 'ייובא בכל זאת' : 'ידולג' }),
          el('button', { class: 'btn xs ghost', text: r.forceImport ? 'דלג' : 'ייבא בכל זאת',
            onclick: () => { r.forceImport = !r.forceImport; r.selected = r.forceImport; ctx.refresh(); } }),
        ]);
      }
      if (!r.selected) return el('span', { class: 'chip', text: 'לא נבחר' });
      if (r.needsReview || r.needsSpaceReview) return el('span', { class: 'chip warn', text: 'לבדיקה' });
      return el('span', { class: 'chip pos', text: 'מוכן' });
    } },
    { label: '', width: '38px', render: (r) => el('button', {
      class: 'btn xs ghost', title: 'הסרת השורה', text: '🗑',
      onclick: () => {
        staging.rows = staging.rows.filter((x) => x.key !== r.key);
        ctx.refresh();
      },
    }) },
  ];

  return dataTable(columns, rows, { rowClass: (r) => (r.duplicate && !r.forceImport ? '' : r.selected ? 'selected' : '') });
}

/* ============================================================
   3. זרימת הלמידה — שאלות על בתי עסק לא מזוהים
   ============================================================ */
function openLearningFlow(ctx) {
  const state = ctx.store.state;
  const unknown = staging.rows.filter((r) => (r.needsReview || r.needsSpaceReview) && !r.duplicate);
  if (!unknown.length) { toast('אין תנועות שדורשות סיווג'); return; }

  // קיבוץ לפי בית עסק — שאלה אחת לכל בית עסק
  const groups = new Map();
  for (const r of unknown) {
    const key = normalizeMerchant(r.merchant) || r.key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const list = [...groups.entries()];
  let idx = 0;

  const body = el('div');
  const m = modal({
    title: 'סיווג בתי עסק',
    subtitle: `${list.length} בתי עסק לא זוהו — ההחלטות יילמדו לפעם הבאה`,
    body, size: 'narrow',
    footer: [],
  });

  const renderQuestion = () => {
    if (idx >= list.length) {
      m.close();
      toast('הסיווג הושלם');
      ctx.refresh();
      return;
    }
    const [, rows] = list[idx];
    const sample = rows[0];
    let chosenCat = sample.categoryId;
    let chosenSpace = sample.space;
    let learn = true;

    const catWrap = el('div');
    const rebuildCat = () => catWrap.replaceChildren(categorySelect(state.categories, {
      value: chosenCat || '', space: chosenSpace,
      kind: sample.direction === 'income' ? 'income' : 'expense',
      placeholder: 'בחר קטגוריה',
      onchange: (e) => { chosenCat = e.target.value; },
    }));
    rebuildCat();

    body.replaceChildren(el('div', { class: 'col', style: { gap: '14px' } }, [
      el('div', { class: 'row-between' }, [
        el('span', { class: 'tiny muted-2', text: `שאלה ${idx + 1} מתוך ${list.length}` }),
        el('span', { class: 'tiny muted-2', text: `${rows.length} תנועות` }),
      ]),
      el('div', { class: 'card pad-sm', style: { background: 'var(--surface-2)' } }, [
        el('div', { class: 'bold', style: { fontSize: '17px' }, text: sample.merchant || 'ללא שם' }),
        el('div', { class: 'tiny muted-2', text: `${fmtDate(sample.date)} · ${money(sample.amount)}${rows.length > 1 ? ` · סה״כ ${money(rows.reduce((s, r) => s + r.amount, 0))}` : ''}` }),
      ]),
      el('div', { class: 'bold small', text: 'לאיזו קטגוריה לשייך?' }),
      field('עסקי או פרטי', segmented([
        { value: 'personal', label: 'פרטי', icon: '🏠' },
        { value: 'business', label: 'עסקי', icon: '🏢' },
      ], chosenSpace, (v) => { chosenSpace = v; chosenCat = null; rebuildCat(); })),
      field('קטגוריה', catWrap),
      switchField(`זכור: "${derivePattern(sample.merchant)}" → הקטגוריה הזו`, learn, (v) => { learn = v; }),
      el('div', { class: 'row', style: { gap: '8px', marginTop: '6px' } }, [
        el('button', { class: 'btn ghost grow', text: 'דלג', onclick: () => { idx++; renderQuestion(); } }),
        el('button', { class: 'btn primary grow', text: 'שמור והמשך', onclick: () => {
          if (!chosenCat) { toast('יש לבחור קטגוריה', { type: 'err' }); return; }
          for (const r of rows) {
            r.categoryId = chosenCat;
            r.space = chosenSpace;
            r.confidence = 100;
            r.needsReview = false;
            r.needsSpaceReview = false;
            r.userDecided = learn;
            r.selected = true;
          }
          idx++;
          renderQuestion();
        } }),
      ]),
    ]));
  };
  renderQuestion();
}

/* ============================================================
   4. שמירה וביטול
   ============================================================ */
function commitStaging(ctx) {
  const { transactions, rules, batch } = commitRows(staging.rows, staging.batch, ctx.store.state);
  if (!transactions.length) { toast('לא נבחרו תנועות לייבוא', { type: 'err' }); return; }

  ctx.store.batch(() => {
    ctx.store.bulkInsert('transactions', transactions);
    if (rules.length) ctx.store.bulkInsert('merchantRules', rules, { audit: false });
    ctx.store.insert('imports', { ...batch, sourceKept: !ctx.store.setting('deleteSourceFileAfterImport', true) }, { audit: false });
  });
  ctx.store.log('import', 'transactions', batch.id, `${transactions.length} תנועות מ-${batch.fileName}`);

  const count = transactions.length;
  const learned = rules.length;
  const ids = transactions.map((t) => t.id);
  staging = null;
  ctx.refresh();
  toast(`${count} תנועות יובאו${learned ? ` · ${learned} חוקי סיווג חדשים נלמדו` : ''}`, {
    ms: 6000,
    undo: () => { ctx.store.removeMany('transactions', ids, { undoable: false }); ctx.refresh(); },
  });
}

async function cancelStaging(ctx) {
  const ok = await confirmDialog({
    title: 'ביטול הייבוא',
    message: 'התנועות שזוהו יימחקו ולא יישמרו. להמשיך?',
    confirmText: 'בטל ייבוא', danger: true,
  });
  if (!ok) return;
  staging = null;
  ctx.refresh();
}

/* ============================================================
   5. סנכרון אוטומטי — מה אפשר בפועל
   ------------------------------------------------------------
   אין כאן סנכרון אוטומטי, ואין טעם להעמיד פנים שיש.
   המסך מסביר למה, ומראה את הדרך שכן עובדת.
   ============================================================ */
function buildSyncSection(ctx) {
  return sectionCard('סנכרון אוטומטי — המצב לאשורו', {
    sub: 'מה אפשר היום, ומה לא',
    body: el('div', { class: 'col', style: { gap: '14px' } }, [
      el('div', { class: 'card pad-sm', style: { borderInlineStart: '3px solid var(--warn)' } }, [
        el('div', { class: 'bold small', style: { marginBottom: '6px' }, text: 'האפליקציה אינה מושכת תנועות אוטומטית' }),
        el('div', { class: 'small muted', style: { lineHeight: '1.7' } }, [
          'משיכה אוטומטית דורשת ממשק (API) רשמי של הבנק, חברת האשראי או הארנק, עם הרשאה שאתם מאשרים. ',
          'נכון להיום אין ממשק כזה שפתוח למשתמש פרטי בישראל. ',
          'שתי הדרכים לעקוף את זה — גרידת מסכים או מסירת סיסמת הבנק לשירות חיצוני — ',
          'לא מיושמות כאן, וזו החלטה מכוונת: הן מסכנות את החשבונות שלכם ומפרות את תנאי השימוש של הספקים.',
        ]),
      ]),

      el('div', { class: 'bold small', text: 'הדרך שעובדת: ייצוא קובץ פעם בחודש' }),
      el('div', { class: 'grid g-2' }, [
        sourceCard('🏦', 'עובר ושב', 'באזור האישי של הבנק: תנועות בחשבון ← ייצוא / הורדה ← Excel או CSV. זהו הפורמט המדויק ביותר, כולל אסמכתאות.'),
        sourceCard('💳', 'כרטיס אשראי', 'באתר חברת האשראי: פירוט עסקאות ← ייצוא. הקובץ כולל תשלומים, זיכויים ו-4 ספרות הכרטיס — כולם מזוהים אוטומטית.'),
        sourceCard('📱', 'ארנק דיגיטלי', 'אם לארנק יש ייצוא היסטוריה — העלו אותו. אם אין, אין צורך: התשלומים מהארנק מחויבים בכרטיס או בעו״ש שמאחוריו, ולכן ממילא מופיעים באותם דוחות.'),
        sourceCard('🔐', 'פרטיות', 'הקבצים מעובדים בדפדפן שלכם ולא נשלחים לשום שרת. נשמרות 4 ספרות אחרונות בלבד, והקובץ המקורי נמחק אחרי העיבוד.'),
      ]),

      el('div', { class: 'card pad-sm', style: { background: 'var(--surface-2)' } }, [
        el('div', { class: 'bold small', style: { marginBottom: '6px' }, text: 'מה כן קורה אוטומטית' }),
        el('div', { class: 'small muted', style: { lineHeight: '1.7' } }, [
          'אחרי ההעלאה הכול אוטומטי: זיהוי העמודות, סיווג לקטגוריות, למידה מההחלטות שלכם, ',
          'זיהוי כפילויות, סינון חיובי אשראי מרוכזים והעברות פנימיות, וזיהוי תשלומים וזיכויים. ',
          'העבודה הידנית מסתכמת בהעלאת הקובץ ובמעבר על החריגים בלבד.',
        ]),
      ]),

      el('div', { class: 'row wrap', style: { gap: '8px' } }, [
        el('button', { class: 'btn sm primary', text: '⬆ העלאת דוח עכשיו',
          onclick: () => document.querySelector('.dropzone')?.click() }),
        el('button', { class: 'btn sm', text: '🔐 הגדרות פרטיות', onclick: () => ctx.go('settings') }),
      ]),
    ]),
  });
}

function sourceCard(icon, title, text) {
  return el('div', { class: 'card pad-sm' }, [
    el('div', { class: 'row', style: { gap: '10px', marginBottom: '7px' } }, [
      el('span', { style: { fontSize: '20px' }, text: icon }),
      el('span', { class: 'bold small', text: title }),
    ]),
    el('div', { class: 'tiny muted', style: { lineHeight: '1.65' }, text }),
  ]);
}

/* ============================================================
   6. חוקי סיווג
   ============================================================ */
function buildRulesSection(ctx) {
  const state = ctx.store.state;
  const rules = state.merchantRules.slice().sort((a, b) => b.priority - a.priority || b.hits - a.hits);

  return sectionCard('חוקי סיווג בתי עסק', {
    sub: `${rules.length} חוקים · נלמדים אוטומטית מההחלטות שלכם וניתנים לעריכה`,
    actions: [el('button', { class: 'btn sm', text: '＋ חוק חדש', onclick: () => openRuleForm(ctx, null) })],
    pad: false,
    body: rules.length
      ? dataTable([
          { label: 'דפוס', render: (r) => el('div', {}, [
            el('div', { class: 'small bold', text: r.pattern }),
            el('div', { class: 'tiny muted-2', text: { contains: 'מכיל', exact: 'התאמה מדויקת', regex: 'ביטוי רגולרי' }[r.matchType] }),
          ]) },
          { label: 'קטגוריה', render: (r) => {
            const c = state.categories.find((x) => x.id === r.categoryId);
            return el('div', { class: 'row', style: { gap: '7px' } }, [catIcon(c, 'sm'), el('span', { class: 'small', text: c?.name || '—' })]);
          } },
          { label: 'מרחב', width: '90px', render: (r) => (r.space ? spaceChip(r.space) : el('span', { class: 'tiny muted-2', text: 'לא נקבע' })) },
          { label: 'שימושים', align: 'end', width: '80px', render: (r) => el('span', { class: 'num small', text: r.hits || 0 }) },
          { label: 'מקור', width: '90px', render: (r) => el('span', { class: `chip ${r.learned ? 'pos' : ''}`, text: r.learned ? 'נלמד' : 'ידני' }) },
          { label: '', width: '76px', render: (r) => el('div', { class: 'row', style: { gap: '3px' } }, [
            el('button', { class: 'btn xs ghost', text: '✎', onclick: (e) => { e.stopPropagation(); openRuleForm(ctx, r); } }),
            el('button', { class: 'btn xs ghost', text: '🗑', onclick: (e) => {
              e.stopPropagation();
              ctx.store.remove('merchantRules', r.id);
              toast('החוק נמחק', { undo: () => { ctx.store.undo(); ctx.refresh(); } });
              ctx.refresh();
            } }),
          ]) },
        ], rules, { onRowClick: (r) => openRuleForm(ctx, r) })
      : emptyState({ icon: '🧠', title: 'עדיין לא נלמדו חוקים', text: 'בכל פעם שתסווגו בית עסק לא מזוהה בייבוא, הבחירה תישמר כאן ותחול אוטומטית בפעם הבאה.' }),
  });
}

function openRuleForm(ctx, rule) {
  const state = ctx.store.state;
  const isEdit = !!rule;
  const draft = rule ? { ...rule } : newMerchantRule({ space: ctx.space === 'all' ? 'personal' : ctx.space });

  const patternInput = input({ value: draft.pattern, placeholder: 'לדוגמה: מחסני השוק' });
  const catWrap = el('div');
  const rebuild = () => catWrap.replaceChildren(categorySelect(state.categories, {
    value: draft.categoryId || '', space: draft.space,
    kind: draft.direction === 'income' ? 'income' : 'expense',
    placeholder: 'בחר קטגוריה',
    onchange: (e) => { draft.categoryId = e.target.value; },
  }));
  rebuild();

  const m = modal({
    title: isEdit ? 'עריכת חוק סיווג' : 'חוק סיווג חדש',
    size: 'narrow',
    body: el('div', { class: 'col', style: { gap: '14px' } }, [
      field('דפוס לזיהוי בשם בית העסק', patternInput, { hint: 'ההשוואה מתעלמת מאותיות גדולות/קטנות וממספרי סניף' }),
      field('סוג התאמה', segmented([
        { value: 'contains', label: 'מכיל' },
        { value: 'exact', label: 'מדויק' },
        { value: 'regex', label: 'ביטוי רגולרי' },
      ], draft.matchType, (v) => { draft.matchType = v; })),
      field('מרחב', segmented([
        { value: 'personal', label: 'פרטי', icon: '🏠' },
        { value: 'business', label: 'עסקי', icon: '🏢' },
      ], draft.space || 'personal', (v) => { draft.space = v; draft.categoryId = null; rebuild(); })),
      field('כיוון', segmented([
        { value: 'expense', label: 'הוצאה' },
        { value: 'income', label: 'הכנסה' },
      ], draft.direction || 'expense', (v) => { draft.direction = v; draft.categoryId = null; rebuild(); })),
      field('קטגוריה', catWrap),
    ]),
    footer: [
      isEdit ? el('button', { class: 'btn danger', text: 'מחיקה', onclick: () => {
        ctx.store.remove('merchantRules', rule.id); m.close(); ctx.refresh(); toast('החוק נמחק');
      } }) : null,
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn ghost', text: 'ביטול', onclick: () => m.close() }),
      el('button', { class: 'btn primary', text: 'שמירה', onclick: () => {
        if (!patternInput.value.trim()) { toast('יש להזין דפוס', { type: 'err' }); return; }
        if (!draft.categoryId) { toast('יש לבחור קטגוריה', { type: 'err' }); return; }
        if (draft.matchType === 'regex') {
          try { new RegExp(patternInput.value); }
          catch { toast('הביטוי הרגולרי אינו תקין', { type: 'err' }); return; }
        }
        const patch = { ...draft, pattern: patternInput.value.trim(), direction: draft.direction || null };
        if (isEdit) ctx.store.update('merchantRules', rule.id, patch);
        else ctx.store.insert('merchantRules', patch);
        m.close(); ctx.refresh(); toast('החוק נשמר');
      } }),
    ].filter(Boolean),
  });
}

/* ============================================================
   7. היסטוריית ייבוא
   ============================================================ */
function buildHistorySection(ctx) {
  const state = ctx.store.state;
  const imports = state.imports.slice().sort((a, b) => b.importedAt - a.importedAt);
  const accOf = (id) => state.accounts.find((a) => a.id === id);

  return sectionCard('היסטוריית ייבוא', {
    sub: 'כל קובץ שיובא, מקורו, התקופה והתוצאות',
    pad: false,
    body: imports.length
      ? dataTable([
          { label: 'קובץ', render: (b) => el('div', {}, [
            el('div', { class: 'small bold truncate', text: b.fileName }),
            el('div', { class: 'tiny muted-2', text: `${(b.fileType || '').toUpperCase()} · ${b.source === 'file' ? 'העלאת קובץ' : 'סנכרון'}` }),
          ]) },
          { label: 'חשבון', width: '150px', render: (b) => {
            const a = accOf(b.accountId);
            return el('div', {}, [
              el('div', { class: 'small truncate', text: a?.name || '—' }),
              a?.last4 ? el('div', { class: 'tiny muted-2', text: `••${a.last4}` }) : null,
            ]);
          } },
          { label: 'תקופה', width: '150px', render: (b) => el('span', { class: 'tiny muted num nowrap',
            text: b.periodFrom ? `${fmtDate(b.periodFrom)} – ${fmtDate(b.periodTo)}` : '—' }) },
          { label: 'ייבוא', width: '128px', render: (b) => el('span', { class: 'tiny muted num nowrap', text: new Date(b.importedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) }) },
          { label: 'שורות', align: 'end', width: '64px', render: (b) => el('span', { class: 'num small', text: b.rowCount }) },
          { label: 'אושרו', align: 'end', width: '64px', render: (b) => el('span', { class: 'num small pos', text: b.approvedCount }) },
          { label: 'לבדיקה', align: 'end', width: '70px', render: (b) => el('span', { class: 'num small', style: { color: b.reviewCount ? 'var(--warn)' : 'var(--text-3)' }, text: b.reviewCount || '—' }) },
          { label: 'כפילויות', align: 'end', width: '76px', render: (b) => el('span', { class: 'num small', style: { color: b.duplicateCount ? 'var(--neg)' : 'var(--text-3)' }, text: b.duplicateCount || '—' }) },
          { label: 'סטטוס', width: '96px', render: (b) => el('div', { class: 'col', style: { gap: '3px' } }, [
            el('span', { class: `chip ${b.status === 'done' ? 'pos' : 'warn'}`, text: b.status === 'done' ? 'הושלם' : 'בבדיקה' }),
            el('span', { class: 'tiny muted-2', title: 'הקובץ המקורי', text: b.sourceKept ? 'הקובץ נשמר' : 'הקובץ נמחק' }),
          ]) },
          { label: '', width: '38px', render: (b) => el('button', { class: 'btn xs ghost', title: 'מחיקת הייבוא ותנועותיו', text: '🗑',
            onclick: (e) => { e.stopPropagation(); undoImport(ctx, b); } }) },
        ], imports)
      : emptyState({ icon: '📥', title: 'עדיין לא בוצע ייבוא', text: 'העלו דוח עו״ש או פירוט אשראי כדי להתחיל.' }),
  });
}

async function undoImport(ctx, batch) {
  const ids = ctx.store.state.transactions.filter((t) => t.importId === batch.id).map((t) => t.id);
  const ok = await confirmDialog({
    title: 'ביטול ייבוא',
    message: ids.length
      ? `הפעולה תמחק ${ids.length} תנועות שיובאו מהקובץ "${batch.fileName}". להמשיך?`
      : `למחוק את רשומת הייבוא "${batch.fileName}"? לא נמצאו תנועות משויכות.`,
    confirmText: 'מחק', danger: true,
  });
  if (!ok) return;
  if (ids.length) ctx.store.removeMany('transactions', ids);
  ctx.store.remove('imports', batch.id, { undoable: false });
  toast(`הייבוא בוטל${ids.length ? ` · ${ids.length} תנועות הוסרו` : ''}`, {
    undo: ids.length ? () => { ctx.store.undo(); ctx.refresh(); } : null,
  });
  ctx.refresh();
}
