// מעקב וירטואלי שני ונפרד — המומנטום של מחקר 7ל: 38 המטבעות של Bybit, 7 מנות, החלפה שבועית, שתי ההגנות (א. תקרה 15% למטבע,
// ב. יעד תנודתיות 40%). החלטת מאיר (15/11/2026). תיק וירטואלי בלבד — אין כסף, אין פקודות, אין מפתחות מסחר.
// נפרד לגמרי מ-XSRA-7 המקורי (engine/xsra-paper.js): מזהה אחר, מפתח KV אחר (paper:xsrb), נתיב אחר (/xsrb), משימה מתוזמנת אחרת
// (xsra-bybit-paper.yml) — ולא קורא ולא כותב שום דבר שלו, חוץ מקריאה ציבורית של GET /xsra לצורך השוואה.
//
// אין כאן כללים חדשים: כל יום מריצים מחדש את אותה פונקציה בדיוק כמו במחקר (simulate ב-engine/xsra-protect.js, גרסה AB),
// על אותם נתונים (נרות יומיים של Coinbase), אותו יקום (38 המטבעות, כל אחד רק מיום הרישום שלו ב-Bybit), ואותה עלות
// (עמלה 0.1% + החלקה לפי ספר הפקודות של Bybit בפקודה של 5,000$, C5 של scripts/research-bybit-horizons.mjs). אין אופטימיזציה.
// משקיע חדש מיום ההתחלה (startIdx, כמו בחלונות של 7ל): ההחלטה בסגירת יום d−1, הביצוע בפתיחת יום d.
//
// יום ההתחלה נקבע בריצה הראשונה: חצות UTC שאחרי הריצה — כך העסקה הראשונה מתבצעת במחיר שעוד לא היה ידוע בזמן הפתיחה.
// היסטוריה נעולה: ימים שכבר נשמרו לא משתנים. הימים החדשים נשרשרים לשווי האחרון שנשמר לפי התשואה היומית של ההרצה מחדש,
// כך שתיקון קטן של נרות ישנים אצל Coinbase לא משכתב את העבר (הפער נמדד ונשמר ב-replayDrift).
import { align, DCOST } from './research-daily.js';
import { simulate, PROTECT } from './xsra-protect.js';

// תאריכי הרישום וההחלקה בספר הפקודות — העתק מדויק של invest/docs/research/xs-protect/bybit-probe.json (בדיקה ב-tests)
const LISTING = { BTC: '2021-07-05', ETH: '2021-07-05', SOL: '2021-10-21', XRP: '2021-07-20', LINK: '2021-09-22', AAVE: '2021-09-23', DOGE: '2021-08-31', UNI: '2021-09-22', LTC: '2021-08-31',
  ADA: '2021-10-21', XLM: '2021-09-06', AVAX: '2021-11-12', ICP: '2021-10-10', BCH: '2021-10-10', MANA: '2021-09-30', SHIB: '2021-12-06', DOT: '2021-08-31', BAT: '2021-10-19', CRV: '2021-10-16',
  ATOM: '2021-11-12', FIL: '2021-10-21', ALGO: '2021-11-12', ZEN: '2021-12-16', GRT: '2021-10-22', CHZ: '2021-09-30', ETC: '2022-07-28', SAND: '2021-11-02', XTZ: '2021-10-10', SUSHI: '2021-09-22',
  SNX: '2021-12-01', '1INCH': '2021-12-02', COMP: '2021-09-23', YFI: '2021-09-22', AXS: '2021-09-30', ENJ: '2021-11-09', ZRX: '2021-10-19', UMA: '2021-12-02', LRC: '2021-12-03' };
const BUY5K = { BTC: 0, ETH: 0, SOL: 1, XRP: 1.7, LINK: 5.3, AAVE: 7, DOGE: 2.7, UNI: 9.3, LTC: 8.4, ADA: 7.7, XLM: 10.6, AVAX: 12, ICP: 16.7, BCH: 6.8, MANA: 33.6, SHIB: 6, DOT: 10.7, BAT: 22.1,
  CRV: 11.5, ATOM: 14.7, FIL: 5.7, ALGO: 15.7, ZEN: 26.2, GRT: 40.8, CHZ: 27.1, ETC: 16.8, SAND: 28.5, XTZ: 30, SUSHI: 16.2, SNX: 53.1, '1INCH': 26.5, COMP: 32.1, YFI: 19.8, AXS: 36.2, ENJ: 35.8,
  ZRX: 196.4, UMA: 50.2, LRC: 1535.7 };

