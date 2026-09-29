import { chromium } from 'playwright';
const SHOTS = (process.env.SHOTS || '/tmp/english-shots') + '';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 420, height: 880 } });
// מדמים מכשיר בלי זיהוי דיבור (כמו iPhone) כדי לבדוק את מסלול ההקלדה בצורה דטרמיניסטית
await page.addInitScript(() => { try { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; } catch {} });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:8901/english/');
await page.evaluate(() => localStorage.setItem('english-app-v1', JSON.stringify({
  version: 1,
  profile: {name:'מאיר', level:'B2', onboarded:true, minutesPerDay:10, interests:['tech'], createdAt:'2026-09-29'},
  settings: {theme:'system', aiUrl:'http://localhost:8902', notifs:false, voiceRate:1},
})));
await page.reload(); await page.waitForTimeout(500);

// דיבור → שיעור חי
await page.locator('.nav-item[data-id="speak"]').click(); await page.waitForTimeout(300);
await page.locator('.live-cta').click(); await page.waitForTimeout(400); await page.locator('.chip-btn:has-text("שיחה חופשית")').click(); await page.waitForTimeout(200);
const teacherCards = await page.locator('.teacher-card').count();
const avatars = await page.locator('.teacher-card .ava-svg').count();
console.log('pre-call teacher cards:', teacherCards, 'avatars rendered:', avatars, (teacherCards===2&&avatars===2)?'OK':'FAIL');
await page.screenshot({ path: SHOTS + '/90-precall.png' });

// בחר את דיוויד, נושא עבודה
await page.locator('.teacher-card:has-text("David")').click(); await page.waitForTimeout(150);
await page.locator('.chip-btn:has-text("אנגלית לעבודה")').click(); await page.waitForTimeout(150);
await page.locator('button:has-text("התחל שיחה")').click(); await page.waitForTimeout(800);

// בשיחה: כתובית פתיחה של המורה
const opener = await page.locator('.cap-teacher').textContent();
console.log('opener caption:', JSON.stringify(opener.slice(0,60)), opener.includes('David')?'OK':'?');
const callAvatar = await page.locator('.teacher-tile .ava-svg').count();
console.log('in-call avatar present:', callAvatar ? 'OK' : 'FAIL');
await page.waitForTimeout(500);
await page.screenshot({ path: SHOTS + '/91-incall.png' });

// פתח מקלדת אם צריך, וכתוב תשובה — אחרי שהפתיחה הסתיימה והתור מוכן
await page.waitForFunction(() => {
  const s = document.querySelector('.call-status');
  return s && !s.textContent.includes('מדבר');
}, { timeout: 15000 }).catch(()=>{});
await page.waitForTimeout(300);
const typedOpen = await page.locator('.typed-row.open').count();
if (!typedOpen){ await page.locator('.call-btn:has-text("⌨️")').click(); await page.waitForTimeout(200); }
await page.locator('.call-input').fill('I work as a developer at a tech company');
await page.locator('.typed-row button:has-text("שלח")').click();
console.log('sent typed answer');
// המורה עונה (mock) — נחכה שהכתובית תהפוך לתשובת המורה
await page.waitForFunction(() => {
  const c = document.querySelector('.cap-teacher');
  return c && c.textContent.includes('order');
}, { timeout: 15000 }).catch(()=>{});
const reply = await page.locator('.cap-teacher').textContent();
console.log('teacher reply caption:', JSON.stringify(reply.slice(0,60)), reply.includes('order')?'OK(mock reply)':'FAIL');
const userCap = await page.locator('.cap-user').textContent();
console.log('user caption echoed:', JSON.stringify(userCap.slice(0,50)));

// סיים שיעור → סיכום
await page.locator('.call-btn.end').click();
await page.waitForTimeout(2500);
const summary = await page.locator('h2').first().textContent().catch(()=> '?');
const scoreCards = await page.locator('.stats-grid .stat-card').count();
console.log('summary heading:', JSON.stringify(summary), 'score cards:', scoreCards);
await page.screenshot({ path: SHOTS + '/92-summary.png' });

// ניקוי: עזיבה בזמן שיחה לא משאירה טיימר/מצלמה
await page.locator('button:has-text("שיעור נוסף")').click().catch(()=>{});
await page.waitForTimeout(300);
await page.locator('button:has-text("התחל שיחה")').click().catch(()=>{});
await page.waitForTimeout(500);
await page.locator('.nav-item[data-id="home"]').click(); // עזיבה מיידית
await page.waitForTimeout(300);
const leaked = await page.evaluate(() => !!window.__liveTeardown);
console.log('teardown cleared after leaving call:', leaked ? 'FAIL(leak)' : 'OK');

console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
