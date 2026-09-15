// עוזר מחקר AI — RAG על נתוני המערכת; כל תשובה מציינת מקור ותאריך; אין המצאת נתונים.
import { api } from '../core/api.js';
import { esc, el, toast } from '../core/util.js';
import { disclaimer } from '../ui/components.js';

const SUGGEST = ['מה הכי מעניין היום?', 'מה השתנה מאז אתמול?', 'מה הסיכון בתיק שלי?', 'למה NVDA קיבלה את הסיגנל שלה?', 'איזה נכס נראה זול יחסית להיסטוריה?', 'האם עדיף QQQ או NVDA?', 'מה קרה ל-AAPL היום?'];
export async function render(main){
  main.innerHTML = `<div class="page-head"><div><h1>🤖 עוזר מחקר</h1><span class="muted">עונה רק מנתוני המערכת (snapshots, חדשות, משטר, תיק). כל עובדה עם מקור ותאריך. אינו מחשב ציונים ואינו נותן ייעוץ.</span></div></div>
  <div class="row" style="margin-bottom:.6rem">${SUGGEST.map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
  <section class="card"><div class="chat" id="chat"><div class="msg ai">שלום! שאל אותי על נכס (בסימבול, למשל NVDA), על ההזדמנויות של היום, על מצב השוק או על התיק. אענה רק ממה שהמערכת יודעת ואציין מקור ותאריך.</div></div>
  <div class="row" style="margin-top:.6rem"><input id="q" placeholder="שאלה…" style="flex:1"><button class="btn primary" id="send">שלח</button></div></section>${disclaimer('התשובות מנוסחות על ידי מודל שפה מתוך נתוני המערכת בלבד; הציונים והסיגנלים מחושבים בקוד ולא על ידי המודל.')}`;
  const chat = main.querySelector('#chat'), q = main.querySelector('#q');
  const ask = async (text) => {
    if (!text.trim()) return;
    chat.appendChild(el(`<div class="msg user">${esc(text)}</div>`)); q.value = '';
    const w = el('<div class="msg ai"><span class="spin"></span> חושב…</div>'); chat.appendChild(w); chat.scrollTop = chat.scrollHeight;
    try { const r = await api('/ai/ask', { method: 'POST', body: { question: text }, timeout: 90000 }); w.innerHTML = esc(r.answer) + (r.provider === 'none' ? `<pre style="white-space:pre-wrap;font-size:.7rem">${esc(JSON.stringify(r.context, null, 1).slice(0, 3000))}</pre>` : '') + `<div class="muted" style="font-size:.7rem;margin-top:.3rem">${esc(r.model || '')} · נתונים נכון ל-${esc(r.context?.date || '')} · נכסים בהקשר: ${esc((r.context?.assets || []).join?.(', ') || Object.keys(r.context?.assets || {}).join(', '))}</div>`; }
    catch (e) { w.innerHTML = `<span class="neg">שגיאה: ${esc(e.message)}</span>`; }
    chat.scrollTop = chat.scrollHeight;
  };
  main.querySelector('#send').onclick = () => ask(q.value); q.addEventListener('keydown', (e) => e.key === 'Enter' && ask(q.value));
  main.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => ask(b.dataset.q));
}
