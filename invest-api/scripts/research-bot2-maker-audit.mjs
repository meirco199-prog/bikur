#!/usr/bin/env node
// ביקורת לפני סגירת המחקר (בקשת מאיר, 20/11/2026) — אותם כללים ואותו קוד בדיוק (research-bot2-maker.mjs), בלי שינוי בגרסאות.
// בודק: (1) למה +58$ "על אותם אותות" מול 147−106=41$; (2) השוואה ברמת אות, כולל אותות שלא התמלאו = 0; (3) עסקאות ורווח כולל לפני/אחרי עלויות;
// (4) מבט לעתיד ומחירי מילוי ממתינים: כניסה כשהמחיר כבר עבר את הפקודה בפתיחה (הייתה מתבצעת מיד כפקודת שוק), ויעד שמולא בפתיחה טובה מהיעד.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOT2, signal } from '../engine/amit2-exec.js';
import { bars15 } from './research-amit2-be.mjs';
import { VARIANTS, COSTS, Q, runB2, pnlOf } from './research-bot2-maker.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUTDIR = arg('--outdir', 'invest/docs/research/bot2-maker');
const C = COSTS.actual, Z = COSTS.zero, key = (x) => `${x.t}|${x.side}`;
const f$ = (x) => (!Number.isFinite(x) ? '—' : (x < 0 ? '‎−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US'));
const ft = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
const sum = (a) => a.reduce((s, x) => s + x, 0);
const tstat = (d) => { const n = d.length, m = sum(d) / n, sd = Math.sqrt(sum(d.map((x) => (x - m) ** 2)) / (n - 1)); return { n, m, t: m / (sd / Math.sqrt(n)) }; };

const { loadCoin } = await import('./research-amit-course.mjs');
const d = await loadCoin('ETH'), m1 = d.m1, b15 = bars15(m1), q = Q / 100;
const res = new Map(VARIANTS.map((v) => [v.k, runB2(m1, b15, v)]));
const base = res.get('base').trades, baseBy = new Map(base.map((x) => [key(x), x]));
const md = ['# ביקורת לפני סגירה — בוט 2 יעד/כניסה ממתינים', '', 'אותו קוד ואותן גרסאות כמו `report.md` (הרצה חוזרת זהה — רק חישובי בקרה נוספים).', ''];

// (3) עסקאות ורווח כולל
md.push('## 1. עסקאות בפועל ורווח כולל, 2020 → 10/2026', '', '| גרסה | אותות שנבדקו | עסקאות | סה״כ לפני עלויות | עמלות + החלקה | סה״כ אחרי עלויות | לעסקה אחרי עלויות |', '|---|---|---|---|---|---|---|');
for (const v of VARIANTS){
  const r = res.get(v.k), net = sum(r.trades.map((x) => pnlOf(x, C))), gross = sum(r.trades.map((x) => pnlOf(x, Z, 0)));
  md.push(`| ${v.he} | ${r.signals} | ${r.trades.length} | ${f$(gross)} | ${f$(net - gross)} | ${f$(net)} | ${f$(net / r.trades.length)} |`);
}

// (1)+(2) ברמת אות: איחוד האותות של base ושל הגרסה; אות בלי עסקה = 0
md.push('', '## 2. השוואה ברמת אות — כולל אותות שלא התמלאו (רווח 0 כשאין עסקה)', '',
  '"על אותם אותות" (הטבלה ב-`report.md`) משווה רק אותות שנסחרו בשתי הגרסאות. כאן — כל אות שנסחר באחת מהן; אות שלא נסחר = 0$.', '',
  '| גרסה | אותות באיחוד | רק ב"היום" | רק בגרסה | הפרש ממוצע לאות (כולל 0) | t | הפרש כולל | הפרש על משותפים בלבד |', '|---|---|---|---|---|---|---|---|');
