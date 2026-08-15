// english-push — שרת התזכורות של אפליקציית האנגלית (Cloudflare Worker + KV + Cron).
//
// למה זה קיים: בדפדפן אין שום דרך להעיר אפליקציה סגורה בשעה קבועה.
// setTimeout מת ברגע שהאפליקציה נסגרת, ו-Periodic Background Sync נתמך רק
// ב-PWA מותקן בכרום ומופעל מתי שהדפדפן מחליט (לרוב: אף פעם). הדרך היחידה
// שבאמת עובדת היא Web Push — השרת דוחף, מערכת ההפעלה מעירה את ה-service worker.
//
// איך זה עובד כאן:
//   1. הלקוח שואל GET /key ומקבל את מפתח ה-VAPID הציבורי (נוצר פעם אחת ונשמר ב-KV).
//   2. הלקוח נרשם ב-pushManager ושולח POST /subscribe עם המנוי, אזור הזמן,
//      שעת התזכורת ומצב הלימוד (מתי הושלם אימון אחרון).
//   3. cron רץ כל 5 דקות, מחשב לכל מנוי מה השעה המקומית אצלו, ואם הגיע הזמן
//      והוא עוד לא למד היום — שולח push.
//   4. ה-push נשלח בלי גוף (בלי הצפנת payload): ה-service worker באפליקציה
//      קורא את המצב שלו מ-IndexedDB ומרכיב את נוסח ההתראה בעצמו. פחות קוד,
//      פחות מה שיישבר, והנוסח תמיד מעודכן לפי המצב האמיתי במכשיר.
//
// אין כאן סודות להגדיר: מפתחות ה-VAPID נוצרים לבד בקריאה הראשונה ונשמרים ב-KV.

const SUBJECT = 'mailto:meirco199@gmail.com';
const WINDOW_MIN = 150;   // עד כמה דקות אחרי שעת התזכורת עוד מותר לשלוח (אם ה-cron פספס)
const TTL = 86400;

// ---------- עזרי קידוד ----------

function b64url(bytes){
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlStr(str){ return b64url(new TextEncoder().encode(str)); }

async function sha256hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- מפתחות VAPID (נוצרים פעם אחת, חיים ב-KV) ----------

async function getVapid(env){
  let v = await env.PUSH.get('vapid', 'json');
  if (v && v.pub && v.priv) return v;
  const kp = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  await env.PUSH.put('vapid', JSON.stringify({pub: b64url(pub), priv}));
  // קוראים שוב: אם שתי בקשות יצרו מפתח באותו רגע, כולן ימשיכו עם אותו מפתח סופי
  v = await env.PUSH.get('vapid', 'json');
  return v || {pub: b64url(pub), priv};
}

// חתימת JWT בתקן VAPID — כותרת Authorization לכל בקשת push
async function vapidAuth(env, endpoint){
  const v = await getVapid(env);
  const head = b64urlStr(JSON.stringify({typ: 'JWT', alg: 'ES256'}));
  const body = b64urlStr(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: SUBJECT,
  }));
  const jwk = {...v.priv};
  delete jwk.key_ops;
  delete jwk.ext;
  const key = await crypto.subtle.importKey('jwk', jwk, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign(
    {name: 'ECDSA', hash: 'SHA-256'}, key, new TextEncoder().encode(head + '.' + body)));
  return {auth: `vapid t=${head}.${body}.${b64url(sig)}, k=${v.pub}`, pub: v.pub};
}

// שליחת push ריק. מחזיר את קוד התגובה של שירות ה-push.
async function sendPush(env, endpoint){
  const {auth} = await vapidAuth(env, endpoint);
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: {Authorization: auth, TTL: String(TTL), Urgency: 'normal'},
  });
  return r.status;
}

// ---------- מנויים ב-KV ----------

const subKey = hash => 'sub:' + hash;

function cleanRecord(prev, body){
  const sub = body.sub || {};
  const rec = {
    endpoint: sub.endpoint || prev?.endpoint,
    tz: Number.isFinite(body.tz) ? body.tz : (prev?.tz ?? 0),        // getTimezoneOffset בדקות
    time: /^\d{1,2}:\d{2}$/.test(body.time || '') ? body.time : (prev?.time || '20:00'),
    enabled: body.enabled === undefined ? (prev?.enabled ?? true) : !!body.enabled,
    lastLesson: body.lastLesson || prev?.lastLesson || null,
    metGoal: body.metGoal || prev?.metGoal || null,
    due: Number(body.due) || 0,
    streak: Number(body.streak) || 0,
    notifiedOn: prev?.notifiedOn || null,
    lastPush: prev?.lastPush || null,
    lastStatus: prev?.lastStatus || null,
    updatedAt: new Date().toISOString(),
  };
  // האימון של היום מתקדם רק קדימה — לא נותנים למכשיר ישן "לבטל" יום שנלמד
  if (prev?.lastLesson && prev.lastLesson > (rec.lastLesson || '')) rec.lastLesson = prev.lastLesson;
  if (prev?.metGoal && prev.metGoal > (rec.metGoal || '')) rec.metGoal = prev.metGoal;
  return rec;
}

