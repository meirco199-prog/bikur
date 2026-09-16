// רכיבי ממשק לשימוש חוזר: תגי סיגנל/ציון/סוג-נתון, חותמות עדכון, כרטיסי KPI, WHY.
import { el, esc, fmt, isNum, sigClass, SIGNAL_HE, COMP_HE, KIND_HE, cls } from '../core/util.js';

export const sigBadge = (label) => `<span class="${sigClass(label)}" title="${esc(label || '')}" style="direction:rtl">${esc(SIGNAL_HE[label] || label || 'אין סיגנל')}</span>`;
export const scoreBar = (v) => (isNum(v) ? `<span class="score"><span class="bar"><i style="width:${v}%"></i></span><span class="num">${v}</span></span>` : '<span class="tag missing">אין ציון</span>');
export const kind = (k) => { const cls = { FACT: 'fact', MODEL: 'model', 'MODEL SIGNAL': 'model', 'ANALYST OPINION': 'opinion', ESTIMATE: 'estimate' }[k] || ''; return `<span class="tag ${cls}" title="${esc(k)}">${esc(KIND_HE[k] || k)}</span>`; };
export const missing = (reason = 'Missing Data') => `<span class="tag missing" title="${esc(reason)}">חסר</span>`;
export function asOf(d, { source, stale, quality } = {}){
  if (!d && !source) return '<span class="asof">—</span>';
  return `<span class="asof ${stale ? 'stale' : ''}" title="${stale ? 'נתון ישן — הרענון נכשל' : ''}${isNum(quality) ? ' · איכות ' + quality : ''}">${stale ? '⚠ ' : ''}${source ? esc(source) + ' · ' : ''}${esc(fmt.date(d))}</span>`;
}
export const kpi = (label, value, extra = '') => `<div class="kpi"><span class="v ${extra}">${value}</span><span class="l">${esc(label)}</span></div>`;
export const pctCell = (x, d = 1) => `<span class="num ${cls(x)}">${fmt.pct(x, d, true)}</span>`;
export const confBadge = (c, label) => `<span class="tag ${c >= 0.75 ? 'fact' : c >= 0.5 ? '' : 'stale'}" title="ביטחון = כיסוי נתונים × איכות">ביטחון ${esc(label || '')} (${isNum(c) ? c.toFixed(2) : '—'})</span>`;

// "למה?" — 5 בעד / 5 סיכונים / מה ישנה / מה סותר
export function whyBlock(sig){
  if (!sig) return '';
  const li = (arr, c = '') => (arr?.length ? `<ul class="list ${c}">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<div class="muted">—</div>');
  return `<div class="grid g2">
    <div><h4>✅ 5 סיבות בעד</h4>${li(sig.top5, 'why-pos')}</div>
    <div><h4>⚠️ 5 סיכונים מרכזיים</h4>${li(sig.risks?.slice(0, 5), 'why-neg')}</div>
    <div><h4>🔁 מה צריך לקרות כדי שההמלצה תשתנה</h4>${li(sig.changeIf)}</div>
    <div><h4>🧐 נתונים שעשויים לסתור את התזה</h4>${li(sig.contradict)}</div>
  </div><div class="muted" style="margin-top:.5rem">תנאי הסיגנל שהתקיימו: ${esc((sig.why || []).join(' · '))}</div>`;
}

// טבלת רכיבי הציון עם הסברים
export function componentsTable(score){
  if (!score?.components) return '';
  return `<table><thead><tr><th>רכיב</th><th class="num">ציון</th><th class="num">משקל</th><th>למה</th></tr></thead><tbody>${Object.entries(score.components).map(([k, c]) => `<tr><td>${esc(COMP_HE[k] || k)} ${c.kind === 'ANALYST OPINION' ? kind('ANALYST OPINION') : ''}</td><td class="num">${c.missing ? missing(c.reason) : scoreBar(c.value)}</td><td class="num">${c.weight}${c.missing ? ' <span class="muted">(לא נספר)</span>' : ''}</td><td style="white-space:normal;font-size:.82rem">${c.missing ? '<span class="muted">' + esc(c.reason) + '</span>' : (c.reasons || []).map((r) => esc(r)).join('<br>')}</td></tr>`).join('')}</tbody></table>
  <div class="muted">כיסוי נתונים ${fmt.pct(score.coverage, 0)} · איכות נתונים ${isNum(score.dataQuality) ? score.dataQuality.toFixed(2) : '—'} · ביטחון ${score.confidence} (${esc(score.confidenceLabel || '')}) · גרסת משקלים ${esc(score.weightsVersion)}</div>`;
}

export const disclaimer = (t = 'סיגנלים וציונים הם תוצרי מודל (MODEL SIGNAL), לא ייעוץ השקעות ולא תחזית. Backtest אינו תחזית.') => `<div class="disclaimer">${esc(t)}</div>`;
export const loading = (t = 'טוען…') => `<div class="empty"><span class="spin"></span> ${esc(t)}</div>`;
export const errorBox = (e) => `<div class="empty" style="border-color:var(--neg)">שגיאה: ${esc(e?.message || e)}</div>`;
export const symLink = (s, name, nameHe) => `<a href="#/asset/${esc(s)}"><b>${esc(nameHe || s)}</b></a> <span class="muted">${esc(nameHe ? s : name || '')}</span>`;
