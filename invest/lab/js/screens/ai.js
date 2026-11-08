// מחקר AI (דרישה 12): טקסט חופשי → spec. דרך ה-Worker (/lab/parse: Anthropic / Workers AI / מפענח חוקים) או מקומית (מפענח חוקים בדפדפן).
// לפני ההרצה מוצג בדיוק מה ייבדק; ה-AI לא מחשב ולא ממציא נתונים — המנוע הדטרמיניסטי מריץ.
import { esc, toast } from '../../../js/core/util.js';
import { parseFreeText } from '../../../../invest-api/engine/lab/nlp.js';
import { labSettings } from '../store.js';
import { state, go } from '../app.js';
import { setDraft } from './builder.js';
import { explainBlock, err } from '../ui.js';

const EXAMPLES = ['קח את 15 המניות שירדו הכי הרבה בשלושת הימים האחרונים, בתנאי שהמחזור שלהן גבוה מהממוצע, קנה בפתיחה, מכור לאחר יומיים והשקע 100,000 דולר.', 'עשר המניות שירדו הכי הרבה אתמול ב-S&P 500, קנייה בפתיחה, מכירה בסוף אותו יום, 50,000 דולר, 20 השנים האחרונות', 'מניות שירדו יותר מ-8% בשלושה ימים ו-RSI נמוך מ-30 ומחזור גבוה פי 2 מהממוצע, קנה בפתיחה, מכור אחרי 3 ימים או ברווח של 5% או בהפסד של 4%', 'שורט על 5 המניות שעלו הכי הרבה בשבוע האחרון, כיסוי למחרת, סטופ 5%, 20,000 דולר', 'Buy the 10 biggest gainers of the last 5 days above the 200 day average at the open, sell after 10 days, trailing stop 6%, $100,000'];
export async function render(main){
  main.innerHTML = `<div class="page-head"><div><h1>מחקר AI — תאר אסטרטגיה במילים</h1><span class="muted">ה-AI מתרגם את הבקשה להגדרה מובנית בלבד. לפני ההרצה תראה בדיוק: אילו נכסים, אילו תנאים, מתי האות, מתי הביצוע, תנאי המכירה וגודל הפוזיציה. את החישוב מבצע המנוע הדטרמיניסטי.</span></div></div>
  <div class="grid g-2-1"><section class="card"><textarea class="big" id="txt" placeholder="למשל: ${esc(EXAMPLES[0])}"></textarea><div class="row" style="margin-top:.5rem"><button class="btn primary" id="parse">פענח עם AI (דרך ה-Worker)</button><button class="btn" id="local">פענח מקומית (בלי AI)</button><span class="muted">ה-Worker: ${esc(labSettings.get().apiUrl)}</span></div><div class="row" style="margin-top:.5rem">${EXAMPLES.map((e, i) => `<button class="btn sm ghost" data-ex="${i}">דוגמה ${i + 1}</button>`).join('')}</div></section>
  <section class="card"><h3>איך זה עובד</h3><ul class="warnlist"><li>הטקסט נשלח ל-Worker (<code>POST /lab/parse</code>). אם מוגדר מפתח Anthropic — Claude מנסח JSON לפי הסכימה; אחרת Workers AI; אם אין — מפענח חוקים מקומי. השרת לא רואה מפתחות בצד הלקוח.</li><li>הפלט עובר אימות סכימה (normalizeSpec). ערך לא תקין = שגיאה, לא ניחוש.</li><li>מה שלא נאמר מקבל ברירת מחדל ומסומן בהערות. אין קנייה במחיר הסגירה של יום האות אלא אם ביקשת במפורש.</li><li>אם הבקשה דורשת נתון שאינו קיים (דוחות, אנליסטים, Nasdaq היסטורי) — זה ייכתב, והבדיקה תיחסם או תסומן כמוגבלת.</li></ul></section></div>
  <div id="out" style="margin-top:1rem"></div>`;
  const txt = main.querySelector('#txt'), out = main.querySelector('#out');
  main.querySelectorAll('[data-ex]').forEach((b) => { b.onclick = () => { txt.value = EXAMPLES[+b.dataset.ex]; }; });
  const show = (r) => {
    out.innerHTML = `<section class="card"><h3>ההגדרה שהתקבלה <span class="tag ${r.parser === 'llm' ? 'model' : ''}">${r.parser === 'llm' ? `AI: ${esc(r.model || r.provider)}` : 'מפענח חוקים'}</span></h3>${r.fallbackReason ? `<div class="limited">${esc(r.fallbackReason)}</div>` : ''}${r.notes?.length ? `<ul class="warnlist">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}${explainBlock(r.spec)}<div class="row" style="margin-top:.6rem"><button class="btn primary" id="run">▶ הרץ Backtest</button><button class="btn" id="edit">✎ פתח בבונה לעריכה</button><button class="btn" id="opt">🎛️ אופטימיזציה</button></div></section>`;
    out.querySelector('#run').onclick = () => { state.pendingSpec = { spec: r.spec, params: {}, name: r.spec.name }; go('backtest', { draft: '1', autorun: '1' }); };
    out.querySelector('#edit').onclick = () => { setDraft(r.spec, { name: r.spec.name }); go('builder'); };
    out.querySelector('#opt').onclick = () => { state.lastRun = { spec: r.spec, params: {} }; go('optimize'); };
  };
  main.querySelector('#local').onclick = () => { try { show(parseFreeText(txt.value)); } catch (e) { out.innerHTML = err(e); } };
  main.querySelector('#parse').onclick = async () => {
    out.innerHTML = '<div class="empty"><span class="spin"></span> מפענח…</div>';
    try { const r = await fetch(labSettings.get().apiUrl.replace(/\/$/, '') + '/lab/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: txt.value }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); show(j); }
    catch (e) { out.innerHTML = err(e) + '<div class="muted" style="margin-top:.4rem">אפשר לנסות "פענח מקומית".</div>'; }
  };
}