// ---------- החלטה: האם להתריע עכשיו ----------

function localNow(tz){
  // tz = getTimezoneOffset() של הלקוח (דקות, חיובי ממערב ל-UTC). ישראל בקיץ: -180.
  const d = new Date(Date.now() - tz * 60000);
  const day = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  return {day, mins: d.getUTCHours() * 60 + d.getUTCMinutes()};
}

function shouldRemind(rec){
  if (!rec || !rec.endpoint || !rec.enabled) return false;
  const {day, mins} = localNow(rec.tz);
  if (rec.notifiedOn === day) return false;              // כבר הותרע היום
  if (rec.lastLesson === day || rec.metGoal === day) return false; // כבר למד היום
  const p = String(rec.time).split(':');
  const target = (parseInt(p[0], 10) || 20) * 60 + (parseInt(p[1], 10) || 0);
  return mins >= target && mins <= target + WINDOW_MIN;
}

// ---------- HTTP ----------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json', ...CORS}});

export default {
  async fetch(request, env){
    if (request.method === 'OPTIONS') return new Response(null, {headers: CORS});
    const url = new URL(request.url);
    if (!env.PUSH) return json({error: 'no_kv'}, 500);

    // מפתח ציבורי לרישום בדפדפן
    if (url.pathname === '/key'){
      const v = await getVapid(env);
      return json({key: v.pub});
    }

    // מצב המנוי — לחלונית האבחון באפליקציה
    if (url.pathname === '/status'){
      const endpoint = url.searchParams.get('endpoint') || '';
      if (!endpoint) return json({error: 'no_endpoint'}, 400);
      const rec = await env.PUSH.get(subKey(await sha256hex(endpoint)), 'json');
      if (!rec) return json({found: false});
      return json({
        found: true, time: rec.time, tz: rec.tz, enabled: rec.enabled,
        lastLesson: rec.lastLesson, notifiedOn: rec.notifiedOn,
        lastPush: rec.lastPush, lastStatus: rec.lastStatus, updatedAt: rec.updatedAt,
        wouldRemindNow: shouldRemind(rec),
      });
    }

    if (request.method !== 'POST') return json({error: 'method'}, 405);
    let body;
    try { body = await request.json(); } catch { return json({error: 'bad_json'}, 400); }

    // רישום/עדכון מנוי ומצב הלימוד
    if (url.pathname === '/subscribe'){
      const endpoint = body.sub?.endpoint;
      if (!endpoint || !/^https:\/\//.test(endpoint)) return json({error: 'bad_sub'}, 400);
      const hash = await sha256hex(endpoint);
      const prev = await env.PUSH.get(subKey(hash), 'json');
      await env.PUSH.put(subKey(hash), JSON.stringify(cleanRecord(prev, body)));
      return json({ok: true});
    }

    if (url.pathname === '/unsubscribe'){
      if (!body.endpoint) return json({error: 'no_endpoint'}, 400);
      await env.PUSH.delete(subKey(await sha256hex(body.endpoint)));
      return json({ok: true});
    }

    // בדיקה מיידית: שולח push אמיתי דרך שירות ה-push של הדפדפן
    if (url.pathname === '/test'){
      if (!body.endpoint) return json({error: 'no_endpoint'}, 400);
      const status = await sendPush(env, body.endpoint);
      const hash = await sha256hex(body.endpoint);
      const rec = await env.PUSH.get(subKey(hash), 'json');
      if (rec){
        rec.lastPush = new Date().toISOString();
        rec.lastStatus = status;
        await env.PUSH.put(subKey(hash), JSON.stringify(rec));
      }
      return json({ok: status >= 200 && status < 300, status});
    }

    return json({error: 'not_found'}, 404);
  },

  // ---------- Cron: כל 5 דקות עוברים על המנויים ----------
  async scheduled(event, env, ctx){
    ctx.waitUntil(runReminders(env));
  },
};

async function runReminders(env){
  let cursor;
  do {
    const page = await env.PUSH.list({prefix: 'sub:', cursor});
    cursor = page.list_complete ? null : page.cursor;
    for (const k of page.keys){
      const rec = await env.PUSH.get(k.name, 'json');
      if (!rec) continue;
      if (!shouldRemind(rec)) continue;
      let status = 0;
      try { status = await sendPush(env, rec.endpoint); } catch { status = 0; }
      if (status === 404 || status === 410 || status === 403){
        await env.PUSH.delete(k.name);   // מנוי מת או מפתח התחלף — הלקוח יירשם מחדש
        continue;
      }
      rec.lastPush = new Date().toISOString();
      rec.lastStatus = status;
      if (status >= 200 && status < 300) rec.notifiedOn = localNow(rec.tz).day;
      await env.PUSH.put(k.name, JSON.stringify(rec));
    }
  } while (cursor);
}
