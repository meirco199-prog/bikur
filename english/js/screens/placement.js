// מבחן רמה: שאלות מדורגות, עצירה מוקדמת כשרמה נכשלת, קביעת CEFR.
import { el } from "../util.js";
import { PLACEMENT, scorePlacement } from "../data/test.js";
import { speak, stopSpeaking } from "../speech.js";

export function renderPlacement(main, onDone){
  const answers = [];
  let idx = 0;

  // עצירה מוקדמת: אם המשתמש נכשל בכל שאלות רמה מסוימת — אין טעם להמשיך
  function shouldStop(){
    const lvls = {};
    for (const a of answers){
      lvls[a.lvl] = lvls[a.lvl] || {ok: 0, n: 0};
      lvls[a.lvl].n++; if (a.correct) lvls[a.lvl].ok++;
    }
    const cur = PLACEMENT[idx]?.lvl;
    if (!cur) return true;
    // אם הרמה הקודמת הושלמה עם 0 הצלחות — עוצרים
    const order = ["A1","A2","B1","B2","C1"];
    const prev = order[order.indexOf(cur) - 1];
    if (prev && lvls[prev] && lvls[prev].ok === 0) return true;
    return false;
  }

  function render(){
    stopSpeaking();
    main.replaceChildren();
    if (idx >= PLACEMENT.length || shouldStop()) return finish();
    const q = PLACEMENT[idx];
    const wrap = el("div", {class: "onboard"});
    wrap.append(
      el("div", {class: "progress slim"},
        el("div", {class: "progress-fill", style: `width:${Math.round(100 * idx / PLACEMENT.length)}%`})),
      el("div", {class: "chip"}, `שאלה ${idx + 1}`));
    const card = el("div", {class: "card exercise"});

    if (q.type === "listen"){
      card.append(
        el("div", {class: "q"}, "האזן ואז ענה:"),
        el("div", {class: "row gap"},
          el("button", {class: "btn primary", onclick: () => speak(q.say)}, "▶︎ השמע"),
          el("button", {class: "btn ghost", onclick: () => speak(q.say, {rate: 0.7})}, "🐢 לאט")));
      speak(q.say);
    }
    if (q.type === "read"){
      card.append(el("div", {class: "q sentence", dir: "ltr"}, q.text));
    }
    card.append(el("div", {class: "q"}, q.q));
    const opts = el("div", {class: "opts"});
    q.opts.forEach((o, i) => {
      opts.append(el("button", {class: "opt", dir: /[א-ת]/.test(o) ? "rtl" : "ltr", onclick: () => {
        answers.push({lvl: q.lvl, correct: i === q.a});
        idx++;
        render();
      }}, o));
    });
    card.append(opts);
    wrap.append(card);
    main.append(wrap);
  }

  function finish(){
    stopSpeaking();
    onDone(scorePlacement(answers));
  }

  render();
}
