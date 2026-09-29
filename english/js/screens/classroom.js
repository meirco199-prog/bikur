// שיעור חי עם מורה AI — כמו שיחת זום. המורה מדבר בקול (השפתיים זזות), מקשיב לך,
// שואל, אתה עונה, והוא מתקן — hands-free. עם חלון "מצלמה" שלך (רשות), כתוביות,
// ובקרות שיחה. נופל יפה להקלדה כשאין זיהוי דיבור, וללא קול כשאין הקראה.
import { el, toast, pick } from "../util.js";
import { S, logDay, skillResult, recordMistake } from "../store.js";
import { speak, stopSpeaking, ttsSupported } from "../speech.js";
import { chat, feedback, aiErrorMessage } from "../ai.js";
import { addXP } from "../gamify.js";
import { createAvatar, TEACHERS } from "../avatar.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const sttOK = !!SR;

const FOCI = [
  {id: "free",   he: "שיחה חופשית",        topic: null,                                                     en: "free conversation"},
  {id: "daily",  he: "אנגלית יומיומית",     topic: "everyday small talk — plans, food, weekend, feelings",    en: "everyday English"},
  {id: "work",   he: "אנגלית לעבודה",       topic: "work English — meetings, emails, small talk with colleagues", en: "English for work"},
  {id: "travel", he: "טיולים",              topic: "travel English — airport, hotel, ordering, directions",   en: "travel English"},
  {id: "words",  he: "חזרה על המילים שלי",  topic: "practice using the words the student has been learning",  en: "your vocabulary"},
];

let session = null;

// ---------- מסך טרום-שיחה: בחירת מורה, נושא, מצלמה ----------
export function renderClassroom(main){
  teardown();
  let teacher = TEACHERS[0];
  let focus = FOCI[0];
  let selfCam = false;

  const teacherRow = el("div", {class: "teacher-pick"});
  const paintTeachers = () => teacherRow.replaceChildren(...TEACHERS.map(t => {
    const av = createAvatar(t);
    const card = el("button", {class: "teacher-card" + (t.id === teacher.id ? " sel" : ""), onclick: () => {
      teacher = t; paintTeachers();
    }}, av.node, el("div", {class: "teacher-name"}, `${t.name} · ${t.he}`));
    return card;
  }));
  paintTeachers();

  const focusChips = el("div", {class: "chips"},
    FOCI.map(f => el("button", {class: "chip-btn" + (f.id === focus.id ? " sel" : ""), onclick: (ev) => {
      focus = f;
      focusChips.querySelectorAll(".chip-btn").forEach(b => b.classList.remove("sel"));
      ev.currentTarget.classList.add("sel");
    }}, f.he)));

  const camToggle = el("button", {class: "btn ghost small", onclick: (ev) => {
    selfCam = !selfCam;
    ev.currentTarget.textContent = selfCam ? "📷 המצלמה שלך: פועלת" : "📷 המצלמה שלך: כבויה";
    ev.currentTarget.classList.toggle("sel-good", selfCam);
  }}, "📷 המצלמה שלך: כבויה");

  main.replaceChildren(el("div", {class: "screen"},
    el("div", {class: "backbar"},
      el("button", {class: "btn ghost small", onclick: () => { location.hash = "#/speak"; }}, "→ חזרה"),
      el("h2", {}, "שיעור חי בזום")),
    el("p", {class: "muted"}, "מורה AI שמדבר איתך פנים אל פנים: הוא שואל, אתה עונה בקול, והוא מתקן — בדיוק כמו שיעור פרטי."),

    el("h3", {}, "מי ילמד אותך היום?"),
    teacherRow,

    el("h3", {}, "על מה נדבר?"),
    focusChips,

    el("div", {class: "row spread cam-row"},
      el("span", {class: "muted small-text"}, "רוצה לראות גם את עצמך בפינה?"),
      camToggle),

    sttOK ? null : el("div", {class: "card notice"},
      "בדפדפן הזה אין זיהוי דיבור, אז תענה בהקלדה (המורה עדיין ידבר בקול). לחוויה מלאה עם דיבור — פתח ב-Chrome באנדרואיד או במחשב."),

    el("button", {class: "btn primary big cta", onclick: () => startCall(main, {teacher, focus, selfCam})},
      "🎥 התחל שיעור"),
  ));
}

