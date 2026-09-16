// "עוד": חיפוש, מעקב, הסברים, הגדרות, ומסכים מקצועיים.
import { esc } from '../core/util.js';
const ITEMS = [['search', '🔍', 'חיפוש חברה', 'מצא מניה או קרן וראה מה המערכת חושבת עליה'], ['watchlist', '⭐', 'רשימת מעקב', 'הנכסים שאתה עוקב אחריהם'], ['explain', '📖', 'איך זה עובד', 'מתי קונים, מתי מוכרים, איך נבנה התיק'], ['assistant', '🤖', 'שאל את המערכת', 'שאלות חופשיות על מניות ועל התיק'], ['alerts', '🔔', 'התראות', 'קבל הודעה כשמשהו חשוב קורה'], ['settings', '⚙️', 'הגדרות', 'חיבור, מפתחות, גודל תיק']];
const PRO = [['dashboard', 'תמונת מצב מלאה'], ['opportunities', 'הזדמנויות לפי קטגוריות'], ['signals', 'כל הסיגנלים'], ['portfolio', 'בניית תיק מפורטת'], ['regime', 'מצב השוק בפירוט'], ['backtest', 'בדיקה היסטורית של אסטרטגיות'], ['asof', 'מסע בזמן'], ['paper', 'תיק וירטואלי מפורט']];
export async function render(main){
  main.innerHTML = `<div style="max-width:720px;margin:0 auto"><h1>עוד</h1>${ITEMS.map(([r, i, t, d]) => `<a class="card" href="#/${r}" style="display:flex;gap:.8rem;align-items:center;margin-bottom:.5rem;text-decoration:none;color:inherit"><span style="font-size:1.6rem">${i}</span><span><b>${esc(t)}</b><br><span class="muted">${esc(d)}</span></span></a>`).join('')}
  <details style="margin-top:1rem"><summary class="muted">מסכים מקצועיים (מספרים, גרפים, אסטרטגיות)</summary><div class="stack" style="margin-top:.5rem">${PRO.map(([r, t]) => `<a class="btn" href="#/${r}">${esc(t)}</a>`).join('')}</div></details></div>`;
}
