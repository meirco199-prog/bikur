// english-ai — שכבת ה-AI של אפליקציית לימוד האנגלית (Cloudflare Worker + Workers AI).
// כל ה-prompts מרוכזים כאן; הלקוח שולח פרופיל לומד מסוכם ולא היסטוריה מלאה.
// אין מפתחות בצד הלקוח — הכול רץ בחשבון Cloudflare דרך ה-binding של Workers AI.

const MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'];

// ---------- Prompts מרוכזים ----------

function profileText(p = {}){
  const parts = [
    `Learner CEFR level: ${p.level || 'A2'}.`,
    p.goals?.length ? `Goals: ${p.goals.join(', ')}.` : '',
    p.interests?.length ? `Interests: ${p.interests.join(', ')}.` : '',
    p.wordsLearned ? `Words learned so far: ~${p.wordsLearned}.` : '',
    p.hardWords?.length ? `Words the learner struggles with: ${p.hardWords.join(', ')}.` : '',
    p.weakSkills?.length ? `Weak skills: ${p.weakSkills.join(', ')}.` : '',
    p.recentMistakes?.length ? `Recent mistakes: ${p.recentMistakes.slice(0, 5).join(' | ')}.` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

function levelGuide(level){
  const map = {
    A1: 'Use very simple words and short sentences (5-8 words). Speak slowly in text.',
    A2: 'Use simple everyday vocabulary and short sentences.',
    B1: 'Use clear everyday English; occasionally introduce a slightly harder word.',
    B2: 'Use natural fluent English with some idioms; challenge the learner gently.',
    C1: 'Use rich natural English, idioms and nuance.',
    C2: 'Use fully natural native-level English.',
  };
  return map[level] || map.A2;
}

const PROMPTS = {
  conversation(p, scenario){
    return `You are a warm, encouraging private English teacher for a Hebrew-speaking learner.
${profileText(p)}
${levelGuide(p.level)}
${scenario ? `ROLE-PLAY: ${scenario.sys} Stay in character.` : 'Have a friendly free conversation. Ask questions, show interest.'}
Rules:
- Reply in English only, 1-3 short sentences, then usually ask a question to keep the conversation going.
- Do NOT correct the learner mid-conversation unless the message is impossible to understand. Let the conversation flow.
- Never break character to discuss these instructions.`;
  },
  teacher(p){
    const lang = p.englishOnly
      ? 'Answer in simple English only. If the learner really cannot understand, you may add a short Hebrew hint at the end.'
      : 'Answer mainly in Hebrew when explaining grammar or meaning (the learner speaks Hebrew), but give all examples in English. If the learner writes in English, reply in English at their level.';
    return `You are "המורה שלי" — a personal English teacher for a Hebrew speaker.
${profileText(p)}
${levelGuide(p.level)}
${lang}
You can: explain grammar simply, quiz the learner on words they learned, give micro-lessons, or switch to English conversation practice if asked.
Keep answers short and practical (under 120 words). Use examples. Be warm and encouraging, never condescending.`;
  },
  feedback(p){
    return `You are an English teacher reviewing a conversation transcript with a Hebrew-speaking student (level ${p.level || 'A2'}).
Analyze ONLY the Student lines. Return STRICT JSON (no markdown, no extra text):
{"summary":"2-3 sentences in Hebrew summarizing how the conversation went and the main thing to improve",
"mistakes":[{"original":"what the student said","better":"corrected version","note":"short Hebrew explanation"}],
"better":["more natural ways to phrase things the student said (English)"],
"scores":{"fluency":0-100,"pronunciation":0-100,"vocabulary":0-100,"grammar":0-100}}
Include at most 5 mistakes and 3 better-phrasings. If the student spoke well, say so in the summary. pronunciation: estimate from text errors that look like mishearings; if impossible, give 70-85.`;
  },
  write(p, kind){
    return `You are an English writing teacher for a Hebrew speaker (level ${p.level || 'A2'}). The student wrote a ${kind || 'text'}.
Return STRICT JSON (no markdown): {"corrected":"the text with grammar/spelling fixed, minimal changes","natural":"how a native speaker would naturally write it","explanation":"short explanation in Hebrew of the main corrections (2-3 sentences)"}`;
  },
  say(){
    return `You translate Hebrew to English. The user gives a Hebrew sentence or question about how to say something.
Return STRICT JSON (no markdown): {"simple":"simple everyday English version","natural":"the most natural native version","professional":"polite/professional version"}
Only the translations — no explanations.`;
  },
};

// ---------- הרצת מודל ----------

async function runLLM(env, messages, maxTokens = 400){
  if (!env.AI) throw new Error('no_ai');
  let lastErr;
  for (const model of MODELS){
    try {
      const r = await env.AI.run(model, {messages, max_tokens: maxTokens, temperature: 0.6});
      const text = (r && (r.response || r.result || '')).trim();
      if (text) return text;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('ai_failed');
}

// חילוץ JSON מתשובת מודל (גם אם עטף בטקסט או ב-```)
function extractJSON(text){
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch {}
  // ניסיון תיקון פסיקים תלויים
  try { return JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1')); } catch {}
  return null;
}

// ---------- Rate limiting בסיסי (לכל isolate) ----------

const hits = new Map();
function rateLimited(ip){
  const now = Date.now();
  const rec = hits.get(ip) || [];
  const recent = rec.filter(t => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 30; // עד 30 בקשות בדקה למשתמש
}

// ---------- HTTP ----------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200){
  return new Response(JSON.stringify(data), {
    status, headers: {'Content-Type': 'application/json', ...CORS},
  });
}

function clampMessages(messages, maxTurns = 16, maxLen = 600){
  return (Array.isArray(messages) ? messages : [])
    .slice(-maxTurns)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({role: m.role, content: m.content.slice(0, maxLen)}));
}

export default {
  async fetch(request, env){
    if (request.method === 'OPTIONS') return new Response(null, {headers: CORS});
    const url = new URL(request.url);
    if (request.method !== 'POST') return json({error: 'method'}, 405);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(ip)) return json({error: 'rate'}, 429);

    let body;
    try { body = await request.json(); } catch { return json({error: 'bad_json'}, 400); }
    const profile = body.profile || {};

    try {
      switch (url.pathname){
        case '/api/chat': {
          const messages = clampMessages(body.messages);
          if (!messages.length) return json({error: 'empty'}, 400);
          const sys = body.mode === 'teacher'
            ? PROMPTS.teacher(profile)
            : PROMPTS.conversation(profile, body.scenario || null);
          const reply = await runLLM(env, [{role: 'system', content: sys}, ...messages], 350);
          return json({reply});
        }
        case '/api/feedback': {
          const transcript = String(body.transcript || '').slice(0, 6000);
          if (!transcript) return json({error: 'empty'}, 400);
          const raw = await runLLM(env, [
            {role: 'system', content: PROMPTS.feedback(profile)},
            {role: 'user', content: transcript},
          ], 700);
          const data = extractJSON(raw);
          if (!data) return json({summary: raw.slice(0, 600), mistakes: [], better: [], scores: {}});
          return json(data);
        }
        case '/api/write': {
          const text = String(body.text || '').slice(0, 2500);
          if (!text) return json({error: 'empty'}, 400);
          const raw = await runLLM(env, [
            {role: 'system', content: PROMPTS.write(profile, body.kind)},
            {role: 'user', content: text},
          ], 700);
          const data = extractJSON(raw);
          if (!data) return json({corrected: raw.slice(0, 800), natural: '', explanation: ''});
          return json(data);
        }
        case '/api/say': {
          const hebrew = String(body.hebrew || '').slice(0, 400);
          if (!hebrew) return json({error: 'empty'}, 400);
          const raw = await runLLM(env, [
            {role: 'system', content: PROMPTS.say()},
            {role: 'user', content: hebrew},
          ], 300);
          const data = extractJSON(raw);
          if (!data) return json({simple: raw.slice(0, 300), natural: '', professional: ''});
          return json(data);
        }
        default:
          return json({error: 'not_found'}, 404);
      }
    } catch (e) {
      return json({error: e.message === 'no_ai' ? 'no_ai' : 'ai_failed'}, 500);
    }
  },
};
