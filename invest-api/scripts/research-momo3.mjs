#!/usr/bin/env node
// מחקר המשך: "5 המניות שעלו הכי הרבה ב-3 ימים, קנייה לפני הסגירה עד לפני הסגירה של מחר" (בקשת מאיר, 13/11/2026). מחקר בלבד.
// רקע: במחקר research-reversal3 (11/2021 → 11/2026) זו הייתה הגרסה הטובה מ-16 (50,000$ → 101,704$, t 1.3), אבל היא נבחרה *אחרי*
//   שראינו את התוצאות — אז על אותן שנים היא לא מוכיחה כלום. כאן: מבחן על תקופה שלא נבדקה — 2008 → 11/2021 (כ-14 שנים).
// אותו מקור נתונים, אותו יקום (S&P 500 של אותו יום, מחזור ≥ 100 מיליון דולר), אותן עלויות ואותה סימולציה (pickBasket/dayReturn/grow).
// ⚠️ "לפני הסגירה" מקורב במחיר הסגירה עצמו (גם לדירוג וגם לקנייה). בפועל קונים כמה דקות לפני — זה מייפה מעט את הגרסה.
// ⚠️ הטיית שורדים: מניות שנמחקו חסרות; לפני 2015 החוסר גדול יותר.
// הכרעה (נקבעה מראש, לפני הריצה): הגרסה (סגירה→סגירה, 5, 3 ימים) "שווה דמו" רק אם בתקופה שלא נבדקה (2008 → 11/2021):
//   (1) גמרה מעל SPY, (2) רווח יומי ממוצע חיובי עם t ≥ 2, (3) חיובית ב-60% מהשנים לפחות, (4) רווחית גם עם עלויות כפולות.
//   הגרסאות האחרות (1/3/10 מניות, יום/5 ימים, פתיחה→פתיחה, מסנן מגמה) — רק להבנה, לא להכרעה.
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { pickBasket, dayReturn, grow, START, MIN_ADV, FEE } from './research-reversal3.mjs';

export const MAIN = 'close-U3-5', SPLIT = '2021-11-12', FROM = '2008-01-02';
export const VARIANTS = [
  ...[1, 3, 5, 10].map((N) => ({ k: `close-U3-${N}`, mode: 'close', N, look: 3, side: 'up' })),
  { k: 'close-U1-5', mode: 'close', N: 5, look: 1, side: 'up' },
  { k: 'close-U5-5', mode: 'close', N: 5, look: 5, side: 'up' },
  { k: 'open-U3-5', mode: 'open', N: 5, look: 3, side: 'up' },
  { k: 'close-U3-5-trend', mode: 'close', N: 5, look: 3, side: 'up', trend: true },
  { k: 'close-L3-5', mode: 'close', N: 5, look: 3, side: 'down' },
];
const MODE_HE = { open: 'פתיחה→פתיחה', close: 'סגירה→סגירה' };
export const he = (v) => `${MODE_HE[v.mode]} · ${v.N} ${v.N === 1 ? 'מניה' : 'מניות'} ש${v.side === 'up' ? 'עלו' : 'ירדו'} הכי הרבה ב-${v.look === 1 ? 'יום אחד' : `${v.look} ימים`}${v.trend ? ' · רק כשהמדד מעל ממוצע 200 יום' : ''}`;
// הכרעה על מערך רווחים יומיים של התקופה שלא נבדקה
export function verdict(g, spyG, g2, yearsPos, yearsN){
  return g.end > spyG.end && g.mean > 0 && g.t >= 2 && yearsPos / yearsN >= 0.6 && g2.pct > 0;
}

