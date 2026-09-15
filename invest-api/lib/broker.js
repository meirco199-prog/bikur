// ממשק ברוקר אחיד. כרגע: PaperBroker (תיק וירטואלי). IbkrBroker — שלב 3 (ראו IMPLEMENTATION_PLAN.md).
// כללי בטיחות (לכל מימוש עתידי): kill switch, max order, אישור ידני, יומן append-only.
import { uid, round, isNum } from '../engine/util.js';

export class PaperBroker {
  constructor(db){ this.db = db; }
  async trades(){ return (await this.db.get('paper:trades')) || []; }
  async save(t){ await this.db.put('paper:trades', t); }
  async positions(){
    const t = await this.trades();
    const pos = {};
    for (const x of t){
      if (x.exitDate) continue;
      pos[x.symbol] = pos[x.symbol] || { symbol: x.symbol, qty: 0, cost: 0, trades: [] };
      pos[x.symbol].qty += x.qty; pos[x.symbol].cost += x.qty * x.price; pos[x.symbol].trades.push(x.id);
    }
    return Object.values(pos).map((p) => ({ ...p, avgPrice: p.qty ? round(p.cost / p.qty, 4) : null }));
  }
  async placeOrder({ symbol, side, qty, price, reason, signal, snapDate, priceSource }){
    if (!isNum(qty) || qty <= 0) throw new Error('כמות לא תקינה');
    if (!isNum(price) || price <= 0) throw new Error('אין מחיר ביצוע (חסר quote/סגירה)');
    const t = await this.trades();
    if (side === 'buy'){
      const trade = { id: uid('pt_'), symbol, side: 'buy', qty, price, date: new Date().toISOString(), reason: reason || '', signalAtEntry: signal || null, snapDate: snapDate || null, priceSource: priceSource || null };
      t.push(trade); await this.save(t); return trade;
    }
    // sell: סוגר פוזיציות פתוחות FIFO
    let left = qty; const closed = [];
    for (const x of t){
      if (x.symbol !== symbol || x.exitDate || left <= 0) continue;
      const take = Math.min(left, x.qty);
      if (take < x.qty){ // פיצול
        const rest = { ...x, id: uid('pt_'), qty: x.qty - take }; x.qty = take; t.push(rest);
      }
      x.exitDate = new Date().toISOString(); x.exitPrice = price; x.exitReason = reason || ''; x.pnl = round((price - x.price) * x.qty, 2); x.pnlPct = round(price / x.price - 1, 4);
      closed.push(x); left -= take;
    }
    if (!closed.length) throw new Error('אין פוזיציה פתוחה למכירה');
    await this.save(t); return closed;
  }
  async performance(priceOf){
    const t = await this.trades();
    const open = t.filter((x) => !x.exitDate), closed = t.filter((x) => x.exitDate);
    const realized = closed.reduce((s, x) => s + (x.pnl || 0), 0);
    let unrealized = 0, marketValue = 0, cost = 0;
    const openRows = [];
    for (const x of open){ const p = priceOf(x.symbol); const mv = isNum(p) ? p * x.qty : null; if (mv !== null){ unrealized += mv - x.qty * x.price; marketValue += mv; } cost += x.qty * x.price; openRows.push({ ...x, current: p, pnl: mv !== null ? round(mv - x.qty * x.price, 2) : null, pnlPct: isNum(p) ? round(p / x.price - 1, 4) : null }); }
    const wins = closed.filter((x) => x.pnl > 0).length;
    const equity = (await this.db.get('paper:equity')) || [];
    return { open: openRows, closed: closed.sort((a, b) => b.exitDate.localeCompare(a.exitDate)), realized: round(realized, 2), unrealized: round(unrealized, 2), marketValue: round(marketValue, 2), cost: round(cost, 2), trades: t.length, closedCount: closed.length, winRate: closed.length ? round(wins / closed.length, 3) : null, avgPnlPct: closed.length ? round(closed.reduce((s, x) => s + (x.pnlPct || 0), 0) / closed.length, 4) : null, equity };
  }
}