export const XSRB = Object.freeze({
  version: 1, id: 'XSRA-7-BYBIT-AB', startUsd: 50000, lookbackDays: 200,
  universe: Object.freeze(Object.keys(LISTING)), listing: Object.freeze(LISTING), buy5k: Object.freeze(BUY5K),
  protect: Object.freeze({ capCoin: PROTECT.capCoin, volTarget: PROTECT.volTarget }), // גרסה AB של מחקר 7ל
  // כללים שנקבעו מראש (החלטת מאיר 15/11/2026): התראה בירידה של 35%, פסילה בירידה של 45% (המעקב ממשיך לאסוף נתונים ושום דבר לא נמחק),
  // ובחינה אחרי 12 חודשים — פיגור מול ביטקוין וסיכון יחסי, באותו כלל כמו XSRA-7 המקורי: נכשל אם מפגר ביותר מ-20 נק' וגם הירידה
  // גדולה משל ביטקוין; עבר אם מנצח את ביטקוין עם ירידה קטנה יותר; אחרת — החלטה של מאיר.
  rules: Object.freeze({ alertDd: 0.35, killDd: 0.45, months: 12, lagPts: 0.20 }),
});
// העלות — בדיוק C5 של מחקר 7ל
export const COST = Object.freeze({ ...DCOST, slipBps: Object.freeze(Object.fromEntries(XSRB.universe.map((c) => [c, Math.max(DCOST.slipBps[c] ?? DCOST.slipOther, XSRB.buy5k[c] ?? 300)]))) });
const DAY = 86400e3, MIN_HIST = 120, TAIL_WAIT = 3;
const r2 = (x) => Math.round(x * 100) / 100, r4 = (x) => Math.round(x * 1e4) / 1e4, r6 = (x) => Math.round(x * 1e6) / 1e6;
const dayIso = (t) => new Date(t).toISOString().slice(0, 10);
const listT = Object.fromEntries(Object.entries(LISTING).map(([c, d]) => [c, Date.parse(d + 'T00:00:00Z')]));
const btcRate = () => (COST.spotBps + (COST.slipBps.BTC ?? COST.slipOther)) / 1e4;

export function alignBars(bars, P = XSRB){
  return align(Object.fromEntries(Object.entries(bars || {}).filter(([c, b]) => P.universe.includes(c) && b?.length)));
}

// הרצה מחדש של מחקר 7ל (גרסה AB) ממשקיע חדש ביום startMs. מחזיר את כל מה שצריך לתיעוד: סדרה, עסקאות, משקלות ותרומה לפי מטבע.
export function replay(A, startMs, P = XSRB){
  const si = A.days.indexOf(startMs);
  if (si < MIN_HIST) throw new Error(`אין מספיק היסטוריה לפני יום ההתחלה (${si} ימים, צריך ${MIN_HIST})`);
  const allow = (k, t) => t >= (listT[A.coins[k]] ?? Infinity);
  const trades = [];
  const res = simulate(A, { ...P.protect, allow, C: COST, startIdx: si, trace: true, onTrade: (e) => { if (e.d >= si) trades.push(e); } });
  return { si, ...res, trades };
}

export function newState(startDay, nowMs = Date.now(), P = XSRB){
  return { v: P.version, id: P.id, startedAt: new Date(nowMs).toISOString(), startDay, lastDay: null, startUsd: P.startUsd, equity: P.startUsd,
    btcEquity: P.startUsd, peak: P.startUsd, maxDD: 0, btcPeak: P.startUsd, btcMaxDD: 0, costsUsd: 0, turnover: 0, xsraBase: null, replayDrift: 0,
    flags: { alert: null, kill: null }, weights: {}, contrib: {}, daily: [], trades: [] };
}

