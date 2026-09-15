// Alert Engine: כללים גלויים, הערכה מול snapshot של היום ואתמול, cooldown נגד spam, שליחה ל-Telegram/Email/דפדפן.
// כל התראה: WHAT HAPPENED / WHY IT MATTERS / WHAT SIGNAL CHANGED.
import { isNum, round, uid, daysBetween } from '../engine/util.js';

export const ALERT_TYPES = {
  entry_zone: { label: 'המחיר נכנס לאזור הכניסה', params: {} },
  breakout: { label: 'פריצה במחזור גבוה', params: {} },
  support_broken: { label: 'תמיכה נשברה', params: {} },
  stop_triggered: { label: 'Stop הופעל (מחיר מתחת ל-stop)', params: {} },
  target_reached: { label: 'יעד הושג', params: {} },
  rsi: { label: 'תנאי RSI', params: { op: '<', value: 30 } },
  ma_cross: { label: 'חיתוך ממוצעים (Golden/Death)', params: {} },
  unusual_volume: { label: 'מחזור חריג', params: { relVol: 2 } },
  earnings_approaching: { label: 'דוח רבעוני מתקרב', params: { days: 5 } },
  analyst_change: { label: 'שינוי בקונצנזוס אנליסטים', params: {} },
  material_news: { label: 'חדשות מהותיות', params: {} },
  score_change: { label: 'שינוי מהותי בציון', params: { delta: 10 } },
  signal_change: { label: 'שינוי סיגנל', params: {} },
};

export function evaluateRule(rule, snap, prev, analysis){
  if (!snap || snap.missing) return null;
  const p = { ...(ALERT_TYPES[rule.type]?.params || {}), ...(rule.params || {}) };
  const t = analysis?.technical, lv = snap.signalDetail?.levels, price = snap.price;
  const mk = (what, why, changed) => ({ what, why, changed: changed || (prev ? `סיגנל: ${prev.signal} → ${snap.signal}, ציון ${prev.score} → ${snap.score}` : `סיגנל: ${snap.signal}, ציון ${snap.score}`) });
  switch (rule.type){
    case 'entry_zone': return lv?.inEntryZone && !(prev?.signalDetail?.levels?.inEntryZone) ? mk(`${snap.symbol} במחיר ${price} נכנס לאזור הכניסה ${lv.entryZone[0]}–${lv.entryZone[1]}`, 'אזור הכניסה נגזר מתמיכה/SMA50; כניסה שם משפרת את יחס הסיכון/סיכוי לעומת רדיפה אחרי המחיר') : null;
    case 'breakout': return snap.events?.includes('breakout') && !prev?.events?.includes('breakout') ? mk(`${snap.symbol} פרץ מעל התנגדות 20 ימים במחזור גבוה`, 'פריצה במחזור גבוה מעידה על ביקוש; לבדוק אישור בסגירה של יומיים') : null;
    case 'support_broken': return snap.events?.includes('breakdown') && !prev?.events?.includes('breakdown') ? mk(`${snap.symbol} שבר תמיכה 20 ימים במחזור גבוה`, 'שבירת תמיכה במחזור = היצע; מבנה המגמה נחלש') : null;
    case 'stop_triggered': return lv && isNum(lv.stop) && price < lv.stop && !(prev?.price < prev?.signalDetail?.levels?.stop) ? mk(`${snap.symbol} ${price} מתחת ל-stop ${lv.stop}`, 'הסיכון שהוגדר מראש התממש; כלל היציאה נועד להגביל הפסד') : null;
    case 'target_reached': return lv && price >= lv.targets?.[0] && !(prev?.price >= prev?.signalDetail?.levels?.targets?.[0]) ? mk(`${snap.symbol} הגיע ליעד ${lv.targets[0]}–${lv.targets[1]}`, 'הגעה ליעד = נקודת בדיקה: לממש חלק / להעלות stop') : null;
    case 'rsi': { const ok = p.op === '>' ? snap.rsi > p.value : snap.rsi < p.value; const was = prev && (p.op === '>' ? prev.rsi > p.value : prev.rsi < p.value); return ok && !was ? mk(`RSI של ${snap.symbol} = ${snap.rsi} (${p.op} ${p.value})`, p.op === '<' ? 'RSI נמוך = מכירת יתר; לא אות קנייה לבד — לבדוק פונדמנטלס ומגמה' : 'RSI גבוה = קניית יתר; סיכון לתיקון') : null; }
    case 'ma_cross': { const g = snap.events?.includes('golden_cross') && !prev?.events?.includes('golden_cross'); const d = snap.events?.includes('death_cross') && !prev?.events?.includes('death_cross'); return g ? mk(`Golden Cross ב-${snap.symbol}`, 'SMA50 חצה מעל SMA200 — מבנה מגמה חיובי (אינדיקטור איטי, מאשר ולא מנבא)') : d ? mk(`Death Cross ב-${snap.symbol}`, 'SMA50 חצה מתחת SMA200 — מבנה מגמה שלילי') : null; }
    case 'unusual_volume': return t && isNum(t.relVol) && t.relVol >= p.relVol ? mk(`מחזור חריג ב-${snap.symbol}: x${round(t.relVol, 1)} מהממוצע`, 'מחזור חריג מלווה לרוב אירוע (דוח/חדשות/מוסדיים)') : null;
    case 'earnings_approaching': { const d = snap.nextEarnings ? daysBetween(snap.date, snap.nextEarnings) : null; return isNum(d) && d >= 0 && d <= p.days && !(prev?.nextEarnings === snap.nextEarnings && prev) ? mk(`דוח של ${snap.symbol} בעוד ${d} ימים (${snap.nextEarnings})`, 'סיכון gap סביב דוח; לשקול הקטנת פוזיציה או המתנה') : null; }
    case 'analyst_change': { const a = analysis?.analyst; return a && !a.missing && isNum(a.trendDelta) && a.trendDelta !== 0 && prev ? mk(`שינוי קונצנזוס ב-${snap.symbol}: ${a.trendDelta > 0 ? '+' : ''}${a.trendDelta} דירוגי Buy`, 'דעת אנליסטים היא אות אחד — לא אמת; שינוי כיוון חשוב יותר מהרמה') : null; }
    case 'material_news': { const n = analysis?.sentiment?.clusters?.find((c) => c.material && daysBetween(c.publishedAt.slice(0, 10), snap.date) <= 1); return n && prev?.lastNews?.title !== n.title ? mk(`חדשות מהותיות ב-${snap.symbol}: ${n.title} (${n.publisher}, ${n.publishedAt.slice(0, 10)}) ${n.url}`, `אירועים: ${n.events.join(', ')}; סנטימנט ${n.sentiment.label}`) : null; }
    case 'score_change': return prev && isNum(prev.score) && isNum(snap.score) && Math.abs(snap.score - prev.score) >= p.delta ? mk(`ציון ${snap.symbol} השתנה ${prev.score} → ${snap.score}`, 'שינוי מהותי בציון נובע משינוי בנתונים (מחיר/דוח/חדשות) — לבדוק את הרכיב שהשתנה') : null;
    case 'signal_change': return prev && prev.signal !== snap.signal ? mk(`סיגנל ${snap.symbol} השתנה: ${prev.signal} → ${snap.signal}`, (snap.signalDetail?.why || []).slice(0, 2).join('; ')) : null;
    default: return null;
  }
}

