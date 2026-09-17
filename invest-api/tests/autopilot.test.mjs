import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideOrders, AUTO_RULES } from '../engine/autopilot.js';

const row = (symbol, signal, score, extra = {}) => ({ symbol, signal, score, price: 100, currency: 'USD', type: 'stock', sector: 'Technology', riskLevel: 'בינוני', vol1y: 0.3, components: { fundamental: 80, valuation: 75, technical: 72 }, ...extra });
const perf = (cash, positions = []) => ({ cashIls: cash, valueIls: positions.reduce((s, p) => s + p.valueIls, 0), totalIls: cash + positions.reduce((s, p) => s + p.valueIls, 0), positions });
const bull = { trend: 'Bull Trend', risk: 'Risk On' };

test('אוטומט: קונה בשלבים לפי סיגנל וציון, עם מכסה יומית ורזרבת מזומן', () => {
  const table = [row('AAA', 'STRONG BUY', 80), row('BBB', 'BUY', 70), row('CCC', 'BUY', 66), row('DDD', 'BUY', 65), row('EEE', 'WATCH', 72)];
  const d = decideOrders({ table, regime: bull, perf: perf(200000), fx: 3.7, today: '2026-09-17' });
  assert.equal(d.orders.length, AUTO_RULES.maxBuysPerRun);
  assert.deepEqual(d.orders.map((o) => o.symbol), ['AAA', 'BBB', 'CCC']);
  for (const o of d.orders){ assert.equal(o.side, 'buy'); assert.ok(o.qty >= 1); assert.ok(o.estIls <= 200000 * 0.10 / 3 + 1, 'שלב = עד שליש מהיעד'); assert.match(o.reason, /שלב ראשון/); }
  assert.ok(d.skipped.find((s) => s.symbol === 'DDD' && /מכסת/.test(s.reason)));
  assert.ok(!d.orders.find((o) => o.symbol === 'EEE'));
});

test('אוטומט: שוק דובי — אין קניות, עצירת הפסד הדוקה', () => {
  const table = [row('AAA', 'STRONG BUY', 80), row('HLD', 'HOLD', 55)];
  const pos = [{ symbol: 'HLD', qty: 10, valueIls: 3300, costIls: 3700, pnlPct: -0.12 }];
  const d = decideOrders({ table, regime: { trend: 'Bear Trend', risk: 'Risk On' }, perf: perf(150000, pos), fx: 3.7 });
  assert.ok(!d.orders.some((o) => o.side === 'buy'));
  assert.ok(d.orders.find((o) => o.symbol === 'HLD' && o.rule === 'stop' && o.qty === 10));
  assert.ok(d.notes.some((n) => /דובי/.test(n)));
});

test('אוטומט: מכירה לפי סיגנל, הקטנה לחצי, עצירת הפסד לפי תנודתיות (vol 30% → 15%)', () => {
  const table = [row('S', 'SELL', 30), row('R', 'REDUCE', 45), row('L', 'HOLD', 55), row('K', 'BUY', 68, { vol1y: 0.16 })];
  const pos = [
    { symbol: 'S', qty: 7, valueIls: 2000, pnlPct: 0.05 },
    { symbol: 'R', qty: 9, valueIls: 2000, pnlPct: 0.1 },
    { symbol: 'L', qty: 4, valueIls: 2000, pnlPct: -0.16 },
    { symbol: 'K', qty: 3, valueIls: 2000, pnlPct: 0.02 },
  ];
  const d = decideOrders({ table, regime: bull, perf: perf(100000, pos), fx: 3.7 });
  const sells = d.orders.filter((o) => o.side === 'sell');
  assert.deepEqual(sells.map((o) => [o.symbol, o.qty, o.rule]), [['S', 7, 'signal'], ['R', 5, 'reduce'], ['L', 4, 'stop']]);
  assert.ok(d.orders.find((o) => o.symbol === 'K' && o.side === 'buy' && o.rule === 'add'), 'ממשיך לבנות פוזיציה עם סיגנל קנייה');
});

