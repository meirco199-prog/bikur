// מרכז הלימוד: אימון יומי, חזרות, דקדוק, קריאה, האזנה, כתיבה, "איך אומרים".
import { el, toast, shuffle } from "../util.js";
import { S, save, skillResult, recordMistake } from "../store.js";
import { GRAMMAR } from "../data/grammar.js";
import { ARTICLES, articlesFor } from "../data/reading.js";
import { WORDS, wordKey } from "../data/words.js";
import { srsCounts, dueWords, ensureEntry, toggleSaved, review } from "../srs.js";
import { buildLesson, runLesson } from "../lesson.js";
import { addXP } from "../gamify.js";
import { speak, stopSpeaking } from "../speech.js";
import { checkWriting, howToSay, aiErrorMessage } from "../ai.js";

export function renderLearn(main){
  stopSpeaking();
  const counts = srsCounts();
  main.replaceChildren(el("div", {class: "screen"},
    el("h1", {}, "לימוד"),
    el("div", {class: "learn-grid"},
      learnCard("🎯", "אימון יומי", "תרגול מותאם אישית", () => {
        runLesson(main, buildLesson({}), {onExit: () => renderLearn(main)});
      }),
      learnCard("🔁", counts.due ? `חזרות (${counts.due})` : "חזרות", "מילים שמחכות לחזרה", () => {
        const due = dueWords(20);
        if (!due.length) return toast("אין מילים לחזרה כרגע — חזור מאוחר יותר");
        runLesson(main, buildLesson({minutes: Math.max(3, due.length / 2)}), {onExit: () => renderLearn(main)});
      }),
      learnCard("⏳", "שיעור מהיר", "3–20 דקות, אתה בוחר", () => quickPicker(main)),
      learnCard("📖", "קריאה", "מאמרים קצרים לפי רמה", () => renderReadingList(main)),
      learnCard("📐", "דקדוק", "נושאים קצרים + תרגול", () => renderGrammarList(main)),
      learnCard("✍️", "כתיבה", "כתוב — וה-AI יתקן", () => renderWriting(main)),
      learnCard("💡", "איך אומרים...?", "תרגום חכם מעברית", () => renderHowToSay(main)),
      learnCard("🧑‍🏫", "המורה שלי", "צ'אט אישי עם מורה שמכיר אותך", () => { location.hash = "#/teacher"; }),
    )));
}

function learnCard(icon, title, desc, onclick){
  return el("button", {class: "card learn-card", onclick},
    el("div", {class: "lc-icon"}, icon),
    el("div", {class: "lc-body"},
      el("div", {class: "lc-title"}, title),
      el("div", {class: "lc-desc muted"}, desc)));
}

function quickPicker(main){
  main.replaceChildren(el("div", {class: "screen"},
    backBar(main, "שיעור מהיר"),
    el("p", {class: "muted"}, "כמה זמן יש לך עכשיו?"),
    el("div", {class: "chips"},
      [3, 5, 10, 15, 20].map(m => el("button", {class: "chip-btn", onclick: () => {
        runLesson(main, buildLesson({minutes: m}), {onExit: () => renderLearn(main)});
      }}, `${m} דקות`)))));
}

function backBar(main, title, onBack = null){
  return el("div", {class: "backbar"},
    el("button", {class: "btn ghost small", onclick: () => { stopSpeaking(); onBack ? onBack() : renderLearn(main); }}, "→ חזרה"),
    el("h2", {}, title));
}

// ---------- דקדוק ----------

function renderGrammarList(main){
  main.replaceChildren(el("div", {class: "screen"},
    backBar(main, "דקדוק"),
    el("div", {class: "list"},
      GRAMMAR.map(g => {
        const d = S.grammarDone[g.id];
        const pct = d && (d.ok + d.fail) ? Math.round(100 * d.ok / (d.ok + d.fail)) : null;
        return el("button", {class: "card list-item", onclick: () => renderGrammarTopic(main, g)},
          el("div", {class: "li-main"},
            el("div", {class: "li-title", dir: "ltr"}, g.name),
            el("div", {class: "muted small-text"}, `רמה ${g.lvl}` + (pct !== null ? ` · דיוק ${pct}%` : ""))),
          el("span", {class: "li-arrow"}, "‹"));
      }))));
}

