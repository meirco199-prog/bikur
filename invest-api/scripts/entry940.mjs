// מחיר 09:40 ניו יורק לכל חברות המדד + SPY — נקודת הכניסה הברת-ביצוע של תיקי הצל (הסיגנל נוצר בלילה; המערכת מבצעת ב-09:40).
// רץ ב-GitHub Actions. התזמון של GitHub לא מדויק (בריפו הזה ריצות מתוזמנות יוצאות באיחור של שעות), לכן הסקריפט לא תלוי בשעת הריצה:
// הוא לוקח את הסשן האחרון שיש לו ברים של 5 דקות (Yahoo, לניסוי הצל בלבד), המפתח = תאריך הסשן לפי הבר עצמו, ומדלג אם היום הזה
// כבר נאסף (GET /entry/{day}). כך אפשר להריץ אותו בכל ריצה מתוזמנת — אחרי 09:46 ET הוא אוסף את היום, לפני הפתיחה את אתמול.
const W = process.env.WORKER_URL || 'https://invest-api.meirco199.workers.dev';
const SECRET = process.env.CRON_SECRET;
const FORCE = process.env.ENTRY_FORCE === '1'; // בדיקה ידנית: אוסף מחדש גם אם היום כבר נאסף
const LIMIT = +process.env.ENTRY_LIMIT || 0;
const DONE_SHARE = 0.9; // נאסף כבר ≥90% מהיקום → אין מה לעשות
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const ny = (d = new Date()) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d); const g = (t) => p.find((x) => x.type === t)?.value; return { weekday: g('weekday'), date: `${g('year')}-${g('month')}-${g('day')}`, minutes: (+g('hour') % 24) * 60 + +g('minute') }; };
async function getJSON(url, opts = {}, tries = 3){
  for (let i = 0; i < tries; i++){ try { const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(25000) }); if (r.status === 429 || r.status >= 500){ await sleep(1500 * (i + 1)); continue; } if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); } catch (e) { if (i === tries - 1) throw e; await sleep(1000 * (i + 1)); } }
}
// הבר של 09:40 (התחלה 09:40 ET) → מחיר הפתיחה שלו; אין → הבר הראשון אחרי 09:40 עד 09:55. מהסשן האחרון שבתשובה
// (הבקשה מבקשת יומיים, כדי שלפני הפתיחה — כשליום הנוכחי אין עדיין ברים — יתקבל הסשן הקודם)
export function pick940(j){
  const r = j?.chart?.result?.[0]; if (!r?.timestamp?.length) return null;
  const q = r.indicators?.quote?.[0] || {};
  const byDate = {};
  for (let i = 0; i < r.timestamp.length; i++){
    const t = ny(new Date(r.timestamp[i] * 1000)); const o = q.open?.[i];
    if (!(o > 0)) continue;
    const cur = byDate[t.date];
    if (t.minutes === 9 * 60 + 40) byDate[t.date] = { price: o, date: t.date, bar: '09:40' };
    else if (!cur && t.minutes > 9 * 60 + 40 && t.minutes <= 9 * 60 + 55) byDate[t.date] = { price: o, date: t.date, bar: `${Math.floor(t.minutes / 60)}:${String(t.minutes % 60).padStart(2, '0')}` };
  }
  const dates = Object.keys(byDate).sort();
  return dates.length ? byDate[dates[dates.length - 1]] : null;
}
const chart5m = (sym) => getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym.replace('.', '-'))}?interval=5m&range=2d`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bikur-invest/1.0)', Accept: 'application/json' } });
export async function main(){
  if (!SECRET) throw new Error('חסר CRON_SECRET');
  // הסשן שנאסף = הסשן האחרון של SPY לפי הברים. אם זה היום בניו יורק ועוד לא 09:46 — הבר של 09:40 עוד לא סופי; נחכה לריצה הבאה
  const spyBar = pick940(await chart5m('SPY'));
  if (!spyBar) { log('אין בר 09:40 ל-SPY — לא רץ'); return { skipped: true, reason: 'no-spy-bar' }; }
  const now = ny();
  if (spyBar.date === now.date && now.minutes < 9 * 60 + 46){ log(`הסשן ${spyBar.date} עוד לא הגיע ל-09:46 ET — לא רץ`); return { skipped: true, reason: 'too-early', day: spyBar.date }; }
  const sp = await getJSON(`${W}/universe/sp500`);
  let syms = ['SPY', ...(sp.items || []).map((a) => a.symbol)];
  if (LIMIT) syms = syms.slice(0, LIMIT);
  const have = await getJSON(`${W}/entry/${spyBar.date}`).catch(() => ({ count: 0 }));
  if (!FORCE && (have.count || 0) >= DONE_SHARE * syms.length){ log(`entry940 ${spyBar.date}: כבר נאסף (${have.count}/${syms.length}) — מדלג`); return { skipped: true, reason: 'done', day: spyBar.date, count: have.count }; }
  const picked = { SPY: spyBar }; const byDate = { [spyBar.date]: 1 }; const errors = [];
  for (const sym of syms){
    if (sym === 'SPY') continue;
    try {
      const p = pick940(await chart5m(sym)); if (!p) throw new Error('אין בר 09:40');
      picked[sym] = p; byDate[p.date] = (byDate[p.date] || 0) + 1;
    } catch (e) { errors.push(`${sym}: ${e.message.slice(0, 80)}`); }
    await sleep(250);
  }
  const day = Object.entries(byDate).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!day) throw new Error('לא נמצאו ברים');
  // ברים מסשן אחר (נייר שלא נסחר היום) לא נכנסים למסמך של היום
  const prices = Object.fromEntries(Object.entries(picked).filter(([, p]) => p.date === day).map(([s, p]) => [s, p.price]));
  for (const [s, cnt] of Object.entries(byDate)) if (s !== day) log(`  ${cnt} ניירות עם בר מסשן ${s} — לא נשמרים ליום ${day}`);
  const r = await getJSON(`${W}/ingest/entry?secret=${encodeURIComponent(SECRET)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, prices, at: '09:40 ET', source: 'yahoo-5m' }) }, 1);
  log(`entry940 ${day}: ${Object.keys(prices).length}/${syms.length} מחירים (SPY ${prices.SPY ?? '—'}), שגיאות ${errors.length}, נשמר ${r.count}`);
  for (const e of errors.slice(0, 10)) log('  ', e);
  return { day, count: Object.keys(prices).length, errors: errors.length };
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main().then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error('entry940 failed:', e.message); process.exit(1); });
