// מנוע הקורס: שיעור אבחון, פרופיל לפי מיומנות, מסלול שיעורים אישי, שקפים, תוכנית זמנים,
// הכנת השיעור הבא לפי הזיכרון, ותזמון. הכול מקומי (localStorage) — "המורה מכינה שיעור לפני שהתלמיד מגיע".
import { S, save, memorySummary } from "./store.js";
import { TOPICS, topicById, bandFor } from "./data/course.js";
import { BANK, LEVELS } from "./data/test.js";
import { hardWords } from "./srs.js";
import { shuffle, todayStr } from "./util.js";

export const DURATIONS = [20, 30, 45];
export const WEEKDAYS_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
export const SKILLS = ["speaking", "listening", "reading", "vocab", "grammar"];
export const SKILL_HE = {speaking: "דיבור", listening: "שמיעה", reading: "קריאה", vocab: "אוצר מילים", grammar: "דקדוק", pronunciation: "הגייה"};
const CHECK_EVERY = 8; // כל 8 שיעורים — Progress Check

export function course(){ return S.course; }
export function isPlacementDone(){ return !!S.course.placementDone; }
const lvlIdx = l => Math.max(0, LEVELS.indexOf(l));
const lvlAt = i => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i))];

// רמת דיבור נוכחית (בסיס להתאמת קושי); לפני האבחון — הרמה הכללית מהפרופיל
export function speakingLevel(){ return S.course.skills.speaking || S.profile.level || "A2"; }
export function readingLevel(){ return S.course.skills.reading || S.profile.level || "A2"; }

// ---------- תזמון ----------
export function setSchedule({weekday, time, durationMin, teacherId}){
  S.course.schedule = {weekday, time, durationMin, teacherId};
  if (S.course.next){ S.course.next.teacherId = teacherId; S.course.next.durationMin = durationMin; S.course.next.phases = phasesFor(S.course.next, durationMin); }
  save();
}
// המועד הבא (Date) לפי יום/שעה; null אם לא נקבע
export function nextScheduledDate(){
  const sc = S.course.schedule;
  if (!sc || sc.weekday == null || !sc.time) return null;
  const [h, m] = sc.time.split(":").map(Number);
  const now = new Date();
  const d = new Date(now); d.setHours(h, m, 0, 0);
  let delta = (sc.weekday - d.getDay() + 7) % 7;
  if (delta === 0 && d <= now) delta = 7;
  d.setDate(d.getDate() + delta);
  return d;
}
export function fmtSchedule(){
  const d = nextScheduledDate(); const sc = S.course.schedule;
  if (!d) return null;
  const isToday = d.toDateString() === new Date().toDateString();
  return `${isToday ? "היום" : "יום " + WEEKDAYS_HE[d.getDay()]} · ${sc.time}`;
}

// ---------- השיעור הבא — מוכן מראש ----------
export function ensureNextLesson(){
  if (!S.course.next){
    S.course.next = S.course.placementDone ? buildLesson(S.course.done.length + 1) : buildPlacementLesson();
    save();
  }
  return S.course.next;
}
// בנייה מחדש (למשל אחרי שינוי רמה/מורה) — שומר על אותו מספר שיעור
export function rebuildNextLesson(){
  S.course.next = null; return ensureNextLesson();
}

function baseFields(kind, n){
  const sc = S.course.schedule || {};
  return {kind, n, teacherId: sc.teacherId || "sarah", durationMin: sc.durationMin || 30, createdAt: todayStr(), status: "ready"};
}

// חידון נמדד: שאלה אחת לכל (מיומנות, רמה) מבנק השאלות של מבחן הרמה
function quizSlides(levels){
  const typeToSkill = {vocab: "vocab", grammar: "grammar", sentence: "grammar", listen: "listening", read: "reading"};
  const out = [];
  for (const skill of ["listening", "reading", "vocab", "grammar"]){
    for (const lvl of levels){
      const pool = (BANK[lvl] || []).filter(q => typeToSkill[q.type] === skill);
      if (!pool.length) continue;
      const q = shuffle(pool)[0];
      out.push({type: "quiz", skill, level: lvl, title: `${SKILL_HE[skill]} · ${lvl}`,
        q: q.q, opts: q.opts, a: q.a, say: q.say || null, text: q.text || null});
    }
  }
  return out;
}

