// AI Council relay — הצד של GitHub Actions בערוץ הכתיבה של ChatGPT (council-relay.yml, כל ~20 דק'):
// 1. קורא את תיבת הדואר ב-Worker (GET /council/inbox, סוד ה-cron) ומנתב כל הודעה ל-Issue של הפרויקט שלה לפי
//    .github/council/projects.json — invest → #25 (בדיוק כמו קודם); פרויקט אחר → ה-Issue שרשום לו, או Issue שנפתח
//    אוטומטית עם התווית council:<project> (כך פרויקט חדש לא צריך workflow משלו).
// 2. דדופליקציה: הודעה שכבר מופיעה ב-Issue (סמן <!-- council-msg id=… -->) לא מתפרסמת שוב, רק מאושרת.
// 3. מאשר ל-Worker (POST /council/ack) עם הקישורים ומספרי ה-Issues — הסטטוס עובר QUEUED → POSTED.
// 4. מסנכרן סטטוסים: תגובות של Claude עם <!-- council-status id=… status=… --> מדווחות ל-Worker (POST /council/task-status),
//    כך ש-ChatGPT רואה ב-GET /council/tasks מה קרה לכל משימה (RECEIVED / IN_PROGRESS / PR_OPEN / PASS / …).
// E2E_PROJECT (workflow_dispatch): לפני הכול שולח הודעת בדיקה דרך ה-Worker עם סוד ה-cron — בלי לחשוף את מפתח ה-GPT.
// שום סוד לא נכתב לפלט.
import { readFileSync } from 'node:fs';

