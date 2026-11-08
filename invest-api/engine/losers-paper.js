// מעקב Paper Trading קדימה ל"3 המניות שירדו 3%–7%" (LOS3-mild-CC) — הכלל היחיד שהרוויח גם ב-3 החודשים (8–11/2026) וגם ב-21 החודשים
// שלפניהם בחיפוש של invest/docs/research/losers-sim.md. **לא הוכח** (מספר הכללים העקביים שם לא עלה על מה שמזל מייצר, וירידה מקס׳ של
// −53% בעבר) — לכן רק מעקב וירטואלי. בקשת מאיר (8/11/2026): "שים במעקב".
// תיק וירטואלי בלבד: אין כסף, אין פקודות, אין מפתחות. פונקציה טהורה: מצב קודם + נרות יומיים סגורים → מצב חדש.
// הכלל (זהה ל-research-losers-grid.mjs, { side: 'L', sel: 'lo', N: 3, filt: 'mild', entry: 'C', exit: 'close', hold: 1 }):
//   בסגירת כל יום מסחר — מבין מניות S&P 1500 במחיר מעל 5$ ומחזור ממוצע של 20 יום מעל 20M$, ש-ירדו היום בין 3% ל-7% (תשואה מתוקנת
//   פיצולים) — קונים את 3 שירדו הכי הרבה, בשליש מההון כל אחת (מניות שלמות), ומוכרים בסגירה של יום המסחר הבא.
// עלויות כמו במחקר: עמלת IBKR Pro Fixed (0.005$ למניה, מינימום 1$, מקסימום 1%), עמלות רגולטור במכירה, החלקה 0.05% לכל צד.
// השוני מהמחקר: בפועל אי אפשר לקנות בדיוק במחיר הסגירה אחרי שראינו אותו (צריך פקודת MOC עם המחיר של 15:50) — כאן, כמו במחקר, מחיר הסגירה.

export const LOS = Object.freeze({ version: 1, id: 'LOS3-mild-CC', N: 3, lo: -0.07, hi: -0.03, minPx: 5, minAdv: 20e6, advN: 20, startUsd: 50000, slip: 0.0005 });
const r2 = (x) => Math.round(x * 100) / 100, r4 = (x) => Math.round(x * 1e4) / 1e4;
export const comm = (sh, px) => Math.min(Math.max(1, 0.005 * sh), 0.01 * sh * px);
export const sellFees = (sh, px) => 0.0000278 * sh * px + Math.min(0.000166 * sh, 8.3);

// bars: { SYM: { d: ['YYYY-MM-DD'...], o, c, v, sp: [[day, ratio]] } } (כמו daily() במחקר), כולל SPY — ציר הימים
export function index(bars){
  const spy = bars.SPY, days = spy?.d || [], dk = new Map(days.map((d, k) => [d, k])), S = {};
  for (const [s, b] of Object.entries(bars)){
    if (s === 'SPY' || !b?.d?.length) continue;
    const n = b.d.length, f = new Float64Array(n).fill(1);
    for (const [d, ratio] of b.sp || []) for (let i = 0; i < n && b.d[i] < d; i++) f[i] *= ratio;
    S[s] = { b, f, K: b.d.map((d) => dk.get(d) ?? -1), at: new Map(b.d.map((d, i) => [d, i])) };
  }
  return { days, S };
}

// 3 המועמדות של יום k (רק מידע עד סגירת k)
export function picks(I, k, P = LOS){
  const out = [];
  for (const [s, X] of Object.entries(I.S)){
    const i = X.at.get(I.days[k]); if (i === undefined || i < P.advN || X.K[i - 1] !== k - 1) continue;
    const b = X.b; if (b.c[i] <= P.minPx) continue;
    let adv = 0; for (let j = i - P.advN; j < i; j++) adv += b.c[j] * (b.v[j] || 0); adv /= P.advN;
    if (adv < P.minAdv) continue;
    const r = (b.c[i] / X.f[i]) / (b.c[i - 1] / X.f[i - 1]) - 1;
    if (r < P.hi && r >= P.lo) out.push({ s, r, px: b.c[i] });
  }
  return out.sort((a, b) => a.r - b.r || (a.s < b.s ? -1 : 1)).slice(0, P.N);
}

