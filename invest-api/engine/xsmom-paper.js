// מעקב Paper Trading קדימה למומנטום בין מטבעות (XS14-top3-f200) — הגרסה היחידה שעברה את מבחן המחקר היומי (AI_COUNCIL#31,
// invest/docs/research/crypto-daily.md). בקשת מאיר (7/11/2026): "הפעל את הגרסאות המבטיחות ב-Paper Trading או Demo בלבד" → "תתחיל".
// תיק וירטואלי בלבד: אין כסף, אין פקודות, אין מפתחות. פונקציה טהורה: מצב קודם + נרות יומיים סגורים → מצב חדש.
// הכלל (זהה למחקר): בסגירת יום ראשון (UTC) — 3 המטבעות עם התשואה הגבוהה ב-14 הימים האחרונים (רק תשואה חיובית, רק מטבע עם ≥60 ימי
// היסטוריה), משקל שליש לכל אחד; ורק כש-BTC מעל הממוצע של 200 יום, אחרת מזומן. עלות כל שינוי: עמלת ספוט 0.1% + החלקה לכל צד.
// השוני מהמחקר: הביצוע במחיר הסגירה של יום ראשון (במחקר: פתיחת יום שני = כמעט אותו מחיר), והעוגן הוא יום קבוע בשבוע (הערת GPT ב-#216).

export const XS = Object.freeze({
  version: 1, id: 'XS14-top3-f200', lookback: 14, top: 3, smaN: 200, minHist: 60, startUsd: 10000,
  spotBps: 10, slipBps: { BTC: 2, ETH: 2 }, slipOther: 5, rebalanceDow: 0, // 0 = יום ראשון (UTC), סגירה
  universe: ['BTC', 'ETH', 'LTC', 'BCH', 'LINK', 'XLM', 'ETC', 'ADA', 'SOL', 'DOGE', 'AVAX', 'DOT', 'UNI', 'ATOM', 'XRP', 'AAVE', 'FIL', 'ALGO', 'XTZ', 'ZEC'],
});
const DAY = 86400e3;
const r4 = (x) => Math.round(x * 1e4) / 1e4, r2 = (x) => Math.round(x * 100) / 100;

// { coin: [{t, c}] } (נרות יומיים סגורים) → מפה day → מחיר, ורשימת הימים
function index(closes){
  const px = {}, days = new Set();
  for (const [c, arr] of Object.entries(closes || {})){ px[c] = new Map(); for (const b of arr || []){ const d = Math.floor(b.t / DAY) * DAY; if (b.c > 0){ px[c].set(d, b.c); days.add(d); } } }
  return { px, days: [...days].sort((a, b) => a - b) };
}
const at = (px, c, d) => px[c]?.get(d);

// בחירת 3 החזקים בסגירת יום d (רק מידע עד d כולל)
export function picks(closes, d, P = XS){
  const { px } = index(closes);
  const btc = at(px, 'BTC', d);
  let sma = 0, n = 0; for (let i = 0; i < P.smaN; i++){ const v = at(px, 'BTC', d - i * DAY); if (v){ sma += v; n += 1; } }
  const filterOn = !(btc && n >= P.smaN * 0.95 && btc > sma / n); // מזומן כש-BTC מתחת לממוצע 200 (או כשאין מספיק נתונים)
  const cand = [];
  for (const c of P.universe){
    const now = at(px, c, d), then = at(px, c, d - P.lookback * DAY), old = at(px, c, d - Math.max(P.lookback, P.minHist) * DAY);
    if (now && then && old) cand.push({ coin: c, ret: r4(now / then - 1) });
  }
  cand.sort((a, b) => b.ret - a.ret);
  const chosen = filterOn ? [] : cand.slice(0, P.top).filter((x) => x.ret > 0);
  return { filterOn, btcVsSma: n ? r4(btc / (sma / n) - 1) : null, chosen, top5: cand.slice(0, 5) };
}

export function newState(nowMs = Date.now(), P = XS){
  return { v: P.version, id: P.id, startedAt: new Date(nowMs).toISOString(), startDay: null, lastDay: null, startUsd: P.startUsd, equity: P.startUsd,
    btcStart: null, btcEquity: P.startUsd, weights: {}, costsUsd: 0, rebalances: [], daily: [] };
}

// מקדם את המצב על כל יום סגור חדש: שערוך יומי לפי המשקלות, ובסגירת יום ראשון — החלפת התיק. ביום הראשון של המעקב: הקצאה מיד.
export function step(prev, closes, P = XS){
  const s = prev && prev.v === P.version ? JSON.parse(JSON.stringify(prev)) : newState(Date.now(), P);
  const { px, days } = index(closes);
  const btcDays = days.filter((d) => at(px, 'BTC', d));
  const todo = s.lastDay === null ? btcDays.slice(-1) : btcDays.filter((d) => d > Date.parse(s.lastDay)); // התחלה: היום הסגור האחרון בלבד (בלי שחזור עבר)
  const slip = (c) => (P.slipBps[c] ?? P.slipOther) / 1e4;
  const events = [];
  for (const d of todo){
    const first = s.lastDay === null;
    if (!first){
      const pd = Date.parse(s.lastDay);
      let r = 0; const nw = {};
      for (const [c, w] of Object.entries(s.weights)){ const a = at(px, c, pd), b = at(px, c, d); const g = a && b ? b / a - 1 : 0; r += w * g; nw[c] = w * (1 + g); }
      s.equity *= 1 + r;
      const tot = 1 + r; for (const c of Object.keys(nw)) nw[c] = nw[c] / tot; s.weights = nw;
    } else { s.startDay = new Date(d).toISOString().slice(0, 10); s.btcStart = at(px, 'BTC', d); }
    s.btcEquity = s.startUsd * at(px, 'BTC', d) / s.btcStart;
    if (first || new Date(d).getUTCDay() === P.rebalanceDow){
      const p = picks(closes, d, P), tgt = Object.fromEntries(p.chosen.map((x) => [x.coin, 1 / P.top]));
      let cost = 0, turn = 0;
      for (const c of new Set([...Object.keys(tgt), ...Object.keys(s.weights)])){ const dw = Math.abs((tgt[c] || 0) - (s.weights[c] || 0)); turn += dw; cost += dw * (P.spotBps / 1e4 + slip(c)); }
      const costUsd = s.equity * cost; s.equity -= costUsd; s.costsUsd += costUsd; s.weights = tgt;
      const ev = { day: new Date(d).toISOString().slice(0, 10), picks: p.chosen, cash: !p.chosen.length, filterOn: p.filterOn, btcVsSma: p.btcVsSma, turnover: r4(turn), costUsd: r2(costUsd), equity: r2(s.equity) };
      s.rebalances.push(ev); events.push(ev);
    }
    s.daily.push({ day: new Date(d).toISOString().slice(0, 10), equity: r2(s.equity), btc: r2(s.btcEquity) });
    s.lastDay = new Date(d).toISOString();
  }
  s.rebalances = s.rebalances.slice(-300); s.daily = s.daily.slice(-500);
  s.equity = r2(s.equity); s.btcEquity = r2(s.btcEquity); s.costsUsd = r2(s.costsUsd);
  for (const c of Object.keys(s.weights)) s.weights[c] = r4(s.weights[c]);
  return { state: s, events, processed: todo.length };
}
