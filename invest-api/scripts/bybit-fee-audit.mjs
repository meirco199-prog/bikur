#!/usr/bin/env node
// ביקורת עמלות בפועל — קריאה בלבד מחשבון הדמו של Bybit: כל הביצועים (/v5/execution/list) של 30 הימים האחרונים ושיעורי העמלה של
// החשבון (/v5/account/fee-rate), מסוכמים לפי בוט ותפקיד הפקודה (engine/fee-audit.js). בקשת מאיר, 19/11/2026.
// רץ על השרת: bybit-bot.yml → fees (הקוד נשלח ב-stdin, המפתחות מ-/etc/bikur-bybit/bot.env). אין כאן שום פקודה ושום כתיבה —
// רק בקשות GET. הכתובת קבועה לחשבון הדמו.
import { auditFees, renderAudit } from '../engine/fee-audit.js';
import { createHmac } from 'node:crypto';

const BASE = 'https://api-demo.bybit.com', RW = '10000';
const KEY = process.env.BYBIT_DEMO_API_KEY || '', SECRET = process.env.BYBIT_DEMO_API_SECRET || '';
const DAYS = Math.min(Number(process.env.FEE_DAYS) || 30, 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!KEY || !SECRET){ console.error('חסרים BYBIT_DEMO_API_KEY / BYBIT_DEMO_API_SECRET'); process.exit(1); }

async function get(path, params){
  const ts = Date.now(), qs = new URLSearchParams(params).toString();
  const sig = createHmac('sha256', SECRET).update(String(ts) + KEY + RW + qs).digest('hex');
  const r = await fetch(`${BASE}${path}?${qs}`, { headers: { 'X-BAPI-API-KEY': KEY, 'X-BAPI-TIMESTAMP': String(ts), 'X-BAPI-RECV-WINDOW': RW, 'X-BAPI-SIGN': sig } });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { throw new Error(`${path} → HTTP ${r.status}`); }
  if (j.retCode !== 0) throw new Error(`${path} → ${j.retCode} ${j.retMsg}`);
  return j.result;
}

// Bybit מגביל כל בקשה לחלון של 7 ימים; עוברים אחורה בחלונות ובדפים
const rows = [], now = Date.now();
for (let end = now; end > now - DAYS * 86400e3; end -= 7 * 86400e3){
  const start = Math.max(end - 7 * 86400e3 + 1, now - DAYS * 86400e3);
  let cursor = '';
  for (let page = 0; page < 200; page++){
    const res = await get('/v5/execution/list', { category: 'linear', startTime: String(start), endTime: String(end), limit: '100', ...(cursor ? { cursor } : {}) });
    rows.push(...(res.list || []));
    cursor = res.nextPageCursor || '';
    if (!cursor || !(res.list || []).length) break;
    await sleep(150);
  }
}
console.error(`ביצועים שנמשכו: ${rows.length}`);

const syms = [...new Set(rows.map((r) => r.symbol))].sort();
const feeRates = [];
for (const s of syms.length ? syms : ['BTCUSDT']){
  try { feeRates.push(...((await get('/v5/account/fee-rate', { category: 'linear', symbol: s })).list || [])); } catch (e) { console.error(s, 'fee-rate:', e.message); }
  await sleep(100);
}

const a = auditFees(rows);
console.log(renderAudit(a, feeRates));
// לשימוש בשלב הבא (חישוב מחדש של הבדיקות): הסיכום בלבד, בלי מזהים של פקודות
console.log('\nFEEJSON:' + JSON.stringify({ days: DAYS, feeRates: feeRates.map(({ symbol, takerFeeRate, makerFeeRate }) => ({ symbol, takerFeeRate, makerFeeRate })), audit: a }));
