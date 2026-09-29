// מצב האפליקציה + שמירה ב-localStorage. מבנה אחד מרכזי, גרסה לצורכי מיגרציה.
import { todayStr } from "./util.js";

const KEY = "english-app-v1";

function defaults(){
  return {
    version: 1,
    profile: {
      name: "",
      level: null,            // A1..C2
      goals: [],              // מזהי מטרות
      minutesPerDay: 10,
      reminderTime: "20:00",
      weakSkills: [],         // speaking / listening / reading / writing / vocab / grammar
      interests: [],
      onboarded: false,
      englishOnly: false,
      createdAt: todayStr(),
    },
    srs: {},                  // wordKey -> {status, ease, interval, due, ok, fail, saved}
    skills: {                 // ציון מצטבר 0-100 לכל מיומנות — מזין את בניית האימון
      vocab: 50, grammar: 50, listening: 50, reading: 50, speaking: 50, writing: 50,
    },
    game: {
      xp: 0,
      streak: 0,
      bestStreak: 0,
      lastActive: null,       // תאריך פעילות אחרון שנספר לרצף
      freezes: 1,             // הקפאות רצף זמינות
      achievements: [],       // מזהים
    },
    stats: {
      days: {},               // date -> {minutes, xp, words, speakSec, correct, wrong, lessons}
      totalWords: 0,
      totalLessons: 0,
      totalSpeakSec: 0,
    },
    mistakes: [],             // {text, kind, date} — דפוסי טעויות לחיזוק
    grammarDone: {},          // topicId -> {ok, fail}
    readingDone: {},          // articleId -> true
    challenge: {date: null, idx: 0, done: false},
    lessonDate: null,         // תאריך האימון היומי האחרון שהושלם
    teacherHistory: [],       // צ'אט עם המורה
    liveLessons: [],          // מדדים שנמדדו בפועל בכל שיעור חי — להשוואה בין שיעורים
    memory: {                 // זיכרון מובנה לטווח ארוך — המורה הקבוע "מכיר אותך"
      errors: {},             // key -> {original, corrected, kind, note, count, lastSeen, missed, resolved}
      words: {},              // word -> {introduced, reusedOk, reusedBad, lastSeen} — מילים שהמורה לימד
      pronunciation: {},      // word -> {issue, count, improved, lastSeen} — רק מה שנשמע באמת
      lastLesson: null,       // {date, topic, mode, fillers, minutes, recap}
    },
    course: {                 // הקורס: אבחון, פרופיל לפי מיומנות, מסלול שיעורים, השיעור הבא מוכן מראש, תזמון
      placementDone: false,
      skills: {speaking: null, listening: null, reading: null, vocab: null, grammar: null, pronunciation: null},
      done: [],               // שיעורים שהושלמו
      next: null,             // תוכנית השיעור הבא (שקפים, שלבים) — מוכנה לפני שלוחצים Start
      schedule: null,         // {weekday, time, durationMin, teacherId}
    },
    settings: {
      theme: "system",
      aiUrl: "https://english-ai.meirco199.workers.dev",
      pushUrl: "https://english-push.meirco199.workers.dev", // שרת התזכורות (Web Push)
      notifs: false,
      voiceRate: 1,
      bargeIn: true,          // קטיעה של המורה באמצע דיבור (שיעור חי)
      liveUrl: "https://english-live.meirco199.workers.dev", // שרת ה-realtime (OpenAI) — רדום בלי מפתח
      realtime: true,         // לנסות realtime כשזמין; אחרת הזרימה הרגילה
    },
  };
}

export let S = load();

function load(){
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const d = defaults(), s = JSON.parse(raw);
    // מיזוג רדוד עם ברירות מחדל כדי ששדות חדשים לא יחסרו אחרי עדכון.
    // ממזגים רק כשגם ברירת המחדל וגם הערך השמור הם אובייקטים אמיתיים —
    // אחרת ברירת מחדל null (כמו lessonDate) הייתה "מפזרת" מחרוזת לאובייקט תווים.
    const isPlainObj = v => v && typeof v === "object" && !Array.isArray(v);
    for (const k of Object.keys(d)){
      if (s[k] === undefined) s[k] = d[k];
      else if (isPlainObj(d[k]) && isPlainObj(s[k])) s[k] = {...d[k], ...s[k]};
    }
    return s;
  } catch { return defaults(); }
}

export function save(){ localStorage.setItem(KEY, JSON.stringify(S)); }

export function resetAll(){
  localStorage.removeItem(KEY);
  S = defaults();
}

// רישום פעילות יומית (דקות, XP, מילים וכו') לצורכי סטטיסטיקה ודוח שבועי
export function logDay(patch){
  const d = todayStr();
  const day = S.stats.days[d] || {minutes:0, xp:0, words:0, speakSec:0, correct:0, wrong:0, lessons:0};
  for (const [k, v] of Object.entries(patch)) day[k] = (day[k] || 0) + v;
  S.stats.days[d] = day;
  if (patch.words) S.stats.totalWords += patch.words;
  if (patch.lessons) S.stats.totalLessons += patch.lessons;
  if (patch.speakSec) S.stats.totalSpeakSec += patch.speakSec;
  save();
}

// עדכון ציון מיומנות בממוצע נע — משפיע על הרכב האימון היומי
export function skillResult(skill, correct){
  const cur = S.skills[skill] ?? 50;
  S.skills[skill] = Math.max(5, Math.min(98, Math.round(cur * 0.9 + (correct ? 100 : 0) * 0.1)));
  logDay(correct ? {correct: 1} : {wrong: 1});
  save();
}