for (const v of VARIANTS.filter((x) => x.k !== 'base')){
  const tr = res.get(v.k).trades, by = new Map(tr.map((x) => [key(x), x])), keys = new Set([...baseBy.keys(), ...by.keys()]);
  const diffs = [], common = []; let onlyBase = 0, onlyVar = 0;
  for (const k of keys){
    const a = by.get(k), b = baseBy.get(k), pa = a ? pnlOf(a, C) : 0, pb = b ? pnlOf(b, C) : 0;
    diffs.push(pa - pb); if (a && b) common.push(pa - pb); else if (b) onlyBase++; else onlyVar++;
  }
  const s = tstat(diffs), c = tstat(common);
  md.push(`| ${v.he} | ${keys.size} | ${onlyBase} | ${onlyVar} | ${f$(s.m)} | ${ft(s.t)} | ${f$(sum(diffs))} | ${f$(c.m)} (${c.n}) |`);
}
{ // פירוק ה-58 מול 41 לגרסה הנבחרת
  const v = VARIANTS.find((x) => x.k === 'em5-tpm'), tr = res.get(v.k).trades, by = new Map(tr.map((x) => [key(x), x]));
  const com = tr.filter((x) => baseBy.has(key(x))), baseCom = com.map((x) => baseBy.get(key(x))), baseMiss = base.filter((x) => !by.has(key(x))), varOnly = tr.filter((x) => !baseBy.has(key(x)));
  const mean = (a) => sum(a.map((x) => pnlOf(x, C))) / a.length;
  md.push('', '### למה +58$ ולא 41$ (כניסה ממתינה 5 דק׳ + יעד ממתין)', '',
    `- "היום": ${base.length} עסקאות, ממוצע ${f$(mean(base))}. מתוכן ${baseCom.length} משותפות (ממוצע ${f$(mean(baseCom))}) ו-${baseMiss.length} שהגרסה לא סחרה (ממוצע ${f$(mean(baseMiss))}).`,
    `- הגרסה: ${tr.length} עסקאות, ממוצע ${f$(mean(tr))}. מתוכן ${com.length} משותפות (ממוצע ${f$(mean(com))}) ו-${varOnly.length} שרק היא סחרה (ממוצע ${f$(mean(varOnly))}).`,
    `- על המשותפות: ${f$(mean(com))} − (${f$(mean(baseCom))}) = ${f$(mean(com) - mean(baseCom))}. בין הממוצעים הכלליים: ${f$(mean(tr) - mean(base))}.`);
}

// (4) מבט לעתיד ומילוי
md.push('', '## 3. מבט לעתיד ומחירי מילוי', '');
let la = 0, laN = 0;
for (let k = BOT2.bbN - 1; k < b15.length; k++){ const bar = b15[k]; if (bar.next >= m1.t.length) continue; laN++; if (m1.t[bar.next] < bar.t + BOT2.barMs) la++; }
md.push(`- **אות:** נבנה רק מנרות 15 דקות סגורים (הנר האחרון כולל), והכניסה בדקה הראשונה אחרי סגירת הנר. נבדק: דקת הכניסה לפני סוף הנר — ${la} מתוך ${laN} נרות.`);
for (const v of VARIANTS.filter((x) => x.em != null)){
  // כניסה: הפקודה מוצבת בסגירת הנר במחיר הסגירה L. אם בדקת המילוי הראשונה המחיר כבר נפתח מעבר ל-L (לטובתנו) — בפועל הפקודה הייתה
  // מתבצעת מיד בפתיחה כפקודת שוק (עמלת שוק, במחיר הפתיחה) ולא כממתינה ב-L.
  const tr = res.get(v.k).trades; let marketable = 0, adj = 0, tpGap = 0, tpAdj = 0;
  const byKey = new Map(tr.map((x) => [key(x), x]));
  for (let k = BOT2.bbN - 1; k < b15.length; k++){
    const bar = b15[k]; if (bar.next >= m1.t.length) continue;
    const sig = signal(b15.slice(k - BOT2.bbN + 1, k + 1), BOT2); if (!sig || sig.skip) continue;
    const x = byKey.get(`${bar.t}|${sig.side}`); if (!x) continue;
    const sg = x.sg, L = sig.entryRef, o0 = m1.o[bar.next];
    if (sg > 0 ? o0 < L * (1 - q) : o0 > L * (1 + q)){
      marketable++;
      const y = { ...x, entry: o0, entryMaker: false };
      adj += pnlOf(y, C) - pnlOf(x, C);
    }
    if (v.tpm && x.why === 'יעד' && x.exitMaker && Math.abs(x.exit - sig.tp) > 1e-9){ tpGap++; tpAdj += pnlOf({ ...x, exit: sig.tp }, C) - pnlOf(x, C); }
  }
  md.push(`- **${v.he}:** ${marketable} מתוך ${tr.length} כניסות (${Math.round(marketable / tr.length * 100)}%) — המחיר כבר נפתח מעבר לפקודה, כלומר בפועל מילוי מיידי בעמלת שוק במחיר הפתיחה. השפעה אם מתקנים: ${f$(adj)} בסך הכול (${f$(adj / tr.length)} לעסקה).` +
    (v.tpm ? ` יעד ממתין שמולא במחיר טוב מהיעד (פתיחה מעבר ליעד): ${tpGap} עסקאות; תיקון למחיר היעד: ${f$(tpAdj)}.` : ''));
}
md.push('- **יעד ממתין:** מתמלא רק כשהמחיר עובר את היעד ב-0.01% (תור), במחיר היעד. **כניסה ממתינה:** רק כשהמחיר עובר את הפקודה ב-0.01%; בדקת המילוי נבדק רק הסטופ (פסימי).',
  '- **מה שלא מדומה:** עומק הספר ומיקום בתור מעבר ל-0.01%, החלקה בסטופ מעבר ל-0.01%, ודמי מימון.');

mkdirSync(OUTDIR, { recursive: true });
writeFileSync(join(OUTDIR, 'audit.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
