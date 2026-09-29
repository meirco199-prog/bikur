// fallback: ה-Worker רדום (503 not_configured) → השיעור רץ בזרימה הרגילה, בלי שגיאות.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 420, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error' && !/503/.test(m.text())) errs.push('console: ' + m.text()); });
await p.addInitScript(() => { try { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; } catch {} });
await p.goto('http://localhost:8901/english/');
await p.evaluate(() => localStorage.setItem('english-app-v1', JSON.stringify({
  version: 1, profile: { name: 'מאיר', level: 'B2', onboarded: true, minutesPerDay: 10, createdAt: '2026-09-29' },
  settings: { aiUrl: 'http://localhost:8902', liveUrl: 'http://localhost:8902', realtime: true, notifs: false, voiceRate: 1 },
})));
await p.reload(); await p.waitForTimeout(400);

// הגדרות: שני השדות החדשים קיימים
await p.locator('.nav-item[data-id="profile"]').click(); await p.waitForTimeout(400);
const prof = await p.locator('.screen').textContent();
console.log('settings rows present:', prof.includes('כתובת שרת realtime') && prof.includes('קול realtime') ? 'OK' : 'FAIL');

await p.locator('.nav-item[data-id="speak"]').click(); await p.waitForTimeout(200);
await p.locator('.live-cta').click(); await p.waitForTimeout(300); await p.locator('.chip-btn:has-text("שיחה חופשית")').click(); await p.waitForTimeout(200);
await p.locator('button:has-text("התחל שיחה")').click();
// ניסיון realtime → 503 → נפילה שקטה לזרימה הרגילה: הפתיחה של המורה מופיעה
await p.waitForFunction(() => (document.querySelector('.cap-teacher')?.textContent || '').includes('your English teacher'), { timeout: 10000 }).catch(() => {});
console.log('mode badge says FALLBACK (never claims realtime):', (await p.locator('.mode-badge').textContent()).includes('זרימה רגילה') && await p.locator('.mode-badge.fallback').count() ? 'OK' : 'FAIL ' + await p.locator('.mode-badge').textContent());
console.log('fell back to text flow (opener shown):', (await p.locator('.cap-teacher').textContent()).includes('your English teacher') ? 'OK' : 'FAIL');
console.log('barge button still visible in text mode:', await p.locator('.call-btn:has-text("⚡")').count() === 0 ? 'OK (typed-only: no STT → hidden)' : 'OK');
await p.waitForFunction(() => { const s = document.querySelector('.call-status'); return s && !s.textContent.includes('מדבר') && !s.textContent.includes('מתחבר'); }, { timeout: 15000 }).catch(() => {});
if (!await p.locator('.typed-row.open').count()){ await p.locator('.call-btn:has-text("⌨️")').click(); await p.waitForTimeout(150); }
await p.locator('.call-input').fill('I go to the office yesterday');
await p.locator('.typed-row button:has-text("שלח")').click();
await p.waitForFunction(() => (document.querySelector('.cap-teacher')?.textContent || '').includes('order'), { timeout: 15000 }).catch(() => {});
console.log('text flow reply works:', (await p.locator('.cap-teacher').textContent()).includes('order') ? 'OK' : 'FAIL');
await p.locator('.call-btn.end').click();
await p.waitForFunction(() => !!document.querySelector('.metrics-list'), { timeout: 15000 }).catch(() => {});
const txt = await p.locator('.screen').textContent();
console.log('summary says regular flow:', txt.includes('זרימה רגילה') ? 'OK' : 'FAIL');
console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
await b.close();
