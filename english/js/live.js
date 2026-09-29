// מנוע Realtime לשיעור החי: WebRTC ישירות ל-OpenAI Realtime עם session זמני מה-Worker
// english-live. speech-to-speech אמיתי — latency נמוך, קטיעה מובנית (VAD בשרת), המורה
// שומע את ההגייה. אין מפתח בלקוח: רק client_secret קצר-חיים.
// אם ה-Worker לא מוגדר / WebRTC נכשל — זורק, ו-classroom.js נופל לזרימה הרגילה.
import { S } from "./store.js";
import { learnerProfile } from "./ai.js";

export class LiveError extends Error {}

export function realtimeSupported(){
  return !!(window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia);
}

function liveBase(){ return (S.settings.liveUrl || "").replace(/\/+$/, ""); }

// מבקש session זמני. מחזיר null אם ה-Worker לא מוגדר (fallback שקט), זורק על שגיאה אחרת.
async function fetchSession({ teacher, topic }){
  if (!liveBase()) return null;
  let res;
  try {
    res = await fetch(liveBase() + "/session", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teacherId: teacher.id, teacher: teacher.name, topic: topic || null,
        studentName: S.profile.name || null, profile: learnerProfile(),
      }),
    });
  } catch { return null; } // אין רשת/אין Worker — fallback
  if (res.status === 503) return null;                 // not_configured — fallback
  if (res.status === 429) throw new LiveError("rate");
  if (!res.ok) throw new LiveError("server");
  const d = await res.json();
  if (!d.client_secret) return null;
  return d;
}

