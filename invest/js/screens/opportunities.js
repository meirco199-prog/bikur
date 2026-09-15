// TOP OPPORTUNITIES NOW — קטגוריות + AVOID.
import { api } from '../core/api.js';
import { esc, fmt } from '../core/util.js';
import { sigBadge, scoreBar, pctCell, loading, errorBox, symLink, disclaimer } from '../ui/components.js';

const CATS = [['bestOverall', '🏆 Best Overall', 'ציון כולל גבוה ביותר (לא NO SIGNAL)'], ['bestValue', '💰 Best Value', 'רכיב הערכת שווי ≥ 60 + Margin of Safety'], ['bestGrowth', '🚀 Best Growth', 'רכיב צמיחה ≥ 60'], ['bestMomentum', '⚡ Best Momentum', 'רכיב מומנטום ≥ 65'], ['bestEtf', '🧺 Best ETF', 'ETF בציון הגבוה ביותר'], ['lowestRisk', '🛡️ Lowest Risk', 'רכיב סיכון גבוה (=בטוח) עם ציון ≥ 55'], ['breakout', '📈 Potential Breakout', 'פריצה במחזור גבוה או Golden Cross טרי'], ['oversold', '🔄 Oversold Opportunities', 'RSI < 30 עם פונדמנטלי ≥ 55'], ['avoid', '⛔ AVOID / HIGH RISK', 'SELL, סיכון < 25 או ציון < 35']];

export async function render(main){
  main.innerHTML = loading();
  let rank;
  try { rank = await api('/rank', { ttl: 60000 }); } catch (e) { main.innerHTML = errorBox(e); return; }
  if (rank.missing){ main.innerHTML = `<div class="empty">${esc(rank.reason)} — <a href="#/settings">הרץ עיבוד</a></div>`; return; }
  const by = new Map(rank.table.map((r) => [r.symbol, r]));
  const block = ([k, title, desc]) => { const items = (rank.categories[k] || []).map((s) => by.get(s)).filter(Boolean); return `<section class="card ${k === 'avoid' ? 'span2' : ''}"><h3>${title} <span class="muted">${esc(desc)}</span></h3>${items.length ? `<table><thead><tr><th>נכס</th><th class="num">מחיר</th><th>ציון</th><th>סיגנל</th><th class="num">12M</th><th class="num">MoS</th><th class="num">Upside אנליסטים</th><th class="num">סיכון</th></tr></thead><tbody>${items.map((s) => `<tr class="clickable" onclick="location.hash='#/asset/${esc(s.symbol)}'"><td>${symLink(s.symbol, s.name)}</td><td class="num">${fmt.num(s.price)}</td><td>${scoreBar(s.score)}</td><td>${sigBadge(s.signal)}</td><td>${pctCell(s.momentum12m, 0)}</td><td>${pctCell(s.mos, 0)}</td><td>${pctCell(s.analystUpside, 0)}</td><td class="num">${s.components?.risk ?? '—'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">אין מועמדים בקטגוריה</div>'}</section>`; };
  main.innerHTML = `<div class="page-head"><div><h1>TOP OPPORTUNITIES NOW</h1><span class="muted">${esc(rank.date)} · ${rank.analyzed} נכסים · רוחב שוק ${fmt.pct(rank.breadth, 0)} מעל SMA200</span></div></div>
  <div class="grid g2">${CATS.map(block).join('')}</div>${disclaimer('הקטגוריות נגזרות מכללים גלויים על ציוני הרכיבים (ראו SIGNAL_MODEL.md). דירוג יחסי בתוך ה-universe — לא תחזית.')}`;
}