// שיעור 1 — אבחון: שיחה + חידונים נמדדים + קריאה בקול + משימות דיבור
export function buildPlacementLesson(){
  const lvl = S.profile.level || "A2";
  const band = bandFor(lvl);
  const topic = topicById("intro");
  const slides = [
    {type: "title", title: "Lesson 1 — Getting to know you", body: "שיעור היכרות ואבחון: שיחה, קצת קריאה וכמה שאלות קצרות. לא מבחן — בסוף המורה תדע איפה אתה חזק ומה לחזק."},
    {type: "prompt", title: "Tell me about yourself", body: "Where you live, what you do, your family, what you like. Take your time."},
    ...quizSlides(["A2", "B1", "B2"]),
    {type: "story", title: "Read aloud", body: topic.story[band], readAloud: true},
    {type: "questions", title: "Let's talk about it", items: topic.questions.slice(0, 3)},
    {type: "prompt", title: "Describe the situation", body: "You are late for an important meeting and your car won't start. What do you do? Describe it step by step."},
    {type: "prompt", title: "Tell me a story", body: "Tell me about a trip, a funny day, or a problem you solved — with a beginning, a middle, and an end (about a minute)."},
    {type: "summary", title: "Your profile", body: "המורה תסכם: רמת התחלה לכל מיומנות ומה נלמד בשיעור הבא."},
  ];
  slides.forEach((s, i) => s.i = i + 1);
  const plan = {...baseFields("placement", 1), topicId: "intro", title: "Getting to know you", he: "היכרות ואבחון",
    goals: ["להכיר אותך", "לקבוע רמת התחלה לכל מיומנות — מדידה, לא ניחוש"], vocab: [], reviewWords: [], reviewErrors: [], grammar: null, slides};
  plan.phases = phasesFor(plan, plan.durationMin);
  return plan;
}

// בחירת הנושא הבא: לפי המסלול, לא נושאים שנעשו, ברמה מתאימה; טעות חוזרת בעבר → מקדימים "past"
function pickTopic(){
  const done = new Set(S.course.done.map(d => d.topicId).filter(Boolean));
  const sl = lvlIdx(speakingLevel());
  const mem = memorySummary();
  const pastError = mem.recurring.some(e => /\b(go|see|eat|have|do|come|take)\b.*\b(yesterday|last|ago)\b|\b(yesterday|last week|ago)\b.*\b(go|see|eat|come)\b/i.test(e.original));
  const candidates = TOPICS.filter(t => !done.has(t.id) && lvlIdx(t.level) <= sl + 1);
  if (pastError){ const p = candidates.find(t => t.id === "past"); if (p) return p; }
  // הכי קרוב לרמה קודם (כדי שלא לקפוץ), ואז לפי סדר המסלול
  candidates.sort((a, b) => Math.abs(lvlIdx(a.level) - sl) - Math.abs(lvlIdx(b.level) - sl) || TOPICS.indexOf(a) - TOPICS.indexOf(b));
  return candidates[0] || TOPICS[done.size % TOPICS.length];
}

export function buildLesson(n){
  // כל 8 שיעורים — בדיקת התקדמות במקום נושא חדש
  if (S.course.placementDone && n > 1 && (n - 1) % CHECK_EVERY === 0) return buildCheckLesson(n);
  const topic = pickTopic();
  const band = bandFor(readingLevel());
  const mem = memorySummary();
  const reviewWords = [...new Set([
    ...mem.reinforcing.map(w => w.word),
    ...(S.course.done.slice(-1)[0]?.vocab || []).map(v => v[0]),
    ...hardWords(3).map(w => w.w),
  ])].slice(0, 5);
  const reviewErrors = mem.recurring.slice(0, 2).map(e => ({original: e.original, corrected: e.corrected}));
  const heFor = w => { const t = TOPICS.flatMap(t => t.vocab).find(v => v[0] === w); return t ? t[1] : ""; };
  const slides = [
    {type: "title", title: `Lesson ${n} — ${topic.title}`, body: topic.goals.join(" · ")},
    {type: "review", title: "Review", items: reviewWords.map(w => [w, heFor(w)]), errors: reviewErrors},
    {type: "vocab", title: "Today's words", items: topic.vocab},
    {type: "story", title: "Read aloud", body: topic.story[band], readAloud: true},
    {type: "questions", title: "Let's talk about it", items: topic.questions},
    {type: "grammar", title: topic.grammar.name, body: topic.grammar.tip},
    {type: "challenge", title: "Challenge", body: topic.challenge},
    {type: "summary", title: "Summary", body: "מילים חדשות · טעויות חשובות · מה השתפר · מה בשיעור הבא"},
  ];
  slides.forEach((s, i) => s.i = i + 1);
  const plan = {...baseFields("lesson", n), topicId: topic.id, title: topic.title, he: topic.he, goals: topic.goals,
    vocab: topic.vocab, reviewWords, reviewErrors, grammar: topic.grammar, band, slides};
  plan.phases = phasesFor(plan, plan.durationMin);
  return plan;
}

