// לקוח דק ל-IBKR Client Portal Web API דרך ה-Gateway המקומי (https://localhost:5000/v1/api). רץ על המחשב/שרת של הגשר, לא ב-Worker.
// הזרקת fetch מאפשרת בדיקות בלי רשת. כל מתודה מחזירה JSON או זורקת Error עם קוד HTTP והתחלת התשובה.
// לא שומר סיסמאות: ההתחברות ל-Gateway נעשית פעם אחת בדפדפן (משתמש הדמה + IB Key); הלקוח רק בודק שהסשן חי (tickle).
import { ibkrContractSpec, pickFrontMonth, needsConfirm, orderIdOf, optionMonth, parseQuoteNum } from '../engine/ibkr-map.js';
import { parseOptionSymbol } from '../engine/options.js';

export class IbkrClient {
  constructor({ base = 'https://localhost:5000/v1/api', fetch: f = globalThis.fetch, timeoutMs = 20000, log = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}){
    this.base = base.replace(/\/$/, ''); this.fetch = f; this.timeoutMs = timeoutMs; this.log = log; this.sleep = sleep; this.conids = new Map();
  }
  async call(method, path, body){
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const r = await this.fetch(this.base + path, { method, headers: { 'Content-Type': 'application/json', 'User-Agent': 'bikur-ibkr-bridge' }, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
      const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { j = { raw: txt }; }
      if (!r.ok) throw Object.assign(new Error(`IBKR ${method} ${path} → HTTP ${r.status}: ${txt.slice(0, 200)}`), { status: r.status, body: j });
      return j;
    } finally { clearTimeout(t); }
  }
  get(p){ return this.call('GET', p); }
  post(p, b = {}){ return this.call('POST', p, b); }
  del(p){ return this.call('DELETE', p); }

  // --- סשן ---
  tickle(){ return this.post('/tickle'); }
  async authStatus(){ const s = await this.post('/iserver/auth/status').catch((e) => ({ authenticated: false, error: e.message })); return { authenticated: !!s?.authenticated, connected: !!s?.connected, competing: !!s?.competing, raw: s }; }
  reauth(){ return this.post('/iserver/reauthenticate'); }
  logout(){ return this.post('/logout'); }

  // --- חשבון ---
  async accounts(){ const a = await this.get('/iserver/accounts'); return a?.accounts || []; }
  async summary(acct){
    const s = await this.get(`/portfolio/${acct}/summary`);
    const v = (k) => { const x = s?.[k]; return x && typeof x === 'object' ? (x.amount ?? x.value ?? null) : (x ?? null); };
    return { netLiquidationUsd: v('netliquidation'), cashUsd: v('totalcashvalue'), buyingPowerUsd: v('buyingpower'), excessLiquidityUsd: v('excessliquidity'), maintMarginUsd: v('maintmarginreq'), grossPositionUsd: v('grosspositionvalue'), raw: undefined };
  }
  async positions(acct){
    const rows = []; for (let page = 0; page < 5; page++){ const p = await this.get(`/portfolio/${acct}/positions/${page}`); if (!Array.isArray(p) || !p.length) break; rows.push(...p); if (p.length < 100) break; }
    return rows.map((p) => ({ conid: p.conid, symbol: p.contractDesc || p.ticker || null, secType: p.assetClass || null, qty: Number(p.position) || 0, avgPrice: Number(p.avgPrice ?? p.avgCost) || null, marketPrice: Number(p.mktPrice) || null, marketValueUsd: Number(p.mktValue) || null, unrealizedUsd: Number(p.unrealizedPnl) || null, currency: p.currency || 'USD' }));
  }

  // --- חוזים ---
  async resolveConid(symbol, day = new Date().toISOString().slice(0, 10)){
    if (this.conids.has(symbol)) return this.conids.get(symbol);
    const spec = ibkrContractSpec(symbol); if (!spec) throw new Error(`אין מיפוי IBKR ל-${symbol}`);
    let conid = null, detail = null;
    if (spec.secType === 'FUT'){
      const r = await this.get(`/trsrv/futures?symbols=${encodeURIComponent(spec.symbol)}`);
      const c = pickFrontMonth(r?.[spec.symbol] || [], day); if (!c) throw new Error(`אין חוזה קרוב ל-${spec.symbol}`);
      conid = c.conid; detail = { expirationDate: c.expirationDate, exchange: spec.exchange };
    } else {
      const r = await this.post('/iserver/secdef/search', { symbol: spec.symbol, name: false, secType: spec.secType });
      const list = Array.isArray(r) ? r : [];
      const hit = list.find((x) => String(x.symbol || '').toUpperCase() === spec.symbol && (x.sections || []).some((s) => s.secType === spec.secType)) || list.find((x) => String(x.symbol || '').toUpperCase() === spec.symbol) || list[0];
      if (!hit?.conid) throw new Error(`לא נמצא conid ל-${symbol} (${spec.secType})`);
      conid = Number(hit.conid); detail = { description: hit.description || hit.companyName || null };
    }
    const out = { conid, spec, ...detail }; this.conids.set(symbol, out); return out;
  }

  /**
   * חוזה אופציה אמיתי מהסימבול הפנימי (<UNDER>-<YYYYMMDD>-<C|P>-<strike>): strikes ← info, ובחירה לפי תאריך הפקיעה המדויק (info מחזיר גם שבועיות).
   * strike שאינו נסחר נבחר הקרוב ביותר בטווח 1.5% (matched=false → ההשוואה לסימולציה תציין). underlyingConid = conid של הבסיס (STK).
   */
  async resolveOptionConid(symbol, underlyingConid){
    if (this.conids.has(symbol)) return this.conids.get(symbol);
    const p = parseOptionSymbol(symbol); if (!p) throw new Error(`סימבול אופציה לא תקין: ${symbol}`);
    const month = optionMonth(p.expiry); if (!month) throw new Error(`תאריך פקיעה לא תקין: ${p.expiry}`);
    // IBKR דורש secdef/search של הבסיס באותו סשן לפני strikes/info — conid שמור במטמון של הגשר מדלג עליו (באג 9/10: "אין strikes ל-USO")
    const sr = await this.post('/iserver/secdef/search', { symbol: p.underlying, name: false, secType: 'STK' }).catch(() => null);
    const sec = (Array.isArray(sr) ? sr.find((x) => Number(x.conid) === Number(underlyingConid)) : null)?.sections?.find((s) => s.secType === 'OPT');
    const months = String(sec?.months || '').split(';').filter(Boolean);
    if (months.length && !months.includes(month)) throw new Error(`אין חודש ${month} ל-${p.underlying} (יש: ${months.slice(0, 6).join(',')})`);
    const st = await this.get(`/iserver/secdef/strikes?conid=${underlyingConid}&sectype=OPT&month=${month}`);
    const strikes = ((p.right === 'C' ? st?.call : st?.put) || []).map(Number).filter(Number.isFinite);
    if (!strikes.length) throw new Error(`אין strikes ל-${p.underlying} ${month}`);
    // רשימת ה-strikes היא איחוד של כל הפקיעות בחודש; strike מסוים עשוי לא להיות רשום לפקיעה המדויקת (USO 147.5 קיים בשבועיות, לא ב-20/11).
    // לכן מנסים את ה-strike המבוקש ואז את הקרובים אליו (עד 1.5%), ובוחרים את הראשון שקיים בפקיעה המבוקשת
    const near = strikes.filter((k) => Math.abs(k - p.strike) / p.strike <= 0.015).sort((a, b) => Math.abs(a - p.strike) - Math.abs(b - p.strike) || a - b).slice(0, 6);
    if (!near.length) throw new Error(`אין strike קרוב ל-${p.strike} (הקרוב: ${strikes.reduce((b, k) => (Math.abs(k - p.strike) < Math.abs(b - p.strike) ? k : b), strikes[0])})`);
    const want = p.expiry.replace(/-/g, '');
    let hit = null, strike = null; const seen = new Set();
    for (const k of near){
      const info = await this.get(`/iserver/secdef/info?conid=${underlyingConid}&sectype=OPT&month=${month}&right=${p.right}&strike=${k}&exchange=SMART`);
      const list = Array.isArray(info) ? info : [];
      list.forEach((x) => seen.add(String(x.maturityDate)));
      hit = list.find((x) => String(x.maturityDate) === want && Number(x.strike) === k && x.right === p.right);
      if (hit){ strike = k; break; }
    }
    if (!hit?.conid) throw new Error(`לא נמצא חוזה ${p.underlying} ${p.right} ${p.strike} ${p.expiry} (נבדקו strikes ${near.join(',')}; פקיעות שחזרו: ${[...seen].sort().slice(0, 8).join(',') || '—'})`);
    const out = { conid: Number(hit.conid), spec: { secType: 'OPT' }, strike, matched: strike === p.strike, description: hit.desc2 || null };
    this.conids.set(symbol, out); return out;
  }
  /** ציטוט אחרון של חוזה: snapshot דורש קריאה ראשונה "מחממת" וקריאה שנייה עם הנתונים. → { bid, ask, last, availability } (ערכים או null) */
  async optionQuote(conid, { tries = 3, waitMs = 1500 } = {}){
    let q = { bid: null, ask: null, last: null, availability: null };
    for (let i = 0; i < tries; i++){
      const r = await this.get(`/iserver/marketdata/snapshot?conids=${conid}&fields=31,84,86,6509`);
      const x = Array.isArray(r) ? r[0] : null;
      if (x) q = { bid: parseQuoteNum(x['84']), ask: parseQuoteNum(x['86']), last: parseQuoteNum(x['31']), availability: x['6509'] || null };
      if (q.bid !== null || q.ask !== null) return q;
      await this.sleep(waitMs);
    }
    return q;
  }

  // --- פקודות ---
  async placeOrder(acct, order, { maxConfirms = 4 } = {}){
    let resp = await this.post(`/iserver/account/${acct}/orders`, { orders: [order] });
    let confirms = 0; const messages = [];
    while (needsConfirm(resp) && confirms < maxConfirms){ messages.push(...(resp[0].message || [])); confirms++; resp = await this.post(`/iserver/reply/${resp[0].id}`, { confirmed: true }); }
    const orderId = orderIdOf(resp);
    if (!orderId) throw Object.assign(new Error(`IBKR לא החזיר order_id: ${JSON.stringify(resp).slice(0, 200)}`), { body: resp, messages });
    return { orderId: String(orderId), status: (Array.isArray(resp) ? resp[0]?.order_status : resp?.order_status) || null, messages };
  }
  async orders(){ const r = await this.get('/iserver/account/orders'); return Array.isArray(r?.orders) ? r.orders : []; }
  cancel(acct, orderId){ return this.del(`/iserver/account/${acct}/order/${orderId}`); }
  async cancelAll(acct){ const open = (await this.orders()).filter((o) => /submitted|presubmitted|pending/i.test(o.status || '')); const out = []; for (const o of open){ try { await this.cancel(acct, o.orderId); out.push(o.orderId); } catch (e) { this.log(`ביטול ${o.orderId} נכשל: ${e.message}`); } } return out; }
}
