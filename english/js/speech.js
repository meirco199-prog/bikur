// עטיפות לדיבור: Text-to-Speech (הקראה) ו-Speech-to-Text (זיהוי דיבור) של הדפדפן.
// עובד ללא שרת — ב-Chrome/Edge/Android מלא; ב-iOS Safari הקראה עובדת, זיהוי חלקי.
import { S } from "./store.js";

let voices = [];
function loadVoices(){
  voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith("en"));
}
if ("speechSynthesis" in window){
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

function bestVoice(){
  const prefs = ["Google US English", "Samantha", "Microsoft Aria", "Microsoft Zira", "Daniel"];
  for (const p of prefs){
    const v = voices.find(v => v.name.includes(p));
    if (v) return v;
  }
  return voices.find(v => v.lang === "en-US") || voices[0] || null;
}

export function ttsSupported(){ return "speechSynthesis" in window; }

export function speak(text, {rate = null, onend = null} = {}){
  if (!ttsSupported()) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  const v = bestVoice();
  if (v) u.voice = v;
  u.rate = rate ?? (S.settings.voiceRate || 1);
  if (onend) u.onend = onend;
  speechSynthesis.speak(u);
  return true;
}

export function stopSpeaking(){ if (ttsSupported()) speechSynthesis.cancel(); }

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export function sttSupported(){ return !!SR; }

// מאזין חד-פעמי: מחזיר Promise עם הטקסט שזוהה. onPartial מקבל תוצאות ביניים.
export function listen({onPartial = null, lang = "en-US", timeoutMs = 15000} = {}){
  return new Promise((resolve, reject) => {
    if (!SR) return reject(new Error("no-stt"));
    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let final = "";
    let done = false;
    const timer = setTimeout(() => { try { rec.stop(); } catch {} }, timeoutMs);
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++){
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) final += t + " ";
        else interim += t;
      }
      if (onPartial) onPartial((final + interim).trim());
    };
    rec.onerror = (ev) => {
      clearTimeout(timer);
      if (done) return; done = true;
      if (ev.error === "no-speech" || ev.error === "aborted") resolve("");
      else reject(new Error(ev.error));
    };
    rec.onend = () => {
      clearTimeout(timer);
      if (done) return; done = true;
      resolve(final.trim());
    };
    try { rec.start(); } catch (e) { reject(e); }
  });
}