test('אוטומט: לא קונה לפני דוח, לא חורג מיעד, לא קונה בלי מזומן', () => {
  const table = [row('E', 'STRONG BUY', 85, { nextEarnings: '2026-09-19' }), row('F', 'STRONG BUY', 84)];
  const d = decideOrders({ table, regime: bull, perf: perf(200000, [{ symbol: 'F', qty: 50, valueIls: 21000, pnlPct: 0 }]), fx: 3.7, today: '2026-09-17' });
  assert.ok(d.skipped.find((s) => s.symbol === 'E' && /דוח/.test(s.reason)));
  assert.ok(d.skipped.find((s) => s.symbol === 'F' && /יעד/.test(s.reason)));
  const d2 = decideOrders({ table: [row('F', 'STRONG BUY', 84)], regime: bull, perf: perf(9000, [{ symbol: 'X', qty: 1, valueIls: 191000, pnlPct: 0 }]), fx: 3.7 });
  assert.equal(d2.orders.length, 0); assert.ok(d2.skipped.find((s) => /מזומן/.test(s.reason)));
});

test('אוטומט: Risk Off — רק קנייה חזקה ובחצי גודל', () => {
  const table = [row('A', 'STRONG BUY', 80, { vol1y: 0.16 }), row('B', 'BUY', 75, { vol1y: 0.16 })];
  const d = decideOrders({ table, regime: { trend: 'Bull Trend', risk: 'Risk Off' }, perf: perf(200000), fx: 3.7 });
  assert.deepEqual(d.orders.map((o) => o.symbol), ['A']);
  assert.ok(d.orders[0].estIls <= 200000 * 0.10 * 0.5 / 3 + 1, 'שלב = שליש מיעד מוקטן');
});

test('אוטומט: ריכוז — פוזיציה של 50% מהתיק מוקטנת ליעד גם עם סיגנל קנייה, והמזומן משמש לקניות אחרות', () => {
  const table = [row('BIG', 'STRONG BUY', 80), row('OTH', 'BUY', 70, { sector: 'Health' })];
  const pos = [{ symbol: 'BIG', qty: 270, valueIls: 100000, pnlPct: -0.005 }];
  const d = decideOrders({ table, regime: bull, perf: perf(100000, pos), fx: 3.7 });
  const trim = d.orders.find((o) => o.symbol === 'BIG' && o.side === 'sell');
  assert.ok(trim && trim.rule === 'trim', JSON.stringify(d.orders));
  assert.ok(trim.qty >= 200 && trim.qty < 270, 'מוכר את העודף מעל 10% אבל לא הכל: ' + trim.qty);
  assert.match(trim.reason, /ריכוז/);
  assert.ok(!d.orders.some((o) => o.symbol === 'BIG' && o.side === 'buy'), 'לא קונים נייר שזה עתה הקטנו');
  assert.ok(d.orders.find((o) => o.symbol === 'OTH' && o.side === 'buy'));
  const small = decideOrders({ table, regime: bull, perf: perf(180000, [{ symbol: 'BIG', qty: 50, valueIls: 20000, pnlPct: 0 }]), fx: 3.7 });
  assert.ok(!small.orders.some((o) => o.rule === 'trim'), '10% מהתיק לא נחשב ריכוז');
});

test('אוטומט: משקלי ענף ומספר פוזיציות מחושבים אחרי המכירות של אותה ריצה; מכסה יומית כוללת ריצות קודמות', () => {
  const table = [row('BIG', 'STRONG BUY', 80, { sector: 'Fin', vol1y: 0.16 }), row('V2', 'STRONG BUY', 79, { sector: 'Fin' }), row('X', 'BUY', 70, { sector: 'Tech' })];
  const pos = [{ symbol: 'BIG', qty: 270, valueIls: 100000, pnlPct: 0 }];
  const d = decideOrders({ table, regime: bull, perf: perf(100000, pos), fx: 3.7 });
  assert.ok(d.orders.find((o) => o.symbol === 'V2' && o.side === 'buy'), 'אחרי הקטנת BIG הענף פנוי: ' + JSON.stringify(d.skipped));
  const d2 = decideOrders({ table, regime: bull, perf: perf(100000, pos), fx: 3.7, buysToday: 3 });
  assert.ok(!d2.orders.some((o) => o.side === 'buy')); assert.ok(d2.skipped.every((s) => /מכסת/.test(s.reason)));
});

