// סנכרון ניסוי הדמה "ריזיקות עקרונות" (Issue #189) ל-Worker: קורא את תגובת ה-STATE מה-Issue (GitHub API עם GITHUB_TOKEN,
// קריאה בלבד), מחלץ את בלוק ה-JSON ושולח ל-POST /sinay/ingest. ה-Worker כותב ל-KV רק אם המצב השתנה (hash), ולכן ריצה חוזרת זולה.
// אבטחה: מתקבלת רק תגובה שכתב בעל הריפו (login = בעל הריפו, author_association = OWNER) ושמתחילה בסמן — כל אחד יכול להגיב
// ב-Issue ציבורי, ותגובה כזו לעולם לא תגיע ל-KV. הסוד (CRON_SECRET) לא מודפס.
export const MARKER = '<!-- sinay-paper-state -->';

export function isTrustedStateComment(c, owner){
  return !!c && typeof c.body === 'string' && c.body.trimStart().startsWith(MARKER)
    && c.user?.login === owner && c.user?.type !== 'Bot' && c.author_association === 'OWNER';
}

// תגובת ה-STATE נערכת במקום בכל ריצה; אם בכל זאת יש כמה — העדכנית ביותר
export function pickStateComment(comments, owner){
  const ok = (comments || []).filter((c) => isTrustedStateComment(c, owner));
  ok.sort((a, b) => Date.parse(b.updated_at || b.created_at || 0) - Date.parse(a.updated_at || a.created_at || 0));
  return ok[0] || null;
}

export function extractStateJson(body){
  const m = String(body || '').match(/```json\s*\n([\s\S]*?)\n```/);
  if (!m) throw new Error('לא נמצא בלוק ```json בתגובת ה-STATE');
  return JSON.parse(m[1]);
}

async function gh(url, token){
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'bikur-sinay-sync' } });
  if (!r.ok) throw new Error(`GitHub API ${r.status}`);
  return r.json();
}

async function main(){
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, REPO_OWNER, ISSUE = '189', WORKER_URL, CRON_SECRET } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !REPO_OWNER || !WORKER_URL) throw new Error('חסרים משתני סביבה');
  if (!CRON_SECRET) throw new Error('חסר הסוד CRON_SECRET');
  const comments = [];
  for (let page = 1; page <= 20; page++){
    const batch = await gh(`https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${encodeURIComponent(ISSUE)}/comments?per_page=100&page=${page}`, GITHUB_TOKEN);
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  const c = pickStateComment(comments, REPO_OWNER);
  if (!c) return { ok: true, skipped: 'אין תגובת STATE מבעל הריפו', scanned: comments.length };
  const state = extractStateJson(c.body);
  const res = await fetch(`${WORKER_URL.replace(/\/$/, '')}/sinay/ingest?secret=${encodeURIComponent(CRON_SECRET)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, commentId: c.id, commentUpdatedAt: c.updated_at }) });
  const out = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(`ingest ${res.status}: ${String(out.error || '').slice(0, 300)}`);
  return { ...out, commentId: c.id, commentUpdatedAt: c.updated_at, scanned: comments.length };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main().then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error('sinay-sync failed:', e.message); process.exit(1); });