// ---------- השיחה החיה ----------
function startCall(main, {teacher, focus, selfCam}){
  const avatar = createAvatar(teacher);
  session = {
    main, teacher, focus, avatar,
    messages: [], start: Date.now(), destroyed: false, ending: false,
    muted: false, typedOnly: !sttOK, pendingFinish: null, rec: null,
    timers: [], mouthRAF: null, mouthBoost: 0, camStream: null, emptyCount: 0,
    timerInt: null,
  };
  window.__liveTeardown = teardown;

  const capTeacher = el("div", {class: "cap-teacher", dir: "ltr"});
  const capUser = el("div", {class: "cap-user", dir: "ltr"});
  const statusEl = el("div", {class: "call-status"}, "מתחבר…");
  const timerEl = el("span", {class: "call-timer"}, "0:00");
  const ring = el("div", {class: "speaking-ring"});

  const teacherTile = el("div", {class: "tile teacher-tile"},
    ring, avatar.node, el("div", {class: "tile-name"}, teacher.name));

  const selfTile = el("div", {class: "tile self-tile"},
    el("div", {class: "self-initials"}, (S.profile.name || "את/ה")[0] || "🙂"),
    el("div", {class: "tile-name"}, "את/ה"));

  const input = el("input", {class: "input call-input", dir: "ltr", placeholder: "Type your answer…",
    autocapitalize: "off", autocomplete: "off"});
  const sendTyped = () => {
    const v = input.value.trim();
    if (!v) return;
    input.value = ""; capUser.textContent = v;
    if (session.pendingFinish) session.pendingFinish(v);
  };
  input.addEventListener("keydown", e => { if (e.key === "Enter") sendTyped(); });
  const typedRow = el("div", {class: "typed-row" + (session.typedOnly ? " open" : ""), dir: "ltr"},
    input, el("button", {class: "btn primary small", onclick: sendTyped}, "שלח"));

  const micBtn = el("button", {class: "call-btn mic", onclick: toggleMic}, "🎤");
  const controls = el("div", {class: "call-controls"},
    sttOK ? micBtn : null,
    el("button", {class: "call-btn", title: "שמע שוב", onclick: repeatLast}, "🔁"),
    el("button", {class: "call-btn", title: "מקלדת", onclick: () => typedRow.classList.toggle("open")}, "⌨️"),
    el("button", {class: "call-btn end", title: "סיים שיעור", onclick: endCall}, "✕"));

  main.replaceChildren(el("div", {class: "call"},
    el("div", {class: "call-top"},
      el("div", {class: "call-who"}, `${teacher.name} · המורה שלך`, el("span", {class: "live-dot"}), timerEl),
      statusEl),
    el("div", {class: "call-stage"}, teacherTile, selfTile),
    el("div", {class: "captions"}, capTeacher, capUser),
    typedRow,
    controls));

  session.ui = {capTeacher, capUser, statusEl, ring, micBtn, teacherTile, input, typedRow};

  // טיימר
  session.timerInt = setInterval(() => {
    const s = Math.floor((Date.now() - session.start) / 1000);
    timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);

  if (selfCam) startCam(selfTile);

  runLesson(focus);
}

function setStatus(text, cls = ""){
  if (!session?.ui) return;
  session.ui.statusEl.textContent = text;
  session.ui.statusEl.className = "call-status " + cls;
  session.ui.teacherTile.classList.toggle("is-speaking", cls === "speaking");
  session.ui.teacherTile.classList.toggle("is-listening", cls === "listening");
}

async function runLesson(focus){
  const opener = openingLine(session.teacher, focus);
  session.messages.push({role: "assistant", content: opener});
  await say(opener);
  while (session && !session.destroyed){
    const userText = await getUserTurn();
    if (!session || session.destroyed) return;
    if (!userText || !userText.trim()){
      session.emptyCount++;
      if (session.emptyCount >= 3){ setStatus("מוכן כשתהיה מוכן — הקש 🎤 או הקלד", ""); continue; }
      await say(pick(["Sorry, I didn't catch that. Could you say it again?",
        "Take your time — tell me in English.", "One more time? I'm listening."]));
      continue;
    }
    session.emptyCount = 0;
    session.messages.push({role: "user", content: userText});
    setStatus(`${session.teacher.name} חושב…`, "thinking");
    session.avatar.setState("thinking");
    let reply;
    try {
      reply = await chat(session.messages.slice(-14), {teacher: session.teacher.name, topic: focus.topic}, "lesson");
    } catch (e){
      toast(aiErrorMessage(e));
      await say("Let's try that again in a moment.");
      continue;
    }
    if (!session || session.destroyed) return;
    session.messages.push({role: "assistant", content: reply});
    await say(reply);
  }
}

// המורה מדבר: כתובית + הנפשת פה + קול. מסתיים ב-onend, בעצירת הדיבור, או בגיבוי.
function say(text){
  if (!session) return Promise.resolve();
  session.ui.capTeacher.textContent = text;
  session.ui.capUser.textContent = "";
  session.avatar.setState("speaking");
  setStatus(`${session.teacher.name} מדבר…`, "speaking");
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      if (session?.sayPoll){ clearInterval(session.sayPoll); session.sayPoll = null; }
      stopMouth();
      if (session && !session.destroyed){ session.avatar.setMouth(0); session.avatar.setState("idle"); }
      resolve();
    };
    startMouth();
    const est = Math.min(16000, 900 + text.length * 60);
    const ok = speak(text, {
      voice: session.teacher.voice,
      onend: finish,
      onboundary: () => { if (session) session.mouthBoost = 1; },
    });
    // בלי קול ממשי (אין voices בדפדפן) — קוצבים לפי זמן קריאה, לא נתקעים
    const silent = !ttsSupported() || (speechSynthesis.getVoices && speechSynthesis.getVoices().length === 0);
    if (!ok || silent){
      session.timers.push(setTimeout(finish, Math.min(8000, 400 + text.length * 38)));
      return;
    }
    // יש קול: מסתמכים על onend, עם גיבוי אם הדיבור נעצר בלי onend, ותקרה קשיחה
    let started = false; const t0 = Date.now();
    session.sayPoll = setInterval(() => {
      if (done) return;
      const sp = speechSynthesis.speaking;
      if (sp) started = true;
      if (started && !sp) finish();
      else if (Date.now() - t0 > est + 6000) finish();
    }, 150);
  });
}

