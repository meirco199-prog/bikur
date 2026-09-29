// שיעור חי עם מורה AI — כמו שיחת זום. המורה מדבר בקול (השפתיים זזות), מקשיב לך,
// שואל, אתה עונה, והוא מתקן — hands-free. עם חלון "מצלמה" שלך (רשות), כתוביות,
// ובקרות שיחה. נופל יפה להקלדה כשאין זיהוי דיבור, וללא קול כשאין הקראה.
// שני מצבים: "השיעור הבא שלי" (קורס מובנה: תוכנית מוכנה מראש + שקפים שהמורה שולט בהם)
// ו"שיחה חופשית" (נושא לבחירה).
import { el, toast, pick, todayStr } from "../util.js";
import { S, save, logDay, skillResult, recordMistake, logError, logWordUse, logPronunciation, finishLessonMemory, memorySummary } from "../store.js";
import { speak, stopSpeaking, ttsSupported } from "../speech.js";
import { chat, feedback, aiErrorMessage } from "../ai.js";
import { addXP } from "../gamify.js";
import { createAvatar, TEACHERS, teacherById } from "../avatar.js";
import { startLive, realtimeSupported, LiveError } from "../live.js";
import { review, ensureEntry } from "../srs.js";
import { WORDS, wordKey } from "../data/words.js";
import { LEVELS } from "../data/test.js";
import { ensureNextLesson, setSchedule, fmtSchedule, planText, completeLesson, isPlacementDone, quizPool, quizDetail,
  DURATIONS, WEEKDAYS_HE, SKILLS, SKILL_HE } from "../curriculum.js";
import { createRun } from "../adaptive.js";
import { lessonReminderStatus, enableNotifs } from "../notify.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const sttOK = !!SR;

const FOCI = [
  {id: "free",   he: "שיחה חופשית",        topic: null,                                                     en: "free conversation"},
  {id: "daily",  he: "אנגלית יומיומית",     topic: "everyday small talk — plans, food, weekend, feelings",    en: "everyday English"},
  {id: "work",   he: "אנגלית לעבודה",       topic: "work English — meetings, emails, small talk with colleagues", en: "English for work"},
  {id: "travel", he: "טיולים",              topic: "travel English — airport, hotel, ordering, directions",   en: "travel English"},
  {id: "words",  he: "חזרה על המילים שלי",  topic: "practice using the words the student has been learning",  en: "your vocabulary"},
];

const PHASE_HE = {"small talk": "פתיחה", review: "חזרה", vocabulary: "מילים", reading: "קריאה", discussion: "שיחה", grammar: "דקדוק",
  challenge: "אתגר", summary: "סיכום", "warm-up": "חימום", "short exercises": "תרגילים קצרים", "speaking tasks": "משימות דיבור"};
const KIND_HE = {placement: "שיעור היכרות ואבחון", check: "בדיקת התקדמות", lesson: "שיעור"};
const ABCD = "ABCD";

let session = null;

// ---------- מסך טרום-שיחה: השיעור הבא (קורס) / שיחה חופשית, מורה, מצלמה ----------
export function renderClassroom(main, tab = "course"){
  teardown();
  const plan = ensureNextLesson();
  let teacher = tab === "course" ? teacherById(plan.teacherId) : TEACHERS[0];
  let focus = FOCI[0];
  let selfCam = false;

  const teacherRow = el("div", {class: "teacher-pick"});
  const paintTeachers = () => teacherRow.replaceChildren(...TEACHERS.map(t => {
    const av = createAvatar(t);
    return el("button", {class: "teacher-card" + (t.id === teacher.id ? " sel" : ""), onclick: () => {
      teacher = t; paintTeachers();
      // בקורס המורה נשמר בתוכנית — "המורה שלך" קבוע בין שיעורים עד שמחליפים
      if (tab === "course"){ saveSchedule({teacherId: t.id}); }
    }}, av.node, el("div", {class: "teacher-name"}, `${t.name} · ${t.he}`));
  }));
  paintTeachers();

  const camToggle = el("button", {class: "btn ghost small", onclick: (ev) => {
    selfCam = !selfCam;
    ev.currentTarget.textContent = selfCam ? "📷 המצלמה שלך: פועלת" : "📷 המצלמה שלך: כבויה";
    ev.currentTarget.classList.toggle("sel-good", selfCam);
  }}, "📷 המצלמה שלך: כבויה");

  const tabs = el("div", {class: "chips"},
    el("button", {class: "chip-btn" + (tab === "course" ? " sel" : ""), onclick: () => renderClassroom(main, "course")}, "📚 השיעור הבא שלי"),
    el("button", {class: "chip-btn" + (tab === "free" ? " sel" : ""), onclick: () => renderClassroom(main, "free")}, "💬 שיחה חופשית"));

  let body;
  if (tab === "course"){
    body = [
      lessonCard(plan),
      el("h3", {}, "מתי השיעור?"),
      scheduleEditor(main),
      el("h3", {}, "המורה שלך"),
      teacherRow,
    ];
  } else {
    const focusChips = el("div", {class: "chips"},
      FOCI.map(f => el("button", {class: "chip-btn" + (f.id === focus.id ? " sel" : ""), onclick: (ev) => {
        focus = f;
        focusChips.querySelectorAll(".chip-btn").forEach(b => b.classList.remove("sel"));
        ev.currentTarget.classList.add("sel");
      }}, f.he)));
    body = [
      el("p", {class: "muted"}, "שיחה בלי תוכנית — המורה מכיר אותך וזוכר, אבל הנושא לבחירתך."),
      el("h3", {}, "מי ילמד אותך היום?"),
      teacherRow,
      el("h3", {}, "על מה נדבר?"),
      focusChips,
    ];
  }

  main.replaceChildren(el("div", {class: "screen"},
    el("div", {class: "backbar"},
      el("button", {class: "btn ghost small", onclick: () => { location.hash = "#/speak"; }}, "→ חזרה"),
      el("h2", {}, "שיעור חי בזום")),
    tabs,
    ...body,

    el("div", {class: "row spread cam-row"},
      el("span", {class: "muted small-text"}, "רוצה לראות גם את עצמך בפינה?"),
      camToggle),

    sttOK ? null : el("div", {class: "card notice"},
      "בדפדפן הזה אין זיהוי דיבור, אז תענה בהקלדה (המורה עדיין ידבר בקול). לחוויה מלאה עם דיבור — פתח ב-Chrome באנדרואיד או במחשב."),

    el("button", {class: "btn primary big cta", onclick: () => startCall(main, tab === "course"
      ? {teacher, focus: null, selfCam, plan}
      : {teacher, focus, selfCam, plan: null})},
      tab === "course" ? `🎥 התחל את שיעור ${plan.n}` : "🎥 התחל שיחה"),
  ));
}

