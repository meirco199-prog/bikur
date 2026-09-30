// זיכרון לטווח ארוך: משוב → זיכרון; חזרה → "חוזרת"; 3 שיעורים בלי → "נלמדה"; חזרה → מתעוררת.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 420, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(() => { try { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; } catch {} });
const ok = (n, c) => console.log((c ? 'OK  ' : 'FAIL') + ' ' + n);

await p.goto('http://localhost:8901/english/');
await p.evaluate(() => localStorage.setItem('english-app-v1', JSON.stringify({
  version: 1, profile: { name: 'מאיר', level: 'B2', onboarded: true, minutesPerDay: 10, createdAt: '2026-09-29' },
  settings: { aiUrl: 'http://localhost:8902', liveUrl: 'http://localhost:8902', realtime: true, notifs: false, voiceRate: 1 },
})));
await p.reload(); await p.waitForTimeout(400);

// שיעור בטקסט עד הסיכום (ה-mock מחזיר במשוב את הטעות "I go yesterday")
async function lesson(answer){
  await p.locator('.nav-item[data-id="speak"]').click(); await p.waitForTimeout(200);
  await p.locator('.live-cta').click(); await p.waitForTimeout(300); await p.locator('.chip-btn:has-text("שיחה חופשית")').click(); await p.waitForTimeout(200);
  await p.locator('button:has-text("התחל שיחה")').click();
  await p.waitForFunction(() => { const s = document.querySelector('.call-status'); return s && !s.textContent.includes('מדבר') && !s.textContent.includes('מתחבר'); }, { timeout: 15000 }).catch(() => {});
  if (!await p.locator('.typed-row.open').count()){ await p.locator('.call-btn:has-text("⌨️")').click(); await p.waitForTimeout(100); }
  await p.locator('.call-input').fill(answer);
  await p.locator('.typed-row button:has-text("שלח")').click();
  await p.waitForFunction(() => (document.querySelector('.cap-teacher')?.textContent || '').includes('order'), { timeout: 15000 }).catch(() => {});
  await p.locator('.call-btn.end').click();
  await p.waitForFunction(() => !!document.querySelector('.metrics-list'), { timeout: 15000 }).catch(() => {});
  return p.locator('.screen').textContent();
}
const mem = () => p.evaluate(() => JSON.parse(localStorage.getItem('english-app-v1')).memory);
const profile = () => p.evaluate(async () => (await import('./js/ai.js')).learnerProfile());

// 1. שיעור ראשון: הטעות מהמשוב נכנסת לזיכרון, מילות מילוי נספרות, recap נשמר
let txt = await lesson('Um, yesterday I go to the office, uh, and I meet my boss');
let m = await mem();
const e1 = m.errors['i go yesterday'];
ok('error stored from feedback (count=1)', e1 && e1.count === 1 && e1.corrected === 'I went yesterday' && !e1.resolved);
ok('typed lesson: fillers NOT counted (no speech) and no fillers row', m.lastLesson.fillers === 0 && !txt.includes('מילות מילוי'));
ok('lastLesson recap saved (no recurring yet → empty recap, topic set)', m.lastLesson && m.lastLesson.topic === 'שיחה חופשית');
let pr = await profile();
ok('profile: not recurring after 1 time', pr.recurringErrors.length === 0 && pr.lastLessonRecap.includes('topic'));

// פרופיל: הכרטיס מציג את הטעות תחת "תוקנו לאחרונה"
await p.locator('.nav-item[data-id="profile"]').click(); await p.waitForTimeout(400);
let ptxt = await p.locator('.screen').textContent();
ok('profile memory card shows once-corrected error', ptxt.includes('מה המורה זוכר') && ptxt.includes('תוקנו לאחרונה') && ptxt.includes('I went yesterday'));

// 2. שיעור שני: אותה טעות שוב → חוזרת (count=2), מופיעה בסיכום ובפרופיל הלומד
txt = await lesson('Yesterday I go to the office again');
m = await mem();
ok('error now recurring (count=2)', m.errors['i go yesterday'].count === 2);
ok('summary shows "טעויות שעדיין חוזרות 1"', /טעויות שעדיין חוזרות\s*1/.test(txt));
pr = await profile();
ok('profile: recurringErrors has it with (x2)', pr.recurringErrors.some(s => s.includes('I go yesterday') && s.includes('(x2)')));
ok('profile: lastLessonRecap names the fix', pr.lastLessonRecap.includes('I went yesterday'));
ok('profile: fillerRate null when no measured fillers', pr.fillerRate === null || pr.fillerRate === 0);
// חישוב fillerRate דטרמיניסטי דרך ה-store: 6 מילות מילוי ב-3 דקות → 2/דקה
await p.evaluate(async () => { const s = await import('./js/store.js'); s.finishLessonMemory({ topic: 'x', mode: 'realtime', seenErrors: ['I go yesterday'], fillers: 6, minutes: 3 }); });
pr = await profile();
ok('profile: fillerRate computed (2.0/min)', pr.fillerRate === 2);

// 3. שלושה שיעורים בלי הטעות → "נלמדה": המורה מתבקש לא להציק
await p.evaluate(async () => { const s = await import('./js/store.js'); for (let i = 0; i < 3; i++) s.finishLessonMemory({ topic: 'x', mode: 'text', seenErrors: [], fillers: 0, minutes: 5 }); });
m = await mem();
ok('resolved after 3 lessons without it', m.errors['i go yesterday'].resolved === true && m.errors['i go yesterday'].missed === 3);
pr = await profile();
ok('profile: moved to resolvedErrors, not recurring', pr.resolvedErrors.some(s => s.includes('I went yesterday')) && pr.recurringErrors.length === 0);
await p.locator('.nav-item[data-id="profile"]').click(); await p.waitForTimeout(400);
ptxt = await p.locator('.screen').textContent();
ok('profile card shows "כבר נלמדו ✓"', ptxt.includes('כבר נלמדו'));

// 4. הטעות חוזרת → מתעוררת (count=3, לא resolved)
await p.evaluate(async () => { const s = await import('./js/store.js'); s.logError({ original: 'I go yesterday', corrected: 'I went yesterday', kind: 'recurring' }); });
m = await mem();
ok('re-logged error wakes up (count=3, unresolved, kind recurring)', m.errors['i go yesterday'].count === 3 && !m.errors['i go yesterday'].resolved && m.errors['i go yesterday'].kind === 'recurring');

// 5. מילים והגייה מהכלים
await p.evaluate(async () => { const s = await import('./js/store.js'); s.logWordUse('appointment', true); s.logWordUse('appointment', false); s.logPronunciation('three', 'sounds like tree', true); });
m = await mem();
ok('word reuse tracked', m.words.appointment.reusedOk === 1 && m.words.appointment.reusedBad === 1);
ok('pronunciation tracked (count 1, improved 1)', m.pronunciation.three.count === 1 && m.pronunciation.three.improved === 1);
pr = await profile();
ok('profile: reuseWords includes teacher-taught word', pr.reuseWords.includes('appointment'));

console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
await b.close();
