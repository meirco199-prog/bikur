// מעקב Paper Trading קדימה לפריצת תנודתיות תוך-יומית על BTC/ETH (VBO0.7-ma20-BE) — הגרסה הקצרה היחידה שעברה את מבחן המחקר השעתי
// (invest/docs/research/crypto-hourly.md, PR #220). בקשת מאיר (7/11/2026): "כן, תפעיל את בוט A במעקב וירטואלי".
// תיק וירטואלי בלבד: אין כסף, אין פקודות, אין מפתחות. פונקציה טהורה: מצב קודם + נרות שעה סגורים → מצב חדש.
// הכלל (זהה למנוע engine/research-hourly.js): לכל מטבע, בסגירת כל נר שעה (חוץ מ-23:00 UTC) — אם המחיר מעל פתיחת היום (00:00 UTC) ועוד
// 0.7 × הטווח של אתמול (שיא−שפל), וסגירת אתמול מעל הממוצע של 20 הסגירות היומיות האחרונות → קונים בחצי מההון. יוצאים בסגירת הנר
// של 23:00 UTC (סוף היום). עסקה אחת לכל היותר למטבע ביום. בלי סטופ, בלי מינוף.
// עלויות כמו במחקר: עמלת חוזה 0.055% + החלקה 0.02% לכל צד, Funding משוער 0.03% ליום על לונג.
// השוני מהמחקר: הביצוע במחיר הסגירה של הנר (במחקר: פתיחת הנר הבא — כמעט אותו מחיר), וגודל הפוזיציה קבוע מהכניסה (במחקר: משקל קבוע).

export const VBO = Object.freeze({
  version: 1, id: 'VBO0.7-ma20-BE', coins: ['BTC', 'ETH'], k: 0.7, maN: 20, weight: 0.5, startUsd: 10000,
  perpBps: 5.5, slipBps: 2, longFundBpsDay: 3,
});
const HOUR = 3600e3, DAY = 86400e3;
const r2 = (x) => Math.round(x * 100) / 100, r4 = (x) => Math.round(x * 1e4) / 1e4;
const iso = (t) => new Date(t).toISOString();

// { coin: [{t,o,h,l,c}] } (נרות שעה סגורים) → לכל מטבע: מפה t → נר, וסיכום יומי (פתיחה, שיא, שפל, סגירה) לפי יום UTC
function index(bars, P){
  const by = {}, hours = new Set();
  for (const c of P.coins){
    const m = new Map(), days = new Map();
    for (const b of bars?.[c] || []){
      if (!(b.c > 0 && b.o > 0)) continue;
      const t = Math.floor(b.t / HOUR) * HOUR; m.set(t, b); hours.add(t);
    }
    for (const t of [...m.keys()].sort((a, b) => a - b)){
      const b = m.get(t), d = Math.floor(t / DAY) * DAY, x = days.get(d);
      if (!x) days.set(d, { o: b.o, h: b.h, l: b.l, c: b.c, last: t });
      else { x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.c = b.c; x.last = t; }
    }
    by[c] = { m, days };
  }
  return { by, hours: [...hours].sort((a, b) => a - b) };
}

// האם יש אות כניסה למטבע בסגירת הנר t (רק מידע עד t כולל)
export function signal(bars, coin, t, P = VBO){
  const { by } = index(bars, P), X = by[coin]; if (!X) return null;
  return sig(X, t, P);
}
function sig(X, t, P){
  const b = X.m.get(t); if (!b) return null;
  const d = Math.floor(t / DAY) * DAY, today = X.days.get(d), prev = X.days.get(d - DAY);
  if (!today || !prev) return { ok: false, why: 'אין נתוני אתמול' };
  const closes = []; for (let i = 1; i <= P.maN; i++){ const x = X.days.get(d - i * DAY); if (x) closes.push(x.c); }
  if (closes.length < P.maN * 0.9) return { ok: false, why: 'אין מספיק ימים לממוצע' };
  const ma = closes.reduce((s, x) => s + x, 0) / closes.length, trig = today.o + P.k * (prev.h - prev.l);
  return { ok: b.c > trig && prev.c > ma, close: b.c, trig: r2(trig), dayOpen: today.o, prevRange: r2(prev.h - prev.l), ma: r2(ma), prevClose: prev.c };
}