// Progress Check: שיחה + חידונים נמדדים ברמה הנוכחית ומעליה + קריאה + סיפור. מעלים רמה רק אם נמדד שיפור.
export function buildCheckLesson(n){
  const lv = speakingLevel();
  const levels = [lv, lvlAt(lvlIdx(lv) + 1)].filter((v, i, a) => a.indexOf(v) === i);
  const topic = TOPICS[(n + 3) % TOPICS.length];
  const band = bandFor(lvlAt(lvlIdx(readingLevel()) + 1));
  const slides = [
    {type: "title", title: `Lesson ${n} — Progress check`, body: "לא מבחן: שיחה, קריאה, קצת האזנה ותרגילים — כדי לראות אם אפשר לעלות רמה."},
    {type: "prompt", title: "Catch me up", body: "What's new since we started? Tell me about your week in detail."},
    ...quizSlides(levels),
    {type: "story", title: "Read aloud", body: topic.story[band], readAloud: true},
    {type: "questions", title: "Let's talk about it", items: topic.questions.slice(1, 4)},
    {type: "prompt", title: "Fluency challenge", body: "Tell me a story for 90 seconds. I won't interrupt."},
    {type: "summary", title: "Your progress", body: "מה השתפר בפועל, ואיפה הרמה החדשה."},
  ];
  slides.forEach((s, i) => s.i = i + 1);
  const plan = {...baseFields("check", n), topicId: null, title: "Progress check", he: "בדיקת התקדמות", goals: ["למדוד אם היכולות עלו בפועל"],
    vocab: [], reviewWords: [], reviewErrors: [], grammar: null, band, slides};
  plan.phases = phasesFor(plan, plan.durationMin);
  return plan;
}

// תוכנית זמנים לפי משך — שלבים בדקות עם השקף שמתחיל אותם
export function phasesFor(plan, durationMin){
  const D = durationMin || 30;
  const s = t => plan.slides.find(x => x.type === t);
  let spec;
  if (plan.kind === "lesson"){
    spec = [["small talk", 3, null], ["review", 4, s("review")], ["vocabulary", 5, s("vocab")], ["reading", 5, s("story")],
      ["discussion", 7, s("questions")], ["grammar", 3, s("grammar")], ["challenge", 2, s("challenge")], ["summary", 1, s("summary")]];
  } else {
    const firstQuiz = plan.slides.find(x => x.type === "quiz");
    const prompts = plan.slides.filter(x => x.type === "prompt");
    spec = [["warm-up", 3, prompts[0]], ["short exercises", 8, firstQuiz], ["reading", 6, s("story")], ["discussion", 5, s("questions")],
      ["speaking tasks", 6, prompts[1] || null], ["summary", 2, s("summary")]];
  }
  const total = spec.reduce((a, x) => a + x[1], 0);
  let t = 0;
  return spec.map(([name, w, slide]) => {
    const len = Math.max(1, Math.round(w * D / total));
    const ph = {name, start: t, end: Math.min(D, t + len), slide: slide ? slide.i : null};
    t += len; return ph;
  });
}

// ---------- סיום שיעור: מדידה, רמות, השיעור הבא ----------
// quizAnswers: [{skill, level, correct}]; teacherSkills: {speaking:"B1",...} (הערכת המורה) או null
export function completeLesson(plan, {quizAnswers = [], teacherSkills = null, secs = 0, mode = "text"} = {}){
  const measured = skillLevelsFromQuiz(quizAnswers);
  const before = {...S.course.skills};
  if (plan.kind === "placement" || plan.kind === "check"){
    for (const sk of ["listening", "reading", "vocab", "grammar"]){
      const m = measured[sk];
      if (!m) continue;
      // באבחון קובעים; בבדיקת התקדמות מעלים רק אם נמדד גבוה יותר (לא מורידים אוטומטית)
      if (plan.kind === "placement" || lvlIdx(m) > lvlIdx(S.course.skills[sk] || "A1")) S.course.skills[sk] = m;
    }
    if (teacherSkills?.speaking && LEVELS.includes(teacherSkills.speaking)){
      const t = teacherSkills.speaking;
      if (plan.kind === "placement" || lvlIdx(t) > lvlIdx(S.course.skills.speaking || "A1")) S.course.skills.speaking = t;
    }
    // דיבור לא נמדד בחידון; אם המורה לא העריך — נשאר לפי הרמה הכללית
    if (!S.course.skills.speaking) S.course.skills.speaking = S.profile.level || measured.vocab || "A2";
    // הרמה הכללית = חציון המיומנויות (ההרגשה של "איפה אני")
    const vals = SKILLS.map(k => S.course.skills[k]).filter(Boolean).map(lvlIdx).sort((a, b) => a - b);
    if (vals.length) S.profile.level = lvlAt(vals[Math.floor((vals.length - 1) / 2)]);
    if (plan.kind === "placement") S.course.placementDone = true;
  }
  S.course.done.push({n: plan.n, kind: plan.kind, topicId: plan.topicId, title: plan.title, date: todayStr(), secs, mode,
    vocab: plan.vocab, quiz: quizAnswers, teacherSkills, skillsBefore: before, skillsAfter: {...S.course.skills}});
  if (S.course.done.length > 100) S.course.done = S.course.done.slice(-100);
  S.course.next = null;
  save();
  ensureNextLesson(); // המורה מכינה את השיעור הבא מיד
  return {measured, skills: {...S.course.skills}, before};
}

