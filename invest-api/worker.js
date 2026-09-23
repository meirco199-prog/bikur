// invest-api — ה-API, ה-cron ושכבת ה-AI של פלטפורמת המחקר (/invest/). Cloudflare Worker + KV.
// מסמכים: invest/docs/ARCHITECTURE.md. כל המפתחות ב-Secrets בלבד. אין scraping.
import { DB, kvWriteLimitHit } from './lib/db.js';
import { resolveEnv, keysStatus, setKey, isAuthed } from './lib/keys.js';
import { Budget } from './lib/budget.js';
import { providerStatus } from './providers/registry.js';
import { PaperBroker } from './lib/broker.js';
import { evaluateAlerts, ALERT_TYPES, send as sendAlert } from './lib/alerts.js';
import { ask } from './lib/ai.js';
import { runAutopilot, autoStatus } from './lib/autopilot.js';
import { runShadow, shadowReport } from './lib/shadow.js';
import { runAggressive, aggrReport, executeAggressive } from './lib/aggressive.js';
import { runAgent, agentReport, setKill } from './lib/agent.js';
import { AGENT_SIM_POLICY } from './engine/agent-sim-policy.js';
import { policyHash } from './engine/order-gate.js';
import { getSnap, listSnaps, putSnapsBatch } from './lib/snapstore.js';
import { runTracksDecide, runTracksFill, trackReport, tracksCompare } from './lib/tracks.js';
import { TRACK_IDS } from './engine/tracks.js';
import { paperBreakdown } from './engine/paper-breakdown.js';
import { resolveClosePrices, markToClose } from './lib/mark.js';
import { AUTO_RULES } from './engine/autopilot.js';
import { PROFILES } from './engine/portfolio.js';
const sp500Set = async (db) => { const m = await db.get('meta:mechanical'); return m?.symbols?.length ? new Set(m.symbols) : null; };
import { SYM_RE, today, getUniverse, addToUniverse, assetMeta, getPrices, getQuote, loadBundle, analyzeSymbol, analyzeBundle, toSnapshot, computeRegime, rankSnapshots, buildRecommendations, loadMacro, latestRankDay, getNews, refreshMechanicalUniverse, refreshEarningsCalendar } from './lib/analysis.js';
import { fetchWithFallback } from './providers/registry.js';
import { filterUniverse, findAsset, SEED_UNIVERSE, INDICES } from './engine/universe.js';
import { DEFAULT_WEIGHTS } from './engine/scoring.js';
import { forwardReturns } from './engine/backtest.js';
import { isoDate, uid, round, isNum } from './engine/util.js';

const VERSION = '1.0.0';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Access-Control-Max-Age': '86400' };
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...extra } });
const err = (msg, status = 400, extra = {}) => json({ error: msg, ...extra }, status);

// rate limit בזיכרון ה-isolate (KV חינמי מוגבל ל-1000 כתיבות/יום — לא לבזבז אותן על מונים)
const RL = new Map();
function rateLimited(ip, path){
  const minute = Math.floor(Date.now() / 60000);
  // דליים: AI (יקר) 10/דקה; נתונים לחישוב בדפדפן (bundle/prices/snapshot) 600/דקה; שאר הבקשות 240/דקה
  const bucket = path.startsWith('/ai') ? 'ai' : /^\/(bundle|prices|snapshot)\//.test(path) ? 'data' : 'all';
  const key = `${ip}:${minute}:${bucket}`;
  const n = (RL.get(key) || 0) + 1;
  RL.set(key, n);
  if (RL.size > 5000) RL.clear();
  return n > ({ ai: 10, data: 600, all: 240 })[bucket];
}
const validSym = (s) => typeof s === 'string' && SYM_RE.test(s.toUpperCase());
const validDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));

