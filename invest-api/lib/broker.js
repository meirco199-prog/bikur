// ממשק ברוקר אחיד. PaperBroker = חשבון מסחר וירטואלי שמתנהג כמו חשבון אמיתי:
// יתרת מזומן בש"ח, קנייה רק עד היתרה, עמלות והמרת מטבע מדומות (מודל IBKR), מכירה מחזירה מזומן, יומן שלא נמחק.
// IbkrBroker — שלב 3 (ראו IMPLEMENTATION_PLAN.md).
import { uid, round, isNum } from '../engine/util.js';

export function commissionIls(qty, priceUsd, fx, currency = 'USD'){
  // IBKR Pro (מקורב): 0.005$ למניה, מינימום 1$, מקסימום 1% משווי; ת"א: 0.1% מינימום 5 ₪; המרת מטבח 0.002% מינימום 2$
  if (currency === 'ILS') return round(Math.max(5, qty * priceUsd * 0.001), 2);
  const value = qty * priceUsd;
  const c = Math.min(Math.max(1, qty * 0.005), value * 0.01);
  const fxFee = Math.max(2, value * 0.00002);
  return round((c + fxFee) * fx, 2);
}

// prefix: 'paper:' = חשבון התרגול; תיקי צל (מסלולי השוואה) מקבלים prefix משלהם (track:{id}:paper:) — אותה לוגיקה, מצב נפרד לחלוטין
export class PaperBroker {
  constructor(db, { prefix = 'paper:' } = {}){ this.db = db; this.prefix = prefix; }
  key(k){ return this.prefix + k; }
  async trades(){ return (await this.db.get(this.key('trades'))) || []; }
  async save(t){ await this.db.put(this.key('trades'), t); }
  async account(initialIls = 200000){
    let a = await this.db.get(this.key('account'));
    if (!a){ // הגירה: חשבון ראשון — המזומן = התחלתי פחות עלות פוזיציות פתוחות קיימות (יכול להיות שלילי → חסימת קניות עד איפוס)
      const t = await this.trades();
      const cost = t.filter((x) => !x.exitDate).reduce((s, x) => s + (x.costIls ?? x.qty * x.price * (x.fx || 3.7)), 0);
      a = { initialIls, cashIls: round(initialIls - cost, 2), createdAt: new Date().toISOString(), commissionsIls: 0 };
      await this.db.put(this.key('account'), a);
    }
    return a;
  }
  async reset(initialIls){
    const t = await this.trades();
    if (t.length) await this.db.put(this.key('archive:') + Date.now(), t);
    await this.save([]);
    const a = { initialIls, cashIls: initialIls, createdAt: new Date().toISOString(), commissionsIls: 0 };
    await this.db.put(this.key('account'), a); await this.db.put(this.key('equity'), []);
    return a;
  }
  // at: חותמת זמן של הביצוע (תיקי צל ממלאים לפי מחיר 09:40 ניו יורק שנאסף מאוחר יותר — הרישום נושא את זמן הסשן, לא את זמן העיבוד)
  async placeOrder({ symbol, side, qty, price, currency = 'USD', fx = 3.7, reason, signal, snapDate, priceSource, at = null }){
    if (!isNum(qty) || qty <= 0 || Math.floor(qty) !== qty) throw new Error('כמות חייבת להיות מספר שלם וחיובי');
    if (!isNum(price) || price <= 0) throw new Error('אין מחיר ביצוע (חסר quote/סגירה)');
    const acc = await this.account();
    const rate = currency === 'ILS' ? 1 : fx;
    const fee = commissionIls(qty, price, fx, currency);
    const t = await this.trades();
    if (side === 'buy'){
      const cost = round(qty * price * rate + fee, 2);
      if (cost > acc.cashIls) throw new Error(`אין מספיק מזומן: יש ${Math.round(acc.cashIls).toLocaleString('en-US')} ₪, הקנייה עולה ${Math.round(cost).toLocaleString('en-US')} ₪`);
      const trade = { id: uid('pt_'), symbol, side: 'buy', qty, price, currency, fx: rate, feeIls: fee, costIls: cost, date: at || new Date().toISOString(), reason: reason || '', signalAtEntry: signal || null, snapDate: snapDate || null, priceSource: priceSource || null };
      t.push(trade); acc.cashIls = round(acc.cashIls - cost, 2); acc.commissionsIls = round((acc.commissionsIls || 0) + fee, 2);
      await this.save(t); await this.db.put(this.key('account'), acc);
      return { trade, account: acc };
    }
    const holding = t.filter((x) => x.symbol === symbol && !x.exitDate).reduce((s, x) => s + x.qty, 0);
    if (holding < qty) throw new Error(`יש לך רק ${holding} יחידות של ${symbol}`);
    let left = qty; const closed = [];
    for (const x of t){
      if (x.symbol !== symbol || x.exitDate || left <= 0) continue;
      const take = Math.min(left, x.qty);
      if (take < x.qty){ const rest = { ...x, id: uid('pt_'), qty: x.qty - take, costIls: round((x.costIls || 0) * (x.qty - take) / x.qty, 2) }; x.qty = take; x.costIls = round((x.costIls || 0) - rest.costIls, 2); t.push(rest); }
      x.exitDate = at || new Date().toISOString(); x.exitPrice = price; x.exitFx = rate; x.exitReason = reason || '';
      x.proceedsIls = round(x.qty * price * rate, 2); x.pnl = round((price - x.price) * x.qty, 2); x.pnlPct = round(price / x.price - 1, 4); x.pnlIls = round(x.proceedsIls - (x.costIls || x.qty * x.price * (x.fx || rate)), 2);
      closed.push(x); left -= take;
    }
    const proceeds = round(qty * price * rate - fee, 2);
    acc.cashIls = round(acc.cashIls + proceeds, 2); acc.commissionsIls = round((acc.commissionsIls || 0) + fee, 2);
    if (closed.length) closed[0].exitFeeIls = fee;
    await this.save(t); await this.db.put(this.key('account'), acc);
    return { closed, account: acc, proceedsIls: proceeds };
  }
  async cancel(id){
    const t = await this.trades(); const x = t.find((y) => y.id === id);
    if (!x) throw new Error('לא נמצא'); if (x.exitDate) throw new Error('עסקה סגורה לא ניתנת לביטול');
    const acc = await this.account(); acc.cashIls = round(acc.cashIls + (x.costIls || 0), 2);
    await this.save(t.filter((y) => y.id !== id)); await this.db.put(this.key('account'), acc);
    return acc;
  }
  // תמונת חשבון: פוזיציות מאוחדות לפי נכס, מזומן, שווי, רווח/הפסד — הכול בש"ח
  async performance(priceOf, fxNow = null){
    const t = await this.trades(); const acc = await this.account();
    const open = t.filter((x) => !x.exitDate), closed = t.filter((x) => x.exitDate);
    const byS = {};
    for (const x of open){ const p = (byS[x.symbol] ||= { symbol: x.symbol, qty: 0, costIls: 0, costUsd: 0, currency: x.currency || 'USD', lots: [] }); p.qty += x.qty; p.costIls += x.costIls || x.qty * x.price * (x.fx || 3.7); p.costUsd += x.qty * x.price; p.lots.push(x); }
    const positions = Object.values(byS).map((p) => {
      const cur = priceOf(p.symbol); const rate = p.currency === 'ILS' ? 1 : (fxNow || p.lots[0].fx || 3.7);
      const valIls = isNum(cur) ? round(p.qty * cur * rate, 2) : null;
      return { symbol: p.symbol, qty: p.qty, currency: p.currency, avgPrice: round(p.costUsd / p.qty, 4), current: cur, costIls: round(p.costIls, 2), valueIls: valIls, pnlIls: valIls !== null ? round(valIls - p.costIls, 2) : null, pnlPct: valIls !== null ? round(valIls / p.costIls - 1, 4) : null, firstDate: p.lots[0].date, lotIds: p.lots.map((l) => l.id) };
    });
    const valueIls = round(positions.reduce((s, p) => s + (p.valueIls ?? p.costIls), 0), 2);
    const totalIls = round(acc.cashIls + valueIls, 2);
    const realizedIls = round(closed.reduce((s, x) => s + (x.pnlIls || 0), 0), 2);
    const wins = closed.filter((x) => (x.pnlIls ?? x.pnl) > 0).length;
    return { account: acc, positions, cashIls: acc.cashIls, valueIls, totalIls, pnlIls: round(totalIls - acc.initialIls, 2), pnlPct: acc.initialIls ? round(totalIls / acc.initialIls - 1, 4) : null, realizedIls, commissionsIls: acc.commissionsIls || 0,
      open: open, closed: closed.sort((a, b) => b.exitDate.localeCompare(a.exitDate)), trades: t.length, closedCount: closed.length, winRate: closed.length ? round(wins / closed.length, 3) : null, equity: (await this.db.get(this.key('equity'))) || [], fx: fxNow };
  }
}
