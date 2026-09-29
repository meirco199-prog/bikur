// תזכורת אמיתית לשיעור שנקבע: הרשאה → תזמון → המצב מגיע ל-IndexedDB (ל-SW) ולשרת ה-push (lesson),
// והטיימר המקומי מציג התראה 10 דקות לפני. SW/מנוי push מזויפים (אין push service ב-headless).
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 420, height: 940 }, permissions: ['notifications'] });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(() => {
  try { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; } catch {}
  window.__notifs = [];
  const sub = { endpoint: 'https://push.example/sub-1', toJSON(){ return { endpoint: this.endpoint, keys: { p256dh: 'x', auth: 'y' } }; }, async unsubscribe(){ return true; } };
  const reg = {
    async showNotification(title, opts){ window.__notifs.push({ title, body: opts?.body, tag: opts?.tag, url: opts?.data?.url }); },
    pushManager: { async getSubscription(){ return sub; }, async subscribe(){ return sub; } },
    addEventListener(){}, update(){}, active: {}, installing: null, waiting: null,
  };
  const fakeSW = { ready: Promise.resolve(reg), async register(){ return reg; }, async getRegistration(){ return reg; }, addEventListener(){}, controller: null };
  Object.defineProperty(navigator, 'serviceWorker', { value: fakeSW, configurable: true });
});
await p.goto('http://localhost:8901/english/');
await p.evaluate(() => localStorage.setItem('english-app-v1', JSON.stringify({
  version: 1, profile: { name: 'מאיר', level: 'B2', onboarded: true, minutesPerDay: 10, createdAt: '2026-09-29', reminderTime: '20:00' },
  settings: { aiUrl: 'http://localhost:8902', liveUrl: 'http://localhost:8902', pushUrl: 'http://localhost:8902', realtime: false, notifs: false, voiceRate: 1 },
})));
await p.reload(); await p.waitForTimeout(400);

// 1. בלי התראות: מסך התזמון לא מבטיח תזכורת
await p.locator('.next-lesson').click(); await p.waitForTimeout(300);
const now = new Date();
const target = new Date(now.getTime() + 11 * 60000);
const hhmm = `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;
await p.locator('select.sched-sel').selectOption(String(now.getDay())); await p.waitForTimeout(150);
await p.locator('input.sched-time').fill(hhmm); await p.locator('input.sched-time').dispatchEvent('change'); await p.waitForTimeout(200);
let txt = await p.locator('.sched-status').textContent();
console.log('1 notifications off → clearly says no reminder will come:', txt.includes('ההתראות כבויות') && txt.includes('לא תגיע תזכורת') && await p.locator('button:has-text("הפעל התראות לשיעור")').count() ? 'OK' : 'FAIL ' + txt);

// 2. מפעילים התראות מתוך מסך התזמון → הרשאה + רישום לשרת עם השיעור
await p.locator('button:has-text("הפעל התראות לשיעור")').click();
await p.waitForFunction(() => document.querySelector('.sched-status') && !document.querySelector('.sched-status')?.classList.contains('warn'), { timeout: 15000 }).catch(() => {});
txt = await p.locator('.sched-status').textContent();
console.log('2 status now promises only what works (10 min before, push if registered):', txt.includes('10 דקות לפני') && !txt.includes('כבויות') ? 'OK' : 'FAIL ' + txt);
await p.waitForTimeout(500);
const subs = await (await fetch('http://localhost:8902/subs')).json();
const last = subs[subs.length - 1];
console.log('3 push server received the lesson schedule:', last?.lesson?.weekday === now.getDay() && last.lesson.time === hhmm && /Sarah/.test(last.lesson.title) ? 'OK' : 'FAIL ' + JSON.stringify(last?.lesson));
const idb = await p.evaluate(() => new Promise(res => { const r = indexedDB.open('english-reminder', 1); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => res(g.result); }; r.onerror = () => res(null); }));
console.log('   SW state (IndexedDB) has the lesson:', idb?.enabled && idb.lesson?.time === hhmm ? 'OK' : 'FAIL ' + JSON.stringify(idb));

// 3. הטיימר המקומי: 10 דקות לפני השיעור (= בתוך הדקה הקרובה) מוצגת התראה דרך ה-SW
const tWait = Date.now();
const waitErr = await p.waitForFunction(() => window.__notifs.some(n => n.tag === 'lesson-reminder'), undefined, { timeout: 75000 }).then(() => null, e => e.message.split('\n')[0]);
console.log(`   (scheduled ${hhmm}, waited ${Math.round((Date.now() - tWait) / 1000)}s${waitErr ? ', wait error: ' + waitErr : ''})`);
const n = await p.evaluate(() => window.__notifs.find(x => x.tag === 'lesson-reminder'));
console.log('4 lesson reminder shown ~10 min before:', n && n.title.includes(hhmm) && /Sarah/.test(n.body) && n.url === './#/live' ? 'OK' : 'FAIL ' + JSON.stringify(n));
const idb2 = await p.evaluate(() => new Promise(res => { const r = indexedDB.open('english-reminder', 1); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => res(g.result); }; }));
console.log('   marked as notified today (no double reminder):', idb2?.lessonNotifiedOn === new Date().toISOString().slice(0, 10) || idb2?.lessonNotifiedOn ? 'OK' : 'FAIL ' + JSON.stringify(idb2));

// 4. ביטול התזמון (בחר יום ריק) → השרת מקבל lesson=null
await p.locator('select.sched-sel').selectOption(''); await p.waitForTimeout(500);
const subs2 = await (await fetch('http://localhost:8902/subs')).json();
console.log('5 clearing the schedule reaches the server (lesson=null):', subs2[subs2.length - 1]?.lesson === null ? 'OK' : 'FAIL ' + JSON.stringify(subs2[subs2.length - 1]?.lesson));
console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
await b.close();
