#!/usr/bin/env node
// ניתוח עומק של העסקאות האמיתיות של בוט 1 (Bybit דמו, BTCUSDT, רצועות בולינגר בנרות דקה) — מה מבדיל את ההפסדים הגדולים מהרווחים,
// והאם מנגנון סטופ/סינון היה תופס אותם בזמן. בקשת מאיר (12/11/2026): "יש המון רווחים אבל בהפסד אחד זה צולל. תבנה מנגנון של סטופים
// שידעו לתפוס אותו ברגע הנכון. תבדוק לעומק מה גרם להפסדים ולנתח". קריאה בלבד: קובץ המצב של הבוט (state.json) + נרות ציבוריים של Bybit.
// רץ על השרת: bybit-bot.yml → analyze1. אין פקודות ואין מפתחות.
// ⚠️ מעט עסקאות (עשרות): זה אבחון, לא הוכחה. כל כלל שנראה טוב כאן חייב לעבור בדיקה לאחור של שנים לפני שהוא נכנס לבוט.
import { readFileSync } from 'node:fs';

const B = 'https://api.bybit.com', sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOTIONAL = 190000, FEE_EXIT = 0.00055 + 0.0002, FEE_IN = 0.0002;  // יציאה מיידית + החלקה; כניסה בפקודה ממתינה
const state = JSON.parse(readFileSync(process.env.BOT_STATE, 'utf8'));
const trades = (state.trades || []).filter((x) => x.entry > 0 && x.exit > 0 && x.t > 0).sort((a, b) => a.t - b.t);
const iso = (t) => new Date(t).toISOString().slice(5, 16).replace('T', ' ');
console.error(`עסקאות בקובץ: ${trades.length}, מ-${state.startedAt}`);

async function bars(from, to){
  const out = new Map();
  for (let s = from; s < to; s += 900 * 60e3){
    const j = await (await fetch(`${B}/v5/market/kline?category=linear&symbol=BTCUSDT&interval=1&start=${s}&end=${Math.min(to, s + 899 * 60e3)}&limit=1000`)).json();
    for (const r of j?.result?.list || []) out.set(Number(r[0]), r.slice(1, 6).map(Number));
    await sleep(120);
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([t, [o, h, l, c, v]]) => ({ t, o, h, l, c, v }));
}
// נרות לכל התקופה (בגושים), פעם אחת
const all = await bars(trades[0].t - 300 * 60e3, trades.at(-1).t + 15 * 60e3), idx = new Map(all.map((b, i) => [b.t, i]));
const at = (t) => idx.get(Math.floor(t / 60e3) * 60e3);
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

const rows = [];
for (const x of trades){
  const sg = x.side === 'long' ? 1 : -1, iExit = at(x.t); if (iExit == null) continue;
  // דקת הכניסה: הראשונה ב-61 הדקות שלפני הסגירה שבה המחיר נגע במחיר הכניסה
  let iIn = null; for (let i = Math.max(0, iExit - 61); i <= iExit; i++) if (all[i].l <= x.entry && x.entry <= all[i].h){ iIn = i; break; }
  if (iIn == null || iIn < 240) continue;
  const c = (k) => all[iIn - k].c, E = x.entry;
  // מאפיינים לפני הכניסה (רק נתונים עד הדקה שלפני)
  const closes = all.slice(iIn - 20, iIn).map((b) => b.c), m = mean(closes), sd = Math.sqrt(mean(closes.map((y) => (y - m) ** 2)));
  const f = {
    width: (4 * sd) / m * 100,                                       // רוחב הרצועות (%)
    r5: sg * (c(1) / c(6) - 1) * 100, r15: sg * (c(1) / c(16) - 1) * 100, r60: sg * (c(1) / c(61) - 1) * 100, r240: sg * (c(1) / c(240) - 1) * 100, // מומנטום בכיוון העסקה (שלילי = "סכין נופלת")
    atr: mean(all.slice(iIn - 20, iIn).map((b) => (b.h - b.l) / b.c)) * 100,
    vol: all[iIn].v / mean(all.slice(iIn - 60, iIn).map((b) => b.v)),   // נפח בדקת הכניסה מול ממוצע שעה
    hour: new Date(all[iIn].t).getUTCHours(),
  };
  // מסלול העסקה: הכי רע / הכי טוב, ובאיזו דקה
  let mae = 0, mfe = 0, maeAt = 0; const path = [];
  for (let i = iIn; i <= iExit; i++){ const adv = sg > 0 ? (all[i].l / E - 1) : (E / all[i].h - 1), fav = sg > 0 ? (all[i].h / E - 1) : (E / all[i].l - 1); if (adv * 100 < mae){ mae = adv * 100; maeAt = i - iIn; } mfe = Math.max(mfe, fav * 100); path.push({ i, adv: adv * 100, fav: fav * 100, cl: sg * (all[i].c / E - 1) * 100 }); }
  rows.push({ ...x, sg, iIn, iExit, mins: iExit - iIn, f, mae, mfe, maeAt, path, big: x.pnl < -300 });
}
console.error(`עסקאות שנותחו: ${rows.length}`);

