import test from 'node:test';
import assert from 'node:assert/strict';
import { run, resolveIssue, alreadyPosted, parseStatusMarkers, projectOf, issueBody, redact, loadRegistry } from './relay.mjs';

const registry = { invest: { issue: 25 }, food: { issue: 98, owner_rules: 'חוקי התזונה נשארים' }, english: {} };
const msg = (id, project, hash = 'h' + id) => ({ id, project, hash, body: `**ChatGPT** …\n<!-- council-msg id=${id} project=${project || 'invest'} type=bug hash=${hash} -->` });
function fakes({ comments = {}, existingEnglish = null } = {}){
  const posts = [], created = [], workerCalls = [];
  const api = async (path, { method = 'GET', body } = {}) => {
    if (method === 'POST' && path === 'issues'){ created.push(body); return { number: 150 }; }
    if (method === 'POST' && /issues\/\d+\/comments$/.test(path)){ const n = path.match(/issues\/(\d+)/)[1]; posts.push({ issue: n, body: body.body }); return { html_url: `https://gh/${n}/c${posts.length}` }; }
    if (/^issues\?labels=/.test(path)) return existingEnglish ? [{ number: existingEnglish }] : [];
    if (/issues\/\d+\/comments/.test(path)) return comments[path.match(/issues\/(\d+)/)[1]] || [];
    throw new Error('unexpected ' + path);
  };
  const worker = async (path, { body } = {}) => { workerCalls.push({ path, body }); if (path === 'council/inbox') return { items: fakes.inbox }; if (path === 'council/task-status') return { updated: (body.updates || []).length }; if (path === 'council/comment') return { ok: true, id: 'cm_e2e', queued: true }; return { ok: true }; };
  return { api, worker, posts, created, workerCalls };
}

test('relay: ניתוב — invest ל-#25 כמו קודם (גם הודעה ישנה בלי project), food ל-Issue הרשום, english נפתח אוטומטית עם תווית', async () => {
  fakes.inbox = [{ id: 'cm_old', body: '**ChatGPT** הודעה ישנה' }, msg('cm_f', 'food'), msg('cm_e', 'english')];
  const f = fakes(); const s = await run({ registry, api: f.api, worker: f.worker, log: () => {} });
  assert.deepEqual(f.posts.map((p) => p.issue), ['25', '98', '150']);
  assert.equal(f.created.length, 1); assert.deepEqual(f.created[0].labels, ['ai-council', 'council:english']); assert.match(f.created[0].title, /english/);
  const ack = f.workerCalls.find((c) => c.path === 'council/ack'); assert.deepEqual(ack.body.posted.map((p) => p.id), ['cm_old', 'cm_f', 'cm_e']); assert.deepEqual(ack.body.issues, { invest: 25, food: 98, english: 150 });
  assert.equal(s.rejected.length, 0);
});

test('relay: פרויקט שלא ברישום לא מפורסם בשום מקום — מסומן FAILED ויוצא מהתיבה', async () => {
  fakes.inbox = [msg('cm_x', 'crypto-bot')];
  const f = fakes(); const s = await run({ registry, api: f.api, worker: f.worker, log: () => {} });
  assert.equal(f.posts.length, 0); assert.equal(f.created.length, 0);
  assert.deepEqual(s.rejected.map((x) => x.id), ['cm_x']);
  assert.deepEqual(f.workerCalls.find((c) => c.path === 'council/ack').body.ids, ['cm_x']);
  assert.equal(f.workerCalls.find((c) => c.path === 'council/task-status').body.updates[0].status, 'FAILED');
});

test('relay: דדופליקציה — הודעה שכבר ב-Issue (סמן id או hash) לא מתפרסמת שוב, רק מאושרת', async () => {
  fakes.inbox = [msg('cm_f', 'food'), msg('cm_g', 'food', 'samehash')];
  const f = fakes({ comments: { 98: [{ body: 'x <!-- council-msg id=cm_f project=food type=bug hash=hcm_f -->', html_url: 'https://gh/98/old' }, { body: 'y <!-- council-msg id=cm_zzz project=food type=bug hash=samehash -->', html_url: 'https://gh/98/old2' }] } });
  const s = await run({ registry, api: f.api, worker: f.worker, log: () => {} });
  assert.equal(f.posts.length, 0); assert.equal(s.skipped.length, 2);
  assert.deepEqual(s.posted.map((p) => p.url), ['https://gh/98/old', 'https://gh/98/old2'], 'מאושר עם הקישור הקיים');
  assert.equal(alreadyPosted([{ body: 'council-msg id=cm_f1 ' }], { id: 'cm_f' }), null, 'קידומת של id אחר לא נחשבת');
});

test('relay: סנכרון סטטוסים — הסמן האחרון לכל id, סטטוס לא מוכר נדחה, pr נשמר', async () => {
  fakes.inbox = [];
  const cs = [{ body: 'קיבלתי <!-- council-status id=cm_f status=RECEIVED -->', html_url: 'u1', created_at: '1' }, { body: '<!-- council-status id=cm_f status=PR_OPEN pr=https://github.com/x/pull/9 -->', html_url: 'u2', created_at: '2' }, { body: '<!-- council-status id=cm_q status=WHATEVER -->' }];
  assert.deepEqual(parseStatusMarkers(cs), [{ id: 'cm_f', status: 'PR_OPEN', pr: 'https://github.com/x/pull/9', url: 'u2', at: '2' }]);
  const f = fakes({ comments: { 98: cs } }); const s = await run({ registry, api: f.api, worker: f.worker, log: () => {} });
  assert.equal(s.statusUpdates, 1);
});

test('relay: E2E — הודעת בדיקה נשלחת דרך ה-Worker לפני קריאת התיבה, עם source=e2e-test', async () => {
  fakes.inbox = [];
  const f = fakes(); const s = await run({ registry, api: f.api, worker: f.worker, e2e: { project: 'food' }, log: () => {} });
  assert.equal(f.workerCalls[0].path, 'council/comment'); assert.equal(f.workerCalls[0].body.project, 'food'); assert.equal(f.workerCalls[0].body.source, 'e2e-test'); assert.equal(s.e2e.id, 'cm_e2e');
});

test('relay: עזרים — projectOf, resolveIssue עם cache, גוף Issue עם החלטת בעל הריפו, רדקציה של secret ב-URL', async () => {
  assert.equal(projectOf({}), 'invest'); assert.equal(projectOf({ project: 'Food' }), 'food');
  let calls = 0; const api = async () => { calls++; return [{ number: 7 }]; };
  const cache = new Map(); assert.equal(await resolveIssue('english', registry, api, cache), 7); assert.equal(await resolveIssue('english', registry, api, cache), 7); assert.equal(calls, 1);
  assert.equal(await resolveIssue('nope', registry, api, cache), null);
  assert.ok(issueBody('food', registry.food).includes('חוקי התזונה נשארים'));
  assert.equal(redact('https://w/council/inbox?secret=abc123&x=1 ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'), 'https://w/council/inbox?secret=[REDACTED]&x=1 [REDACTED]');
  const reg = loadRegistry(new URL('./projects.json', import.meta.url).pathname); assert.equal(reg.invest.issue, 25); assert.ok(reg.food.issue && reg.english.issue); assert.ok(reg.food.owner_rules.includes('חוקי התזונה'));
});
