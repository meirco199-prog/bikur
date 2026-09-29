// הקורס המובנה בזרימה הטקסטואלית (בלי STT): שיעור 1 אבחון — שקפים מהמורה דרך סמנים,
// חידונים נמדדים על המסך, הערה שקטה למורה, סיום → פרופיל לפי מיומנות + שיעור 2 מוכן.
import { chromium } from 'playwright';
import { driveQuiz, atMost } from './quiz-driver.mjs';
const SHOTS = (process.env.SHOTS || '/tmp/english-shots') + '';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 420, height: 940 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await p.addInitScript(() => { try { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; } catch {} });

await p.goto('http://localhost:8901/english/');
await p.evaluate(() => localStorage.setItem('english-app-v1', JSON.stringify({
  version: 1, profile: { name: 'מאיר', level: 'B2', onboarded: true, minutesPerDay: 10, createdAt: '2026-09-29' },
  settings: { aiUrl: 'http://localhost:8902', liveUrl: 'http://localhost:8902', realtime: false, notifs: false, voiceRate: 1 },
})));
await p.reload(); await p.waitForTimeout(400);

// בית: כרטיס "השיעור הבא שלך" מוכן מראש (Lesson 1, אבחון)
const home = await p.locator('.screen').textContent();
console.log('1 home next-lesson card:', /Lesson 1 — Getting to know you/.test(home) && home.includes('שיעור היכרות ואבחון') ? 'OK' : 'FAIL');
await p.locator('.next-lesson').click(); await p.waitForTimeout(300);

// טרום-שיעור: כרטיס השיעור, תזמון, מורה
const pre = await p.locator('.screen').textContent();
console.log('2 pre-call lesson card + goals:', pre.includes('Lesson 1') && pre.includes('לקבוע רמת התחלה') && pre.includes('שקפים') ? 'OK' : 'FAIL');
await p.locator('select.sched-sel').selectOption('2'); await p.waitForTimeout(150);
await p.locator('input.sched-time').fill('19:30'); await p.locator('input.sched-time').dispatchEvent('change'); await p.waitForTimeout(150);
await p.locator('.chip-btn:has-text("45 דק")').click(); await p.waitForTimeout(150);
await p.locator('.teacher-card:has-text("David")').click(); await p.waitForTimeout(150);
const st1 = await p.evaluate(() => JSON.parse(localStorage.getItem('english-app-v1')).course);
console.log('3 schedule saved (Tue 19:30, 45min, david):', st1.schedule?.weekday === 2 && st1.schedule?.time === '19:30' && st1.schedule?.durationMin === 45 && st1.next?.teacherId === 'david' && st1.next?.durationMin === 45 ? 'OK' : 'FAIL ' + JSON.stringify(st1.schedule));
console.log('   next date shown:', (await p.locator('.screen').textContent()).match(/(היום|יום שלישי) · 19:30/) ? 'OK' : 'FAIL');
await p.screenshot({ path: SHOTS + '/100-course-precall.png' });

