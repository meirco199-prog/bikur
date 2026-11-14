// מומנטום משודרג, 7 מנות — מנוע ברמת התיק כולו, עם הגנות (משימת מאיר 13/11/2026: "שיפור שיטת המומנטום — יעד מינימום 20% בשנה").
// מחקר בלבד: לא נוגע במעקב החי (engine/xsra-paper.js) ולא בכללים שלו. בלי הגנות התוצאה זהה ל-7 המנות של research-daily.js
// (combineSleeves של 7 × runDaily עם drift) — בדיקה ב-tests/xsra-protect.test.mjs.
//
// כל ההגדרות נקבעו מראש, לפני ההרצה (PROTECT), ולא ישתנו אחרי שרואים תוצאות:
//  א. capCoin 15%: מטבע (כולל BTC שבתוך המנות) לא יותר מ-15% משווי התיק הכולל בכל 7 המנות יחד. נבדק רק בזמן קנייה לפי שווי שוק:
//     קנייה מוגבלת למרווח שנשאר עד התקרה; היתרה נשארת מזומן; לא מוכרים כדי לעקוף, ומטבע שעלה מעל התקרה לא נמכר בגלל זה.
//  ב. volTarget 40%: ביום ההחלפה של מנה — התנודתיות השנתית של הסל שהיא עומדת לקנות (30 ימים אחרונים, מידע עד יום ההחלטה בלבד);
//     אם מעל 40% — כל המשקלות מוכפלים ב-40%/תנודתיות (לעולם לא מעל המשקל המקורי). עם ההגנה הזו כל מנה מתעדכנת בכל יום החלפה שלה.
//  ג. btcFixed 30%: 30% מהתיק ב-BTC (בלי מסנן), 70% ב-7 המנות. חזרה ל-30/70 ביום הראשון של כל רבעון (ינואר/אפריל/יולי/אוקטובר),
//     בעלות מלאה. תקרת המטבע לא חלה על החלק הקבוע.
//  ד. altCap 60%: סך המטבעות שאינם BTC עד 60% מהתיק. בקנייה — קניות האלטים של המנה מוקטנות באופן יחסי כך שלא יעברו את התקרה;
//     ובכל יום בפתיחה — אם הסך עבר 60%, מוכרים באופן יחסי מכל האלטים בכל המנות עד 60% בדיוק. היתרה מזומן.
// ביצוע כמו במחקר: ההחלטה בסגירת d−1, הביצוע בפתיחת d; עלות לכל דולר שנסחר = עמלת ספוט + החלקה (× costMult).
import { xsRiskAdj, XSRA, DCOST } from './research-daily.js';