export function newState(nowMs = Date.now(), P = VBO){
  return { v: P.version, id: P.id, startedAt: iso(nowMs), startDay: null, lastHour: null, startUsd: P.startUsd, equity: P.startUsd,
    btcStart: null, btcEquity: P.startUsd, pos: {}, costsUsd: 0, fundUsd: 0, trades: [], daily: [] };
}

// מקדם את המצב על כל נר שעה סגור חדש (גם כמה ביחד — אותה תוצאה כמו ריצה כל שעה, כי כל נר מעובד לפי הסדר ורק עם מידע עד אליו).
// ריצה ראשונה: מתחילים מהנר הסגור האחרון, בלי שחזור עבר ובלי פוזיציה.
export function step(prev, bars, P = VBO){
  const s = prev && prev.v === P.version && prev.id === P.id ? JSON.parse(JSON.stringify(prev)) : newState(Date.now(), P);
  const { by, hours } = index(bars, P), B = by.BTC;
  // ציר הזמן = איחוד השעות של כל המטבעות (כמו alignH במנוע המחקר): שעה שחסרה ל-BTC עדיין מעובדת ל-ETH (הערת GPT ב-#221)
  const first = s.lastHour === null;
  const todo = first ? hours.slice(-1) : hours.filter((t) => t > Date.parse(s.lastHour));
  const rate = (P.perpBps + P.slipBps) / 1e4, fundHour = P.longFundBpsDay / 1e4 / 24;
  const events = [];
  for (const t of todo){
    const end = t + HOUR, hour = new Date(t).getUTCHours();
    if (first) s.startDay = iso(end).slice(0, 10);
    if (!s.btcStart && B?.m.get(t)) s.btcStart = B.m.get(t).c; // מדד ההשוואה מתחיל בנר ה-BTC הראשון שיש
    for (const c of P.coins){
      const X = by[c], b = X.m.get(t), p = s.pos[c];
      if (p && b){ // שערוך שעתי + Funding
        const g = p.notional * (b.c / p.last - 1), f = p.notional * fundHour;
        s.equity += g - f; s.fundUsd += f; p.fund += f; p.notional *= b.c / p.last; p.last = b.c;
      }
      if (first) continue; // בנר הראשון רק מתחילים למדוד
      if (p && hour === 23){ // יציאה בסוף היום — גם אם נר 23:00 של המטבע חסר (אז במחיר האחרון הידוע, כמו המילוי קדימה במנוע המחקר)
        const cost = p.notional * rate; s.equity -= cost; s.costsUsd += cost;
        const pnl = p.notional - p.usdIn - p.costIn - cost - p.fund;
        const tr = { coin: c, in: p.t, out: iso(end), entry: p.entry, exit: p.last, usd: r2(p.usdIn), pnlUsd: r2(pnl), pnlPct: r4(pnl / p.usdIn) };
        s.trades.push(tr); events.push({ type: 'exit', ...tr }); delete s.pos[c];
        continue;
      }
      if (p) continue;
      if (hour === 23 || !b) continue;
      const q = sig(X, t, P);
      if (q?.ok && s.lastDayIn?.[c] !== iso(t).slice(0, 10)){
        const usd = s.equity * P.weight, cost = usd * rate; s.equity -= cost; s.costsUsd += cost;
        s.pos[c] = { t: iso(end), entry: b.c, last: b.c, notional: usd, usdIn: usd, costIn: cost, fund: 0, trig: q.trig };
        s.lastDayIn = { ...(s.lastDayIn || {}), [c]: iso(t).slice(0, 10) };
        events.push({ type: 'entry', coin: c, at: iso(end), price: b.c, trig: q.trig, usd: r2(usd) });
      }
    }
    if (B?.m.get(t) && s.btcStart) s.btcEquity = s.startUsd * B.m.get(t).c / s.btcStart;
    if (hour === 23) s.daily.push({ day: iso(t).slice(0, 10), equity: r2(s.equity), btc: r2(s.btcEquity) });
    s.lastHour = iso(t);
  }
  s.trades = s.trades.slice(-500); s.daily = s.daily.slice(-500);
  s.equity = r2(s.equity); s.btcEquity = r2(s.btcEquity); s.costsUsd = r2(s.costsUsd); s.fundUsd = r2(s.fundUsd);
  return { state: s, events, processed: todo.length };
}