const etf = (symbol, assetClass, role, price = 100) => ({ symbol, signal: 'HOLD', score: 55, price, currency: 'USD', type: 'etf', assetClass, role, sector: assetClass, vol1y: 0.15, components: {} });
test('אוטומט: ליבה — קרן מדד, אג"ח וזהב נקנות בשלבים לפי ה-sleeves בלי קשר לסיגנל, ולא נספרות כלוויין', () => {
  const table = [etf('VTI', 'equity', 'core', 300), etf('BND', 'bond', 'bond', 70), etf('GLD', 'gold', 'gold', 250), etf('SPY', 'equity', 'core', 600), row('AAA', 'BUY', 70)];
  const d = decideOrders({ table, regime: bull, perf: perf(200000), fx: 3.7 });
  const core = d.orders.filter((o) => o.rule === 'core');
  assert.deepEqual(core.map((o) => o.symbol), ['VTI', 'BND', 'GLD'], JSON.stringify(d.orders));
  const vti = core[0]; assert.ok(vti.estIls <= 200000 * 0.50 / 3 + 1 && vti.estIls > 30000, 'שלב = שליש מ-50%: ' + vti.estIls); assert.match(vti.reason, /ליבה.*שלב 1 מתוך 3/);
  assert.ok(!d.orders.some((o) => o.symbol === 'SPY'), 'רק קרן ליבה אחת לכל sleeve');
  assert.ok(d.orders.find((o) => o.symbol === 'AAA' && o.rule === 'open'), 'לוויין נקנה במקביל');
  // ריצה שנייה: הליבה ממשיכה לשלב 2, לא נמכרת לפי סיגנל SELL
  const pos = [{ symbol: 'VTI', qty: 27, valueIls: 30000, pnlPct: -0.2 }];
  const t2 = table.map((r) => (r.symbol === 'VTI' ? { ...r, signal: 'SELL', score: 20 } : r));
  const d2 = decideOrders({ table: t2, regime: bull, perf: perf(130000, pos), fx: 3.7 });
  assert.ok(!d2.orders.some((o) => o.symbol === 'VTI' && o.side === 'sell'), 'ליבה לא נמכרת לפי סיגנל או עצירת הפסד');
  assert.ok(d2.orders.find((o) => o.symbol === 'VTI' && o.rule === 'core' && /שלב 2/.test(o.reason)), JSON.stringify(d2.orders));
});

test('אוטומט: שוק דובי — הליבה נשארת ונקנית, מניות בודדות לא נקנות, עצירה הדוקה ב-25%', () => {
  const table = [etf('VTI', 'equity', 'core', 300), etf('BND', 'bond', 'bond', 70), row('AAA', 'STRONG BUY', 85), row('HLD', 'HOLD', 55)];
  const pos = [{ symbol: 'VTI', qty: 63, valueIls: 70000, pnlPct: -0.15 }, { symbol: 'HLD', qty: 10, valueIls: 3000, pnlPct: -0.12 }];
  const d = decideOrders({ table, regime: { trend: 'Bear Trend', risk: 'Risk Off' }, perf: perf(130000, pos), fx: 3.7 });
  assert.ok(!d.orders.some((o) => o.symbol === 'VTI' && o.side === 'sell'), 'ליבה לא נמכרת בשוק דובי');
  assert.ok(d.orders.find((o) => o.symbol === 'VTI' && o.rule === 'core'), 'ליבה ממשיכה להיקנות: ' + JSON.stringify(d.orders));
  assert.ok(d.orders.find((o) => o.symbol === 'BND' && o.rule === 'core'));
  assert.ok(!d.orders.some((o) => o.symbol === 'AAA'));
  assert.ok(d.orders.find((o) => o.symbol === 'HLD' && o.rule === 'stop'), 'עצירה 15%×0.75=11.25% → −12% מוכר');
});

