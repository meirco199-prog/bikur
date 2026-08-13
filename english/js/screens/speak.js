// מסך דיבור: שיחות עם מורה AI בתרחישים, מאמן הגייה, ו-Shadowing.
import { el, toast, sample, compareWords, accuracy } from "../util.js";
import { S, save, skillResult, logDay, recordMistake } from "../store.js";
import { SCENARIOS } from "../data/scenarios.js";
import { WORDS } from "../data/words.js";
import { speak, stopSpeaking, sttSupported, listen, ttsSupported } from "../speech.js";
import { chat, feedback, aiErrorMessage } from "../ai.js";
import { addXP } from "../gamify.js";

export function renderSpeak(main){
  stopSpeaking();
  main.replaceChildren(el("div", {class: "screen"},
    el("h1", {}, "דיבור"),
    sttSupported() ? null : el("div", {class: "card notice"},
      "הדפדפן הזה לא תומך בזיהוי דיבור. אפשר עדיין לשוחח בהקלדה, ולשמוע הכול. (Chrome באנדרואיד/מחשב תומך מלא.)"),
    el("div", {class: "grid2"},
      el("button", {class: "card learn-card", onclick: () => renderPronunciation(main)},
        el("div", {class: "lc-icon"}, "🗣️"),
        el("div", {class: "lc-body"},
          el("div", {class: "lc-title"}, "מאמן הגייה"),
          el("div", {class: "lc-desc muted"}, "שמע, חזור, קבל ניתוח"))),
      el("button", {class: "card learn-card", onclick: () => renderShadowing(main)},
        el("div", {class: "lc-icon"}, "🎧"),
        el("div", {class: "lc-body"},
          el("div", {class: "lc-title"}, "Shadowing"),
          el("div", {class: "lc-desc muted"}, "חזרה צמודה אחרי דובר")))),
    el("h3", {}, "שיחה עם המורה"),
    el("p", {class: "muted"}, "בחר תרחיש — מדברים בקול (או בהקלדה), ובסוף מקבלים משוב מפורט."),
    el("div", {class: "list"},
      SCENARIOS.map(sc => el("button", {class: "card list-item", onclick: () => renderConversation(main, sc)},
        el("div", {class: "lc-icon"}, sc.icon),
        el("div", {class: "li-main"},
          el("div", {class: "li-title"}, sc.name),
          el("div", {class: "muted small-text"}, sc.desc)),
        el("span", {class: "li-arrow"}, "‹"))))));
}

function backBar(main, title){
  return el("div", {class: "backbar"},
    el("button", {class: "btn ghost small", onclick: () => { stopSpeaking(); renderSpeak(main); }}, "→ חזרה"),
    el("h2", {}, title));
}

// ---------- שיחה עם AI ----------

function renderConversation(main, sc){
  const messages = [{role: "assistant", content: sc.opener}];
  const startTime = Date.now();
  let busy = false;

  const msgList = el("div", {class: "chat-list"});
  const partial = el("div", {class: "chat-partial", dir: "ltr"});
  const input = el("input", {class: "input chat-input", dir: "ltr", placeholder: "Type in English...",
    autocapitalize: "off", autocomplete: "off"});

  function paintMessages(){
    msgList.replaceChildren(...messages.map(m =>
      el("div", {class: "bubble " + (m.role === "assistant" ? "them" : "me"), dir: "ltr"},
        m.content,
        m.role === "assistant" ? el("button", {class: "bubble-speak", onclick: () => speak(m.content)}, "🔊") : null)));
    msgList.scrollTop = msgList.scrollHeight;
  }

  async function send(text){
    if (!text.trim() || busy) return;
    busy = true;
    messages.push({role: "user", content: text.trim()});
    paintMessages();
    input.value = "";
    partial.textContent = "";
    const typing = el("div", {class: "bubble them typing", dir: "ltr"}, "…");
    msgList.append(typing);
    msgList.scrollTop = msgList.scrollHeight;
    try {
      const reply = await chat(messages, sc.id === "free" ? null : {name: sc.name, sys: sc.sys});
      messages.push({role: "assistant", content: reply});
      paintMessages();
      speak(reply);
    } catch (e) {
      typing.remove();
      toast(aiErrorMessage(e));
      messages.pop();
      paintMessages();
      input.value = text;
    }
    busy = false;
  }

  const micBtn = el("button", {class: "btn primary mic-round", onclick: async () => {
    if (busy) return;
    stopSpeaking();
    micBtn.classList.add("listening");
    micBtn.textContent = "🎙️";
    try {
      const text = await listen({onPartial: p => partial.textContent = p});
      if (text) {
        logDay({speakSec: Math.min(30, Math.max(5, text.split(" ").length))});
        await send(text);
      }
    } catch {
      toast("בעיה במיקרופון — אפשר להקליד בינתיים");
    }
    micBtn.classList.remove("listening");
    micBtn.textContent = "🎤";
  }}, "🎤");

  const endBtn = el("button", {class: "btn ghost small", onclick: async () => {
    stopSpeaking();
    const userTurns = messages.filter(m => m.role === "user");
    const sec = Math.round((Date.now() - startTime) / 1000);
    if (userTurns.length === 0) return renderSpeak(main);
    skillResult("speaking", true);
    addXP(10 + userTurns.length * 5, "שיחה באנגלית");
    main.replaceChildren(el("div", {class: "screen"},
      el("div", {class: "card center"}, el("div", {class: "muted"}, "המורה מכין משוב על השיחה..."))));
    try {
      const fb = await feedback(messages.map(m => `${m.role === "user" ? "Student" : "Teacher"}: ${m.content}`).join("\n"));
      renderFeedback(main, fb, sec);
    } catch (e) {
      main.replaceChildren(el("div", {class: "screen"},
        backBar(main, "סיכום שיחה"),
        el("div", {class: "card notice"}, aiErrorMessage(e)),
        el("div", {class: "card"}, `דיברת ${userTurns.length} תורות במשך ${Math.round(sec / 60)} דקות. כל הכבוד!`)));
    }
  }}, "סיים וקבל משוב");

  input.addEventListener("keydown", e => { if (e.key === "Enter") send(input.value); });

  main.replaceChildren(el("div", {class: "screen chat-screen"},
    el("div", {class: "backbar"},
      el("button", {class: "btn ghost small", onclick: () => { stopSpeaking(); renderSpeak(main); }}, "✕"),
      el("h2", {}, `${sc.icon} ${sc.name}`),
      endBtn),
    msgList, partial,
    el("div", {class: "chat-bar", dir: "ltr"},
      sttSupported() ? micBtn : null,
      input,
      el("button", {class: "btn primary", onclick: () => send(input.value)}, "שלח"))));
  paintMessages();
  speak(sc.opener);
}