function startMouth(){
  const t0 = performance.now();
  const loop = (t) => {
    if (!session || session.destroyed) return;
    const speaking = ttsSupported() ? speechSynthesis.speaking : false;
    const active = speaking || !ttsSupported();
    let v = 0;
    if (active){
      v = Math.min(1, (0.35 + 0.4 * Math.abs(Math.sin((t - t0) / 95))) * (0.6 + Math.random() * 0.6) + session.mouthBoost);
      session.mouthBoost *= 0.7;
    }
    session.avatar.setMouth(active ? v : 0);
    session.mouthRAF = requestAnimationFrame(loop);
  };
  session.mouthRAF = requestAnimationFrame(loop);
}
function stopMouth(){ if (session?.mouthRAF) cancelAnimationFrame(session.mouthRAF); if (session) session.mouthRAF = null; }

// תור המשתמש: זיהוי דיבור (או הקלדה). נפתר בטקסט, או "" אם היה שקט.
function getUserTurn(){
  return new Promise(resolve => {
    session.pendingFinish = (text) => { session.pendingFinish = null; stopRec(); resolve(text); };
    if (sttOK && !session.muted && !session.typedOnly) startListening();
    else setStatus("הקלד תשובה ושלח 👇", "");
  });
}

function startListening(){
  if (!session || session.destroyed) return;
  session.avatar.setState("listening");
  setStatus("מקשיב לך… דבר עכשיו 🎙️", "listening");
  session.ui.capUser.textContent = "";
  let finalText = "";
  const rec = new SR();
  session.rec = rec;
  rec.lang = "en-US"; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++){
      const tr = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += tr + " "; else interim += tr;
    }
    session.ui.capUser.textContent = (finalText + interim).trim();
  };
  rec.onerror = () => {};
  rec.onend = () => {
    if (!session) return;
    session.rec = null;
    if (session.destroyed || session.muted) return; // הושהה/הסתיים — לא לפתור
    if (session.pendingFinish) session.pendingFinish(finalText.trim());
  };
  try { rec.start(); } catch { if (session?.pendingFinish) session.pendingFinish(""); }
}

function stopRec(){ try { session?.rec?.abort(); } catch {} if (session && session.rec) session.rec = null; }

function toggleMic(){
  if (!session) return;
  session.muted = !session.muted;
  session.ui.micBtn.classList.toggle("muted", session.muted);
  session.ui.micBtn.textContent = session.muted ? "🔇" : "🎤";
  if (session.muted){
    stopRec();
    session.avatar.setState("idle");
    setStatus("מושהה — הקש 🎤 להמשך", "");
  } else if (session.pendingFinish && sttOK && !session.typedOnly){
    startListening();
  }
}

async function repeatLast(){
  if (!session) return;
  const last = [...session.messages].reverse().find(m => m.role === "assistant");
  if (!last) return;
  stopRec();
  await say(last.content);
  if (session && !session.destroyed && session.pendingFinish && sttOK && !session.muted && !session.typedOnly) startListening();
}