test('אוטומט: גודל פוזיציה לפי סיכון — מניה תנודתית מקבלת יעד קטן יותר ועצירה רחוקה יותר', () => {
  const table = [row('CALM', 'STRONG BUY', 80, { vol1y: 0.16, sector: 'A' }), row('WILD', 'STRONG BUY', 80, { vol1y: 0.40, sector: 'B' })];
  const d = decideOrders({ table, regime: bull, perf: perf(200000), fx: 3.7 });
  const calm = d.orders.find((o) => o.symbol === 'CALM'), wild = d.orders.find((o) => o.symbol === 'WILD');
  assert.ok(calm && wild, JSON.stringify(d.orders) + JSON.stringify(d.skipped));
  assert.ok(calm.estIls > wild.estIls, `יציבה ${calm.estIls} > תנודתית ${wild.estIls}`);
  assert.match(calm.reason, /עצירה 8%/); assert.match(wild.reason, /עצירה 20%/);
  assert.match(calm.reason, /יעד 6\.\d?%|יעד 6%/); // 0.5% ÷ 8% = 6.25% מהתיק
});

test('אוטומט: תקציב הלוויין (20%) מגביל קניות מניות בודדות', () => {
  const table = [row('AAA', 'STRONG BUY', 85, { sector: 'A' }), row('BBB', 'STRONG BUY', 84, { sector: 'B' })];
  const pos = [{ symbol: 'S1', qty: 1, valueIls: 68000, pnlPct: 0 }];
  const t = [...table, row('S1', 'HOLD', 55, { sector: 'C' })];
  const d = decideOrders({ table: t, regime: bull, perf: perf(132000, pos), fx: 3.7 });
  assert.ok(d.orders.filter((o) => o.side === 'buy').length <= 1, JSON.stringify(d.orders));
  assert.ok(d.skipped.some((s) => /תקציב המניות/.test(s.reason)), JSON.stringify(d.skipped));
});

test('אוטומט: שלב ליבה פעם ביום לכל נייר; לוויין מעל התקציב → מוכרים את החלשה בלי סיגנל קנייה', () => {
  const table = [etf('VTI', 'equity', 'core', 300), etf('BND', 'bond', 'bond', 70), row('W', 'WATCH', 50, { sector: 'A' }), row('H', 'HOLD', 60, { sector: 'B' }), row('B1', 'STRONG BUY', 80, { sector: 'C' })];
  const pos = [{ symbol: 'W', qty: 60, valueIls: 22000, pnlPct: 0 }, { symbol: 'H', qty: 60, valueIls: 22000, pnlPct: 0 }, { symbol: 'B1', qty: 20, valueIls: 7000, pnlPct: 0 }];
  const d = decideOrders({ table, regime: bull, perf: perf(149000, pos), fx: 3.7, boughtToday: ['VTI'] });
  assert.ok(d.skipped.find((s) => s.symbol === 'VTI' && /כבר נקנה היום/.test(s.reason)), JSON.stringify(d.skipped));
  assert.ok(d.orders.find((o) => o.symbol === 'BND' && o.rule === 'core'), 'BND עוד לא נקנה היום');
  const sl = d.orders.filter((o) => o.rule === 'sleeve');
  assert.ok(sl.length >= 1 && sl[0].symbol === 'W', 'החלשה (WATCH, ציון 50) נמכרת קודם: ' + JSON.stringify(sl));
  assert.ok(!d.orders.some((o) => o.symbol === 'B1' && o.side === 'sell'), 'נייר עם סיגנל קנייה לא נמכר בגלל תקציב');
});

