// דוח תקינות יומי (Markdown) לפלטפורמת ההשקעות — נבנה מה-API הציבורי של ה-Worker, בלי מודל ובלי סודות.
// מודפס ל-stdout; ה-workflow מפרסם אותו כתגובה ב-Issue הקבוע של AI Council. שימוש: WORKER_URL=https://... node invest-api/scripts/health-report.mjs
const W = (process.env.WORKER_URL || '').replace(/\/$/, '');
if (!W){ console.error('WORKER_URL חסר'); process.exit(1); }
const get = async (p) => { try { const r = await fetch(`${W}/${p}`); const t = await r.text(); try { return JSON.parse(t); } catch { return { _error: `HTTP ${r.status}` }; } } catch (e) { return { _error: e.message }; } };
const n = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—');
const pct = (v) => (typeof v === 'number' ? (v * 100).toFixed(2) + '%' : '—');
const ok = (c) => (c ? '✅' : '❌');
const today = new Date().toISOString().slice(0, 10);
const [health, cron, rank, shadow, paper, bd, aggr] = await Promise.all([get('health'), get('cron/status'), get('rank'), get('shadow/report'), get('paper'), get('paper/breakdown'), get('aggressive/report')]);
const cs = cron.state || cron.last || {};
const entry = rank.date ? await get(`entry/${rank.date}`) : {};
const issues = [];
// 1. הסריקה סיימה
if (!cs.finalized) issues.push(`הסריקה של ${cs.day || '?'} לא הסתיימה (done ${cs.done}, queueLeft ${cs.queueLeft})`);
if ((cs.errors || []).length) issues.push(`שגיאות בסריקה: ${cs.errors.length}`);
// 2. הדירוג הוא של היום שנסרק, וכיסוי הניתוח כמעט מלא
const coverage = rank.universeSize ? rank.analyzed / rank.universeSize : null;
if (rank.date && cs.day && rank.date !== cs.day) issues.push(`הדירוג (${rank.date}) לא תואם ליום הסריקה (${cs.day})`);
if (coverage !== null && coverage < 0.9) issues.push(`כיסוי ניתוח נמוך: ${rank.analyzed}/${rank.universeSize}`);
// 3. התקלה הישנה: נסרקו ~500 אבל מודל הצל נשאר על יום קודם / n=100 (AI_COUNCIL#12)
const shadowLag = !!(rank.date && shadow.day && shadow.day < rank.date);
const shadowThin = (rank.analyzed || 0) >= 300 && (shadow.n || 0) < 300;
if (shadowLag) issues.push(`מודל הצל על ${shadow.day} בעוד הדירוג על ${rank.date} — התקלה מ-AI_COUNCIL#12 חזרה`);
if (shadowThin) issues.push(`מודל הצל על ${shadow.n} ניירות בלבד בעוד נותחו ${rank.analyzed} — התקלה מ-AI_COUNCIL#12 חזרה`);
// 4. מחירי 09:40
if (rank.date && entry.count !== undefined && rank.analyzed && entry.count < rank.analyzed * 0.8) issues.push(`מחירי 09:40 ל-${rank.date}: ${entry.count} מתוך ${rank.analyzed}`);
// 5. חשבון התרגול: התאמה חשבונאית (סובלנות 5 אגורות: proceedsIls ברוטו מעוגל בנפרד מהמזומן נטו בכל מכירה → עד אגורה למכירה), ושערים עדכניים
const RECON_TOL = 0.05;
const diff = bd.reconciliation?.diffIls;
if (typeof diff === 'number' && Math.abs(diff) > RECON_TOL) issues.push(`חשבון התרגול: פער התאמה ${n(diff, 2)} ₪ (צפוי ${n(bd.reconciliation.expectedTotalIls, 2)}, בפועל ${n(bd.reconciliation.actualTotalIls, 2)})`);
if (paper.asOf && cs.day && paper.asOf < cs.day) issues.push(`שערי חשבון התרגול מ-${paper.asOf}, ישנים מיום הסריקה ${cs.day}`);
// 6. KV / מכסות
if (health.kvWriteLimitHit) issues.push(`KV הגיע למכסת הכתיבות (${health.kvWriteLimitHit})`);
const tight = Object.entries(health.budget || {}).filter(([, b]) => b.limit && b.used / b.limit >= 0.9).map(([k, b]) => `${k} ${b.used}/${b.limit}`);
const errs = health.recentErrors || [];
const runUrl = process.env.RUN_URL || '';
const lines = [];
lines.push(`<!-- health-report ${today} -->`);
lines.push(`## דוח תקינות ${today} — ${issues.length ? '❌ ' + issues.length + ' ממצאים' : '✅ תקין'}`);
if (runUrl) lines.push(`ריצה: ${runUrl}`);
lines.push('');
lines.push('| בדיקה | ערך | סטטוס |', '|---|---|---|');
lines.push(`| סריקה יומית | יום ${cs.day || '—'} · ${n(cs.done)} נכסים · finalized=${!!cs.finalized} · שגיאות ${(cs.errors || []).length} · ${cs.at || ''} | ${ok(cs.finalized && !(cs.errors || []).length)} |`);
lines.push(`| דירוג (rank) | תאריך ${rank.date || '—'} · שערי ${rank.barDate || '—'} · נותחו ${n(rank.analyzed)}/${n(rank.universeSize)} (${pct(coverage)}) | ${ok(rank.date === cs.day && coverage >= 0.9)} |`);
lines.push(`| מודל צל (Shadow) | יום ${shadow.day || '—'} · n=${n(shadow.n)}${shadow.pipeline ? ' · ' + shadow.pipeline : ''} | ${ok(!shadowLag && !shadowThin && !shadow.missing)} |`);
lines.push(`| מחירי 09:40 | ${rank.date || '—'}: ${n(entry.count)} ניירות${entry.missing ? ' (אין)' : ''} | ${ok(entry.count && rank.analyzed && entry.count >= rank.analyzed * 0.8)} |`);
lines.push(`| חשבון התרגול | שערי ${paper.asOf || '—'} · שווי ${n(paper.totalIls)} ₪ · מההתחלה ${n(paper.pnlIls)} ₪ (${pct(paper.pnlPct)}) · ${(paper.positions || []).length} פוזיציות · התאמה ${n(diff, 2)} ₪ | ${ok(typeof diff === 'number' && Math.abs(diff) <= RECON_TOL && !(paper.asOf < cs.day))} |`);
lines.push(`| מסלול אגרסיבי | יום ${aggr.day || '—'} · שווי ${n(aggr.totalIls)} ₪ · תשואה ${pct(aggr.metrics?.totalReturn)} מול SPY ${pct(aggr.metrics?.spyReturn)} · ממתינות ${(aggr.pending?.orders || []).length} | ${ok(!aggr.missing && aggr.day === cs.day)} |`);
lines.push(`| KV | ${health.kv || '—'} · מכסת כתיבות: ${health.kvWriteLimitHit ? 'הגיע ' + health.kvWriteLimitHit : 'לא'} | ${ok(health.kv === 'bound' && !health.kvWriteLimitHit)} |`);
lines.push(`| מכסות ספקים ≥90% | ${tight.length ? tight.join(', ') : 'אין'} | ${tight.length ? '⚠️' : '✅'} |`);
lines.push(`| שגיאות אחרונות (Worker) | ${errs.length} | ${errs.length ? '⚠️' : '✅'} |`);
lines.push('');
if (issues.length){ lines.push('### ממצאים'); for (const i of issues) lines.push(`- ❌ ${i}`); lines.push(''); }
if (errs.length){ lines.push('<details><summary>שגיאות אחרונות</summary>', ''); for (const e of errs.slice(-10)) lines.push(`- \`${(e.ts || '').slice(5, 16)}\` ${e.where}: ${String(e.msg || '').replace(/[`|]/g, ' ').slice(0, 160)}`); lines.push('', '</details>'); }
lines.push('', '_דוח אוטומטי מ-GitHub Actions (קריאה בלבד מה-API הציבורי). מסלולי ההשוואה, מודל הצל והמסלול האגרסיבי הם סימולציות._');
console.log(lines.join('\n'));
if (process.env.HEALTH_STRICT === '1' && issues.length) process.exit(2);
