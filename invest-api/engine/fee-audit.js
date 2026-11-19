// ביקורת עמלות בפועל של בוטי הדמו ב-Bybit (בקשת מאיר, 19/11/2026: "העמלות שאתה רושם בבוטים הם לא הגיוניים… אני רוצה שתבדוק
// לי באמת את כל הנתונים האלה"). פונקציות טהורות: מקבלות שורות ביצוע של /v5/execution/list ומסכמות לפי בוט ותפקיד הפקודה,
// ומשוות לשלושה מודלים: המודל שבו השתמשו המחקרים, השיעורים הרגילים (VIP0) והשיעורים של עמית. בלי רשת ובלי מפתחות —
// הקריאה ל-Bybit נמצאת ב-scripts/bybit-fee-audit.mjs.

// שיעורים (שבר עשרוני של שווי העסקה)
export const RATES = Object.freeze({
  vip0: Object.freeze({ taker: 0.00055, maker: 0.0002 }),   // לקוח רגיל ב-Bybit, חוזים צמודים
  amit: Object.freeze({ taker: 0.00035, maker: 0.00014 }),  // מהצילום של עמית: 57.59$ / 23.23$ על ~165K$ (engine/amit-rules.js)
});

// המודל שהמחקרים הניחו לכל צד (כולל החלקה) — כדי להשוות למה שקרה בפועל
export const RESEARCH_MODEL = Object.freeze({
  bot1: Object.freeze({ entry: 0.0002, exit: 0.00055 + 0.0002 }),   // scripts/analyze-bot1-trades.mjs
  bot2: Object.freeze({ entry: 0.00055 + 0.0001, exit: 0.00055 + 0.0001 }), // research/amit2-be
  bot3: Object.freeze({ entry: 0.0002 + 0.00005, exit: 0.00055 + 0.00005 }), // engine/amit-course.js (2bp/5.5bp + חצי מרווח/החלקה ~0.5bp)
});

// לאיזה בוט שייכת השורה: לפי קידומת orderLinkId, ואם אין — לפי הסימול (בוט 1 = BTC, בוט 2 = ETH, בוט 3 = כל השאר; engine/amit3-exec.js)
export function botOf(r){
  const id = String(r.orderLinkId || '');
  if (id.startsWith('amit-')) return 'bot1';
  if (id.startsWith('a2-')) return 'bot2';
  if (id.startsWith('a3-')) return 'bot3';
  if (r.symbol === 'BTCUSDT') return 'bot1';
  if (r.symbol === 'ETHUSDT') return 'bot2';
  return 'bot3';
}

// תפקיד הביצוע: כניסה / יעד / סטופ / סגירה אחרת / מימון
export function roleOf(r){
  if (String(r.execType || 'Trade') === 'Funding') return 'funding';
  const st = String(r.stopOrderType || '');
  if (/StopLoss|TrailingStop/i.test(st)) return 'sl';
  if (/TakeProfit/i.test(st)) return 'tp';
  const id = String(r.orderLinkId || '');
  if (id.startsWith('amit-tp-')) return 'tp';
  if (id.startsWith('amit-e-') || /^a2-\d+$/.test(id) || /^a3-.*-e\d$/.test(id)) return 'entry';
  return 'close';
}

const num = (x) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const blank = () => ({ n: 0, value: 0, fee: 0, makerN: 0, makerValue: 0, rates: {}, orderTypes: {} });