// כרטיס השיעור המוכן: מה נלמד, אילו שקפים מחכים, מי מלמד וכמה זמן
function lessonCard(plan){
  const slideKinds = {review: "חזרה", vocab: "מילים חדשות", story: "סיפור לקריאה", questions: "שיחה", grammar: "דקדוק", challenge: "אתגר", quiz: "תרגילים קצרים", prompt: "משימות דיבור"};
  const parts = [...new Set(plan.slides.map(s => slideKinds[s.type]).filter(Boolean))];
  const t = teacherById(plan.teacherId);
  const when = fmtSchedule();
  return el("div", {class: "card next-lesson"},
    el("div", {class: "nl-top"},
      el("span", {class: "nl-label"}, KIND_HE[plan.kind] || "שיעור"),
      el("span", {class: "nl-when"}, when || "לא נקבע מועד")),
    el("div", {class: "nl-title", dir: "ltr"}, `Lesson ${plan.n} — ${plan.title}`),
    el("div", {}, plan.he),
    el("ul", {class: "today-list"}, plan.goals.map(g => el("li", {class: "nostrike"}, el("span", {class: "t-icon"}, "🎯"), g))),
    el("div", {class: "muted small-text"}, `${plan.slides.length} שקפים: ${parts.join(" · ")}`),
    plan.reviewWords?.length ? el("div", {class: "muted small-text", dir: "ltr"}, "Review: " + plan.reviewWords.join(", ")) : null,
    el("div", {class: "muted small-text"}, `${t.name} · ${plan.durationMin} דקות · הוכן ${plan.createdAt}`));
}

function saveSchedule(patch){
  const sc = S.course.schedule || {};
  setSchedule({weekday: sc.weekday ?? null, time: sc.time ?? null, durationMin: sc.durationMin || 30, teacherId: sc.teacherId || "sarah", ...patch});
}

// עורך תזמון: יום, שעה, משך — נשמר מיד. "השיעור הבא שלך" בבית מציג את המועד.
function scheduleEditor(main){
  const sc = S.course.schedule || {};
  const daySel = el("select", {class: "input sched-sel", onchange: (ev) => { saveSchedule({weekday: ev.target.value === "" ? null : +ev.target.value}); renderClassroom(main, "course"); }},
    el("option", {value: ""}, "בחר יום"),
    WEEKDAYS_HE.map((d, i) => el("option", {value: String(i)}, "יום " + d)));
  daySel.value = sc.weekday == null ? "" : String(sc.weekday);
  const timeIn = el("input", {class: "input sched-time", type: "time", value: sc.time || "", onchange: (ev) => {
    if (ev.target.value){ saveSchedule({time: ev.target.value}); renderClassroom(main, "course"); }
  }});
  return el("div", {class: "card sched"},
    el("div", {class: "row gap"}, daySel, timeIn),
    el("div", {class: "row gap center-row"},
      el("span", {class: "muted small-text"}, "משך:"),
      DURATIONS.map(d => el("button", {class: "chip-btn" + ((sc.durationMin || 30) === d ? " sel" : ""), onclick: () => {
        saveSchedule({durationMin: d}); renderClassroom(main, "course");
      }}, `${d} דק'`))),
    scheduleStatus(main));
}

// מה יקרה בפועל עם התזכורת: אומרים רק מה שבאמת יגיע, ומציעים להפעיל התראות אם הן כבויות
function scheduleStatus(main){
  if (!fmtSchedule()) return el("div", {class: "muted small-text"}, "קבע יום ושעה קבועים — כמו שיעור פרטי אמיתי. אפשר להתחיל גם עכשיו.");
  const st = lessonReminderStatus();
  return el("div", {class: "sched-status" + (st.ok ? "" : " warn")},
    el("div", {class: "small-text"}, `השיעור הבא: ${fmtSchedule()}`),
    el("div", {class: "small-text"}, (st.ok ? "🔔 " : "⚠️ ") + st.text),
    st.reason === "off" ? el("button", {class: "btn ghost small", onclick: async (ev) => {
      ev.currentTarget.disabled = true; ev.currentTarget.textContent = "מפעיל…";
      const ok = await enableNotifs();
      toast(ok ? "ההתראות הופעלו — תזכורת לשיעור תגיע ✓" : "ההרשאה נדחתה בדפדפן — יש לאפשר התראות בהגדרות האתר");
      renderClassroom(main, "course");
    }}, "הפעל התראות לשיעור") : null);
}

