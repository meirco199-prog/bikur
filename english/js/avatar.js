// מורה מאויר שנראה כמו אדם בתוך חלון וידאו. SVG פרמטרי עם עיניים שממצמצות,
// תנועת נשימה עדינה, ופה שנפתח ונסגר בזמן דיבור (לק-סינק מקורב מ-TTS).
import { el } from "./util.js";

export const TEACHERS = [
  {id: "sarah", name: "Sarah", gender: "f", he: "שרה",
   skin: "#f0c6a0", cheek: "#e6a98a", hair: "#7a4a24", hairStyle: "long",
   iris: "#5b7c9d", shirt: "#7c6ff0", bg1: "#e9e7ff", bg2: "#d6d2fb",
   voice: ["Google US English", "Samantha", "Microsoft Aria", "Microsoft Zira", "Karen", "Moira", "Tessa"]},
  {id: "david", name: "David", gender: "m", he: "דיוויד",
   skin: "#e3b088", cheek: "#d19468", hair: "#2f2a26", hairStyle: "short",
   iris: "#5a4632", shirt: "#2f9e8f", bg1: "#e2f1ee", bg2: "#c8e6df",
   voice: ["Google UK English Male", "Daniel", "Microsoft Guy", "Alex", "Fred", "Rishi"]},
];

export function teacherById(id){ return TEACHERS.find(t => t.id === id) || TEACHERS[0]; }