await p.locator('button:has-text("התחל את שיעור 1")').click();
// המורה פותח דרך ה-AI עם סמני שקפים → השקף מתעדכן (2 = Tell me about yourself)
await p.waitForFunction(() => /שקף 2\//.test(document.querySelector('.slides-head')?.textContent || ''), { timeout: 15000 }).catch(() => {});
const head = await p.locator('.slides-head').textContent();
console.log('4 teacher moved to slide 2 via marker:', /שקף 2\/\d+/.test(head) ? 'OK' : 'FAIL ' + head);
const cap = await p.locator('.cap-teacher').textContent();
console.log('   markers stripped from caption:', !cap.includes('[[') && cap.includes('Hi Meir') ? 'OK' : 'FAIL ' + cap);
console.log('   slide content shown:', (await p.locator('.slide').textContent()).includes('Tell me about yourself') ? 'OK' : 'FAIL');
await p.screenshot({ path: SHOTS + '/101-course-slide2.png' });

// התלמיד עונה בהקלדה → המורה עובר לשקף 3 (חידון ראשון)
await p.waitForFunction(() => !(document.querySelector('.call-status')?.textContent || '').includes('מדבר'), { timeout: 15000 }).catch(() => {});
await p.waitForTimeout(200);
if (!await p.locator('.typed-row.open').count()){ await p.locator('.call-btn:has-text("⌨️")').click(); }
await p.locator('.call-input').fill('I live in Haifa and I work as a developer');
await p.locator('.typed-row button:has-text("שלח")').click();
await p.waitForFunction(() => /שקף 3\//.test(document.querySelector('.slides-head')?.textContent || ''), { timeout: 15000 }).catch(() => {});
console.log('5 slide 3 (quiz) shown:', await p.locator('.slide-quiz').count() ? 'OK' : 'FAIL ' + await p.locator('.slides-head').textContent());
await p.screenshot({ path: SHOTS + '/102-course-quiz.png' });

// תלמיד ברמת B1 אמיתית עונה על התרגיל האדפטיבי (נכון עד B1, שגוי מעל)
const settle = () => p.waitForFunction(() => !(document.querySelector('.call-status')?.textContent || '').includes('מדבר'), { timeout: 15000 }).catch(() => {});
await settle();
const seq = await driveQuiz(p, atMost('B1'), { settle });
const answered = seq.length;
const perSkill = {}; seq.forEach(x => perSkill[x.skill] = (perSkill[x.skill] || 0) + 1);
console.log('6 adaptive quiz answered:', answered >= 8 && answered <= 24 && Object.keys(perSkill).length === 4 ? 'OK (' + answered + ': ' + JSON.stringify(perSkill) + ')' : 'FAIL ' + answered + ' ' + JSON.stringify(perSkill));
console.log('   items went above and below B1 (adaptive):', seq.some(x => x.level === 'B2') && seq.some(x => x.level === 'B1') ? 'OK' : 'FAIL ' + seq.map(x => x.level).join(','));
console.log('   after quizzes → story slide:', (await p.locator('.slide-title').textContent()).includes('Read aloud') ? 'OK' : 'FAIL ' + await p.locator('.slides-head').textContent());
// חזרה לשקף תרגיל שהסתיים: מציג את הרמה שנמדדה
await p.locator('.slides-head button:has-text("הקודם")').click(); await p.waitForTimeout(150);
console.log('   finished quiz slide shows measured level:', /נמדד מ-\d+ פריטים/.test(await p.locator('.slide').textContent()) ? 'OK' : 'FAIL');
await p.locator('.slides-head button:has-text("הבא")').click(); await p.waitForTimeout(150);
await p.locator('.slides-head button:has-text("הקודם")').click(); await p.waitForTimeout(150);

// ניווט ידני של התלמיד לשקף הסיפור
await p.locator('.slides-head button:has-text("הבא")').click(); await p.waitForTimeout(200);
console.log('7 student can move to story slide:', (await p.locator('.slide').textContent()).includes('Read aloud') ? 'OK' : 'FAIL');

// סיום → completeLesson: פרופיל לפי מיומנות (נמדד), שיעור 2 מוכן
await p.locator('.call-btn.end').click();
await p.waitForFunction(() => !!document.querySelector('.skills-grid'), { timeout: 20000 }).catch(() => {});
const sum = await p.locator('.screen').textContent();
console.log('8 summary skills profile:', sum.includes('רמת התחלה לכל מיומנות') ? 'OK' : 'FAIL');
const st2 = await p.evaluate(() => JSON.parse(localStorage.getItem('english-app-v1')));
const sk = st2.course.skills;
console.log('   measured levels B1 (listening/reading/vocab/grammar):', ['listening','reading','vocab','grammar'].every(k => sk[k] === 'B1') ? 'OK' : 'FAIL ' + JSON.stringify(sk));
console.log('   pronunciation not measured:', sk.pronunciation === null && sum.includes('לא נמדד') ? 'OK' : 'FAIL');
console.log('   placement done, lesson 2 ready:', st2.course.placementDone && st2.course.done.length === 1 && st2.course.next?.n === 2 && st2.course.next?.kind === 'lesson' ? 'OK' : 'FAIL ' + JSON.stringify({done: st2.course.done.length, next: st2.course.next?.n}));
console.log('   quiz score in measured list:', /תרגילים קצרים\s*\d+\/\d+ נכון/.test(sum) ? 'OK' : 'FAIL');
console.log('   hebrew share measured:', /עברית בדברי המורה\s*\d+%/.test(sum) ? 'OK' : 'FAIL');
console.log('   next lesson card in summary:', /Lesson 2 — /.test(sum) ? 'OK' : 'FAIL');
console.log('   liveLessons rec has lesson/quiz:', st2.liveLessons?.[0]?.lesson === 1 && st2.liveLessons[0].quiz?.total === answered ? 'OK' : 'FAIL ' + JSON.stringify(st2.liveLessons?.[0]));
console.log('   speaking NOT guessed (teacher gave no assessment):', sk.speaking === null && sum.includes('לא נמדד — המורה לא העריך') ? 'OK' : 'FAIL ' + sk.speaking);
console.log('   profile level = median of measured only (B1):', st2.profile.level === 'B1' ? 'OK' : 'FAIL ' + st2.profile.level);
console.log('   per-skill source shows item count:', /נמדד · \d+ פריטים/.test(sum) ? 'OK' : 'FAIL');
await p.screenshot({ path: SHOTS + '/103-course-summary.png', fullPage: true });

// פרופיל: כרטיס הקורס עם הרמות
await p.locator('.nav-item[data-id="profile"]').click(); await p.waitForTimeout(300);
const prof = await p.locator('.screen').textContent();
console.log('9 profile course card:', prof.includes('הקורס שלך') && prof.includes('1 שיעורים הושלמו') && /הבא: Lesson 2/.test(prof) ? 'OK' : 'FAIL');

// שיעור 2: שקפי חזרה/מילים/סיפור/שאלות/דקדוק/אתגר
const next = st2.course.next;
console.log('10 lesson 2 structure:', next.slides.map(s => s.type).join(',') === 'title,review,vocab,story,questions,grammar,challenge,summary' && next.phases.length === 8 ? 'OK' : 'FAIL ' + next.slides.map(s => s.type).join(','));
console.log('    story band for B1 = B:', next.band === 'B' ? 'OK' : 'FAIL ' + next.band);
console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
await b.close();
