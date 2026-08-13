// מסך פתיחה והרשמה: שאלון קצר → מבחן רמה → קביעת CEFR.
import { el, toast } from "../util.js";
import { S, save } from "../store.js";
import { TOPICS } from "../data/words.js";
import { renderPlacement } from "./placement.js";

const GOALS = [
  {id: "daily", icon: "💬", name: "שיחות יומיומיות"},
  {id: "work", icon: "💼", name: "עבודה ועסקים"},
  {id: "travel", icon: "✈️", name: "טיולים"},
  {id: "movies", icon: "🎬", name: "סרטים וסדרות"},
  {id: "study", icon: "🎓", name: "לימודים"},
  {id: "speaking", icon: "🎤", name: "שיפור דיבור"},
  {id: "reading", icon: "📖", name: "שיפור קריאה"},
  {id: "writing", icon: "✍️", name: "שיפור כתיבה"},
];

const SKILLS = [
  {id: "speaking", name: "דיבור"}, {id: "listening", name: "שמיעה"},
  {id: "reading", name: "קריאה"}, {id: "writing", name: "כתיבה"},
  {id: "vocab", name: "אוצר מילים"}, {id: "grammar", name: "דקדוק"},
];

export function renderOnboarding(main){
  const state = {
    name: "", selfLevel: null, goals: new Set(), minutes: 10,
    time: "20:00", weak: new Set(), interests: new Set(),
  };
  let step = 0;
  const steps = [stepWelcome, stepGoals, stepMinutes, stepWeak, stepInterests, stepTestIntro];

  function render(){
    main.replaceChildren();
    const wrap = el("div", {class: "onboard"});
    if (step > 0){
      wrap.append(el("div", {class: "progress slim"},
        el("div", {class: "progress-fill", style: `width:${Math.round(100 * step / steps.length)}%`})));
    }
    steps[step](wrap);
    main.append(wrap);
  }

  function next(){ step++; render(); window.scrollTo(0, 0); }
  function nav(canNext, label = "המשך"){
    return el("div", {class: "onboard-nav"},
      el("button", {class: "btn primary big", onclick: () => {
        if (!canNext()) return;
        next();
      }}, label));
  }

  function stepWelcome(wrap){
    const nameInput = el("input", {class: "input", placeholder: "איך קוראים לך?", value: state.name,
      oninput: e => state.name = e.target.value});
    wrap.append(
      el("div", {class: "hero"},
        el("div", {class: "hero-logo"}, "🇬🇧"),
        el("h1", {}, "English — המורה הפרטי שלך"),
        el("p", {class: "muted"}, "כמה דקות ביום, מותאם בדיוק אליך: דיבור, מילים, הבנה — עם מורה AI שמכיר אותך.")),
      nameInput,
      el("h3", {}, "מה רמת האנגלית שלך?"),
      chipGroup([
        {id: "beginner", name: "מתחיל — כמעט מאפס"},
        {id: "basic", name: "בסיסי — מבין קצת"},
        {id: "mid", name: "בינוני — מסתדר אבל נתקע"},
        {id: "high", name: "טוב — רוצה להשתפר ולדייק"},
      ], v => { state.selfLevel = v; }, () => state.selfLevel, true),
      nav(() => {
        if (!nameInput.value.trim()) { toast("איך קוראים לך? :)"); return false; }
        if (!state.selfLevel) { toast("בחר רמה משוערת"); return false; }
        state.name = nameInput.value.trim();
        return true;
      }, "בוא נתחיל"));
  }

  function stepGoals(wrap){
    wrap.append(
      el("h2", {}, "למה אתה לומד אנגלית?"),
      el("p", {class: "muted"}, "אפשר לבחור כמה מטרות."),
      chipGroup(GOALS.map(g => ({id: g.id, name: `${g.icon} ${g.name}`})),
        v => state.goals.has(v) ? state.goals.delete(v) : state.goals.add(v),
        () => state.goals),
      nav(() => state.goals.size > 0 || (toast("בחר לפחות מטרה אחת"), false)));
  }

  function stepMinutes(wrap){
    wrap.append(
      el("h2", {}, "כמה דקות ביום?"),
      el("p", {class: "muted"}, "עדיף קצר וקבוע מארוך ונדיר."),
      chipGroup([5, 10, 15, 20, 30].map(m => ({id: m, name: `${m} דקות`})),
        v => state.minutes = v, () => state.minutes, true),
      el("h3", {}, "באיזו שעה נוח לך ללמוד?"),
      el("input", {class: "input", type: "time", value: state.time, dir: "ltr",
        oninput: e => state.time = e.target.value}),
      nav(() => true));
  }

  function stepWeak(wrap){
    wrap.append(
      el("h2", {}, "מה הכי קשה לך?"),
      el("p", {class: "muted"}, "האימונים ייתנו לזה יותר משקל."),
      chipGroup(SKILLS, v => state.weak.has(v) ? state.weak.delete(v) : state.weak.add(v), () => state.weak),
      nav(() => true));
  }

  function stepInterests(wrap){
    wrap.append(
      el("h2", {}, "מה מעניין אותך?"),
      el("p", {class: "muted"}, "נלמד דרך תכנים שאתה אוהב."),
      chipGroup(Object.entries(TOPICS).filter(([id]) => id !== "general")
          .map(([id, name]) => ({id, name})),
        v => state.interests.has(v) ? state.interests.delete(v) : state.interests.add(v),
        () => state.interests),
      nav(() => true));
  }

  function stepTestIntro(wrap){
    wrap.append(
      el("div", {class: "hero"},
        el("div", {class: "hero-logo"}, "📋"),
        el("h2", {}, `${state.name}, נשאר רק מבחן רמה קצר`),
        el("p", {class: "muted"}, "כ-2 דקות: מילים, משפטים, דקדוק, הקשבה וקריאה. המבחן נעצר כשנמצאה הרמה — בלי לחץ, אי אפשר להיכשל.")),
      el("button", {class: "btn primary big", onclick: startTest}, "התחל מבחן רמה"),
      el("button", {class: "btn ghost", onclick: () => finish(selfLevelToCefr(state.selfLevel))}, "דלג — קבע רמה לפי הערכה עצמית"));
  }

  function startTest(){
    saveProfile();
    renderPlacement(main, level => finish(level));
  }

  function finish(level){
    saveProfile();
    S.profile.level = level;
    S.profile.onboarded = true;
    // מיומנויות חלשות מקבלות ציון פתיחה נמוך כדי לקבל משקל באימון
    for (const skill of state.weak) S.skills[skill] = 35;
    save();
    main.replaceChildren(
      el("div", {class: "card center summary"},
        el("div", {class: "summary-emoji"}, "🎉"),
        el("h2", {}, `הרמה שלך: ${level}`),
        el("p", {class: "muted"}, cefrDesc(level)),
        el("p", {}, `בנינו לך מסלול אישי: ${S.profile.minutesPerDay} דקות ביום, עם דגש על ${
          [...state.weak].map(w => SKILLS.find(s => s.id === w)?.name).filter(Boolean).join(", ") || "כל המיומנויות"}.`),
        el("button", {class: "btn primary big", onclick: () => {
          location.hash = "#/home";
          // אם ה-hash לא השתנה — מפעילים ניתוב ידנית
          window.dispatchEvent(new Event("hashchange"));
        }}, "לדף הבית")));
  }

  function saveProfile(){
    Object.assign(S.profile, {
      name: state.name, goals: [...state.goals], minutesPerDay: state.minutes,
      reminderTime: state.time, weakSkills: [...state.weak], interests: [...state.interests],
    });
    save();
  }

  render();
}