// מתחיל שיחת realtime. handlers: onTeacherText(text, done), onUserText(text),
// onTeacherSpeaking(bool), onUserSpeaking(bool), onTool(name, args) -> result, onError(msg)
export async function startLive({ teacher, topic, handlers }){
  if (!realtimeSupported()) return null;
  const sess = await fetchSession({ teacher, topic });
  if (!sess) return null;

  // מיקרופון — אודיו בלבד, עם ביטול הד כדי שהמורה לא ישמע את עצמו מהרמקול
  let mic;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch { throw new LiveError("mic"); }

  const pc = new RTCPeerConnection();
  const audioEl = document.createElement("audio");
  audioEl.autoplay = true; audioEl.setAttribute("playsinline", "");
  document.body.appendChild(audioEl);

  // ניתוח עוצמת הקול של המורה — ללק-סינק אמיתי מהאודיו
  let analyser = null, ctx = null, levelBuf = null;
  pc.ontrack = (e) => {
    // כשל בנגן/מנתח לא מפיל את החיבור — במקרה הגרוע אין לק-סינק, אבל השיעור רץ
    try { audioEl.srcObject = e.streams[0]; } catch {}
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(e.streams[0]);
      analyser = ctx.createAnalyser(); analyser.fftSize = 512;
      src.connect(analyser);
      levelBuf = new Uint8Array(analyser.frequencyBinCount);
    } catch {}
  };
  mic.getTracks().forEach(t => pc.addTrack(t, mic));

  const dc = pc.createDataChannel("oai-events");
  const state = {
    teacherSpeaking: false, userSpeaking: false,
    teacherText: "", teacherTextByResponse: new Map(),
    transcript: [],                       // [{role, content}] — לזיכרון ולמשוב
    metrics: { studentMs: 0, teacherMs: 0, longestMs: 0, latencies: [], interruptions: 0 },
    _userStart: 0, _teacherStart: 0, _teacherStop: 0,
    lessonSummary: null, phase: "opening", closed: false,
  };
  const send = (obj) => { if (dc.readyState === "open") dc.send(JSON.stringify(obj)); };

  dc.onopen = () => {
    // המורה פותח את השיעור מיד — בלי לחכות שהתלמיד ידבר ראשון
    send({ type: "response.create", instructions: "Greet the student warmly by name if you know it, in one or two short sentences. If your instructions mention a last lesson, connect to it in one short sentence. Then ask one easy opening question." });
  };

  dc.onmessage = (ev) => {
    let e; try { e = JSON.parse(ev.data); } catch { return; }
    const h = handlers;
    switch (e.type){
      // --- התלמיד מדבר (VAD בשרת) ---
      case "input_audio_buffer.speech_started": {
        state.userSpeaking = true; state._userStart = Date.now();
        if (state.teacherSpeaking) state.metrics.interruptions++;   // קטיעה אמיתית
        if (state._teacherStop) { const lat = state._userStart - state._teacherStop; if (lat > 0 && lat < 30000) state.metrics.latencies.push(lat); state._teacherStop = 0; }
        h.onUserSpeaking?.(true); break;
      }
      case "input_audio_buffer.speech_stopped": {
        state.userSpeaking = false;
        if (state._userStart){ const d = Date.now() - state._userStart; state.metrics.studentMs += d; state.metrics.longestMs = Math.max(state.metrics.longestMs, d); state._userStart = 0; }
        h.onUserSpeaking?.(false); break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const t = (e.transcript || "").trim();
        if (t){ state.transcript.push({ role: "user", content: t }); h.onUserText?.(t); }
        break;
      }
      // --- המורה מדבר (WebRTC מדווח על תחילת/סוף נגינה) ---
      case "output_audio_buffer.started":
        state.teacherSpeaking = true; state._teacherStart = Date.now(); h.onTeacherSpeaking?.(true); break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared": {
        state.teacherSpeaking = false;
        if (state._teacherStart){ state.metrics.teacherMs += Date.now() - state._teacherStart; state._teacherStart = 0; }
        state._teacherStop = Date.now();
        h.onTeacherSpeaking?.(false); break;
      }
      case "response.audio_transcript.delta": {
        const cur = (state.teacherTextByResponse.get(e.response_id) || "") + (e.delta || "");
        state.teacherTextByResponse.set(e.response_id, cur);
        h.onTeacherText?.(cur, false); break;
      }
      case "response.audio_transcript.done": {
        const t = (e.transcript || state.teacherTextByResponse.get(e.response_id) || "").trim();
        state.teacherTextByResponse.delete(e.response_id);
        if (t){ state.transcript.push({ role: "assistant", content: t }); h.onTeacherText?.(t, true); }
        break;
      }
      // --- כלים: המורה מדווח תיקונים/מילים/הגייה/שלב — הלקוח שומר ומחזיר תוצאה ---
      case "response.function_call_arguments.done": {
        let args = {}; try { args = JSON.parse(e.arguments || "{}"); } catch {}
        let result = { ok: true };
        try { result = h.onTool?.(e.name, args) ?? result; } catch {}
        if (e.name === "lesson_phase" && args.phase) state.phase = args.phase;
        if (e.name === "end_lesson_summary") state.lessonSummary = args;
        send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: e.call_id, output: JSON.stringify(result) } });
        send({ type: "response.create" });
        break;
      }
      case "error":
        h.onError?.(e.error?.message || "realtime error"); break;
    }
  };

  // SDP: הצעה מהדפדפן → OpenAI (עם ה-client_secret הזמני) → תשובה
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  let sdpRes;
  try {
    sdpRes = await fetch(sess.webrtc_url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${sess.client_secret}`, "Content-Type": "application/sdp" },
      body: offer.sdp,
    });
  } catch { cleanup(); throw new LiveError("webrtc"); }
  if (!sdpRes.ok){ cleanup(); throw new LiveError("webrtc"); }
  await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });

  // המתנה שהערוץ ייפתח (עד 8 שניות), אחרת נופלים
  await new Promise((res, rej) => {
    if (dc.readyState === "open") return res();
    const t = setTimeout(() => rej(new LiveError("webrtc")), 8000);
    dc.addEventListener("open", () => { clearTimeout(t); res(); }, { once: true });
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed"){ clearTimeout(t); rej(new LiveError("webrtc")); }
    });
  }).catch(err => { cleanup(); throw err; });

  function cleanup(){
    if (state.closed) return; state.closed = true;
    try { dc.close(); } catch {}
    try { pc.close(); } catch {}
    mic?.getTracks().forEach(t => t.stop());
    try { audioEl.srcObject = null; audioEl.remove(); } catch {}
    try { ctx?.close(); } catch {}
  }

  return {
    state,
    model: sess.model,
    // עוצמת קול המורה 0..1 — ללק-סינק
    level(){
      if (!analyser) return state.teacherSpeaking ? 0.5 : 0;
      analyser.getByteTimeDomainData(levelBuf);
      let sum = 0; for (let i = 0; i < levelBuf.length; i++){ const v = (levelBuf[i] - 128) / 128; sum += v * v; }
      return Math.min(1, Math.sqrt(sum / levelBuf.length) * 6);
    },
    // הודעה בהקלדה (fallback בתוך realtime, למשל בלי מיקרופון פעיל)
    sendText(text){
      state.transcript.push({ role: "user", content: text });
      send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
      send({ type: "response.create" });
    },
    // עצירת המורה באמצע (כפתור) — VAD כבר עושה את זה אוטומטית כשמדברים
    interrupt(){ send({ type: "response.cancel" }); send({ type: "output_audio_buffer.clear" }); },
    mute(on){ mic.getAudioTracks().forEach(t => t.enabled = !on); },
    // בקשה מפורשת לסיכום השיעור מהמורה (לפני הסיום)
    askSummary(){ send({ type: "response.create", instructions: "Give your short end-of-lesson summary now: what improved, what is still weak, what we will practice next time. Then call end_lesson_summary." }); },
    close: cleanup,
  };
}
