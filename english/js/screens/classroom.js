// שיעור חי עם מורה AI — כמו שיחת זום. המורה מדבר בקול (השפתיים זזות), מקשיב לך,
// שואל, אתה עונה, והוא מתקן — hands-free. עם חלון "מצלמה" שלך (רשות), כתוביות,
// ובקרות שיחה. נופל יפה להקלדה כשאין זיהוי דיבור, וללא קול כשאין הקראה.
import { el, toast, pick, todayStr } from "../util.js";
import { S, save, logDay, skillResult, recordMistake } from "../store.js";
import { speak, stopSpeaking, ttsSupported } from "../speech.js";
import { chat, feedback, aiErrorMessage } from "../ai.js";
import { addXP } from "../gamify.js";
import { createAvatar, TEACHERS } from "../avatar.js";
import { startLive, realtimeSupported, LiveError } from "../live.js";
import { review } from "../srs.js";
import { WORDS, wordKey } from "../data/words.js";

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
    muted: false, typedOnly: !sttOK, pendingFinish: null, rec: null, recRole: null,
    timers: [], mouthRAF: null, mouthBoost: 0, camStream: null, emptyCount: 0,
    timerInt: null,
    // קטיעה (barge-in): מזהה-דיבור "צופה" רץ בזמן שהמורה מדבר; דיבור אמיתי עוצר את המורה
    bargeIn: sttOK && S.settings.bargeIn !== false, bargeConflict: false, barged: false,
    saying: false, sayingText: "", sayFinish: null, spokenChars: 0, carryText: null,
    // מדדים שנמדדים בפועל (לא הערכות): זמני דיבור, רצף, זמן תגובה, קטיעות
    metrics: {studentMs: 0, teacherMs: 0, longestMs: 0, latencies: [], interruptions: 0, firstSpeechAt: 0},
    turnRequestedAt: 0,
    // realtime (OpenAI, דרך english-live): speech-to-speech עם קטיעה מובנית. null = זרימה רגילה
    live: null, mode: "text", liveSummary: null,
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
    if (session.live){ session.live.sendText(v); return; }
    if (session.pendingFinish) session.pendingFinish(v);
  };
  input.addEventListener("keydown", e => { if (e.key === "Enter") sendTyped(); });
  const typedRow = el("div", {class: "typed-row" + (session.typedOnly ? " open" : ""), dir: "ltr"},
    input, el("button", {class: "btn primary small", onclick: sendTyped}, "שלח"));

  const micBtn = el("button", {class: "call-btn mic", onclick: toggleMic}, "🎤");
  const bargeBtn = el("button", {class: "call-btn" + (session.bargeIn ? "" : " off"), title: "קטיעה באמצע דיבור", onclick: toggleBarge}, "⚡");
  const controls = el("div", {class: "call-controls"},
    sttOK ? micBtn : null,
    sttOK ? bargeBtn : null,
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

  session.ui = {capTeacher, capUser, statusEl, ring, micBtn, bargeBtn, teacherTile, input, typedRow};

  // טיימר
  session.timerInt = setInterval(() => {
    const s = Math.floor((Date.now() - session.start) / 1000);
    timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);

  if (selfCam) startCam(selfTile);

  startLesson(focus);
}

// מנסה קודם realtime (speech-to-speech). אם ה-Worker רדום / WebRTC נכשל / כבוי בהגדרות —
// נופל בשקט לזרימה הרגילה (STT/TTS של הדפדפן עם קטיעה). תמיד יש שיעור.
async function startLesson(focus){
  if (S.settings.realtime !== false && realtimeSupported()){
    setStatus("מתחבר לקול realtime…", "thinking");
    try {
      const live = await startLive({teacher: session.teacher, topic: focus.topic, handlers: liveHandlers()});
      if (!session || session.destroyed){ live?.close(); return; }
      if (live){
        session.live = live; session.mode = "realtime";
        // בקטיעה מובנית (VAD בשרת) אין צורך בצופה של הזרימה הרגילה
        session.ui.bargeBtn && (session.ui.bargeBtn.style.display = "none");
        setStatus(`${session.teacher.name} מתחבר…`, "speaking");
        startMouthLive();
        return;
      }
    } catch (e){
      if (!session || session.destroyed) return;
      if (e instanceof LiveError && e.message === "mic") toast("אין גישה למיקרופון — ממשיכים בזרימה הרגילה");
      else if (e instanceof LiveError && e.message === "rate") toast("יותר מדי חיבורים — ממשיכים בזרימה הרגילה");
      else toast("קול realtime לא זמין כרגע — ממשיכים בזרימה הרגילה");
    }
  }
  runLesson(focus);
}

// אירועים מה-realtime → מסך, אווטאר, זיכרון. נבנה לפני החיבור, סוגר על ה-session.
function liveHandlers(){
  const phaseHe = {opening: "פתיחה", review: "חזרה", main: "הנושא של היום", practice: "תרגול", correction: "תיקון", fluency: "אתגר שטף", summary: "סיכום"};
  let errToasted = false;
  return {
    onTeacherText(text){ if (session?.ui) session.ui.capTeacher.textContent = text; },
    onTeacherSpeaking(on){
      if (!session || session.destroyed) return;
      session.avatar.setState(on ? "speaking" : "idle");
      setStatus(on ? `${session.teacher.name} מדבר…` : "מקשיב לך… דבר כשתרצה 🎙️", on ? "speaking" : "listening");
      if (!on) session.avatar.setState("listening");
    },
    onUserSpeaking(on){
      if (!session || session.destroyed) return;
      if (on){
        const interrupting = session.live?.state.teacherSpeaking;
        session.ui.capUser.textContent = "";
        session.avatar.setState("listening");
        setStatus(interrupting ? "קטעת — מקשיב לך 🎙️" : "מקשיב לך… 🎙️", "listening");
      }
    },
    onUserText(t){ if (session?.ui) session.ui.capUser.textContent = t; },
    onTool(name, args){ return applyTool(name, args, phaseHe); },
    onError(msg){ if (!errToasted){ errToasted = true; toast("שגיאת realtime: " + msg); } },
  };
}

// הכלים שהמורה קורא להם — נשמרים בזיכרון המקומי (ההתקדמות נשארת במכשיר)
function applyTool(name, a, phaseHe){
  if (!session) return {ok: false};
  switch (name){
    case "log_correction":
      recordMistake(`lesson (${a.kind || "significant"}): ${a.original || ""} → ${a.corrected || ""}${a.note_he ? " · " + a.note_he : ""}`, "speaking");
      return {ok: true};
    case "mark_word_used": {
      // גם מילה שהמורה לימד ואינה במילון המובנה נכנסת ל-SRS: כך היא מגיעה ל-reuseWords
      // והמורה שוזר אותה בשיעורים הבאים (spaced repetition בתוך שיחה)
      const key = String(a.word || "").toLowerCase().trim();
      if (!key || key.length > 40) return {ok: false, error: "bad word"};
      const w = WORDS.find(x => wordKey(x) === key);
      review(w ? wordKey(w) : key, !!a.correct);
      return {ok: true, inDictionary: !!w};
    }
    case "pronunciation_note":
      recordMistake(`pronunciation: ${a.word || ""} — ${a.issue || ""}${a.improved ? " (improved)" : ""}`, "pronunciation");
      return {ok: true};
    case "lesson_phase":
      if (a.phase && session.ui) session.ui.statusEl.textContent = `שלב: ${phaseHe[a.phase] || a.phase}`;
      return {ok: true};
    case "end_lesson_summary":
      session.liveSummary = {improved: a.improved || "", weak: a.weak || "", next: a.next || ""};
      return {ok: true};
    default:
      return {ok: false, error: "unknown tool"};
  }
}

// לק-סינק אמיתי: פתיחת הפה לפי עוצמת האודיו של המורה (לא לפי טיימר)
function startMouthLive(){
  let smooth = 0;
  const loop = () => {
    if (!session || session.destroyed || !session.live) return;
    const lv = session.live.level();
    smooth = smooth * 0.6 + lv * 0.4;
    session.avatar.setMouth(session.live.state.teacherSpeaking ? Math.min(1, smooth * 1.4) : 0);
    session.mouthRAF = requestAnimationFrame(loop);
  };
  session.mouthRAF = requestAnimationFrame(loop);
}

function setStatus(text, cls = ""){
  if (!session?.ui) return;
  session.ui.statusEl.textContent = text;
  session.ui.statusEl.className = "call-status " + cls;
  session.ui.teacherTile.classList.toggle("is-speaking", cls === "speaking");
  session.ui.teacherTile.classList.toggle("is-listening", cls === "listening");
}

// אם התלמיד קטע — ההודעה של המורה בהיסטוריה נחתכת במקום שבו נעצר, כדי שהמודל
// ידע שלא הכול נאמר ויגיב לקטיעה עצמה (למשל "Wait, what does that mean?").
function markIfInterrupted(msg, res){
  if (!res?.interrupted) return;
  const spoken = msg.content.slice(0, res.spokenChars || 0).trim();
  msg.content = (spoken ? spoken + " …" : "…") + " (the student interrupted here)";
}

async function runLesson(focus){
  const opener = openingLine(session.teacher, focus);
  const openerMsg = {role: "assistant", content: opener};
  session.messages.push(openerMsg);
  markIfInterrupted(openerMsg, await say(opener));
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
    const msg = {role: "assistant", content: reply};
    session.messages.push(msg);
    markIfInterrupted(msg, await say(reply));
  }
}

