// GPT Reviewer — "המהנדס המבקר" האוטומטי של AI Council לכל הפרויקטים בריפו (ואחר כך לריפוזיטוריז נוספים).
// רץ מ-GitHub Actions (gpt-review.yml) על PR (פתיחה/דחיפה) ועל דחיפה ישירה ל-main, אוסף רק את ההקשר הרלוונטי
// (כותרת ותיאור, Issue מקושר, diff מוגבל, קבצים שהשתנו, תוצאות CI/בדיקות, README ומדיניות .ai/REVIEW.md של הפרויקט,
// סבבים קודמים ותשובות Claude), מבקש מ-OpenAI סקירה מובנית (JSON) ומפרסם אותה כתגובה ב-PR עם GITHUB_TOKEN.
// Claude לא מקבל את הביקורת אוטומטית: הוא בודק כל ממצא מול הקוד, מתקן או מתנגד עם ראיות (AI_COUNCIL.md כלל 1).
// לולאה: push → סקירה → תיקון → push → סקירה, עד PASS או עד MAX_REVIEW_ROUNDS סבבים חוסמים; אז OWNER_DECISION_REQUIRED.
// בלי OPENAI_API_KEY — לא עושה כלום (יציאה 0). שום סוד לא נכתב לפלט: ערכי מפתחות מוסתרים לפני הפרסום.
import { readFileSync, existsSync, readdirSync, appendFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

export const MARKER = 'gpt-review';
export const VERDICTS = ['PASS', 'BLOCKED', 'OWNER_DECISION_REQUIRED'];
export const LABELS = { PASS: 'gpt-review:pass', BLOCKED: 'gpt-review:blocked', OWNER_DECISION_REQUIRED: 'gpt-review:owner-decision', APPROVAL: 'gpt-review:owner-approval', SKIP: 'skip-gpt-review' };
export const LABEL_COLORS = { 'gpt-review:pass': '0e8a16', 'gpt-review:blocked': 'd73a4a', 'gpt-review:owner-decision': 'fbca04', 'gpt-review:owner-approval': '5319e7', 'skip-gpt-review': 'ededed' };
export const FINDING_TYPES = ['BLOCKER', 'BUG', 'SECURITY', 'REGRESSION', 'MISSING REQUIREMENT', 'MISLEADING UI/METRIC', 'TEST GAP', 'ARCHITECTURE', 'OPTIONAL IMPROVEMENT'];
export const ALWAYS_BLOCKING = new Set(['BLOCKER', 'SECURITY']);
export const NEVER_BLOCKING = new Set(['OPTIONAL IMPROVEMENT']);
// שערי אישור: שני המודלים לא מחליטים לבד — עובר למאיר (דרישה 8)
export const OWNER_GATES = ['הוצאה כספית חדשה / מנוי / שדרוג תוכנית (שלא אושרו במפורש בדרישה שהובילה לשינוי)', 'שינוי ספק בתשלום', 'שימוש בכסף אמיתי', 'מסחר/מינוף אמיתי', 'secrets/credentials: הוספת סוד חדש, העברתו למקום אחר, הרחבת הרשאות, או חשיפת ערך (צריכת סוד שכבר מוגדר, באותה דרך כמו workflows קיימים — לא שער)', 'מחיקה משמעותית של מידע', 'שינוי ארכיטקטורה בלתי הפיך', 'שינוי מהות המוצר'];

// מגבלות עלות (דרישה 10): לא שולחים את כל הריפו; diff מוגבל, תוקצב לכל קובץ, ומסמכים מקוצרים
export const LIMITS = { diffChars: 90_000, fileChars: 14_000, docChars: 5_000, issueChars: 3_000, commentChars: 3_500, prevRounds: 4, testOutChars: 4_000, outTokens: 16_000, maxLineChars: 1_500 };
export const SKIP_PATHS = [/^\.github\/invest-ops\//, /\.(png|jpe?g|gif|webp|ico|mp4|mp3|woff2?|ttf|pdf|zip)$/i, /(^|\/)package-lock\.json$/, /(^|\/)yarn\.lock$/];
const CODE_EXT = /\.(m?js|cjs|ts|py|html|css|ya?ml|json|sh|toml)$/i;

export const redact = (s) => String(s).replace(/\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, '[REDACTED]');
export const short = (s) => String(s || '').slice(0, 7);
export const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n)}\n…(קוצר, ${s.length - n} תווים נוספים)` : s; };

/** מיפוי: לכל קובץ שהשתנה, האם לדלג עליו בסקירה (קבצים בינאריים, פקודות ops, lock) */
export const isSkippedPath = (p) => SKIP_PATHS.some((re) => re.test(p));

/** דילוג על שינויים שאינם מהותיים (דרישה 2): הכול נתיבי-דילוג, אין שינוי טקסטואלי, תווית skip, או "ops:" */
export function shouldSkipChange({ files = [], title = '', labels = [], draft = false } = {}){
  if (draft) return 'PR בטיוטה (draft) — נבדוק כשיהיה מוכן';
  if (labels.includes(LABELS.SKIP)) return `תווית ${LABELS.SKIP}`;
  if (/^ops:/i.test(title.trim())) return 'commit תפעולי (ops:) — לא שינוי קוד';
  const real = files.filter((f) => !isSkippedPath(f.filename));
  if (!real.length) return 'רק קבצים שאינם נסקרים (בינאריים / פקודות ops / lock)';
  if (!real.some((f) => (f.additions || 0) + (f.deletions || 0) > 0)) return 'אין שינוי טקסטואלי';
  return null;
}

/** סמן שמזהה סקירה קודמת: <!-- gpt-review sha=<sha> round=<n> verdict=<v> --> */
export const marker = ({ sha, round, verdict }) => `<!-- ${MARKER} sha=${sha} round=${round} verdict=${verdict} -->`;
export function parseMarkers(comments){
  const out = [];
  for (const c of comments){
    const m = String(c.body || '').match(/<!-- gpt-review sha=([0-9a-f]+) round=(\d+) verdict=([A-Z_]+) -->/);
    if (m) out.push({ sha: m[1], round: Number(m[2]), verdict: m[3], id: c.id, created_at: c.created_at, body: c.body });
  }
  return out;
}
/** מצב הסבבים: כמה סבבים חוסמים היו, האם ה-SHA הנוכחי כבר נסקר, ומה הסבב הבא */
export function roundState(comments, headSha, maxRounds){
  const reviews = parseMarkers(comments);
  const done = reviews.find((r) => headSha.startsWith(r.sha) || r.sha.startsWith(headSha));
  const blocked = reviews.filter((r) => r.verdict === 'BLOCKED').length;
  const last = reviews[reviews.length - 1] || null;
  return { reviews, alreadyReviewed: !!done, blockedRounds: blocked, round: reviews.length + 1, last, finalRound: blocked >= maxRounds, ownerDecided: !!last && last.verdict === 'OWNER_DECISION_REQUIRED' };
}

/** דחיפה ל-main: מספר ה-PR שמוזג (squash: "(#N)" בסוף הכותרת) — כדי לא לסקור שוב PR שכבר נסקר */
export const mergedPrNumber = (message) => { const m = String(message || '').match(/\(#(\d+)\)\s*$/m); return m ? Number(m[1]) : null; };
/** דחיפה ראשונה לענף (before = אפסים) — אין מה להשוות */
export const isFirstPush = (before) => !before || /^0+$/.test(before);

/** זיהוי עבודה של Claude לפי כמה אותות (דרישה 11) — לא מסתמכים על אחד */
export function claudeSignals({ branch = '', commits = [], body = '' } = {}){
  const s = [];
  if (/^(claude\/|ccr-)/.test(branch)) s.push(`ענף ${branch.split('/')[0] === 'claude' ? 'claude/*' : 'ccr-*'}`);
  const msgs = commits.map((c) => c.commit?.message || c.message || '').join('\n');
  if (/co-authored-by:\s*claude/i.test(msgs)) s.push('Co-Authored-By: Claude');
  if (/claude-session:/i.test(msgs)) s.push('Claude-Session trailer');
  if (/generated (with|by) \[claude code\]/i.test(body)) s.push('חתימת Claude Code בתיאור');
  return s;
}

/** סיווג תגובה ב-PR: Claude (חתימת Claude Code מחשבון בעל הריפו), בעל הריפו, GPT (סמן), bot אחר */
export function kindOf(c){
  const b = String(c.body || ''), login = c.user?.login || '';
  if (b.includes(`<!-- ${MARKER} `)) return 'GPT';
  if (/\[bot\]$/.test(login)) return 'bot';
  if (/_Generated by \[Claude Code\]/.test(b)) return 'Claude';
  return `בעל הריפו (${login})`;
}

// ---------- מדיניות פרויקט: .ai/REVIEW.md בשורש ובכל פרויקט, עם front-matter אופציונלי ----------
// ---
// applies_to: [english-ai/, english-live/]   ← נתיבים נוספים שהמדיניות חלה עליהם (מעבר לתיקיית הקובץ)
// test: node --test invest-api/tests/*.test.mjs
// docs: [invest/docs/ARCHITECTURE.md]
// ---
export function parseFrontMatter(text){
  const m = String(text).match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: String(text) };
  const meta = {};
  for (const line of m[1].split('\n')){
    const kv = line.match(/^([\w-]+):\s*(.*)$/); if (!kv) continue;
    const v = kv[2].trim();
    meta[kv[1]] = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean) : v;
  }
  return { meta, body: String(text).slice(m[0].length) };
}
export function findPolicies(root = '.'){
  const out = [];
  const add = (dir) => { const p = join(root, dir, '.ai', 'REVIEW.md'); if (existsSync(p)) { const { meta, body } = parseFrontMatter(readFileSync(p, 'utf8')); out.push({ dir: dir === '.' ? '' : dir.replace(/\/?$/, '/'), path: p.replace(/^\.\//, ''), meta, body }); } };
  add('.');
  for (const e of readdirSync(root, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') add(e.name);
  return out;
}
/** אילו מדיניויות חלות על קבצי השינוי: השורש תמיד; פרויקט — אם קובץ נמצא בתיקייתו או ב-applies_to שלו */
export function matchPolicies(policies, files){
  const names = files.map((f) => f.filename);
  return policies.filter((p) => !p.dir || names.some((n) => n.startsWith(p.dir) || (p.meta.applies_to || []).some((a) => n.startsWith(String(a).replace(/^\.?\//, '')))));
}
export const topDirs = (files) => [...new Set(files.map((f) => f.filename.split('/')[0]).filter((d) => d && !d.includes('.')))];

/** בניית ה-diff בתקציב: קבצי קוד קודם (ובתוכם הגדולים קודם — התקרה לקובץ מגינה על התקציב), קבצי דילוג בחוץ, שורות ענק (minified) מקוצרות, ומה שלא נכנס — רשימה בלבד */
export function buildDiff(files, limits = LIMITS){
  const order = (f) => (CODE_EXT.test(f.filename) ? 0 : /\.md$/i.test(f.filename) ? 2 : 1);
  const sorted = [...files].filter((f) => !isSkippedPath(f.filename)).sort((a, b) => order(a) - order(b) || ((b.changes || 0) - (a.changes || 0)));
  let used = 0; const parts = [], omitted = [];
  for (const f of sorted){
    const head = `### ${f.status || 'modified'} ${f.filename} (+${f.additions || 0} −${f.deletions || 0})`;
    let patch = String(f.patch || '(אין patch — קובץ בינארי/גדול מדי/שינוי שם)').split('\n').map((l) => (l.length > limits.maxLineChars ? `${l.slice(0, limits.maxLineChars)}…(שורה קוצרה)` : l)).join('\n');
    if (patch.length > limits.fileChars) patch = `${patch.slice(0, limits.fileChars)}\n…(patch קוצר)`;
    const chunk = `${head}\n\`\`\`diff\n${patch}\n\`\`\``;
    if (used + chunk.length > limits.diffChars){ omitted.push(`${f.filename} (+${f.additions || 0} −${f.deletions || 0})`); continue; }
    used += chunk.length; parts.push(chunk);
  }
  const list = files.map((f) => `- ${f.filename} (${f.status}, +${f.additions || 0} −${f.deletions || 0})${isSkippedPath(f.filename) ? ' — לא נסקר' : ''}`).join('\n');
  return { text: parts.join('\n\n'), omitted, list, chars: used };
}

