// עוזר מחקר AI: RAG על נתוני המערכת בלבד. ה-LLM לא מחשב ציונים ולא ממציא נתונים — הוא מנסח ומצטט.
// ספק: Anthropic Messages API (claude-opus-5) אם יש ANTHROPIC_API_KEY, אחרת Workers AI (Llama).
// הערה: אין כאן SDK כי הריפו אוסר תלויות npm וה-Worker רץ כקובץ בודד → קריאת HTTP ישירה ל-/v1/messages.
import { getSnap } from './snapstore.js';
import { today, latestRankDay } from './analysis.js';

const SYSTEM = `אתה עוזר מחקר בפלטפורמת השקעות אישית. ענה בעברית, קצר וענייני.
כללים מחייבים:
1. השתמש אך ורק בנתונים שבבלוק CONTEXT. אם נתון לא מופיע שם — כתוב "אין לי נתון על זה במערכת". לעולם אל תמציא מספר, מחיר, תאריך או ידיעה.
2. ליד כל עובדה ציין מקור ותאריך בסוגריים, למשל (Stooq, 2026-09-12) או (Reuters, 2026-09-10, קישור).
3. הבחן בין FACT (מחיר/דוח), MODEL SIGNAL (ציון/סיגנל של המערכת), ANALYST OPINION, ESTIMATE.
4. אל תיתן ייעוץ השקעות אישי; הסבר מה המערכת מצאה ולמה, כולל הסיכונים והנתונים הסותרים.
5. אם השאלה על "מה השתנה" — השווה בין snapshot היום לאתמול שב-CONTEXT.`;

export async function buildContext(db, question){
  const day = await latestRankDay(db);
  const rank = day ? await db.get(`rank:${day}`) : null;
  const regime = day ? await db.get(`regime:${day}`) : await db.get(`regime:${today()}`);
  const watch = (await db.get('user:watchlist')) || [];
  const mentioned = [...new Set((question.match(/\b[A-Z]{1,6}(?:\.[A-Z]{1,2})?\b/g) || []).filter((s) => !['ETF', 'RSI', 'BUY', 'SELL', 'AI', 'USD', 'ILS', 'VIX'].includes(s)))];
  const syms = [...new Set([...mentioned, ...watch.map((w) => w.symbol)])].slice(0, 8);
  const ctx = { date: day || today(), regime: regime ? { summary: regime.summary, risk: regime.risk, trend: regime.trend, fearGreed: regime.fearGreed?.value, inputs: regime.inputs && { vix: regime.inputs.vix, dgs10: regime.inputs.dgs10, curve: regime.inputs.curve, hy: regime.inputs.hy, usdils: regime.inputs.usdils }, rulesPassed: (regime.rules || []).filter((r) => r.passed).map((r) => r.desc), rulesFailed: (regime.rules || []).filter((r) => r.passed === false).map((r) => r.desc) } : 'אין סיווג משטר', topOpportunities: rank ? Object.fromEntries(Object.entries(rank.categories).map(([k, v]) => [k, v.slice(0, 6)])) : 'אין דירוג', assets: {} };
  const days = (await db.get('idx:snapdays')) || [];
  const prevDay = days[days.length - 2];
  for (const s of syms){
    const snap = day ? await getSnap(db, day, s) : null;
    const prev = prevDay ? await getSnap(db, prevDay, s) : null;
    const news = await db.get(`news:${s}`);
    if (!snap) { ctx.assets[s] = 'אין snapshot במערכת לנכס זה'; continue; }
    ctx.assets[s] = {
      name: snap.name, price: snap.price, priceAsOf: snap.dataAsOf?.prices, score: snap.score, signal: snap.signal, confidence: snap.confidenceLabel, components: snap.components, why: snap.signalDetail?.why, top5: snap.signalDetail?.top5, risks: snap.signalDetail?.risks, contradict: snap.signalDetail?.contradict, levels: snap.signalDetail?.levels, pe: snap.pe, fairValue: snap.fairLow !== null ? [snap.fairLow, snap.fairHigh] : null, marginOfSafety: snap.mos, analystUpside: snap.analystUpside, analystN: snap.analystN, trend: snap.trend, rsi: snap.rsi, vol1y: snap.vol1y, maxDD1y: snap.maxDD1y, nextEarnings: snap.nextEarnings, missing: snap.missingComponents,
      yesterday: prev ? { date: prev.date, price: prev.price, score: prev.score, signal: prev.signal } : null,
      news: (news?.clusters || []).slice(0, 5).map((n) => ({ title: n.title, publisher: n.publisher, date: (n.publishedAt || '').slice(0, 10), url: n.url, sentiment: n.sentiment?.label, events: n.events })),
    };
  }
  const paper = await db.get('paper:trades');
  if (/תיק|פוזיצי|portfolio/i.test(question) && paper?.length) ctx.paperTrades = paper.filter((t) => !t.exitDate).map((t) => ({ symbol: t.symbol, qty: t.qty, price: t.price, date: t.date.slice(0, 10) }));
  const reco = day ? await db.get(`reco:${day}`) : null;
  if (/תיק|portfolio|הקצא/i.test(question) && reco) ctx.recommendedPortfolios = Object.fromEntries(Object.entries(reco.profiles || {}).map(([k, v]) => [k, { positions: v.positions.map((p) => `${p.symbol} ${Math.round(p.weight * 100)}%`), vol: v.risk?.volatility, maxDD: v.risk?.maxDrawdown }]));
  return ctx;
}

export async function ask(env, db, question){
  const context = await buildContext(db, question);
  const user = `CONTEXT (JSON, נתוני המערכת נכון ל-${context.date}):\n${JSON.stringify(context)}\n\nשאלה: ${question}`;
  if (env.ANTHROPIC_API_KEY){
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.ANTHROPIC_MODEL || 'claude-opus-5', max_tokens: 2000, system: SYSTEM, messages: [{ role: 'user', content: user }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error('anthropic: ' + (j.error?.message || r.status));
    if (j.stop_reason === 'refusal') return { answer: 'המודל סירב לענות על השאלה הזו.', model: j.model, context };
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return { answer: text, model: j.model, provider: 'anthropic', context: { date: context.date, assets: Object.keys(context.assets) } };
  }
  if (env.AI){
    const models = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'];
    let last;
    for (const m of models){
      try { const r = await env.AI.run(m, { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], max_tokens: 900 }); return { answer: r.response || r.result?.response || JSON.stringify(r), model: m, provider: 'workers-ai', context: { date: context.date, assets: Object.keys(context.assets) } }; }
      catch (e) { last = e; }
    }
    throw last || new Error('workers ai failed');
  }
  return { answer: 'שכבת ה-AI לא מוגדרת (אין ANTHROPIC_API_KEY ואין binding ל-Workers AI). הנה הנתונים הגולמיים שהיו נשלחים למודל:', model: null, provider: 'none', context };
}
