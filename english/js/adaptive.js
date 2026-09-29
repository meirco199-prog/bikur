// אבחון אדפטיבי לכל מיומנות (A1→C2), טהור — בלי DOM ובלי store, כדי שאפשר לבדוק אותו ב-node.
// הרעיון: מדרגות. תשובה נכונה → פריט ברמה שמעל; שגויה → ברמה שמתחת. רמה נקבעת רק
// עם ביסוס: לפחות שתי תשובות נכונות ברמה הזו או מעליה (ואחת מהן ברמה עצמה), כך
// שתשובה מקרית אחת — נכונה או שגויה — לא מזיזה לבדה רמה שלמה. 3–7 פריטים למיומנות.
// MAX_ITEMS=7: המסלול המלא A1→C2 (A1 A2 B1 B2 C1 C2 + אישור שני ב-C2) הוא בדיוק 7 פריטים,
// וכך גם C2→A1. אם אחרי המכסה הרמה עדיין לא מבוססת — פריט אחד נוסף לאישור.
export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
export const MAX_ITEMS = 7;
const idx = l => Math.max(0, LEVELS.indexOf(l));
const at = i => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i))];

function counts(answers){
  const c = {}, w = {};
  for (const a of answers){ if (a.correct) c[a.level] = (c[a.level] || 0) + 1; else w[a.level] = (w[a.level] || 0) + 1; }
  return {c: l => c[l] || 0, w: l => w[l] || 0};
}

// הערכת הרמה מהתשובות: הרמה הגבוהה ביותר L שבה ענו נכון, ושבה ומעליה יש לפחות שתי
// תשובות נכונות. confident=false כשאין ביסוס כזה (למשל רק תשובה נכונה אחת).
export function estimateLevel(answers){
  const {c} = counts(answers);
  for (let i = LEVELS.length - 1; i >= 0; i--){
    const L = LEVELS[i];
    if (c(L) < 1) continue;
    let above = 0; for (let j = i; j < LEVELS.length; j++) above += c(LEVELS[j]);
    if (above >= 2) return {level: L, confident: true, items: answers.length};
  }
  // בלי ביסוס: תשובה נכונה בודדת מציבה רמה אחת מתחתיה (לא ניחוש כלפי מעלה); כלום → A1
  const best = answers.filter(a => a.correct).map(a => idx(a.level));
  if (best.length) return {level: at(Math.max(...best) - 1), confident: false, items: answers.length};
  return {level: "A1", confident: answers.length >= 2, floor: true, items: answers.length};
}

// הרמה של הפריט הבא: מדרגה אחת למעלה אחרי נכון, למטה אחרי שגוי
export function nextLevel(answers, start){
  if (!answers.length) return start;
  const last = answers[answers.length - 1];
  return at(idx(last.level) + (last.correct ? 1 : -1));
}

// האם הגבול מבוסס מספיק כדי לעצור: שני נכונים ברמה ושני שגויים ברמה שמעל,
// או תקרה (C2 פעמיים נכון) / רצפה (A1 פעמיים שגוי), או מכסת הפריטים.
export function isDone(answers, max = MAX_ITEMS){
  if (answers.length >= max) return estimateLevel(answers).confident || answers.length >= max + 1;
  const {c, w} = counts(answers);
  if (c("C2") >= 2) return true;
  if (w("A1") >= 2) return true;
  const est = estimateLevel(answers);
  if (!est.confident) return false;
  const up = at(idx(est.level) + 1);
  return c(est.level) >= 2 && w(up) >= 2;
}

// ריצה אחת למיומנות. pool(level) → מערך פריטים ברמה (הקורא מסנן לפי מיומנות).
export function createRun({start = "A2", pool, max = MAX_ITEMS}){
  const answers = [];
  const used = new Set();
  const run = {answers, done: false, item: null, level: null,
    // בוחר את הפריט הבא (או מסיים אם אין פריט מתאים / הגבול מבוסס)
    next(){
      if (run.done) return null;
      if (isDone(answers, max)){ run.finish(); return null; }
      run.level = nextLevel(answers, start);
      const cand = (pool(run.level) || []).filter(x => !used.has(x));
      if (!cand.length){ run.finish(); return null; }
      run.item = cand[Math.floor(Math.random() * cand.length)];
      used.add(run.item);
      return run.item;
    },
    answer(correct){
      if (!run.item) return null;
      answers.push({level: run.level, correct: !!correct});
      run.item = null;
      return answers[answers.length - 1];
    },
    finish(){ run.done = true; run.item = null; },
    estimate(){ return estimateLevel(answers); },
  };
  return run;
}
