// ניסוי הדמה "ריזיקות עקרונות" (amit.sinay, Issue #189) — מסלול תצוגה בלבד.
// הסימולציה עצמה רצה מחוץ לריפו (משימה מתוזמנת כל 6 שעות) ומפרסמת את מצבה המלא כבלוק JSON בתגובה ב-Issue #189.
// .github/workflows/sinay-sync.yml קורא את התגובה ושולח אותה ל-POST /sinay/ingest; כאן: אימות קפדני, שמירה ב-KV רק כשהתוכן
// השתנה (hash — מכסת הכתיבות של KV), ודוח לחשבון דמה של 200,000$ (ארבעה מטבעות × 50,000$, בלי מינוף, כניסה בשלישים).
// לא משנה שום מודל, כלל, יקום או מסלול קיים. אין כאן פקודות, ואין קשר לברוקר.

export const SINAY_KEY = 'sinay:state';
export const SINAY_ISSUE_URL = 'https://github.com/meirco199-prog/bikur/issues/189';
export const COINS = ['BTC', 'ETH', 'LTC', 'BCH'];
export const ACCOUNT_USD = 200000;
export const SLOT_USD = ACCOUNT_USD / COINS.length; // 50,000$ לכל מטבע
export const FEE = 0.0005; // 0.05% לכל צד (כלל 8 ב-Issue #189)
export const MAX_BYTES = 256 * 1024;
const MAX_TRADES = 2000, MAX_HIST = 400, STALE_H = 13; // המשימה רצה כל 6 שעות; יותר מ-13 שעות בלי עדכון = "ישן"
// אמצע "הטווח הטבעי" לכל מטבע (כלל 1): BTC 1.2–2.0, ETH 1.5–2.5, LTC/BCH 1.8–3.0 — רמת הכניסה הראשונה (כלל 3)
export const NATURAL_RANGE = { BTC: [0.012, 0.020], ETH: [0.015, 0.025], LTC: [0.018, 0.030], BCH: [0.018, 0.030] };
const WHY = ['סטופ', 'יעד EMA50', 'זמן (24 שעות)'];

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isPos = (x) => isNum(x) && x > 0;
const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
const isIso = (s) => typeof s === 'string' && s.length <= 40 && ISO_RE.test(s) && !isNaN(Date.parse(s));
const r2 = (x) => (isNum(x) ? Math.round(x * 100) / 100 : null);
const r4 = (x) => (isNum(x) ? Math.round(x * 10000) / 10000 : null);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

class SinayError extends Error { constructor(msg){ super(msg); this.status = 400; } }
const fail = (msg) => { throw new SinayError(msg); };

function cleanTrade(t, i){
  const at = `trades[${i}]`;
  if (!isObj(t)) fail(`${at}: לא אובייקט`);
  if (!isInt(t.n, 1, 100000)) fail(`${at}.n`);
  if (!COINS.includes(t.sym)) fail(`${at}.sym`);
  if (!['short', 'long'].includes(t.side)) fail(`${at}.side`);
  if (!isIso(t.open) || !isIso(t.close)) fail(`${at}.open/close`);
  if (Date.parse(t.close) < Date.parse(t.open)) fail(`${at}: סגירה לפני פתיחה`);
  if (!isInt(t.fills, 1, 3)) fail(`${at}.fills`);
  if (!isPos(t.avg) || !isPos(t.exit)) fail(`${at}.avg/exit`);
  if (typeof t.why !== 'string' || !WHY.includes(t.why)) fail(`${at}.why`);
  if (!isNum(t.net_pct) || Math.abs(t.net_pct) > 100) fail(`${at}.net_pct`);
  if (!isNum(t.usd) || Math.abs(t.usd) > 10000) fail(`${at}.usd`);
  return { n: t.n, sym: t.sym, side: t.side, open: t.open, close: t.close, fills: t.fills, avg: t.avg, exit: t.exit, why: t.why, net_pct: t.net_pct, usd: t.usd };
}

