// "המילים שלי": כל המילים בלמידה, סינון לפי סטטוס, פרטים מלאים ותרגול ממוקד.
import { el, toast } from "../util.js";
import { S } from "../store.js";
import { WORDS, wordKey, TOPICS } from "../data/words.js";
import { STATUS_HE, srsCounts, hardWords, toggleSaved, ensureEntry } from "../srs.js";
import { speak, stopSpeaking } from "../speech.js";
import { buildLesson, runLesson } from "../lesson.js";

export function renderWords(main){
  stopSpeaking();
  let filter = "all";
  const counts = srsCounts();
  const hard = hardWords(50).map(w => wordKey(w));

  function rows(){
    const out = [];
    for (const w of WORDS){
      const e = S.srs[wordKey(w)];
      if (!e || (e.ok + e.fail === 0 && !e.saved)) continue;
      out.push({w, e});
    }
    out.sort((a, b) => (a.e.due || "9999").localeCompare(b.e.due || "9999"));
    return out.filter(({w, e}) => {
      if (filter === "all") return true;
      if (filter === "hard") return hard.includes(wordKey(w));
      if (filter === "saved") return e.saved;
      return e.status === filter;
    });
  }

  function paint(){
    const data = rows();
    listEl.replaceChildren(...(data.length ? data.map(({w, e}) => wordRow(w, e)) : [
      el("div", {class: "card center muted"}, "אין עדיין מילים כאן. התחל אימון — והמילים שתלמד יופיעו כאן.")]));
  }

  function wordRow(w, e){
    const row = el("button", {class: "card list-item", onclick: () => showDetail(w, e)},
      el("div", {class: "li-main"},
        el("div", {class: "li-title", dir: "ltr"}, w.w),
        el("div", {class: "muted small-text"}, `${w.he} · ${STATUS_HE[e.status]}` +
          (e.ok + e.fail > 0 ? ` · ${e.ok}✓ ${e.fail}✗` : "") +
          (e.due && e.status !== "new" ? ` · חזרה: ${e.due}` : ""))),
      el("span", {class: "chip " + e.status}, STATUS_HE[e.status]));
    return row;
  }

  function showDetail(w, e){
    document.querySelector(".word-popup")?.remove();
    const pop = el("div", {class: "word-popup card big-popup"},
      el("div", {class: "row spread"},
        el("div", {class: "word-en", dir: "ltr"}, w.w),
        el("button", {class: "btn ghost small", onclick: () => pop.remove()}, "✕")),
      el("div", {class: "word-ipa", dir: "ltr"}, `/${w.ipa}/`),
      el("div", {class: "word-he"}, w.he),
      el("div", {class: "example", dir: "ltr"}, w.ex),
      el("div", {class: "example-he"}, w.exHe),
      w.syn?.length ? el("div", {class: "word-extra"}, "דומות: ", el("bdi", {dir: "ltr"}, w.syn.join(", "))) : null,
      w.ant?.length ? el("div", {class: "word-extra"}, "הפוכות: ", el("bdi", {dir: "ltr"}, w.ant.join(", "))) : null,
      w.phr?.length ? el("div", {class: "word-extra"}, "ביטויים: ", el("bdi", {dir: "ltr"}, w.phr.join(" · "))) : null,
      el("div", {class: "muted small-text"}, `נושא: ${TOPICS[w.topic] || w.topic} · רמה ${w.lvl} · הצלחות ${e.ok} · טעויות ${e.fail}`),
      el("div", {class: "row gap"},
        el("button", {class: "btn ghost small", onclick: () => speak(w.w + ". " + w.ex)}, "🔊 השמע"),
        el("button", {class: "btn ghost small", onclick: (ev) => {
          const s = toggleSaved(wordKey(w));
          ev.currentTarget.textContent = s ? "★ נשמר" : "☆ שמור";
          paint();
        }}, e.saved ? "★ נשמר" : "☆ שמור")));
    document.body.append(pop);
  }

  const filters = [
    ["all", `הכול`],
    ["new", STATUS_HE.new], ["learning", STATUS_HE.learning],
    ["known", STATUS_HE.known], ["mastered", STATUS_HE.mastered],
    ["hard", "צריך לחזק 💪"], ["saved", "★ שמורות"],
  ];

  const listEl = el("div", {class: "list"});
  main.replaceChildren(el("div", {class: "screen"},
    el("h1", {}, "המילים שלי"),
    el("div", {class: "stats-grid"},
      el("div", {class: "card stat-card"}, el("div", {class: "stat-v"}, counts.learning + counts.known + counts.mastered), el("div", {class: "stat-l"}, "בלמידה")),
      el("div", {class: "card stat-card"}, el("div", {class: "stat-v"}, counts.mastered), el("div", {class: "stat-l"}, "בשליטה")),
      el("div", {class: "card stat-card"}, el("div", {class: "stat-v"}, counts.due), el("div", {class: "stat-l"}, "לחזרה")),
      el("div", {class: "card stat-card"}, el("div", {class: "stat-v"}, hard.length), el("div", {class: "stat-l"}, "לחיזוק"))),
    counts.due > 0 ? el("button", {class: "btn primary big", onclick: () => {
      runLesson(main, buildLesson({minutes: 5}), {onExit: () => renderWords(main)});
    }}, `תרגל עכשיו ${counts.due} מילים לחזרה`) : null,
    el("div", {class: "chips"},
      filters.map(([id, name]) => el("button", {class: "chip-btn" + (id === filter ? " sel" : ""), onclick: (ev) => {
        filter = id;
        ev.currentTarget.parentElement.querySelectorAll(".chip-btn").forEach(b => b.classList.remove("sel"));
        ev.currentTarget.classList.add("sel");
        paint();
      }}, name))),
    listEl));
  paint();
}
