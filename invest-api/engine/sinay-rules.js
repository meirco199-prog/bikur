// מנוע הדמה "ריזיקות עקרונות" (amit.sinay, Issue #189) — העתקה 1:1 של הכללים הקפואים (גרסה 1, 1/11/2026) מהסקריפט
// paper.py שרץ עד עכשיו מחוץ לריפו כל 6 שעות. אין כאן שום שינוי בכללים: אותם ספים, אותו סדר בדיקות, אותו עיגול.
// ההבדל היחיד: הפונקציה גם מחזירה "אירועים" (דשדוש חדש, כניסה, מילוי שליש, יציאה) כדי שה-Worker ישלח התראה בזמן אמת.
// פונקציה טהורה: בלי רשת ובלי KV. בדיקת התאמה מול paper.py: invest-api/tests/sinay-rules.test.mjs (fixture שנוצר בפייתון).

export const CAT = { BTC: [1.2, 2.0], ETH: [1.5, 2.5], LTC: [1.8, 3.0], BCH: [1.8, 3.0] }; // "הטווח הטבעי" באחוזים
export const EXT = 0.414, SBUF = 1.4, FEE_PCT = 0.05;   // % ; עמלה לכל צד
export const CONS_BARS = 48, LIFE_BARS = 96;            // דשדוש 12 שעות, תוקף setup/פוזיציה 24 שעות (נרות 15 דקות)
export const EMA_N = 50;                                // יעד: EMA50 על 15m
export const NOTIONAL = 10000;                          // גודל מתוכנן לעסקה (100%), כניסה בשלישים
export const BAR_MS = 15 * 60 * 1000;
export const WARM_BARS = CONS_BARS + 60;

// round של פייתון על float (חצי לזוגי ברמת הייצוג הבינארי) — toFixed מעגל את הערך הבינארי המדויק, כמו round(x, n)
export const pyRound = (x, n) => Number(x.toFixed(n));
const emaStep = (prev, x, n) => { const k = 2 / (n + 1); return prev === null || prev === undefined ? x : x * k + prev * (1 - k); };
const tms = (t) => Date.parse(t);

// רמות הכניסה והסטופ של צד אחד מתוך קצה הדשדוש (כלל 3): אמצע הטווח, קצה הטווח, קצה + EXT; סטופ = קצה + EXT + SBUF
export function sideLevels(sym, ref, sg){
  const [lo, hi] = CAT[sym];
  return { lv: [(lo + hi) / 2, hi, hi + EXT].map((p) => ref * (1 + sg * p / 100)), stop: ref * (1 + sg * (hi + EXT + SBUF) / 100) };
}

export function newCoin(){ return { last_t: null, hist: [], ema: null, setup: null, pos: null }; }

// חימום של מטבע חדש — בלי מילוי לאחור: לומדים רק EMA והיסטוריית 12 שעות מהנרות האחרונים (כמו paper.py)
export function warmCoin(bars){
  const s = newCoin();
  for (const [t, , h, l, c] of bars.slice(-WARM_BARS)){
    s.ema = emaStep(s.ema, c, EMA_N); s.hist = [...s.hist, [h, l]].slice(-CONS_BARS); s.last_t = t; s.mark = [t, c];
  }
  return s;
}