function chipGroup(items, onPick, getSel, single = false){
  const wrap = el("div", {class: "chips"});
  const btns = new Map();
  const paint = () => {
    const sel = getSel();
    for (const [id, b] of btns){
      b.classList.toggle("sel", single ? sel === id : sel.has(id));
    }
  };
  for (const it of items){
    const b = el("button", {class: "chip-btn", onclick: () => { onPick(it.id); paint(); }}, it.name);
    btns.set(it.id, b);
    wrap.append(b);
  }
  paint();
  return wrap;
}

function selfLevelToCefr(v){
  return {beginner: "A1", basic: "A2", mid: "B1", high: "B2"}[v] || "A2";
}

export function cefrDesc(level){
  return {
    A1: "מתחיל — בסיס ראשוני. נבנה יסודות חזקים צעד אחר צעד.",
    A2: "בסיסי — אתה מסתדר במצבים מוכרים. הגיע הזמן להרחיב.",
    B1: "בינוני — אתה מתקשר! נעבוד על ביטחון ושטף.",
    B2: "בינוני-גבוה — רמה טובה מאוד. נלטש דיוק וניואנסים.",
    C1: "מתקדם — קרוב לשליטה מלאה. נעבוד על עומק ודקויות.",
    C2: "שליטה — רמת שפת אם כמעט. נשמור על חדות.",
  }[level] || "";
}