// רמה לכל מיומנות מתשובות נמדדות: הרמה הגבוהה ביותר שכל הרמות עד אליה נענו נכון
export function skillLevelsFromQuiz(answers){
  const out = {};
  for (const sk of ["listening", "reading", "vocab", "grammar"]){
    const mine = answers.filter(a => a.skill === sk);
    if (!mine.length) continue;
    const ok = new Set(mine.filter(a => a.correct).map(a => a.level));
    const asked = [...new Set(mine.map(a => a.level))].sort((a, b) => lvlIdx(a) - lvlIdx(b));
    let level = null;
    for (const l of asked){ if (ok.has(l)) level = l; else break; }
    out[sk] = level || lvlAt(lvlIdx(asked[0]) - 1);
  }
  return out;
}

// ---------- טקסט התוכנית למורה ----------
export function planText(plan, currentSlide = 1){
  const L = [];
  L.push(`LESSON PLAN — Lesson ${plan.n}: ${plan.title} (${plan.kind}). Duration ${plan.durationMin} min. Goals: ${plan.goals.join("; ")}.`);
  L.push("Phases (minutes): " + plan.phases.map(p => `${p.name} ${p.start}-${p.end}${p.slide ? " → slide " + p.slide : ""}`).join(" | "));
  L.push("SLIDES — you control them. The student sees one slide at a time. Current slide: " + currentSlide + ".");
  for (const s of plan.slides){
    let d = `Slide ${s.i} [${s.type}] ${s.title}: `;
    if (s.type === "review") d += `words to quiz both ways (EN→HE and HE→EN): ${s.items.map(([w, h]) => `${w}=${h}`).join(", ")}` + (s.errors?.length ? `; recurring errors to revisit: ${s.errors.map(e => `"${e.original}" → "${e.corrected}"`).join("; ")}` : "");
    else if (s.type === "vocab") d += s.items.map(([w, h]) => `${w}=${h}`).join(", ");
    else if (s.type === "story") d += `ask the student to READ IT ALOUD, then comprehension → vocabulary (ask meanings in Hebrew) → opinion → personal experience. Text: "${s.body}"`;
    else if (s.type === "questions") d += s.items.join(" / ");
    else if (s.type === "quiz") d += `${s.skill} ${s.level}. ${s.say ? `First READ THIS ALOUD once (do not show it): "${s.say}". ` : ""}${s.text ? `Passage on slide: "${s.text}". ` : ""}Question: "${s.q}" Options: ${s.opts.map((o, i) => `${"ABCD"[i]}) ${o}`).join(" ")} (correct: ${"ABCD"[s.a]}). The student answers ON SCREEN; you will get a note with the result — react briefly and move on.`;
    else d += s.body || "";
    L.push(d);
  }
  return L.join("\n");
}

// ---------- התקדמות לאורך זמן — רק ממדידות ----------
export function progressionStats(){
  const ls = (S.liveLessons || []).filter(l => l.studentMs > 0);
  if (ls.length < 2) return null;
  const first = ls[0], last = ls[ls.length - 1];
  const out = {lessons: ls.length, longestFirst: first.longestMs, longestLast: last.longestMs,
    studentPctFirst: pct(first), studentPctLast: pct(last)};
  if (first.hebrewPct != null && last.hebrewPct != null){ out.hebrewFirst = first.hebrewPct; out.hebrewLast = last.hebrewPct; }
  return out;
  function pct(l){ const t = l.studentMs + l.teacherMs; return t ? Math.round(100 * l.studentMs / t) : null; }
}
