// בדיקת barge-in עם SpeechRecognition מזויף שנשלט מהבדיקה.
import { chromium } from 'playwright';
const SHOTS = (process.env.SHOTS || '/tmp/english-shots') + '';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 420, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await p.addInitScript(() => {
  window.__srs = [];
  class FakeSR {
    constructor(){ this.started = false; window.__srs.push(this); }
    start(){ this.started = true; }
    abort(){ this.started = false; const f = this.onend; if (f) setTimeout(() => f(), 0); }
    stop(){ this.abort(); }
    _result(text, isFinal){ const r = { resultIndex: 0, results: [[{ transcript: text }]] }; r.results[0].isFinal = !!isFinal; this.onspeechstart && this.onspeechstart(); this.onresult && this.onresult(r); }
    _end(){ this.started = false; this.onend && this.onend(); }
  }
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
});

const status = () => p.locator('.call-status').textContent();
const lastSR = (fn, ...a) => p.evaluate(([fn, a]) => { const s = window.__srs[window.__srs.length - 1]; return s[fn](...a); }, [fn, a]);
const srCount = () => p.evaluate(() => window.__srs.length);

await p.goto('http://localhost:8901/english/');
await p.evaluate(() => localStorage.setItem('english-app-v1', JSON.stringify({
  version: 1, profile: { name: 'מאיר', level: 'B2', onboarded: true, minutesPerDay: 10, createdAt: '2026-09-29' },
  settings: { aiUrl: 'http://localhost:8902', notifs: false, voiceRate: 1, bargeIn: true },
  liveLessons: [{ date: '2026-09-28', teacher: 'sarah', secs: 600, turns: 5, studentMs: 40000, teacherMs: 60000, longestMs: 12000, avgLatencyMs: 2500, interruptions: 0 }],
})));
await p.reload(); await p.waitForTimeout(400);
await p.locator('.nav-item[data-id="speak"]').click(); await p.waitForTimeout(200);
await p.locator('.live-cta').click(); await p.waitForTimeout(300); await p.locator('.chip-btn:has-text("שיחה חופשית")').click(); await p.waitForTimeout(200);
await p.locator('button:has-text("התחל שיחה")').click(); await p.waitForTimeout(700);

console.log('1 teacher speaking, watcher up:', (await status()).includes('מדבר') && (await srCount()) >= 1 ? 'OK' : 'FAIL ' + await status());
console.log('   barge button present:', await p.locator('.call-btn:has-text("⚡")').count() ? 'OK' : 'FAIL');

// הד של הרמקול — מילים מהמשפט של המורה → צריך להתעלם
await lastSR('_result', "your English teacher it's really nice to meet you", false);
await p.waitForTimeout(150);
console.log('2 echo ignored (still speaking):', (await status()).includes('מדבר') ? 'OK' : 'FAIL ' + await status());

// קטיעה אמיתית
await lastSR('_result', 'wait what does that mean', false);
await p.waitForTimeout(200);
const st = await status();
console.log('3 barge-in stopped teacher:', st.includes('קטעת') ? 'OK' : 'FAIL ' + st);
console.log('   user caption:', JSON.stringify(await p.locator('.cap-user').textContent()));
await p.screenshot({ path: SHOTS + '/96-barge.png' });

// התלמיד מסיים לדבר → אותו מזהה נגמר → התור נשלח ל-AI
await lastSR('_result', 'wait what does that mean', true);
await lastSR('_end');
await p.waitForFunction(() => (document.querySelector('.cap-teacher')?.textContent || '').includes('order'), { timeout: 15000 }).catch(() => {});
console.log('4 reply after barge:', (await p.locator('.cap-teacher').textContent()).includes('order') ? 'OK' : 'FAIL');

// המורה מסיים לדבר רגיל → תור האזנה רגיל
await p.waitForFunction(() => (document.querySelector('.call-status')?.textContent || '').includes('מקשיב לך… דבר עכשיו'), { timeout: 15000 }).catch(() => {});
console.log('5 normal listen turn:', (await status()).includes('מקשיב לך… דבר עכשיו') ? 'OK' : 'FAIL ' + await status());
await p.waitForTimeout(1200); // "חושב" → זמן תגובה נמדד
await lastSR('_result', 'I went to the office and met my boss', true);
await lastSR('_end');
await p.waitForFunction(() => (document.querySelector('.call-status')?.textContent || '').includes('מדבר'), { timeout: 15000 }).catch(() => {});
console.log('6 second reply started:', (await status()).includes('מדבר') ? 'OK' : 'FAIL');

// סיום → סיכום עם מדדים שנמדדו + השוואה לשיעור הקודם
await p.locator('.call-btn.end').click();
await p.waitForFunction(() => !!document.querySelector('.metrics-list'), { timeout: 15000 }).catch(() => {});
const txt = await p.locator('.screen').textContent();
console.log('7 measured card:', txt.includes('מה נמדד בפועל') ? 'OK' : 'FAIL');
console.log('   interruptions=1:', /קטיעות של המורה\s*1/.test(txt) ? 'OK' : 'FAIL');
console.log('   student time measured:', /זמן הדיבור שלך\s*\d+ שנ'/.test(txt) ? 'OK' : 'FAIL');
console.log('   comparison to previous:', txt.includes('מהקודם') || txt.includes('כמו בשיעור הקודם') ? 'OK' : 'FAIL');
console.log('   latency measured:', txt.includes('זמן תגובה ממוצע') ? 'OK' : 'FAIL');
console.log('   pronunciation not measured:', txt.includes('לא נמדד') ? 'OK' : 'FAIL');
const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('english-app-v1')).liveLessons);
console.log('8 lesson record persisted:', stored.length === 2 && stored[1].interruptions === 1 && stored[1].turns === 2 ? 'OK' : 'FAIL ' + JSON.stringify(stored[1]));
await p.screenshot({ path: SHOTS + '/97-metrics-summary.png' });
console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
await b.close();
