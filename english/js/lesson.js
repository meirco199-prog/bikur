// מנוע האימון היומי: בונה רצף תרגילים מותאם אישית לפי רמת המשתמש,
// המיומנויות החלשות שלו ומילים שממתינות לחזרה — ומריץ אותם אחד-אחד.
import { el, shuffle, sample, pick, toast, confetti, compareWords, accuracy } from "./util.js";
import { S, save, logDay, skillResult, recordMistake, weakestSkills } from "./store.js";
import { WORDS, wordKey } from "./data/words.js";
import { GRAMMAR } from "./data/grammar.js";
import { review, dueWords, newWords, ensureEntry, toggleSaved } from "./srs.js";
import { addXP, checkAchievements } from "./gamify.js";
import { speak, stopSpeaking, sttSupported, listen } from "./speech.js";
import { todayStr } from "./util.js";

// ---------- בניית אימון ----------

// מחזיר רשימת תרגילים לפי משך בדקות. לכל תרגיל ~40 שניות בממוצע.
export function buildLesson({minutes = null, focus = null} = {}){
  const mins = minutes ?? S.profile.minutesPerDay ?? 10;
  const count = Math.max(4, Math.min(30, Math.round(mins * 1.5)));
  const weak = focus ? [focus] : weakestSkills(2);
  const items = [];

  // 1) חזרות שממתינות — תמיד קודם (עד שליש מהאימון)
  const due = dueWords(Math.ceil(count / 3));
  for (const w of due) items.push(vocabExercise(w, true));

  // 2) מילים חדשות — היכרות + תרגול מיידי
  const fresh = newWords(Math.max(1, Math.round(count / 5)));
  for (const w of fresh){
    items.push(wordIntro(w));
    items.push(vocabExercise(w, false));
  }

  // 3) השלמה לפי מיומנויות חלשות
  const makers = {
    grammar: grammarExercise,
    listening: listeningExercise,
    speaking: speakingExercise,
    writing: dictationExercise,
    vocab: () => vocabExercise(pickPracticedWord(), false),
    reading: sentenceExercise,
  };
  const pool = [];
  for (const skill of Object.keys(makers)){
    const weight = weak.includes(skill) ? 3 : 1;
    for (let i = 0; i < weight; i++) pool.push(skill);
  }
  let guard = 0;
  while (items.length < count && guard++ < 100){
    const skill = pick(pool);
    if (skill === "speaking" && !sttSupported()) continue;
    const ex = makers[skill]();
    if (ex) items.push(ex);
  }
  return shuffle3(items);
}

// ערבוב עדין ששומר על "היכרות עם מילה" לפני התרגול שלה
function shuffle3(items){
  const intros = new Map();
  items.forEach((it, i) => { if (it.introFor) intros.set(it.introFor, i); });
  const rest = shuffle(items.filter(it => !it.introFor && !it.practiceFor));
  const pairs = items.filter(it => it.introFor);
  const out = [];
  let ri = 0;
  for (const intro of pairs){
    out.push(intro);
    const prac = items.find(it => it.practiceFor === intro.introFor);
    if (prac) out.push(prac);
    if (ri < rest.length) out.push(rest[ri++]);
  }
  while (ri < rest.length) out.push(rest[ri++]);
  return out;
}

function pickPracticedWord(){
  const done = Object.entries(S.srs).filter(([, e]) => e.ok + e.fail > 0);
  if (done.length){
    const key = pick(done)[0];
    const w = WORDS.find(x => wordKey(x) === key);
    if (w) return w;
  }
  return pick(WORDS.filter(w => w.lvl === (S.profile.level || "A1"))) || pick(WORDS);
}

function distractors(word, field = "he", n = 3){
  const others = WORDS.filter(w => w !== word && w[field] !== word[field]);
  return sample(others, n).map(w => w[field]);
}

// ---------- תרגילים ----------
// כל תרגיל: {skill, title, render(box, done)} כאשר done(correct, meta)