const L = rows.filter((r) => r.big), W = rows.filter((r) => r.pnl > 0), O = rows.filter((r) => !r.big && r.pnl <= 0);
const sum = (a) => a.reduce((s, r) => s + r.pnl, 0);
const f$ = (x) => (x < 0 ? '−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US'), fx = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const md = ['# בוט 1 — ניתוח עומק של העסקאות האמיתיות: מה גורם להפסד הגדול?', '',
  `- **עסקאות:** ${rows.length} (מ-${iso(rows[0].t)} עד ${iso(rows.at(-1).t)}, UTC). רווח: ${W.length} (${f$(sum(W))}) · הפסד גדול (סטופ מלא, < −300$): ${L.length} (${f$(sum(L))}) · הפסד קטן: ${O.length} (${f$(sum(O))}) · **סה״כ ${f$(sum(rows))}**.`,
  `- **ממוצע:** רווח ${f$(sum(W) / (W.length || 1))} · הפסד גדול ${f$(sum(L) / (L.length || 1))}. כדי להיות ברווח צריך ${fx(-sum(L) / (L.length || 1) / (sum(W) / (W.length || 1)), 1)} עסקאות מרוויחות על כל סטופ.`, '',
  '## 1. מה היה שונה לפני הכניסה (ממוצעים)', '', '| | רוחב רצועות % | מומנטום 5 דק׳ % | 15 דק׳ % | שעה % | 4 שעות % | תנודתיות דקה % | נפח בכניסה (×ממוצע) |', '|---|---|---|---|---|---|---|---|'];
