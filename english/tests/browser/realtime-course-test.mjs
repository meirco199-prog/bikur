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

await p.goto('http://localhost:8901/english/');
await p.evaluate(() => localStorage.setItem('english-app-v1', JSON.stringify({
  version: 1, profile: { name: 'מאיר', level: 'B2', onboarded: true, minutesPerDay: 10, createdAt: '2026-09-29' },
  settings: { aiUrl: 'http://localhost:8902', liveUrl: 'http://localhost:8902', realtime: true, notifs: false, voiceRate: 1 },
})));
await p.reload(); await p.waitForTimeout(400);
await p.locator('.next-lesson').click(); await p.waitForTimeout(300);
await p.locator('button:has-text("התחל את שיעור 1")').click();
await p.waitForFunction(() => !!window.__dc && window.__dc.readyState === 'open', { timeout: 10000 }).catch(() => {});
// GA: השרת שולח session.created ברגע שהערוץ נפתח — רק אז האפליקציה נחשבת "מחוברת"
await p.evaluate(() => window.__dc._msg({ type: 'session.created', session: { id: 'sess_fake', model: 'gpt-realtime-2.1-mini', type: 'realtime' } }));
await p.waitForTimeout(300);
// ה-Worker קיבל את תוכנית השיעור (שקפים + שלבים)
const sess = await (await fetch('http://localhost:8902/last-session')).json();
console.log('1 lessonPlan sent to english-live:', /LESSON PLAN — Lesson 1/.test(sess?.lessonPlan || '') && /Slide 3 \[quiz\]/.test(sess.lessonPlan) ? 'OK' : 'FAIL ' + String(sess?.lessonPlan).slice(0, 80));
console.log('   slides panel + slide 1:', /שקף 1\//.test(await p.locator('.slides-head').textContent()) ? 'OK' : 'FAIL');

// המורה מעביר שקף בכלי show_slide → המסך מסונכרן, והתוצאה חוזרת לערוץ
await msg({ type: 'response.function_call_arguments.done', call_id: 'c1', name: 'show_slide', arguments: JSON.stringify({ index: 3 }) });
await p.waitForTimeout(150);
console.log('2 show_slide synced to slide 3 (quiz):', /שקף 3\//.test(await p.locator('.slides-head').textContent()) && await p.locator('.slide-quiz').count() ? 'OK' : 'FAIL');
const out1 = await p.evaluate(() => window.__sent.filter(s => s.type === 'conversation.item.create' && s.item?.type === 'function_call_output').map(s => JSON.parse(s.item.output)));
console.log('   tool output has slide + current adaptive item (say text for the teacher):', out1[0]?.ok && out1[0].slide === 3 && /Current item \(B2\).*READ THIS ALOUD/.test(out1[0].item || '') ? 'OK' : 'FAIL ' + JSON.stringify(out1));

// התלמיד עונה על המסך → הערה שקטה למורה בערוץ (לא תור של התלמיד) + response.create
const a = await p.evaluate(async () => { const q = document.querySelector('.slide-quiz .slide-body').textContent; const m = await import('./js/data/test.js'); return m.BANK.B2.find(x => x.q === q).a; });
await p.locator('.slide-quiz .opt').nth(a).click(); await p.waitForTimeout(100);
const note = await p.evaluate(() => window.__sent.filter(s => s.type === 'conversation.item.create' && s.item?.role === 'user').map(s => s.item.content[0].text).find(t => /Student answered listening item \(B2\)/.test(t)));
console.log('3 quiz note sent to teacher (result + next item):', note && /— correct/.test(note) && /Next listening item \(C1\)/.test(note) ? 'OK' : 'FAIL ' + note);
await p.waitForTimeout(1000);
console.log('   next adaptive item shown on the same slide (level C1):', /שקף 3\//.test(await p.locator('.slides-head').textContent()) && /רמה C1/.test(await p.locator('.slide-quiz').textContent()) ? 'OK' : 'FAIL ' + await p.locator('.slide-quiz .muted').first().textContent());

// שיחה קצרה כדי שיהיה תור של התלמיד
await msg({ type: 'output_audio_buffer.started' });
await msg({ type: 'response.audio_transcript.done', response_id: 'r1', transcript: 'Great. בסדר, let\'s continue. Tell me about your week.' });
await msg({ type: 'output_audio_buffer.stopped' });
await p.waitForTimeout(300);
await msg({ type: 'input_audio_buffer.speech_started' }); await p.waitForTimeout(800);
await msg({ type: 'input_audio_buffer.speech_stopped' });
await msg({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'It was a busy week at work' });

// הערכת המורה בסוף האבחון
await msg({ type: 'response.function_call_arguments.done', call_id: 'c2', name: 'assess_skills', arguments: JSON.stringify({ speaking: 'B2', listening: 'B1', reading: 'B2', vocab: 'B2', grammar: 'B1', pronunciation: 'A1', note_he: 'מדבר יפה' }) });
await p.waitForTimeout(150);
const out2 = await p.evaluate(() => window.__sent.filter(s => s.type === 'conversation.item.create' && s.item?.type === 'function_call_output').map(s => JSON.parse(s.item.output)));
console.log('4 assess_skills recorded (no pronunciation):', out2[1]?.ok && out2[1].recorded.speaking === 'B2' && !('pronunciation' in out2[1].recorded) ? 'OK' : 'FAIL ' + JSON.stringify(out2[1]));

// סיום
const endP = p.locator('.call-btn.end').click();
await p.waitForTimeout(300);
await msg({ type: 'response.function_call_arguments.done', call_id: 'c5', name: 'end_lesson_summary', arguments: JSON.stringify({ improved: 'confidence', weak: 'past tense', next: 'daily routine' }) });
await endP;
await p.waitForFunction(() => !!document.querySelector('.skills-grid'), { timeout: 20000 }).catch(() => {});
const txt = await p.locator('.screen').textContent();
const st = await p.evaluate(() => JSON.parse(localStorage.getItem('english-app-v1')));
console.log('5 speaking from teacher assessment (B2):', st.course.skills.speaking === 'B2' && txt.includes('הערכת המורה') ? 'OK' : 'FAIL ' + JSON.stringify(st.course.skills));
console.log('   listening NOT set from a single answer (needs ≥2, confirmed):', st.course.skills.listening === null && txt.includes('לא נמדד') ? 'OK' : 'FAIL ' + st.course.skills.listening);
console.log('   hebrew share measured from transcript:', st.liveLessons[0].hebrewPct > 0 ? 'OK (' + st.liveLessons[0].hebrewPct + '%)' : 'FAIL ' + st.liveLessons[0].hebrewPct);
console.log('   mode realtime + lesson 2 ready:', st.liveLessons[0].mode === 'realtime' && st.course.next?.n === 2 ? 'OK' : 'FAIL');
console.log('   pronunciation still not measured:', st.course.skills.pronunciation === null ? 'OK' : 'FAIL');
await p.screenshot({ path: SHOTS + '/104-realtime-course-summary.png', fullPage: true });
console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
await b.close();
