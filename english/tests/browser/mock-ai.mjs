import http from 'http';
// LIVE_MODE=off → /session מחזיר 503 (Worker רדום, בדיקת fallback)
// LIVE_MODE=on  → /session מחזיר session מזויף (בדיקת המסלול המלא עם WebRTC מזויף בדפדפן)
const LIVE = process.env.LIVE_MODE || 'off';
// מורה מדומה לשיעור מובנה: מגיב להערות השקטות עם סמני שקפים/הערכה, כמו הפרומפט האמיתי מבקש
function lessonReply(body){
  const msgs = body.messages || [];
  const last = msgs[msgs.length - 1]?.content || '';
  const plan = body.scenario?.lessonPlan || '';
  if (!plan) return "That sounds great! What would you like to order for the meeting?";
  if (/The lesson is starting/.test(last)) return "[[slide:1]] Hi Meir! Last time we didn't meet yet. Today: getting to know you. [[slide:2]] Tell me about yourself.";
  if (/Time: \d+\/\d+ min — the lesson time is over/.test(last)) return "Great work today. [[skills:speaking=B2,listening=B1,reading=B2,vocab=B2,grammar=B1]] See you next time!";
  if (/Student answered/.test(last)) return "Good, noted. Next one.";
  if (/Reading check/.test(last)) return "Nice reading! [[slide:8]] What do you think about Dana?";
  if (/Student moved to slide/.test(last)) return "Sure, let's look at that one.";
  const assistantTurns = msgs.filter(m => m.role === 'assistant').length;
  if (assistantTurns === 1) return "Nice to meet you! [[slide:3]] Let's do a few short exercises. I'll read one sentence: The shop opens at nine in the morning.";
  return "Interesting! Tell me more.";
}
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.end(); return; }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    let j = {}; try { j = JSON.parse(body || '{}'); } catch {}
    if (req.url === '/health') { res.end(JSON.stringify({ ok: true, configured: LIVE === 'on', api: 'realtime-ga' })); return; }
    if (req.url === '/session') {
      if (LIVE !== 'on') { res.statusCode = 503; res.end('{"error":"not_configured"}'); return; }
      globalThis.__lastSession = j;
      res.end(JSON.stringify({ client_secret: 'ek_fake', expires_at: 0, model: 'gpt-realtime-2.1-mini', voice: 'coral', api: 'realtime-ga', webrtc_url: 'http://localhost:8902/sdp' }));
    }
    else if (req.url === '/last-session') res.end(JSON.stringify(globalThis.__lastSession || null));
    else if (req.url === '/key') res.end(JSON.stringify({ key: 'BPfakeKeyfakeKeyfakeKeyfakeKeyfakeKeyfakeKeyfakeKeyfakeKeyfakeKeyfakeKeyfakeKeyfakeKeyfakeKeyfakeKey' }));
    else if (req.url === '/subscribe') { (globalThis.__subs = globalThis.__subs || []).push(j); res.end('{"ok":true}'); }
    else if (req.url === '/unsubscribe') res.end('{"ok":true}');
    else if (req.url === '/status') res.end(JSON.stringify({ found: true, time: '20:00', enabled: true, lesson: (globalThis.__subs || []).slice(-1)[0]?.lesson || null }));
    else if (req.url === '/subs') res.end(JSON.stringify(globalThis.__subs || []));
    else if (req.url.startsWith('/sdp')) {
      if (process.env.SDP_FAIL) { res.statusCode = 500; res.end('{"error":"sdp rejected"}'); return; } // מדמה כשל בחיבור ל-OpenAI
      res.setHeader('Content-Type', 'application/sdp'); res.setHeader('Location', '/v1/realtime/calls/rtc_fake'); res.end('v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n');
    }
    else if (req.url === '/api/chat') res.end(JSON.stringify({reply: lessonReply(j)}));
    else if (req.url === '/api/feedback') res.end(JSON.stringify({
      summary: "שיעור יפה! שים לב לזמני עבר.",
      mistakes: [{original:"I go yesterday", better:"I went yesterday", note:"Past Simple"}],
      better: ["I'd like to discuss the project."],
      scores: {fluency:80, pronunciation:82, vocabulary:75, grammar:68},
    }));
    else if (req.url === '/api/write') res.end(JSON.stringify({corrected:"x", natural:"y", explanation:"z"}));
    else if (req.url === '/api/say') res.end(JSON.stringify({simple:"a", natural:"b", professional:"c"}));
    else { res.statusCode = 404; res.end('{"error":"not_found"}'); }
  });
}).listen(8902, () => console.log('mock ai on 8902, live=' + LIVE));