const avgRow = (name, a) => md.push(`| ${name} (${a.length}) | ${fx(mean(a.map((r) => r.f.width)))} | ${fx(mean(a.map((r) => r.f.r5)))} | ${fx(mean(a.map((r) => r.f.r15)))} | ${fx(mean(a.map((r) => r.f.r60)))} | ${fx(mean(a.map((r) => r.f.r240)))} | ${fx(mean(a.map((r) => r.f.atr)), 3)} | ${fx(mean(a.map((r) => r.f.vol)), 1)} |`);
avgRow('רווח', W); avgRow('הפסד גדול', L); avgRow('הפסד קטן', O);
md.push('', 'מומנטום "בכיוון העסקה": שלילי = המחיר נע נגד הכיוון שנכנסנו אליו (בלונג — ירד) לפני הכניסה, כלומר "תפסנו סכין נופלת".', '',
  '## 2. איך נראה ההפסד הגדול מבפנים (כל עסקה)', '', '| סגירה (UTC) | כיוון | כניסה | תוצאה | דקות | הכי רע % | באיזו דקה | הכי טוב % | אחרי דקה 1 | אחרי 2 | אחרי 3 | אחרי 5 | מומנטום 15 % | נפח× |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows.filter((r) => r.big)){ const p = (k) => fx(r.path[k]?.cl); md.push(`| ${iso(r.t)} | ${r.sg > 0 ? 'לונג' : 'שורט'} | ${r.entry} | ${f$(r.pnl)} | ${r.mins} | ${fx(r.mae)} | ${r.maeAt} | ${fx(r.mfe)} | ${p(1)} | ${p(2)} | ${p(3)} | ${p(5)} | ${fx(r.f.r15)} | ${fx(r.f.vol, 1)} |`); }
md.push('', '"אחרי דקה k": הרווח/הפסד הצף (%) בסגירת הדקה ה-k מהכניסה.', '');
// רווחים: איך הם נראו בדקות הראשונות (כדי לראות אם כלל מוקדם היה הורג גם אותם)
md.push('## 3. אותו דבר לעסקאות המרוויחות — הכי רע בדרך', '', `- הכי רע ממוצע בדרך לרווח: ${fx(mean(W.map((r) => r.mae)))}% · בהפסדים הגדולים: ${fx(mean(L.map((r) => r.mae)))}%.`,
  `- מרוויחות שהיו בהפסד של 0.10%+ בדרך: ${W.filter((r) => r.mae <= -0.1).length} מ-${W.length} · של 0.15%+: ${W.filter((r) => r.mae <= -0.15).length}.`,
  `- הפסדים גדולים שהיו ברווח של 0.05%+ בדרך: ${L.filter((r) => r.mfe >= 0.05).length} מ-${L.length} · של 0.10%+: ${L.filter((r) => r.mfe >= 0.1).length}.`, '');
// מנגנונים: חיתוך מוקדם / אין התקדמות / סינון כניסה — על אותן עסקאות בדיוק
const exitAt = (r, k) => { const p = r.path[k]; const px = all[p.i].c, g = r.sg * (px / r.entry - 1); return NOTIONAL * (g - FEE_IN - FEE_EXIT); };
const rules = [];
for (const x of [0.08, 0.1, 0.12, 0.15]) for (const n of [2, 3, 5]) rules.push({ k: `חיתוך: הפסד ${x}% בתוך ${n} דק׳`, fn: (r) => { for (let k = 0; k < Math.min(n, r.path.length); k++) if (r.path[k].adv <= -x) return (-x / 100 - FEE_IN - FEE_EXIT) * NOTIONAL; return r.pnl; } });
for (const n of [3, 5, 10]) for (const y of [0, 0.05]) rules.push({ k: `אין התקדמות: אחרי ${n} דק׳ פחות מ-+${y}% → יציאה`, fn: (r) => (r.path.length > n && Math.max(...r.path.slice(0, n).map((p) => p.fav)) < y ? exitAt(r, n) : r.pnl) });
for (const z of [-0.2, -0.3, -0.5]) rules.push({ k: `סינון: לא נכנסים כשהמומנטום 15 דק׳ < ${z}% ("סכין נופלת")`, fn: (r) => (r.f.r15 < z ? 0 : r.pnl) });
for (const z of [-0.5, -1]) rules.push({ k: `סינון: לא נכנסים כשהמגמה 4 שעות < ${z}%`, fn: (r) => (r.f.r240 < z ? 0 : r.pnl) });
for (const v of [2, 3]) rules.push({ k: `סינון: לא נכנסים כשהנפח בכניסה > ×${v}`, fn: (r) => (r.f.vol > v ? 0 : r.pnl) });
for (const w of [0.6, 0.8]) rules.push({ k: `סינון: לא נכנסים כשרוחב הרצועות > ${w}%`, fn: (r) => (r.f.width > w ? 0 : r.pnl) });
md.push('## 4. מנגנונים — מה היה קורה על אותן עסקאות בדיוק', '', '| מנגנון | סה״כ | שינוי מול היום | הפסדים גדולים שנחסכו | רווחים שנפגעו |', '|---|---|---|---|---|', `| **היום** | ${f$(sum(rows))} | — | — | — |`);
const res = rules.map((u) => { const v = rows.map((r) => ({ r, p: u.fn(r) })); return { k: u.k, tot: v.reduce((s, y) => s + y.p, 0), saved: v.filter((y) => y.r.big && y.p > y.r.pnl + 100).length, hurt: v.filter((y) => y.r.pnl > 0 && y.p < y.r.pnl - 20).length }; }).sort((a, b) => b.tot - a.tot);
for (const u of res) md.push(`| ${u.k} | ${f$(u.tot)} | ${f$(u.tot - sum(rows))} | ${u.saved} מ-${L.length} | ${u.hurt} מ-${W.length} |`);
md.push('', `**זהירות:** ${rows.length} עסקאות בלבד, ו-${rules.length} מנגנונים נבדקו — הטוב ביותר ייראה טוב גם במקרה. רק מה שחוזר בבדיקה לאחור של שנים (נרות דקה של BTC 2020–2026) נכנס לבוט.`);
console.log(md.join('\n'));