// ---------- ההודעות ל-OpenAI ----------
export const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'BLOCKED'] },
    summary: { type: 'string', description: 'שתיים-שלוש שורות בעברית: מה השינוי עושה ומה מצב הסקירה' },
    checked: { type: 'array', items: { type: 'string' }, description: 'מה נבדק בפועל (קבצים/זרימות/הנחות)' },
    tests_checked: { type: 'array', items: { type: 'string' }, description: 'אילו בדיקות/CI נבדקו ומה תוצאתן' },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      type: { type: 'string', enum: FINDING_TYPES }, blocking: { type: 'boolean' }, title: { type: 'string' },
      file: { type: ['string', 'null'] }, line: { type: ['integer', 'null'] },
      problem: { type: 'string' }, why: { type: 'string' }, reproduce: { type: ['string', 'null'] }, fix: { type: 'string' },
    }, required: ['type', 'blocking', 'title', 'file', 'line', 'problem', 'why', 'reproduce', 'fix'] } },
    owner_gates: { type: 'array', items: { type: 'string' }, description: 'שערי אישור של בעל הריפו שהשינוי נוגע בהם (ריק אם אין)' },
    dispute: { type: ['object', 'null'], additionalProperties: false, properties: {
      claude_view: { type: 'string' }, gpt_view: { type: 'string' },
      options: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { option: { type: 'string' }, consequence: { type: 'string' } }, required: ['option', 'consequence'] } },
    }, required: ['claude_view', 'gpt_view', 'options'] },
    notes: { type: 'array', items: { type: 'string' }, description: 'הערות לא חוסמות שלא מצדיקות ממצא' },
  },
  required: ['verdict', 'summary', 'checked', 'tests_checked', 'findings', 'owner_gates', 'dispute', 'notes'],
};

