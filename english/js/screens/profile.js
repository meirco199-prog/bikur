// פרופיל: התקדמות, דוח שבועי, הישגים, מטרות והגדרות.
import { el, toast, fmtMinutes, todayStr } from "../util.js";
import { S, save, resetAll, weekSummary } from "../store.js";
import { levelInfo, ACHIEVEMENTS, LEVELS } from "../gamify.js";
import { srsCounts } from "../srs.js";
import { enableNotifs, disableNotifs, scheduleDaily, notifSupported, testReminder, syncReminderState,
  reminderBlocker, installedAsApp } from "../notify.js";
import { pushSupported, pushStatus, testPush } from "../push.js";
import { cefrDesc } from "./onboarding.js";

const SKILL_HE = {vocab: "אוצר מילים", grammar: "דקדוק", listening: "שמיעה", reading: "קריאה", speaking: "דיבור", writing: "כתיבה"};

export function renderProfile(main){
  const p = S.profile;
  const lvl = levelInfo();
  const counts = srsCounts();
  const {thisWeek, lastWeek} = weekSummary();

  main.replaceChildren(el("div", {class: "screen"},
    el("div", {class: "profile-head card"},
      el("div", {class: "avatar"}, (p.name || "?")[0]?.toUpperCase() || "?"),
      el("div", {},
        el("h2", {}, p.name || "לומד אנגלית"),
        el("div", {class: "muted"}, `רמה ${p.level} · ${lvl.cur.name} (${lvl.cur.he})`),
        el("div", {class: "muted small-text"}, cefrDesc(p.level))),
      el("div", {class: "xp-ring"},
        el("div", {class: "stat-v"}, S.game.xp), el("div", {class: "stat-l"}, "XP"))),

    // התקדמות לרמה הבאה
    lvl.next ? el("div", {class: "card"},
      el("div", {class: "row spread"},
        el("span", {}, `בדרך ל-${lvl.next.name} (${lvl.next.he})`),
        el("span", {class: "muted small-text"}, `${lvl.pct}%`)),
      el("div", {class: "progress"}, el("div", {class: "progress-fill", style: `width:${lvl.pct}%`}))) : null,

    // דוח שבועי
    el("div", {class: "card"},
      el("h3", {}, "📊 הדוח השבועי שלך"),
      el("div", {class: "report-grid"},
        reportRow("זמן לימוד", fmtMinutes(thisWeek.minutes), delta(thisWeek.minutes, lastWeek.minutes, "דק'")),
        reportRow("מילים חדשות", thisWeek.words, delta(thisWeek.words, lastWeek.words)),
        reportRow("דיבור", fmtMinutes(Math.round(thisWeek.speakSec / 60)), delta(Math.round(thisWeek.speakSec / 60), Math.round(lastWeek.speakSec / 60), "דק'")),
        reportRow("דיוק", pct(thisWeek), pctDelta(thisWeek, lastWeek)),
        reportRow("אימונים", thisWeek.lessons, delta(thisWeek.lessons, lastWeek.lessons))),
      weeklyAdvice(thisWeek)),

    // מיומנויות
    el("div", {class: "card"},
      el("h3", {}, "מיומנויות"),
      Object.entries(S.skills).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
        el("div", {class: "skill-row"},
          el("span", {class: "skill-name"}, SKILL_HE[k]),
          el("div", {class: "progress slim flex1"}, el("div", {class: "progress-fill", style: `width:${v}%`})),
          el("span", {class: "muted small-text"}, `${v}`)))),

    // רצף והקפאות
    el("div", {class: "card"},
      el("h3", {}, "🔥 רצף"),
      el("div", {class: "row spread"},
        el("div", {}, `רצף נוכחי: ${S.game.streak} ימים · שיא: ${S.game.bestStreak}`),
        el("div", {class: "chip"}, `🧊 ${S.game.freezes} הקפאות`)),
      el("p", {class: "muted small-text"}, "הקפאת רצף נשרפת אוטומטית אם פספסת יום אחד — הרצף נשמר. הקפאה חדשה כל 7 ימי רצף."),
      S.game.streak > 0 && S.game.streak % 7 === 0 && S.game.freezes < 3 ? el("button", {class: "btn ghost small", onclick: () => {
        S.game.freezes++; save(); toast("🧊 קיבלת הקפאת רצף!"); renderProfile(main);
      }}, "אסוף הקפאת רצף (מגיע לך!)") : null),

    // הישגים
    el("div", {class: "card"},
      el("h3", {}, "🏅 הישגים"),
      el("div", {class: "badges"},
        ACHIEVEMENTS.map(a => el("div", {class: "badge" + (S.game.achievements.includes(a.id) ? " got" : "")},
          el("div", {class: "badge-icon"}, a.icon),
          el("div", {class: "badge-name"}, a.name))))),

    // מילים
    el("div", {class: "card"},
      el("h3", {}, "📚 אוצר מילים"),
      el("div", {class: "stats-grid"},
        miniStat(counts.learning, "לומד"), miniStat(counts.known, "מכיר"),
        miniStat(counts.mastered, "שולט"), miniStat(counts.saved, "שמורות"))),

    // תזכורת יומית
    renderReminders(main),

    // הגדרות
    renderSettings(main),
  ));
}