// בונה את דמות המורה. מחזיר צומת DOM עם מתודות: setState, setMouth, destroy.
export function createAvatar(t){
  // שיער: כיפה מלאה שמכסה את קודקוד הראש עד קו שיער טבעי (~y54),
  // ולשיער ארוך גם פאנלים בצדדים עד הכתפיים.
  const crown = `<path d="M49 78 Q49 28 100 26 Q151 28 151 78 Q151 56 128 54 Q100 49 72 54 Q49 56 49 78 Z" fill="${t.hair}"/>`;
  const backHair = t.hairStyle === "long" ? `
    <path d="M46 66 Q32 130 50 176 Q38 112 60 74 Z" fill="${t.hair}"/>
    <path d="M154 66 Q168 130 150 176 Q162 112 140 74 Z" fill="${t.hair}"/>
    <path d="M48 70 Q44 120 58 150 Q50 104 62 78 Z" fill="${t.hair}" opacity="0.9"/>
    <path d="M152 70 Q156 120 142 150 Q150 104 138 78 Z" fill="${t.hair}" opacity="0.9"/>` : "";

  const svg = `
  <svg viewBox="0 0 200 210" class="ava-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <radialGradient id="avabg-${t.id}" cx="50%" cy="38%" r="80%">
        <stop offset="0%" stop-color="${t.bg1}"/><stop offset="100%" stop-color="${t.bg2}"/>
      </radialGradient>
      <clipPath id="avaclip-${t.id}"><rect x="0" y="0" width="200" height="210" rx="0"/></clipPath>
    </defs>
    <g clip-path="url(#avaclip-${t.id})">
      <rect x="0" y="0" width="200" height="210" fill="url(#avabg-${t.id})"/>
      <!-- כתפיים + חולצה -->
      <path d="M28 210 Q34 158 74 150 Q100 168 126 150 Q166 158 172 210 Z" fill="${t.shirt}"/>
      <path d="M86 150 Q100 166 114 150 L110 138 L90 138 Z" fill="${t.skin}"/>
      <!-- שיער אחורי -->
      ${backHair}
      <!-- צוואר -->
      <rect x="88" y="120" width="24" height="30" rx="10" fill="${t.skin}"/>
      <!-- אוזניים -->
      <ellipse cx="52" cy="98" rx="9" ry="13" fill="${t.skin}"/>
      <ellipse cx="148" cy="98" rx="9" ry="13" fill="${t.skin}"/>
      <!-- ראש -->
      <g class="ava-head">
        <ellipse cx="100" cy="94" rx="50" ry="56" fill="${t.skin}"/>
        <!-- לחיים -->
        <ellipse cx="72" cy="108" rx="10" ry="7" fill="${t.cheek}" opacity="0.4"/>
        <ellipse cx="128" cy="108" rx="10" ry="7" fill="${t.cheek}" opacity="0.4"/>
        <!-- שיער (קודקוד) -->
        ${crown}
        <!-- גבות -->
        <rect class="ava-brow" x="60" y="74" width="26" height="6" rx="3" fill="${t.hair}"/>
        <rect class="ava-brow" x="114" y="74" width="26" height="6" rx="3" fill="${t.hair}"/>
        <!-- עיניים -->
        <g class="ava-eye ava-eye-l">
          <ellipse cx="74" cy="90" rx="12" ry="8" fill="#fff"/>
          <circle class="ava-iris" cx="74" cy="90" r="5.2" fill="${t.iris}"/>
          <circle cx="74" cy="90" r="2.4" fill="#20232c"/>
          <circle cx="76" cy="88" r="1.1" fill="#fff"/>
        </g>
        <g class="ava-eye ava-eye-r">
          <ellipse cx="126" cy="90" rx="12" ry="8" fill="#fff"/>
          <circle class="ava-iris" cx="126" cy="90" r="5.2" fill="${t.iris}"/>
          <circle cx="126" cy="90" r="2.4" fill="#20232c"/>
          <circle cx="128" cy="88" r="1.1" fill="#fff"/>
        </g>
        <!-- אף -->
        <path d="M100 96 Q96 108 92 112 Q100 116 108 112 Q104 108 100 96 Z" fill="${t.cheek}" opacity="0.5"/>
        <!-- פה: שפתיים + פתח שנפתח בדיבור -->
        <g class="ava-mouth-grp">
          <ellipse cx="100" cy="126" rx="17" ry="8" fill="${t.cheek}" opacity="0.55"/>
          <ellipse class="ava-mouth" cx="100" cy="126" rx="13" ry="2.5" fill="#7a3b3b"/>
          <path class="ava-smile" d="M86 124 Q100 134 114 124" stroke="#7a3b3b" stroke-width="3" fill="none" stroke-linecap="round"/>
        </g>
      </g>
    </g>
  </svg>`;

  const node = el("div", {class: "ava"});
  node.innerHTML = svg;
  const mouth = node.querySelector(".ava-mouth");
  const smile = node.querySelector(".ava-smile");
  const irises = node.querySelectorAll(".ava-iris");
  const eyes = node.querySelectorAll(".ava-eye");
  const head = node.querySelector(".ava-head");

  // מצמוץ אקראי
  let blink = setInterval(() => {
    eyes.forEach(e => e.style.transform = "scaleY(0.1)");
    setTimeout(() => eyes.forEach(e => e.style.transform = ""), 130);
  }, 3200 + Math.random() * 2200);

  function setState(state){
    node.dataset.state = state;
    // מבט: בחשיבה מסתכל למעלה, בהקשבה קצת הצידה
    let dx = 0, dy = 0;
    if (state === "thinking") dy = -2.2;
    if (state === "listening") dx = 1.6;
    irises.forEach(i => i.setAttribute("transform", `translate(${dx} ${dy})`));
    if (state !== "speaking") setMouth(0);
  }

  // פתיחת פה 0..1 — מסתיר את החיוך ומגדיל את הפתח בזמן דיבור
  function setMouth(v){
    if (v > 0.06){
      smile.style.opacity = "0";
      mouth.setAttribute("ry", String(2 + v * 9));
      mouth.setAttribute("rx", String(13 - v * 3));
    } else {
      smile.style.opacity = "1";
      mouth.setAttribute("ry", "2.5");
      mouth.setAttribute("rx", "13");
    }
  }

  function destroy(){ clearInterval(blink); }

  setState("idle");
  return {node, setState, setMouth, destroy};
}