export function buildMessages(ctx){
  const { kind, repo, number, title, body, headSha, branch, baseRef, issues = [], diff, files, ci = [], tests = [], docs = [], policies = [], previous = [], replies = [], signals = [], round, maxRounds, finalRound } = ctx;
  const system = [
    `אתה GPT Reviewer — "המהנדס המבקר" ב-AI Council של הריפו ${repo}. Claude (מהנדס שווה-מעמד, לא כפוף לך) כתב את השינוי; בעל הריפו (מאיר) מכריע במחלוקות. זו ריצה אוטומטית ב-GitHub Actions: הפלט שלך מתפרסם כמו שהוא ב-PR, Claude קורא אותו, בודק כל ממצא מול הקוד, ומתקן או מתנגד עם ראיות.`,
    'תפקידך: לבדוק את העבודה כמו סוקר קוד קפדן — מול הדרישה המקורית, ה-diff, הקבצים, הבדיקות והמדיניות של הפרויקט. לא "looks good": כל דבר שאתה טוען חייב להיות ממצא מסווג עם מיקום וראיה, או "אין ממצאים" במפורש.',
    '', '## סיווג חובה לכל ממצא (type):', ...FINDING_TYPES.map((t) => `- ${t}`),
    'blocking=true רק כשהשינוי לא צריך להתמזג לפני תיקון (BLOCKER/SECURITY תמיד חוסמים; OPTIONAL IMPROVEMENT לעולם לא). BUG/REGRESSION/MISSING REQUIREMENT/MISLEADING UI/METRIC — חוסמים כשהם מוכחים ומהותיים למשתמש; TEST GAP/ARCHITECTURE — חוסמים רק אם המדיניות דורשת זאת במפורש.',
    'לכל ממצא: problem (מה הבעיה), file+line (איפה — מתוך ה-diff או קובץ שקיבלת), why (למה זו בעיה, מול הדרישה/מדיניות), reproduce (איך לשחזר/להוכיח, או null), fix (מה נדרש). אל תמציא קבצים או שורות שלא ראית.',
    '', '## עקרונות:',
    '- Evidence first: ממצא מבוסס על מה שקיבלת (diff, קבצים, בדיקות, מדיניות). השערה ללא ראיה — הכנס ל-notes, לא ל-findings.',
    '- אל תחזור על ממצא מסבב קודם ש-Claude ענה עליו עם ראיה משכנעת. אם התשובה לא משכנעת — אמור בדיוק למה, עם ראיה נגדית. אם Claude תיקן — אשר שתוקן (אל תדווח שוב).',
    '- verdict=PASS רק כשאין ממצא חוסם. אז summary כולל: מה נבדק, אילו בדיקות, והערות לא חוסמות ב-notes.',
    `- שערי אישור של בעל הריפו (owner_gates) — אם השינוי נוגע באחד מאלה, רשום אותו ב-owner_gates (שני המודלים לא מחליטים לבד): ${OWNER_GATES.join('; ')}.`,
    '- מדיניות הפרויקט (.ai/REVIEW.md) גוברת על טעם אישי. בלי מדיניות — סקירה כללית: נכונות, רגרסיות, אבטחה (סודות בצד לקוח, קלט לא מאומת), UI/מדדים מטעים, פערי בדיקות.',
    '- אסור לכלול מפתחות, טוקנים או סודות בפלט, גם לא כדוגמה.',
    '- כתוב בעברית (מונחים טכניים באנגלית בסדר). קצר וקונקרטי; בלי מחמאות ובלי ניסוחים כלליים.',
    finalRound ? `- זה הסבב האחרון (${maxRounds} סבבים חוסמים כבר היו). אם עדיין יש ממצא חוסם — מלא dispute: claude_view (מה Claude טוען, מהתשובות שלו), gpt_view (מה אתה טוען), options (לכל אפשרות: option + consequence) — בשפה פשוטה למאיר, שאינו מתכנת. אם Claude תיקן הכול — verdict=PASS ו-dispute=null.` : `- סבב ${round} מתוך ${maxRounds}. dispute=null בסבבים רגילים.`,
  ].join('\n');
  const sec = (h, t) => (t && String(t).trim() ? `## ${h}\n${t}\n` : '');
  const user = [
    `# ${kind === 'push' ? `דחיפה ישירה ל-${baseRef}` : `PR #${number}`}: ${title}`,
    `repo: ${repo} · head: ${headSha} · ענף: ${branch || '—'} → ${baseRef} · זיהוי Claude: ${signals.length ? signals.join(', ') : 'לא זוהו אותות (ייתכן שינוי ידני)'}`,
    sec('תיאור', clip(body, 6000)),
    sec('הדרישה / Issue שהוביל לשינוי', issues.map((i) => `### #${i.number}: ${i.title}\n${clip(i.body, LIMITS.issueChars)}`).join('\n\n')),
    sec('מדיניות הפרויקט (.ai/REVIEW.md)', policies.map((p) => `### ${p.path}\n${clip(p.body, LIMITS.docChars)}`).join('\n\n')),
    sec('קבצים שהשתנו', files),
    sec('CI (check runs על ה-head)', ci.length ? ci.map((c) => `- ${c.name}: ${c.status}${c.conclusion ? ` / ${c.conclusion}` : ''}`).join('\n') : '(אין check runs עדיין — ייתכן שה-CI עוד רץ)'),
    sec('בדיקות שהורצו בריצה זו', tests.map((t) => `### ${t.cmd} → exit ${t.code}\n\`\`\`\n${clip(t.out, LIMITS.testOutChars)}\n\`\`\``).join('\n\n')),
    sec('מסמכים רלוונטיים (README/ארכיטקטורה, מקוצרים)', docs.map((d) => `### ${d.path}\n${clip(d.text, LIMITS.docChars)}`).join('\n\n')),
    sec('סבבים קודמים של הסקירה הזו', previous.map((p) => `### סבב ${p.round} (${p.verdict}, ${String(p.created_at).slice(0, 16)})\n${clip(p.body.replace(/<!--.*?-->/g, ''), LIMITS.commentChars)}`).join('\n\n')),
    sec('תשובות Claude / בעל הריפו מאז (מהישנה לחדשה)', replies.map((r) => `### ${String(r.created_at).slice(0, 16)} · ${kindOf(r)}\n${clip(r.body, LIMITS.commentChars)}`).join('\n\n')),
    sec('diff', diff),
    'בצע את הסקירה והחזר JSON לפי הסכימה.',
  ].filter(Boolean).join('\n');
  // הסתרת ערכי סוד גם בהקשר שנשלח למודל (diff, לוגים, תגובות) — לא רק בתגובה שמתפרסמת
  return [{ role: 'system', content: system }, { role: 'user', content: redact(user) }];
}