// ---------- השיחה החיה ----------
function startCall(main, {teacher, focus, selfCam, plan = null}){
  const avatar = createAvatar(teacher);
  session = {
    main, teacher, focus, avatar, plan,
    messages: [], start: Date.now(), destroyed: false, ending: false,
    muted: false, typedOnly: !sttOK, pendingFinish: null, rec: null, recRole: null,
    timers: [], mouthRAF: null, mouthBoost: 0, camStream: null, emptyCount: 0,
    timerInt: null, nudgeInt: null,
    // קטיעה (barge-in): מזהה-דיבור "צופה" רץ בזמן שהמורה מדבר; דיבור אמיתי עוצר את המורה
    bargeIn: sttOK && S.settings.bargeIn !== false, bargeConflict: false, barged: false,
    saying: false, sayingText: "", sayFinish: null, spokenChars: 0, carryText: null,
    // מדדים שנמדדים בפועל (לא הערכות): זמני דיבור, רצף, זמן תגובה, קטיעות
    metrics: {studentMs: 0, teacherMs: 0, longestMs: 0, latencies: [], interruptions: 0, firstSpeechAt: 0},
    turnRequestedAt: 0,
    // realtime (OpenAI, דרך english-live): speech-to-speech עם קטיעה מובנית. null = זרימה רגילה
    live: null, mode: "text", liveSummary: null,
    seenErrors: [],           // טעויות שתוקנו בשיעור הזה — לכלל "לא חזרה 3 שיעורים = נלמדה"
    // קורס: שקף נוכחי, תשובות בחידונים (נמדדות), הערכת המורה, הערות שקטות למורה, בדיקות קריאה
    slide: plan ? 1 : 0, quizAnswers: [], teacherSkills: null, notes: [], nudged: new Set(), readChecks: [],
    quiz: {}, quizFlash: null,  // ריצות התרגיל האדפטיבי לפי מיומנות (הפריטים נבחרים תוך כדי)
    hebChars: 0, latChars: 0,  // כמה עברית המורה דיבר בפועל (מהתמלול)
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
    if (session.pendingFinish) session.pendingFinish(v, false, true);
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

  const slides = plan ? el("div", {class: "slides"}) : null;

  main.replaceChildren(el("div", {class: "call" + (plan ? " with-slides" : "")},
    el("div", {class: "call-top"},
      el("div", {class: "call-who"}, plan ? `${teacher.name} · Lesson ${plan.n}` : `${teacher.name} · המורה שלך`, el("span", {class: "live-dot"}), timerEl),
      statusEl),
    el("div", {class: "call-stage"}, teacherTile, selfTile),
    slides,
    el("div", {class: "captions"}, capTeacher, capUser),
    typedRow,
    controls));

  session.ui = {capTeacher, capUser, statusEl, ring, micBtn, bargeBtn, teacherTile, input, typedRow, slides};

  // טיימר
  session.timerInt = setInterval(() => {
    const s = Math.floor((Date.now() - session.start) / 1000);
    timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);

  if (selfCam) startCam(selfTile);
  if (plan){ paintSlide(); session.nudgeInt = setInterval(timeNudge, 20000); }

  startLesson(focus);
}

// ---------- שקפים (קורס) ----------
function currentPhase(){
  const {plan} = session; if (!plan) return null;
  const min = (Date.now() - session.start) / 60000;
  return plan.phases.find(p => min >= p.start && min < p.end) || plan.phases[plan.phases.length - 1];
}

// המורה (או התלמיד) מעביר שקף. byTeacher=true — הגיע ממרקר/כלי של המורה.
function showSlide(n, byTeacher = true){
  if (!session?.plan) return null;
  const N = session.plan.slides.length;
  n = Math.max(1, Math.min(N, Math.round(+n || 1)));
  session.slide = n;
  paintSlide();
  if (byTeacher && session.ui.slides){ session.ui.slides.classList.add("flash"); setTimeout(() => session?.ui?.slides?.classList.remove("flash"), 600); }
  return session.plan.slides[n - 1];
}

function paintSlide(){
  const {plan, ui} = session; if (!plan || !ui?.slides) return;
  const s = plan.slides[session.slide - 1]; if (!s) return;
  const ph = currentPhase();
  const head = el("div", {class: "slides-head"},
    el("button", {class: "btn ghost small", onclick: () => moveSlide(-1), disabled: session.slide <= 1 ? "" : null}, "‹ הקודם"),
    el("span", {}, `שקף ${s.i}/${plan.slides.length}`, ph ? el("span", {class: "slide-phase"}, ` · ${PHASE_HE[ph.name] || ph.name}`) : null),
    el("button", {class: "btn ghost small", onclick: () => moveSlide(1), disabled: session.slide >= plan.slides.length ? "" : null}, "הבא ›"));
  let body;
  switch (s.type){
    case "review":
      body = el("div", {},
        s.items.length ? el("div", {class: "slide-vocab"}, s.items.map(([w, h]) => el("div", {}, el("b", {}, w), el("span", {}, h || "")))) : el("div", {class: "muted"}, "אין עדיין מילים לחזרה — נאסוף בשיעור הזה"),
        s.errors?.length ? el("div", {class: "small-text", style: "margin-top:8px"}, "טעויות מהפעמים הקודמות:",
          s.errors.map(e => el("div", {dir: "ltr"}, el("span", {class: "bad-text"}, e.original), " → ", el("span", {class: "good-text"}, e.corrected)))) : null);
      break;
    case "vocab":
      body = el("div", {class: "slide-vocab"}, s.items.map(([w, h]) => el("div", {}, el("b", {}, w), el("span", {}, h))));
      break;
    case "story":
      body = el("div", {},
        el("div", {class: "slide-story", dir: "ltr"}, s.body),
        s.readAloud ? el("div", {class: "muted small-text", style: "margin-top:8px"}, sttOK && session.mode !== "realtime" && !session.typedOnly
          ? "📖 קרא בקול — זיהוי הדיבור בודק כמה מהמילים נקלטו כפי שכתוב"
          : "📖 קרא בקול — המורה מקשיב") : null);
      break;
    case "questions":
      body = el("ol", {class: "slide-q", dir: "ltr"}, s.items.map(q => el("li", {}, q)));
      break;
    case "quiz": {
      const run = quizRun(s);
      const flash = session.quizFlash && session.quizFlash.slide === s.i ? session.quizFlash : null;
      const item = flash ? flash.item : run.item;
      const n = run.answers.length;
      if (!item && run.done){
        const e = run.estimate();
        body = el("div", {class: "slide-quiz"},
          el("div", {class: "slide-body"}, `✓ ${SKILL_HE[s.skill]}: ${e.floor ? "A1 או מתחת" : e.level}${e.confident ? "" : " (לא מבוסס)"}`),
          el("div", {class: "muted small-text"}, `נמדד מ-${e.items} פריטים · ${run.answers.filter(a => a.correct).length} נכונים`));
        break;
      }
      body = el("div", {class: "slide-quiz"},
        el("div", {class: "muted small-text"}, `פריט ${n + (flash ? 0 : 1)} · רמה ${flash ? flash.level : run.level}`),
        item.text ? el("div", {class: "slide-story", dir: "ltr", style: "margin-bottom:8px"}, item.text) : null,
        item.say ? el("div", {class: "muted small-text"}, "🎧 המורה מקריא משפט — הקשב ואז ענה") : null,
        el("div", {class: "slide-body", dir: /[֐-׿]/.test(item.q) ? "rtl" : "ltr"}, item.q),
        item.opts.map((o, i) => el("button", {class: "opt" + (flash ? (i === item.a ? " right" : (i === flash.idx ? " wrong" : "")) : ""),
          dir: /[֐-׿]/.test(o) ? "rtl" : "ltr", disabled: flash ? "" : null,
          onclick: () => answerQuiz(s, i)}, `${ABCD[i]}. ${o}`)));
      break;
    }
    default:
      body = el("div", {class: "slide-body", dir: /[֐-׿]/.test(s.body || "") ? "rtl" : "ltr"}, s.body || "");
  }
  ui.slides.replaceChildren(head,
    el("div", {class: "slide"},
      el("div", {class: "slide-title", dir: "ltr"}, s.title),
      body));
}

function moveSlide(delta){
  if (!session?.plan) return;
  const s = showSlide(session.slide + delta, false);
  if (s) noteTeacher(`[Student moved to slide ${s.i}: ${s.title}. ${s.type === "quiz" ? quizDesc(s) : ""}]`, false);
}

// הריצה האדפטיבית של שקף תרגיל (מיומנות אחת): נוצרת בפעם הראשונה, הפריט הראשון נבחר מיד
function quizRun(s){
  let run = session.quiz[s.skill];
  if (!run){
    run = session.quiz[s.skill] = createRun({start: s.start || S.profile.level || "A2", pool: quizPool(s.skill)});
    run.next();
  }
  return run;
}
// תיאור הפריט הנוכחי למורה (לתוכנית בזרימה הרגילה, לתוצאת show_slide ב-realtime, ולהערות)
function quizDesc(s){
  const run = quizRun(s);
  if (run.done){ const e = run.estimate(); return `Finished: measured ${e.level} after ${e.items} items.`; }
  const it = run.item; if (!it) return "";
  return `Current item (${run.level}): ${it.say ? `READ THIS ALOUD once, do not show it: "${it.say}". ` : ""}${it.text ? `Passage on screen: "${it.text}". ` : ""}Question: "${it.q}" Options: ${it.opts.map((o, i) => `${ABCD[i]}) ${o}`).join(" ")} (correct: ${ABCD[it.a]}).`;
}

// תשובה בתרגיל — נמדדת (נכון/לא לפי הבנק), הפריט הבא נבחר לפי התשובה, והמורה מקבל הערה שקטה
function answerQuiz(s, idx){
  if (!session) return;
  const run = quizRun(s);
  const item = run.item;
  if (!item || session.quizFlash) return;
  const level = run.level;
  const correct = idx === item.a;
  run.answer(correct);
  session.quizAnswers.push({slide: s.i, skill: s.skill, level, correct, idx});
  session.quizFlash = {slide: s.i, idx, item, level};
  paintSlide();
  let note = `[Student answered ${s.skill} item (${level}): ${ABCD[idx]} — ${correct ? "correct" : `wrong (correct: ${ABCD[item.a]})`}.`;
  const nextItem = run.next();
  const nextSlide = session.plan.slides[s.i]; // השקף שאחרי
  session.timers.push(setTimeout(() => {
    if (!session) return;
    session.quizFlash = null;
    if (!run.done) paintSlide();
    else if (nextSlide && session.slide === s.i) showSlide(s.i + 1, false); // המיומנות הסתיימה — הלאה
    else paintSlide();
  }, 900));
  if (nextItem) note += ` Next ${s.skill} item (${run.level}) is on screen. ${quizDesc(s)}]`;
  else {
    const e = run.estimate();
    note += ` ${s.skill} finished after ${e.items} items: measured level ${e.floor ? "A1 or below" : e.level}${e.confident ? "" : " (not confirmed)"}.`;
    if (nextSlide) note += ` Slide ${nextSlide.i} (${nextSlide.title}) is shown next. ${nextSlide.type === "quiz" ? quizDesc(nextSlide) : ""}`;
    note += "]";
  }
  noteTeacher(note, true);
}

// הערה "שקטה" למורה — לא נספרת כתור של התלמיד. realtime: פריט בערוץ; טקסט: נצמד
// להודעה הבאה, או מקבל תגובה מיידית אם המורה מחכה לתור.
function noteTeacher(text, respond = true){
  if (!session || session.destroyed) return;
  if (session.live){ session.live.note(text, respond); return; }
  if (respond && session.pendingFinish && !session.saying){ session.pendingFinish(text, true, false); return; }
  session.notes.push({text, respond});
}
function takeNotes(){ return session.notes.splice(0).map(n => n.text); }
const stripNotes = s => s.replace(/\[(Time|Student answered|Student moved|Reading check|The lesson is starting)[^\]]*\]\n?/g, "").trim();

