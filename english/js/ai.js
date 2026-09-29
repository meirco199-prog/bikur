// לקוח לשכבת ה-AI — Cloudflare Worker נפרד (english-ai). אין מפתחות בצד הלקוח.
// כל בקשה מצרפת "פרופיל לומד" מסוכם במקום לשלוח את כל ההיסטוריה.
import { S, memorySummary } from "./store.js";
import { hardWords } from "./srs.js";

export class AIError extends Error {}

function base(){
  return (S.settings.aiUrl || "").replace(/\/+$/, "");
}

// פרופיל לומד מסוכם — הזיכרון של המורה
export function learnerProfile(){
  const hard = hardWords(8).map(w => w.w);
  const learned = Object.entries(S.srs).filter(([, e]) => e.ok + e.fail > 0).length;
  const recentMistakes = S.mistakes.slice(-6).map(m => m.text);
  const weak = Object.entries(S.skills).sort((a, b) => a[1] - b[1]).slice(0, 2).map(e => e[0]);
  // מילים שנלמדו לאחרונה (לא בשליטה מלאה) — שהמורה ישזור בשיחה לחיזוק (spaced repetition)
  const srsReuse = Object.entries(S.srs)
    .filter(([, e]) => (e.ok + e.fail) > 0 && e.status !== "mastered")
    .sort((a, b) => (b[1].due || "").localeCompare(a[1].due || ""))
    .slice(0, 8).map(([k]) => k);
  // הזיכרון המובנה: טעויות חוזרות (עם ספירה), מה שכבר נלמד (לא להציק), הגייה, recap
  const mem = memorySummary();
  const ll = mem.lastLesson;
  return {
    level: S.profile.level || "A2",
    goals: S.profile.goals,
    interests: S.profile.interests,
    wordsLearned: learned,
    hardWords: hard,
    weakSkills: weak,
    recentMistakes,
    recurringErrors: mem.recurring.map(e => `${e.original} → ${e.corrected} (x${e.count})`),
    resolvedErrors: mem.resolved.map(e => `${e.original} → ${e.corrected}`),
    pronunciationIssues: mem.pronunciation.map(p => `${p.word}: ${p.issue}`),
    // קודם מילים שהמורה לימד ועוד לא הוטמעו, אחר כך מילים מהאימונים
    reuseWords: [...new Set([...mem.reinforcing.map(m => m.word), ...srsReuse])].slice(0, 8),
    lastLessonRecap: ll ? `${ll.topic ? "topic: " + ll.topic + ". " : ""}${ll.recap || ""}`.trim() : "",
    fillerRate: ll && ll.minutes ? +(ll.fillers / ll.minutes).toFixed(1) : null,
    englishOnly: !!S.profile.englishOnly,
  };
}

async function post(path, body){
  const url = base() + path;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({...body, profile: learnerProfile()}),
    });
  } catch {
    throw new AIError("offline");
  }
  if (res.status === 429) throw new AIError("rate");
  if (!res.ok) throw new AIError("server");
  const data = await res.json();
  if (data.error) throw new AIError(data.error);
  return data;
}

export function aiErrorMessage(e){
  if (!(e instanceof AIError)) return "משהו השתבש. נסה שוב.";
  if (e.message === "offline") return "אין חיבור לשרת ה-AI. בדוק את החיבור לאינטרנט, או שהשרת עדיין לא הופעל (ראה הגדרות ← כתובת שרת AI).";
  if (e.message === "rate") return "הגעת למגבלת השימוש הרגעית. חכה רגע ונסה שוב.";
  return "שרת ה-AI החזיר שגיאה. נסה שוב עוד רגע.";
}

// שיחה (תרחיש או מורה): messages = [{role:"user"|"assistant", content}]
export async function chat(messages, scenario = null, mode = "conversation"){
  const d = await post("/api/chat", {messages, scenario, mode});
  return d.reply;
}

// משוב בסוף שיחה
export async function feedback(transcript){
  const d = await post("/api/feedback", {transcript});
  return d; // {summary, mistakes:[], better:[], scores:{fluency,pronunciation,vocabulary,grammar}}
}

// בדיקת כתיבה
export async function checkWriting(text, kind){
  const d = await post("/api/write", {text, kind});
  return d; // {corrected, natural, explanation}
}

// "איך אומרים באנגלית?"
export async function howToSay(hebrew){
  const d = await post("/api/say", {hebrew});
  return d; // {simple, natural, professional}
}