test('אוטומט: דירוג יחסי — קנייה רק ב-30% העליונים, קנייה חזקה רק ב-15% (ביקום של 20+)', () => {
  const filler = Array.from({ length: 40 }, (_, i) => row(`F${i}`, 'HOLD', 40 + i, { sector: 'Z' + (i % 5) })); // ציונים 40..79
  const table = [...filler, row('LOW', 'BUY', 66, { sector: 'A' }), row('MID', 'STRONG BUY', 74, { sector: 'B' }), row('TOP', 'STRONG BUY', 90, { sector: 'C' }), row('OKB', 'BUY', 75, { sector: 'D' })];
  // 44 מניות: 15% העליונים = 7 (סף 75 → MID 74 נדחית, TOP 90 עוברת); 30% = 14 (סף 68 → LOW 66 נדחית, OKB 75 עוברת)
  const d = decideOrders({ table, regime: bull, perf: perf(200000), fx: 3.7 });
  const syms = d.orders.map((o) => o.symbol);
  assert.ok(syms.includes('TOP') && syms.includes('OKB'), JSON.stringify(d.orders));
  assert.ok(d.skipped.find((s) => s.symbol === 'MID' && /העליונים/.test(s.reason)), JSON.stringify(d.skipped));
  assert.ok(d.skipped.find((s) => s.symbol === 'LOW' && /העליונים/.test(s.reason)));
});

test('אוטומט: מגבלות סיכון פתוח — כולל 3% ולענף 1.5%', () => {
  const eight = Array.from({ length: 6 }, (_, i) => ({ symbol: `P${i}`, qty: 10, valueIls: 5000, pnlPct: 0 })); // 6 × 5000 × 20% (vol 40%) = 6000 = 3% מ-200k, ורק 15% מהתיק
  const tbl = [...eight.map((p, i) => row(p.symbol, 'HOLD', 55, { sector: 'S' + i, vol1y: 0.40 })), row('NEW', 'STRONG BUY', 85, { sector: 'N' })];
  const d = decideOrders({ table: tbl, regime: bull, perf: perf(170000, eight), fx: 3.7 });
  assert.ok(!d.orders.some((o) => o.symbol === 'NEW'), JSON.stringify(d.orders));
  assert.ok(d.skipped.find((s) => s.symbol === 'NEW' && /סיכון פתוח כולל/.test(s.reason)), JSON.stringify(d.skipped));
  const two = [{ symbol: 'T1', qty: 10, valueIls: 10000, pnlPct: 0 }, { symbol: 'T2', qty: 10, valueIls: 10000, pnlPct: 0 }]; // ענף Tech: 20000 × 15% = 3000 = 1.5%
  const tbl2 = [row('T1', 'HOLD', 55, { sector: 'Tech' }), row('T2', 'HOLD', 55, { sector: 'Tech' }), row('T3', 'STRONG BUY', 85, { sector: 'Tech' }), row('H1', 'STRONG BUY', 84, { sector: 'Health' })];
  const d2 = decideOrders({ table: tbl2, regime: bull, perf: perf(180000, two), fx: 3.7 });
  assert.ok(d2.skipped.find((s) => s.symbol === 'T3' && /בענף Tech/.test(s.reason)), JSON.stringify(d2.skipped));
  assert.ok(d2.orders.find((o) => o.symbol === 'H1' && o.side === 'buy'), 'ענף אחר לא נחסם');
});

test('אוטומט: requireEarningsDate — בלי תאריך דוח לא פותחים פוזיציה (fail-closed)', () => {
  const table = [row('ND', 'STRONG BUY', 85), row('WD', 'STRONG BUY', 84, { nextEarnings: '2026-12-01', sector: 'B' })];
  const d = decideOrders({ table, regime: bull, perf: perf(200000), fx: 3.7, today: '2026-09-17', rules: { ...AUTO_RULES, requireEarningsDate: true } });
  assert.ok(d.skipped.find((s) => s.symbol === 'ND' && /fail-closed/.test(s.reason)));
  assert.ok(d.orders.find((o) => o.symbol === 'WD'));
});