function cleanCoin(c, sym){
  const at = `coins.${sym}`;
  if (!isObj(c)) fail(`${at}: לא אובייקט`);
  if (!isIso(c.last_t)) fail(`${at}.last_t`);
  if (!Array.isArray(c.hist) || c.hist.length > MAX_HIST || !c.hist.every((b) => Array.isArray(b) && b.length === 2 && isPos(b[0]) && isPos(b[1]) && b[0] >= b[1])) fail(`${at}.hist`);
  if (!(c.ema === null || c.ema === undefined || isPos(c.ema))) fail(`${at}.ema`);
  let setup = null;
  if (c.setup !== null && c.setup !== undefined){
    const s = c.setup;
    if (!isObj(s) || !isPos(s.hi) || !isPos(s.lo) || s.hi < s.lo || !isInt(s.age, 0, 100000)) fail(`${at}.setup`);
    setup = { hi: s.hi, lo: s.lo, age: s.age };
  }
  let pos = null;
  if (c.pos !== null && c.pos !== undefined){
    const p = c.pos;
    if (!isObj(p) || !['short', 'long'].includes(p.side)) fail(`${at}.pos.side`);
    if (p.sg !== (p.side === 'short' ? 1 : -1)) fail(`${at}.pos.sg`);
    if (!Array.isArray(p.lv) || p.lv.length !== 3 || !p.lv.every(isPos)) fail(`${at}.pos.lv`);
    if (!Array.isArray(p.fills) || p.fills.length > 3 || !p.fills.every(isPos)) fail(`${at}.pos.fills`);
    if (!isPos(p.stop) || !isIso(p.start) || !isInt(p.age, 0, 100000)) fail(`${at}.pos.stop/start/age`);
    if (!(p.ref === null || p.ref === undefined || isPos(p.ref))) fail(`${at}.pos.ref`);
    pos = { side: p.side, sg: p.sg, lv: p.lv.slice(), fills: p.fills.slice(), stop: p.stop, start: p.start, age: p.age, ref: p.ref ?? null };
  }
  let mark = null;
  if (c.mark !== null && c.mark !== undefined){
    if (!Array.isArray(c.mark) || c.mark.length !== 2 || !isIso(c.mark[0]) || !isPos(c.mark[1])) fail(`${at}.mark`);
    mark = [c.mark[0], c.mark[1]];
  }
  return { last_t: c.last_t, hist: c.hist.map((b) => [b[0], b[1]]), ema: c.ema ?? null, setup, pos, mark };
}

// אימות קפדני של מצב הסימולציה (סכימה גרסה 1). מחזיר עותק נקי — רק שדות מוכרים נשמרים; כל סטייה = שגיאה 400.
export function validateState(s){
  if (!isObj(s)) fail('state: לא אובייקט');
  if (s.version !== 1) fail('version: נתמכת רק גרסה 1');
  if (!isIso(s.start)) fail('start');
  if (!Array.isArray(s.trades) || s.trades.length > MAX_TRADES) fail('trades');
  if (!isObj(s.coins)) fail('coins');
  const keys = Object.keys(s.coins);
  if (!keys.length || keys.some((k) => !COINS.includes(k))) fail('coins: מטבע לא מוכר');
  const trades = s.trades.map(cleanTrade);
  const coins = {};
  for (const sym of COINS) if (keys.includes(sym)) coins[sym] = cleanCoin(s.coins[sym], sym);
  return { version: 1, start: s.start, trades, coins };
}

