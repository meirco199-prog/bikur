// TOP OPPORTUNITIES NOW — קטגוריות + AVOID.
import { api } from '../core/api.js';
import { esc, fmt } from '../core/util.js';
import { sigBadge, scoreBar, pctCell, loading, errorBox, symLink, disclaimer } from '../ui/components.js';

const CATS = [['bestOverall', '🏆 הטובות ביותר', 'הציון הכולל הגבוה ביותר'], ['bestValue', '💰 זולות ביחס לשווי', 'הערכת שווי טובה ומרווח ביטחון'], ['bestGrowth', '🚀 צומחות', 'צמיחה גבוהה בהכנסות וברווח'], ['bestMomentum', '⚡ בתנופה', 'מומנטום חזק'], ['bestEtf', '🧺 קרנות סל מומלצות', 'ETF בציון הגבוה ביותר'], ['lowestRisk', '🛡️ הכי בטוחות', 'תנודתיות נמוכה וציון סביר'], ['breakout', '📈 פריצה אפשרית', 'פריצה במחזור גבוה או חיתוך ממוצעים חיובי'], ['oversold', '🔄 נמכרו יותר מדי', 'ירדו חזק אבל החברה טובה'], ['avoid', '⛔ להתרחק', 'סיגנל מכירה, סיכון גבוה או ציון נמוך']];

export async function render(main){
  main.innerHTML = loading();
  let rank;
  try { rank = await api('/rank', { ttl: 60000 }); } catch (e) { main.innerHTML = errorBox(e); return; }
  if (rank.missing){ main.innerHTML = `<div class="empty">${esc(rank.reason)} — <a href="#/settings">הרץ עיבוד</a></div>`; return; }
  const by = new Map(rank.table.map((r) => [r.symbol, r]));
  const block = ([k, title, desc]) => { const items = (rank.categories[k] || []).map((s) => by.get(s)).filter(Boolean); return `<section class="card ${k === 'avoid' ? 'span2' : ''}"><h3>${title} <span class="muted">${esc(desc)}</span></h3>${items.length ? `<table><thead><tr><th>נכס</th><th class="num">מחיר</th><th>ציון</th><th>סיגנל</th><th class="num">12M</th><th class="num">MoS</th><th class="num">Upside אנליסטים</th><th class="num">סיכון</th></tr></thead><tbody>${items.map((s) => `<tr class="clickable" onclick="location.hash='#/asset/${esc(s.symbol)}'"><td>${symLink(s.symbol, s.name, s.nameHe)}</td><td class="num">${fmt.num(s.price)}</td><td>${scoreBar(s.score)}</td><td>${sigBadge(s.signal)}</td><td>${pctCell(s.momentum12m, 0)}</td><td>${pctCell(s.mos, 0)}</td><td>${pctCell(s.analystUpside, 0)}</td><td class="num">${s.components?.risk ?? '—'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">אין מועמדים בקטגוריה</div>'}</section>`; };
  main.innerHTML = `<div class="page-head"><div><h1>הזדמנויות עכשיו</h1><span class="muted">${esc(rank.date)} · ${rank.analyzed} נכסים · רוחב שוק ${fmt.pct(rank.breadth, 0)} מעל SMA200</span></div></div>
  <div class="grid g2">${CATS.map(block).join('')}</div>${disclaimer('הקטגוריות נגזרות מכללים גלויים על ציוני הרכיבים (ראו SIGNAL_MODEL.md). דירוג יחסי בתוך ה-universe — לא תחזית.')}`;
}