// prev: המצב השמור (או null), bars: נרות יומיים סגורים לכל מטבע, xsraRep: GET /xsra (לקריאה בלבד, להשוואה)
export function step(prev, bars, xsraRep = null, nowMs = Date.now(), P = XSRB){
  const A = alignBars(bars, P), iB = A.coins.indexOf('BTC');
  if (iB < 0) throw new Error('אין נרות BTC');
  if (!(prev && prev.v === P.version && prev.id === P.id && prev.startDay)){
    // ריצה ראשונה: קובעים את יום ההתחלה ולא סוחרים עדיין. יום ההתחלה = חצות UTC הבאה (וגם אחרי הנר הסגור האחרון), כך שמחיר
    // הפתיחה של העסקה הראשונה עוד לא היה ידוע בזמן הפתיחה
    const last = A.days.filter((d) => Number.isFinite(A.C[iB][A.days.indexOf(d)])).at(-1);
    const start = Math.max(last + DAY, Math.floor(nowMs / DAY) * DAY + DAY);
    return { state: newState(dayIso(start), nowMs, P), processed: 0, created: true, events: [] };
  }
  const s = JSON.parse(JSON.stringify(prev)), startMs = Date.parse(s.startDay + 'T00:00:00Z');
  if (A.days.indexOf(startMs) < 0) return { state: s, processed: 0, events: [], waiting: true };
  const R = replay(A, startMs, P), K = A.coins.length, si = R.si;
  const lastMs = s.lastDay ? Date.parse(s.lastDay + 'T00:00:00Z') : null;
  // ימים חדשים: מיום ההתחלה, אחרי היום האחרון שנשמר. מטבע מוחזק בלי נר באחד מ-3 הימים האחרונים — מחכים (תקלה זמנית במקור),
  // כדי שלא תירשם "מכירה" שלא קרתה; אחרי 3 ימים זה נחשב יציאה מהמסחר, כמו במחקר.
  let todo = [];
  for (let d = si; d < A.days.length; d++){
    if (lastMs !== null && A.days[d] <= lastMs) continue;
    const gap = (k) => R.wtr[(d - 1) * K + k] > 0 && !(Number.isFinite(A.O[k][d]) && Number.isFinite(A.C[k][d]));
    if (!Number.isFinite(A.C[iB][d]) || (A.days.length - d <= TAIL_WAIT && A.coins.some((_, k) => gap(k)))) break;
    todo.push(d);
  }
  if (!todo.length) return { state: s, processed: 0, events: [] };
  // השווי של ההרצה מחדש (יחידות: 1 = ההון ביום ההתחלה), ושרשור לשווי השמור
  const E = new Float64Array(A.days.length).fill(1);
  for (let d = si; d < A.days.length; d++) E[d] = (d > si ? E[d - 1] : 1) * (1 + R.series[d - 1].net);
  const prevE = (d) => (d > si ? E[d - 1] : 1);
  const anchorD = lastMs === null ? null : A.days.indexOf(lastMs);
  if (anchorD !== null && anchorD < 0) throw new Error('היום האחרון שנשמר לא נמצא בנרות');
  const anchor = anchorD === null ? 1 : E[anchorD], scale = (lastMs === null ? s.startUsd : s.equity) / anchor;
  if (anchorD !== null) s.replayDrift = r6(E[anchorD] * s.startUsd / s.equity - 1);
  const xsDay = new Map((xsraRep?.daily || []).map((x) => [x.day, x.equity]));
  if (s.xsraBase === null && xsraRep?.daily?.length){ const b = xsDay.get(dayIso(startMs - DAY)) ?? xsDay.get(s.startDay); if (Number.isFinite(b)) s.xsraBase = { day: xsDay.has(dayIso(startMs - DAY)) ? dayIso(startMs - DAY) : s.startDay, equity: b }; }
  const bO = A.O[iB][si], fb = btcRate(), set = new Set(todo), events = [];
  for (const t of R.trades){ if (!set.has(t.d)) continue; const e = { day: dayIso(A.days[t.d]), sleeve: t.sleeve, coin: A.coins[t.k], side: t.side, usd: r2(t.usd * scale), fee: r2(t.fee * scale) };
    s.trades.push(e); events.push(e); s.costsUsd += t.fee * scale; }
  for (const d of todo){
    for (let k = 0; k < K; k++){ const x = R.contrib[d * K + k]; if (x) s.contrib[A.coins[k]] = (s.contrib[A.coins[k]] || 0) + x * prevE(d) * scale; }
    s.turnover += R.series[d - 1].turn * prevE(d) * scale / s.startUsd; // מחזור מצטבר ביחס להון ההתחלתי
    const eq = E[d] * scale, btc = s.startUsd * (1 - fb) * A.C[iB][d] / bO, day = dayIso(A.days[d]);
    s.peak = Math.max(s.peak, eq); const dd = 1 - eq / s.peak; s.maxDD = Math.max(s.maxDD, dd);
    s.btcPeak = Math.max(s.btcPeak, btc); s.btcMaxDD = Math.max(s.btcMaxDD, 1 - btc / s.btcPeak);
    if (s.maxDD >= P.rules.alertDd && !s.flags.alert) s.flags.alert = day;
    if (s.maxDD >= P.rules.killDd && !s.flags.kill) s.flags.kill = day;
    const xv = xsDay.get(day);
    s.daily.push({ day, equity: r2(eq), btc: r2(btc), xsra: Number.isFinite(xv) ? xv : null, dd: r4(dd), exp: r4(R.series[d - 1].exp), cost: r2(R.series[d - 1].cost * prevE(d) * scale) });
    s.equity = eq; s.btcEquity = btc; s.lastDay = day;
  }
  const dl = todo.at(-1); s.weights = {};
  for (let k = 0; k < K; k++){ const w = R.wtr[dl * K + k]; if (w > 1e-5) s.weights[A.coins[k]] = r4(w); }
  s.daily = s.daily.slice(-1500); s.trades = s.trades.slice(-8000);
  for (const c of Object.keys(s.contrib)) s.contrib[c] = r2(s.contrib[c]);
  Object.assign(s, { equity: r2(s.equity), btcEquity: r2(s.btcEquity), peak: r2(s.peak), btcPeak: r2(s.btcPeak), maxDD: r4(s.maxDD), btcMaxDD: r4(s.btcMaxDD), costsUsd: r2(s.costsUsd), turnover: r4(s.turnover) });
  return { state: s, processed: todo.length, events };
}

