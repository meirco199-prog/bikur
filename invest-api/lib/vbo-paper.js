// מעקב Paper Trading לפריצת תנודתיות תוך-יומית על BTC/ETH (engine/vbo-paper.js) — צד ה-Worker: שמירת המצב ב-KV ושורות לסיכום היומי.
// המצב מחושב ב-GitHub Actions (scripts/vbo-paper.mjs, 4 פעמים ביום, על כל נרות השעה שנסגרו מאז) ונשלח ל-POST /vbo עם סוד ה-cron.
export const VBOPAPER_KEY = 'paper:vbo';
const DAY = 86400e3;
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const str = (x, n = 40) => String(x ?? '').slice(0, n);
const COIN = /^(BTC|ETH)$/;

// אימות ונרמול הדוח (מגיע מ-Actions; לא סומכים על המבנה)
export function cleanVbo(b){
  if (!b || typeof b !== 'object' || b.id !== 'VBO0.7-ma20-BE') throw Object.assign(new Error('דוח לא תקין'), { status: 400 });
  const day = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x)) ? String(x) : null);
  const pos = {}; for (const [c, p] of Object.entries(b.pos || {})) if (COIN.test(c) && p && typeof p === 'object')
    pos[c] = { t: str(p.t, 30), entry: num(p.entry), last: num(p.last), notional: num(p.notional), usdIn: num(p.usdIn), costIn: num(p.costIn), fund: num(p.fund), trig: num(p.trig) };
  const trades = (Array.isArray(b.trades) ? b.trades : []).slice(-500).filter((x) => COIN.test(x?.coin)).map((x) => ({ coin: x.coin, in: str(x.in, 30), out: str(x.out, 30),
    entry: num(x.entry), exit: num(x.exit), usd: num(x.usd), pnlUsd: num(x.pnlUsd), pnlPct: num(x.pnlPct) }));
  const daily = (Array.isArray(b.daily) ? b.daily : []).slice(-500).map((x) => ({ day: day(x.day), equity: num(x.equity), btc: num(x.btc) }));
  const lastDayIn = {}; for (const [c, d] of Object.entries(b.lastDayIn || {})) if (COIN.test(c) && day(d)) lastDayIn[c] = d;
  const out = { v: 1, id: b.id, startedAt: str(b.startedAt, 30), startDay: day(b.startDay), lastHour: str(b.lastHour, 30), startUsd: num(b.startUsd), equity: num(b.equity),
    btcStart: num(b.btcStart), btcEquity: num(b.btcEquity), pos, lastDayIn, costsUsd: num(b.costsUsd), fundUsd: num(b.fundUsd), trades, daily };
  if (out.equity === null || out.startUsd === null) throw Object.assign(new Error('דוח לא תקין: חסר הון'), { status: 400 });
  return out;
}
export async function recordVbo(db, body, { now = new Date() } = {}){
  const rep = cleanVbo(body);
  await db.put(VBOPAPER_KEY, { ...rep, receivedAt: now.toISOString() });
  return { ok: true, saved: true, lastHour: rep.lastHour };
}

const pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
const usd = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x)).toLocaleString('en-US')}$`;
// שורות לסיכום הקריפטו היומי (בלי הודעה נפרדת — מאיר ביקש רק סיכום יום). day = יום UTC של העסקאות שנסגרו (ברירת מחדל: אתמול/היום)
export function vboLines(rep, nowMs = Date.now()){
  if (!rep || !rep.startUsd) return [];
  const eq = rep.equity / rep.startUsd - 1, btc = rep.btcEquity && rep.startUsd ? rep.btcEquity / rep.startUsd - 1 : null;
  const tr = rep.trades || [], wins = tr.filter((x) => x.pnlUsd > 0), sw = wins.reduce((s, x) => s + x.pnlUsd, 0), sl = -tr.filter((x) => x.pnlUsd <= 0).reduce((s, x) => s + x.pnlUsd, 0);
  const since = nowMs - DAY, recent = tr.filter((x) => Date.parse(x.out) >= since);
  const open = Object.entries(rep.pos || {}).map(([c, p]) => `${c} מ-${Math.round(p.entry).toLocaleString('en-US')}`);
  const ageH = rep.receivedAt ? (nowMs - Date.parse(rep.receivedAt)) / 3600e3 : 0;
  return ['⚡ מעקב Paper — פריצה תוך-יומית BTC/ETH (בלי כסף, בלי פקודות)',
    `מאז ${rep.startDay}: ${Math.round(rep.equity).toLocaleString('en-US')}$ (${pct(eq)})${btc !== null ? ` · ביטקוין באותה תקופה ${pct(btc)}` : ''}`,
    tr.length ? `עסקאות: ${tr.length}, הצלחות ${wins.length}${sl > 0 ? ` · Profit Factor ${(sw / sl).toFixed(2)}` : ''} · ב-24 השעות האחרונות: ${recent.length ? recent.map((x) => `${x.coin} ${usd(x.pnlUsd)}`).join(', ') : 'אין'}` : 'עוד לא היו עסקאות (נכנסים רק בימי פריצה חזקה)',
    open.length ? `פתוח עכשיו: ${open.join(', ')} (יציאה בסוף היום UTC)` : 'אין פוזיציה פתוחה',
    ...(ageH > 14 ? [`⚠️ המעקב לא התעדכן ${Math.round(ageH)} שעות`] : [])];
}