/** אכיפת כללי הפסיקה בצד הסקריפט (לא סומכים על המודל לבד) */
export function normalize(result, { finalRound = false } = {}){
  const findings = (result.findings || []).map((f) => ({ ...f, type: FINDING_TYPES.includes(f.type) ? f.type : 'BUG', blocking: ALWAYS_BLOCKING.has(f.type) ? true : NEVER_BLOCKING.has(f.type) ? false : !!f.blocking }));
  const blocking = findings.filter((f) => f.blocking);
  let verdict = blocking.length ? 'BLOCKED' : 'PASS';
  if (verdict === 'BLOCKED' && finalRound) verdict = 'OWNER_DECISION_REQUIRED';
  const dispute = verdict === 'OWNER_DECISION_REQUIRED' ? (result.dispute || { claude_view: '(לא סוכם)', gpt_view: blocking.map((f) => f.title).join('; '), options: [] }) : null;
  return { ...result, findings, verdict, dispute, owner_gates: result.owner_gates || [], notes: result.notes || [], checked: result.checked || [], tests_checked: result.tests_checked || [] };
}

export function formatComment(r, ctx){
  const { number, headSha, round, maxRounds, model, runUrl, usage, signals = [], kind, skippedFiles = [] } = ctx;
  const icon = { PASS: '✅', BLOCKED: '❌', OWNER_DECISION_REQUIRED: '⚖️' }[r.verdict];
  const blocking = r.findings.filter((f) => f.blocking), soft = r.findings.filter((f) => !f.blocking);
  const L = [];
  L.push(`## GPT REVIEW: ${r.verdict} ${icon} (${round > maxRounds ? `סבב הכרעה אחרי ${maxRounds} סבבים` : `סבב ${round}/${maxRounds}`})`);
  L.push(marker({ sha: headSha, round, verdict: r.verdict }));
  L.push(`${kind === 'push' ? 'commit' : `PR #${number}`} · \`${short(headSha)}\` · ${model} · זיהוי Claude: ${signals.length ? signals.join(', ') : 'לא זוהה'}`);
  L.push('', r.summary);
  if (r.checked.length) L.push('', '**מה נבדק:**', ...r.checked.map((c) => `- ${c}`));
  if (r.tests_checked.length) L.push('', '**בדיקות/CI:**', ...r.tests_checked.map((c) => `- ${c}`));
  const fmt = (f, i) => [`#### ${i + 1}. [${f.type}] ${f.title}${f.file ? ` — \`${f.file}${f.line ? `:${f.line}` : ''}\`` : ''} ${f.blocking ? '🔴 חוסם' : '🟡 לא חוסם'}`, `- **הבעיה:** ${f.problem}`, `- **למה זו בעיה:** ${f.why}`, ...(f.reproduce ? [`- **שחזור/הוכחה:** ${f.reproduce}`] : []), `- **מה נדרש:** ${f.fix}`].join('\n');
  if (r.findings.length){ L.push('', `### ממצאים (${r.findings.length}, מהם ${blocking.length} חוסמים)`); L.push(...blocking.map(fmt), ...soft.map((f, i) => fmt(f, blocking.length + i))); }
  else L.push('', '### ממצאים: אין ממצאים מהותיים');
  if (r.owner_gates.length) L.push('', '### ⚠️ OWNER_APPROVAL_REQUIRED — נוגע בשערי אישור של מאיר (לא למזג בלי אישורו)', ...r.owner_gates.map((g) => `- ${g}`));
  if (r.dispute){
    L.push('', '### ⚖️ OWNER_DECISION_REQUIRED — @meirco199-prog, נדרשת הכרעה שלך', `- **מה Claude חושב:** ${r.dispute.claude_view}`, `- **מה GPT חושב:** ${r.dispute.gpt_view}`);
    if (r.dispute.options?.length) L.push('- **האפשרויות וההשלכות:**', ...r.dispute.options.map((o) => `  - ${o.option} → ${o.consequence}`));
    L.push('- אחרי ההכרעה: הסר את התווית `gpt-review:owner-decision` (או הרץ את ה-workflow ידנית עם force) כדי לחדש את הסקירה.');
  }
  if (r.notes.length) L.push('', '### הערות לא חוסמות', ...r.notes.map((n) => `- ${n}`));
  if (skippedFiles.length) L.push('', `_לא נסקרו (מחוץ לתקציב/בינאריים): ${skippedFiles.join(', ')}_`);
  L.push('', '---');
  if (r.verdict === 'BLOCKED') L.push(`**ל-Claude:** אל תקבל את הממצאים אוטומטית — בדוק כל אחד מול הקוד (AI_COUNCIL.md כלל 1). לכל ממצא, בתגובה אחת ב-PR: **תוקן** (commit + מה שונה) או **לא מסכים** + ראיה (קובץ:שורה / בדיקה / ריצה). ${round >= maxRounds ? 'דחיפה חדשה מפעילה את סבב ההכרעה: PASS אם הכול תוקן, אחרת OWNER_DECISION_REQUIRED למאיר.' : `דחיפה חדשה מפעילה סבב ${round + 1}/${maxRounds}.`}`);
  if (r.verdict === 'PASS') L.push('**ל-Claude:** אפשר למזג (אם ה-CI ירוק ואין OWNER_APPROVAL_REQUIRED). הערות לא חוסמות — לשיקולך, בלי סבב נוסף.');
  L.push(`_Posted by gpt-review.yml${runUrl ? ` · [ריצה](${runUrl})` : ''}${usage ? ` · tokens in/out: ${usage.prompt_tokens || '?'}/${usage.completion_tokens || '?'}` : ''}_`);
  return redact(L.join('\n'));
}

export function stepSummary(r, ctx){
  const rows = r.findings.map((f) => `| ${f.blocking ? '🔴' : '🟡'} ${f.type} | ${f.title} | ${f.file || ''}${f.line ? `:${f.line}` : ''} |`).join('\n');
  return `## GPT REVIEW: ${r.verdict} — ${ctx.kind === 'push' ? 'commit' : `PR #${ctx.number}`} \`${short(ctx.headSha)}\` (סבב ${ctx.round}/${ctx.maxRounds})\n\n${r.summary}\n\n${r.findings.length ? `| סוג | ממצא | איפה |\n|---|---|---|\n${rows}` : '_אין ממצאים מהותיים_'}\n${r.owner_gates.length ? `\n⚠️ שערי אישור: ${r.owner_gates.join('; ')}\n` : ''}`;
}

// ---------- ריצה ----------
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) await main().catch((e) => { console.error(`::error::${redact(e?.stack || e)}`); process.exit(1); });