function wordIntro(w){
  return {
    skill: "vocab", title: "מילה חדשה", introFor: wordKey(w), noScore: true,
    render(box, done){
      const e = ensureEntry(wordKey(w));
      const savedBtn = el("button", {class: "btn ghost small", onclick: () => {
        const s = toggleSaved(wordKey(w));
        savedBtn.textContent = s ? "★ נשמר" : "☆ שמור למילים שלי";
      }}, e.saved ? "★ נשמר" : "☆ שמור למילים שלי");
      box.append(
        el("div", {class: "word-card"},
          el("div", {class: "word-en", dir: "ltr"}, w.w),
          el("div", {class: "word-ipa", dir: "ltr"}, `/${w.ipa}/`),
          el("div", {class: "word-he"}, w.he),
          el("button", {class: "btn ghost small", onclick: () => speak(w.w)}, "🔊 השמע"),
          el("div", {class: "example", dir: "ltr"}, w.ex),
          el("div", {class: "example-he"}, w.exHe),
          w.syn?.length ? el("div", {class: "word-extra"}, "מילים דומות: ", el("bdi", {dir: "ltr"}, w.syn.join(", "))) : null,
          w.ant?.length ? el("div", {class: "word-extra"}, "הפוך: ", el("bdi", {dir: "ltr"}, w.ant.join(", "))) : null,
          w.phr?.length ? el("div", {class: "word-extra"}, "ביטוי: ", el("bdi", {dir: "ltr"}, w.phr[0])) : null,
          savedBtn,
        ),
        el("button", {class: "btn primary big", onclick: () => done(true)}, "הבנתי, הלאה")
      );
      speak(w.w);
    }
  };
}