function renderFeedback(main, fb, sec){
  logDay({speakSec: 0}); // הזמן כבר נרשם פר-תור
  const scores = fb.scores || {};
  main.replaceChildren(el("div", {class: "screen"},
    backBar(main, "משוב מהמורה"),
    el("div", {class: "stats-grid"},
      scoreCard("שטף", scores.fluency), scoreCard("הגייה", scores.pronunciation),
      scoreCard("אוצר מילים", scores.vocabulary), scoreCard("דקדוק", scores.grammar)),
    fb.summary ? el("div", {class: "card"}, el("h3", {}, "סיכום"), el("p", {}, fb.summary)) : null,
    fb.mistakes?.length ? el("div", {class: "card"},
      el("h3", {}, "טעויות לתיקון"),
      el("ul", {class: "fb-list"}, fb.mistakes.map(m => el("li", {},
        el("div", {dir: "ltr", class: "bad-text"}, m.original || m.error || ""),
        el("div", {dir: "ltr", class: "good-text"}, m.better || m.correction || ""),
        m.note ? el("div", {class: "muted small-text"}, m.note) : null)))) : null,
    fb.better?.length ? el("div", {class: "card"},
      el("h3", {}, "דרכים טבעיות יותר להגיד"),
      el("ul", {class: "fb-list"}, fb.better.map(b => el("li", {dir: "ltr"}, typeof b === "string" ? b : (b.suggestion || ""))))) : null,
    el("button", {class: "btn primary big", onclick: () => renderSpeak(main)}, "סיום")));
  (fb.mistakes || []).slice(0, 5).forEach(m => recordMistake(`speaking: ${m.original || ""} → ${m.better || ""}`, "speaking"));
}

function scoreCard(label, v){
  const val = typeof v === "number" ? Math.max(0, Math.min(100, Math.round(v))) : null;
  return el("div", {class: "card stat-card"},
    el("div", {class: "stat-v"}, val === null ? "—" : val),
    el("div", {class: "stat-l"}, label));
}

// ---------- מאמן הגייה ----------

function pickSentences(n){
  const lvl = S.profile.level || "A1";
  const order = ["A1","A2","B1","B2","C1","C2"];
  const li = Math.max(0, order.indexOf(lvl));
  const pool = WORDS.filter(w => Math.abs(order.indexOf(w.lvl) - li) <= 1);
  return sample(pool.length ? pool : WORDS, n).map(w => w.ex);
}

