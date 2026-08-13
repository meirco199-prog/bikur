// משחקיות: XP, רמות, רצף ימים, הישגים.
import { S, save, logDay } from "./store.js";
import { todayStr, daysBetween, toast, confetti } from "./util.js";

export const LEVELS = [
  {name: "Starter",  he: "מתחיל",   xp: 0},
  {name: "Explorer", he: "חוקר",    xp: 300},
  {name: "Speaker",  he: "דובר",    xp: 900},
  {name: "Fluent",   he: "שוטף",    xp: 2000},
  {name: "Master",   he: "מאסטר",   xp: 4500},
];

export function levelInfo(){
  const xp = S.game.xp;
  let cur = LEVELS[0], next = null;
  for (let i = 0; i < LEVELS.length; i++){
    if (xp >= LEVELS[i].xp) { cur = LEVELS[i]; next = LEVELS[i + 1] || null; }
  }
  const base = cur.xp, top = next ? next.xp : cur.xp + 1;
  return {cur, next, pct: next ? Math.round(100 * (xp - base) / (top - base)) : 100};
}

export function addXP(n, reason){
  S.game.xp += n;
  logDay({xp: n});
  touchStreak();
  save();
  if (reason) toast(`‎+${n} XP · ${reason}`);
  checkAchievements();
}

// עדכון רצף: פעילות היום ממשיכה את הרצף; פער של יום נשרף בהקפאה אם יש
export function touchStreak(){
  const t = todayStr();
  const last = S.game.lastActive;
  if (last === t) return;
  if (!last) S.game.streak = 1;
  else {
    const gap = daysBetween(last, t);
    if (gap === 1) S.game.streak++;
    else if (gap === 2 && S.game.freezes > 0){
      S.game.freezes--; S.game.streak++;
      toast("🧊 הקפאת רצף הצילה את הרצף שלך!");
    }
    else if (gap > 1) S.game.streak = 1;
  }
  S.game.lastActive = t;
  S.game.bestStreak = Math.max(S.game.bestStreak, S.game.streak);
  save();
}

// בדיקה בעת פתיחת האפליקציה — האם הרצף נשבר בזמן שלא היינו כאן
export function streakStatus(){
  const last = S.game.lastActive;
  if (!last) return {alive: false, streak: 0};
  const gap = daysBetween(last, todayStr());
  if (gap <= 1) return {alive: true, streak: S.game.streak};
  if (gap === 2 && S.game.freezes > 0) return {alive: true, streak: S.game.streak, frozen: true};
  return {alive: false, streak: 0, lost: S.game.streak};
}

export const ACHIEVEMENTS = [
  {id: "first-lesson", icon: "🎯", name: "שיעור ראשון", desc: "השלמת אימון יומי ראשון", test: s => s.stats.totalLessons >= 1},
  {id: "streak-3",  icon: "🔥", name: "3 ימים ברצף",  test: s => s.game.streak >= 3 || s.game.bestStreak >= 3},
  {id: "streak-7",  icon: "🔥", name: "שבוע ברצף",    test: s => s.game.bestStreak >= 7},
  {id: "streak-30", icon: "🏆", name: "חודש ברצף",    test: s => s.game.bestStreak >= 30},
  {id: "words-25",  icon: "📚", name: "25 מילים",     test: s => learnedCount(s) >= 25},
  {id: "words-100", icon: "📚", name: "100 מילים",    test: s => learnedCount(s) >= 100},
  {id: "words-250", icon: "🎓", name: "250 מילים",    test: s => learnedCount(s) >= 250},
  {id: "lessons-10", icon: "⭐", name: "10 אימונים",  test: s => s.stats.totalLessons >= 10},
  {id: "lessons-50", icon: "🌟", name: "50 אימונים",  test: s => s.stats.totalLessons >= 50},
  {id: "speak-10",  icon: "🎤", name: "10 דקות דיבור", test: s => s.stats.totalSpeakSec >= 600},
  {id: "speak-60",  icon: "🎙️", name: "שעת דיבור",   test: s => s.stats.totalSpeakSec >= 3600},
  {id: "xp-1000",   icon: "⚡", name: "1,000 XP",     test: s => s.game.xp >= 1000},
];

function learnedCount(s){
  return Object.values(s.srs).filter(e => e.ok + e.fail > 0).length;
}

export function checkAchievements(){
  for (const a of ACHIEVEMENTS){
    if (!S.game.achievements.includes(a.id) && a.test(S)){
      S.game.achievements.push(a.id);
      save();
      toast(`${a.icon} הישג חדש: ${a.name}!`);
      confetti();
    }
  }
}