function renderGrammarTopic(main, g){
  let qIdx = 0, wrongCount = 0;
  const quiz = shuffle(g.quiz);

  function intro(){
    main.replaceChildren(el("div", {class: "screen"},
      backBar(main, g.name, () => renderGrammarList(main)),
      el("div", {class: "card"},
        el("p", {class: "grammar-short"}, g.short),
        el("div", {class: "examples"},
          g.examples.map(([en, he]) => el("div", {class: "example-pair"},
            el("div", {class: "example", dir: "ltr"}, en),
            el("div", {class: "example-he"}, he),
            el("button", {class: "btn ghost small", onclick: () => speak(en)}, "🔊"))))),
      el("button", {class: "btn primary big", onclick: question}, "לתרגול")));
  }

  function question(){
    stopSpeaking();
    if (qIdx >= quiz.length) return summary();
    const q = quiz[qIdx];
    const box = el("div", {class: "card exercise"});
    main.replaceChildren(el("div", {class: "screen"},
      backBar(main, g.name, () => renderGrammarList(main)),
      el("div", {class: "muted small-text"}, `${qIdx + 1}/${quiz.length}`),
      box));
    box.append(
      el("div", {class: "q sentence", dir: "ltr"}, q.q),
      el("div", {class: "opts"}, q.opts.map((o, i) =>
        el("button", {class: "opt", dir: "ltr", onclick: (ev) => {
          box.querySelectorAll(".opt").forEach(b => b.disabled = true);
          const ok = i === q.a;
          skillResult("grammar", ok);
          const d = S.grammarDone[g.id] = S.grammarDone[g.id] || {ok: 0, fail: 0};
          ok ? d.ok++ : d.fail++; save();
          if (!ok){ wrongCount++; recordMistake(`grammar ${g.id}: ${q.q}`, "grammar"); }
          box.append(el("div", {class: "feedback " + (ok ? "good" : "bad")},
            el("div", {class: "fb-title"}, ok ? "נכון! ✓" : "לא מדויק"),
            ok ? null : el("div", {class: "fb-answer"}, "התשובה: ", el("bdi", {dir: "ltr"}, q.opts[q.a])),
            el("div", {class: "fb-extra"}, q.why),
            // הרחבת ההסבר רק כשיש טעות — כמו מורה אמיתי
            !ok && wrongCount >= 2 ? el("div", {class: "fb-extra"}, g.more) : null,
            el("button", {class: "btn primary", onclick: () => { qIdx++; question(); }}, "המשך")));
        }}, o))));
  }

  function summary(){
    addXP(20, "נושא דקדוק");
    main.replaceChildren(el("div", {class: "screen"},
      el("div", {class: "card center summary"},
        el("div", {class: "summary-emoji"}, "📐"),
        el("h2", {}, "סיימת את " + g.name),
        wrongCount > 1 ? el("p", {class: "muted"}, g.more) : el("p", {class: "muted"}, "שליטה יפה! הנושא ימשיך להופיע באימונים."),
        el("button", {class: "btn primary big", onclick: () => renderGrammarList(main)}, "חזרה לנושאים"))));
  }

  intro();
}

// ---------- קריאה ----------

function renderReadingList(main){
  const arts = articlesFor(S.profile.level, S.profile.interests);
  main.replaceChildren(el("div", {class: "screen"},
    backBar(main, "קריאה"),
    el("p", {class: "muted"}, "לחיצה על מילה בטקסט תציג תרגום ותאפשר לשמור אותה."),
    el("div", {class: "list"},
      arts.map(a => el("button", {class: "card list-item", onclick: () => renderArticle(main, a)},
        el("div", {class: "li-main"},
          el("div", {class: "li-title", dir: "ltr"}, a.title),
          el("div", {class: "muted small-text"}, `רמה ${a.lvl}` + (S.readingDone[a.id] ? " · נקרא ✓" : ""))),
        el("span", {class: "li-arrow"}, "‹"))))));
}