// מודעות לזמן: בתחילת כל שלב בתוכנית המורה מקבל הערה, ובסוף הזמן — בקשה לסכם
function timeNudge(){
  if (!session?.plan || session.destroyed || session.ending) return;
  const {plan} = session;
  const min = Math.floor((Date.now() - session.start) / 60000);
  const D = plan.durationMin;
  if (min >= D && !session.nudged.has("end")){
    session.nudged.add("end");
    noteTeacher(`[Time: ${D}/${D} min — the lesson time is over. Move to the summary slide, give your summary now, and say goodbye warmly.]`, true);
    return;
  }
  const ph = plan.phases.find(p => p.start === min && p.start > 0);
  if (ph && !session.nudged.has(ph.name)){
    session.nudged.add(ph.name);
    noteTeacher(`[Time: ${min}/${D} min — move to ${ph.name}${ph.slide ? ` (slide ${ph.slide})` : ""} when the current exchange ends.]`, false);
  }
}

function countScript(text){
  session.hebChars += (text.match(/[֐-׿]/g) || []).length;
  session.latChars += (text.match(/[A-Za-z]/g) || []).length;
}

// סמנים בתשובת המורה (זרימה טקסטואלית): [[slide:N]] מעביר שקף, [[skills:...]] = הערכה באבחון
function parseMarkers(reply){
  let text = String(reply || "");
  const slides = [];
  text = text.replace(/\[\[\s*slide\s*:\s*(\d+)\s*\]\]/gi, (_, n) => { slides.push(+n); return " "; });
  let skills = null;
  text = text.replace(/\[\[\s*skills\s*:([^\]]*)\]\]/gi, (_, b) => { skills = parseSkills(b); return " "; });
  // המורה לא אמור להקריא הערות שקטות — אם חזר עליהן, מנקים
  text = text.replace(/\[(Time|Student answered|Student moved|Reading check)[^\]]*\]/g, " ");
  return {text: text.replace(/\s{2,}/g, " ").trim(), slides, skills};
}
function parseSkills(body){
  const out = {};
  String(body).split(/[,;\s]+/).forEach(kv => {
    const m = kv.match(/^(speaking|listening|reading|vocab|grammar)\s*[=:]\s*([ABC][12])$/i);
    if (m && LEVELS.includes(m[2].toUpperCase())) out[m[1].toLowerCase()] = m[2].toUpperCase();
  });
  return Object.keys(out).length ? out : null;
}

