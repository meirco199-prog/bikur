// בדיקת smoke אמיתית (on-demand, עולה כסף — שניות בודדות) מול OpenAI Realtime GA דרך ה-Worker.
// מדפיסה הוכחות: המודל בפועל, session id, אירועי GA שהתקבלו, ו-status של endpoint ה-WebRTC.
// הרצה: LIVE_URL=https://english-live.meirco199.workers.dev node english/tests/smoke/realtime-smoke.mjs
// (דורש `npm i ws` — ה-WebSocket המובנה של node לא מאפשר כותרת Authorization.)
import WebSocket from 'ws';
const LIVE_URL = (process.env.LIVE_URL || 'https://english-live.meirco199.workers.dev').replace(/\/+$/, '');
const log = (k, v) => console.log(`${k.padEnd(34)} ${v}`);
const fail = (m) => { console.error('SMOKE FAILED: ' + m); process.exit(1); };
const t0 = Date.now();

// 1. Worker health (בלי סודות)
const health = await (await fetch(LIVE_URL + '/health')).json().catch(() => null);
log('worker /health', JSON.stringify(health));
if (!health?.configured) fail('Worker reports no OPENAI_API_KEY (configured=false)');

// 2. client secret במבנה GA
const sres = await fetch(LIVE_URL + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ teacherId: 'sarah', teacher: 'Sarah', studentName: 'Smoke', profile: { level: 'B2' }, topic: 'smoke test' }) });
const sess = await sres.json().catch(() => ({}));
log('worker /session status', sres.status);
log('api', sess.api);
log('model (from OpenAI session)', sess.model);
log('client_secret', sess.client_secret ? `${sess.client_secret.slice(0, 3)}…(${sess.client_secret.length} chars), expires_at=${sess.expires_at}` : 'MISSING');
log('models tried before success', JSON.stringify(sess.tried || []));
log('webrtc_url', sess.webrtc_url);
if (!sres.ok || !sess.client_secret) fail('no client secret: ' + JSON.stringify(sess));

// 3. חיבור אמיתי ל-OpenAI עם ה-client secret (WebSocket — אותו session, אותם אירועי GA)
const wsUrl = 'wss://api.openai.com/v1/realtime?model=' + encodeURIComponent(sess.model);
const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${sess.client_secret}` } });
const seen = [];
let sessionId = null, sessionModel = null, text = '';
const done = new Promise((res, rej) => {
  const timer = setTimeout(() => rej(new Error('timeout waiting for events; seen=' + seen.join(','))), 25000);
  ws.on('open', () => log('websocket', 'open (' + (Date.now() - t0) + ' ms)'));
  ws.on('message', (buf) => {
    let e; try { e = JSON.parse(buf.toString()); } catch { return; }
    if (!seen.includes(e.type)) seen.push(e.type);
    if (e.type === 'session.created'){
      sessionId = e.session?.id; sessionModel = e.session?.model;
      log('session.created', `id=${sessionId} model=${sessionModel} (${Date.now() - t0} ms)`);
      // בקשה טקסטואלית קצרה — מוכיחה שהמודל עונה דרך ה-session הזה (זול: בלי אודיו)
      ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Reply with exactly three words: smoke test ok' }] } }));
      ws.send(JSON.stringify({ type: 'response.create', response: { output_modalities: ['text'], instructions: 'Reply in three words.' } }));
    }
    if (e.type === 'response.output_text.delta') text += e.delta || '';
    if (e.type === 'response.done'){ clearTimeout(timer); res(); }
    if (e.type === 'error'){ clearTimeout(timer); rej(new Error('server error: ' + JSON.stringify(e.error))); }
  });
  ws.on('error', (err) => { clearTimeout(timer); rej(err); });
  ws.on('close', (code, reason) => log('websocket close', `${code} ${reason}`));
});
try { await done; } catch (e){ log('events seen', seen.join(', ')); fail(e.message); }
ws.close();
log('model response (text)', JSON.stringify(text.trim()));
log('GA events seen', seen.join(', '));
if (!sessionId) fail('no session.created');
if (!seen.includes('response.done')) fail('no response.done');

// 4. endpoint ה-WebRTC: SDP מינימלי (לא תקין בכוונה) → מצפים ל-400 (הבקשה נבדקה) ולא 401/404 (auth/endpoint)
const sdpRes = await fetch(sess.webrtc_url, { method: 'POST', headers: { Authorization: `Bearer ${sess.client_secret}`, 'Content-Type': 'application/sdp' }, body: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' });
const sdpBody = (await sdpRes.text()).slice(0, 200);
log('POST /v1/realtime/calls status', `${sdpRes.status} (401=bad auth, 404=wrong endpoint; anything else = endpoint+auth accepted)`);
log('calls response head', JSON.stringify(sdpBody));
if (sdpRes.status === 401 || sdpRes.status === 404) fail('WebRTC calls endpoint rejected auth/endpoint');

console.log(`\nSMOKE OK — model=${sessionModel || sess.model}, session=${sessionId}, total ${Date.now() - t0} ms`);