// מעבד נרות סגורים [t, o, h, l, c] (t = ISO של תחילת הנר, בסדר עולה). מעדכן את st במקום. מחזיר { trades, events }.
export function processCoin(sym, st, bars){
  const [lo, hi] = CAT[sym];
  const s = st.coins[sym] || (st.coins[sym] = newCoin());
  const trades = [], events = [];
  for (const [t, , h, l, c] of bars){
    if (s.last_t && tms(t) <= tms(s.last_t)) continue;
    const hist = s.hist;
    let pos = s.pos, setup = s.setup;
    if (pos === null && hist.length >= CONS_BARS){
      const w = hist.slice(-CONS_BARS);
      const mh = Math.max(...w.map((b) => b[0])), ml = Math.min(...w.map((b) => b[1]));
      if ((mh - ml) / ml * 100 <= lo && (setup === null || setup.age > CONS_BARS)){
        setup = { hi: mh, lo: ml, age: 0 };
        const S = sideLevels(sym, mh, 1), L = sideLevels(sym, ml, -1);
        events.push({ type: 'setup', sym, t, hi: mh, lo: ml, widthPct: (mh - ml) / ml * 100, short: S, long: L, validUntil: new Date(tms(t) + (LIFE_BARS + 1) * BAR_MS).toISOString() });
      }
      if (setup && setup.age > LIFE_BARS) setup = null;
      if (setup){
        for (const [side, sg, ref] of [['short', 1, setup.hi], ['long', -1, setup.lo]]){
          const lv = [(lo + hi) / 2, hi, hi + EXT].map((p) => ref * (1 + sg * p / 100));
          if ((sg === 1 && h >= lv[0]) || (sg === -1 && l <= lv[0])){
            pos = { side, sg, lv, fills: [], stop: ref * (1 + sg * (hi + EXT + SBUF) / 100), start: t, age: 0, ref };
            setup = null; break;
          }
        }
      }
    }
    if (pos !== null){
      const sg = pos.sg, before = pos.fills.length;
      for (let k = 0; k < pos.lv.length; k++){
        const lvl = pos.lv[k];
        if (k >= pos.fills.length && ((sg === 1 && h >= lvl) || (sg === -1 && l <= lvl))) pos.fills.push(lvl);
      }
      for (let k = before; k < pos.fills.length; k++) events.push({ type: k === 0 ? 'entry' : 'fill', sym, t, side: pos.side, third: k + 1, price: pos.fills[k], stop: pos.stop, ema: s.ema, levels: pos.lv.slice() });
      const n = pos.fills.length, avg = pos.fills.reduce((x, y) => x + y, 0) / n;
      let ex = null, why = null;
      if ((sg === 1 && h >= pos.stop) || (sg === -1 && l <= pos.stop)){ ex = pos.stop; why = 'סטופ'; }
      else if (pos.age > 0 && s.ema !== null && ((sg === 1 && l <= s.ema && s.ema < avg) || (sg === -1 && h >= s.ema && s.ema > avg))){ ex = s.ema; why = 'יעד EMA50'; }
      else if (pos.age >= LIFE_BARS){ ex = c; why = 'זמן (24 שעות)'; }
      if (ex !== null){
        const gross = sg * (avg - ex) / avg * 100, frac = n / 3;
        const netPct = (gross - 2 * FEE_PCT) * frac, usd = NOTIONAL * netPct / 100;
        const tr = { n: st.trades.length + 1, sym, side: pos.side, open: pos.start, close: t, fills: n, avg: pyRound(avg, 4), exit: pyRound(ex, 4), why, net_pct: pyRound(netPct, 3), usd: pyRound(usd, 2) };
        st.trades.push(tr); trades.push(tr); events.push({ type: 'exit', sym, t, trade: tr });
        pos = null;
      } else pos.age += 1;
    }
    if (setup) setup.age += 1;
    s.ema = emaStep(s.ema, c, EMA_N);
    hist.push([h, l]); s.hist = hist.slice(-CONS_BARS);
    s.pos = pos; s.setup = setup; s.last_t = t;
    s.mark = [t, c];                 // מחיר אחרון לשערוך (לא משפיע על הכללים)
  }
  return { trades, events };
}

// ריצה אחת על כל המטבעות. barsBySym: { BTC: [[t,o,h,l,c], ...] } — נרות סגורים בלבד, בסדר עולה.
export function runPaper(state, barsBySym){
  const st = state || { version: 1, start: null, trades: [], coins: {} };
  const all = { trades: [], events: [] };
  for (const sym of Object.keys(CAT)){
    const bars = barsBySym[sym];
    if (!bars || !bars.length) continue;
    if (st.start === null) st.start = bars[bars.length - 1][0];
    if (!st.coins[sym]){ st.coins[sym] = warmCoin(bars); continue; }
    const r = processCoin(sym, st, bars);
    all.trades.push(...r.trades); all.events.push(...r.events);
  }
  return { state: st, ...all };
}