function renderArticle(main, a){
  // טקסט עם מילים לחיצות
  const textEl = el("p", {class: "article-text", dir: "ltr"});
  for (const token of a.text.split(/(\s+)/)){
    if (/^\s+$/.test(token) || !token) { textEl.append(token); continue; }
    const clean = token.replace(/[^a-zA-Z'-]/g, "").toLowerCase();
    const known = WORDS.find(w => w.w.toLowerCase() === clean);
    textEl.append(el("span", {class: "tap-word" + (known ? " in-dict" : ""), onclick: () => showWordPopup(token, clean, known)}, token));
  }

  let heShown = false;
  const heBox = el("div", {class: "card article-he hidden"}, a.he);

  main.replaceChildren(el("div", {class: "screen"},
    backBar(main, a.title, () => renderReadingList(main)),
    el("div", {class: "card"},
      textEl,
      el("div", {class: "row gap"},
        el("button", {class: "btn ghost small", onclick: () => speak(a.text)}, "🔊 הקרא"),
        el("button", {class: "btn ghost small", onclick: () => speak(a.text, {rate: 0.7})}, "🐢 לאט"),
        el("button", {class: "btn ghost small", onclick: () => {
          heShown = !heShown; heBox.classList.toggle("hidden", !heShown);
        }}, "🇮🇱 הסבר בעברית"))),
    heBox,
    el("button", {class: "btn primary big", onclick: () => articleQuiz(main, a)}, "לשאלות ההבנה")));
}

function showWordPopup(orig, clean, known){
  document.querySelector(".word-popup")?.remove();
  const pop = el("div", {class: "word-popup card"},
    el("div", {class: "row spread"},
      el("div", {class: "word-en", dir: "ltr"}, known ? known.w : orig),
      el("button", {class: "btn ghost small", onclick: () => pop.remove()}, "✕")),
    known ? el("div", {}, known.he) : el("div", {class: "muted"}, "המילה אינה במילון המובנה — שאל את המורה בצ'אט"),
    known ? el("div", {class: "word-ipa", dir: "ltr"}, `/${known.ipa}/`) : null,
    el("div", {class: "row gap"},
      el("button", {class: "btn ghost small", onclick: () => speak(clean || orig)}, "🔊"),
      known ? el("button", {class: "btn ghost small", onclick: (ev) => {
        const saved = toggleSaved(wordKey(known));
        ev.currentTarget.textContent = saved ? "★ נשמר" : "☆ שמור";
      }}, ensureEntry(wordKey(known)).saved ? "★ נשמר" : "☆ שמור") : null));
  document.body.append(pop);
  speak(clean || orig);
}

function articleQuiz(main, a){
  let i = 0, ok = 0;
  function q(){
    stopSpeaking();
    if (i >= a.qs.length){
      S.readingDone[a.id] = true; save();
      skillResult("reading", ok >= a.qs.length / 2);
      addXP(15, "קריאת מאמר");
      main.replaceChildren(el("div", {class: "screen"},
        el("div", {class: "card center summary"},
          el("div", {class: "summary-emoji"}, ok === a.qs.length ? "🏆" : "📖"),
          el("h2", {}, `${ok}/${a.qs.length} תשובות נכונות`),
          el("button", {class: "btn primary big", onclick: () => renderReadingList(main)}, "חזרה למאמרים"))));
      return;
    }
    const cur = a.qs[i];
    const box = el("div", {class: "card exercise"});
    main.replaceChildren(el("div", {class: "screen"},
      backBar(main, a.title, () => renderReadingList(main)), box));
    box.append(el("div", {class: "q"}, cur.q),
      el("div", {class: "opts"}, cur.opts.map((o, oi) => el("button", {class: "opt", onclick: (ev) => {
        box.querySelectorAll(".opt").forEach(b => b.disabled = true);
        const good = oi === cur.a;
        if (good) ok++;
        box.append(el("div", {class: "feedback " + (good ? "good" : "bad")},
          el("div", {class: "fb-title"}, good ? "נכון! ✓" : "לא מדויק"),
          good ? null : el("div", {class: "fb-answer"}, "התשובה: " + cur.opts[cur.a]),
          el("button", {class: "btn primary", onclick: () => { i++; q(); }}, "המשך")));
      }}, o))));
  }
  q();
}

// ---------- כתיבה ----------

function renderWriting(main){
  const kinds = [
    {id: "sentence", name: "משפט"}, {id: "message", name: "הודעה"},
    {id: "email", name: "מייל"}, {id: "story", name: "סיפור"},
    {id: "post", name: "פוסט"}, {id: "business", name: "טקסט עסקי"},
  ];
  let kind = "sentence";
  const ta = el("textarea", {class: "input textarea", dir: "ltr",
    placeholder: "Write something in English..."});
  const out = el("div", {});
  const btn = el("button", {class: "btn primary big", onclick: async () => {
    const text = ta.value.trim();
    if (!text) return toast("כתוב משהו קודם :)");
    btn.disabled = true; btn.textContent = "בודק...";
    out.replaceChildren(el("div", {class: "muted"}, "המורה קורא את הטקסט..."));
    try {
      const r = await checkWriting(text, kind);
      skillResult("writing", true);
      addXP(15, "תרגול כתיבה");
      out.replaceChildren(
        resultCard("מה כתבת", text),
        resultCard("גרסה מתוקנת", r.corrected),
        resultCard("גרסה טבעית יותר", r.natural),
        el("div", {class: "card"}, el("h3", {}, "הסבר"), el("p", {}, r.explanation)));
      if (r.corrected && r.corrected.trim().toLowerCase() !== text.toLowerCase()){
        recordMistake(`writing: ${text.slice(0, 120)}`, "writing");
      }
    } catch (e) {
      out.replaceChildren(el("div", {class: "card notice"}, aiErrorMessage(e)));
    }
    btn.disabled = false; btn.textContent = "בדוק עם המורה";
  }}, "בדוק עם המורה");

  main.replaceChildren(el("div", {class: "screen"},
    backBar(main, "כתיבה"),
    el("div", {class: "chips"}, kinds.map(k =>
      el("button", {class: "chip-btn" + (k.id === kind ? " sel" : ""), onclick: (ev) => {
        kind = k.id;
        ev.currentTarget.parentElement.querySelectorAll(".chip-btn").forEach(b => b.classList.remove("sel"));
        ev.currentTarget.classList.add("sel");
      }}, k.name))),
    ta, btn, out));
}

function resultCard(title, text){
  return el("div", {class: "card"},
    el("h3", {}, title),
    el("p", {dir: "ltr", class: "sentence"}, text || "—"),
    el("button", {class: "btn ghost small", onclick: () => speak(text)}, "🔊"));
}

// ---------- איך אומרים ----------

function renderHowToSay(main){
  const input = el("input", {class: "input", placeholder: "כתוב בעברית... למשל: הפגישה נדחתה למחר"});
  const out = el("div", {});
  const go = async () => {
    const heb = input.value.trim();
    if (!heb) return toast("כתוב משפט בעברית");
    btn.disabled = true; btn.textContent = "מתרגם...";
    out.replaceChildren(el("div", {class: "muted"}, "רגע..."));
    try {
      const r = await howToSay(heb);
      out.replaceChildren(
        resultCard("גרסה פשוטה", r.simple),
        resultCard("גרסה טבעית", r.natural),
        resultCard("גרסה מקצועית", r.professional));
      addXP(5);
    } catch (e) {
      out.replaceChildren(el("div", {class: "card notice"}, aiErrorMessage(e)));
    }
    btn.disabled = false; btn.textContent = "תרגם";
  };
  const btn = el("button", {class: "btn primary big", onclick: go}, "תרגם");
  input.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  main.replaceChildren(el("div", {class: "screen"},
    backBar(main, "איך אומרים באנגלית?"),
    input, btn, out));
}
