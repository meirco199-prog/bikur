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
    settings: {theme: "system", aiUrl: "https://english-ai.meirco199.workers.dev", notifs: false, voiceRate: 1},
  };
}

export let S = load();

function load(){
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const d = defaults(), s = JSON.parse(raw);
    // מיזוג רדוד עם ברירות מחדל כדי ששדות חדשים לא יחסרו אחרי עדכון
    for (const k of Object.keys(d)){
      if (s[k] === undefined) s[k] = d[k];
      else if (typeof d[k] === "object" && !Array.isArray(d[k])) s[k] = {...d[k], ...s[k]};
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
