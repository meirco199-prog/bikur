// צד ה-Worker של הגשר לחשבון האמיתי (scripts/ibkr-live-bridge.mjs): מקבל דיווח, שומר, ומגיש דוח **פרטי** (דורש סוד/טוקן) — יתרות וחשבון אמיתיים לא עולים ל-GET ציבורי.
// אין כאן פקודות ואין שליטה: ה-Worker רק מתעד. עצירה: kill switch הקיים (POST /agent/kill) או קובץ LIVE_OFF על השרת. מפתחות KV: agent:live:latest, agent:live:<day>.
const cut = (s, n) => String(s ?? '').slice(0, n);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** דיווח מהגשר החי → נשמר מנוקה (שדות מוכרים בלבד, אורכים חתוכים) */
export async function recordLive(db, body = {}){
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(body.day || '')) ? body.day : new Date().toISOString().slice(0, 10);
  const s = body.summary || {};
  const rec = {
    day, updatedAt: new Date().toISOString(), authenticated: !!body.authenticated, mode: cut(body.mode, 30) || null, armed: !!body.armed, killed: !!body.killed,
    armReasons: (body.armReasons || []).slice(0, 6).map((x) => cut(x, 160)), account: cut(body.account, 12) || null, limitsHash: cut(body.limitsHash, 24) || null,
    summary: { equityUsd: num(s.equityUsd), cashUsd: num(s.cashUsd), unrealizedUsd: num(s.unrealizedUsd), dayStartEquityUsd: num(s.dayStartEquityUsd), hwmUsd: num(s.hwmUsd), opensToday: num(s.opensToday) },
    positions: (body.positions || []).slice(0, 20).map((p) => ({ symbol: cut(p.symbol, 12), qty: num(p.qty), avgPrice: num(p.avgPrice), marketPrice: num(p.marketPrice), unrealizedUsd: num(p.unrealizedUsd) })),
    sent: (body.sent || []).slice(0, 20).map((o) => ({ id: cut(o.id, 80), orderId: cut(o.orderId, 24), symbol: cut(o.symbol, 12), side: cut(o.side, 5), qty: num(o.qty), limit: num(o.limit), why: cut(o.why, 120) })),
    skipped: (body.skipped || []).slice(0, 30).map((o) => ({ id: cut(o.id, 80), symbol: cut(o.symbol, 12), side: cut(o.side, 8), reason: cut(o.reason, 200) })),
    fills: (body.fills || []).slice(0, 30), errors: (body.errors || []).slice(0, 20).map((e) => cut(e, 200)),
  };
  const prev = (await db.get(`agent:live:${day}`)) || { sent: [], skipped: [] };
  const keyOf = (o) => o.id; const merge = (a, b) => [...new Map([...a, ...b].map((o) => [keyOf(o), o])).values()].slice(-60);
  const merged = { ...rec, sent: merge(prev.sent || [], rec.sent), skipped: merge(prev.skipped || [], rec.skipped) };
  await db.put(`agent:live:${day}`, merged, { ttl: 90 * 86400 });
  await db.put('agent:live:latest', { day, updatedAt: rec.updatedAt, authenticated: rec.authenticated, mode: rec.mode, armed: rec.armed });
  return { ok: true, day, mode: rec.mode, armed: rec.armed, sent: rec.sent.length, skipped: rec.skipped.length };
}

/** דוח פרטי: המצב האחרון + רווח/הפסד ממשי (שינוי בשווי הפוזיציות הלא-ממומש; לא netLiq פחות הפקדות — הפקדות לא ידועות לגשר) */
export async function liveReport(db){
  const latest = await db.get('agent:live:latest');
  if (!latest) return { missing: true, reason: 'הגשר החי עוד לא דיווח (invest/docs/LIVE_BRIDGE.md)' };
  const rec = (await db.get(`agent:live:${latest.day}`)) || null;
  const staleMinutes = latest.updatedAt ? Math.round((Date.now() - Date.parse(latest.updatedAt)) / 60000) : null;
  return { ...latest, staleMinutes, record: rec };
}