async function main(){
  const KEY = process.env.OPENAI_API_KEY, GH = process.env.GITHUB_TOKEN || process.env.GH_TOKEN, REPO = process.env.GITHUB_REPOSITORY;
  if (!KEY){ console.log('::notice::OPENAI_API_KEY לא מוגדר — GPT Reviewer כבוי (הגדרת הסוד היא האישור להוצאה)'); return; }
  if (!GH || !REPO) throw new Error('חסר GITHUB_TOKEN או GITHUB_REPOSITORY');
  const MODEL = process.env.OPENAI_REVIEW_MODEL || process.env.OPENAI_MODEL || 'gpt-5';
  const EFFORT = process.env.OPENAI_REVIEW_REASONING || 'medium';
  const MAX = Math.max(1, Number(process.env.MAX_REVIEW_ROUNDS || 3));
  const FORCE = process.env.REVIEW_FORCE === '1';
  const RUN_URL = process.env.RUN_URL;
  const event = process.env.GITHUB_EVENT_PATH && existsSync(process.env.GITHUB_EVENT_PATH) ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const api = async (path, init = {}) => {
    const r = await fetch(path.startsWith('http') ? path : `https://api.github.com/repos/${REPO}/${path}`, { ...init, headers: { Authorization: `Bearer ${GH}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'gpt-review', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    if (!r.ok && !init.ok?.includes(r.status)) throw new Error(`GitHub ${r.status} ${path}: ${redact(String(j?.message || t).slice(0, 300))}`);
    return j;
  };
  const summary = (s) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${s}\n`); console.log(s); };
  const setOut = (k, v) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };

  // --- מה סוקרים: PR (pull_request / dispatch עם מספר) או דחיפה ישירה ל-main ---
  let kind = 'pr', number = Number(process.env.PR_NUMBER || event.pull_request?.number || 0), pr = null, files = [], headSha, baseRef, branch = '', title = '', body = '', labels = [], commits = [], pushRange = null;
  if (!number && process.env.GITHUB_EVENT_NAME === 'push'){
    kind = 'push'; headSha = event.after || process.env.GITHUB_SHA; baseRef = (event.ref || '').replace('refs/heads/', '');
    const msg = event.head_commit?.message || '';
    const merged = mergedPrNumber(msg);
    if (merged){ // מיזוג של PR — אם ה-PR כבר נסקר, אין מה לסקור שוב
      const cs = await api(`issues/${merged}/comments?per_page=100`);
      if (parseMarkers(cs).length){ summary(`⏭️ דילוג: commit \`${short(headSha)}\` הוא מיזוג של PR #${merged} שכבר נסקר`); setOut('verdict', 'SKIPPED'); return; }
    }
    if (isFirstPush(event.before)){ summary('⏭️ דילוג: דחיפה ראשונה לענף (אין before להשוואה)'); setOut('verdict', 'SKIPPED'); return; }
    const cmp = await api(`compare/${event.before}...${event.after}`);
    files = cmp.files || []; commits = cmp.commits || []; title = msg.split('\n')[0]; body = msg; pushRange = `${short(event.before)}...${short(event.after)}`;
    const existing = await api(`commits/${headSha}/comments?per_page=100`);
    if (!FORCE && parseMarkers(existing).length){ summary(`⏭️ דילוג: commit \`${short(headSha)}\` כבר נסקר`); setOut('verdict', 'SKIPPED'); return; }
  } else {
    if (!number) throw new Error('אין מספר PR (pull_request event או PR_NUMBER)');
    pr = await api(`pulls/${number}`);
    headSha = pr.head.sha; baseRef = pr.base.ref; branch = pr.head.ref; title = pr.title || ''; body = pr.body || ''; labels = (pr.labels || []).map((l) => l.name);
    for (let page = 1; page <= 3; page++){ const f = await api(`pulls/${number}/files?per_page=100&page=${page}`); files.push(...f); if (f.length < 100) break; }
    commits = await api(`pulls/${number}/commits?per_page=50`);
  }
  const skip = shouldSkipChange({ files, title, labels, draft: !!pr?.draft });
  if (skip){ summary(`⏭️ דילוג על הסקירה: ${skip}`); setOut('verdict', 'SKIPPED'); return; }

  // --- סבבים ודדופליקציה ---
  const comments = kind === 'pr' ? await api(`issues/${number}/comments?per_page=100`) : [];
  const st = roundState(comments, headSha, MAX);
  if (!FORCE && st.alreadyReviewed){ summary(`⏭️ דילוג: \`${short(headSha)}\` כבר נסקר (סבב ${st.reviews.length})`); setOut('verdict', 'SKIPPED'); return; }
  if (!FORCE && st.ownerDecided && labels.includes(LABELS.OWNER_DECISION_REQUIRED)){ summary(`⏸️ ממתין להכרעת בעל הריפו (תווית ${LABELS.OWNER_DECISION_REQUIRED}); הסר את התווית או הרץ עם force כדי לחדש`); setOut('verdict', 'OWNER_DECISION_REQUIRED'); process.exitCode = 1; return; }
  const round = st.round, finalRound = st.finalRound;

  // --- הקשר: Issue מקושר, מדיניות, מסמכים, CI, בדיקות, סבבים קודמים ותשובות ---
  const issueNums = [...new Set([...(`${title}\n${body}`.match(/(?:^|[^\w/])#(\d{1,6})\b/g) || [])].map((s) => Number(s.replace(/\D/g, ''))).filter((n) => n && n !== number))].slice(0, 2);
  const issues = []; for (const n of issueNums){ const i = await api(`issues/${n}`, { ok: [404, 410] }); if (i?.title) issues.push({ number: n, title: i.title, body: i.body || '' }); }
  const policies = matchPolicies(findPolicies('.'), files);
  const docs = []; const seen = new Set();
  const addDoc = (p) => { if (!p || seen.has(p) || !existsSync(p) || !statSync(p).isFile()) return; seen.add(p); docs.push({ path: p, text: readFileSync(p, 'utf8') }); };
  for (const d of topDirs(files)) addDoc(join(d, 'README.md'));
  for (const p of policies) for (const d of p.meta.docs || []) addDoc(String(d));
  const ciRaw = await api(`commits/${headSha}/check-runs?per_page=50`, { ok: [403, 404] });
  const ci = (ciRaw?.check_runs || []).filter((c) => !/gpt review/i.test(c.name)).map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion }));
  const tests = [];
  for (const cmd of [...new Set(policies.map((p) => p.meta.test).filter(Boolean))]){
    let out = '', code = 0;
    try { out = execSync(`${cmd} 2>&1`, { encoding: 'utf8', timeout: 6 * 60_000, maxBuffer: 8 * 1024 * 1024 }); } catch (e) { code = e.status ?? 1; out = String(e.stdout || '') + String(e.stderr || ''); }
    tests.push({ cmd, code, out: out.split('\n').slice(-60).join('\n') });
  }
  const firstReviewAt = st.reviews[0]?.created_at;
  const previous = st.reviews.slice(-LIMITS.prevRounds);
  const replies = comments.filter((c) => kindOf(c) !== 'GPT' && kindOf(c) !== 'bot' && (!firstReviewAt || c.created_at > firstReviewAt)).slice(-8);
  const signals = claudeSignals({ branch, commits, body });
  const diff = buildDiff(files);
  const ctx = { kind, repo: REPO, number, title, body, headSha, branch, baseRef, issues, diff: diff.text, files: diff.list, ci, tests, docs, policies, previous, replies, signals, round, maxRounds: MAX, finalRound };
  const messages = buildMessages(ctx);
  console.log(`סבב ${round}/${MAX}${finalRound ? ' (אחרון)' : ''} · diff ${diff.chars} תווים · ${files.length} קבצים (${diff.omitted.length} מחוץ לתקציב) · prompt ~${Math.round(messages.reduce((n, m) => n + m.content.length, 0) / 3.5)} טוקנים · מודל ${MODEL}/${EFFORT}`);

  // --- OpenAI (פלט מובנה) ---
  let j;
  for (let attempt = 1; attempt <= 2; attempt++){
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, messages, max_completion_tokens: LIMITS.outTokens, response_format: { type: 'json_schema', json_schema: { name: 'gpt_review', strict: true, schema: SCHEMA } }, ...(/^(gpt-5|o\d)/.test(MODEL) ? { reasoning_effort: EFFORT } : {}) }) });
    j = await r.json().catch(() => ({}));
    if (r.ok) break;
    const msg = `OpenAI ${r.status}: ${redact(JSON.stringify(j.error || j).slice(0, 300))}`;
    if (attempt === 2 || ![429, 500, 502, 503].includes(r.status)) throw new Error(msg);
    console.log(`${msg} — מנסה שוב`); await new Promise((res) => setTimeout(res, 15_000));
  }
  const text = j.choices?.[0]?.message?.content || '';
  console.log(`model: ${j.model || MODEL} · finish: ${j.choices?.[0]?.finish_reason} · usage: ${JSON.stringify(j.usage || {})}`);
  if (!text.trim()) throw new Error('תשובה ריקה מ-OpenAI (אם finish=length: תקציב הפלט נגמר על טוקני חשיבה)');
  const result = normalize(JSON.parse(text), { finalRound });
  const fctx = { ...ctx, model: j.model || MODEL, runUrl: RUN_URL, usage: j.usage, skippedFiles: diff.omitted };
  const commentBody = formatComment(result, fctx);

  // --- פרסום: תגובה ב-PR (או על ה-commit), תוויות, סיכום ריצה, קוד יציאה = ה-check ---
  if (kind === 'pr'){
    const c = await api(`issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body: commentBody }) });
    console.log(`פורסם: ${c.html_url}`);
    await syncLabels(api, number, labels, result);
  } else {
    const c = await api(`commits/${headSha}/comments`, { method: 'POST', body: JSON.stringify({ body: commentBody }) });
    console.log(`פורסם על ה-commit: ${c.html_url}`);
    if (result.verdict !== 'PASS' || result.owner_gates.length){ // בלי PR אין למי לענות — פותחים Issue ש-Claude/מאיר יראו
      const iss = await api('issues', { method: 'POST', body: JSON.stringify({ title: `GPT Review ${result.verdict}: ${title.slice(0, 80)} (${short(headSha)})`, body: `סקירה של דחיפה ישירה ל-${baseRef} (${pushRange}), בלי PR.\n\n${commentBody}`, labels: [LABELS[result.verdict], ...(result.owner_gates.length ? [LABELS.APPROVAL] : [])] }) });
      console.log(`נפתח Issue: ${iss.html_url}`);
    }
  }
  summary(stepSummary(result, fctx));
  setOut('verdict', result.verdict); setOut('round', String(round));
  if (result.verdict !== 'PASS'){ console.log(`::error::GPT REVIEW: ${result.verdict} (סבב ${round}/${MAX}) — ראה את התגובה ב-PR`); process.exitCode = 1; }
  else if (result.owner_gates.length) console.log(`::warning::PASS, אבל נוגע בשערי אישור של בעל הריפו: ${result.owner_gates.join('; ')}`);
}

async function syncLabels(api, number, current, result){
  const want = new Set([LABELS[result.verdict], ...(result.owner_gates.length ? [LABELS.APPROVAL] : [])]);
  for (const name of want){ await api('labels', { method: 'POST', body: JSON.stringify({ name, color: LABEL_COLORS[name] || 'ededed', description: 'GPT Reviewer (AI Council)' }), ok: [422] }); }
  for (const l of current) if (l.startsWith('gpt-review:') && !want.has(l)) await api(`issues/${number}/labels/${encodeURIComponent(l)}`, { method: 'DELETE', ok: [404] });
  await api(`issues/${number}/labels`, { method: 'POST', body: JSON.stringify({ labels: [...want] }) });
}