async function main(){
  const { universes, daily, build, dayIso, inIv, halfSpread } = await import('./research-xsec.mjs');
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const OUTDIR = arg('--outdir', 'momo3-out'), log = (...a) => console.error(...a), t0 = Date.now();
  mkdirSync(OUTDIR, { recursive: true });
  const U = await universes();
  const hist = Object.entries(U.iv500).filter(([, ivs]) => ivs.some(([, b]) => b === null || b >= '2007-06-01')).map(([s]) => s).filter((s) => /^[A-Z]{1,5}(-[A-Z]{1,2})?$/.test(s));
  const syms = [...new Set(['SPY', ...U.sp500, ...hist])];
  log(`fetching ${syms.length} symbols`); let raw = {}; const q = [...syms];
  await Promise.all(Array.from({ length: 8 }, async () => { for (let s; (s = q.shift());){ const b = await daily(s); if (b) raw[s] = b; await new Promise((r) => setTimeout(r, 60)); } }));
  if (!raw.SPY) throw new Error('אין נתוני SPY');
  const calT = raw.SPY.t, cal = Array.from(calT, dayIso), L = cal.length, S = build(raw, calT); raw = null;
  const k0 = cal.findIndex((d) => d >= FROM), kS = cal.findIndex((d) => d >= SPLIT);
  const stocks = Object.keys(S).filter((s) => s !== 'SPY');
  log(`loaded ${stocks.length} · ${cal[k0]} → ${cal.at(-1)} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const ADV = {};
  for (const s of stocks){ const X = S[s], a = new Float32Array(L).fill(NaN); for (let k = Math.max(21, k0 - 1); k < L; k++){ let t = 0, n = 0; for (let j = k - 20; j < k; j++) if (X.DV[j] >= 0){ t += X.DV[j]; n++; } if (n >= 15) a[k] = t / n; } ADV[s] = a; }
  const spy = S.SPY, ma200 = new Float64Array(L).fill(NaN);
  for (let k = 200; k < L; k++){ let t = 0; for (let j = k - 200; j < k; j++) t += spy.C[j]; ma200[k] = t / 200; }
  const R = {}, R2 = {}, nCand = [];
  for (const v of VARIANTS){
    const r = new Float64Array(L).fill(NaN), r2 = new Float64Array(L).fill(NaN); let prev = new Map(), prev2 = new Map();
    for (let k = k0; k < L - 1; k++){
      const sk = v.mode === 'open' ? k - 1 : k; let basket = [];
      if (!v.trend || spy.C[sk] > ma200[sk]){
        const cands = [];
        for (const s of stocks){
          const X = S[s];
          if (!inIv(U.iv500[s], cal[k]) || !(ADV[s][k] >= MIN_ADV)) continue;
          const a = X.C[sk - v.look], b = X.C[sk], e0 = v.mode === 'open' ? X.O[k] : X.C[k], e1 = v.mode === 'open' ? X.O[k + 1] : X.C[k + 1];
          if (!(a > 0 && b > 0 && e0 > 0 && e1 > 0)) continue;
          cands.push({ s, sig: b / a - 1, ret: e1 / e0 - 1, c: halfSpread(ADV[s][k]) + FEE });
        }
        if (v.k === MAIN) nCand.push(cands.length);
        if (cands.length >= 50) basket = pickBasket(cands, v.N, v.side);
      }
      const d = dayReturn(basket, prev, 1), d2 = dayReturn(basket, prev2, 2);
      r[k] = d.r; r2[k] = d2.r; prev = d.held; prev2 = d2.held;
    }
    R[v.k] = r; R2[v.k] = r2;
  }
  const spyR = new Float64Array(L).fill(NaN); for (let k = k0; k < L - 1; k++) spyR[k] = spy.C[k + 1] / spy.C[k] - 1;
  log(`simulated ${((Date.now() - t0) / 1000).toFixed(0)}s · candidates/day median ${nCand.sort((a, b) => a - b)[nCand.length >> 1]}`);

  const sl = (arr, a, z) => Array.from(arr.slice(a, z));
  const f$ = (x) => (Number.isFinite(x) ? '$' + Math.round(x).toLocaleString('en-US') : '—'), fs$ = (x) => (Number.isFinite(x) ? (x < 0 ? '−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US') : '—');
  const fp = (x, d = 0) => (Number.isFinite(x) ? `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}%` : '—'), ft = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
  const yIdx = (y) => { let a = cal.findIndex((d, k) => k >= k0 && d.startsWith(y)), z = a; while (z < L - 1 && cal[z].startsWith(y)) z++; return [a, z]; };
  const yearsIn = (a, z) => [...new Set(cal.slice(a, z).map((d) => d.slice(0, 4)))];
  const ROWS = [...VARIANTS.map((v) => ({ k: v.k, he: he(v), r: R[v.k], v })), { k: 'SPY', he: 'השוואה: קונים את המדד (SPY) ומחזיקים', r: spyR }];
  const per = (x, a, z) => { const g = grow(sl(x.r, a, z)), g2 = x.v ? grow(sl(R2[x.k], a, z)) : null, ys = yearsIn(a, z), pos = ys.filter((y) => { const [p, q2] = yIdx(y); return grow(sl(x.r, Math.max(p, a), Math.min(q2, z))).pct > 0; }).length; return { g, g2, pos, ny: ys.length }; };

  const md = [`# "5 שעלו הכי הרבה ב-3 ימים, לפני הסגירה" — מבחן על שנים שלא נבדקו (${cal[k0]} → ${cal.at(-1)})`, '',
    'בקשת מאיר (13/11/2026): לבדוק את הגרסה שיצאה הכי טובה במחקר הקודם (11/2021 → 11/2026). היא נבחרה אחרי שראינו תוצאות — לכן המבחן האמיתי הוא על **2008 → 11/2021**, שנים שלא נבדקו.', '',
    '- **אותו דבר בדיוק:** S&P 500 של אותו יום, מחזור ≥ 100 מיליון דולר; 50,000$, כל יום מחדש, שווה בשווה, ריבית דריבית; מרווח + עמלה; מניה שנשארת — בלי עלות.',
    '- **ימים בלי סל** (פחות מ-50 מועמדים, או מסנן המגמה סוגר): מוכרים את הסל של אתמול בעלות ונשארים במזומן. **משקלות:** ממוצע שווה של הסל (קירוב לאיזון יומי בלי עלות).',
    '- ⚠️ "לפני הסגירה" = מחיר הסגירה עצמו (קירוב שמייפה מעט). ⚠️ הטיית שורדים — מניות שנמחקו חסרות, יותר בשנים המוקדמות.',
    `- **הכרעה שנקבעה מראש** (רק על ${he(VARIANTS[2])}, בשנים שלא נבדקו): מעל המדד, רווח יומי חיובי עם t ≥ 2, חיובית ב-60% מהשנים לפחות, ורווחית גם עם עלויות כפולות.`, ''];
  const block = (title, a, z) => {
    md.push(`## ${title} (${cal[a]} → ${cal[z - 1] || cal.at(-1)}) — כמה נשאר מ-50,000$`, '', '| גרסה | נשאר | רווח / הפסד | שנתי | ירידה מקס׳ | t | שנים ברווח | עלויות כפולות → נשאר |', '|---|---|---|---|---|---|---|---|');
    const yrs = (z - a) / 252;
    for (const x of ROWS){ const { g, g2, pos, ny } = per(x, a, z); md.push(`| ${x.k === MAIN ? `**${x.he}**` : x.he} | ${f$(g.end)} | ${fs$(g.pnl)} (${fp(g.pct)}) | ${fp(Math.pow(g.end / START, 1 / yrs) - 1, 1)} | ${fp(-g.dd)} | ${ft(g.t)} | ${pos}/${ny} | ${g2 ? f$(g2.end) : '—'} |`); }
    md.push('');
  };
  block('1. המבחן: השנים שלא נבדקו', k0, kS);
  block('2. השנים שכבר ראינו', kS, L - 1);
  block('3. הכול', k0, L - 1);
  // לפי שנה
  const ys = yearsIn(k0, L - 1), keys = [MAIN, 'close-U3-10', 'open-U3-5', 'SPY'];
  md.push('## 4. כל שנה בנפרד — מתחילים כל שנה עם 50,000$, רווח / הפסד', '', `| שנה | ${keys.map((k) => ROWS.find((x) => x.k === k).he).join(' | ')} |`, `|---|${keys.map(() => '---').join('|')}|`);
  for (const y of ys){ const [a, z] = yIdx(y); md.push(`| ${y}${y === SPLIT.slice(0, 4) ? ' *' : ''} | ${keys.map((k) => { const g = grow(sl(ROWS.find((x) => x.k === k).r, a, z)); return `${fs$(g.pnl)} (${fp(g.pct)})`; }).join(' | ')} |`); }
  md.push('', `\\* ${SPLIT.slice(0, 4)}: עד ${SPLIT} — שנים שלא נבדקו; אחרי — שנים שכבר ראינו.`);
  const m = per(ROWS.find((x) => x.k === MAIN), k0, kS), spyT = grow(sl(spyR, k0, kS)), pass = verdict(m.g, spyT, m.g2, m.pos, m.ny);
  md.push('', '## 5. הכרעה', '',
    `- **${he(VARIANTS[2])}, בשנים שלא נבדקו:** 50,000$ → ${f$(m.g.end)} (${fp(m.g.pct)}), t ${ft(m.g.t)}, ${m.pos}/${m.ny} שנים ברווח, עלויות כפולות → ${f$(m.g2.end)}. המדד: ${f$(spyT.end)} (${fp(spyT.pct)}).`,
    pass ? '- **עוברת ✅** — מועמדת לדמו (לא לכסף אמיתי) עם קריטריון קדימה.' : '- **לא עוברת ❌** — התוצאה של 2021–2026 לא חוזרת בשנים אחרות; אין בסיס לשים עליה כסף.');
  writeFileSync(`${OUTDIR}/report.md`, md.join('\n') + '\n');
  writeFileSync(`${OUTDIR}/meta.json`, JSON.stringify({ from: cal[k0], split: cal[kS], to: cal.at(-1), symbols: stocks.length, main: { test: m, spy: spyT, pass } }, null, 1));
  log(`done ${((Date.now() - t0) / 1000).toFixed(0)}s`); console.log(md.join('\n'));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e); process.exit(1); });
