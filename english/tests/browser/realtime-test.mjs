// המסלול המלא של ה-realtime עם WebRTC/מיקרופון/AudioContext מזויפים. ה-mock ב-LIVE_MODE=on.
import { chromium } from 'playwright';
const SHOTS = (process.env.SHOTS || '/tmp/english-shots') + '';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 420, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await p.addInitScript(() => {
  try { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; } catch {}
  window.__sent = [];
  // MediaStream אמיתי (ריק) — srcObject מקבל אותו; מיקרופון מזויף בלי מסלולים
  const FakeStream = function(){ return new MediaStream(); };
  navigator.mediaDevices = navigator.mediaDevices || {};
  navigator.mediaDevices.getUserMedia = async () => new MediaStream();
  class FakeDC {
    constructor(){ this.readyState = 'connecting'; this._l = {}; window.__dc = this; }
    send(s){ window.__sent.push(JSON.parse(s)); }
    close(){ this.readyState = 'closed'; }
    addEventListener(n, f){ (this._l[n] = this._l[n] || []).push(f); }
    _open(){ this.readyState = 'open'; (this._l.open || []).forEach(f => f()); this.onopen && this.onopen(); }
    _msg(o){ this.onmessage && this.onmessage({ data: JSON.stringify(o) }); }
  }
  class FakePC {
    constructor(){ this.connectionState = 'new'; this._l = {}; window.__pc = this; }
    createDataChannel(){ return new FakeDC(); }
    addTrack(){}
    async createOffer(){ return { type: 'offer', sdp: 'v=0 fake' }; }
    async setLocalDescription(){}
    async setRemoteDescription(){ setTimeout(() => { this.ontrack && this.ontrack({ streams: [new FakeStream()] }); window.__dc._open(); }, 30); }
    addEventListener(n, f){ (this._l[n] = this._l[n] || []).push(f); }
    close(){ this.closed = true; }
  }
  window.RTCPeerConnection = FakePC;
  class FakeAnalyser { constructor(){ this.fftSize = 512; this.frequencyBinCount = 256; } getByteTimeDomainData(a){ a.fill(160); } }
  window.AudioContext = class { createMediaStreamSource(){ return { connect(){} }; } createAnalyser(){ return new FakeAnalyser(); } close(){} };
});

const msg = (o) => p.evaluate((o) => window.__dc._msg(o), o);
const status = () => p.locator('.call-status').textContent();

await p.goto('http://localhost:8901/english/');
await p.evaluate(() => localStorage.setItem('english-app-v1', JSON.stringify({
  version: 1, profile: { name: 'מאיר', level: 'B2', onboarded: true, minutesPerDay: 10, createdAt: '2026-09-29' },
  settings: { aiUrl: 'http://localhost:8902', liveUrl: 'http://localhost:8902', realtime: true, notifs: false, voiceRate: 1 },
  srs: { appointment: { status: 'learning', step: 0, due: '2026-09-29', ok: 1, fail: 0, saved: false, added: '2026-09-28' } },
})));
await p.reload(); await p.waitForTimeout(400);
await p.locator('.nav-item[data-id="speak"]').click(); await p.waitForTimeout(200);
await p.locator('.live-cta').click(); await p.waitForTimeout(300); await p.locator('.chip-btn:has-text("שיחה חופשית")').click(); await p.waitForTimeout(200);
await p.locator('button:has-text("התחל שיחה")').click();
await p.waitForFunction(() => !!window.__dc && window.__dc.readyState === 'open', { timeout: 10000 }).catch(() => {});
// GA: השרת שולח session.created ברגע שהערוץ נפתח — רק אז האפליקציה נחשבת "מחוברת"
await p.evaluate(() => window.__dc._msg({ type: 'session.created', session: { id: 'sess_fake', model: 'gpt-realtime-2.1-mini', type: 'realtime' } }));
await p.waitForTimeout(300);
const sent0 = await p.evaluate(() => window.__sent);
console.log('1 realtime connected, greeting requested:', sent0.some(s => s.type === 'response.create') ? 'OK' : 'FAIL ' + JSON.stringify(sent0));
console.log('   mode badge = REALTIME CONNECTED with model:', (await p.locator('.mode-badge').textContent()).includes('Realtime · gpt-realtime-2.1-mini') && await p.locator('.mode-badge.realtime').count() ? 'OK' : 'FAIL ' + await p.locator('.mode-badge').textContent());
console.log('   barge button hidden (native VAD):', await p.evaluate(() => { const b = document.querySelector('.call-btn[title="קטיעה באמצע דיבור"]'); return !b || getComputedStyle(b).display === 'none'; }) ? 'OK' : 'FAIL');

// המורה מדבר + כתוביות בזרם
await msg({ type: 'output_audio_buffer.started' });
await msg({ type: 'response.audio_transcript.delta', response_id: 'r1', delta: 'Hi Meir! ' });
await msg({ type: 'response.audio_transcript.delta', response_id: 'r1', delta: 'How was your day?' });
await p.waitForTimeout(100);
console.log('2 teacher speaking status:', (await status()).includes('מדבר') ? 'OK' : 'FAIL ' + await status());
console.log('   streaming caption:', (await p.locator('.cap-teacher').textContent()) === 'Hi Meir! How was your day?' ? 'OK' : 'FAIL');
const mouth = await p.evaluate(() => parseFloat(document.querySelector('.ava-mouth').getAttribute('ry')));
console.log('   lip-sync from audio level (mouth open):', mouth > 2.5 ? 'OK' : 'FAIL ry=' + mouth);