// תנודתיות שנתית מתוך שורות יומיות
const annVol = (xs) => { const r = []; for (let i = 1; i < xs.length; i++) if (xs[i - 1] > 0 && xs[i] > 0) r.push(xs[i] / xs[i - 1] - 1); if (r.length < 2) return null;
  const m = r.reduce((a, x) => a + x, 0) / r.length; return Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (r.length - 1) * 365); };

// מצב המעקב לפי הכללים שנקבעו מראש. פסילה לא עוצרת את איסוף הנתונים.
export function verdict(s, P = XSRB, nowMs = Date.now()){
  if (!s?.startDay || !s.daily?.length) return { status: 'waiting' };
  const r = s.equity / s.startUsd - 1, b = s.btcEquity / s.startUsd - 1, months = (nowMs - Date.parse(s.startDay + 'T00:00:00Z')) / (30.44 * DAY);
  const xr = s.xsraBase && s.daily.at(-1).xsra ? s.daily.at(-1).xsra / s.xsraBase.equity - 1 : null;
  const v = annVol([s.startUsd, ...s.daily.map((x) => x.equity)]), vb = annVol([s.startUsd * (1 - btcRate()), ...s.daily.map((x) => x.btc)]);
  const risk = { ddRatio: s.btcMaxDD > 0 ? s.maxDD / s.btcMaxDD : null, volRatio: v && vb ? v / vb : null, vol: v, btcVol: vb };
  const base = { r, b, xr, lag: b - r, months, risk };
  if (s.flags?.kill) return { status: 'disqualified', ...base };
  if (months < P.rules.months) return { status: s.flags?.alert ? 'alert' : 'running', ...base };
  if (b - r > P.rules.lagPts && s.maxDD > s.btcMaxDD) return { status: 'fail', ...base };
  return { status: r > b && s.maxDD < s.btcMaxDD ? 'pass' : 'decide', ...base };
}