export async function sha256(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// קליטה מה-workflow: כותב ל-KV רק כשה-hash של המצב הנקי השתנה (קריאה אחת תמיד, כתיבה רק בשינוי)
export async function ingestSinay(db, body, { bytes = null, now = new Date() } = {}){
  const size = isNum(bytes) ? bytes : JSON.stringify(body ?? null).length;
  if (size > MAX_BYTES) throw Object.assign(new Error(`גדול מדי (${size} > ${MAX_BYTES} בתים)`), { status: 413 });
  if (!isObj(body) || !isObj(body.state)) fail('חסר state');
  const state = validateState(body.state);
  const source = {};
  if (body.commentId !== undefined){ if (!isInt(body.commentId, 1, Number.MAX_SAFE_INTEGER)) fail('commentId'); source.commentId = body.commentId; }
  if (body.commentUpdatedAt !== undefined){ if (!isIso(body.commentUpdatedAt)) fail('commentUpdatedAt'); source.commentUpdatedAt = body.commentUpdatedAt; }
  const hash = await sha256(JSON.stringify(state));
  const prev = await db.get(SINAY_KEY);
  if (prev?.hash === hash) return { ok: true, changed: false, hash, trades: state.trades.length };
  await db.put(SINAY_KEY, { hash, receivedAt: now.toISOString(), source, state });
  return { ok: true, changed: true, hash, trades: state.trades.length };
}

// P&L לא ממומש של פוזיציה פתוחה על משבצת של 50,000$: כל שליש שמולא = שליש מהסכום המתוכנן, ניכוי עמלת כניסה ועמלת יציאה משוערת
export function unrealized(pos, markPx, slot = SLOT_USD){
  if (!pos || !pos.fills?.length || !isPos(markPx)) return null;
  const third = slot / 3, dir = pos.side === 'short' ? -1 : 1;
  let pnl = 0;
  for (const f of pos.fills){ const ratio = markPx / f; pnl += third * dir * (ratio - 1) - third * FEE - third * ratio * FEE; }
  return pnl;
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

// עקומת שווי ממומש (התחלה + כל סגירת עסקה) וירידה מקסימלית ממנה
export function realizedCurve(start, trades, slot = SLOT_USD, base = ACCOUNT_USD){
  const sorted = trades.slice().sort((a, b) => Date.parse(a.close) - Date.parse(b.close) || a.n - b.n);
  const points = [{ t: start, equity: base, n: null }];
  let eq = base, peak = base, maxDd = 0, maxDdUsd = 0;
  for (const t of sorted){
    eq += t.net_pct / 100 * slot;
    points.push({ t: t.close, equity: r2(eq), n: t.n, sym: t.sym });
    if (eq > peak) peak = eq;
    const ddUsd = peak - eq;
    if (ddUsd > maxDdUsd){ maxDdUsd = ddUsd; maxDd = ddUsd / peak; }
  }
  return { points, maxDrawdown: r4(-maxDd), maxDrawdownUsd: r2(-maxDdUsd) };
}

// הדוח לחשבון של 200,000$: פונקציה טהורה של המצב השמור
export function sinayReport(stored, { now = new Date() } = {}){
  const base = { track: 'sinay', title: 'ניסוי סיני — דמה 200K$', accountUsd: ACCOUNT_USD, slotUsd: SLOT_USD, coins: COINS, feePerSide: FEE, issueUrl: SINAY_ISSUE_URL, paper: true, disclaimer: 'סימולציה בלבד — בלי כסף אמיתי. הכללים קפואים (Issue #189).' };
  if (!stored?.state) return { ...base, missing: true, waiting: true, note: 'ממתין לסנכרון ראשון מ-Issue #189', equityUsd: ACCOUNT_USD, pnlUsd: 0, pnlPct: 0, trades: [], openPositions: [], setups: [], equityCurve: [] };
  const s = stored.state;
  const trades = s.trades.map((t) => ({ ...t, usdScaled: r2(t.net_pct / 100 * SLOT_USD) }));
  const realized = trades.reduce((x, t) => x + t.net_pct / 100 * SLOT_USD, 0);
  const wins = trades.filter((t) => t.net_pct > 0), losses = trades.filter((t) => t.net_pct <= 0);
  const curve = realizedCurve(s.start, trades);
  const openPositions = [], setups = [], notes = [];
  let unreal = 0, lastUpdate = null;
  const later = (a, b) => (!a ? b : !b ? a : Date.parse(b) > Date.parse(a) ? b : a);
  const perCoin = {};
  for (const sym of COINS){
    const c = s.coins[sym];
    const ct = trades.filter((t) => t.sym === sym);
    perCoin[sym] = { trades: ct.length, pnlUsd: r2(ct.reduce((x, t) => x + t.usdScaled, 0)), wins: ct.filter((t) => t.net_pct > 0).length };
    if (!c) continue;
    lastUpdate = later(lastUpdate, later(c.last_t, c.mark?.[0] || null));
    if (c.pos){
      const p = c.pos, markPx = c.mark?.[1] ?? null;
      const u = unrealized(p, markPx);
      if (u === null && p.fills.length) notes.push(`${sym}: אין עדיין מחיר עדכני (mark) — הרווח הלא ממומש לא נספר`);
      if (isNum(u)) unreal += u;
      const avg = mean(p.fills);
      openPositions.push({ sym, side: p.side, filledThirds: p.fills.length, fills: p.fills, levels: p.lv, avg: isNum(avg) ? r4(avg) : null, stop: p.stop, ema: c.ema, start: p.start, ageBars: p.age, mark: markPx, markAt: c.mark?.[0] || null, unrealizedUsd: r2(u), notionalUsd: r2(SLOT_USD / 3 * p.fills.length) });
    } else if (c.setup){
      const [rLo, rHi] = NATURAL_RANGE[sym], mid = (rLo + rHi) / 2;
      setups.push({ sym, hi: c.setup.hi, lo: c.setup.lo, ageBars: c.setup.age, widthPct: r4(c.setup.hi / c.setup.lo - 1), nextShort: r4(c.setup.hi * (1 + mid)), nextLong: r4(c.setup.lo * (1 - mid)), naturalRange: [rLo, rHi], mark: c.mark?.[1] ?? null });
    }
  }
  const equity = ACCOUNT_USD + realized + unreal;
  const ageH = lastUpdate ? (now.getTime() - Date.parse(lastUpdate)) / 3600e3 : null;
  return {
    ...base,
    start: s.start, lastUpdate, receivedAt: stored.receivedAt || null, stale: isNum(ageH) && ageH > STALE_H, ageHours: isNum(ageH) ? r2(ageH) : null,
    equityUsd: r2(equity), pnlUsd: r2(equity - ACCOUNT_USD), pnlPct: r4((equity - ACCOUNT_USD) / ACCOUNT_USD),
    realizedUsd: r2(realized), unrealizedUsd: r2(unreal),
    stats: { trades: trades.length, wins: wins.length, losses: losses.length, winRate: trades.length ? r4(wins.length / trades.length) : null, avgWinUsd: r2(mean(wins.map((t) => t.usdScaled))), avgLossUsd: r2(mean(losses.map((t) => t.usdScaled))), maxDrawdown: curve.maxDrawdown, maxDrawdownUsd: curve.maxDrawdownUsd, target: 50 },
    perCoin, equityCurve: curve.points, openPositions, setups, notes,
    trades: trades.slice().sort((a, b) => Date.parse(b.close) - Date.parse(a.close) || b.n - a.n),
  };
}