export const STATUSES = ['QUEUED', 'POSTED', 'RECEIVED', 'IN_PROGRESS', 'PR_OPEN', 'PASS', 'OWNER_DECISION_REQUIRED', 'FAILED', 'REJECTED', 'DONE', 'DUPLICATE'];
export const redact = (s) => String(s).replace(/\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,})\b/g, '[REDACTED]').replace(/secret=[^&\s"']+/g, 'secret=[REDACTED]');

export function loadRegistry(path = '.github/council/projects.json'){
  const j = JSON.parse(readFileSync(path, 'utf8'));
  return j.projects || {};
}
/** הפרויקט של הודעה מהתיבה: הודעות מלפני ההרחבה (בלי שדה project) הן של invest */
export const projectOf = (m) => String(m.project || 'invest').toLowerCase();
/** האם ההודעה כבר פורסמה ב-Issue (לפי הסמן, או לפי hash התוכן) */
export const alreadyPosted = (comments, m) => comments.find((c) => { const b = String(c.body || ''); return b.includes(`council-msg id=${m.id} `) || b.includes(`council-msg id=${m.id}-`) || (m.hash && b.includes(`hash=${m.hash} `)); }) || null;
/** סטטוסים שסימן Claude בתגובות: האחרון לכל id */
export function parseStatusMarkers(comments){
  const out = new Map();
  for (const c of comments){
    for (const m of String(c.body || '').matchAll(/<!-- council-status id=(cm_[A-Za-z0-9_-]+) status=([A-Z_]+)(?: pr=(\S+))? -->/g)){
      const st = m[2].toUpperCase(); if (!STATUSES.includes(st)) continue;
      out.set(m[1], { id: m[1], status: st, pr: m[3] || undefined, url: c.html_url, at: c.created_at });
    }
  }
  return [...out.values()];
}
export const issueBody = (project, reg) => [
  `## מה זה`,
  `הערוץ הקבוע של AI Council לפרויקט **${project}**${reg.paths?.length ? ` (${reg.paths.map((p) => `\`${p}\``).join(', ')})` : ''}, לפי [\`AI_COUNCIL.md\`](../blob/main/AI_COUNCIL.md): שני מהנדסים (Claude + ChatGPT), בעל הריפו מכריע. הודעות של ChatGPT מגיעות לכאן אוטומטית דרך \`POST /council/comment\` עם \`project: ${project}\` (ניתוב: [\`.github/council/README.md\`](../blob/main/.github/council/README.md)). Claude עוקב אחרי הערוץ, מסמן סטטוס לכל משימה, בודק כל ממצא מול הקוד לפני שהוא מקבל אותו, ופותח PR כשצריך — וה-PR עובר GPT Review.`,
  ``, `**אין לפרסם כאן מפתחות/סודות/ערכי טוקן.**`,
  ...(reg.owner_rules ? [``, `## החלטות בעל הריפו (קבועות)`, reg.owner_rules] : []),
].join('\n');

/** ניתוב: מספר ה-Issue של פרויקט — מהרישום, אחרת לפי התווית council:<project>, אחרת נפתח חדש */
export async function resolveIssue(project, registry, api, cache = new Map()){
  if (cache.has(project)) return cache.get(project);
  const reg = registry[project]; if (!reg) return null;
  let n = Number(reg.issue) || 0;
  if (!n){ const found = await api(`issues?labels=${encodeURIComponent(`council:${project}`)}&state=all&per_page=1`); n = found?.[0]?.number || 0; }
  if (!n){ const made = await api('issues', { method: 'POST', body: { title: `AI Council — ${project}`, body: issueBody(project, reg), labels: ['ai-council', `council:${project}`] } }); n = made?.number || 0; console.log(`נפתח Issue #${n} לפרויקט ${project}`); }
  cache.set(project, n || null); return n || null;
}

export function makeApi(repo, token, fetchImpl = fetch){
  return async (path, { method = 'GET', body, ok = [] } = {}) => {
    const r = await fetchImpl(path.startsWith('http') ? path : `https://api.github.com/repos/${repo}/${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'bikur-council-relay', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    if (!r.ok && !ok.includes(r.status)) throw new Error(`GitHub ${r.status} ${path}: ${redact(String(j?.message || t).slice(0, 200))}`);
    return j;
  };
}

/** הריצה כולה, עם תלויות מוזרקות (לבדיקות): api (GitHub), worker (fetch ל-Worker), registry */
export async function run({ registry, api, worker, e2e = null, log = console.log }){
  const summary = { posted: [], skipped: [], rejected: [], statusUpdates: 0, e2e: null };
  if (e2e?.project){
    const r = await worker('council/comment', { method: 'POST', body: { project: e2e.project, type: e2e.type || 'test', title: e2e.title || `בדיקת ניתוב קצה-לקצה (${new Date().toISOString().slice(0, 16)})`, body: e2e.body || `הודעת בדיקה אוטומטית ל-${e2e.project}: אם היא הגיעה ל-Issue הנכון — הניתוב עובד. Claude: סמן RECEIVED ואז DONE (אין מה לתקן).`, source: 'e2e-test', author: 'E2E test' } });
    summary.e2e = r; log(`E2E → ${JSON.stringify({ ok: r.ok, id: r.id, queued: r.queued, duplicate: r.duplicate, error: r.error })}`);
  }
  const inbox = await worker('council/inbox');
  const items = inbox.items || []; log(`pending: ${items.length}`);
  const cache = new Map(); const comments = new Map();
  const commentsOf = async (n) => { if (!comments.has(n)) comments.set(n, await api(`issues/${n}/comments?per_page=100`)); return comments.get(n); };
  const issues = {};
  for (const m of items){
    const project = projectOf(m);
    const n = await resolveIssue(project, registry, api, cache);
    if (!n){ summary.rejected.push({ id: m.id, project, reason: 'project לא ברישום' }); log(`::warning::${m.id}: project "${project}" לא נמצא ב-projects.json — לא מפורסם`); continue; }
    issues[project] = n;
    const dup = alreadyPosted(await commentsOf(n), m);
    if (dup){ summary.skipped.push({ id: m.id, issue: n, url: dup.html_url }); summary.posted.push({ id: m.id, issue: n, url: dup.html_url }); log(`${m.id}: כבר ב-#${n} — רק מאשר`); continue; }
    try { const c = await api(`issues/${n}/comments`, { method: 'POST', body: { body: m.body } }); summary.posted.push({ id: m.id, issue: n, url: c.html_url }); log(`${m.id} → ${project} #${n}: ${c.html_url}`); }
    catch (e) { log(`::warning::פרסום ${m.id} נכשל: ${redact(e.message)}`); }
  }
  if (summary.posted.length || summary.rejected.length || Object.keys(issues).length){
    await worker('council/ack', { method: 'POST', body: { ids: summary.rejected.map((x) => x.id), posted: summary.posted, issues } });
  }
  if (summary.rejected.length) await worker('council/task-status', { method: 'POST', body: { updates: summary.rejected.map((x) => ({ id: x.id, status: 'FAILED', note: x.reason })) } });
  // סנכרון סטטוסים מכל ערוצי הפרויקטים
  const updates = [];
  for (const [project, reg] of Object.entries(registry)){
    const n = Number(reg.issue) || issues[project] || cache.get(project) || (await resolveIssueIfExists(project, api));
    if (!n) continue;
    for (const u of parseStatusMarkers(await commentsOf(n))) updates.push(u);
  }
  if (updates.length){ const r = await worker('council/task-status', { method: 'POST', body: { updates } }); summary.statusUpdates = r.updated || 0; log(`סטטוסים: ${updates.length} סמנים, ${summary.statusUpdates} עדכונים`); }
  return summary;
}
async function resolveIssueIfExists(project, api){ const found = await api(`issues?labels=${encodeURIComponent(`council:${project}`)}&state=all&per_page=1`); return found?.[0]?.number || 0; }

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain){
  const { GH_TOKEN, SECRET, WORKER_URL = 'https://invest-api.meirco199.workers.dev', REPO = 'meirco199-prog/bikur', E2E_PROJECT, E2E_TITLE, E2E_BODY } = process.env;
  if (!SECRET){ console.error('::error::חסר CRON_SECRET'); process.exit(1); }
  if (!GH_TOKEN){ console.error('::error::חסר GH_TOKEN'); process.exit(1); }
  const W = WORKER_URL.replace(/\/$/, '');
  const worker = async (path, { method = 'GET', body } = {}) => { const r = await fetch(`${W}/${path}?secret=${encodeURIComponent(SECRET)}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok && path !== 'council/comment') throw new Error(`Worker ${r.status} ${path}: ${redact(String(j.error || '').slice(0, 200))}`); return j; };
  try {
    const s = await run({ registry: loadRegistry(), api: makeApi(REPO, GH_TOKEN), worker, e2e: E2E_PROJECT ? { project: E2E_PROJECT, title: E2E_TITLE, body: E2E_BODY } : null });
    console.log(`סיכום: ${JSON.stringify({ posted: s.posted.length, skipped: s.skipped.length, rejected: s.rejected.length, statusUpdates: s.statusUpdates })}`);
    if (process.env.GITHUB_OUTPUT){ const { appendFileSync } = await import('node:fs'); appendFileSync(process.env.GITHUB_OUTPUT, `posted=${JSON.stringify(s.posted)}\ne2e=${JSON.stringify(s.e2e || null)}\n`); }
    if (E2E_PROJECT && (!s.e2e?.ok)) { console.error(`::error::הודעת ה-E2E נדחתה: ${redact(s.e2e?.error || '')}`); process.exit(1); }
  } catch (e) { console.error(`::error::${redact(e.message)}`); process.exit(1); }
}
