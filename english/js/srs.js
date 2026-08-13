// מערכת חזרות מרווחות (בהשראת SM-2, מפושטת): כל מילה עוברת בין סטטוסים
// new → learning → known → mastered, עם מרווחי חזרה גדלים: 1, 3, 7, 14, 30, 60 יום.
import { S, save } from "./store.js";
import { WORDS, wordKey } from "./data/words.js";
import { todayStr, addDays } from "./util.js";

const INTERVALS = [1, 3, 7, 14, 30, 60];

export const STATUS_HE = {new: "חדש", learning: "לומד", known: "מכיר", mastered: "שולט"};

export function entry(key){
  return S.srs[key] || null;
}

export function ensureEntry(key){
  if (!S.srs[key]){
    S.srs[key] = {status: "new", step: -1, due: todayStr(), ok: 0, fail: 0, saved: false, added: todayStr()};
  }
  return S.srs[key];
}

// דיווח תוצאה של תרגול מילה. correct=true מקדם במסלול, false מחזיר אחורה.
export function review(key, correct){
  const e = ensureEntry(key);
  if (correct){
    e.ok++;
    e.step = Math.min(e.step + 1, INTERVALS.length - 1);
    e.due = addDays(todayStr(), INTERVALS[e.step]);
  } else {
    e.fail++;
    e.step = Math.max(-1, e.step - 2);
    e.due = todayStr(); // מילה שנכשלה חוזרת עוד היום
  }
  e.status = statusFor(e);
  save();
  return e;
}

function statusFor(e){
  if (e.ok === 0 && e.fail === 0) return "new";
  if (e.step >= 4 && e.ok >= 5) return "mastered";
  if (e.step >= 2) return "known";
  return "learning";
}

export function toggleSaved(key){
  const e = ensureEntry(key);
  e.saved = !e.saved;
  save();
  return e.saved;
}

// מילים שהגיע מועד החזרה שלהן
export function dueWords(limit = 20){
  const t = todayStr();
  const due = [];
  for (const [key, e] of Object.entries(S.srs)){
    if (e.due <= t && (e.ok + e.fail) > 0){
      const w = WORDS.find(x => wordKey(x) === key);
      if (w) due.push({w, e});
    }
  }
  // הקשות ביותר קודם: יחס כישלונות גבוה
  due.sort((a, b) => (b.e.fail / (b.e.ok + b.e.fail + 1)) - (a.e.fail / (a.e.ok + a.e.fail + 1)));
  return due.slice(0, limit).map(d => d.w);
}

// מילים חדשות ללימוד: לפי רמה ותחומי עניין, שעוד לא נלמדו
export function newWords(limit = 5){
  const lvl = S.profile.level || "A1";
  const order = ["A1","A2","B1","B2","C1","C2"];
  const li = Math.max(0, order.indexOf(lvl));
  const interests = S.profile.interests || [];
  const candidates = WORDS.filter(w => {
    const e = S.srs[wordKey(w)];
    if (e && (e.ok + e.fail) > 0) return false;
    const wi = order.indexOf(w.lvl);
    return wi >= Math.max(0, li - 1) && wi <= li + 1;
  });
  candidates.sort((a, b) => {
    const ai = interests.includes(a.topic) ? 1 : 0, bi = interests.includes(b.topic) ? 1 : 0;
    if (ai !== bi) return bi - ai;
    return order.indexOf(a.lvl) - order.indexOf(b.lvl);
  });
  return candidates.slice(0, limit);
}

// מילים "צריך לחזק": יחס כישלונות גבוה
export function hardWords(limit = 10){
  const out = [];
  for (const [key, e] of Object.entries(S.srs)){
    if (e.fail >= 2 && e.fail >= e.ok){
      const w = WORDS.find(x => wordKey(x) === key);
      if (w) out.push({w, e});
    }
  }
  out.sort((a, b) => b.e.fail - a.e.fail);
  return out.slice(0, limit).map(d => d.w);
}

export function srsCounts(){
  const c = {new: 0, learning: 0, known: 0, mastered: 0, due: 0, saved: 0};
  const t = todayStr();
  for (const e of Object.values(S.srs)){
    if ((e.ok + e.fail) > 0 || e.saved){
      c[e.status] = (c[e.status] || 0) + 1;
      if (e.due <= t && (e.ok + e.fail) > 0) c.due++;
      if (e.saved) c.saved++;
    }
  }
  return c;
}
