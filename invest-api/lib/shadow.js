// מודל צל — הרצה לילית (אחרי הדירוג), מילוי תשואות עתידיות למסמכים ישנים, וצבירת סטטיסטיקות. לא שולח פקודות לעולם.
// מפתחות: shadow:{day} (מסמך יומי), shadow:stats (צבירה). כתיבות KV: ≤ 1 + אופקים(3) + 1 ליום.
import { computeShadow, fillForward, accumulateStats, summarizeStats, SHADOW_RULES, SHADOW_VERSION } from '../engine/shadow.js';
import { estimateRevision, latestRankDay } from './analysis.js';
import { isNum } from '../engine/util.js';

export async function runShadow(ctx, { day = null, force = false } = {}){
  const { db } = ctx;
  day = day || (await latestRankDay(db));
  if (!day) return { ran: false, reason: 'אין דירוג עדיין' };
  const rank = await db.get(`rank:${day}`);
  if (!rank?.table?.length) return { ran: false, reason: `אין טבלת דירוג ל-${day}` };
  const existing = await db.get(`shadow:${day}`);
  let doc = existing, created = false;
  if (!existing || force){
    const regime = (await db.get(`regime:${day}`)) || null;
    const revisions = {};
    for (const r of rank.table) if (r.type === 'stock') revisions[r.symbol] = await estimateRevision(db, r.symbol);
    doc = computeShadow({ table: rank.table, revisions, regime, day, barDate: rank.barDate || null });
    if (force && existing) doc.fwd = existing.fwd || {}; // מילויים שכבר נעשו נשמרים (מחירים היסטוריים לא משתנים)
    await db.put(`shadow:${day}`, doc); created = true;
  }
  // תשואות עתידיות: למסמכים של לפני h ימי ניתוח, לפי מחירי היום
  const days = (await db.get('idx:snapdays')) || [];
  const idx = days.indexOf(day);
  const priceNow = Object.fromEntries(rank.table.map((r) => [r.symbol, r.price]));
  const spyNow = priceNow.SPY ?? null;
  let stats = await db.get('shadow:stats');
  const filled = {};
  if (idx >= 0) for (const h of SHADOW_RULES.horizons){
    const then = days[idx - h]; if (!then) continue;
    const old = await db.get(`shadow:${then}`); if (!old || old.fwd?.[h]) continue;
    const spyThen = old.rows.find((r) => r.symbol === 'SPY')?.price ?? (await db.get(`rank:${then}`))?.table?.find((r) => r.symbol === 'SPY')?.price ?? null;
    const f = fillForward(old, h, priceNow, { spyNow, spyThen, day });
    if (f.filled){ await db.put(`shadow:${then}`, old); stats = accumulateStats(stats, old, h); filled[h] = { day: then, filled: f.filled }; }
  }
  if (Object.keys(filled).length) await db.put('shadow:stats', stats);
  // סדרת התפלגות יומית (מסמך אחד, עד 250 ימים): חלק "קנייה חזקה"/"קנייה", ממוצע וחציון לכל מודל
  if (created){
    const series = (await db.get('shadow:dist')) || [];
    const row = { day, n: doc.n, ...Object.fromEntries(['A', 'B', 'C'].map((m) => [m, { mean: doc.dist?.[m]?.mean ?? null, median: doc.dist?.[m]?.median ?? null, strong: doc.dist?.[m]?.strongBuyShare ?? null, buy: doc.dist?.[m]?.buyShare ?? null, sell: doc.dist?.[m]?.sellShare ?? null }])) };
    const i = series.findIndex((x) => x.day === day); if (i >= 0) series[i] = row; else series.push(row);
    await db.put('shadow:dist', series.sort((a, b) => a.day.localeCompare(b.day)).slice(-250));
  }
  return { ran: true, day, created, n: doc.n, eligible: doc.eligible, agreement: doc.agreement, actions: { A: doc.models.A.actions, B: doc.models.B.actions, C: doc.models.C.actions }, revisionsAvailable: doc.revisionsAvailable, filled };
}

export async function shadowReport(db, { day = null } = {}){
  day = day || (await latestRankDay(db));
  const doc = day ? await db.get(`shadow:${day}`) : null;
  const stats = summarizeStats(await db.get('shadow:stats'));
  const distSeries = ((await db.get('shadow:dist')) || []).slice(-60);
  if (!doc) return { day, missing: true, reason: 'מודל הצל עוד לא רץ להיום', stats, distSeries };
  const { rows, ...rest } = doc;
  const compact = rows.map((r) => ({ symbol: r.symbol, name: r.name, sector: r.sector, A: r.A, actA: r.actA, B: r.B, actB: r.actB, C: r.C, actC: r.actC, revision: r.revision, revisionNote: r.revisionNote, pct: r.pct, contribC: r.contribC }));
  const revDays = (() => { const notes = rows.map((r) => r.revisionNote || '').map((n) => /היסטוריה של (\d+) ימים/.exec(n)?.[1]).filter(Boolean).map(Number); return notes.length ? Math.max(...notes) : null; })();
  return { ...rest, rows: compact, revisionHistoryDays: revDays, stats, distSeries, version: SHADOW_VERSION };
}
export const isShadowRow = (r) => r && isNum(r.A);