// כרטיס התזכורת היומית — כולל אבחון, כי "מופעל אבל לא מגיע כלום" הוא המצב
// שהכי קשה להבין ממנו מה תקוע. כאן רואים בדיוק איפה השרשרת נקטעת.
function renderReminders(main){
  const on = !!S.settings.notifs;
  const blocker = reminderBlocker();
  const card = el("div", {class: "card"},
    el("h3", {}, "🔔 תזכורת יומית"),

    settingRow("שעת תזכורת", el("input", {class: "input inline", type: "time", dir: "ltr",
      value: S.profile.reminderTime,
      onchange: e => {
        S.profile.reminderTime = e.target.value || "20:00";
        save(); scheduleDaily(); syncReminderState();
        toast(`התזכורת נקבעה ל-${S.profile.reminderTime}`);
      }})),

    settingRow("מצב", el("button", {class: "btn ghost small", onclick: async (ev) => {
      const btn = ev.currentTarget;
      if (!notifSupported()) return toast(blocker || "הדפדפן לא תומך בהתראות");
      if (S.settings.notifs){
        btn.disabled = true;
        await disableNotifs();
        toast("התזכורת כובתה");
        renderProfile(main);
        return;
      }
      btn.disabled = true; btn.textContent = "מפעיל...";
      const ok = await enableNotifs();
      toast(ok ? "התזכורת הופעלה ✓" : "ההרשאה נדחתה בדפדפן — יש לאפשר התראות בהגדרות האתר");
      renderProfile(main);
    }}, on ? "פעילה — כבה" : "כבויה — הפעל")),

    blocker ? el("p", {class: "muted small-text"}, "⚠️ " + blocker) : null,

    on ? el("div", {class: "row gap"},
      el("button", {class: "btn ghost small", onclick: async () => {
        const ok = await testReminder();
        toast(ok ? "התראה מקומית נשלחה 🔔" : "לא הצלחתי להציג התראה בדפדפן הזה");
      }}, "בדיקה מקומית"),
      el("button", {class: "btn ghost small", onclick: async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true; btn.textContent = "שולח מהשרת...";
        const r = await testPush();
        btn.disabled = false; btn.textContent = "בדיקה מהשרת";
        toast(r?.ok
          ? "השרת שלח התראה 🔔 סגור את האפליקציה ותראה אותה מגיעה"
          : "השרת לא הצליח לשלוח — " + (r?.reason === "no_sub" ? "המכשיר עוד לא רשום לשרת" : `קוד ${r?.status || "?"}`));
      }}, "בדיקה מהשרת")) : null,

    on ? el("div", {class: "muted small-text push-status"}, "בודק את מצב החיבור לשרת...") : null);

  // אבחון חי: מה הדפדפן והשרת באמת יודעים
  if (on){
    const box = card.querySelector(".push-status");
    const draw = async () => {
      const lines = [
        `הרשאת התראות: ${Notification.permission === "granted" ? "מאושרת ✓" : Notification.permission}`,
        `מותקן כאפליקציה: ${installedAsApp() ? "כן ✓" : "לא"}`,
      ];
      let registered = false;
      if (!pushSupported()){
        lines.push("Web Push: לא נתמך בדפדפן הזה — תזכורת תגיע רק כשהאפליקציה פתוחה");
        registered = true;   // אין מה לחכות לו
      } else {
        const st = await pushStatus();
        if (!st.subscribed) lines.push("רישום לשרת: עוד לא נרשם — אם זה נשאר כך, כבה והפעל את התזכורת");
        else if (st.error || !st.found) lines.push("רישום לשרת: המכשיר רשום בדפדפן אך השרת לא מאשר — בדוק את כתובת שרת התזכורות");
        else {
          registered = true;
          lines.push(`רישום לשרת: פעיל ✓ (שעה ${st.time})`);
          if (st.lastPush) lines.push(`תזכורת אחרונה מהשרת: ${new Date(st.lastPush).toLocaleString("he-IL")} (קוד ${st.lastStatus})`);
          else lines.push("השרת עוד לא שלח תזכורת למכשיר הזה");
        }
      }
      if (!box?.isConnected) return;
      box.replaceChildren(...lines.map(t => el("div", {}, t)));
      // הרישום לשרת יכול להימשך כמה שניות — בודקים שוב במקום להציג "לא רשום" לנצח
      if (!registered) setTimeout(draw, 5000);
    };
    draw();
  }
  return card;
}