export async function evaluateAlerts(ctx, snap, prev, analysis){
  const rules = (await ctx.db.get('user:alerts:rules')) || [];
  const settings = (await ctx.db.get('user:settings')) || {};
  const watch = (await ctx.db.get('user:watchlist')) || [];
  const isWatched = watch.some((w) => w.symbol === snap.symbol);
  const active = rules.filter((r) => r.enabled !== false && (r.symbol === '*' || r.symbol === snap.symbol));
  // כללי ברירת מחדל לרשימת המעקב
  if (isWatched && settings.alertDefaults?.signalChange !== false) active.push({ id: 'default_signal', type: 'signal_change', symbol: '*', channels: settings.alertChannels || ['browser'], cooldownH: 24 });
  if (isWatched && settings.alertDefaults?.materialNews !== false) active.push({ id: 'default_news', type: 'material_news', symbol: '*', channels: settings.alertChannels || ['browser'], cooldownH: 24 });
  const out = [];
  for (const r of active){
    const res = evaluateRule(r, snap, prev, analysis);
    if (!res) continue;
    const dedupKey = `${r.type}:${snap.symbol}:${r.id}`;
    const state = await ctx.db.get(`alerts:state:${dedupKey}`);
    if (state) continue; // cooldown
    const alert = { id: uid('al_'), ts: new Date().toISOString(), ruleId: r.id, symbol: snap.symbol, type: r.type, label: ALERT_TYPES[r.type]?.label, ...res, channels: {}, dedupKey };
    alert.channels = await send(ctx, alert, r.channels || ['browser']);
    await ctx.db.put(`alerts:state:${dedupKey}`, { lastSentAt: alert.ts }, { ttl: (r.cooldownH || 24) * 3600 });
    out.push(alert);
  }
  if (out.length) await ctx.db.appendDay(`alerts:log:${snap.date}`, ...[out[0]]); // append הראשונה; השאר בלולאה
  for (const a of out.slice(1)) await ctx.db.appendDay(`alerts:log:${snap.date}`, a);
  return out;
}

export function formatAlert(a){
  return `🔔 ${a.label || a.type} — ${a.symbol}\n\nמה קרה: ${a.what}\n\nלמה זה חשוב: ${a.why}\n\nמה השתנה: ${a.changed}\n\n(${a.ts.slice(0, 16).replace('T', ' ')} UTC · MODEL SIGNAL, לא ייעוץ)`;
}

export async function send(ctx, alert, channels){
  const res = { browser: 'stored' };
  const text = formatAlert(alert);
  if (channels.includes('telegram')){
    if (ctx.env.TELEGRAM_BOT_TOKEN && ctx.env.TELEGRAM_CHAT_ID){
      try {
        const r = await fetch(`https://api.telegram.org/bot${ctx.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: ctx.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }) });
        res.telegram = r.ok ? 'ok' : `error ${r.status}`;
      } catch (e) { res.telegram = 'error ' + e.message; }
    } else res.telegram = 'לא מוגדר (TELEGRAM_BOT_TOKEN/CHAT_ID)';
  }
  if (channels.includes('email')){
    if (ctx.env.RESEND_KEY && ctx.env.ALERT_EMAIL){
      try {
        const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${ctx.env.RESEND_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: ctx.env.ALERT_FROM || 'invest <onboarding@resend.dev>', to: [ctx.env.ALERT_EMAIL], subject: `[invest] ${alert.label || alert.type}: ${alert.symbol}`, text }) });
        res.email = r.ok ? 'ok' : `error ${r.status}`;
      } catch (e) { res.email = 'error ' + e.message; }
    } else res.email = 'לא מוגדר (RESEND_KEY/ALERT_EMAIL)';
  }
  return res;
}
