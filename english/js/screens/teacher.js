// "המורה שלי": צ'אט חופשי עם מורה AI שמכיר את הפרופיל, הטעויות והמילים של המשתמש.
import { el, toast } from "../util.js";
import { S, save, logDay } from "../store.js";
import { chat, aiErrorMessage } from "../ai.js";
import { speak, stopSpeaking, sttSupported, listen } from "../speech.js";
import { addXP } from "../gamify.js";

const QUICK = [
  "בוא נדבר אנגלית",
  "תן לי שיעור של 5 דקות",
  "תבדוק אותי על המילים שלמדתי השבוע",
  "Why do we say went and not goed?",
];

export function renderTeacher(main){
  stopSpeaking();
  const messages = S.teacherHistory.length ? [...S.teacherHistory] :
    [{role: "assistant", content: `Hi ${S.profile.name || "there"}! I'm your English teacher. I know your level (${S.profile.level || "A2"}), the words you're learning, and what's hard for you. Ask me anything — in English or Hebrew!`}];
  let busy = false;

  const msgList = el("div", {class: "chat-list"});
  const partial = el("div", {class: "chat-partial", dir: "ltr"});
  const input = el("input", {class: "input chat-input", placeholder: "שאל באנגלית או בעברית...", autocomplete: "off"});

  function persist(){
    S.teacherHistory = messages.slice(-30);
    save();
  }

  function paint(){
    msgList.replaceChildren(...messages.map(m =>
      el("div", {class: "bubble " + (m.role === "assistant" ? "them" : "me"),
        dir: /[א-ת]/.test(m.content) ? "rtl" : "ltr"},
        m.content,
        m.role === "assistant" ? el("button", {class: "bubble-speak", onclick: () => speak(stripHebrew(m.content))}, "🔊") : null)));
    msgList.scrollTop = msgList.scrollHeight;
  }

  async function send(text){
    if (!text.trim() || busy) return;
    busy = true;
    messages.push({role: "user", content: text.trim()});
    paint(); persist();
    input.value = ""; partial.textContent = "";
    const typing = el("div", {class: "bubble them typing", dir: "ltr"}, "…");
    msgList.append(typing);
    msgList.scrollTop = msgList.scrollHeight;
    try {
      const reply = await chat(messages.slice(-16), null, "teacher");
      messages.push({role: "assistant", content: reply});
      addXP(5);
      paint(); persist();
    } catch (e) {
      typing.remove();
      toast(aiErrorMessage(e));
      messages.pop(); paint();
      input.value = text;
    }
    busy = false;
  }

  const micBtn = sttSupported() ? el("button", {class: "btn primary mic-round", onclick: async () => {
    if (busy) return;
    stopSpeaking();
    micBtn.classList.add("listening");
    try {
      const text = await listen({onPartial: p => partial.textContent = p});
      if (text){ logDay({speakSec: 8}); await send(text); }
    } catch { toast("בעיה במיקרופון"); }
    micBtn.classList.remove("listening");
  }}, "🎤") : null;

  input.addEventListener("keydown", e => { if (e.key === "Enter") send(input.value); });

  main.replaceChildren(el("div", {class: "screen chat-screen"},
    el("div", {class: "backbar"},
      el("h2", {}, "🧑‍🏫 המורה שלי"),
      el("button", {class: "btn ghost small", onclick: () => {
        if (confirm("למחוק את היסטוריית השיחה עם המורה?")){
          S.teacherHistory = []; save(); renderTeacher(main);
        }
      }}, "🗑️ נקה")),
    el("div", {class: "chips quick-chips"},
      QUICK.map(q => el("button", {class: "chip-btn", onclick: () => send(q)}, q))),
    msgList, partial,
    el("div", {class: "chat-bar", dir: "rtl"},
      micBtn, input,
      el("button", {class: "btn primary", onclick: () => send(input.value)}, "שלח"))));
  paint();
}

function stripHebrew(s){
  const en = s.replace(/[א-ת][^.!?]*[.!?]?/g, "").trim();
  return en || s;
}