export const PROTECT = Object.freeze({ capCoin: 0.15, volTarget: 0.40, volN: 30, btcFixed: 0.30, altCap: 0.60 });
export const VERSIONS = Object.freeze([
  { key: 'base', lab: 'מקורית (7 מנות)' },
  { key: 'A', lab: 'א. תקרה 15% למטבע', capCoin: PROTECT.capCoin },
  { key: 'B', lab: 'ב. יעד תנודתיות 40%', volTarget: PROTECT.volTarget },
  { key: 'C', lab: 'ג. BTC קבוע 30%', btcFixed: PROTECT.btcFixed },
  { key: 'D', lab: 'ד. אלטים עד 60%', altCap: PROTECT.altCap },
  { key: 'AB', lab: 'א+ב', capCoin: PROTECT.capCoin, volTarget: PROTECT.volTarget },
  { key: 'AD', lab: 'א+ד', capCoin: PROTECT.capCoin, altCap: PROTECT.altCap },
  { key: 'AC', lab: 'א+ג', capCoin: PROTECT.capCoin, btcFixed: PROTECT.btcFixed },
]);
const NS = 7;
// בדיקה אחת של איזון חודשי (בקשת מאיר 14/11/2026, אחרי הצעת GPT להקטין מחזור/עמלות/מס). cycle = { n, step, off }: מנה j מוחלפת ביום
// שבו (מספר היום מ-1970 + off − j·step) מתחלק ב-n. { n: 7, step: 1, off: 4 } = בדיוק ההחלפה השבועית (יום j בשבוע; 1/1/1970 = יום חמישי).
// חודשי: כל מנה כל 28 ימים, המנות מדורגות כל 4 ימים. רבעוני (מידע בלבד): כל 84 ימים, כל 12 ימים. כל השאר — אותם כללים בדיוק.
export const CYCLES = Object.freeze({ weekly: null, monthly: { n: 28, step: 4, off: 4 }, quarterly: { n: 84, step: 12, off: 4 } });
// הקריטריון — נקבע ונשמר כאן לפני ההרצה. חודשי מול שבועי, אותה גרסה, הגרסה המציאותית (Bybit, תאריכי רישום, ספר פקודות 5,000$).
export const MONTHLY_PASS = Object.freeze({
  primary: 'AB',     // הגרסה הראשית: א+ב
  feeRatio: 0.60,    // (1) עמלות מ-2022 ≤ 60% מאלה של השבועי
  cagrGap: 0.03,     // (2) תשואה שנתית מ-2022 (לפני מס) לא נמוכה ביותר מ-3 נקודות
  // (3) תשואה שנתית מ-2022 אחרי מס (פרטי 25%, חצי-שנתי, העברת הפסדים) ≥ השבועי
  ddGap: 0.05,       // (4) ירידה מקסימלית מ-2022 לא גדולה ביותר מ-5 נקודות
  robust: ['base', 'A'], // (5) (2) ו-(4) מתקיימים גם בתקופת המבחן, וגם בגרסה המקורית ובגרסה א'
});
const DAYMS = 86400e3;
export const cycReb = (c, j) => (t) => { const n = Math.floor(t / DAYMS); return (((n + c.off - j * c.step) % c.n) + c.n) % c.n === 0; };
const same = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-12);

// תנודתיות שנתית של סל (משקלות w) לפי n הימים עד d כולל (תשואות סגירה-לסגירה)
export function basketVol(A, w, d, n = PROTECT.volN){
  if (d < n) return 0; const rs = [];
  for (let i = d - n + 1; i <= d; i++){ let r = 0; for (let k = 0; k < w.length; k++) if (w[k]){ const x = A.C[k][i] / A.C[k][i - 1] - 1; if (Number.isFinite(x)) r += w[k] * x; } rs.push(r); }
  const m = rs.reduce((s, x) => s + x, 0) / n; return Math.sqrt(rs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1) * 365);
}

