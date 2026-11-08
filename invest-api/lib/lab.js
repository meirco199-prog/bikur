// מעבדת האסטרטגיות — שכבת ה-AI בצד השרת (דרישה 12): טקסט חופשי → spec מובנה. המודל רק מנסח JSON; המנוע הדטרמיניסטי מחשב.
// מסלולים: Anthropic (ANTHROPIC_API_KEY) → Workers AI (binding AI) → מפענח החוקים המקומי. כל פלט עובר normalizeSpec; כישלון → נפילה למפענח המקומי עם סיבה גלויה.
import { buildPrompt, parseModelJson, parseFreeText } from '../engine/lab/nlp.js';

export async function parseStrategy(env, text){
  const t = String(text || '').trim().slice(0, 2000);
  if (!t) throw new Error('טקסט ריק');
  const { system, user } = buildPrompt(t);
  let raw = null, model = null, provider = 'none', failure = null;
  try {
    if (env.ANTHROPIC_API_KEY){
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: env.ANTHROPIC_MODEL || 'claude-opus-5', max_tokens: 1500, system, messages: [{ role: 'user', content: user }] }) });
      const j = await r.json(); if (!r.ok) throw new Error('anthropic: ' + (j.error?.message || r.status));
      raw = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'); model = j.model; provider = 'anthropic';
    } else if (env.AI){
      const r = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 1200 });
      raw = r.response || r.result?.response || ''; model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'; provider = 'workers-ai';
    }
    if (raw !== null){ const out = parseModelJson(raw); return { ...out, provider, model, notes: [...out.notes, 'ה-AI ניסח את ההגדרה; המנוע הדטרמיניסטי יחשב. בדוק את הסעיפים לפני ההרצה.'] }; }
  } catch (e) { failure = e.message; }
  const out = parseFreeText(t);
  return { ...out, provider: provider === 'none' ? 'rules' : provider, model, fallbackReason: failure ? `פלט ה-AI לא היה תקין (${failure.slice(0, 120)}) — נעשה שימוש במפענח החוקים המקומי` : (provider === 'none' ? 'שכבת ה-AI לא מוגדרת (אין ANTHROPIC_API_KEY/Workers AI) — מפענח חוקים מקומי' : null) };
}
