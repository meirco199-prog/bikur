// מבחן רמה אדפטיבי: מתחיל ב-B1, מקשה כשעונים נכון ומקל כשטועים, ומתכנס
// סביב הרמה האמיתית. כך מקבלים הערכה רצינית תוך ~14 שאלות בלי ללחוץ.
import { el, shuffle } from "../util.js";
import { BANK, LEVELS, computeLevel } from "../data/test.js";
import { speak, stopSpeaking } from "../speech.js";

const MAX_Q = 14;
const MIN_Q = 10;

export function renderPlacement(main, onDone){
  const pools = {};
  LEVELS.forEach(l => pools[l] = shuffle(BANK[l].slice()));
  const results = {};
  LEVELS.forEach(l => results[l] = {ok: 0, n: 0});
  let curr = 2;      // מתחילים ב-B1
  let asked = 0;

  // בוחר שאלה זמינה קרובה ככל האפשר לרמת הקושי הנוכחית
  function pickAt(idx){
    const cand = [];
    for (let j = 0; j < LEVELS.length; j++) if (pools[LEVELS[j]].length) cand.push(j);
    if (!cand.length) return null;
    cand.sort((a, b) => Math.abs(a - idx) - Math.abs(b - idx) || a - b);
    const j = cand[0];
    return {lvl: LEVELS[j], idx: j, item: pools[LEVELS[j]].pop()};
  }

  function step(){
    stopSpeaking();
    if (asked >= MAX_Q) return finish();
    const picked = pickAt(curr);
    if (!picked) return finish();
    render(picked);
  }

  function render(picked){
    const q = picked.item;
    const wrap = el("div", {class: "onboard"});
    wrap.append(
      el("div", {class: "progress slim"},
        el("div", {class: "progress-fill", style: `width:${Math.round(100 * asked / MAX_Q)}%`})),
      el("div", {class: "row spread"},
        el("div", {class: "chip"}, `שאלה ${asked + 1}`),
        el("div", {class: "muted small-text"}, "מבחן מסתגל — מתאים את עצמו אליך")));

    const card = el("div", {class: "card exercise"});

    if (q.type === "listen"){
      card.append(
        el("div", {class: "q"}, "האזן ואז ענה:"),
        el("div", {class: "row gap"},
          el("button", {class: "btn primary", onclick: () => speak(q.say)}, "▶︎ השמע"),
          el("button", {class: "btn ghost", onclick: () => speak(q.say, {rate: 0.7})}, "🐢 לאט")));
    }
    if (q.type === "read"){
      card.append(el("div", {class: "q sentence read-passage", dir: "ltr"}, q.text));
    }
    card.append(el("div", {class: q.type === "read" ? "q" : "q sentence", dir: isHe(q.q) ? "rtl" : "ltr"}, q.q));

    const opts = el("div", {class: "opts"});
    q.opts.forEach((o, i) => {
      opts.append(el("button", {class: "opt", dir: isHe(o) ? "rtl" : "ltr", onclick: () => {
        opts.querySelectorAll("button").forEach(b => b.disabled = true);
        answer(picked, i === q.a);
      }}, o));
    });
    card.append(opts);
    wrap.append(card);
    main.replaceChildren(wrap);
    if (q.type === "listen") speak(q.say);
    window.scrollTo(0, 0);
  }

  function answer(picked, correct){
    const r = results[picked.lvl];
    r.n++; if (correct) r.ok++;
    asked++;
    // מדרגה מסתגלת: נכון → מקשים, טעות → מקלים
    curr = correct ? Math.min(picked.idx + 1, LEVELS.length - 1)
                   : Math.max(picked.idx - 1, 0);
    // עצירה מוקדמת אם התכנסנו: אחרי מספיק שאלות, אם הרמה יציבה
    if (asked >= MIN_Q && converged()) return finish();
    step();
  }

  // התכנסות: יש רמה עם ≥3 ניסיונות שעברה, והרמה שמעליה נוסתה ולא עברה
  function converged(){
    for (let j = 1; j < LEVELS.length; j++){
      const below = results[LEVELS[j - 1]], here = results[LEVELS[j]];
      if (below.n >= 3 && below.ok / below.n >= 0.6 && here.n >= 2 && here.ok / here.n < 0.5) return true;
    }
    return false;
  }

  function finish(){
    stopSpeaking();
    onDone(computeLevel(results));
  }

  step();
}

function isHe(s){ return /[א-ת]/.test(s); }