async function startCam(tile){
  try {
    const stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: "user"}, audio: false});
    if (!session || session.destroyed){ stream.getTracks().forEach(t => t.stop()); return; }
    session.camStream = stream;
    const v = el("video", {class: "self-video", autoplay: "", playsinline: "", muted: ""});
    v.srcObject = stream;
    tile.replaceChildren(v, el("div", {class: "tile-name"}, "את/ה"));
  } catch { toast("אין גישה למצלמה — נמשיך בלי, זה בסדר גמור"); }
}

// ---------- סיום + משוב ----------
async function endCall(){
  if (!session || session.ending) return;
  session.ending = true;
  const {main, teacher} = session;
  const messages = session.messages.slice();
  const secs = Math.round((Date.now() - session.start) / 1000);
  const userTurns = messages.filter(m => m.role === "user");
  teardown();

  if (userTurns.length === 0){ renderClassroom(main); return; }

  skillResult("speaking", true);
  logDay({speakSec: secs});
  addXP(15 + userTurns.length * 6, "שיעור חי");

  main.replaceChildren(el("div", {class: "screen"},
    el("div", {class: "card center"}, el("div", {class: "muted"}, `${teacher.name} מכין לך סיכום מהשיעור…`))));

  const transcript = messages.map(m => `${m.role === "user" ? "Student" : "Teacher"}: ${m.content}`).join("\n");
  try {
    const fb = await feedback(transcript);
    (fb.mistakes || []).slice(0, 5).forEach(m => recordMistake(`lesson: ${m.original || ""} → ${m.better || ""}`, "speaking"));
    renderSummary(main, fb, secs, userTurns.length, teacher);
  } catch {
    main.replaceChildren(el("div", {class: "screen"},
      el("div", {class: "card center summary"},
        el("div", {class: "summary-emoji"}, "🎓"),
        el("h2", {}, "כל הכבוד על השיעור!"),
        el("p", {class: "muted"}, `דיברת ${userTurns.length} פעמים במשך ${Math.round(secs / 60)} דקות.`),
        el("button", {class: "btn primary big", onclick: () => renderClassroom(main)}, "שיעור נוסף"),
        el("button", {class: "btn ghost", onclick: () => { location.hash = "#/home"; }}, "לדף הבית"))));
  }
}

function renderSummary(main, fb, secs, turns, teacher){
  const sc = fb.scores || {};
  const box = (label, v) => el("div", {class: "card stat-card"},
    el("div", {class: "stat-v"}, typeof v === "number" ? Math.round(v) : "—"),
    el("div", {class: "stat-l"}, label));
  main.replaceChildren(el("div", {class: "screen"},
    el("div", {class: "card center"},
      el("div", {class: "summary-emoji"}, "🎓"),
      el("h2", {}, `סיכום השיעור עם ${teacher.name}`),
      el("p", {class: "muted"}, `${Math.round(secs / 60)} דקות · ${turns} תשובות שלך`)),
    el("div", {class: "stats-grid"},
      box("שטף", sc.fluency), box("הגייה", sc.pronunciation),
      box("אוצר מילים", sc.vocabulary), box("דקדוק", sc.grammar)),
    fb.summary ? el("div", {class: "card"}, el("h3", {}, "מה היה טוב ומה לחזק"), el("p", {}, fb.summary)) : null,
    fb.mistakes?.length ? el("div", {class: "card"},
      el("h3", {}, "תיקונים מהשיעור"),
      el("ul", {class: "fb-list"}, fb.mistakes.map(m => el("li", {},
        el("div", {dir: "ltr", class: "bad-text"}, m.original || ""),
        el("div", {dir: "ltr", class: "good-text"}, m.better || ""),
        m.note ? el("div", {class: "muted small-text"}, m.note) : null)))) : null,
    el("button", {class: "btn primary big", onclick: () => renderClassroom(main)}, "שיעור נוסף"),
    el("button", {class: "btn ghost", onclick: () => { location.hash = "#/home"; }}, "לדף הבית")));
}

// ---------- ניקוי ----------
function teardown(){
  window.__liveTeardown = null;
  if (!session) return;
  session.destroyed = true;
  stopSpeaking();
  stopRec();
  stopMouth();
  if (session.sayPoll) clearInterval(session.sayPoll);
  session.timers.forEach(clearTimeout);
  if (session.timerInt) clearInterval(session.timerInt);
  session.camStream?.getTracks().forEach(t => t.stop());
  session.avatar?.destroy();
  session = null;
}

function openingLine(teacher, focus){
  const topic = focus.id === "free" ? "" :
    ` Today let's practice ${focus.en}.`;
  return `Hi! I'm ${teacher.name}, your English teacher. It's really nice to meet you!${topic} Let's keep it relaxed — just talk with me. So, how are you feeling today?`;
}
