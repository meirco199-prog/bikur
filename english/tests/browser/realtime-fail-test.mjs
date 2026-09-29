// realtime מוגדר אבל החיבור ל-OpenAI נכשל (ה-SDP נדחה) → נופלים לזרימה הרגילה, והתג אומר "זרימה רגילה" —
// לא מציגים realtime כשהוא לא עובד. mock ב-LIVE_MODE=on עם SDP_FAIL=1.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 420, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(() => {
  try { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; } catch {}
  navigator.mediaDevices = navigator.mediaDevices || {};
  navigator.mediaDevices.getUserMedia = async () => new MediaStream();
  class FakeDC { constructor(){ this.readyState = 'connecting'; window.__dc = this; } send(){} close(){ this.readyState = 'closed'; } addEventListener(){} }
  class FakePC { constructor(){ this.connectionState = 'new'; window.__pc = this; } createDataChannel(){ return new FakeDC(); } addTrack(){} async createOffer(){ return { type: 'offer', sdp: 'v=0 fake' }; } async setLocalDescription(){} async setRemoteDescription(){} addEventListener(){} close(){ this.closed = true; } }
  window.RTCPeerConnection = FakePC;
});
await p.goto('http://localhost:8901/english/');
await p.evaluate(() => localStorage.setItem('english-app-v1', JSON.stringify({
  version: 1, profile: { name: 'מאיר', level: 'B2', onboarded: true, minutesPerDay: 10, createdAt: '2026-09-29' },
  settings: { aiUrl: 'http://localhost:8902', liveUrl: 'http://localhost:8902', realtime: true, notifs: false, voiceRate: 1 },
})));
await p.reload(); await p.waitForTimeout(400);
await p.locator('.nav-item[data-id="speak"]').click(); await p.waitForTimeout(200);
await p.locator('.live-cta').click(); await p.waitForTimeout(300); await p.locator('.chip-btn:has-text("שיחה חופשית")').click(); await p.waitForTimeout(200);
await p.locator('button:has-text("התחל שיחה")').click();
await p.waitForFunction(() => document.querySelector('.mode-badge') && !document.querySelector('.mode-badge.connecting'), { timeout: 20000 }).catch(() => {});
const badge = await p.locator('.mode-badge').textContent();
console.log('1 SDP rejected → badge says FALLBACK, not realtime:', badge.includes('זרימה רגילה') && await p.locator('.mode-badge.fallback').count() ? 'OK' : 'FAIL ' + badge);
console.log('   webrtc cleaned up after failure:', await p.evaluate(() => window.__pc?.closed === true) ? 'OK' : 'FAIL');
await p.waitForFunction(() => (document.querySelector('.cap-teacher')?.textContent || '').includes('Sarah'), { timeout: 15000 }).catch(() => {});
console.log('   lesson continues in the regular flow (teacher opener):', (await p.locator('.cap-teacher').textContent()).includes("I'm Sarah") ? 'OK' : 'FAIL');
console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
await b.close();