// התלמיד קוטע באמצע → קטיעה אמיתית נספרת
await msg({ type: 'input_audio_buffer.speech_started' });
await p.waitForTimeout(80);
console.log('3 interruption status:', (await status()).includes('קטעת') ? 'OK' : 'FAIL ' + await status());
await msg({ type: 'output_audio_buffer.cleared' });
await msg({ type: 'response.audio_transcript.done', response_id: 'r1', transcript: 'Hi Meir! How was your day?' });
await p.waitForTimeout(700);
await msg({ type: 'input_audio_buffer.speech_stopped' });
await msg({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Wait, what does that mean?' });
await p.waitForTimeout(80);
console.log('4 user transcript caption:', (await p.locator('.cap-user').textContent()) === 'Wait, what does that mean?' ? 'OK' : 'FAIL');

// המורה עונה, ואז תור רגיל (עם זמן תגובה)
await msg({ type: 'output_audio_buffer.started' });
await msg({ type: 'response.audio_transcript.done', response_id: 'r2', transcript: 'It means... Did you have any appointments today?' });
await msg({ type: 'output_audio_buffer.stopped' });
await p.waitForTimeout(600);
await msg({ type: 'input_audio_buffer.speech_started' });
await p.waitForTimeout(1200);
await msg({ type: 'input_audio_buffer.speech_stopped' });
await msg({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Yes, I had an appointment with my dentist' });

// כלים: המורה מדווח — הלקוח שומר ומחזיר תוצאה
await msg({ type: 'response.function_call_arguments.done', call_id: 'c1', name: 'mark_word_used', arguments: JSON.stringify({ word: 'appointment', correct: true }) });
await msg({ type: 'response.function_call_arguments.done', call_id: 'c2', name: 'log_correction', arguments: JSON.stringify({ original: 'I go yesterday', corrected: 'I went yesterday', kind: 'recurring', note_he: 'עבר פשוט' }) });
await msg({ type: 'response.function_call_arguments.done', call_id: 'c3', name: 'pronunciation_note', arguments: JSON.stringify({ word: 'three', issue: 'sounds like tree', improved: true }) });
await msg({ type: 'response.function_call_arguments.done', call_id: 'c4', name: 'lesson_phase', arguments: JSON.stringify({ phase: 'practice' }) });
await p.waitForTimeout(150);
const sent = await p.evaluate(() => window.__sent);
const outputs = sent.filter(s => s.type === 'conversation.item.create' && s.item?.type === 'function_call_output');
console.log('5 tool outputs returned (4):', outputs.length === 4 ? 'OK' : 'FAIL ' + outputs.length);
console.log('   phase shown:', (await status()).includes('תרגול') ? 'OK' : 'FAIL ' + await status());
const store = await p.evaluate(() => JSON.parse(localStorage.getItem('english-app-v1')));
console.log('   word mastery updated (ok=2):', store.srs.appointment.ok === 2 ? 'OK' : 'FAIL ' + JSON.stringify(store.srs.appointment));
console.log('   correction + pronunciation in memory:', store.mistakes.some(m => m.text.includes('I went yesterday')) && store.mistakes.some(m => m.kind === 'pronunciation' && m.text.includes('three')) ? 'OK' : 'FAIL');

// הקלדה בתוך realtime
if (!await p.locator('.typed-row.open').count()){ await p.locator('.call-btn:has-text("⌨️")').click(); await p.waitForTimeout(100); }
await p.locator('.call-input').fill('Can you repeat that?');
await p.locator('.typed-row button:has-text("שלח")').click();
await p.waitForTimeout(100);
const typedSent = await p.evaluate(() => window.__sent.some(s => s.type === 'conversation.item.create' && s.item?.role === 'user'));
console.log('6 typed message routed to realtime:', typedSent ? 'OK' : 'FAIL');

// סיום: המורה מסכם (end_lesson_summary) → סיכום עם "קול realtime", מדדים מ-VAD
const endP = p.locator('.call-btn.end').click();
await p.waitForTimeout(300);
await msg({ type: 'response.function_call_arguments.done', call_id: 'c5', name: 'end_lesson_summary', arguments: JSON.stringify({ improved: 'past tense', weak: 'th sound', next: 'stories in past' }) });
await endP;
await p.waitForFunction(() => !!document.querySelector('.metrics-list'), { timeout: 20000 }).catch(() => {});
const txt = await p.locator('.screen').textContent();
console.log('7 summary mode realtime:', txt.includes('קול realtime') ? 'OK' : 'FAIL');
console.log('   teacher summary card:', txt.includes('past tense') && txt.includes('th sound') ? 'OK' : 'FAIL');
console.log('   interruptions=1:', /קטיעות של המורה\s*1/.test(txt) ? 'OK' : 'FAIL');
console.log('   student time measured (~1s):', /זמן הדיבור שלך\s*[12] שנ'/.test(txt) ? 'OK' : 'FAIL ' + (txt.match(/זמן הדיבור שלך\s*[^\n]{0,12}/) || [''])[0]);
console.log('   latency measured:', txt.includes('זמן תגובה ממוצע') ? 'OK' : 'FAIL');
console.log('   pronunciation still not scored:', txt.includes('לא נמדד') ? 'OK' : 'FAIL');
const closed = await p.evaluate(() => window.__pc.closed && window.__dc.readyState === 'closed');
console.log('8 webrtc cleaned up:', closed ? 'OK' : 'FAIL');
await p.screenshot({ path: SHOTS + '/98-realtime-summary.png' });
console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
await b.close();