// tax: { rate, period: 'semi'|'annual', carry: true|false, divRate } — בסיס עלות ממוצע לכל מטבע ברמת התיק, מס על רווח ממומש נטו בכל תקופה,
// תשלום מהתיק (מכירה יחסית). בסוף: מכירה של הכול ומס על השאר; divRate (חברה) — מס דיבידנד על הרווח שנשאר אחרי מס החברות.
export function simulate(A, opt = {}){
  const { coins, days, O, C } = A, K = coins.length, D = days.length, iB = coins.indexOf('BTC');
  const cost = opt.C || DCOST, cm = opt.costMult ?? 1, P = opt.P || XSRA;
  const rate = (k) => ((cost.spotBps + (cost.slipBps[coins[k]] ?? cost.slipOther)) / 1e4) * cm;
  const cap = opt.capCoin || 0, vt = opt.volTarget || 0, fixed = opt.btcFixed || 0, altCap = opt.altCap || 0;
  const start = Math.max(1, opt.startIdx ?? 1);
  const mk = (st) => ({ V: new Float64Array(K), cash: (1 - fixed) / NS, prevSig: null, st });
  const cyc = opt.cycle || null, rebF = Array.from({ length: NS }, (_, j) => (cyc ? cycReb(cyc, j) : null));
  const strat = Array.from({ length: NS }, (_, j) => xsRiskAdj(coins, { dow: j, P, rng: opt.rng ? opt.rng(j) : null, allow: opt.allow || null, isReb: rebF[j] }));
  const sl = Array.from({ length: NS }, () => mk({}));
  const fb = { V: 0, cash: fixed }; // החלק הקבוע ב-BTC
  const tx = opt.tax ? { ...opt.tax, B: new Float64Array(K), real: 0, carry: 0, paid: 0, per: null } : null;
  const trace = !!opt.trace, contrib = trace ? new Float64Array(D * K) : null, wtr = trace ? new Float32Array(D * K) : null;
  const out = []; let Eprev = 1, trades = 0, fees = 0;
  const held = (k) => { let s = 0; for (const x of sl) s += x.V[k]; return s + (k === iB ? fb.V : 0); }; // כל התיק (לבסיס העלות במס)
  const heldSleeves = (k) => { let s = 0; for (const x of sl) s += x.V[k]; return s; }; // רק 7 המנות — לתקרת המטבע (לא חלה על החלק הקבוע; סבב GPT 1 של #268)
  const altHeld = () => { let s = 0; for (const x of sl) for (let k = 0; k < K; k++) if (k !== iB) s += x.V[k]; return s; };
  const equity = () => { let e = fb.V + fb.cash; for (const x of sl){ e += x.cash; for (let k = 0; k < K; k++) e += x.V[k]; } return e; };
  // קנייה/מכירה ברמת מנה (who = אובייקט עם V/cash; isFixed = החלק הקבוע) + חשבון מס
  // עמלות: בהחלפה של מנה — defer (כמו במנוע המחקר, ראו למטה). בחלק הקבוע, בתשלום מס ובקיצוץ האלטים — העמלה יורדת מהמזומן ונכנסת לבסיס
  // העלות (בקנייה) או מקטינה את התמורה (במכירה). שתי הדרכים עקביות: העמלה נספרת פעם אחת בדיוק — או בשווי הפוזיציה או בבסיס.
  // defer: העמלה לא יורדת כאן מהמזומן אלא נצברת, ובסוף ההחלפה של המנה יורדת באופן יחסי מכל המנה (כמו במנוע המחקר) — ואז היא כבר
  // מקטינה את שווי הפוזיציות, ולכן לא נכנסת שוב לבסיס העלות (אחרת הייתה נספרת פעמיים במס)
  let defer = false, pend = 0;
  const buy = (who, k, x, isFixed) => { if (!(x > 1e-12)) return; const f = x * rate(k); if (isFixed) fb.V += x; else who.V[k] += x; who.cash -= x; if (defer) pend += f; else who.cash -= f; fees += f; trades += 1; if (tx) tx.B[k] += x + (defer ? 0 : f); };
  const sell = (who, k, x, isFixed) => { if (!(x > 1e-12)) return; const tot = held(k), f = x * rate(k); if (tx && tot > 0){ const b = tx.B[k] * x / tot; tx.real += x - b - (defer ? 0 : f); tx.B[k] -= b; }
    if (isFixed) fb.V -= x; else who.V[k] -= x; who.cash += x; if (defer) pend += f; else who.cash -= f; fees += f; trades += 1; };
  const payTax = (amt, E) => { if (!(amt > 0)) return; const g = 1 - amt / E, parts = [...sl.map((s) => ({ s })), ...(fixed ? [{ fixed: true }] : [])];
    // מורידים את המזומן הנדרש: מכירה יחסית של הכול (ואז ה-cash כולל את התמורה), ואז מנכים את המס מהמזומן באופן יחסי
    for (const p of parts){ if (p.fixed){ sell(fb, iB, fb.V * (1 - g), true); } else for (let k = 0; k < K; k++) if (p.s.V[k] > 0) sell(p.s, k, p.s.V[k] * (1 - g)); }
    const cashTot = sl.reduce((a, s) => a + s.cash, 0) + fb.cash; const take = (c) => (cashTot > 0 ? c / cashTot * amt : amt / (NS + (fixed ? 1 : 0)));
    for (const s of sl) s.cash -= take(s.cash); fb.cash -= take(fb.cash); tx.paid += amt; };
  const settle = (E) => { const base = tx.real + (tx.carry ? tx.carryAmt || 0 : 0); const due = Math.max(0, base) * tx.rate; tx.carryAmt = tx.carry ? Math.min(0, base) : 0; tx.real = 0; payTax(due, E); return due; };
  const perOf = (t) => { const dt = new Date(t), y = dt.getUTCFullYear(); return tx.period === 'semi' ? `${y}-${dt.getUTCMonth() < 6 ? 1 : 2}` : `${y}`; };
  for (let d = 1; d < D; d++){
    const t = days[d], pnl = trace ? new Float64Array(K) : null; let traded = 0;
    // לילה: סגירה קודמת → פתיחה; מטבע בלי מחיר (ירד מהמסחר) — נמכר בשווי האחרון בלי עלות (כמו במנוע המחקר)
    for (const s of [...sl, null]){
      const ks = s ? [...Array(K).keys()] : (fixed ? [iB] : []);
      for (const k of ks){ const v = s ? s.V[k] : fb.V; if (!(v > 0)) continue; const o = O[k][d], c0 = C[k][d - 1];
        if (Number.isFinite(o) && Number.isFinite(c0)){ const nv = v * o / c0; if (pnl) pnl[k] += nv - v; if (s) s.V[k] = nv; else fb.V = nv; }
        else if (!Number.isFinite(C[k][d])){ if (tx){ const tot = held(k); const b = tot > 0 ? tx.B[k] * v / tot : 0; tx.real += v - b; tx.B[k] -= b; } if (s){ s.cash += v; s.V[k] = 0; } else { fb.cash += v; fb.V = 0; } } }
    }
    if (d < start){ out.push({ t, gross: 0, cost: 0, fund: 0, net: 0, turn: 0, exp: 0, alt: 0, altOpen: 0 }); continue; }
    let Eo = equity(); const fees0 = fees;
    // מס: תשלום בתחילת תקופה חדשה
    if (tx){ const pr = perOf(t); if (tx.per === null) tx.per = pr; if (pr !== tx.per){ settle(Eo); tx.per = pr; Eo = equity(); } }
    // ג. BTC קבוע: קנייה ביום הראשון, וחזרה ל-30/70 בתחילת כל רבעון
    if (fixed){ const m = new Date(t).getUTCMonth(), m0 = new Date(days[d - 1]).getUTCMonth();
      if (d === start) buy(fb, iB, fb.cash / (1 + rate(iB)), true);
      else if (m !== m0 && m % 3 === 0){
        const F = fb.V + fb.cash, S = Eo - F, delta = fixed * Eo - F;
        if (delta > 1e-9 && S > 0){ // מעבירים מהמנות ל-BTC: מכירה יחסית בכל מנה
          for (const x of sl){ let Ss = x.cash; for (let k = 0; k < K; k++) Ss += x.V[k]; const q = delta / S; let T = x.cash * q;
            for (let k = 0; k < K; k++) if (x.V[k] > 0){ const c0 = x.cash; sell(x, k, x.V[k] * q); T += x.cash - c0; }
            x.cash -= T; fb.cash += T; }
          buy(fb, iB, Math.max(0, fb.cash) / (1 + rate(iB)), true);
        } else if (delta < -1e-9 && S > 0){ // מעבירים מ-BTC למנות: קנייה יחסית לפי ההרכב הנוכחי של כל מנה
          sell(fb, iB, Math.min(fb.V, -delta), true); const R = fb.cash; fb.cash = 0;
          for (const x of sl){ let Ss = x.cash; for (let k = 0; k < K; k++) Ss += x.V[k]; const r = R * Ss / S; x.cash += r;
            for (let k = 0; k < K; k++) if (x.V[k] > 0) buy(x, k, (r * x.V[k] / Ss) / (1 + rate(k))); }
        }
      }
    }
    // החלפות המנות (החלטה בסגירת d−1)
    for (let j = 0; j < NS; j++){
      const s = sl[j], i = d - 1, first = d === start;
      if (first && start > 1) s.st = {}; // משקיע חדש: בחירה טרייה ביום הראשון
      const raw = strat[j].weights(A, i, s.st).map((x) => (Number.isFinite(x) ? x : 0));
      const reb = (rebF[j] ? rebF[j](days[i]) : new Date(days[i]).getUTCDay() === j) || first;
      let sig = raw;
      if (vt){ if (reb){ const v = basketVol(A, raw, i); const g = v > 0 ? Math.min(1, vt / v) : 1; sig = raw.map((x) => x * g); } else sig = s.prevSig || raw; }
      if (same(sig, s.prevSig)) continue;
      s.prevSig = sig.slice();
      let S = s.cash; for (let k = 0; k < K; k++) S += s.V[k];
      const T = sig.map((x) => x * S);
      defer = true; pend = 0;
      for (let k = 0; k < K; k++) if (s.V[k] > T[k] + 1e-12){ traded += s.V[k] - T[k]; sell(s, k, s.V[k] - T[k]); }
      const want = T.map((x, k) => Math.max(0, x - s.V[k]));
      if (cap) for (let k = 0; k < K; k++) if (want[k] > 0) want[k] = Math.min(want[k], Math.max(0, cap * Eo - heldSleeves(k)));
      if (altCap){ const wa = want.reduce((a, x, k) => a + (k !== iB ? x : 0), 0), room = Math.max(0, altCap * Eo - altHeld()); if (wa > room){ const g = wa > 0 ? room / wa : 0; for (let k = 0; k < K; k++) if (k !== iB) want[k] *= g; } }
      for (let k = 0; k < K; k++) if (want[k] > 0){ traded += want[k]; buy(s, k, want[k]); }
      defer = false; if (pend > 0 && S > 0){ const g = 1 - pend / S; for (let k = 0; k < K; k++) s.V[k] *= g; s.cash *= g; }
    }
    // ד. תקרת אלטים יומית
    if (altCap){ const ah = altHeld(), E1 = equity(); if (ah > altCap * E1 + 1e-12){ const g = altCap * E1 / ah; for (const s of sl) for (let k = 0; k < K; k++) if (k !== iB && s.V[k] > 0){ const x = s.V[k] * (1 - g); traded += x; sell(s, k, x); } } }
    const altOpen = altHeld() / equity();
    // יום: פתיחה → סגירה
    for (const s of [...sl, null]){
      const ks = s ? [...Array(K).keys()] : (fixed ? [iB] : []);
      for (const k of ks){ const v = s ? s.V[k] : fb.V; if (!(v > 0)) continue; const o = O[k][d], c = C[k][d]; if (!(Number.isFinite(o) && Number.isFinite(c))) continue; const nv = v * c / o; if (pnl) pnl[k] += nv - v; if (s) s.V[k] = nv; else fb.V = nv; }
    }
    const E = equity(); let inv = 0, alt = 0; for (let k = 0; k < K; k++){ const h = held(k); inv += h; if (k !== iB) alt += h; if (wtr) wtr[d * K + k] = h / E; }
    if (pnl) for (let k = 0; k < K; k++) contrib[d * K + k] = pnl[k] / Eprev;
    out.push({ t, gross: 0, cost: (fees - fees0) / Eprev, fund: 0, net: E / Eprev - 1, turn: traded / Eprev, exp: inv / E, alt: alt / E, altOpen });
    Eprev = E;
  }
  let taxInfo = null;
  if (tx){ // מכירה של הכול ביום האחרון: רווח שלא מומש + הממומש של התקופה
    const E = equity(); let unreal = 0, liqFee = 0; for (let k = 0; k < K; k++){ const h = held(k); if (h > 0){ unreal += h - tx.B[k]; liqFee += h * rate(k); } }
    const base = tx.real + unreal - liqFee + (tx.carry ? tx.carryAmt || 0 : 0), due = Math.max(0, base) * tx.rate, afterCorp = E - liqFee - due;
    const div = tx.divRate ? Math.max(0, afterCorp - 1) * tx.divRate : 0;
    taxInfo = { equity: E, paidDuring: tx.paid, finalTax: due, divTax: div, net: afterCorp - div };
  }
  return { series: out, trades, fees, contrib, wtr, taxInfo };
}