function vocabExercise(w, isReview){
  const kinds = ["en2he", "he2en", "type", "sentence"];
  const kind = pick(kinds);
  const ex = {skill: "vocab", practiceFor: isReview ? null : wordKey(w),
    title: isReview ? "חזרה" : "תרגול מילה"};
  ex.render = (box, done) => {
    const onAnswer = (correct, correctText) => {
      review(wordKey(w), correct);
      skillResult("vocab", correct);
      if (!correct) recordMistake(`word: ${w.w}`, "vocab");
      showFeedback(box, correct, correctText, () => done(correct));
    };
    if (kind === "en2he"){
      const opts = shuffle([w.he, ...distractors(w, "he")]);
      box.append(el("div", {class: "q-word", dir: "ltr"}, w.w),
        el("button", {class: "btn ghost small", onclick: () => speak(w.w)}, "🔊"),
        el("div", {class: "q"}, "מה פירוש המילה?"),
        optsList(opts, o => onAnswer(o === w.he, w.he)));
      speak(w.w);
    } else if (kind === "he2en"){
      const opts = shuffle([w.w, ...distractors(w, "w")]);
      box.append(el("div", {class: "q-word"}, w.he),
        el("div", {class: "q"}, "איך אומרים באנגלית?"),
        optsList(opts, o => onAnswer(o === w.w, w.w), true));
    } else if (kind === "type"){
      const input = el("input", {class: "input", dir: "ltr", autocapitalize: "off", autocomplete: "off",
        placeholder: "הקלד באנגלית..."});
      const check = () => {
        const ok = input.value.trim().toLowerCase() === w.w.toLowerCase();
        onAnswer(ok, w.w);
      };
      input.addEventListener("keydown", e => { if (e.key === "Enter") check(); });
      box.append(el("div", {class: "q-word"}, w.he),
        el("div", {class: "q"}, "הקלד את המילה באנגלית:"),
        input, el("button", {class: "btn primary", onclick: check}, "בדוק"));
      setTimeout(() => input.focus(), 50);
    } else {
      // השלמת משפט
      const re = new RegExp(w.w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const blanked = w.ex.replace(re, "_____");
      const opts = shuffle([w.w, ...distractors(w, "w")]);
      box.append(el("div", {class: "q sentence", dir: "ltr"}, blanked),
        el("div", {class: "example-he"}, w.exHe),
        el("div", {class: "q"}, "השלם את המילה החסרה:"),
        optsList(opts, o => onAnswer(o === w.w, w.w), true));
    }
  };
  return ex;
}

function sentenceExercise(){
  const w = pickPracticedWord();
  return {skill: "reading", title: "הבנת משפט",
    render(box, done){
      const opts = shuffle([w.exHe, ...sample(WORDS.filter(x => x !== w), 3).map(x => x.exHe)]);
      box.append(el("div", {class: "q sentence", dir: "ltr"}, w.ex),
        el("button", {class: "btn ghost small", onclick: () => speak(w.ex)}, "🔊 השמע"),
        el("div", {class: "q"}, "מה פירוש המשפט?"),
        optsList(opts, o => {
          const ok = o === w.exHe;
          skillResult("reading", ok);
          showFeedback(box, ok, w.exHe, () => done(ok));
        }));
    }};
}

function listeningExercise(){
  const w = pickPracticedWord();
  return {skill: "listening", title: "הבנת הנשמע",
    render(box, done){
      const opts = shuffle([w.exHe, ...sample(WORDS.filter(x => x !== w), 3).map(x => x.exHe)]);
      let revealed = false;
      const transcript = el("div", {class: "q sentence hidden-text", dir: "ltr"}, w.ex);
      box.append(
        el("div", {class: "q"}, "האזן למשפט ובחר את המשמעות:"),
        el("div", {class: "row gap"},
          el("button", {class: "btn primary", onclick: () => speak(w.ex)}, "▶︎ השמע"),
          el("button", {class: "btn ghost", onclick: () => speak(w.ex, {rate: 0.7})}, "🐢 0.75x"),
          el("button", {class: "btn ghost", onclick: () => speak(w.ex, {rate: 0.5})}, "🐌 0.5x"),
        ),
        transcript,
        optsList(opts, o => {
          const ok = o === w.exHe;
          transcript.classList.remove("hidden-text");
          skillResult("listening", ok);
          showFeedback(box, ok, w.exHe, () => done(ok));
        }));
      speak(w.ex);
    }};
}

function dictationExercise(){
  const w = pickPracticedWord();
  return {skill: "writing", title: "הכתבה",
    render(box, done){
      const input = el("input", {class: "input", dir: "ltr", autocapitalize: "off", autocomplete: "off",
        placeholder: "כתוב את מה ששמעת..."});
      const check = () => {
        const acc = accuracy(w.ex, input.value);
        const ok = acc >= 70;
        skillResult("writing", ok);
        if (!ok) recordMistake(`dictation: ${input.value} → ${w.ex}`, "writing");
        showFeedback(box, ok, w.ex, () => done(ok), acc ? `דיוק: ${acc}%` : null);
      };
      input.addEventListener("keydown", e => { if (e.key === "Enter") check(); });
      box.append(
        el("div", {class: "q"}, "האזן וכתוב את המשפט:"),
        el("div", {class: "row gap"},
          el("button", {class: "btn primary", onclick: () => speak(w.ex)}, "▶︎ השמע"),
          el("button", {class: "btn ghost", onclick: () => speak(w.ex, {rate: 0.7})}, "🐢 לאט"),
        ),
        input, el("button", {class: "btn primary", onclick: check}, "בדוק"));
      speak(w.ex);
    }};
}

function speakingExercise(){
  const w = pickPracticedWord();
  return {skill: "speaking", title: "תרגול דיבור",
    render(box, done){
      const target = w.ex;
      const result = el("div", {class: "speak-result"});
      let spoken = "";
      const micBtn = el("button", {class: "btn primary big mic", onclick: async () => {
        micBtn.disabled = true; micBtn.textContent = "🎙️ מקשיב...";
        try {
          spoken = await listen({onPartial: p => result.textContent = p});
          const words = compareWords(target, spoken);
          const acc = accuracy(target, spoken);
          result.replaceChildren(el("div", {dir: "ltr", class: "word-marks"},
            words.map(x => el("span", {class: x.ok ? "w-ok" : "w-bad"}, x.word + " "))));
          const ok = acc >= 60;
          skillResult("speaking", ok);
          logDay({speakSec: 10});
          if (!ok) recordMistake(`pronunciation: ${target}`, "speaking");
          showFeedback(box, ok, target, () => done(ok), `זוהה: ${spoken || "—"} · דיוק ${acc}%`);
        } catch {
          toast("לא הצלחתי להפעיל את המיקרופון. בדוק הרשאות.");
          micBtn.disabled = false; micBtn.textContent = "🎤 דבר עכשיו";
        }
      }}, "🎤 דבר עכשיו");
      box.append(
        el("div", {class: "q"}, "קרא את המשפט בקול:"),
        el("div", {class: "q sentence", dir: "ltr"}, target),
        el("div", {class: "row gap"},
          el("button", {class: "btn ghost", onclick: () => speak(target)}, "🔊 שמע קודם"),
          el("button", {class: "btn ghost", onclick: () => speak(target, {rate: 0.7})}, "🐢 לאט"),
        ),
        micBtn, result);
    }};
}

function grammarExercise(){
  const topics = GRAMMAR.filter(g => levelNear(g.lvl));
  const g = pick(topics.length ? topics : GRAMMAR);
  const q = pick(g.quiz);
  return {skill: "grammar", title: g.name,
    render(box, done){
      box.append(
        el("div", {class: "chip"}, g.name),
        el("div", {class: "q sentence", dir: "ltr"}, q.q),
        optsList(shuffle([...q.opts.keys()]).map(i => q.opts[i]), o => {
          const ok = o === q.opts[q.a];
          skillResult("grammar", ok);
          const done2 = () => done(ok);
          if (!ok){
            recordMistake(`grammar ${g.id}: ${q.q}`, "grammar");
            const gd = S.grammarDone[g.id] = S.grammarDone[g.id] || {ok: 0, fail: 0};
            gd.fail++; save();
            showFeedback(box, false, q.opts[q.a], done2, q.why + " · " + g.short);
          } else {
            const gd = S.grammarDone[g.id] = S.grammarDone[g.id] || {ok: 0, fail: 0};
            gd.ok++; save();
            showFeedback(box, true, q.opts[q.a], done2);
          }
        }, true));
    }};
}

function levelNear(lvl){
  const order = ["A1","A2","B1","B2","C1","C2"];
  const a = order.indexOf(lvl), b = order.indexOf(S.profile.level || "A1");
  return Math.abs(a - b) <= 1;
}

// ---------- רכיבי עזר ----------

function optsList(opts, onPick, ltr = false){
  const wrap = el("div", {class: "opts"});
  for (const o of opts){
    wrap.append(el("button", {class: "opt", dir: ltr ? "ltr" : "rtl", onclick: (ev) => {
      // נעילת כל הכפתורים אחרי בחירה
      wrap.querySelectorAll("button").forEach(b => b.disabled = true);
      ev.currentTarget.classList.add("picked");
      onPick(o);
    }}, o));
  }
  return wrap;
}

function showFeedback(box, correct, correctText, next, extra = null){
  const fb = el("div", {class: "feedback " + (correct ? "good" : "bad")},
    el("div", {class: "fb-title"}, correct ? pick(["מעולה! ✓", "בדיוק! ✓", "יפה מאוד! ✓", "נכון! ✓"]) : "לא מדויק"),
    correct ? null : el("div", {class: "fb-answer"}, "התשובה: ", el("bdi", {dir: "ltr"}, correctText)),
    extra ? el("div", {class: "fb-extra"}, extra) : null,
    el("button", {class: "btn primary", onclick: next}, "המשך"));
  box.append(fb);
  fb.scrollIntoView({behavior: "smooth", block: "end"});
}

// ---------- הרצת אימון ----------

export function runLesson(container, items, {title = "אימון יומי", minutes = null, onExit = null} = {}){
  let idx = 0, correct = 0, wrong = 0;
  const startTime = Date.now();

  function renderCurrent(){
    stopSpeaking();
    container.replaceChildren();
    if (idx >= items.length) return renderSummary();
    const it = items[idx];
    const head = el("div", {class: "lesson-head"},
      el("button", {class: "btn ghost small", onclick: () => { if (confirm("לצאת מהאימון?")) exit(); }}, "✕"),
      el("div", {class: "progress"}, el("div", {class: "progress-fill", style: `width:${Math.round(100 * idx / items.length)}%`})),
      el("div", {class: "lesson-count"}, `${idx + 1}/${items.length}`));
    const box = el("div", {class: "exercise card"});
    box.append(el("div", {class: "ex-title"}, it.title || ""));
    container.append(head, box);
    it.render(box, (ok) => {
      if (!it.noScore){ ok ? correct++ : wrong++; }
      if (!it.noScore) addXP(ok ? 10 : 2);
      if (it.introFor) logDay({words: 1});
      idx++;
      renderCurrent();
    });
  }

  function renderSummary(){
    const mins = Math.max(1, Math.round((Date.now() - startTime) / 60000));
    logDay({minutes: mins, lessons: 1});
    S.lessonDate = todayStr();
    save();
    addXP(25, "השלמת אימון");
    checkAchievements();
    confetti();
    const total = correct + wrong;
    const pct = total ? Math.round(100 * correct / total) : 100;
    container.replaceChildren(
      el("div", {class: "summary card center"},
        el("div", {class: "summary-emoji"}, pct >= 80 ? "🏆" : pct >= 50 ? "💪" : "🌱"),
        el("h2", {}, "כל הכבוד!"),
        el("div", {class: "summary-stats"},
          statBox(`${total}`, "תרגילים"),
          statBox(`${pct}%`, "דיוק"),
          statBox(`${mins}`, "דקות"),
          statBox(`🔥 ${S.game.streak}`, "רצף")),
        pct < 60 ? el("p", {class: "muted"}, "המילים שהתקשית בהן יחזרו בקרוב — ככה לומדים.") : null,
        el("button", {class: "btn primary big", onclick: exit}, "סיום")));
  }

  function exit(){
    stopSpeaking();
    if (onExit) onExit(); else location.hash = "#/home";
  }

  renderCurrent();
}

function statBox(v, label){
  return el("div", {class: "stat"}, el("div", {class: "stat-v"}, v), el("div", {class: "stat-l"}, label));
}