export function newState(nowMs = Date.now(), P = LOS){
  return { v: P.version, id: P.id, startedAt: new Date(nowMs).toISOString(), startDay: null, lastDay: null, startUsd: P.startUsd, equity: P.startUsd, cash: P.startUsd,
    spyStart: null, spyEquity: P.startUsd, pos: [], feesUsd: 0, trades: [], daily: [] };
}

// מקדם על כל יום מסחר (לפי SPY) שאחרי lastDay. ריצה ראשונה: נכנסים רק ביום האחרון, בלי שחזור עבר.
export function step(prev, bars, P = LOS){
  const s = prev && prev.v === P.version && prev.id === P.id ? JSON.parse(JSON.stringify(prev)) : newState(Date.now(), P);
  const I = index(bars), { days } = I;
  const first = s.lastDay === null;
  const todo = first ? (days.length ? [days.length - 1] : []) : days.map((d, k) => k).filter((k) => days[k] > s.lastDay);
  const events = [];
  for (const k of todo){
    const d = days[k];
    // 1. יציאה בסגירה מהפוזיציות של אתמול (אם למניה אין נר היום — מחזיקים עד הנר הבא שלה)
    const keep = [];
    for (const p of s.pos){
      const X = I.S[p.s], i = X?.at.get(d); if (i === undefined){ keep.push(p); continue; }
      const raw = X.b.c[i], sp = raw * (1 - P.slip), fee = comm(p.sh, sp) + sellFees(p.sh, sp);
      s.cash += p.sh * sp - fee; s.feesUsd += fee;
      const pnl = p.sh * (sp - p.bp) - p.feeIn - fee;
      const tr = { s: p.s, in: p.day, out: d, r: p.r, entry: p.entry, exit: raw, sh: p.sh, pnlUsd: r2(pnl), pnlPct: r4(pnl / (p.sh * p.bp)) };
      s.trades.push(tr); events.push({ type: 'exit', ...tr });
    }
    s.pos = keep;
    // 2. כניסה בסגירה ל-3 החדשות (שליש מההון לכל אחת; ההון = מזומן + שווי מה שעדיין מוחזק)
    const held = s.pos.reduce((a, p) => a + p.sh * p.bp, 0), eq = s.cash + held, per = eq / P.N;
    for (const x of picks(I, k, P)){
      if (s.pos.some((p) => p.s === x.s)) continue;
      const bp = x.px * (1 + P.slip), sh = Math.floor(per / bp); if (sh < 1) continue;
      const fee = comm(sh, bp); s.cash -= sh * bp + fee; s.feesUsd += fee;
      s.pos.push({ s: x.s, day: d, r: r4(x.r), entry: x.px, bp, sh, feeIn: fee });
      events.push({ type: 'entry', s: x.s, day: d, r: r4(x.r), price: x.px, sh, usd: r2(sh * bp) });
    }
    // שווי: מזומן + פוזיציות במחיר הכניסה (נקנו הרגע בסגירה)
    s.equity = s.cash + s.pos.reduce((a, p) => a + p.sh * p.bp, 0);
    if (!s.startDay){ s.startDay = d; s.spyStart = bars.SPY.c[k]; }
    s.spyEquity = s.startUsd * bars.SPY.c[k] / s.spyStart;
    s.daily.push({ day: d, equity: r2(s.equity), spy: r2(s.spyEquity), n: s.pos.length });
    s.lastDay = d;
  }
  s.trades = s.trades.slice(-500); s.daily = s.daily.slice(-500);
  s.equity = r2(s.equity); s.cash = r2(s.cash); s.spyEquity = r2(s.spyEquity); s.feesUsd = r2(s.feesUsd);
  s.pos = s.pos.map((p) => ({ ...p, bp: r4(p.bp), feeIn: r4(p.feeIn) }));
  return { state: s, events, processed: todo.length };
}