async function makeCtx(env0, waitUntil){
  // כל ערך סודי מהסביבה (מפתחות/טוקנים/סודות) לא נכתב ללוג השגיאות ולא מוצג ב-/health
  const db = new DB(env0.INVEST, { secrets: Object.entries(env0).filter(([k, v]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(k) && typeof v === 'string').map(([, v]) => v) });
  const env = await resolveEnv(env0, db); // Secrets + מפתחות שהוזנו באפליקציה
  const budget = new Budget(db);
  return { env, db, budget, waitUntil: waitUntil || (() => {}) };
}

// ---------- cron: עיבוד באצ'ים (תוכנית חינם: ~10ms CPU לקריאה → CRON_BATCH קטן, cron תכוף) ----------
export async function cronStep(ctx, { batch = null, force = false } = {}){
  // עמיד למקביליות (cron של Cloudflare + tick מ-GitHub): מצב ה"תור" נגזר מהמפתחות snap:{day}:* בפועל,
  // ולא ממונה משותף; putIfAbsent מונע כפילות גם אם שני מריצים בחרו אותו נכס.
  const db = ctx.db, day = today();
  const B = batch || parseInt(ctx.env.CRON_BATCH || '3', 10);
  const log = [];
  const prevState = await db.get('cron:state');
  if (prevState?.day === day && prevState.finalized && !force) return { day, processed: 0, queueLeft: 0, done: prevState.done, finalized: true, errors: [], log: ['היום כבר הסתיים; force=1 להרצה מחדש (למשל אחרי הוספת מפתח)'] };
  const watch0 = new Set(((await db.get('user:watchlist')) || []).map((w) => w.symbol));
  const universe = await getUniverse(db, ctx.env);
  const watch = (await db.get('user:watchlist')) || [];
  // היקום המכני (S&P 500) מנותח ב-GitHub Actions ונכתב ב-shards (lib/snapstore.js) — לא בתור של ה-Worker (מכסות ספקים/KV)
  const syms = [...new Set([...universe.filter((a) => a.origin !== 'mechanical' || watch0.has(a.symbol)).map((a) => a.symbol), ...watch.map((w) => w.symbol)])];
  let regime = await db.get(`regime:${day}`);
  if (!regime || force){
    regime = await computeRegime(ctx, { breadth: (await db.get(`rank:${(await latestRankDay(db)) || ''}`))?.breadth ?? null });
    await db.putIfAbsent(`regime:${day}`, regime);
    log.push(`regime ${regime.summary}`);
    // לוח דוחות יומי (קריאה אחת ל-FMP לכל השוק) — לפני ניתוח הנכסים כדי שהתאריכים יהיו טריים
    if (ctx.env.FMP_KEY){ try { const c = await refreshEarningsCalendar(ctx); log.push(`earnings calendar: ${c.count} (${c.from}→${c.to})`); } catch (e) { await db.logError('earncal', e.message); } }
  }
  // snapshot "חסר" (תקלת נתונים, לא תוצר מודל) נחשב לא-גמור וניתן למילוי מחדש; ציון אמיתי לעולם לא נדרס
  const doneKeys = await db.list(`snap:${day}:`);
  const done = new Set();
  for (const k of doneKeys){ const sym = k.slice(`snap:${day}:`.length); const ex = await db.get(k); if (!ex) continue; if (!ex.missing) done.add(sym); else if (!force){ const px = await db.get(`px:${sym}`); if (!px?.rows?.length) done.add(sym); } }
  const queue = syms.filter((s) => !done.has(s));
  // פיזור: מריצים מקבילים מתחילים מנקודות שונות בתור
  const offset = queue.length ? Math.floor(Math.random() * queue.length) : 0;
  const pick = [...queue.slice(offset), ...queue.slice(0, offset)].slice(0, B);
  const days = (await db.get('idx:snapdays')) || [];
  const prevDay = days.filter((d) => d < day).slice(-1)[0] || null;
  const errors = [];
  for (const sym of pick){
    try {
      const a = await analyzeSymbol(sym, ctx, { regime, cron: true, watched: watch0.has(sym) });
      const snap = toSnapshot(a);
      const ex = await db.get(`snap:${day}:${sym}`);
      let fresh = false;
      if (!ex || (ex.missing && !snap.missing)){ await db.put(`snap:${day}:${sym}`, snap); fresh = true; }
      const prev = prevDay ? await getSnap(db, prevDay, sym) : null;
      if (fresh && !snap.missing){ const alerts = await evaluateAlerts(ctx, snap, prev, a); if (alerts.length) log.push(`${sym}: ${alerts.length} alerts`); }
      if (snap.missing) log.push(`${sym}: missing — ${snap.reason}`);
      done.add(sym);
    } catch (e) { errors.push({ sym, msg: e.message.slice(0, 160) }); await db.logError(`cron ${sym}`, e.message); }
  }
  for (const k of await db.list(`snap:${day}:`)){ const sym = k.slice(`snap:${day}:`.length); if (!done.has(sym)){ const ex = await db.get(k); if (ex && (!ex.missing || pick.includes(sym) || (!force && !(await db.get(`px:${sym}`))?.rows?.length))) done.add(sym); } }
  const left = syms.filter((s) => !done.has(s)).length;
  const exRank = await db.get(`rank:${day}`);
  let finalized = !!(exRank && (exRank.analyzed > 0 || !force)); // דירוג ריק (כשל נתונים) ניתן להחלפה ב-force
  // דירוג ותיקים הם אגרגט של ה-snapshots (שלעולם לא נדרסים): מחושבים מחדש כשנוספו snapshots חדשים היום
  if (!left && (!finalized || pick.length)){
    const snaps = await listSnaps(db, day);
    const rank = rankSnapshots(snaps, { sp500: await sp500Set(db) });
    if (exRank && (rank.analyzed > (exRank.analyzed || 0))){ await db.put(`rank:${day}`, rank); await db.delete(`reco:${day}`); finalized = true; }
    else if (!exRank) finalized = await db.putIfAbsent(`rank:${day}`, rank);
    else finalized = false;
    if (finalized){
      try { const reco = await buildRecommendations(ctx, rank); await db.putIfAbsent(`reco:${day}`, reco); } catch (e) { await db.logError('reco', e.message); }
      if (!days.includes(day)){ days.push(day); await db.put('idx:snapdays', days.sort().slice(-3000)); }
      // עקומות השווי (תרגול + אגרסיבי) לפי יום הסשן שנסגר ובסגירות מאומתות — לא לפי יום העיבוד ומחירי ה-snapshot (AI_COUNCIL#17)
      try { await markToClose(ctx); } catch (e) { await db.logError('mark', e.message); }
      // יקום מכני: יומי (ויקיפדיה חינם; הוספה בקצב מוגבל עד שכל הנבחרות ביקום), FMP רק לגודל/הרכב היסטורי
      try { const r = await refreshMechanicalUniverse(ctx); log.push(`universe: ${r.ok ? `${r.source} ${r.selected} (+${r.added}/−${r.removed}, ממתינות ${r.pending})` : r.reason}`); } catch (e) { await db.logError('universe', e.message); }
      log.push(`finalized: ${snaps.length} snapshots (${rank.analyzed} analyzed), ${rank.categories.buySignals.length} buy signals`);
    }
    finalized = true;
  }
  const state = { day, done: done.size, queueLeft: left, finalized, errors: errors.slice(-5), at: new Date().toISOString(), log: log.slice(-8) };
  if (pick.length || finalized !== !!prevState?.finalized || prevState?.day !== day) await db.put('cron:state', state); // כתיבה רק כשיש שינוי (מכסת KV)
  return { day, processed: pick.length, queueLeft: left, done: done.size, finalized, errors: errors.slice(-5), log };
}

// ---------- routes ----------
async function handle(req, env0, ctx){
  const env = ctx.env;
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const q = Object.fromEntries(url.searchParams);
  const db = ctx.db;
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const authedNow = await isAuthed(req, env);
  const needAuth = () => { if (!authedNow) throw Object.assign(new Error('unauthorized'), { status: 401 }); };
  const sym = (s) => { const u = String(s || '').toUpperCase(); if (!validSym(u)) throw Object.assign(new Error('סימבול לא תקין'), { status: 400 }); return u; };
  const m = path.match(/^\/([a-z-]+)(?:\/([^/]+))?(?:\/([^/]+))?$/);
  const [, r0, p1, p2] = m || [];

  if (path === '/' || path === '/health'){
    const budget = await ctx.budget.status();
    const cron = await db.get('cron:state');
    const errors = await db.recentErrors(10);
    return json({ ok: true, version: VERSION, time: new Date().toISOString(), providers: providerStatus(env), budget, cron, snapshotDays: ((await db.get('idx:snapdays')) || []).slice(-5), auth: env.APP_TOKEN ? 'token' : env.APP_TOKEN_SHA256 ? 'token' : 'OPEN (הגדר APP_TOKEN!)', keys: await keysStatus(env0, db), ai: env.ANTHROPIC_API_KEY ? 'anthropic' : env.AI ? 'workers-ai' : 'none', kv: env.INVEST ? 'bound' : 'MISSING', kvWriteLimitHit, alerts: { telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID), email: !!(env.RESEND_KEY && env.ALERT_EMAIL) }, recentErrors: errors });
  }
  if (r0 === 'keys'){
    needAuth();
    if (req.method === 'GET') return json(await keysStatus(env0, db));
    if (req.method === 'POST'){ try { await setKey(db, body.name, body.value); } catch (e) { return err(e.message); } return json({ ok: true, keys: await keysStatus(env0, db) }); }
  }
  // מודל צל: ציונים חלופיים במקביל למודל הישן, בלי פקודות. דוח = מסמך היום + סטטיסטיקות תשואה עתידית מצטברות
  if (r0 === 'shadow'){
    if (p1 === 'report' || !p1) return json(await shadowReport(db, { day: q.date || null }));
    if (p1 === 'run' && req.method === 'POST'){ const bySecret = !!(env.CRON_SECRET && q.secret === env.CRON_SECRET); if (!bySecret) needAuth(); try { return json(await runShadow(ctx, { day: q.date || null, force: q.force === '1' })); } catch (e) { await db.logError('shadow', e.message); return err('מודל צל: ' + e.message, 500); } }
    if (validDate(p1)) return json((await db.get(`shadow:${p1}`)) || { missing: true });
    return err('not found', 404);
  }
  // מסלול אגרסיבי (תיק צל, סימולציה בלבד — לא חשבון התרגול): דוח + הרצה
  if (r0 === 'aggressive'){
    if (p1 === 'report' || !p1) return json(await aggrReport(db, ctx));
    if (p1 === 'run' && req.method === 'POST'){ const bySecret = !!(env.CRON_SECRET && q.secret === env.CRON_SECRET); if (!bySecret) needAuth(); try { return json(await runAggressive(ctx, { day: q.date || null, force: q.force === '1', reset: q.reset === '1' })); } catch (e) { await db.logError('aggressive', e.message); return err('מסלול אגרסיבי: ' + e.message, 500); } }
    if (p1 === 'execute' && req.method === 'POST'){ const bySecret = !!(env.CRON_SECRET && q.secret === env.CRON_SECRET); if (!bySecret) needAuth(); try { return json(await executeAggressive(ctx, { force: q.force === '1' && !bySecret })); } catch (e) { await db.logError('aggressive-exec', e.message); return err('ביצוע אגרסיבי: ' + e.message, 500); } }
    return err('not found', 404);
  }
  // הסוכן האוטונומי הרב-נכסי (סימולציית IBKR, AI_COUNCIL#21): דוח ציבורי; ריצה/איפוס/kill עם סוד ה-cron או טוקן האפליקציה
  if (r0 === 'agent'){
    if (p1 === 'report' || !p1) return json(await agentReport(db));
    if (p1 === 'policy') return json({ policy: AGENT_SIM_POLICY, hash: policyHash(AGENT_SIM_POLICY), kill: (await db.get('agent:kill')) || null });
    if (p1 === 'opportunities'){ const day = validDate(q.date) ? q.date : (await db.get('agent:state'))?.lastDay; return json((day && (await db.get(`agent:opps:${day}`))) || { missing: true, day: day || null }); }
    const bySecret = !!(env.CRON_SECRET && q.secret === env.CRON_SECRET);
    if (p1 === 'run' && req.method === 'POST'){ if (!bySecret) needAuth(); try { return json(await runAgent(ctx, { day: validDate(q.date) ? q.date : null, force: q.force === '1', reset: q.reset === '1', batch: Math.min(12, Math.max(1, Number(q.batch) || 6)) })); } catch (e) { await db.logError('agent', e.message); return err('סוכן: ' + e.message, 500); } }
    if (p1 === 'kill' && req.method === 'POST'){ if (!bySecret) needAuth(); return json(await setKill(db, { on: !(q.on === '0' || body.on === false), reason: body.reason || q.reason || null })); }
    return err('not found', 404);
  }
  // מסלולי השוואה (תיקי צל): regB, regC, אגרסיבי B, לצד חשבון התרגול המאוזן והמסלול האגרסיבי הקיים — שום פקודה אמיתית
  if (r0 === 'tracks'){
    if (!p1 || p1 === 'compare') return json(await tracksCompare(db));
    if (p1 === 'run' && req.method === 'POST'){ const bySecret = !!(env.CRON_SECRET && q.secret === env.CRON_SECRET); if (!bySecret) needAuth(); try { const decide = await runTracksDecide(ctx, { day: q.date || null, force: q.force === '1' }); const fill = await runTracksFill(ctx, { day: decide.day || q.date || null }); return json({ decide, fill }); } catch (e) { await db.logError('tracks', e.message); return err('מסלולים: ' + e.message, 500); } }
    if (p1 === 'fill' && req.method === 'POST'){ const bySecret = !!(env.CRON_SECRET && q.secret === env.CRON_SECRET); if (!bySecret) needAuth(); try { return json(await runTracksFill(ctx, { day: q.date || null })); } catch (e) { await db.logError('tracks-fill', e.message); return err('מילוי מסלולים: ' + e.message, 500); } }
    if (TRACK_IDS.includes(p1)) return json(await trackReport(db, p1));
    return err('not found', 404);
  }
  // רענון יקום מכני + לוח דוחות לפי דרישה (בדיקת endpoints של FMP בפועל). cron עושה זאת לבד: לוח יומי, יקום בימי שני
  if (r0 === 'universe' && p1 === 'refresh' && req.method === 'POST'){
    const bySecret = !!(env.CRON_SECRET && q.secret === env.CRON_SECRET); if (!bySecret) needAuth();
    const out = {};
    try { out.universe = await refreshMechanicalUniverse(ctx, { cap: q.cap ? +q.cap : null, reset: q.reset === '1', maxAdd: q.maxAdd ? +q.maxAdd : null }); } catch (e) { out.universe = { ok: false, error: e.message }; }
    try { const c = await refreshEarningsCalendar(ctx); out.calendar = c ? { count: c.count, from: c.from, to: c.to } : { ok: false, reason: 'אין FMP_KEY' }; } catch (e) { out.calendar = { ok: false, error: e.message }; }
    return json(out);
  }
  if (r0 === 'universe' && p1 === 'sp500'){ const m = (await db.get('meta:mechanical')) || {}; const u = await getUniverse(db, env); const by = new Map(u.map((a) => [a.symbol, a])); return json({ asOf: m.asOf || null, count: (m.symbols || []).length, items: (m.symbols || []).map((sym) => { const a = by.get(sym) || {}; return { symbol: sym, name: a.name || sym, nameHe: a.nameHe || null, sector: a.sector || null, origin: a.origin || null }; }) }); }
  if (r0 === 'universe'){
    const u = await getUniverse(db, env);
    const day = q.date || (await latestRankDay(db));
    const rank = day ? await db.get(`rank:${day}`) : null;
    const byS = new Map((rank?.table || []).map((r) => [r.symbol, r]));
    const list = filterUniverse(u.filter((a) => !q.origin || a.origin === q.origin).map((a) => ({ ...a, ...(byS.get(a.symbol) || {}) })), { ...q, minMarketCap: q.minMarketCap ? +q.minMarketCap : undefined, maxMarketCap: q.maxMarketCap ? +q.maxMarketCap : undefined, maxVol: q.maxVol ? +q.maxVol : undefined, minDividend: q.minDividend ? +q.minDividend : undefined, minReturn1y: q.minReturn1y ? +q.minReturn1y : undefined });
    return json({ date: day, count: list.length, items: list, indices: INDICES });
  }
  if (r0 === 'screen'){
    needAuth();
    const r = await fetchWithFallback('screener', '', { ...q, limit: Math.min(+q.limit || 50, 100), minMarketCap: q.minMarketCap ? +q.minMarketCap : undefined }, ctx);
    if (r.missing) return json({ missing: true, reason: r.reason, note: 'ה-screener החיצוני דורש FMP_KEY; הסינון המקומי ב-/universe זמין תמיד' });
    if (q.add === '1') r.added = await addToUniverse(db, r.items.map((x) => ({ symbol: x.symbol, name: x.name, type: x.type, assetClass: 'equity', role: 'satellite', sector: x.sector, country: x.country || 'US', currency: 'USD', origin: 'screener', stooq: x.symbol.toLowerCase().replace('.', '-') + '.us' })));
    return json(r);
  }
  if (r0 === 'search'){
    const qq = (q.q || '').trim().toUpperCase();
    if (!qq) return json({ items: [] });
    const u = await getUniverse(db);
    const local = u.filter((a) => a.symbol.includes(qq) || (a.name || '').toUpperCase().includes(qq) || (a.nameHe || '').includes(q.q.trim())).slice(0, 15);
    const tickers = await db.get('edgar:tickers');
    const ext = tickers?.map ? Object.entries(tickers.map).filter(([t, v]) => t.startsWith(qq) || v.name.toUpperCase().includes(qq)).slice(0, 10).map(([t, v]) => ({ symbol: t, name: v.name, type: 'stock', country: 'US', currency: 'USD', origin: 'edgar' })) : [];
    return json({ items: [...local, ...ext.filter((e) => !local.some((l) => l.symbol === e.symbol))].slice(0, 20), note: validSym(qq) && !local.length ? `אפשר לפתוח כל סימבול ישירות: /asset/${qq}` : undefined });
  }
  if (r0 === 'asset' && p1){
    const s = sym(p1);
    if (q.refresh === '1'){ needAuth(); for (const k of ['px', 'quote', 'news', 'analyst', 'facts', 'ratios', 'profile', 'est', 'earn', 'insider', 'etf']) { const v = await db.get(`${k}:${s}`); if (v) await db.put(`${k}:${s}`, { ...v, fetchedAt: '2000-01-01T00:00:00Z' }); } }
    const a = await analyzeSymbol(s, ctx);
    if (a.missing) return json(a, 200);
    const days = (await db.get('idx:snapdays')) || [];
    const hist = [];
    for (const d of days.slice(-90)){ const sn = await getSnap(db, d, s); if (sn && !sn.missing) hist.push({ date: d, score: sn.score, signal: sn.signal, price: sn.price }); }
    const watch = (await db.get('user:watchlist')) || [];
    return json({ ...a, history: hist, watched: watch.some((w) => w.symbol === s), series: a.bundle ? undefined : undefined });
  }
  if (r0 === 'ingest' && p1 === 'prices' && req.method === 'POST'){
    if (!(env.CRON_SECRET && q.secret === env.CRON_SECRET)) needAuth();
    const items = Array.isArray(body.items) ? body.items : [body];
    const out = [];
    for (const it of items.slice(0, 200)){
      if (!validSym(it.symbol || '')) { out.push({ symbol: it.symbol, error: 'סימבול' }); continue; }
      const s = String(it.symbol).toUpperCase();
      let rows = Array.isArray(it.rows) ? it.rows : null;
      if (!rows && typeof it.csv === 'string'){ const { parseCSV, num } = await import('./lib/http.js'); rows = parseCSV(it.csv).map((r) => [r.Date, num(r.Open), num(r.High), num(r.Low), num(r.Close), num(r.Volume) ?? 0]).filter((r) => r[0] && r[4] !== null); }
      if (!rows || !rows.length){ out.push({ symbol: s, error: 'אין שורות' }); continue; }
      rows = rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && isNum(r[4])).sort((a, b) => a[0].localeCompare(b[0]));
      const ex = await db.get(`px:${s}`);
      const merged = DB.mergeRows(ex?.rows || [], rows);
      await db.put(`px:${s}`, { symbol: s, rows: merged, currency: it.currency || ex?.currency || 'USD', source: it.source || 'stooq-via-github', asOf: merged[merged.length - 1][0], fetchedAt: new Date().toISOString(), quality: 0.6 });
      out.push({ symbol: s, rows: merged.length, asOf: merged[merged.length - 1][0] });
    }
    return json({ ok: true, items: out });
  }
  if (r0 === 'prices' && p1){
    const s = sym(p1);
    const asset = await assetMeta(db, s);
    const px = await getPrices(s, { ...ctx, asset });
    if (px.missing) return json(px);
    const from = q.from || null;
    return json({ symbol: s, currency: px.currency, source: px.source, asOf: px.asOf, stale: !!px.stale, quality: px.quality, rows: from ? px.rows.filter((r) => r[0] >= from) : px.rows });
  }
  if (r0 === 'bundle' && p1){ // לחישובים בדפדפן (backtest/as-of): מחירים + עובדות + פרופיל
    const s = sym(p1);
    const b = await loadBundle(s, ctx, { light: q.light === '1' });
    return json({ asset: b.asset, prices: b.prices, facts: b.facts && !b.facts.missing ? { series: b.facts.series, source: b.facts.source, asOf: b.facts.asOf, quality: b.facts.quality } : { missing: true, reason: b.facts?.reason }, profile: b.profile });
  }
  if (r0 === 'news' && p1){
    const s = sym(p1); const asset = await assetMeta(db, s);
    return json(await getNews(s, { ...ctx, asset }));
  }
  if (r0 === 'asof' && p1){
    const s = sym(p1);
    if (!validDate(q.date)) return err('date חסר/לא תקין (YYYY-MM-DD)');
    const regime = await computeRegime(ctx, { date: q.date });
    const b = await loadBundle(s, ctx);
    const spy = await db.get('px:SPY');
    const dgs = await db.get('macro:DGS10');
    const a = analyzeBundle(b, { asOfDate: q.date, regime, benchRows: spy?.rows, dgs10Rows: dgs?.rows });
    const fwd = b.prices?.rows ? forwardReturns(b.prices.rows, q.date) : null;
    const stored = await getSnap(db, q.date, s);
    return json({ ...a, bundle: undefined, forward: fwd, storedSnapshot: stored ? { score: stored.score, signal: stored.signal, price: stored.price, weightsVersion: stored.weightsVersion } : null, regimeAtDate: { summary: regime.summary, risk: regime.risk, trend: regime.trend }, note: 'חושב רק מנתונים שהיו ידועים בתאריך (מחירים ≤ תאריך, דוחות לפי תאריך הגשה, חדשות לפי פרסום). קונצנזוס/תחזיות אנליסטים לא זמינים נקודתית.' });
  }
  if (r0 === 'regime'){
    if (p1 === 'history'){ const keys = await db.list('regime:'); const out = []; for (const k of keys.slice(-120)){ const r = await db.get(k); if (r) out.push({ date: k.slice(7), risk: r.risk, trend: r.trend, fearGreed: r.fearGreed?.value, vix: r.inputs?.vix }); } return json(out); }
    if (validDate(q.date)){ const st = await db.get(`regime:${q.date}`); return json(st || (await computeRegime(ctx, { date: q.date }))); }
    const st = await db.get(`regime:${today()}`);
    return json(st || (await computeRegime(ctx)));
  }
  if (r0 === 'macro') return json(await loadMacro(ctx));
  if (r0 === 'rank'){ const day = validDate(q.date) ? q.date : await latestRankDay(db); const r = day ? await db.get(`rank:${day}`) : null; return json(r || { missing: true, reason: 'אין דירוג עדיין — ה-cron היומי טרם הסתיים', day }); }
  if (r0 === 'reco'){ const day = validDate(q.date) ? q.date : await latestRankDay(db); const r = day ? await db.get(`reco:${day}`) : null; return json(r || { missing: true, reason: 'אין תיקים מומלצים עדיין', day }); }
  if (r0 === 'days') return json((await db.get('idx:snapdays')) || []);
  if (r0 === 'snapshots' && p1){ const s = sym(p1); const days = (await db.get('idx:snapdays')) || []; const out = []; for (const d of days.slice(-(+q.limit || 120))){ const sn = await getSnap(db, d, s); if (sn) out.push(sn); } return json(out); }
  // מצב מחירי 09:40 ליום מסחר (לסקריפט ב-Actions: לדלג אם היום כבר נאסף; ?full=1 מחזיר גם את המחירים)
  if (r0 === 'entry' && validDate(p1) && req.method === 'GET'){ const ex = await db.get(`entry940:${p1}`); if (!ex) return json({ day: p1, count: 0, missing: true }); return json({ day: p1, count: ex.count || Object.keys(ex.prices || {}).length, at: ex.at, source: ex.source, updatedAt: ex.updatedAt, prices: q.full === '1' ? ex.prices : undefined }); }
  // מחירי 09:40 ניו יורק (מ-scripts/entry940.mjs): מסמך אחד ליום מסחר — נקודת הכניסה הברת-ביצוע של תיקי הצל
  if (r0 === 'ingest' && p1 === 'entry' && req.method === 'POST'){
    if (!(env.CRON_SECRET && q.secret === env.CRON_SECRET)) needAuth();
    const day = validDate(body.day) ? body.day : null; if (!day) return err('חסר day');
    const prices = Object.fromEntries(Object.entries(body.prices || {}).filter(([k, v]) => validSym(k) && isNum(v) && v > 0));
    const ex = (await db.get(`entry940:${day}`)) || { day, prices: {} };
    ex.prices = { ...ex.prices, ...prices }; ex.at = body.at || '09:40 ET'; ex.source = body.source || 'yahoo-5m'; ex.updatedAt = new Date().toISOString(); ex.count = Object.keys(ex.prices).length;
    await db.put(`entry940:${day}`, ex);
    // מילוי מסלולי ההשוואה (regB/regC/אגרסיבי B) לפי מחירי 09:40 שהגיעו הרגע — אותה נקודת ביצוע לכל המסלולים
    let tracks = null; try { tracks = await runTracksFill(ctx, { day }); } catch (e) { await db.logError('tracks-fill-ingest', e.message); }
    return json({ ok: true, day, received: Object.keys(prices).length, count: ex.count, tracks });
  }
  // הזרמת snapshots מ-GitHub Actions (יקום S&P 500): נכתבים ב-shards (16 מסמכים ליום), הדירוג מחושב מחדש אם היום כבר סגור
  if (r0 === 'ingest' && p1 === 'snapshots' && req.method === 'POST'){
    if (!(env.CRON_SECRET && q.secret === env.CRON_SECRET)) needAuth();
    const day = validDate(body.date) ? body.date : today();
    if (day > today()) return err('תאריך עתידי');
    const snaps = (Array.isArray(body.snapshots) ? body.snapshots : []).filter((s) => s && validSym(s.symbol || '')).slice(0, 200);
    const overwrite = body.overwrite === true || q.overwrite === '1';
    const r = await putSnapsBatch(db, day, snaps, { source: body.source || 'github-actions', overwrite });
    const watch = new Set(((await db.get('user:watchlist')) || []).map((w) => w.symbol));
    const days = (await db.get('idx:snapdays')) || [];
    const prevDay = days.filter((d) => d < day).slice(-1)[0] || null;
    let alerts = 0;
    for (const s of snaps) if (r.written && !s.missing && watch.has(s.symbol.toUpperCase())){ try { alerts += (await evaluateAlerts(ctx, { ...s, date: day }, prevDay ? await getSnap(db, prevDay, s.symbol.toUpperCase()) : null, null)).length; } catch {} }
    let rerank = false;
    if (body.finalize === true || q.finalize === '1'){
      const exRank = await db.get(`rank:${day}`);
      const rank = rankSnapshots(await listSnaps(db, day), { sp500: await sp500Set(db) });
      // אין דירוג קיים ליום הזה עדיין (למשל אחרי שה-cron המתוזמן פספס יומיים) — צריך ליצור אחד, לא רק לעדכן קיים
      if (!exRank || overwrite || rank.analyzed > (exRank.analyzed || 0)){ await db.put(`rank:${day}`, { ...rank, mergedBy: 'ingest' }); await db.delete(`reco:${day}`); rerank = true; }
    }
    return json({ ok: true, day, received: snaps.length, ...r, alerts, rerank });
  }
  if (r0 === 'snapshots' && !p1 && req.method === 'POST'){
    needAuth();
    const day = validDate(body.date) ? body.date : today();
    if (day > today()) return err('תאריך עתידי');
    const snaps = Array.isArray(body.snapshots) ? body.snapshots.filter((s) => s && validSym(s.symbol || '')).slice(0, 400) : [];
    const days = (await db.get('idx:snapdays')) || [];
    const prevDay = days.filter((d) => d < day).slice(-1)[0] || null;
    let written = 0, alerts = 0;
    for (const s of snaps){
      const snap = { ...s, symbol: s.symbol.toUpperCase(), date: day, computedBy: 'browser' };
      if (await db.putIfAbsent(`snap:${day}:${snap.symbol}`, snap)){ written++; if (!snap.missing){ const prev = prevDay ? await getSnap(db, prevDay, snap.symbol) : null; alerts += (await evaluateAlerts(ctx, snap, prev, null)).length; } }
    }
    if (body.rank && Array.isArray(body.rank.table)) await db.putIfAbsent(`rank:${day}`, { ...body.rank, date: day, computedBy: 'browser' });
    if (body.reco && body.reco.profiles) await db.putIfAbsent(`reco:${day}`, { ...body.reco, date: day, computedBy: 'browser' });
    if (body.regime && body.regime.rules) await db.putIfAbsent(`regime:${day}`, { ...body.regime, date: day, computedBy: 'browser' });
    if (!days.includes(day)){ days.push(day); await db.put('idx:snapdays', days.sort().slice(-3000)); }
    return json({ ok: true, day, received: snaps.length, written, alerts, note: written < snaps.length ? 'חלק מה-snapshots כבר היו קיימים ולא נדרסו' : undefined });
  }
  if (r0 === 'snapshot' && p1 && p2){ const s = sym(p2); if (!validDate(p1)) return err('תאריך לא תקין'); return json((await getSnap(db, p1, s)) || { missing: true }); }

  if (r0 === 'watchlist'){
    const list = (await db.get('user:watchlist')) || [];
    if (req.method === 'GET'){
      const day = await latestRankDay(db);
      const out = [];
      for (const w of list){ const sn = day ? await getSnap(db, day, w.symbol) : null; out.push({ ...w, snapshot: sn }); }
      return json({ date: day, items: out });
    }
    needAuth();
    if (req.method === 'POST'){
      const s = sym(body.symbol);
      if (!list.some((w) => w.symbol === s)) list.push({ symbol: s, addedAt: today(), note: String(body.note || '').slice(0, 200), tags: Array.isArray(body.tags) ? body.tags.slice(0, 5) : [] });
      else { const w = list.find((x) => x.symbol === s); if (body.note !== undefined) w.note = String(body.note).slice(0, 200); }
      await db.put('user:watchlist', list.slice(0, 100));
      const a = findAsset(s) || (await assetMeta(db, s)); await addToUniverse(db, [{ ...a, origin: a.origin === 'seed' ? 'seed' : 'watchlist' }]);
      return json({ ok: true, items: list });
    }
    if (req.method === 'DELETE'){ const s = sym(q.symbol || body.symbol); await db.put('user:watchlist', list.filter((w) => w.symbol !== s)); return json({ ok: true }); }
  }
  if (r0 === 'settings'){
    const cur = { portfolioSize: 200000, baseCurrency: 'ILS', weights: DEFAULT_WEIGHTS, alertChannels: ['browser'], alertDefaults: { signalChange: true, materialNews: true }, ...((await db.get('user:settings')) || {}) };
    if (req.method === 'GET') return json(cur);
    needAuth();
    const next = { ...cur };
    if (isNum(body.portfolioSize) && body.portfolioSize > 0) next.portfolioSize = body.portfolioSize;
    if (body.weights && typeof body.weights === 'object'){ const w = {}; for (const k of Object.keys(DEFAULT_WEIGHTS)) w[k] = isNum(body.weights[k]) ? Math.max(0, Math.min(50, body.weights[k])) : DEFAULT_WEIGHTS[k]; next.weights = w; }
    if (Array.isArray(body.alertChannels)) next.alertChannels = body.alertChannels.filter((c) => ['browser', 'telegram', 'email'].includes(c));
    if (body.alertDefaults) next.alertDefaults = { ...cur.alertDefaults, ...body.alertDefaults };
    if (typeof body.autopilot === 'boolean') next.autopilot = body.autopilot;
    if (['conservative', 'balanced', 'growth', 'aggressive'].includes(body.riskProfile)) next.riskProfile = body.riskProfile;
    await db.put('user:settings', next);
    return json(next);
  }
  if (r0 === 'alerts'){
    if (p1 === 'types') return json(ALERT_TYPES);
    if (p1 === 'rules'){
      const rules = (await db.get('user:alerts:rules')) || [];
      if (req.method === 'GET') return json(rules);
      needAuth();
      if (req.method === 'POST'){
        if (!ALERT_TYPES[body.type]) return err('סוג התראה לא מוכר');
        const s = body.symbol === '*' ? '*' : sym(body.symbol);
        const rule = { id: uid('r_'), symbol: s, type: body.type, params: body.params || {}, channels: (body.channels || ['browser']).filter((c) => ['browser', 'telegram', 'email'].includes(c)), cooldownH: Math.max(1, Math.min(168, +body.cooldownH || 24)), enabled: body.enabled !== false, createdAt: new Date().toISOString() };
        rules.push(rule); await db.put('user:alerts:rules', rules.slice(-200)); return json(rule);
      }
      if (req.method === 'DELETE'){ await db.put('user:alerts:rules', rules.filter((r) => r.id !== (q.id || body.id))); return json({ ok: true }); }
    }
    if (p1 === 'log'){ const days = (await db.get('idx:snapdays')) || []; const out = []; for (const d of [...days.slice(-14), today()].filter((v, i, a) => a.indexOf(v) === i)){ const l = await db.get(`alerts:log:${d}`); if (l) out.push(...l); } return json(out.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 200)); }
    if (p1 === 'test'){ needAuth(); const a = { id: uid('al_'), ts: new Date().toISOString(), symbol: 'TEST', type: 'test', label: 'בדיקת ערוץ', what: 'זו הודעת בדיקה מהמערכת', why: 'לוודא שהערוץ מוגדר נכון', changed: 'כלום' }; return json({ ok: true, channels: await sendAlert(ctx, a, body.channels || ['telegram', 'email']) }); }
  }
  if (r0 === 'paper'){
    const broker = new PaperBroker(db);
    const day = await latestRankDay(db);
    const fxDoc = await db.get('fx:USDILS'); const fx = fxDoc?.rate || 3.7;
    const priceCache = {};
    const priceOf = (s) => priceCache[s];
    const view = async () => {
      const t = await broker.trades();
      // שערוך לפי סגירה מאומתת של הסשן האחרון שנסגר בניו יורק (lib/mark.js): לכל נייר תאריך שער; נייר בלי סגירת הסשן מסומן stale.
      // ציטוט תוך-יומי לא משמש לשווי (הוא היה גובר על סגירה חדשה יותר ומציג "סגירה" שאינה כזו — AI_COUNCIL#17)
      const asOfCache = {};
      const openSyms = [...new Set(t.filter((x) => !x.exitDate).map((x) => x.symbol))];
      const res = await resolveClosePrices(ctx, openSyms);
      for (const s of openSyms){ const p = res.prices[s]; priceCache[s] = p?.price ?? null; asOfCache[s] = p ? { asOf: p.asOf, source: p.source, prevClose: p.prevClose > 0 ? p.prevClose : null, stale: !!p.stale } : null; }
      const perf = await broker.performance(priceOf, fx);
      perf.positions = perf.positions.map((p) => { const a = asOfCache[p.symbol]; const rate = p.currency === 'ILS' ? 1 : fx;
        // שינוי יומי: יחידות שנקנו ביום השער נמדדות ממחיר הקנייה שלהן ולא מסגירת אתמול (אחרת נספר רווח/הפסד שלא היה)
        const lotsToday = t.filter((x) => !x.exitDate && x.symbol === p.symbol && (x.date || '').slice(0, 10) === (a?.asOf || '')); const qtyToday = lotsToday.reduce((q, x) => q + x.qty, 0);
        const dayPnlIls = a?.prevClose && isNum(p.current) ? Math.round(((p.qty - qtyToday) * (p.current - a.prevClose) + lotsToday.reduce((q, x) => q + x.qty * (p.current - x.price), 0)) * rate * 100) / 100 : null;
        return { ...p, priceAsOf: a?.asOf || null, priceSource: a?.source || null, priceStale: !!a?.stale, prevClose: a?.prevClose ?? null, dayChangePct: a?.prevClose && isNum(p.current) ? Math.round((p.current / a.prevClose - 1) * 10000) / 10000 : null, dayPnlIls }; });
      // ברמת החשבון: סכום השינוי היומי של הפוזיציות, נכון לסגירה האחרונה שיש לה שער (asOf)
      const dayPnlIls = perf.positions.reduce((sum, p) => sum + (p.dayPnlIls || 0), 0);
      perf.dayPnlIls = Math.round(dayPnlIls * 100) / 100; perf.dayPnlPct = perf.totalIls - dayPnlIls > 0 ? Math.round((dayPnlIls / (perf.totalIls - dayPnlIls)) * 10000) / 10000 : null;
      // asOf = התאריך הישן ביותר מבין השערים (לא החדש ביותר): אם נייר אחד עדיין בלי סגירת הסשן, הכותרת לא תטען "סגירת היום"
      perf.sessionDate = res.session; perf.pricedAsOf = res.pricedAsOf; perf.stale = res.stale; perf.staleSymbols = res.staleSymbols; perf.asOf = res.stale ? res.pricedAsOf : (openSyms.length ? res.session : null);
      const u = await getUniverse(db, env);
      perf.positions = perf.positions.map((p) => ({ ...p, name: u.find((a) => a.symbol === p.symbol)?.name || p.symbol, nameHe: u.find((a) => a.symbol === p.symbol)?.nameHe || null, signal: null }));
      for (const p of perf.positions){ const sn = day ? await getSnap(db, day, p.symbol) : null; p.signal = sn?.signal || null; }
      perf.fxSource = fxDoc ? { rate: fx, source: fxDoc.source, asOf: fxDoc.asOf } : null;
      return perf;
    };
    // פירוק מלא: רווח/הפסד ממומש/לא ממומש לכל נייר, עמלות, הפרשי מטבע, ידני מול אוטומט, לפני/מאז גרסת האסטרטגיה הנוכחית, הקצאה בפועל מול יעד
    if (p1 === 'breakdown' && req.method === 'GET'){
      await view(); // ממלא את priceCache עבור priceOf
      const rank = day ? await db.get(`rank:${day}`) : null;
      const table = rank?.table || [];
      const u = await getUniverse(db, env);
      const nameOf = (s) => u.find((a) => a.symbol === s)?.nameHe || u.find((a) => a.symbol === s)?.name || s;
      const journal = (await db.get('auto:journal')) || [];
      const st = (await db.get('user:settings')) || {};
      const profile = st.riskProfile || 'balanced';
      const account = await broker.account();
      const trades = await broker.trades();
      return json(paperBreakdown({ trades, account, priceOf, fx, table, nameOf, journal, currentVersion: AUTO_RULES.version, targets: PROFILES[profile]?.sleeves || null }));
    }
    if (req.method === 'GET') return json(await view());
    // איפוס נקודת ההתחלה (לא של החשבון): רווח/הפסד "מההתחלה" יכלול רק את מה שהאוטומט עשה בפועל. רישומים ידניים מלפני שהאוטומט
    // קיבל את הניהול (כולל המכירות שלהם והעמלות עליהן) הופכים להתאמה חד-פעמית שנרשמת בחשבון — הפוזיציות, העסקאות ועקומת השווי
    // לא נמחקים ולא משתנים. מותר גם עם הסוד של ה-cron (הפעלה מ-GitHub ops), אחרת טוקן
    if (p1 === 'rebase' && req.method === 'POST'){
      const bySecret = !!(env.CRON_SECRET && q.secret === env.CRON_SECRET); if (!bySecret) needAuth();
      const before = await view();
      if ((before.account.adjustments || []).length && q.force !== '1') return err('כבר בוצעה התאמה לנקודת ההתחלה — force=1 לביצוע נוסף');
      const rank = day ? await db.get(`rank:${day}`) : null;
      const journal = (await db.get('auto:journal')) || [];
      const bd = paperBreakdown({ trades: await broker.trades(), account: before.account, priceOf, fx, table: rank?.table || [], journal, currentVersion: AUTO_RULES.version });
      // יעד: total − רווח האוטומט = נקודת ההתחלה; ההפרש מול הנקודה הנוכחית הוא ההתאמה (בקריאה ראשונה = נטו הרישומים הידניים כולל עמלות היציאה)
      const targetBase = round(before.totalIls - (bd.bySource?.autopilot?.netIls || 0), 2);
      const adjustIls = round(targetBase - before.baseIls, 2);
      if (Math.abs(adjustIls) < 1) return json({ ok: true, adjustIls: 0, note: 'נקודת ההתחלה כבר תואמת לרווח האוטומט — אין מה להתאים', before: { baseIls: before.baseIls, pnlIls: before.pnlIls } });
      const acc = await broker.adjust({ ils: adjustIls, day: day || today(), reason: `רישומים ידניים מלפני שהאוטומט קיבל את הניהול (${bd.bySource?.manual?.trades || 0} רישומים, כולל עמלות) — לא נספרים ברווח/הפסד`, meta: { manualNetIls: bd.bySource?.manual?.netIls ?? null, autopilotNetIls: bd.bySource?.autopilot?.netIls ?? null, reconciliationDiffIls: bd.reconciliation?.diffIls ?? null, totalIls: before.totalIls } });
      const after = await broker.performance(priceOf, fx);
      return json({ ok: true, adjustIls, manualNetIls: bd.bySource?.manual?.netIls ?? null, autopilotNetIls: bd.bySource?.autopilot?.netIls ?? null, before: { baseIls: before.baseIls, pnlIls: before.pnlIls }, after: { baseIls: after.baseIls, pnlIls: after.pnlIls, pnlPct: after.pnlPct }, account: acc });
    }
    // "רק האוטומט": כל רישום שלא האוטומט יצר מוסר מהחשבון (לארכיון) והחשבון משקף רק את מה שהאוטומט עשה בפועל. ראה broker.purgeManual
    if (p1 === 'autopilot-only' && req.method === 'POST'){
      const bySecret = !!(env.CRON_SECRET && q.secret === env.CRON_SECRET); if (!bySecret) needAuth();
      const before = await view();
      const r = await broker.purgeManual();
      const after = await broker.performance(priceOf, fx);
      return json({ ok: true, removed: r.removed, cashReturnedIls: r.cashReturnedIls, feesRemovedIls: r.feesRemovedIls, exitFeesReconciledIls: r.exitFeesReconciledIls || 0, before: { totalIls: before.totalIls, cashIls: before.cashIls, positions: before.positions.length, closed: before.closedCount, baseIls: before.baseIls, pnlIls: before.pnlIls }, after: { totalIls: after.totalIls, cashIls: after.cashIls, positions: after.positions.length, closed: after.closedCount, baseIls: after.baseIls, pnlIls: after.pnlIls, pnlPct: after.pnlPct, commissionsIls: after.commissionsIls }, account: r.account });
    }
    needAuth();
    if (p1 === 'reset' && req.method === 'POST'){ const st = (await db.get('user:settings')) || {}; const acc = await broker.reset(isNum(body.initialIls) && body.initialIls > 0 ? body.initialIls : (st.portfolioSize || 200000)); return json({ ok: true, account: acc }); }
    if (p1 === 'trade' && req.method === 'DELETE'){ try { const acc = await broker.cancel(q.id || body.id); return json({ ok: true, account: acc }); } catch (e) { return err(e.message); } }
    if (p1 === 'order'){
      const s = sym(body.symbol);
      const asset = await assetMeta(db, s);
      let price = isNum(body.price) ? body.price : null, priceSource = price ? { source: 'user' } : null;
      if (!price){ const qt = await getQuote(s, { ...ctx, asset }); if (qt && !qt.missing){ price = qt.price; priceSource = { source: qt.source, asOf: qt.asOf, stale: !!qt.stale }; } else { const px = await getPrices(s, { ...ctx, asset }); if (px?.rows?.length){ price = px.rows[px.rows.length - 1][4]; priceSource = { source: px.source + ' (close)', asOf: px.asOf }; } } }
      const sn = day ? await getSnap(db, day, s) : null;
      try { const r = await broker.placeOrder({ symbol: s, side: body.side === 'sell' ? 'sell' : 'buy', qty: +body.qty, price, currency: asset.currency || 'USD', fx, reason: String(body.reason || '').slice(0, 300), signal: sn?.signal || null, snapDate: sn?.date || null, priceSource }); return json({ ok: true, result: r, price, priceSource, fx }); }
      catch (e) { return err(e.message); }
    }
  }
  // ערוץ הכתיבה של ChatGPT ל-AI Council (invest/docs/COUNCIL_RELAY.md): ChatGPT (Action) שולח טקסט עם סוד משותף; ההודעה נכנסת לתיבת
  // דואר ב-KV, ו-GitHub Actions (שכבר מורשה לכתוב ב-Issues) מפרסם אותה ב-Issue #25 — בלי PAT ובלי סוד נוסף. אם GH_COUNCIL_TOKEN מוגדר,
  // הפרסום מיידי. הסוד המשותף נוצר אוטומטית (KV) ומוצג רק במסך ההגדרות המאומת, או מגיע מ-Secrets (COUNCIL_SECRET) אם הוגדר.
  // נעול ל-Issue אחד ולמכסה יומית — דליפת הסוד לא מאפשרת יותר מזה
  if (r0 === 'council'){
    const REPO = 'meirco199-prog/bikur', ISSUE = 25, DAILY_MAX = 20, MAX_LEN = 8000, INBOX_MAX = 50;
    const bySecret = !!(env.CRON_SECRET && q.secret === env.CRON_SECRET);
    // קריאת הסוד מ-KV סלחנית: ערך שהוזן ידנית בדשבורד של Cloudflare (בלי מרכאות JSON) מתקבל כמו שהוא
    const readSecret = async () => { if (!db.kv) return db.get('council:secret'); const t = await db.kv.get('council:secret', 'text'); if (!t) return null; try { const j = JSON.parse(t); return typeof j === 'string' ? j : String(t).trim(); } catch { return String(t).trim(); } };
    const newSecret = async () => { const b = new Uint8Array(32); crypto.getRandomValues(b); const s = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); await db.put('council:secret', s); return s; };
    // המפתח למסך ההגדרות (מאומת בלבד): נוצר בפעם הראשונה, rotate מחליף
    if (p1 === 'secret'){ needAuth(); let s = env.COUNCIL_SECRET || (await readSecret()); if (!env.COUNCIL_SECRET && (!s || (req.method === 'POST' && (body.rotate || q.rotate === '1')))) s = await newSecret(); return json({ ok: true, secret: s, source: env.COUNCIL_SECRET ? 'secret' : 'kv', importUrl: 'https://raw.githubusercontent.com/meirco199-prog/bikur/main/invest/docs/council-action.yaml', endpoint: `${url.origin}/council/comment`, direct: !!env.GH_COUNCIL_TOKEN, pending: ((await db.get('council:inbox')) || []).length }); }
    // צד GitHub Actions (סוד ה-cron): קריאת התיבה ואישור פרסום
    if (p1 === 'inbox' && req.method === 'GET'){ if (!bySecret) needAuth(); return json({ ok: true, issue: ISSUE, items: (await db.get('council:inbox')) || [] }); }
    if (p1 === 'ack' && req.method === 'POST'){ if (!bySecret) needAuth(); const ids = new Set(Array.isArray(body.ids) ? body.ids : []); const left = ((await db.get('council:inbox')) || []).filter((m) => !ids.has(m.id)); await db.put('council:inbox', left); return json({ ok: true, left: left.length }); }
    // צד ChatGPT: Bearer = הסוד המשותף
    const want = env.COUNCIL_SECRET || (await readSecret()) || '';
    if (!want) return err('ערוץ ה-Council טרם הופעל: פתח באפליקציה הגדרות → ערוץ ה-Council → "הצג מפתח" (יוצר את הסוד המשותף)', 503);
    const given = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '') || req.headers.get('X-Council-Key') || '';
    const same = (x, y) => { if (!x || !y || x.length !== y.length) return false; let d = 0; for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i); return d === 0; };
    if (!same(given, want)) return err('unauthorized', 401);
    const qKey = `council:quota:${today()}`; const used = (await db.get(qKey)) || 0;
    const inbox = (await db.get('council:inbox')) || [];
    if (p1 === 'status' && req.method === 'GET') return json({ ok: true, repo: REPO, issue: ISSUE, usedToday: used, dailyMax: DAILY_MAX, direct: !!env.GH_COUNCIL_TOKEN, pending: inbox.length });
    // קריאת השרשור: ChatGPT (ב-GPT עם ה-Action) קורא את התגובות האחרונות ב-Issue #25 בלי מחבר GitHub — הריפו ציבורי, PAT אופציונלי
    if (p1 === 'thread' && req.method === 'GET'){
      const limit = Math.min(20, Math.max(1, Number(q.limit) || 10));
      const hdr = { Accept: 'application/vnd.github+json', 'User-Agent': 'bikur-council-relay', 'X-GitHub-Api-Version': '2022-11-28', ...(env.GH_COUNCIL_TOKEN ? { Authorization: `Bearer ${env.GH_COUNCIL_TOKEN}` } : {}) };
      const gh = await fetch(`https://api.github.com/repos/${REPO}/issues/${ISSUE}/comments?per_page=100`, { headers: hdr });
      const arr = await gh.json().catch(() => null);
      if (!gh.ok || !Array.isArray(arr)) return err(`GitHub לא החזיר את השרשור (${gh.status})`, 502);
      const kind = (c) => { const b = String(c.body || ''); const bot = /\[bot\]$/.test(c.user?.login || ''); if (bot && b.startsWith('**ChatGPT**')) return 'chatgpt'; if (bot && b.startsWith('<!-- health-report')) return 'health-report'; if (bot) return 'bot'; return 'claude-or-owner'; };
      const items = arr.slice(-limit).map((c) => ({ id: c.id, at: c.created_at, login: c.user?.login || '', kind: kind(c), url: c.html_url, body: String(c.body || '').slice(0, 6000) }));
      return json({ ok: true, repo: REPO, issue: ISSUE, url: `https://github.com/${REPO}/issues/${ISSUE}`, total: arr.length, items, pending: inbox.map((m) => ({ id: m.id, at: m.at, author: m.author })), note: 'kind=claude-or-owner: תגובות של Claude מתפרסמות מחשבון בעל הריפו (meirco199-prog); kind=chatgpt: הודעות שהגיעו דרך הערוץ הזה' });
    }
    if (p1 === 'comment' && req.method === 'POST'){
      const text = String(body.text || '').trim();
      if (!text) return err('חסר text');
      if (text.length > MAX_LEN) return err(`הטקסט ארוך מדי (${text.length} > ${MAX_LEN})`);
      if (used >= DAILY_MAX) return err(`מכסת התגובות היומית (${DAILY_MAX}) נוצלה`, 429);
      const author = String(body.author || 'ChatGPT').slice(0, 40).replace(/[^\p{L}\p{N} _.-]/gu, '') || 'ChatGPT';
      const md = `**${author}** (דרך ערוץ ה-Council, לא ישירות מהחשבון):\n\n${db.redact(text)}\n\n---\n_Posted via council relay (\`POST /council/comment\`)_`;
      if (env.GH_COUNCIL_TOKEN){ // פרסום מיידי עם PAT מצומצם (אופציונלי)
        const gh = await fetch(`https://api.github.com/repos/${REPO}/issues/${ISSUE}/comments`, { method: 'POST', headers: { Authorization: `Bearer ${env.GH_COUNCIL_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'bikur-council-relay', 'X-GitHub-Api-Version': '2022-11-28' }, body: JSON.stringify({ body: md }) });
        const gj = await gh.json().catch(() => ({}));
        if (!gh.ok){ await db.logError('council', `GitHub ${gh.status}: ${String(gj.message || '').slice(0, 120)}`); return err(`GitHub דחה את התגובה (${gh.status}): ${String(gj.message || '').slice(0, 160)}`, 502); }
        await db.put(qKey, used + 1, { ttl: 2 * 86400 });
        return json({ ok: true, queued: false, url: gj.html_url || null, id: gj.id || null, usedToday: used + 1, dailyMax: DAILY_MAX });
      }
      if (inbox.length >= INBOX_MAX) return err('תיבת הדואר מלאה — ההודעות הקודמות טרם פורסמו', 429);
      const id = uid('cm_'); inbox.push({ id, at: new Date().toISOString(), author, body: md });
      await db.put('council:inbox', inbox); await db.put(qKey, used + 1, { ttl: 2 * 86400 });
      return json({ ok: true, queued: true, id, usedToday: used + 1, dailyMax: DAILY_MAX, note: 'התקבל; יפורסם ב-Issue #25 בריצת GitHub Actions הבאה (בדרך כלל עד ~20–30 דק׳; GitHub לפעמים מאחר יותר)' });
    }
    return err('נתיב לא מוכר בערוץ ה-Council', 404);
  }
  // שערוך לפי סגירה: כותב את שורת השווי של הסשן האחרון (תרגול + אגרסיבי). נקרא מכל ריצת ops/מתוזמנת; בטוח לקריאה חוזרת
  if (r0 === 'mark' && p1 === 'run' && req.method === 'POST'){ const bySecret = !!(env.CRON_SECRET && q.secret === env.CRON_SECRET); if (!bySecret) needAuth(); try { return json({ ok: true, ...(await markToClose(ctx)) }); } catch (e) { return err('mark: ' + e.message, 500); } }
  if (r0 === 'auto'){
    if (p1 === 'status' || !p1) return json(await autoStatus(db));
    if (p1 === 'run' && req.method === 'POST'){
      const bySecret = !!(env.CRON_SECRET && q.secret === env.CRON_SECRET); if (!bySecret) needAuth();
      // force רק עם טוקן (הסוד של ה-cron לא מאפשר ריצות חוזרות באותו יום)
      try { return json(await runAutopilot(ctx, { dry: q.dry === '1', force: q.force === '1' && !bySecret, trigger: q.trigger || 'manual' })); } catch (e) { await db.logError('auto', e.message); return err('אוטומט: ' + e.message, 500); }
    }
  }
  if (r0 === 'ai' && p1 === 'ask' && req.method === 'POST'){
    const question = String(body.question || '').slice(0, 800);
    if (!question) return err('שאלה ריקה');
    try { return json(await ask(env, db, question)); } catch (e) { return err('AI: ' + e.message, 502); }
  }
  if (r0 === 'cron'){
    if (p1 === 'status'){ const st = (await db.get('cron:state')) || {}; return json({ last: { at: st.at, log: st.log, queueLeft: st.queueLeft, done: st.done, errors: st.errors?.length || 0 }, state: st }); }
    if (p1 === 'run' && req.method === 'POST'){ if (!(env.CRON_SECRET && q.secret === env.CRON_SECRET)) needAuth(); const r = await cronStep(ctx, { batch: Math.min(+q.batch || 3, 60), force: q.force === '1' }); return json(r); }
  }
  return err('not found', 404);
}

export default {
  async fetch(req, env, ec){
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    const path = new URL(req.url).pathname;
    if (env.RATE_LIMIT_OFF !== '1' && rateLimited(ip, path)) return err('rate limited', 429); // RATE_LIMIT_OFF רק לבדיקות E2E (הרבה בקשות בדקה מאותה כתובת)
    let ctx;
    try { ctx = await makeCtx(env, ec?.waitUntil?.bind(ec)); return await handle(req, env, ctx); }
    catch (e) { if (e.status) return err(e.message, e.status); await ctx?.db?.logError(path, e.message); return err('internal: ' + e.message, 500); }
    finally { if (ctx?.budget?.dirty){ const f = ctx.budget.flush().catch(() => {}); if (ec?.waitUntil) ec.waitUntil(f); else await f; } }
  },
  async scheduled(event, env, ec){
    const ctx = await makeCtx(env, ec.waitUntil.bind(ec));
    try {
      const r = await cronStep(ctx);
      if (r?.finalized){ try { await runShadow(ctx); await runAggressive(ctx); await runTracksDecide(ctx); } catch (e) { await ctx.db.logError('shadow', e.message); } await runAutopilot(ctx, { trigger: 'cron' }); }
      try { await executeAggressive(ctx); } catch (e) { await ctx.db.logError('aggressive-exec', e.message); } // מילוי פקודות הצל בחלון ניו יורק לפי ציטוט חי // runAutopilot עצמו בודק: כבר רץ היום (לפי גרסת כללים), חלון שעות, שוק פתוח
    } catch (e) { await ctx.db.logError('scheduled', e.message); }
    finally { await ctx.budget.flush().catch(() => {}); }
  },
};