// המורה מדבר: כתובית + הנפשת פה + קול. בזמן הדיבור רץ מזהה-דיבור "צופה" (barge-in):
// אם התלמיד מתחיל לדבר באמת — המורה נעצר מיד והמזהה הופך לתור של התלמיד.
// נפתר ב-{interrupted, spokenChars}: ב-onend, בעצירת הדיבור, בקטיעה, או בגיבוי.
function say(text){
  if (!session) return Promise.resolve({interrupted: false, spokenChars: 0});
  session.ui.capTeacher.textContent = text;
  session.ui.capUser.textContent = "";
  session.avatar.setState("speaking");
  setStatus(`${session.teacher.name} מדבר…`, "speaking");
  session.sayingText = text; session.saying = true; session.spokenChars = 0; session.barged = false;
  const t0 = Date.now();
  return new Promise(resolve => {
    let done = false;
    const finish = (info = {}) => {
      if (done) return; done = true;
      session.saying = false; session.sayFinish = null;
      if (session.sayPoll){ clearInterval(session.sayPoll); session.sayPoll = null; }
      stopMouth();
      session.metrics.teacherMs += Date.now() - t0;
      if (!session.destroyed){
        session.avatar.setMouth(0);
        if (!info.interrupted) session.avatar.setState("idle");
      }
      // סיום רגיל: הצופה כבר לא נחוץ (בקטיעה הוא הפך לתור התלמיד ונשאר)
      if (!info.interrupted && session.recRole === "watch") stopRec();
      resolve({interrupted: !!info.interrupted, spokenChars: session.spokenChars});
    };
    session.sayFinish = finish;
    startMouth();
    const est = Math.min(16000, 900 + text.length * 60);
    const ok = speak(text, {
      voice: session.teacher.voice,
      onend: () => finish(),
      onboundary: (ev) => {
        if (!session) return;
        session.mouthBoost = 1;
        if (ev && typeof ev.charIndex === "number") session.spokenChars = ev.charIndex; // כמה כבר נאמר — לקטיעה
      },
    });
    if (session.bargeIn && !session.muted && !session.typedOnly) startRecognizer("watch");
    // בלי קול ממשי (אין voices בדפדפן) — קוצבים לפי זמן קריאה, לא נתקעים
    const silent = !ttsSupported() || (speechSynthesis.getVoices && speechSynthesis.getVoices().length === 0);
    if (!ok || silent){
      session.timers.push(setTimeout(() => finish(), Math.min(8000, 400 + text.length * 38)));
      return;
    }
    // יש קול: מסתמכים על onend, עם גיבוי אם הדיבור נעצר בלי onend, ותקרה קשיחה
    let started = false;
    session.sayPoll = setInterval(() => {
      if (done) return;
      const sp = speechSynthesis.speaking;
      if (sp) started = true;
      if (started && !sp){
        // הדיבור מת מיד אחרי שהצופה עלה, בלי קטיעה = בחלק ממכשירי אנדרואיד
        // המיקרופון "גונב" את האודיו. מכבים קטיעה לשיעור הזה ואומרים שוב.
        const elapsed = Date.now() - t0;
        if (!session.barged && session.bargeIn && session.recRole === "watch" && elapsed < est * 0.35 && !session.bargeConflict){
          session.bargeConflict = true;
          setBarge(false, true);
          clearInterval(session.sayPoll); session.sayPoll = null;
          done = true; session.saying = false; session.sayFinish = null; stopMouth();
          toast("קטיעה באמצע דיבור לא נתמכת במכשיר הזה — ממשיכים בלי");
          say(text).then(resolve);
          return;
        }
        finish();
      }
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
// אם התלמיד כבר קטע את המורה — המזהה כבר רץ כתור שלו, רק מחברים אליו.
function getUserTurn(){
  return new Promise(resolve => {
    session.turnRequestedAt = Date.now();
    session.metrics.firstSpeechAt = 0;
    session.pendingFinish = (text) => {
      session.pendingFinish = null;
      const lat = session.metrics.firstSpeechAt - session.turnRequestedAt;
      if (session.metrics.firstSpeechAt && lat > 0) session.metrics.latencies.push(lat);
      stopRec();
      resolve(text);
    };
    if (session.carryText != null){ // הקטיעה כבר הסתיימה לפני שהתור התבקש
      const t = session.carryText; session.carryText = null;
      session.pendingFinish(t); return;
    }
    if (session.barged){ session.barged = false; return; } // המזהה כבר מקשיב מהקטיעה
    if (sttOK && !session.muted && !session.typedOnly) startRecognizer("listen");
    else setStatus("הקלד תשובה ושלח 👇", "");
  });
}

const wordsOf = s => (s || "").toLowerCase().replace(/[^a-z' ]+/g, " ").split(/\s+/).filter(Boolean);

// האם מה שנשמע בזמן שהמורה מדבר הוא באמת התלמיד — ולא הד של הרמקול או רעש.
// קצר מדי (<2 מילים) או חופף ברובו למשפט של המורה = מתעלמים.
function shouldIgnoreWhileSpeaking(heard, spoken){
  const h = wordsOf(heard);
  if (h.length < 2) return true;
  const set = new Set(wordsOf(spoken));
  const overlap = h.filter(w => set.has(w)).length / h.length;
  return overlap >= 0.6;
}

// מזהה-דיבור אחד לשני תפקידים: "listen" = התור של התלמיד, "watch" = צופה לקטיעה
// בזמן שהמורה מדבר. בקטיעה התפקיד מתהפך ל-listen באותו מזהה, כך שלא מאבדים מילים.
function startRecognizer(role){
  if (!session || session.destroyed || !sttOK) return;
  stopRec();
  const rec = new SR();
  session.rec = rec; session.recRole = role;
  rec.lang = "en-US"; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
  if (role === "listen"){
    session.avatar.setState("listening");
    setStatus("מקשיב לך… דבר עכשיו 🎙️", "listening");
    session.ui.capUser.textContent = "";
  }
  let finalText = "", speechStart = 0;
  const noteSpeech = () => {
    if (speechStart) return;
    speechStart = Date.now();
    if (session.recRole === "listen" && !session.metrics.firstSpeechAt) session.metrics.firstSpeechAt = speechStart;
  };
  rec.onspeechstart = noteSpeech;
  rec.onresult = (e) => {
    if (!session || session.rec !== rec) return;
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++){
      const tr = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += tr + " "; else interim += tr;
    }
    const text = (finalText + interim).trim();
    if (session.recRole === "watch"){
      if (shouldIgnoreWhileSpeaking(text, session.sayingText)) return;
      bargeIn();
    }
    noteSpeech();
    session.ui.capUser.textContent = text;
  };
  rec.onerror = () => {};
  rec.onend = () => {
    if (!session || session.rec !== rec) return; // מזהה ישן
    session.rec = null;
    const wasRole = session.recRole;
    if (session.destroyed || session.muted) return;
    if (wasRole === "watch"){
      // נגמר בלי קטיעה (המזהה נסגר אחרי שקט) — אם המורה עדיין מדבר, ממשיכים לצפות
      if (session.saying) session.timers.push(setTimeout(() => {
        if (session?.saying && !session.rec && session.bargeIn) startRecognizer("watch");
      }, 150));
      return;
    }
    const t = finalText.trim();
    if (speechStart){
      const dur = Date.now() - speechStart;
      session.metrics.studentMs += dur;
      session.metrics.longestMs = Math.max(session.metrics.longestMs, dur);
    }
    if (session.pendingFinish) session.pendingFinish(t);
    else session.carryText = t; // הקטיעה נגמרה לפני שהלולאה ביקשה תור — שומרים
  };
  try { rec.start(); } catch { if (role === "listen" && session.pendingFinish) session.pendingFinish(""); }
}

// התלמיד התחיל לדבר בזמן שהמורה מדבר: עוצרים את המורה מיד, והמזהה הופך לתור התלמיד
function bargeIn(){
  if (!session || session.recRole !== "watch") return;
  session.recRole = "listen";
  session.barged = true;
  session.metrics.interruptions++;
  stopSpeaking();
  if (session.sayFinish) session.sayFinish({interrupted: true});
  session.avatar.setState("listening");
  setStatus("קטעת — מקשיב לך 🎙️", "listening");
}

function stopRec(){
  if (!session) return;
  const rec = session.rec;
  session.rec = null; session.recRole = null;
  try { rec?.abort(); } catch {}
}

function setBarge(on, silent = false){
  if (!session) return;
  session.bargeIn = on;
  session.ui.bargeBtn?.classList.toggle("off", !on);
  S.settings.bargeIn = on; save();
  if (!on && session.recRole === "watch") stopRec();
  if (on && session.saying && !session.rec && !session.muted) startRecognizer("watch");
  if (!silent) toast(on ? "⚡ קטיעה פעילה — אפשר לדבר גם כשהמורה מדבר" : "קטיעה כבויה — המורה יסיים לדבר לפני שתענה");
}
function toggleBarge(){ if (session && !session.live) setBarge(!session.bargeIn); }

function toggleMic(){
  if (!session) return;
  session.muted = !session.muted;
  session.ui.micBtn.classList.toggle("muted", session.muted);
  session.ui.micBtn.textContent = session.muted ? "🔇" : "🎤";
  if (session.live){
    session.live.mute(session.muted);
    setStatus(session.muted ? "המיקרופון מושתק — הקש 🎤 להמשך" : "מקשיב לך… 🎙️", session.muted ? "" : "listening");
    return;
  }
  if (session.muted){
    stopRec();
    session.barged = false;
    session.avatar.setState("idle");
    setStatus("מושהה — הקש 🎤 להמשך", "");
  } else if (session.pendingFinish && sttOK && !session.typedOnly){
    startRecognizer("listen");
  } else if (session.saying && session.bargeIn){
    startRecognizer("watch");
  }
}

async function repeatLast(){
  if (!session) return;
  if (session.live){ session.live.sendText("Could you say that again, please? A little slower."); return; }
  const last = [...session.messages].reverse().find(m => m.role === "assistant");
  if (!last) return;
  stopRec();
  const res = await say(last.content.replace(/ …? ?\(the student interrupted here\)$/, ""));
  if (!session || session.destroyed) return;
  if (!res.interrupted && session.pendingFinish && sttOK && !session.muted && !session.typedOnly) startRecognizer("listen");
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
  const mode = session.mode;
  let teacherSummary = session.liveSummary;

  // realtime: נותנים למורה לסכם (אם עוד לא), ולוקחים תמלול ומדדים מהאירועים האמיתיים (VAD)
  let messages, m;
  if (session.live){
    const live = session.live;
    setStatus("המורה מסכם…", "thinking");
    if (!live.state.lessonSummary && live.state.transcript.some(x => x.role === "user")){
      live.askSummary();
      const t0 = Date.now();
      await new Promise(res => { const iv = setInterval(() => {
        if (!session || live.state.lessonSummary || Date.now() - t0 > 9000){ clearInterval(iv); res(); } }, 200); });
      if (live.state.lessonSummary) teacherSummary = live.state.lessonSummary;
    }
    messages = live.state.transcript.slice();
    m = live.state.metrics;
  } else {
    messages = session.messages.slice();
    m = session.metrics;
  }
  const secs = Math.round((Date.now() - session.start) / 1000);
  const userTurns = messages.filter(mm => mm.role === "user");
  const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  const rec = {
    date: todayStr(), teacher: teacher.id, secs, turns: userTurns.length, mode,
    studentMs: m.studentMs, teacherMs: m.teacherMs, longestMs: m.longestMs,
    avgLatencyMs: avg(m.latencies), interruptions: m.interruptions, typed: mode === "text" && !sttOK,
  };
  teardown();

  if (userTurns.length === 0){ renderClassroom(main); return; }

  const prev = (S.liveLessons || []).slice(-1)[0] || null;
  S.liveLessons = [...(S.liveLessons || []), rec].slice(-50);
  save();

  skillResult("speaking", true);
  // זמן דיבור: הערך שנמדד; בהקלדה (ללא מיקרופון) אין דיבור נמדד — לא ממציאים
  if (rec.studentMs > 0) logDay({speakSec: Math.round(rec.studentMs / 1000)});
  addXP(15 + userTurns.length * 6, "שיעור חי");

  main.replaceChildren(el("div", {class: "screen"},
    el("div", {class: "card center"}, el("div", {class: "muted"}, `${teacher.name} מכין לך סיכום מהשיעור…`))));

  const transcript = messages.map(mm => `${mm.role === "user" ? "Student" : "Teacher"}: ${mm.content}`).join("\n");
  let fb = null;
  try {
    fb = await feedback(transcript);
    (fb.mistakes || []).slice(0, 5).forEach(mm => recordMistake(`lesson: ${mm.original || ""} → ${mm.better || ""}`, "speaking"));
  } catch { fb = null; }
  renderSummary(main, fb, rec, prev, teacher, teacherSummary);
}

const fmtS = ms => `${Math.round(ms / 1000)} שנ'`;
// השוואה לשיעור הקודם — רק כשיש נתון קודם אמיתי
function cmp(cur, prev, higherIsBetter = true){
  if (!prev || !cur) return null;
  const d = cur - prev;
  if (Math.abs(d) < 500) return el("span", {class: "muted small-text"}, "כמו בשיעור הקודם");
  const good = higherIsBetter ? d > 0 : d < 0;
  return el("span", {class: "delta " + (good ? "up" : "down")}, `${d > 0 ? "▲" : "▼"} ${fmtS(Math.abs(d))} מהקודם`);
}

function renderSummary(main, fb, rec, prev, teacher, teacherSummary = null){
  const sc = (fb && fb.scores) || {};
  const numBox = (label, v) => el("div", {class: "card stat-card"},
    el("div", {class: "stat-v"}, typeof v === "number" ? Math.round(v) : "—"),
    el("div", {class: "stat-l"}, label));
  // הגייה לא נמדדת במסלול הזה — אין ניתוח אודיו. לא מציגים מספר מומצא.
  const naBox = (label) => el("div", {class: "card stat-card na"},
    el("div", {class: "stat-v na-v"}, "לא נמדד"),
    el("div", {class: "stat-l"}, label));
  const row = (label, val, extra) => el("li", {}, el("span", {class: "muted"}, label), el("span", {}, el("strong", {}, val), " ", extra || ""));
  const total = rec.studentMs + rec.teacherMs;
  const measured = rec.studentMs > 0 ? [
    row("זמן הדיבור שלך", fmtS(rec.studentMs), cmp(rec.studentMs, prev?.studentMs)),
    rec.teacherMs > 0 ? row("זמן הדיבור של המורה", fmtS(rec.teacherMs)) : null,
    total > 0 ? row("חלקך בשיחה", `${Math.round(100 * rec.studentMs / total)}%`, el("span", {class: "muted small-text"}, "יעד: 65–75%")) : null,
    row("רצף הדיבור הארוך ביותר", fmtS(rec.longestMs), cmp(rec.longestMs, prev?.longestMs)),
    rec.avgLatencyMs ? row("זמן תגובה ממוצע", fmtS(rec.avgLatencyMs), cmp(rec.avgLatencyMs, prev?.avgLatencyMs, false)) : null,
    row("קטיעות של המורה", String(rec.interruptions)),
  ] : [row("זמן דיבור", "לא נמדד", el("span", {class: "muted small-text"}, "השיעור היה בהקלדה"))];

  main.replaceChildren(el("div", {class: "screen"},
    el("div", {class: "card center"},
      el("div", {class: "summary-emoji"}, "🎓"),
      el("h2", {}, `סיכום השיעור עם ${teacher.name}`),
      el("p", {class: "muted"}, `${Math.round(rec.secs / 60)} דקות · ${rec.turns} תשובות שלך · ${rec.mode === "realtime" ? "קול realtime" : "זרימה רגילה"}`)),
    teacherSummary ? el("div", {class: "card"},
      el("h3", {}, `🧑‍🏫 הסיכום של ${teacher.name}`),
      el("p", {dir: "ltr"}, el("strong", {}, "Improved: "), teacherSummary.improved),
      el("p", {dir: "ltr"}, el("strong", {}, "Still weak: "), teacherSummary.weak),
      el("p", {dir: "ltr"}, el("strong", {}, "Next time: "), teacherSummary.next)) : null,
    el("div", {class: "card"},
      el("h3", {}, "📏 מה נמדד בפועל"),
      el("ul", {class: "metrics-list"}, measured)),
    fb ? el("div", {class: "stats-grid"},
      numBox("שטף (הערכה)", sc.fluency),
      numBox("אוצר מילים (הערכה)", sc.vocabulary),
      numBox("דקדוק (הערכה)", sc.grammar),
      naBox("הגייה")) : el("div", {class: "card notice"}, "המורה לא הצליח להכין משוב מילולי (בעיית חיבור). המדדים למעלה נמדדו מקומית ותקפים."),
    fb ? el("p", {class: "muted small-text"}, "שטף/אוצר/דקדוק הם הערכה מהתמלול של השיחה. הגייה תסומן כ\"נמדד\" רק כשיתווסף ניתוח אודיו אמיתי.") : null,
    fb?.summary ? el("div", {class: "card"}, el("h3", {}, "מה היה טוב ומה לחזק"), el("p", {}, fb.summary)) : null,
    fb?.mistakes?.length ? el("div", {class: "card"},
      el("h3", {}, "תיקונים מהשיעור"),
      el("ul", {class: "fb-list"}, fb.mistakes.map(mm => el("li", {},
        el("div", {dir: "ltr", class: "bad-text"}, mm.original || ""),
        el("div", {dir: "ltr", class: "good-text"}, mm.better || ""),
        mm.note ? el("div", {class: "muted small-text"}, mm.note) : null)))) : null,
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
  try { session.live?.close(); } catch {}
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
