// נקודת הכניסה: ניתוב, ניווט תחתון, אתחול.
import { el } from "./util.js";
import { S } from "./store.js";
import { renderOnboarding } from "./screens/onboarding.js";
import { renderHome } from "./screens/home.js";
import { renderLearn } from "./screens/learn.js";
import { renderSpeak } from "./screens/speak.js";
import { renderWords } from "./screens/words.js";
import { renderProfile, applyTheme } from "./screens/profile.js";
import { renderTeacher } from "./screens/teacher.js";
import { scheduleDaily } from "./notify.js";
import { stopSpeaking } from "./speech.js";

const main = document.getElementById("main");
const nav = document.getElementById("nav");

const ROUTES = {
  "#/home": {render: renderHome, nav: "home"},
  "#/learn": {render: renderLearn, nav: "learn"},
  "#/speak": {render: renderSpeak, nav: "speak"},
  "#/teacher": {render: renderTeacher, nav: "learn"},
  "#/words": {render: renderWords, nav: "words"},
  "#/profile": {render: renderProfile, nav: "profile"},
};

const NAV_ITEMS = [
  {id: "home", hash: "#/home", icon: "🏠", name: "בית"},
  {id: "learn", hash: "#/learn", icon: "📚", name: "לימוד"},
  {id: "speak", hash: "#/speak", icon: "🎤", name: "דיבור", big: true},
  {id: "words", hash: "#/words", icon: "📖", name: "המילים שלי"},
  {id: "profile", hash: "#/profile", icon: "👤", name: "פרופיל"},
];

function buildNav(){
  nav.replaceChildren(...NAV_ITEMS.map(it =>
    el("button", {class: "nav-item" + (it.big ? " nav-big" : ""), "data-id": it.id, onclick: () => {
      location.hash = it.hash;
    }},
      el("span", {class: "nav-icon"}, it.icon),
      el("span", {class: "nav-name"}, it.name))));
}

function route(){
  stopSpeaking();
  document.querySelector(".word-popup")?.remove();
  if (!S.profile.onboarded){
    nav.style.display = "none";
    renderOnboarding(main);
    return;
  }
  nav.style.display = "";
  const r = ROUTES[location.hash] || ROUTES["#/home"];
  if (!ROUTES[location.hash]) history.replaceState(null, "", "#/home");
  nav.querySelectorAll(".nav-item").forEach(b =>
    b.classList.toggle("active", b.dataset.id === r.nav));
  window.scrollTo(0, 0);
  r.render(main);
}

// אתחול
applyTheme();
buildNav();
window.addEventListener("hashchange", route);
route();
scheduleDaily();

// כשחוזרים לאפליקציה אחרי onboarding — לוודא שהניווט מוצג
window.addEventListener("focus", () => {
  if (S.profile.onboarded && S.settings.notifs) scheduleDaily();
});

// service worker לעבודה ללא רשת
if ("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