function reportRow(label, val, deltaEl){
  return el("div", {class: "report-row"},
    el("span", {class: "muted"}, label),
    el("strong", {}, String(val)),
    deltaEl);
}
function delta(now, before, unit = ""){
  const d = now - before;
  if (!before && !now) return el("span", {class: "muted small-text"}, "—");
  const cls = d >= 0 ? "delta up" : "delta down";
  return el("span", {class: cls}, `${d >= 0 ? "▲" : "▼"} ${Math.abs(d)}${unit}`);
}
function pct(w){ const t = w.correct + w.wrong; return t ? Math.round(100 * w.correct / t) + "%" : "—"; }
function pctDelta(a, b){
  const pa = a.correct + a.wrong ? 100 * a.correct / (a.correct + a.wrong) : 0;
  const pb = b.correct + b.wrong ? 100 * b.correct / (b.correct + b.wrong) : 0;
  return delta(Math.round(pa), Math.round(pb), "%");
}
function miniStat(v, l){
  return el("div", {class: "card stat-card"}, el("div", {class: "stat-v"}, String(v)), el("div", {class: "stat-l"}, l));
}

function weeklyAdvice(w){
  const skills = Object.entries(S.skills).sort((a, b) => a[1] - b[1]);
  const weakest = SKILL_HE[skills[0][0]];
  const strongest = SKILL_HE[skills[skills.length - 1][0]];
  let advice;
  if (w.minutes === 0) advice = "עוד לא למדת השבוע — אפילו 5 דקות היום יעשו הבדל.";
  else if (w.speakSec < 120) advice = `החוזקה שלך: ${strongest}. להמשך — שווה להוסיף עוד תרגולי דיבור השבוע.`;
  else advice = `החוזקה שלך: ${strongest}. ההמלצה לשבוע הבא: לתת דגש על ${weakest}.`;
  return el("p", {class: "advice"}, "💡 " + advice);
}

function renderSettings(main){
  const s = S.settings;
  return el("div", {class: "card"},
    el("h3", {}, "⚙️ הגדרות"),

    settingRow("מצב תצוגה", el("div", {class: "chips"},
      [["light", "בהיר"], ["dark", "כהה"], ["system", "מערכת"]].map(([id, name]) =>
        el("button", {class: "chip-btn" + (s.theme === id ? " sel" : ""), onclick: () => {
          s.theme = id; save(); applyTheme(); renderProfile(main);
        }}, name)))),

    settingRow("דקות לימוד ביום", el("div", {class: "chips"},
      [5, 10, 15, 20, 30].map(m =>
        el("button", {class: "chip-btn" + (S.profile.minutesPerDay === m ? " sel" : ""), onclick: () => {
          S.profile.minutesPerDay = m; save(); renderProfile(main);
        }}, String(m))))),

    settingRow("מהירות הקראה", el("div", {class: "chips"},
      [[0.8, "איטית"], [1, "רגילה"], [1.15, "מהירה"]].map(([v, name]) =>
        el("button", {class: "chip-btn" + (s.voiceRate === v ? " sel" : ""), onclick: () => {
          s.voiceRate = v; save(); renderProfile(main);
        }}, name)))),

    settingRow("English only — המורה עונה רק באנגלית", el("button", {class: "btn ghost small", onclick: () => {
      S.profile.englishOnly = !S.profile.englishOnly; save(); renderProfile(main);
    }}, S.profile.englishOnly ? "פעיל — כבה" : "כבוי — הפעל")),

    settingRow("כתובת שרת AI", el("input", {class: "input inline", dir: "ltr",
      value: s.aiUrl, onchange: e => { s.aiUrl = e.target.value.trim(); save(); toast("נשמר"); }})),

    settingRow("כתובת שרת תזכורות", el("input", {class: "input inline", dir: "ltr",
      value: s.pushUrl || "", onchange: e => { s.pushUrl = e.target.value.trim(); save(); toast("נשמר — כבה והפעל את התזכורת כדי להירשם מחדש"); }})),

    el("hr", {}),
    el("button", {class: "btn ghost small danger", onclick: () => {
      if (confirm("לאפס את כל הנתונים? כל ההתקדמות תימחק לצמיתות.")){
        resetAll(); location.hash = "#/"; location.reload();
      }
    }}, "אפס את כל הנתונים"));
}

function settingRow(label, control){
  return el("div", {class: "setting-row"},
    el("span", {class: "setting-label"}, label), control);
}

export function applyTheme(){
  const t = S.settings.theme;
  document.documentElement.dataset.theme = t === "system" ? "" : t;
}
