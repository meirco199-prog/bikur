// מעקב Paper Trading קדימה למומנטום בין מטבעות "משודרג", 7 מנות (research/xs-ra/report.md סעיף 6, RESEARCH_RESULTS 7יח).
// בקשת מאיר (13/11/2026), אחרי שגם GPT המליץ: מעקב וירטואלי בלבד ל-12 חודשים, בלי לשנות שורת קוד — אין כסף, אין פקודות, אין מפתחות.
// הכללים — אותה פונקציה בדיוק כמו במחקר (xsRiskAdj ב-engine/research-daily.js): יקום של 15 המטבעות עם הנפח הדולרי הגבוה ב-30 יום,
// BTC מעל ממוצע 100 (אחרת מזומן), מטבע מעל ממוצע 50 שלו, דירוג תשואת 21 יום / סטיית התקן היומית, 4 מטבעות × 25%.
// 7 מנות של 1/7 מההון: מנה k מוחלפת בסגירת יום k בשבוע (UTC, 0 = ראשון). כל מנה תיק עצמאי — המשקלות זזים עם המחירים, בלי איזון בין מנות.
// השוני מהמחקר: הביצוע במחיר הסגירה של יום ההחלפה (במחקר: פתיחת היום שאחרי — כמעט אותו מחיר). ביום הראשון כל 7 המנות מוקצות מיד.
// עלות כל שינוי: עמלת ספוט 0.1% + החלקה (0.02% BTC/ETH, 0.05% השאר) לכל צד. פונקציה טהורה: מצב קודם + נרות יומיים סגורים → מצב חדש.
import { align, xsRiskAdj, XSRA } from './research-daily.js';

export const XSRAP = Object.freeze({
  version: 1, id: 'XSRA-7', sleeves: 7, startUsd: 10000, spotBps: 10, slipBps: { BTC: 2, ETH: 2 }, slipOther: 5, P: XSRA,
  // אותם 50 מועמדים כמו במחקר (מטבע שכבר לא נסחר פשוט לא יחזיר נרות)
  universe: ['BTC', 'ETH', 'LTC', 'BCH', 'LINK', 'XLM', 'ETC', 'ADA', 'SOL', 'DOGE', 'AVAX', 'DOT', 'UNI', 'ATOM', 'XRP', 'AAVE', 'FIL', 'ALGO', 'XTZ', 'ZEC',
    'ICP', 'GRT', 'SUSHI', 'CRV', 'COMP', 'SNX', 'BAT', 'ZRX', 'MKR', 'YFI', 'UMA', 'SHIB', 'MANA', 'SAND', 'AXS', 'CHZ', 'OMG', 'REP', 'DASH', 'EOS', 'ZEN', 'KNC', 'BAND', 'NMR', 'LRC', 'ENJ', '1INCH', 'MATIC', 'BNT', 'STORJ'],
  // כללי ההחלטה — נקבעו מראש (13/11/2026, Claude + GPT, החלטת מאיר): 12 חודשים
  decision: { months: 12, killLagPts: 0.20, killDd: 0.55 },
});
const DAY = 86400e3;
const r2 = (x) => Math.round(x * 100) / 100, r4 = (x) => Math.round(x * 1e4) / 1e4;
const dayIso = (d) => new Date(d).toISOString().slice(0, 10);
const sameW = (a, b) => { const k = new Set([...Object.keys(a), ...Object.keys(b)]); for (const c of k) if (Math.abs((a[c] || 0) - (b[c] || 0)) > 1e-12) return false; return true; };

export function newState(nowMs = Date.now(), P = XSRAP){
  return { v: P.version, id: P.id, startedAt: new Date(nowMs).toISOString(), startDay: null, lastDay: null, startUsd: P.startUsd, equity: P.startUsd,
    btcStart: null, btcEquity: P.startUsd, peak: P.startUsd, maxDD: 0, btcPeak: P.startUsd, btcMaxDD: 0,
    sleeves: Array.from({ length: P.sleeves }, (_, k) => ({ dow: k, equity: P.startUsd / P.sleeves, weights: {}, tgt: {} })), costsUsd: 0, changes: [], daily: [] };
}

// בחירת היעד של מנה בסגירת יום d (רק מידע עד d כולל) — אותה פונקציה כמו במחקר
export function targetsAt(A, d, P = XSRAP){
  const i = A.days.indexOf(d); if (i < 0) return { w: {}, pick: [] };
  const st = {}, w = xsRiskAdj(A.coins, { dow: new Date(d).getUTCDay(), P: P.P }).weights(A, i, st), out = {};
  A.coins.forEach((c, k) => { if (w[k]) out[c] = w[k]; });
  return { w: out, pick: (st.pick || []).map(([c, z]) => ({ coin: c, score: r4(z) })) };
}