test('אוטומט v8: ביטחון בנתונים, יקום כשיר מינימלי, ולא רודפים אחרי מחיר בשלב נוסף', () => {
  const big = Array.from({ length: 110 }, (_, i) => row(`U${i}`, 'HOLD', 40 + (i % 30), { sector: 'S' + (i % 8), coverage: 0.95 }));
  const t = [...big, row('LOWCOV', 'STRONG BUY', 88, { coverage: 0.7, sector: 'A' }), row('NOGROW', 'STRONG BUY', 87, { coverage: 0.9, missingComponents: ['growth'], sector: 'B' }), row('GOOD', 'STRONG BUY', 86, { coverage: 0.92, sector: 'C' })];
  const d = decideOrders({ table: t, regime: bull, perf: perf(200000), fx: 3.7 });
  assert.ok(d.skipped.find((s) => s.symbol === 'LOWCOV' && /כיסוי נתונים/.test(s.reason)), JSON.stringify(d.skipped.slice(0, 5)));
  assert.ok(d.skipped.find((s) => s.symbol === 'NOGROW' && /חסר רכיב ליבה/.test(s.reason)));
  assert.ok(d.orders.find((o) => o.symbol === 'GOOD'), JSON.stringify(d.orders));
  // יקום קטן מדי בגלל תקלה: רק 60 עם נתונים מלאים
  const broken = t.map((r, i) => (i < 55 ? { ...r, coverage: 0.5 } : r));
  const d2 = decideOrders({ table: broken, regime: bull, perf: perf(200000), fx: 3.7 });
  assert.ok(!d2.orders.some((o) => o.side === 'buy' && o.rule !== 'core'), JSON.stringify(d2.orders));
  assert.ok(d2.notes.some((n) => /תקלת נתונים/.test(n)));
  // שלב נוסף: המחיר ברח 15% מעל הכניסה → לא רודפים
  const pos = [{ symbol: 'GOOD', qty: 10, valueIls: 4255, avgPrice: 100, pnlPct: 0.15 }];
  const t3 = t.map((r) => (r.symbol === 'GOOD' ? { ...r, price: 115 } : r));
  const d3 = decideOrders({ table: t3, regime: bull, perf: perf(195745, pos), fx: 3.7 });
  assert.ok(d3.skipped.find((s) => s.symbol === 'GOOD' && /לא רודפים/.test(s.reason)), JSON.stringify(d3.skipped.filter((s) => s.symbol === 'GOOD')));
});

test('אוטומט v9: לא רודפים — הגבול יחסי לתנודתיות (מניה יציבה 8%, תנודתית 20%)', () => {
  const t = [row('CALM', 'STRONG BUY', 85, { vol1y: 0.16, price: 109, sector: 'A' }), row('WILD', 'STRONG BUY', 85, { vol1y: 0.40, price: 115, sector: 'B' })];
  const pos = [{ symbol: 'CALM', qty: 10, valueIls: 4000, avgPrice: 100, pnlPct: 0.09 }, { symbol: 'WILD', qty: 5, valueIls: 2000, avgPrice: 100, pnlPct: 0.15 }];
  const d = decideOrders({ table: t, regime: bull, perf: perf(194000, pos), fx: 3.7 });
  assert.ok(d.skipped.find((s) => s.symbol === 'CALM' && /לא רודפים/.test(s.reason)), 'יציבה: 9% > 8% → נדחית ' + JSON.stringify(d.skipped));
  assert.ok(d.orders.find((o) => o.symbol === 'WILD' && o.rule === 'add'), 'תנודתית: 15% < 20% → ממשיכים ' + JSON.stringify(d.skipped));
});