function renderPronunciation(main){
  if (!sttSupported()){
    main.replaceChildren(el("div", {class: "screen"}, backBar(main, "מאמן הגייה"),
      el("div", {class: "card notice"}, "מאמן ההגייה דורש זיהוי דיבור — פתח את האפליקציה ב-Chrome (מחשב או אנדרואיד).")));
    return;
  }
  const sentences = pickSentences(5);
  let idx = 0;
  const scores = [];

  function round(){
    stopSpeaking();
    if (idx >= sentences.length) return summary();
    const target = sentences[idx];
    const result = el("div", {class: "speak-result"});
    const box = el("div", {class: "card exercise"});
    main.replaceChildren(el("div", {class: "screen"},
      backBar(main, "מאמן הגייה"),
      el("div", {class: "muted small-text"}, `משפט ${idx + 1}/${sentences.length}`),
      box));

    const micBtn = el("button", {class: "btn primary big mic", onclick: async () => {
      stopSpeaking();
      micBtn.disabled = true; micBtn.textContent = "🎙️ מקשיב...";
      try {
        const spoken = await listen({onPartial: p => result.textContent = p});
        const words = compareWords(target, spoken);
        const acc = accuracy(target, spoken);
        scores.push(acc);
        skillResult("speaking", acc >= 60);
        logDay({speakSec: 8});
        if (acc < 60) recordMistake(`pronunciation: ${target}`, "speaking");
        result.replaceChildren(
          el("div", {dir: "ltr", class: "word-marks"},
            words.map(x => el("span", {class: x.ok ? "w-ok" : "w-bad"}, x.word + " "))),
          el("div", {class: "muted small-text"}, `דיוק: ${acc}% · ${acc >= 85 ? "מצוין!" : acc >= 60 ? "יפה, אפשר לחדד" : "נסה שוב לאט יותר"}`),
          el("div", {class: "row gap"},
            el("button", {class: "btn ghost small", onclick: () => speak(target, {rate: 0.7})}, "🐢 שמע לאט"),
            el("button", {class: "btn ghost small", onclick: () => { micBtn.disabled = false; micBtn.textContent = "🎤 דבר שוב"; }}, "🔁 דבר שוב"),
            el("button", {class: "btn primary small", onclick: () => { idx++; round(); }}, "הבא ←")));
      } catch {
        toast("בעיה במיקרופון. בדוק הרשאות.");
        micBtn.disabled = false; micBtn.textContent = "🎤 דבר עכשיו";
      }
    }}, "🎤 דבר עכשיו");

    box.append(
      el("div", {class: "q"}, "שמע את המשפט וחזור עליו:"),
      el("div", {class: "q sentence", dir: "ltr"}, target),
      el("div", {class: "row gap"},
        el("button", {class: "btn ghost", onclick: () => speak(target)}, "🔊 שמע שוב"),
        el("button", {class: "btn ghost", onclick: () => speak(target, {rate: 0.7})}, "🐢 האט")),
      micBtn, result);
    speak(target);
  }

  function summary(){
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    addXP(20, "מאמן הגייה");
    main.replaceChildren(el("div", {class: "screen"},
      el("div", {class: "card center summary"},
        el("div", {class: "summary-emoji"}, avg >= 85 ? "🌟" : "🗣️"),
        el("h2", {}, `דיוק ממוצע: ${avg}%`),
        el("p", {class: "muted"}, avg >= 85 ? "הגייה מעולה!" : "ההגייה משתפרת עם כל חזרה — נתראה מחר?"),
        el("button", {class: "btn primary big", onclick: () => renderSpeak(main)}, "סיום"))));
  }

  round();
}

// ---------- Shadowing ----------

function renderShadowing(main){
  const sentences = pickSentences(6);
  let idx = 0;

  function round(){
    stopSpeaking();
    if (idx >= sentences.length){
      addXP(20, "Shadowing");
      main.replaceChildren(el("div", {class: "screen"},
        el("div", {class: "card center summary"},
          el("div", {class: "summary-emoji"}, "🎧"),
          el("h2", {}, "סשן Shadowing הושלם!"),
          el("p", {class: "muted"}, "חזרה צמודה אחרי דובר היא אחת הדרכים המהירות לשפר מבטא ושטף."),
          el("button", {class: "btn primary big", onclick: () => renderSpeak(main)}, "סיום"))));
      return;
    }
    const target = sentences[idx];
    main.replaceChildren(el("div", {class: "screen"},
      backBar(main, "Shadowing"),
      el("div", {class: "muted small-text"}, `${idx + 1}/${sentences.length}`),
      el("div", {class: "card exercise"},
        el("div", {class: "q"}, "האזן — ואז חזור מיד אחרי הדובר, באותו קצב:"),
        el("div", {class: "q sentence", dir: "ltr"}, target),
        el("div", {class: "row gap"},
          el("button", {class: "btn primary", onclick: () => speak(target)}, "▶︎ השמע"),
          el("button", {class: "btn ghost", onclick: () => speak(target, {rate: 0.7})}, "🐢 0.75x"),
          el("button", {class: "btn ghost", onclick: () => speak(target, {rate: 0.55})}, "🐌 0.5x")),
        el("p", {class: "muted small-text"}, "טיפ: אל תחכה לסוף המשפט — דבר יחד עם הקול, כמו צל."),
        el("button", {class: "btn primary big", onclick: () => { logDay({speakSec: 8}); idx++; round(); }}, "הבא ←"))));
    speak(target);
  }
  round();
}