export function step(prev, bars, P = XSRAP){
  const s = prev && prev.v === P.version && prev.id === P.id ? JSON.parse(JSON.stringify(prev)) : newState(Date.now(), P);
  const A = align(Object.fromEntries(Object.entries(bars || {}).filter(([c, b]) => P.universe.includes(c) && b?.length)));
  const iB = A.coins.indexOf('BTC'); if (iB < 0) throw new Error('אין נרות BTC');
  const px = (c, d) => { const k = A.coins.indexOf(c), i = A.days.indexOf(d); return k >= 0 && i >= 0 && Number.isFinite(A.C[k][i]) ? A.C[k][i] : null; };
  const btcDays = A.days.filter((d) => px('BTC', d));
  const first = s.lastDay === null, todo = first ? btcDays.slice(-1) : btcDays.filter((d) => d > Date.parse(s.lastDay));
  const slip = (c) => (P.slipBps[c] ?? P.slipOther) / 1e4, events = [];
  for (const d of todo){
    if (!first || s.startDay){ // שערוך יומי של כל מנה (מטבע בלי מחיר היום — נשאר בשווי האחרון)
      const pd = Date.parse(s.lastDay);
      for (const sl of s.sleeves){ let r = 0; const nw = {};
        for (const [c, w] of Object.entries(sl.weights)){ const a = px(c, pd), b = px(c, d), g = a && b ? b / a - 1 : 0; r += w * g; nw[c] = w * (1 + g); }
        sl.equity *= 1 + r; for (const c of Object.keys(nw)) nw[c] /= 1 + r; sl.weights = nw; }
    } else { s.startDay = dayIso(d); s.btcStart = px('BTC', d); }
    const dow = new Date(d).getUTCDay();
    for (const sl of s.sleeves){
      if (!(first || sl.dow === dow)) continue;
      const { w: tgt, pick } = targetsAt(A, d, P);
      // כמו במחקר (runDaily עם drift): אם היעד זהה ליעד הקודם של המנה — לא נוגעים (המשקלות ממשיכים לזוז עם המחירים)
      if (!first && sameW(tgt, sl.tgt || {})){ events.push({ day: dayIso(d), sleeve: sl.dow, held: Object.keys(tgt), pick, cash: !Object.keys(tgt).length, turnover: 0, costUsd: 0, sleeveEquity: r2(sl.equity), same: true }); continue; }
      let turn = 0, cost = 0;
      for (const c of new Set([...Object.keys(tgt), ...Object.keys(sl.weights)])){ const dw = Math.abs((tgt[c] || 0) - (sl.weights[c] || 0)); turn += dw; cost += dw * (P.spotBps / 1e4 + slip(c)); }
      const costUsd = sl.equity * cost; sl.equity -= costUsd; s.costsUsd += costUsd; sl.weights = { ...tgt }; sl.tgt = { ...tgt };
      const e = { day: dayIso(d), sleeve: sl.dow, held: Object.keys(tgt), pick, cash: !Object.keys(tgt).length, turnover: r4(turn), costUsd: r2(costUsd), sleeveEquity: r2(sl.equity) };
      s.changes.push(e); events.push(e);
    }
    s.equity = s.sleeves.reduce((a, sl) => a + sl.equity, 0);
    s.btcEquity = s.startUsd * px('BTC', d) / s.btcStart;
    s.peak = Math.max(s.peak, s.equity); s.maxDD = Math.max(s.maxDD, 1 - s.equity / s.peak);
    s.btcPeak = Math.max(s.btcPeak, s.btcEquity); s.btcMaxDD = Math.max(s.btcMaxDD, 1 - s.btcEquity / s.btcPeak);
    s.daily.push({ day: dayIso(d), equity: r2(s.equity), btc: r2(s.btcEquity) });
    s.lastDay = new Date(d).toISOString();
  }
  s.changes = s.changes.slice(-400); s.daily = s.daily.slice(-500);
  s.equity = r2(s.equity); s.btcEquity = r2(s.btcEquity); s.costsUsd = r2(s.costsUsd); s.maxDD = r4(s.maxDD); s.btcMaxDD = r4(s.btcMaxDD);
  for (const sl of s.sleeves){ sl.equity = r2(sl.equity); for (const c of Object.keys(sl.weights)) sl.weights[c] = r4(sl.weights[c]); }
  return { state: s, events, processed: todo.length };
}

// משקלות התיק כולו (סכום המנות לפי ההון שלהן)
export function totalWeights(s){
  const tot = s.sleeves.reduce((a, sl) => a + sl.equity, 0) || 1, w = {};
  for (const sl of s.sleeves) for (const [c, x] of Object.entries(sl.weights)) w[c] = (w[c] || 0) + x * sl.equity / tot;
  return w;
}
// כללי ההחלטה שנקבעו מראש: עצירה מוקדמת אם הירידה עוברת 55% כשהירידה של BTC קטנה יותר; אחרי 12 חודשים — עצירה אם מפגרים
// אחרי BTC ביותר מ-20 נק' אחוז וגם הירידה גדולה משלו; אחרת — החלטה של בעל הריפו (מעקב הצליח אם מנצחים את BTC עם ירידה קטנה משלו)
export function verdict(s, P = XSRAP, nowMs = Date.now()){
  if (!s?.startDay) return { status: 'waiting' };
  const r = s.equity / s.startUsd - 1, b = s.btcEquity / s.startUsd - 1, months = (nowMs - Date.parse(s.startDay)) / (30.44 * DAY);
  if (s.maxDD > P.decision.killDd && s.btcMaxDD < s.maxDD) return { status: 'stop-dd', r, b, months };
  if (months < P.decision.months) return { status: 'running', r, b, months };
  if (b - r > P.decision.killLagPts && s.maxDD > s.btcMaxDD) return { status: 'stop-lag', r, b, months };
  return { status: r > b && s.maxDD < s.btcMaxDD ? 'pass' : 'decide', r, b, months };
}