// קריאה בקול (זרימה רגילה): כמה ממה שזיהוי הדיבור קלט תואם לטקסט — מדד מקורב, מסומן ככזה
const wordsOf = s => (s || "").toLowerCase().replace(/[^a-z' ]+/g, " ").split(/\s+/).filter(Boolean);
function readingCheck(heard, text){
  const h = wordsOf(heard), t = wordsOf(text);
  if (h.length < 6 || !t.length) return null;
  const tset = new Set(t);
  const matched = h.filter(w => tset.has(w)).length;
  const hset = new Set(h);
  const missed = [...new Set(t.slice(0, Math.min(t.length, h.length + 4)))].filter(w => !hset.has(w) && w.length > 3).slice(0, 6);
  return {pct: Math.round(100 * matched / h.length), missed};
}

function scenarioFor(){
  const {plan, focus, teacher} = session;
  if (plan) return {teacher: teacher.name, topic: plan.title, lessonPlan: planText(plan, session.slide, quizDesc)};
  return {teacher: teacher.name, topic: focus?.topic || null};
}

// מנסה קודם realtime (speech-to-speech). אם ה-Worker רדום / WebRTC נכשל / כבוי בהגדרות —
// נופל בשקט לזרימה הרגילה (STT/TTS של הדפדפן עם קטיעה). תמיד יש שיעור.
async function startLesson(focus){
  if (S.settings.realtime !== false && realtimeSupported()){
    setStatus("מתחבר לקול realtime…", "thinking");
    try {
      const live = await startLive({teacher: session.teacher, topic: session.plan ? session.plan.title : focus?.topic,
        lessonPlan: session.plan ? planText(session.plan, 1, quizDesc) : null, handlers: liveHandlers()});
      if (!session || session.destroyed){ live?.close(); return; }
      if (live){
        session.live = live; session.mode = "realtime";
        // בקטיעה מובנית (VAD בשרת) אין צורך בצופה של הזרימה הרגילה
        session.ui.bargeBtn && (session.ui.bargeBtn.style.display = "none");
        setStatus(`${session.teacher.name} מתחבר…`, "speaking");
        startMouthLive();
        paintSlide();
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
    onTeacherText(text, done){ if (session?.ui) session.ui.capTeacher.textContent = text; if (done && session) countScript(text); },
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
    case "log_correction": {
      const e = logError({original: a.original, corrected: a.corrected, kind: a.kind, note: a.note_he});
      if (e) session.seenErrors.push(a.original);
      return {ok: true, timesSeen: e ? e.count : 0};
    }
    case "mark_word_used": {
      // גם מילה שהמורה לימד ואינה במילון המובנה נכנסת ל-SRS ולזיכרון: כך היא מגיעה
      // ל-reuseWords והמורה שוזר אותה בשיעורים הבאים (spaced repetition בתוך שיחה)
      const key = String(a.word || "").toLowerCase().trim();
      if (!key || key.length > 40) return {ok: false, error: "bad word"};
      const w = WORDS.find(x => wordKey(x) === key);
      review(w ? wordKey(w) : key, !!a.correct);
      logWordUse(key, !!a.correct);
      return {ok: true, inDictionary: !!w};
    }
    case "pronunciation_note":
      logPronunciation(a.word, a.issue, !!a.improved);
      return {ok: true};
    case "lesson_phase":
      if (a.phase && session.ui) session.ui.statusEl.textContent = `שלב: ${phaseHe[a.phase] || a.phase}`;
      return {ok: true};
    case "show_slide": {
      if (!session.plan) return {ok: false, error: "no lesson plan"};
      const s = showSlide(a.index, true);
      if (!s) return {ok: false, error: "no such slide"};
      // בשקף תרגיל המורה מקבל את הפריט שעל המסך (למשל משפט להקראה) — הפריטים נבחרים בזמן אמת
      return {ok: true, slide: s.i, title: s.title, type: s.type, ...(s.type === "quiz" ? {item: quizDesc(s)} : {})};
    }
    case "assess_skills": {
      const sk = parseSkills(SKILLS.map(k => a[k] ? `${k}=${a[k]}` : "").filter(Boolean).join(","));
      if (!sk) return {ok: false, error: "no valid CEFR levels"};
      session.teacherSkills = sk;
      return {ok: true, recorded: sk};
    }
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

// תשובת המורה בזרימה הטקסטואלית: סמנים → שקפים/הערכה, ואז דיבור
async function teacherTurn(reply){
  const {text, slides, skills} = parseMarkers(reply);
  slides.forEach(n => showSlide(n, true));
  if (skills) session.teacherSkills = skills;
  const spoken = text || "Let's continue.";
  countScript(spoken);
  const msg = {role: "assistant", content: spoken};
  session.messages.push(msg);
  markIfInterrupted(msg, await say(spoken));
}

async function runLesson(focus){
  const {plan} = session;
  if (plan){
    // בקורס הפתיחה היא של המורה עצמו — מחובר לשיעור הקודם ולתוכנית, לא משפט קבוע
    const first = plan.slides[0];
    session.messages.push({role: "user", note: true, content: `[The lesson is starting now. Greet the student by name, connect in one sentence to the last lesson if you know it, say in one sentence what today's lesson is about, and show slide 1 ("${first.title}") with the marker.]`});
    setStatus(`${session.teacher.name} מתחבר…`, "thinking");
    let reply = null;
    try { reply = await chat(session.messages, scenarioFor(), "lesson"); } catch { reply = null; }
    if (!session || session.destroyed) return;
    await teacherTurn(reply || `[[slide:1]] ${openingLine(session.teacher, null, plan)}`);
  } else {
    const opener = openingLine(session.teacher, focus);
    const openerMsg = {role: "assistant", content: opener};
    session.messages.push(openerMsg);
    countScript(opener);
    markIfInterrupted(openerMsg, await say(opener));
  }
  while (session && !session.destroyed){
    const turn = await getUserTurn();
    if (!session || session.destroyed) return;
    const userText = turn.text;
    if (!turn.isNote && (!userText || !userText.trim())){
      session.emptyCount++;
      if (session.emptyCount >= 3){ setStatus("מוכן כשתהיה מוכן — הקש 🎤 או הקלד", ""); continue; }
      await say(pick(["Sorry, I didn't catch that. Could you say it again?",
        "Take your time — tell me in English.", "One more time? I'm listening."]));
      continue;
    }
    session.emptyCount = 0;
    // הערות שקטות שהצטברו (זמן, מעבר שקף, תוצאות) נצמדות להודעה; קריאה בקול נבדקת מול הטקסט
    const notes = takeNotes();
    const cur = plan ? plan.slides[session.slide - 1] : null;
    if (!turn.isNote && !turn.typed && cur?.type === "story" && cur.readAloud){
      const rc = readingCheck(userText, cur.body);
      if (rc){
        session.readChecks.push(rc.pct);
        notes.push(`[Reading check (speech recognition, approximate): about ${rc.pct}% of the words the student read matched the text${rc.missed.length ? "; words not recognized as written: " + rc.missed.join(", ") : ""}. Give one or two pronunciation tips only if you are confident.]`);
      }
    }
    if (turn.isNote) notes.push(userText);
    const content = turn.isNote ? notes.join("\n") : (notes.length ? notes.join("\n") + "\n" : "") + userText;
    session.messages.push({role: "user", content, note: turn.isNote || undefined});
    setStatus(`${session.teacher.name} חושב…`, "thinking");
    session.avatar.setState("thinking");
    let reply;
    try {
      reply = await chat(session.messages.slice(-14), scenarioFor(), "lesson");
    } catch (e){
      toast(aiErrorMessage(e));
      await say("Let's try that again in a moment.");
      continue;
    }
    if (!session || session.destroyed) return;
    await teacherTurn(reply);
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

// תור המשתמש: זיהוי דיבור (או הקלדה). נפתר ב-{text, isNote, typed}; text="" אם היה שקט.
// isNote = הערה שקטה (חידון/זמן) שמבקשת תגובה מהמורה בזמן שהוא חיכה לתלמיד.
// אם התלמיד כבר קטע את המורה — המזהה כבר רץ כתור שלו, רק מחברים אליו.
function getUserTurn(){
  return new Promise(resolve => {
    session.turnRequestedAt = Date.now();
    session.metrics.firstSpeechAt = 0;
    session.pendingFinish = (text, isNote = false, typed = false) => {
      session.pendingFinish = null;
      const lat = session.metrics.firstSpeechAt - session.turnRequestedAt;
      if (!isNote && session.metrics.firstSpeechAt && lat > 0) session.metrics.latencies.push(lat);
      stopRec();
      resolve({text, isNote, typed});
    };
    if (session.carryText != null){ // הקטיעה כבר הסתיימה לפני שהתור התבקש
      const t = session.carryText; session.carryText = null;
      session.pendingFinish(t); return;
    }
    if (session.notes.some(n => n.respond)){ // הערה שמחכה לתגובה (חידון, סיום זמן) — המורה מגיב מיד
      session.pendingFinish(takeNotes().join("\n"), true); return;
    }
    if (session.barged){ session.barged = false; return; } // המזהה כבר מקשיב מהקטיעה
    if (sttOK && !session.muted && !session.typedOnly) startRecognizer("listen");
    else setStatus("הקלד תשובה ושלח 👇", "");
  });
}

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
  const {main, teacher, focus, plan} = session;
  const mode = session.mode;
  const seenErrors = session.seenErrors.slice();
  const quizAnswers = session.quizAnswers.slice();
  const readChecks = session.readChecks.slice();
  const {hebChars, latChars} = session;
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
    messages = session.messages.filter(mm => !mm.note); // הערות שקטות אינן חלק מהשיחה
    m = session.metrics;
  }
  const teacherSkills = session.teacherSkills;
  const secs = Math.round((Date.now() - session.start) / 1000);
  const userTurns = messages.filter(mm => mm.role === "user");
  const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  // מילות מילוי — נספרות רק מתמלול של דיבור אמיתי (um/uh/er/hmm/"you know").
  // בשיעור בהקלדה אין דיבור, אז לא ממציאים מדד: 0.
  const typedMode = mode === "text" && !sttOK;
  const fillers = typedMode ? 0 :
    userTurns.reduce((n, mm) => n + ((mm.content.match(/\b(um+|uh+|er+|erm|hmm+|you know)\b/gi) || []).length), 0);
  const rec = {
    date: todayStr(), teacher: teacher.id, secs, turns: userTurns.length, mode,
    studentMs: m.studentMs, teacherMs: m.teacherMs, longestMs: m.longestMs,
    avgLatencyMs: avg(m.latencies), interruptions: m.interruptions, typed: typedMode,
    fillers,
    // חלק העברית בדברי המורה — נספר מהתמלול (מדד אמיתי לכלל "פחות עברית ככל שעולים")
    hebrewPct: hebChars + latChars > 0 ? Math.round(100 * hebChars / (hebChars + latChars)) : null,
    lesson: plan ? plan.n : null,
    quiz: quizAnswers.length ? {correct: quizAnswers.filter(a => a.correct).length, total: quizAnswers.length} : null,
    readingMatchPct: readChecks.length ? Math.round(readChecks.reduce((a, b) => a + b, 0) / readChecks.length) : null,
  };
  teardown();

  if (userTurns.length === 0 && quizAnswers.length === 0){ renderClassroom(main, plan ? "course" : "free"); return; }

  const prev = (S.liveLessons || []).slice(-1)[0] || null;
  S.liveLessons = [...(S.liveLessons || []), rec].slice(-50);
  save();

  skillResult("speaking", true);
  // זמן דיבור: הערך שנמדד; בהקלדה (ללא מיקרופון) אין דיבור נמדד — לא ממציאים
  if (rec.studentMs > 0) logDay({speakSec: Math.round(rec.studentMs / 1000)});
  addXP(15 + userTurns.length * 6 + (plan ? 20 : 0), plan ? `שיעור ${plan.n}` : "שיעור חי");

  main.replaceChildren(el("div", {class: "screen"},
    el("div", {class: "card center"}, el("div", {class: "muted"}, `${teacher.name} מכין לך סיכום מהשיעור…`))));

  const transcript = messages.map(mm => `${mm.role === "user" ? "Student" : "Teacher"}: ${stripNotes(mm.content)}`).join("\n");
  let fb = null;
  if (userTurns.length){
    try {
      fb = await feedback(transcript);
      // תיקונים מהמשוב הטקסטואלי נכנסים לאותו זיכרון מובנה (בזרימה הרגילה אין כלים)
      (fb.mistakes || []).slice(0, 5).forEach(mm => {
        if (mm.original){ logError({original: mm.original, corrected: mm.better, note: mm.note}); seenErrors.push(mm.original); }
      });
    } catch { fb = null; }
  }
  // קורס: סיום השיעור קובע/מעדכן רמות לפי מדידה, ומכין את השיעור הבא מיד
  const courseRes = plan ? completeLesson(plan, {quizAnswers, teacherSkills, secs, mode}) : null;
  // סוף שיעור בזיכרון: recap לפתיחה הבאה, וטעויות שלא חזרו 3 שיעורים → "נלמדו"
  finishLessonMemory({topic: plan ? `Lesson ${plan.n}: ${plan.title}` : (focus?.he || null), mode, seenErrors, fillers, minutes: Math.max(1, Math.round(secs / 60))});
  renderSummary(main, fb, rec, prev, teacher, teacherSummary, {plan, courseRes, teacherSkills, quizAnswers});
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

function renderSummary(main, fb, rec, prev, teacher, teacherSummary = null, {plan = null, courseRes = null, teacherSkills = null, quizAnswers = []} = {}){
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
    row("מילות מילוי (um/uh)", String(rec.fillers || 0), rec.fillers && prev?.fillers != null ? el("span", {class: "muted small-text"}, `בקודם: ${prev.fillers}`) : null),
  ] : [row("זמן דיבור", "לא נמדד", el("span", {class: "muted small-text"}, "השיעור היה בהקלדה"))];
  if (rec.quiz) measured.push(row("תרגילים קצרים", `${rec.quiz.correct}/${rec.quiz.total} נכון`, el("span", {class: "muted small-text"}, "נמדד מהתשובות על המסך")));
  if (rec.readingMatchPct != null) measured.push(row("קריאה בקול — התאמה לטקסט", `${rec.readingMatchPct}%`, el("span", {class: "muted small-text"}, "מקורב, לפי זיהוי דיבור")));
  if (rec.hebrewPct != null) measured.push(row("עברית בדברי המורה", `${rec.hebrewPct}%`, prev?.hebrewPct != null ? el("span", {class: "muted small-text"}, `בקודם: ${prev.hebrewPct}%`) : null));
  // מה המורה זוכר אחרי השיעור הזה — טעויות שחזרו, מה כבר נלמד, מילים בחיזוק
  const mem = memorySummary();
  const memCard = (mem.recurring.length || mem.resolved.length || mem.reinforcing.length) ? el("div", {class: "card"},
    el("h3", {}, "🧠 מה המורה זוכר"),
    el("ul", {class: "metrics-list"},
      mem.recurring.length ? row("טעויות שעדיין חוזרות", String(mem.recurring.length),
        el("span", {class: "muted small-text", dir: "ltr"}, mem.recurring.slice(0, 2).map(e => `${e.original} → ${e.corrected}`).join(" · "))) : null,
      mem.resolved.length ? row("טעויות שכבר נלמדו ✓", String(mem.resolved.length),
        el("span", {class: "muted small-text", dir: "ltr"}, mem.resolved.slice(0, 2).map(e => e.corrected).join(" · "))) : null,
      mem.reinforcing.length ? row("מילים בחיזוק", String(mem.reinforcing.length),
        el("span", {class: "muted small-text", dir: "ltr"}, mem.reinforcing.slice(0, 4).map(w => w.word).join(", "))) : null)) : null;

  main.replaceChildren(el("div", {class: "screen"},
    el("div", {class: "card center"},
      el("div", {class: "summary-emoji"}, "🎓"),
      el("h2", {}, plan ? `Lesson ${plan.n} — ${plan.title}` : `סיכום השיעור עם ${teacher.name}`),
      el("p", {class: "muted"}, `${teacher.name} · ${Math.round(rec.secs / 60)} דקות · ${rec.turns} תשובות שלך · ${rec.mode === "realtime" ? "קול realtime" : "זרימה רגילה"}`)),
    courseCards(plan, courseRes, teacherSkills, quizAnswers),
    teacherSummary ? el("div", {class: "card"},
      el("h3", {}, `🧑‍🏫 הסיכום של ${teacher.name}`),
      el("p", {dir: "ltr"}, el("strong", {}, "Improved: "), teacherSummary.improved),
      el("p", {dir: "ltr"}, el("strong", {}, "Still weak: "), teacherSummary.weak),
      el("p", {dir: "ltr"}, el("strong", {}, "Next time: "), teacherSummary.next)) : null,
    el("div", {class: "card"},
      el("h3", {}, "📏 מה נמדד בפועל"),
      el("ul", {class: "metrics-list"}, measured)),
    memCard,
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
    el("button", {class: "btn primary big", onclick: () => renderClassroom(main, plan ? "course" : "free")}, plan ? "לשיעור הבא" : "שיעור נוסף"),
    el("button", {class: "btn ghost", onclick: () => { location.hash = "#/home"; }}, "לדף הבית")));
}

// כרטיסי הקורס בסיכום: פרופיל לפי מיומנות (אבחון/בדיקה), מילות השיעור, והשיעור הבא שכבר מוכן
function courseCards(plan, courseRes, teacherSkills, quizAnswers = []){
  if (!plan || !courseRes) return null;
  const cards = [];
  if (plan.kind === "placement" || plan.kind === "check"){
    const detail = quizDetail(quizAnswers);
    cards.push(el("div", {class: "card"},
      el("h3", {}, plan.kind === "placement" ? "🎯 הפרופיל שלך — רמת התחלה לכל מיומנות" : "📈 בדיקת התקדמות — רמות מעודכנות"),
      el("div", {class: "skills-grid"}, [...SKILLS, "pronunciation"].map(k => {
        const lv = courseRes.skills[k];
        const before = courseRes.before[k];
        // מקור הרמה — כדי שלא ייראה "נמדד" מה שלא נמדד. דיבור: רק הערכת המורה; אחרת "לא נמדד".
        let src = "לא נמדד הפעם";
        if (k === "speaking") src = teacherSkills?.speaking ? "הערכת המורה בשיחה" : "לא נמדד";
        else if (detail[k]) src = detail[k].confident ? `נמדד · ${detail[k].items} פריטים` : `לא מבוסס (${detail[k].items} פריטים)`;
        const changed = before && lv && before !== lv;
        return el("div", {class: "skill-box" + (lv ? "" : " na")},
          el("div", {class: "lv"}, lv || "—"),
          el("div", {class: "lb"}, SKILL_HE[k]),
          el("div", {class: "lb"}, lv ? (changed ? `${before} → ${lv} · ${src}` : src) : (k === "speaking" ? "לא נמדד — המורה לא העריך" : "לא נמדד")));
      })),
      el("p", {class: "muted small-text"}, plan.kind === "placement"
        ? "שמיעה/קריאה/מילים/דקדוק נמדדו מתרגיל אדפטיבי (A1–C2, 3–6 פריטים למיומנות, רמה נקבעת רק עם ביסוס); דיבור — רק מהערכת המורה בשיחה. מה שלא נמדד נשאר \"לא נמדד\"."
        : "רמה עולה רק כשנמדד שיפור. אם משהו לא עלה — זה לא כישלון, זה יעד לשיעורים הבאים.")));
  }
  if (plan.vocab?.length){
    const keys = plan.vocab.map(v => v[0].toLowerCase());
    const missing = keys.filter(k => !S.srs[k]);
    const btn = missing.length ? el("button", {class: "btn ghost small", onclick: (ev) => {
      missing.forEach(k => ensureEntry(k)); save();
      ev.currentTarget.replaceWith(el("span", {class: "chip good"}, "נוספו לחזרה ✓"));
    }}, `➕ הוסף ${missing.length} מילים לחזרה`) : el("span", {class: "chip good"}, "כבר בחזרה ✓");
    cards.push(el("div", {class: "card"},
      el("h3", {}, "🆕 מילות השיעור"),
      el("div", {class: "slide-vocab"}, plan.vocab.map(([w, h]) => el("div", {}, el("b", {}, w), el("span", {}, h)))),
      btn));
  }
  const next = ensureNextLesson();
  const t = teacherById(next.teacherId);
  cards.push(el("div", {class: "card next-lesson"},
    el("div", {class: "nl-top"}, el("span", {class: "nl-label"}, "השיעור הבא כבר מוכן"), el("span", {class: "nl-when"}, fmtSchedule() || "")),
    el("div", {class: "nl-title", dir: "ltr"}, `Lesson ${next.n} — ${next.title}`),
    el("div", {class: "muted small-text"}, `${next.he} · ${t.name} · ${next.durationMin} דקות${next.reviewWords?.length ? " · חזרה על: " + next.reviewWords.slice(0, 3).join(", ") : ""}`)));
  return cards;
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
  if (session.nudgeInt) clearInterval(session.nudgeInt);
  session.camStream?.getTracks().forEach(t => t.stop());
  session.avatar?.destroy();
  session = null;
}

function openingLine(teacher, focus, plan = null){
  const name = S.profile.name ? ` ${S.profile.name}` : "";
  if (plan) return `Hi${name}! I'm ${teacher.name}. Welcome to lesson ${plan.n} — ${plan.title}. Let's start with the first slide. ${plan.slides[1]?.type === "prompt" ? plan.slides[1].body : "How are you today?"}`;
  const topic = focus.id === "free" ? "" :
    ` Today let's practice ${focus.en}.`;
  return `Hi! I'm ${teacher.name}, your English teacher. It's really nice to meet you!${topic} Let's keep it relaxed — just talk with me. So, how are you feeling today?`;
}
