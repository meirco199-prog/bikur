// חדשות: איחוד כפילויות, זיהוי אירועים מהותיים, סנטימנט לקסיקלי שקוף, שקלול לפי איכות מקור.
import { isNum, round, daysBetween } from './util.js';

export const PRIMARY_PUBLISHERS = ['sec', 'edgar', 'reuters', 'associated press', 'ap news', 'bloomberg', 'wall street journal', 'wsj', 'financial times', 'ft.com', 'businesswire', 'globenewswire', 'pr newswire', 'prnewswire', 'company press release', 'cnbc', 'dow jones'];
export const AGGREGATORS = ['yahoo', 'msn', 'google news', 'seeking alpha', 'motley fool', 'benzinga', 'investorplace', 'zacks', 'marketbeat', 'tipranks', 'stocktwits'];

export function publisherWeight(publisher = ''){
  const p = String(publisher).toLowerCase();
  if (PRIMARY_PUBLISHERS.some((x) => p.includes(x))) return 1.0;
  if (AGGREGATORS.some((x) => p.includes(x))) return 0.3;
  return 0.5;
}

export function canonicalUrl(u = ''){
  try {
    const url = new URL(u);
    url.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'src', 'yptr', '.tsrc', 'guccounter'].forEach((k) => url.searchParams.delete(k));
    return (url.host.replace(/^www\./, '') + url.pathname.replace(/\/$/, '') + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '')).toLowerCase();
  } catch { return String(u).toLowerCase(); }
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'as', 'at', 'by', 'with', 'from', 'its', 'it', 'this', 'that', 'be', 'will', 'has', 'have', 'stock', 'shares', 'inc', 'corp', 'co', 'says', 'said', 'after', 'amid', 'vs', 'up', 'down']);
export function tokens(title = ''){
  return new Set(String(title).toLowerCase().replace(/[^a-z0-9֐-׿%$ ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}
export function jaccard(a, b){
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// לקסיקון קטן ושקוף. הציון ב-[-1,1]. method:'lexicon'. אם הספק נתן סנטימנט (AV) — הוא גובר, method:'provider'.
const POS = ['beat', 'beats', 'surge', 'surges', 'record', 'raises', 'raised', 'upgrade', 'upgrades', 'upgraded', 'outperform', 'strong', 'growth', 'profit', 'rally', 'gain', 'gains', 'buyback', 'dividend increase', 'exceeds', 'tops', 'jumps', 'soars', 'wins', 'approval', 'approved', 'expands', 'partnership', 'launch', 'launches', 'bullish', 'accelerat'];
const NEG = ['miss', 'misses', 'missed', 'cut', 'cuts', 'downgrade', 'downgrades', 'downgraded', 'underperform', 'weak', 'loss', 'losses', 'plunge', 'plunges', 'falls', 'drop', 'drops', 'lawsuit', 'sued', 'investigation', 'probe', 'recall', 'fraud', 'bankrupt', 'layoffs', 'warns', 'warning', 'guidance cut', 'lowers', 'slump', 'tumbles', 'delay', 'delays', 'fine', 'penalty', 'bearish', 'decline', 'declines', 'sell-off', 'selloff', 'halts'];
export function lexiconSentiment(text = ''){
  const t = String(text).toLowerCase();
  let p = 0, n = 0;
  for (const w of POS) if (t.includes(w)) p++;
  for (const w of NEG) if (t.includes(w)) n++;
  if (!p && !n) return 0;
  return round((p - n) / (p + n + 1), 3);
}

const EVENT_RULES = [
  { id: 'earnings', re: /\b(earnings|quarterly results|q[1-4] results|reports (first|second|third|fourth) quarter|eps of)\b/i, tone: 0 },
  { id: 'earnings_beat', re: /\b(beats?|tops?|exceeds?) (estimates|expectations|forecasts?)|better[- ]than[- ]expected\b/i, tone: 0.6 },
  { id: 'earnings_miss', re: /\b(miss(es|ed)? (estimates|expectations)|falls? short|worse[- ]than[- ]expected)\b/i, tone: -0.6 },
  { id: 'guidance_raise', re: /\b(raises?|lifts?|boosts?) (its )?(full[- ]year |annual |q[1-4] )?(guidance|outlook|forecast)\b/i, tone: 0.7 },
  { id: 'guidance_cut', re: /\b(cuts?|lowers?|trims?|slashes?) (its )?(full[- ]year |annual |q[1-4] )?(guidance|outlook|forecast)\b/i, tone: -0.8 },
  { id: 'upgrade', re: /\b(upgrades?|upgraded|raises? (price )?target|initiates? (with|at) (buy|outperform|overweight))\b/i, tone: 0.5 },
  { id: 'downgrade', re: /\b(downgrades?|downgraded|cuts? (price )?target|lowers? (price )?target)\b/i, tone: -0.5 },
  { id: 'regulatory', re: /\b(fda|sec|ftc|doj|eu commission|antitrust|regulator|regulatory|sanction)\b/i, tone: -0.2 },
  { id: 'lawsuit', re: /\b(lawsuit|sued|class action|litigation|settlement|court rules?)\b/i, tone: -0.4 },
  { id: 'acquisition', re: /\b(acquires?|acquisition|to buy|takeover|merger|buyout|agrees to be acquired)\b/i, tone: 0.2 },
  { id: 'product', re: /\b(launch(es|ed)?|unveils?|introduces?|new product|rollout)\b/i, tone: 0.2 },
  { id: 'geopolitical', re: /\b(tariffs?|sanctions?|war|china|taiwan|middle east|iran|russia|ukraine|export controls?)\b/i, tone: -0.2 },
  { id: 'insider', re: /\b(insider|ceo (sells|buys)|form 4)\b/i, tone: 0 },
  { id: 'dividend', re: /\b(dividend|buyback|repurchase)\b/i, tone: 0.2 },
  { id: 'layoffs', re: /\b(layoffs?|job cuts|restructuring)\b/i, tone: -0.2 },
];
export function detectEvents(text = ''){
  const out = [];
  for (const r of EVENT_RULES) if (r.re.test(text)) out.push({ id: r.id, tone: r.tone });
  return out;
}

// איחוד: אותו URL קנוני, או Jaccard כותרות ≥ 0.6 בתוך 3 ימים → אשכול אחד; המקור הטוב ביותר מייצג.
export function clusterNews(items = []){
  const norm = items.filter((x) => x && x.title).map((x) => ({
    ...x,
    id: x.id || canonicalUrl(x.url || x.title),
    canon: canonicalUrl(x.url || ''),
    tok: tokens(x.title),
    weight: publisherWeight(x.publisher),
    publishedAt: x.publishedAt || x.datetime || null,
  })).sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  const clusters = [];
  for (const it of norm){
    let home = null;
    for (const c of clusters){
      const sameUrl = it.canon && c.rep.canon === it.canon;
      const close = it.publishedAt && c.rep.publishedAt ? Math.abs(daysBetween(c.rep.publishedAt.slice(0, 10), it.publishedAt.slice(0, 10))) <= 3 : true;
      if (sameUrl || (close && jaccard(it.tok, c.rep.tok) >= 0.6)){ home = c; break; }
    }
    if (home){
      home.members.push(it);
      if (it.weight > home.rep.weight) home.rep = it;
    } else clusters.push({ rep: it, members: [it] });
  }
  return clusters.map((c) => {
    const text = `${c.rep.title}. ${c.rep.summary || ''}`;
    const events = detectEvents(text);
    const providerSent = c.members.map((m) => m.sentiment?.score).filter(isNum);
    const sentiment = providerSent.length
      ? { score: round(providerSent.reduce((s, x) => s + x, 0) / providerSent.length, 3), method: 'provider' }
      : { score: lexiconSentiment(text) + (events.reduce((s, e) => s + e.tone, 0) * 0.3), method: events.length ? 'lexicon+events' : 'lexicon' };
    sentiment.score = round(Math.max(-1, Math.min(1, sentiment.score)), 3);
    sentiment.label = sentiment.score > 0.15 ? 'חיובי' : sentiment.score < -0.15 ? 'שלילי' : 'ניטרלי';
    const material = events.some((e) => Math.abs(e.tone) >= 0.4) || c.rep.weight === 1 && events.length > 0;
    return {
      id: c.rep.id, title: c.rep.title, url: c.rep.url, publisher: c.rep.publisher, publishedAt: c.rep.publishedAt,
      summary: c.rep.summary || '', source: c.rep.source, primary: c.rep.weight === 1, weight: c.rep.weight,
      sentiment, events: events.map((e) => e.id), material,
      cluster: { size: c.members.length, sources: [...new Set(c.members.map((m) => m.publisher).filter(Boolean))].slice(0, 8) },
    };
  });
}

// ציון סנטימנט מצרפי ל-N ימים אחרונים (ברירת מחדל 14), משוקלל לפי מקור ודעיכה בזמן. חסר אם <3 ידיעות ב-30 יום.
export function sentimentScore(clusters = [], asOfDate, days = 14){
  const ref = asOfDate || new Date().toISOString().slice(0, 10);
  const recent = clusters.filter((c) => c.publishedAt && c.publishedAt.slice(0, 10) <= ref && daysBetween(c.publishedAt.slice(0, 10), ref) <= 30);
  if (recent.length < 3) return { missing: true, reason: `רק ${recent.length} ידיעות ב-30 יום (נדרשות 3)`, count: recent.length };
  let ws = 0, wsum = 0;
  for (const c of recent){
    const age = daysBetween(c.publishedAt.slice(0, 10), ref);
    const decay = Math.exp(-age / days);
    const w = c.weight * decay;
    ws += c.sentiment.score * w; wsum += w;
  }
  const s = wsum ? ws / wsum : 0;
  const materials = recent.filter((c) => c.material);
  return {
    score: round(s, 3), value: Math.round(50 + 50 * s), count: recent.length, materialCount: materials.length,
    events: [...new Set(recent.flatMap((c) => c.events))], asOf: ref,
    reasons: [
      `${recent.length} ידיעות ייחודיות ב-30 יום (אחרי איחוד כפילויות), ${recent.filter((c) => c.primary).length} ממקור ראשוני`,
      `סנטימנט משוקלל ${round(s, 2)} (טווח −1…1), משקל גבוה למקור ראשוני ולידיעות טריות`,
      ...(materials.length ? [`אירועים מהותיים: ${[...new Set(materials.flatMap((c) => c.events))].join(', ')}`] : []),
    ],
  };
}
