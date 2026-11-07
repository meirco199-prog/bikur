// מעקב Paper Trading קדימה לפריצת ערוץ Donchian 20/10 על 20 מטבעות (DC20-10-EW) — השיטה הארוכה היציבה ביותר בבדיקות העמידות
// (invest/docs/research/xs-check.md). בקשת מאיר (7/11/2026): "תעשה בנוסף" — רץ לצד מעקב 3 המטבעות ובוט A, לא במקומם.
// תיק וירטואלי בלבד: אין כסף, אין פקודות, אין מפתחות. פונקציה טהורה: מצב קודם + נרות יומיים סגורים → מצב חדש.
// הכלל (זהה למנוע engine/research-daily.js, DC20-10-EW עם drift): לכל מטבע, בסגירת כל יום (UTC):
//   - נכנסים כשהסגירה מעל השיא של 20 הסגירות הקודמות; יוצאים כשהיא מתחת לשפל של 10 הסגירות הקודמות.
//   - משקל: 1/N לכל מטבע במגמה, כש-N = מספר המטבעות עם 20 ימי היסטוריה. השאר מזומן. ספוט, בלי מינוף, בלי שורט.
//   - כשהאות משתנה (כניסה/יציאה, או שינוי ב-N) — מאזנים את כל התיק למשקלי היעד; אחרת המשקלות זזים עם המחירים.
// עלות כל שינוי: עמלת ספוט 0.1% + החלקה לכל צד. הביצוע במחיר הסגירה (במחקר: פתיחת היום הבא — כמעט אותו מחיר).

export const DC = Object.freeze({
  version: 1, id: 'DC20-10-EW', n: 20, m: 10, startUsd: 10000, spotBps: 10, slipBps: { BTC: 2, ETH: 2 }, slipOther: 5,
  universe: ['BTC', 'ETH', 'LTC', 'BCH', 'LINK', 'XLM', 'ETC', 'ADA', 'SOL', 'DOGE', 'AVAX', 'DOT', 'UNI', 'ATOM', 'XRP', 'AAVE', 'FIL', 'ALGO', 'XTZ', 'ZEC'],
});
const DAY = 86400e3;
const r2 = (x) => Math.round(x * 100) / 100, r4 = (x) => Math.round(x * 1e4) / 1e4;
const dayIso = (d) => new Date(d).toISOString().slice(0, 10);

// { coin: [{t, c}] } → מפה יום → סגירה, ורשימת הימים
function index(closes, P){
  const px = {}, days = new Set();
  for (const c of P.universe){ px[c] = new Map(); for (const b of closes?.[c] || []){ const d = Math.floor(b.t / DAY) * DAY; if (b.c > 0){ px[c].set(d, b.c); days.add(d); } } }
  return { px, days: [...days].sort((a, b) => a - b) };
}
// שיא/שפל של n הסגירות שלפני יום d (בלי d); null אם חסר יום בחלון
function ext(px, c, d, n, max){
  let m = max ? -Infinity : Infinity;
  for (let i = 1; i <= n; i++){ const v = px[c].get(d - i * DAY); if (!v) return null; m = max ? Math.max(m, v) : Math.min(m, v); }
  return m;
}
// עדכון מצב "במגמה" של כל מטבע בסגירת יום d, ומשקלי היעד
function signals(px, d, inPos, P){
  const live = P.universe.filter((c) => px[c].get(d) && px[c].get(d - P.n * DAY));
  const ev = [];
  for (const c of live){
    const x = px[c].get(d), hi = ext(px, c, d, P.n, true), lo = ext(px, c, d, P.m, false);
    if (!inPos[c] && hi !== null && x > hi){ inPos[c] = true; ev.push({ coin: c, type: 'in', price: x, level: hi }); }
    else if (inPos[c] && lo !== null && x < lo){ inPos[c] = false; ev.push({ coin: c, type: 'out', price: x, level: lo }); }
  }
  const tgt = {}; for (const c of live) if (inPos[c]) tgt[c] = 1 / live.length;
  return { tgt, ev, live: live.length };
}
const sameW = (a, b) => { const k = new Set([...Object.keys(a), ...Object.keys(b)]); for (const c of k) if (Math.abs((a[c] || 0) - (b[c] || 0)) > 1e-12) return false; return true; };

export function newState(nowMs = Date.now(), P = DC){
  return { v: P.version, id: P.id, startedAt: new Date(nowMs).toISOString(), startDay: null, lastDay: null, startUsd: P.startUsd, equity: P.startUsd,
    btcStart: null, btcEquity: P.startUsd, inPos: {}, tgt: {}, weights: {}, costsUsd: 0, changes: [], daily: [] };
}

// ריצה ראשונה: מחשבים את מצב "במגמה" מכל ההיסטוריה שהתקבלה (בלי מסחר), ומקצים בסגירת היום האחרון. אחר כך: יום אחרי יום.
export function step(prev, closes, P = DC){
  const s = prev && prev.v === P.version && prev.id === P.id ? JSON.parse(JSON.stringify(prev)) : newState(Date.now(), P);
  const { px, days } = index(closes, P), btcDays = days.filter((d) => px.BTC.get(d));
  const first = s.lastDay === null;
  if (first){ for (const d of btcDays.slice(0, -1)) signals(px, d, s.inPos, P); }
  const todo = first ? btcDays.slice(-1) : btcDays.filter((d) => d > Date.parse(s.lastDay));
  const slip = (c) => (P.slipBps[c] ?? P.slipOther) / 1e4, events = [];
  for (const d of todo){
    if (!first || s.startDay){ // שערוך יומי: המשקלות זזים עם המחירים
      const pd = Date.parse(s.lastDay); let r = 0; const nw = {};
      for (const [c, w] of Object.entries(s.weights)){ const a = px[c].get(pd), b = px[c].get(d), g = a && b ? b / a - 1 : 0; r += w * g; nw[c] = w * (1 + g); }
      s.equity *= 1 + r; for (const c of Object.keys(nw)) nw[c] /= 1 + r; s.weights = nw;
    } else { s.startDay = dayIso(d); s.btcStart = px.BTC.get(d); }
    const { tgt, ev, live } = signals(px, d, s.inPos, P);
    if (!sameW(tgt, s.tgt) || first){ // האות השתנה → איזון לכל משקלי היעד
      let turn = 0, cost = 0;
      for (const c of new Set([...Object.keys(tgt), ...Object.keys(s.weights)])){ const dw = Math.abs((tgt[c] || 0) - (s.weights[c] || 0)); turn += dw; cost += dw * (P.spotBps / 1e4 + slip(c)); }
      const costUsd = s.equity * cost; s.equity -= costUsd; s.costsUsd += costUsd; s.weights = { ...tgt }; s.tgt = { ...tgt };
      const e = { day: dayIso(d), in: ev.filter((x) => x.type === 'in').map((x) => x.coin), out: ev.filter((x) => x.type === 'out').map((x) => x.coin), held: Object.keys(tgt), live, turnover: r4(turn), costUsd: r2(costUsd), equity: r2(s.equity) };
      s.changes.push(e); events.push(e);
    }
    s.btcEquity = s.startUsd * px.BTC.get(d) / s.btcStart;
    s.daily.push({ day: dayIso(d), equity: r2(s.equity), btc: r2(s.btcEquity) });
    s.lastDay = new Date(d).toISOString();
  }
  s.changes = s.changes.slice(-300); s.daily = s.daily.slice(-500);
  s.equity = r2(s.equity); s.btcEquity = r2(s.btcEquity); s.costsUsd = r2(s.costsUsd);
  return { state: s, events, processed: todo.length };
}
