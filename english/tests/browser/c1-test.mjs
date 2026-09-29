// תלמיד C1/C2 באבחון: הרמה חייבת להגיע ל-C2 בכל המיומנויות; תקלה אחת לא מזיזה רמה;
// דיבור בלי הערכת מורה נשאר "לא נמדד"; הרמה הכללית = חציון הנמדד בלבד.
import { chromium } from 'playwright';
import { driveQuiz, atMost, LV } from './quiz-driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 420, height: 940 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(() => { try { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; } catch {} });
await p.goto('http://localhost:8901/english/');
await p.evaluate(() => localStorage.setItem('english-app-v1', JSON.stringify({
  version: 1, profile: { name: 'מאיר', level: 'C1', onboarded: true, minutesPerDay: 10, createdAt: '2026-09-29' },
  settings: { aiUrl: 'http://localhost:8902', liveUrl: 'http://localhost:8902', realtime: false, notifs: false, voiceRate: 1 },
})));
await p.reload(); await p.waitForTimeout(400);
await p.locator('.next-lesson').click(); await p.waitForTimeout(300);
await p.locator('button:has-text("התחל את שיעור 1")').click();
const settle = () => p.waitForFunction(() => !(document.querySelector('.call-status')?.textContent || '').includes('מדבר'), { timeout: 15000 }).catch(() => {});
await p.waitForFunction(() => /שקף 2\//.test(document.querySelector('.slides-head')?.textContent || ''), { timeout: 15000 }).catch(() => {});
await settle();
if (!await p.locator('.typed-row.open').count()){ await p.locator('.call-btn:has-text("⌨️")').click(); }
await p.locator('.call-input').fill('I have been working as a senior engineer for a decade');
await p.locator('.typed-row button:has-text("שלח")').click();
await p.waitForFunction(() => /שקף 3\//.test(document.querySelector('.slides-head')?.textContent || ''), { timeout: 15000 }).catch(() => {});
await settle();
console.log('1 placement starts at the declared level (C1):', /רמה C1/.test(await p.locator('.slide-quiz').textContent()) ? 'OK' : 'FAIL ' + await p.locator('.slide-quiz .muted').first().textContent());

// מדיניות: תלמיד C2 אמיתי בשמיעה ובמילים; בקריאה — C1 אמיתי עם תקלה אחת (שגוי בפריט C1 הראשון);
// בדקדוק — B2 אמיתי עם ניחוש נכון אחד ב-C1
const policy = (skill, level, n) => {
  if (skill === 'reading'){ if (n === 1 && level === 'C1') return false; return atMost('C1')(skill, level); }
  if (skill === 'grammar'){ if (level === 'C1' && n === 2) return true; return atMost('B2')(skill, level); }
  return true;
};
const seq = await driveQuiz(p, policy, { settle });
const by = sk => seq.filter(x => x.skill === sk).map(x => x.level + (x.correct ? '✓' : '✗')).join(' ');
await p.locator('.call-btn.end').click();
await p.waitForFunction(() => !!document.querySelector('.skills-grid'), { timeout: 20000 }).catch(() => {});
const sum = await p.locator('.screen').textContent();
const st = await p.evaluate(() => JSON.parse(localStorage.getItem('english-app-v1')));
const sk = st.course.skills;
console.log('2 listening reaches C2:', sk.listening === 'C2' ? 'OK' : 'FAIL ' + sk.listening, '|', by('listening'));
console.log('   vocab reaches C2:', sk.vocab === 'C2' ? 'OK' : 'FAIL ' + sk.vocab, '|', by('vocab'));
console.log('3 reading: one accidental wrong at C1 does not drop the level:', sk.reading === 'C1' ? 'OK' : 'FAIL ' + sk.reading, '|', by('reading'));
console.log('4 grammar: one lucky guess at C1 does not raise the level:', sk.grammar === 'B2' ? 'OK' : 'FAIL ' + sk.grammar, '|', by('grammar'));
console.log('5 speaking not measured (no teacher assessment):', sk.speaking === null && sum.includes('לא נמדד — המורה לא העריך') ? 'OK' : 'FAIL ' + sk.speaking);
console.log('   profile level = median of measured (C1/C2 → C1 or C2):', ['C1', 'C2'].includes(st.profile.level) ? 'OK (' + st.profile.level + ')' : 'FAIL ' + st.profile.level);
console.log('   total items reasonable (≤24):', seq.length <= 24 ? 'OK (' + seq.length + ')' : 'FAIL ' + seq.length);
console.log('   lesson 2 story band C for C1 reader:', st.course.next?.band === 'C' ? 'OK' : 'FAIL ' + st.course.next?.band);
console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
await b.close();