export function weakestSkills(n = 2){
  return Object.entries(S.skills).sort((a, b) => a[1] - b[1]).slice(0, n).map(e => e[0]);
}

export function recordMistake(text, kind){
  S.mistakes.push({text: (text || "").slice(0, 200), kind, date: todayStr()});
  if (S.mistakes.length > 200) S.mistakes = S.mistakes.slice(-200);
  save();
}

// ---------- זיכרון מובנה לטווח ארוך ----------
const normKey = s => String(s || "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

// תיקון שהמורה עשה (משמעותי/חוזר). חזרה על אותה טעות מגדילה ספירה ומבטלת "נלמדה".
export function logError({original, corrected = "", kind = "significant", note = ""} = {}){
  const key = normKey(original);
  if (!key) return null;
  const e = S.memory.errors[key] || {original: String(original).slice(0, 120), corrected: "", kind, note: "", count: 0, lastSeen: null, missed: 0, resolved: false};
  e.count++; e.lastSeen = todayStr(); e.missed = 0; e.resolved = false;
  if (corrected) e.corrected = String(corrected).slice(0, 120);
  if (kind === "recurring") e.kind = "recurring";
  if (note) e.note = String(note).slice(0, 160);
  S.memory.errors[key] = e;
  recordMistake(`${e.original} → ${e.corrected}${e.note ? " · " + e.note : ""}`, "grammar"); // תאימות למסכים הקיימים
  save();
  return e;
}

// התלמיד השתמש (נכון/לא) במילה שהמורה לימד
export function logWordUse(word, correct){
  const w = normKey(word);
  if (!w) return;
  const m = S.memory.words[w] || {introduced: todayStr(), reusedOk: 0, reusedBad: 0, lastSeen: null};
  correct ? m.reusedOk++ : m.reusedBad++;
  m.lastSeen = todayStr();
  S.memory.words[w] = m;
  save();
}

// בעיית הגייה שהמורה שמע בפועל (לא ניתוח מספרי)
export function logPronunciation(word, issue = "", improved = false){
  const w = normKey(word);
  if (!w) return;
  const p = S.memory.pronunciation[w] || {issue: "", count: 0, improved: 0, lastSeen: null};
  p.count++; if (issue) p.issue = String(issue).slice(0, 120); if (improved) p.improved++;
  p.lastSeen = todayStr();
  S.memory.pronunciation[w] = p;
  recordMistake(`pronunciation: ${w} — ${p.issue}${improved ? " (improved)" : ""}`, "pronunciation");
  save();
}

// סוף שיעור: טעות שלא חזרה 3 שיעורים ברצף נחשבת "נלמדה" — המורה לא יציק איתה עוד,
// אלא אם תחזור (ואז logError מחזיר אותה לתרגול). שומר recap לפתיחת השיעור הבא.
export function finishLessonMemory({topic = null, mode = "text", seenErrors = [], fillers = 0, minutes = 0} = {}){
  const seen = new Set(seenErrors.map(normKey));
  for (const [k, e] of Object.entries(S.memory.errors)){
    if (seen.has(k)) continue;
    e.missed = (e.missed || 0) + 1;
    if (e.missed >= 3) e.resolved = true;
  }
  const recurring = Object.values(S.memory.errors).filter(e => !e.resolved && e.count >= 2)
    .sort((a, b) => b.count - a.count).slice(0, 2);
  S.memory.lastLesson = {date: todayStr(), topic, mode, fillers, minutes,
    recap: recurring.map(e => `"${e.original}" → "${e.corrected}"`).join("; ")};
  save();
}

// תמצית הזיכרון — לפרופיל הלומד שנשלח למורה ולתצוגה למשתמש
export function memorySummary(){
  const errs = Object.values(S.memory.errors);
  const byRecent = (a, b) => (b.lastSeen || b.introduced || "").localeCompare(a.lastSeen || a.introduced || "");
  return {
    recurring: errs.filter(e => !e.resolved && e.count >= 2).sort((a, b) => b.count - a.count).slice(0, 5),
    once: errs.filter(e => !e.resolved && e.count === 1).sort(byRecent).slice(0, 3),
    resolved: errs.filter(e => e.resolved).sort(byRecent).slice(0, 3),
    pronunciation: Object.entries(S.memory.pronunciation).map(([word, p]) => ({word, ...p}))
      .filter(p => p.count > p.improved).sort(byRecent).slice(0, 4),
    reinforcing: Object.entries(S.memory.words).map(([word, m]) => ({word, ...m}))
      .filter(m => m.reusedOk < 2).sort(byRecent).slice(0, 8),
    lastLesson: S.memory.lastLesson,
  };
}

// סיכום שבועי: השבוע הנוכחי (7 ימים אחרונים) מול הקודם
export function weekSummary(){
  const now = new Date();
  const sum = (from, to) => {
    const acc = {minutes:0, xp:0, words:0, speakSec:0, correct:0, wrong:0, lessons:0};
    for (let i = from; i < to; i++){
      const d = new Date(now); d.setDate(d.getDate() - i);
      const day = S.stats.days[todayStr(d)];
      if (day) for (const k of Object.keys(acc)) acc[k] += day[k] || 0;
    }
    return acc;
  };
  return {thisWeek: sum(0, 7), lastWeek: sum(7, 14)};
}