// rows: שורות ביצוע גולמיות. מחזיר { bots: { bot1: { roles: { entry: {...}, ... }, total, funding, models } }, n, from, to }
export function auditFees(rows){
  const seen = new Set(), bots = {};
  let from = Infinity, to = -Infinity, n = 0;
  for (const r of rows || []){
    const key = r.execId || `${r.orderId}|${r.execTime}|${r.execQty}|${r.execPrice}`;
    if (seen.has(key)) continue; seen.add(key);
    const bot = botOf(r), role = roleOf(r), t = num(r.execTime);
    const B = bots[bot] ||= { roles: {}, funding: { n: 0, fee: 0 } };
    if (t) { from = Math.min(from, t); to = Math.max(to, t); }
    n++;
    if (role === 'funding'){ B.funding.n++; B.funding.fee += num(r.execFee); continue; }
    const g = B.roles[role] ||= blank();
    const value = Math.abs(num(r.execValue)) || Math.abs(num(r.execQty) * num(r.execPrice));
    const maker = r.isMaker === true || r.isMaker === 'true';
    g.n++; g.value += value; g.fee += num(r.execFee);
    if (maker) { g.makerN++; g.makerValue += value; }
    const fr = String(r.feeRate ?? ''); if (fr) g.rates[fr] = (g.rates[fr] || 0) + 1;
    const ot = String(r.orderType || '?'); g.orderTypes[ot] = (g.orderTypes[ot] || 0) + 1;
  }
  for (const [bot, B] of Object.entries(bots)){
    const tot = blank(), m = { actual: 0, vip0: 0, amit: 0, research: 0 };
    for (const [role, g] of Object.entries(B.roles)){
      g.effPct = g.value ? (g.fee / g.value) * 100 : null;
      g.makerShare = g.value ? g.makerValue / g.value : null;
      for (const k of ['n', 'value', 'fee', 'makerN', 'makerValue']) tot[k] += g[k];
      const taker = g.value - g.makerValue;
      m.actual += g.fee;
      m.vip0 += taker * RATES.vip0.taker + g.makerValue * RATES.vip0.maker;
      m.amit += taker * RATES.amit.taker + g.makerValue * RATES.amit.maker;
      const R = RESEARCH_MODEL[bot];
      if (R) m.research += g.value * (role === 'entry' ? R.entry : R.exit);
    }
    tot.effPct = tot.value ? (tot.fee / tot.value) * 100 : null;
    tot.makerShare = tot.value ? tot.makerValue / tot.value : null;
    B.total = tot; B.models = m;
  }
  return { n, from: Number.isFinite(from) ? from : null, to: Number.isFinite(to) ? to : null, bots };
}

const usd = (x) => `${x < 0 ? '‎−' : ''}${Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 })}$`;
const pct = (x, d = 3) => (x == null ? '—' : `${x.toFixed(d)}%`);
const ROLE_HE = { entry: 'כניסה', tp: 'יעד', sl: 'סטופ', close: 'סגירה אחרת' };
const BOT_HE = { bot1: 'בוט 1 (ביטקוין)', bot2: 'בוט 2 (את\'ריום)', bot3: 'בוט 3 (שיטת הקורס)' };

// דוח מרקדאון בעברית
export function renderAudit(a, feeRates = []){
  const L = [];
  const d = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '—');
  L.push(`# ביקורת עמלות בפועל — חשבון הדמו ב-Bybit`, '', `${a.n} ביצועים, ${d(a.from)} עד ${d(a.to)}.`, '');
  if (feeRates.length){
    L.push('**שיעורי העמלה של החשבון (מ-Bybit):** ' + feeRates.map((f) => `${f.symbol}: פקודת שוק ${pct(num(f.takerFeeRate) * 100)}, פקודה ממתינה ${pct(num(f.makerFeeRate) * 100)}`).join(' · '), '');
  }
  for (const bot of ['bot1', 'bot2', 'bot3']){
    const B = a.bots[bot]; if (!B) continue;
    L.push(`## ${BOT_HE[bot]}`, '', '| תפקיד | ביצועים | שווי | עמלה בפועל | שיעור בפועל | חלק "ממתינה" (maker) | סוגי פקודה |', '|---|---|---|---|---|---|---|');
    for (const role of ['entry', 'tp', 'sl', 'close']){
      const g = B.roles[role]; if (!g) continue;
      L.push(`| ${ROLE_HE[role]} | ${g.n} | ${usd(g.value)} | ${usd(g.fee)} | ${pct(g.effPct)} | ${g.makerShare == null ? '—' : Math.round(g.makerShare * 100) + '%'} | ${Object.entries(g.orderTypes).map(([k, v]) => `${k}×${v}`).join(', ')} |`);
    }
    const T = B.total, M = B.models;
    L.push(`| **סה"כ** | ${T.n} | ${usd(T.value)} | **${usd(T.fee)}** | **${pct(T.effPct)}** | ${T.makerShare == null ? '—' : Math.round(T.makerShare * 100) + '%'} | |`, '');
    L.push(`- דמי מימון: ${usd(B.funding.fee)} (${B.funding.n} חיובים).`);
    L.push(`- **אותם ביצועים לפי מודלים:** בפועל ${usd(M.actual)} · רגיל (VIP0) ${usd(M.vip0)} · שיעורי עמית ${usd(M.amit)} · המודל של המחקרים ${usd(M.research)}` +
      (M.actual ? ` (פי ${(M.research / M.actual).toFixed(2)} מהבפועל)` : '') + '.', '');
  }
  L.push('הערה: "סטופ" ו"יעד" שמוצמדים לפוזיציה הם פקודות שוק מותנות — הן משלמות עמלת פקודת שוק גם כשהמחיר קבוע מראש. ההחלקה (ההפרש בין מחיר הסטופ למחיר הביצוע) לא נמדדת כאן.');
  return L.join('\n');
}
