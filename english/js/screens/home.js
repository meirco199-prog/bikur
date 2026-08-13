// מסך הבית: "היום שלך באנגלית" — תוכנית יומית, רצף, XP, אתגר, מילה ומשפט היום.
import { el, todayStr, fmtMinutes, toast } from "../util.js";
import { S, save, weekSummary } from "../store.js";
import { srsCounts, dueWords } from "../srs.js";
import { levelInfo, streakStatus, addXP } from "../gamify.js";
import { WORDS } from "../data/words.js";
import { CHALLENGES, PHRASES } from "../data/scenarios.js";
import { speak } from "../speech.js";
import { buildLesson, runLesson } from "../lesson.js";
import { comebackMessage } from "../notify.js";

function dayHash(){
  const d = todayStr();
  let h = 0;
  for (const c of d) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function renderHome(main){
  const p = S.profile;
  const counts = srsCounts();
  const lvl = levelInfo();
  const st = streakStatus();
  const doneToday = S.lessonDate === todayStr();
  const day = S.stats.days[todayStr()] || {minutes: 0, xp: 0};
  const wk = weekSummary().thisWeek;
  const wod = WORDS[dayHash() % WORDS.length];
  const phrase = PHRASES[dayHash() % PHRASES.length];

  // אתגר יומי — מתחלף כל יום
  if (S.challenge.date !== todayStr()){
    S.challenge = {date: todayStr(), idx: dayHash() % CHALLENGES.length, done: false};
    save();
  }

  const comeback = comebackMessage();

  main.replaceChildren(el("div", {class: "screen"},
    // כותרת
    el("div", {class: "home-top"},
      el("div", {},
        el("h1", {class: "greet"}, greeting() + (p.name ? `, ${p.name}` : "")),
        el("div", {class: "muted"}, `רמה ${p.level || "—"} · ${lvl.cur.name}`)),
      el("div", {class: "streak-pill" + (st.alive && S.game.streak > 0 ? " hot" : "")},
        `🔥 ${S.game.streak}`)),

    comeback ? el("div", {class: "card notice"}, comeback.text,
      comeback.quick ? el("button", {class: "btn primary small", onclick: () => quickStart(main, 3)}, "אימון 3 דקות") : null) : null,

    // היום שלך באנגלית
    el("div", {class: "card today"},
      el("h3", {}, "היום שלך באנגלית"),
      el("ul", {class: "today-list"},
        todayItem("⏱️", `${p.minutesPerDay} דקות לימוד`, day.minutes >= p.minutesPerDay),
        todayItem("🎯", "אימון יומי", doneToday),
        todayItem("📚", counts.due ? `${counts.due} מילים לחזרה` : "אין מילים לחזרה — מעולה", counts.due === 0, counts.due === 0),
        todayItem("🎤", "תרגול דיבור קצר", (S.stats.days[todayStr()]?.speakSec || 0) >= 60)),
      el("button", {class: "btn primary big cta", onclick: () => startDaily(main)},
        doneToday ? "אימון נוסף להיום" : "התחל את האימון היומי"),
      el("div", {class: "row gap center-row"},
        el("span", {class: "muted small-text"}, "יש לי רק:"),
        [3, 5, 10].map(m =>
          el("button", {class: "btn ghost small", onclick: () => quickStart(main, m)}, `${m} דק'`)))),

    // סטטיסטיקות
    el("div", {class: "stats-grid"},
      statCard(`${S.game.xp}`, "XP", lvl.next ? `${lvl.pct}% ל-${lvl.next.name}` : "רמה מקסימלית"),
      statCard(fmtMinutes(wk.minutes), "השבוע", null),
      statCard(`${counts.learning + counts.known + counts.mastered}`, "מילים בלמידה", `${counts.mastered} בשליטה`),
      statCard(`${wk.correct + wk.wrong ? Math.round(100 * wk.correct / (wk.correct + wk.wrong)) : 0}%`, "דיוק שבועי", null)),

    // אתגר יומי
    el("div", {class: "card challenge" + (S.challenge.done ? " done" : "")},
      el("div", {class: "row spread"},
        el("h3", {}, "⚡ אתגר יומי"),
        S.challenge.done ? el("span", {class: "chip good"}, "הושלם ✓") : null),
      el("p", {}, CHALLENGES[S.challenge.idx]),
      S.challenge.done ? null : el("button", {class: "btn ghost small", onclick: () => {
        S.challenge.done = true; save();
        addXP(15, "אתגר יומי");
        renderHome(main);
      }}, "סיימתי את האתגר ✓")),

    // גישה מהירה למורה
    el("button", {class: "card teacher-cta", onclick: () => { location.hash = "#/teacher"; }},
      el("span", {class: "lc-icon"}, "🧑‍🏫"),
      el("span", {class: "li-main"},
        el("span", {class: "li-title"}, "המורה שלי"),
        el("span", {class: "muted small-text"}, "שאלה מהירה? שיעור קצר? המורה מכיר אותך")),
      el("span", {class: "li-arrow"}, "‹")),

    // מילה ומשפט היום
    el("div", {class: "grid2"},
      el("div", {class: "card wod"},
        el("h3", {}, "🌟 מילת היום"),
        el("div", {class: "word-en", dir: "ltr"}, wod.w),
        el("div", {class: "word-ipa", dir: "ltr"}, `/${wod.ipa}/`),
        el("div", {}, wod.he),
        el("div", {class: "example small-text", dir: "ltr"}, wod.ex),
        el("button", {class: "btn ghost small", onclick: () => speak(wod.w + ". " + wod.ex)}, "🔊 השמע")),
      el("div", {class: "card wod"},
        el("h3", {}, "💬 משפט היום"),
        el("div", {class: "word-en phrase-p", dir: "ltr"}, phrase.p),
        el("div", {}, phrase.he),
        el("div", {class: "muted small-text"}, phrase.when),
        el("button", {class: "btn ghost small", onclick: () => speak(phrase.p)}, "🔊 השמע"))),

    // גרף שבועי מינימלי
    weekChart(),
  ));
}

function greeting(){
  const h = new Date().getHours();
  if (h < 5) return "לילה טוב";
  if (h < 12) return "בוקר טוב";
  if (h < 18) return "צהריים טובים";
  return "ערב טוב";
}

function todayItem(icon, text, done, nostrike = false){
  return el("li", {class: (done ? "done" : "") + (nostrike ? " nostrike" : "")},
    el("span", {class: "t-icon"}, icon), text, done ? el("span", {class: "t-check"}, "✓") : null);
}

function statCard(v, label, sub){
  return el("div", {class: "card stat-card"},
    el("div", {class: "stat-v"}, v),
    el("div", {class: "stat-l"}, label),
    sub ? el("div", {class: "stat-sub muted"}, sub) : null);
}

function startDaily(main){
  const items = buildLesson({});
  runLesson(main, items, {onExit: () => renderHome(main)});
}

function quickStart(main, minutes){
  toast(`שיעור מהיר של ${minutes} דקות — יאללה!`);
  const items = buildLesson({minutes});
  runLesson(main, items, {onExit: () => renderHome(main)});
}

// עמודות פשוטות של דקות לימוד בשבוע האחרון
function weekChart(){
  const days = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--){
    const d = new Date(now); d.setDate(d.getDate() - i);
    const key = todayStr(d);
    days.push({
      label: ["א","ב","ג","ד","ה","ו","ש"][d.getDay()],
      mins: S.stats.days[key]?.minutes || 0,
      today: i === 0,
    });
  }
  const max = Math.max(10, ...days.map(d => d.mins));
  return el("div", {class: "card"},
    el("h3", {}, "התקדמות שבועית"),
    el("div", {class: "chart"},
      days.map(d => el("div", {class: "chart-col"},
        el("div", {class: "chart-bar-wrap"},
          el("div", {class: "chart-bar" + (d.today ? " today" : ""),
            style: `height:${Math.max(4, Math.round(100 * d.mins / max))}%`,
            title: `${d.mins} דק'`})),
        el("div", {class: "chart-label"}, d.label)))));
}
