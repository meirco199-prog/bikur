// מנוע הסימולציה הכרונולוגי של המעבדה (דרישות 4, 5, 10). דטרמיניסטי, טהור, בלי רשת.
//
// סדר הפעולות בכל יום מסחר k (וזה מה שמונע look-ahead):
//   1. פתיחה: פיצולים ודיבידנדים (ex-date) לפוזיציות קיימות → יציאות שתוזמנו ל"פתיחה למחרת" → יציאות זמן בפתיחה → מילוי פקודות
//      כניסה שנוצרו מאותות של ימים קודמים (פתיחה / Limit / Stop-entry), בגודל שמחושב מההון בסגירה הקודמת (ידוע).
//   2. תוך-יומי: סטופ / יעד / סטופ נגרר מול High-Low של הנר. פער בפתיחה מעבר לרמה → מילוי במחיר הפתיחה (גם לרעה).
//      נר שנגע בשתי הרמות → מניחים סטופ קודם (שמרני). רמת הסטופ הנגרר נקבעת מהנרות עד k-1 בלבד.
//   3. סגירה: יציאות זמן בסגירה, מגבלת הפסד יומי, מחיקה מהמסחר (הנר האחרון של הסדרה), כניסות MOC, יציאות-תנאי שמוגדרות "בסגירה".
//   4. אחרי הסגירה: חישוב האותות של יום k מנתונים ≤ k → פקודות ליום k+1 (או k+delay). יציאות-תנאי "בפתיחה למחרת" מתוזמנות.
//   5. שערוך ההון בסגירה (מחירים גולמיים), ריבית מרג'ין / עלות השאלה יומיות.
// מחירים: ביצוע במחירים גולמיים (מה שבאמת אפשר היה לקבל); תשואות ואינדיקטורים על הסגירה המתואמת (features.js).
import { normalizeSpec } from './schema.js';
import { compile } from './rules.js';
import { FeatureCache, FEATURES, featureKey, featureLabel, rollingMean } from './features.js';
import { isoOf, weekdayOf, monthOf } from './data.js';

const ok = (x) => x === x && x !== undefined && x !== null;

export function commission(costs, shares, price){
  const v = shares * price;
  if (costs.model === 'bps') return v * costs.bps / 1e4;
  if (costs.model === 'none') return 0;
  return Math.min(Math.max(costs.minPerOrder, costs.perShare * shares), costs.maxPctOfTrade * v);
}
export const regulatoryFees = (costs, shares, price) => (costs.regulatorySell ? 0.0000278 * shares * price + Math.min(0.000166 * shares, 8.3) : 0);
// מחיר מילוי אחרי החלקה (תמיד לרעת הסוחר): buy=true כשקונים (פתיחת לונג / סגירת שורט)
export const slipped = (costs, price, buy) => price * (1 + (buy ? 1 : -1) * (costs.slippageBps + costs.spreadBps / 2) / 1e4);

export function simulate(ds, specInput, { onProgress = null, cache = null, keepSignals = true, maxSignalDays = 6000 } = {}){
  const spec = normalizeSpec(specInput);
  const fc = cache || new FeatureCache();
  const C = spec.costs, Z = spec.sizing, long = spec.signal.direction === 'long', dir = long ? 1 : -1;
  const t0 = Date.now();
  if (!ds || !ds.n) return { error: 'אין נתונים בכלל — טען מערך נתונים לפני ההרצה', spec };

  // טווח
  const dayNumOf = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
  let kStart = spec.period.from ? ds.kOnOrAfter(dayNumOf(spec.period.from)) : 0;
  let kEnd = spec.period.to ? ds.kOnOrBefore(dayNumOf(spec.period.to)) : ds.n - 1;
  if (kStart >= ds.n || kEnd < 0 || kEnd - kStart < 2) return { error: 'אין מספיק ימי מסחר בתקופה המבוקשת בנתונים שנטענו', spec, coverage: ds.coverage() };

  // הידור תנאים
  const cond = spec.signal.conditions ? compile(spec.signal.conditions) : null;
  const rank = spec.signal.rank ? { ...spec.signal.rank, key: featureKey(spec.signal.rank.feature, spec.signal.rank.params) } : null;
  const condExits = spec.exit.rules.filter((r) => r.type === 'condition').map((r) => ({ ...r, c: compile(r.conditions) }));
  const timeRules = spec.exit.rules.filter((r) => r.type === 'time'), tp = spec.exit.rules.find((r) => r.type === 'take_profit'), sl = spec.exit.rules.find((r) => r.type === 'stop_loss'), trail = spec.exit.rules.find((r) => r.type === 'trailing_stop');
  const rankExit = spec.exit.rules.find((r) => r.type === 'rank_exit'), oppExit = spec.exit.rules.find((r) => r.type === 'opposite_signal');
  const dvKey = featureKey('dollar_vol', { n: 20 });
  const needVol = Z.mode === 'inverse_vol', volKey = featureKey('vol', { n: Z.volLookback }), capKey = 'market_cap';

  // משטר שוק (benchmark מול SMA) — מחושב מראש על סדרת הייחוס
  let regimeOk = () => true;
  if (spec.period.regime !== 'all'){
    const rs = ds.series.get(spec.period.regimeSymbol);
    if (!rs) return { error: `לסינון לפי מצב שוק נדרשת סדרת ${spec.period.regimeSymbol} בנתונים`, spec };
    const m = rollingMean(rs.a, spec.period.regimeSma);
    regimeOk = (k) => { const i = ds.rowIndex(spec.period.regimeSymbol, k); if (i < 0 || !ok(m[i])) return false; return spec.period.regime === 'bull' ? rs.a[i] > m[i] : rs.a[i] < m[i]; };
  }
  const dayAllowed = (k) => { const d = ds.dayAt(k); if (spec.period.weekdays && !spec.period.weekdays.includes(weekdayOf(d))) return false; if (spec.period.months && !spec.period.months.includes(monthOf(d))) return false; return true; };

  // מצב
  let cash = Z.capital, equity = Z.capital, eqPrevClose = Z.capital;
  const positions = new Map(); // sym → pos
  const pending = []; // פקודות כניסה
  const trades = [], equitySeries = [], signalsLog = [], skipped = {}, warnings = new Set();
  let tradeId = 0, missingFeatureHits = 0, liquidationDays = 0, dividendsTotal = 0, borrowTotal = 0, marginTotal = 0, commissionTotal = 0, feesTotal = 0, slipTotal = 0;
  const skip = (r) => { skipped[r] = (skipped[r] || 0) + 1; };
  const sectorExposure = () => { const m = {}; for (const p of positions.values()){ const s = p.sector || 'לא ידוע'; m[s] = (m[s] || 0) + Math.abs(p.shares * p.last); } return m; };
  const grossExposure = () => { let g = 0; for (const p of positions.values()) g += Math.abs(p.shares * p.last); return g; };
  const markEquity = () => { let v = cash; for (const p of positions.values()) v += p.dir * p.shares * p.last; return v; };

  // פתיחה/סגירה של פוזיציה
  function open(sym, k, rawPx, at, order){
    const bar = ds.bar(sym, k);
    const series = ds.series.get(sym);
    const px = slipped(C, rawPx, long);
    // גודל (דרישה 4): בסיס = הון בסגירה הקודמת (או ההון ההתחלתי בלי השקעה חוזרת)
    const base = Z.reinvest ? eqPrevClose : Z.capital;
    const slots = Z.maxPositions;
    let target;
    if (Z.mode === 'fixed') target = Z.amount;
    else if (Z.mode === 'pct') target = base * Z.pct;
    else target = base * Z.leverage / slots * (order.weight ?? 1);
    target = Math.min(target, base * Z.maxPerSymbolPct);
    if (Z.maxPerSectorPct < 1){ const sec = ds.sectorOf(sym) || 'לא ידוע', ex = sectorExposure()[sec] || 0; target = Math.min(target, Math.max(0, base * Z.maxPerSectorPct - ex)); }
    const room = base * Z.leverage - grossExposure(); if (room <= 0){ skip('leverage'); return false; } target = Math.min(target, room);
    if (long && Z.leverage <= 1) target = Math.min(target, Math.max(0, cash));
    let shares = Z.fractional ? Math.floor(target / px * 1e4) / 1e4 : Math.floor(target / px);
    if (Z.maxVolumePct && bar && bar.v > 0) shares = Math.min(shares, Z.fractional ? Z.maxVolumePct * bar.v : Math.floor(Z.maxVolumePct * bar.v));
    if (!(shares > 0)){ skip('small'); return false; }
    const comm = commission(C, shares, px), fee = long ? 0 : regulatoryFees(C, shares, px);
    if (long) cash -= shares * px + comm + fee; else cash += shares * px - comm - fee;
    commissionTotal += comm; feesTotal += fee; slipTotal += shares * Math.abs(px - rawPx);
    const pos = { id: ++tradeId, sym, dir, shares, entryK: k, entryAt: at, entryPx: px, entryRaw: rawPx, signalK: order.signalK, last: bar ? bar.c : rawPx, peak: at === 'open' && bar ? (long ? Math.max(rawPx, bar.h) : Math.min(rawPx, bar.l)) : rawPx, comm, fee, slip: shares * Math.abs(px - rawPx), div: 0, borrow: 0, mfe: 0, mae: 0, sector: ds.sectorOf(sym), reason: order.reason, rankValue: order.rankValue ?? null, rankPos: order.rank ?? null, participation: bar && bar.v > 0 ? shares / bar.v : null, pendingExit: null, lastBarK: k, seriesEnd: series.n - 1 };
    positions.set(sym, pos);
    return true;
  }
  function close(pos, k, rawPx, reason){
    const px = slipped(C, rawPx, !long);
    const comm = commission(C, pos.shares, px), fee = long ? regulatoryFees(C, pos.shares, px) : 0;
    if (long) cash += pos.shares * px - comm - fee; else cash -= pos.shares * px + comm + fee;
    commissionTotal += comm; feesTotal += fee; slipTotal += pos.shares * Math.abs(px - rawPx);
    const gross = pos.dir * pos.shares * (px - pos.entryPx);
    const costs = pos.comm + comm + pos.fee + fee + pos.borrow;
    const pnl = gross - comm - fee - pos.fee - pos.comm - pos.borrow + pos.div; // pos.comm/fee של הכניסה כבר ירדו מהמזומן — כאן לדיווח
    const notional = pos.shares * pos.entryPx;
    trades.push({ id: pos.id, symbol: pos.sym, side: long ? 'long' : 'short', sector: pos.sector, signalDate: isoOf(ds.dayAt(pos.signalK)), entryDate: isoOf(ds.dayAt(pos.entryK)), entryAt: pos.entryAt, entryPrice: +pos.entryPx.toFixed(4), exitDate: isoOf(ds.dayAt(k)), exitPrice: +px.toFixed(4), shares: pos.shares, holdDays: k - pos.entryK + (pos.entryAt === 'open' ? 1 : 0), pnl: +pnl.toFixed(2), pnlPct: notional ? +(pnl / notional).toFixed(6) : 0, grossPct: +(pos.dir * (px / pos.entryPx - 1)).toFixed(6), costs: { commission: +(pos.comm + comm).toFixed(2), fees: +(pos.fee + fee).toFixed(2), slippage: +(pos.slip + pos.shares * Math.abs(px - rawPx)).toFixed(2), borrow: +pos.borrow.toFixed(2), total: +(costs + pos.slip + pos.shares * Math.abs(px - rawPx)).toFixed(2) }, dividends: +pos.div.toFixed(2), mfe: +pos.mfe.toFixed(4), mae: +pos.mae.toFixed(4), participation: pos.participation, entryReason: pos.reason, exitReason: reason, rankValue: pos.rankValue, rankPos: pos.rankPos });
    positions.delete(pos.sym);
  }

  // הקשר רוחבי ליום k
  function makeCtx(k, eligible){
    const vals = new Map(), sorted = new Map();
    const arr = (sym, key) => { let m = vals.get(key); if (!m){ m = new Map(); vals.set(key, m); } return m; };
    const val = (sym, key) => { const m = arr(sym, key); if (m.has(sym)) return m.get(sym); const i = ds.rowIndex(sym, k); let v = NaN; if (i >= 0){ const [name, ps] = parseKey(key); v = fc.get(ds.series.get(sym), name, ps)[i]; if (v === undefined) v = NaN; } m.set(sym, v); return v; };
    const prev = (sym, key) => { const i = ds.rowIndex(sym, k); if (i <= 0) return NaN; const [name, ps] = parseKey(key); const v = fc.get(ds.series.get(sym), name, ps)[i - 1]; return v === undefined ? NaN : v; };
    const sortedFor = (key) => { let s = sorted.get(key); if (!s){ const xs = []; for (const sym of eligible){ const v = val(sym, key); if (v === v) xs.push(v); } xs.sort((a, b) => a - b); s = xs; sorted.set(key, s); } return s; };
    const lowerBound = (xs, v) => { let lo = 0, hi = xs.length; while (lo < hi){ const m = (lo + hi) >> 1; if (xs[m] < v) lo = m + 1; else hi = m; } return lo; };
    const upperBound = (xs, v) => { let lo = 0, hi = xs.length; while (lo < hi){ const m = (lo + hi) >> 1; if (xs[m] <= v) lo = m + 1; else hi = m; } return lo; };
    const ctx = { k, missing: 0, val, prev, attr: (sym, field) => (field === 'sector' ? ds.sectorOf(sym) : field === 'symbol' ? sym : ds.series.get(sym)?.meta?.[field] ?? null),
      xsPct: (sym, key) => { const v = val(sym, key); if (v !== v) return NaN; const xs = sortedFor(key); if (xs.length < 2) return 50; return lowerBound(xs, v) / (xs.length - 1) * 100; },
      xsRank: (sym, key, desc) => { const v = val(sym, key); if (v !== v) return NaN; const xs = sortedFor(key); return desc ? xs.length - upperBound(xs, v) + 1 : lowerBound(xs, v) + 1; } };
    return ctx;
  }
  const keyCache = new Map();
  function parseKey(key){ let p = keyCache.get(key); if (!p){ const m = key.match(/^(\w+)(?:\((.*)\))?$/); const name = m[1]; const ks = Object.keys(FEATURES[name].params); const ps = {}; if (m[2]) m[2].split(',').forEach((v, i) => { ps[ks[i]] = +v; }); p = [name, ps]; keyCache.set(key, p); } return p; }

  // כשירות סטטית ליום k (חברות במדד point-in-time + מסנני מחיר/מחזור/היסטוריה/סקטור)
  const F = spec.universe.filters, listSet = spec.universe.type === 'list' ? new Set(spec.universe.symbols) : null, excl = new Set(spec.universe.exclude), secIn = F.sectors.length ? new Set(F.sectors) : null, secOut = new Set(F.excludeSectors);
  function eligibleAt(k){
    const out = [];
    const cands = listSet ? [...listSet].filter((s) => ds.series.has(s)) : (spec.universe.pointInTime && ds.universe ? ds.membersAt(k) : ds.symbols);
    for (const sym of cands){
      if (excl.has(sym) || spec.benchmarks.includes(sym) && !listSet) continue;
      const i = ds.rowIndex(sym, k); if (i < 0) continue;
      const s = ds.series.get(sym); if (i + 1 < F.minBars) continue;
      const c = s.c[i]; if (!(c >= F.minPrice) || (F.maxPrice && c > F.maxPrice)) continue;
      if (F.minDollarVol > 0){ const dv = fc.get(s, 'dollar_vol', { n: 20 })[i]; if (!(dv >= F.minDollarVol)) continue; }
      if (secIn || secOut.size){ const sec = ds.sectorOf(sym); if (secIn && !secIn.has(sec)) continue; if (secOut.has(sec)) continue; }
      out.push(sym);
    }
    return out;
  }

  // אותות בסיום יום k → רשימת בחירות ממוינות [{sym, value, rank, weight}]
  let lastPicks = new Set(), lastOpposite = new Set();
  function signalsAt(k){
    const eligible = eligibleAt(k), ctx = makeCtx(k, eligible);
    let passed = cond ? eligible.filter((s) => cond.test(ctx, s)) : eligible;
    missingFeatureHits += ctx.missing;
    let picks;
    if (rank){
      const scored = []; for (const s of passed){ const v = ctx.val(s, rank.key); if (v === v) scored.push({ sym: s, value: v }); }
      scored.sort((a, b) => (rank.order === 'asc' ? a.value - b.value : b.value - a.value));
      picks = scored.slice(0, rank.top).map((x, i) => ({ ...x, rank: i + 1 }));
      if (oppExit){ const opp = scored.slice(-rank.top); lastOpposite = new Set(opp.map((x) => x.sym)); }
    } else {
      picks = passed.map((s) => ({ sym: s, value: null, rank: null }));
      if (Z.maxPositions && picks.length > Z.maxPositions) picks = picks.slice(0, Z.maxPositions);
      if (oppExit) lastOpposite = new Set(eligible.filter((s) => !cond.test(ctx, s)));
    }
    // משקלים (לגדלים לא שווים)
    if (picks.length){
      if (Z.mode === 'inverse_vol' || Z.mode === 'rank' || Z.mode === 'market_cap'){
        const w = picks.map((p, i) => { if (Z.mode === 'rank') return picks.length - i; const key = Z.mode === 'inverse_vol' ? volKey : capKey; const v = ctx.val(p.sym, key); if (Z.mode === 'inverse_vol') return v > 0 ? 1 / v : NaN; return v > 0 ? v : NaN; });
        if (w.some((x) => x !== x)){ warnings.add(Z.mode === 'market_cap' ? 'אין נתוני שווי שוק point-in-time לחלק מהמניות — נעשה שימוש בחלוקה שווה עבורן' : 'אין מספיק היסטוריה לתנודתיות בחלק מהמניות — חלוקה שווה עבורן'); }
        const clean = w.map((x) => (x === x ? x : null)), avg = clean.filter((x) => x !== null).reduce((a, b) => a + b, 0) / Math.max(1, clean.filter((x) => x !== null).length) || 1;
        const ww = clean.map((x) => (x === null ? avg : x)), sum = ww.reduce((a, b) => a + b, 0);
        picks.forEach((p, i) => { p.weight = sum > 0 ? ww[i] / sum * picks.length : 1; });
      } else picks.forEach((p) => { p.weight = 1; });
    }
    return { picks, eligible: eligible.length, passed: passed.length, ctx };
  }

  // ---------- הלולאה הראשית ----------
  {
    const total = kEnd - kStart + 1;
    for (let k = kStart; k <= kEnd; k++){
      const day = ds.dayAt(k), isLast = k === kEnd;
      // 1. פתיחה: אירועים תאגידיים לפוזיציות קיימות
      for (const pos of positions.values()){
        const s = ds.series.get(pos.sym), bar = ds.bar(pos.sym, k);
        const sr = s.splitOn(day); if (sr && sr > 0 && sr !== 1){ pos.shares = Z.fractional ? pos.shares * sr : Math.floor(pos.shares * sr); pos.entryPx /= sr; pos.entryRaw /= sr; pos.peak /= sr; pos.last /= sr; }
        if (C.dividends){ const dv = s.dividendOn(day); if (dv > 0){ const amt = pos.dir * pos.shares * dv; cash += amt; pos.div += amt; dividendsTotal += amt; } }
        if (bar) pos.lastBarK = k;
      }
      // יציאות שתוזמנו לפתיחה
      for (const pos of [...positions.values()]){
        const bar = ds.bar(pos.sym, k); if (!bar) continue;
        if (pos.pendingExit){ close(pos, k, bar.o, pos.pendingExit); continue; }
        const held = k - pos.entryK;
        if (timeRules.some((r) => r.at === 'open' && held >= r.days)) close(pos, k, bar.o, 'זמן (פתיחה)');
      }
      // מילוי פקודות כניסה
      let tradesToday = 0;
      if (pending.length){
        const allowed = dayAllowed(k);
        for (let j = 0; j < pending.length; j++){
          const o = pending[j];
          if (k < o.execK) continue;
          if (k > o.expiresK){ pending.splice(j--, 1); skip(o.type === 'limit' ? 'limit_not_filled' : o.type === 'stop' ? 'stop_not_triggered' : 'expired'); continue; }
          if (positions.has(o.sym)){ pending.splice(j--, 1); skip('already_held'); continue; }
          if (!allowed){ if (o.type === 'open' || o.type === 'close') { pending.splice(j--, 1); skip('period_filter'); } continue; }
          const bar = ds.bar(o.sym, k); if (!bar || !(bar.o > 0)){ if (k >= o.expiresK){ pending.splice(j--, 1); skip('no_bar'); } continue; }
          if (positions.size >= Z.maxPositions){ pending.splice(j--, 1); skip('max_positions'); continue; }
          if (Z.maxTradesPerDay && tradesToday >= Z.maxTradesPerDay){ pending.splice(j--, 1); skip('max_trades'); continue; }
          let fill = null;
          if (o.type === 'open') fill = bar.o;
          else if (o.type === 'limit'){ const lim = o.ref * (1 + spec.entry.limitPct * dir); if (long ? bar.o <= lim : bar.o >= lim) fill = bar.o; else if (long ? bar.l <= lim : bar.h >= lim) fill = lim; }
          else if (o.type === 'stop'){ const lv = o.ref * (1 + spec.entry.stopPct * dir); if (long ? bar.o >= lv : bar.o <= lv) fill = bar.o; else if (long ? bar.h >= lv : bar.l <= lv) fill = lv; }
          else continue; // MOC — בסגירה
          if (fill === null){ if (k >= o.expiresK){ pending.splice(j--, 1); skip(o.type === 'limit' ? 'limit_not_filled' : 'stop_not_triggered'); } continue; }
          if (open(o.sym, k, fill, 'open', o)) tradesToday++;
          pending.splice(j--, 1);
        }
      }
      // 2. תוך-יומי: סטופ / יעד / נגרר
      for (const pos of [...positions.values()]){
        const bar = ds.bar(pos.sym, k); if (!bar) continue;
        const openedToday = pos.entryK === k;
        const slLv = sl ? pos.entryPx * (1 - sl.pct * dir) : null, tpLv = tp ? pos.entryPx * (1 + tp.pct * dir) : null;
        const trLv = trail && !openedToday ? pos.peak * (1 - trail.pct * dir) : null;
        const hitLow = (lv) => (long ? bar.l <= lv : bar.h >= lv), hitHigh = (lv) => (long ? bar.h >= lv : bar.l <= lv);
        const gapBeyond = (lv, adverse) => (!openedToday && (adverse ? (long ? bar.o <= lv : bar.o >= lv) : (long ? bar.o >= lv : bar.o <= lv)));
        const worstStop = slLv !== null && trLv !== null ? (long ? Math.max(slLv, trLv) : Math.min(slLv, trLv)) : slLv ?? trLv;
        const stopName = worstStop === slLv ? 'סטופ' : 'סטופ נגרר';
        if (worstStop !== null && gapBeyond(worstStop, true)){ close(pos, k, bar.o, `${stopName} (פער בפתיחה)`); continue; }
        if (tpLv !== null && gapBeyond(tpLv, false)){ close(pos, k, bar.o, 'יעד (פער בפתיחה)'); continue; }
        if (worstStop !== null && hitLow(worstStop)){ close(pos, k, worstStop, stopName); continue; } // שמרני: סטופ לפני יעד
        if (tpLv !== null && hitHigh(tpLv)){ close(pos, k, tpLv, 'יעד'); continue; }
        // MFE/MAE ושיא לנגרר (אחרי היום — לשימוש מחר)
        const fav = long ? bar.h / pos.entryPx - 1 : 1 - bar.l / pos.entryPx, adv = long ? bar.l / pos.entryPx - 1 : 1 - bar.h / pos.entryPx;
        pos.mfe = Math.max(pos.mfe, fav); pos.mae = Math.min(pos.mae, adv);
        pos.peak = long ? Math.max(pos.peak, bar.h) : Math.min(pos.peak, bar.l);
        pos.last = bar.c;
      }
      // 3. סגירה
      // 3a. אותות של היום (נדרשים ל-MOC באותו יום ול-rank/opposite exits)
      let sig = null;
      const needSignalsNow = k < kEnd || spec.entry.timing === 'same_close';
      if (needSignalsNow && regimeOk(k)){ sig = signalsAt(k); } else if (needSignalsNow) { skip('regime'); }
      const todaysPicks = new Set(sig ? sig.picks.map((p) => p.sym) : []);
      // 3b. יציאות בסגירה: זמן, תנאי בסגירה, דירוג/הפוך בסגירה, מחיקה, הון
      for (const pos of [...positions.values()]){
        const bar = ds.bar(pos.sym, k); if (!bar) continue;
        const held = k - pos.entryK + (pos.entryAt === 'open' ? 1 : 0);
        if (timeRules.some((r) => r.at === 'close' && held >= r.days)){ close(pos, k, bar.c, 'זמן (סגירה)'); continue; }
        if (spec.exit.maxHoldDays && held >= spec.exit.maxHoldDays){ close(pos, k, bar.c, 'משך החזקה מקסימלי'); continue; }
        if (ds.rowIndex(pos.sym, k) === pos.seriesEnd && !isLast){ close(pos, k, bar.c, 'נמחקה מהמסחר (הנר האחרון)'); continue; }
        if (condExits.length || rankExit || oppExit){
          const ctx = sig?.ctx || makeCtx(k, []);
          let reason = null, at = null;
          for (const r of condExits) if (r.c.test(ctx, pos.sym)){ reason = 'תנאי יציאה'; at = r.at; break; }
          if (!reason && rankExit && sig && !todaysPicks.has(pos.sym) && pos.entryK < k){ reason = 'יצאה מהדירוג'; at = rankExit.at; }
          if (!reason && oppExit && lastOpposite.has(pos.sym)){ reason = 'אות הפוך'; at = oppExit.at; }
          if (reason){ if (at === 'close') { close(pos, k, bar.c, reason + ' (סגירה)'); continue; } pos.pendingExit = reason + ' (פתיחה למחרת)'; }
        }
      }
      // 3c. כניסות MOC (next_close מאותות אתמול; same_close מאותות היום — אופטימי)
      for (let j = 0; j < pending.length; j++){
        const o = pending[j]; if (o.type !== 'close' || k < o.execK) continue;
        if (positions.has(o.sym) || !dayAllowed(k)){ pending.splice(j--, 1); skip(positions.has(o.sym) ? 'already_held' : 'period_filter'); continue; }
        const bar = ds.bar(o.sym, k); if (!bar){ pending.splice(j--, 1); skip('no_bar'); continue; }
        if (positions.size >= Z.maxPositions){ pending.splice(j--, 1); skip('max_positions'); continue; }
        if (Z.maxTradesPerDay && tradesToday >= Z.maxTradesPerDay){ pending.splice(j--, 1); skip('max_trades'); continue; }
        if (open(o.sym, k, bar.c, 'close', o)) tradesToday++;
        pending.splice(j--, 1);
      }
      if (spec.entry.timing === 'same_close' && sig && dayAllowed(k)){
        for (const p of sig.picks){ if (positions.has(p.sym)){ skip('already_held'); continue; } if (positions.size >= Z.maxPositions){ skip('max_positions'); break; } const bar = ds.bar(p.sym, k); if (!bar) continue; if (open(p.sym, k, bar.c, 'close', { signalK: k, reason: reasonOf(p), rankValue: p.value, rank: p.rank, weight: p.weight })) tradesToday++; }
      }
      // 3d. מגבלת הפסד יומי — חיסול בסגירה (נמדד על סגירות; אין נתונים תוך-יומיים → מסומן בהנחות)
      for (const pos of positions.values()){ const bar = ds.bar(pos.sym, k); if (bar) pos.last = bar.c; }
      equity = markEquity();
      if (Z.dailyLossLimitPct && positions.size && equity / eqPrevClose - 1 <= -Z.dailyLossLimitPct){
        for (const pos of [...positions.values()]){ const bar = ds.bar(pos.sym, k); if (bar) close(pos, k, bar.c, 'מגבלת הפסד יומי (חיסול)'); }
        liquidationDays++; equity = markEquity();
      }
      // 4. פקודות למחר מהאותות של היום
      if (sig && spec.entry.timing !== 'same_close' && k < kEnd){
        const type = spec.entry.timing === 'next_close' ? 'close' : spec.entry.timing === 'limit' ? 'limit' : spec.entry.timing === 'stop' ? 'stop' : 'open';
        const execK = k + (spec.entry.timing === 'delay' ? spec.entry.delayDays : 1), expiresK = execK + ((type === 'limit' || type === 'stop') ? spec.entry.validDays - 1 : 0);
        for (const p of sig.picks){ if (positions.has(p.sym) || pending.some((o) => o.sym === p.sym)){ skip('already_held'); continue; } const bar = ds.bar(p.sym, k); pending.push({ sym: p.sym, type, signalK: k, execK, expiresK, ref: bar.c, rankValue: p.value, rank: p.rank, weight: p.weight, reason: reasonOf(p) }); }
        if (keepSignals && signalsLog.length < maxSignalDays) signalsLog.push({ date: isoOf(day), eligible: sig.eligible, passed: sig.passed, picks: sig.picks.map((p) => ({ symbol: p.sym, value: p.value === null ? null : +p.value.toFixed(5), rank: p.rank })) });
        lastPicks = todaysPicks;
      }
      // 5. עלויות יומיות: השאלה בשורט, ריבית מרג'ין
      if (!long && C.shortBorrowAnnualPct > 0) for (const pos of positions.values()){ const b = Math.abs(pos.shares * pos.last) * C.shortBorrowAnnualPct / 100 / 360; pos.borrow += b; cash -= b; borrowTotal += b; }
      if (cash < 0 && C.marginAnnualPct > 0){ const m = -cash * C.marginAnnualPct / 100 / 360; cash -= m; marginTotal += m; }
      equity = markEquity();
      const gross = grossExposure();
      equitySeries.push([isoOf(day), +equity.toFixed(2), +cash.toFixed(2), +(equity > 0 ? gross / equity : 0).toFixed(4), positions.size]);
      eqPrevClose = equity;
      if (onProgress && (k - kStart) % 50 === 0) onProgress((k - kStart + 1) / total);
    }
    // סגירת פוזיציות פתוחות בסוף התקופה (לדיווח; מסומן)
    for (const pos of [...positions.values()]){ const bar = ds.bar(pos.sym, kEnd) || { c: pos.last }; close(pos, kEnd, bar.c, 'סוף התקופה (פתוחה)'); }
    equity = markEquity(); if (equitySeries.length) equitySeries[equitySeries.length - 1][1] = +equity.toFixed(2);

    // ייחוס (Buy & Hold) על סגירה מתואמת
    const benchmarks = {};
    for (const b of spec.benchmarks){ const s = ds.series.get(b); if (!s) { benchmarks[b] = null; continue; } let k0 = kStart; while (k0 <= kEnd && ds.rowIndex(b, k0) < 0) k0++; if (k0 > kEnd){ benchmarks[b] = null; continue; } const a0 = s.a[ds.rowIndex(b, k0)]; let last = Z.capital; benchmarks[b] = equitySeries.map((e, idx) => { const i = ds.rowIndex(b, kStart + idx); if (i >= 0) last = Z.capital * s.a[i] / a0; return [e[0], +last.toFixed(2)]; }); }

    const assumptions = buildAssumptions(spec, ds, { missingFeatureHits, liquidationDays, warnings: [...warnings] });
    const coverage = ds.coverage(kStart, kEnd), gaps = ds.gaps(kStart, kEnd);
    const limited = coverage.pointInTime === false || (coverage.total && coverage.ratio < 0.9) || spec.entry.timing === 'same_close';
    return { spec, from: isoOf(ds.dayAt(kStart)), to: isoOf(ds.dayAt(kEnd)), days: kEnd - kStart + 1, capital: Z.capital, finalEquity: +equity.toFixed(2), equity: equitySeries, trades, signals: signalsLog, benchmarks, skipped, totals: { commission: +commissionTotal.toFixed(2), fees: +feesTotal.toFixed(2), slippage: +slipTotal.toFixed(2), borrow: +borrowTotal.toFixed(2), margin: +marginTotal.toFixed(2), dividends: +dividendsTotal.toFixed(2), costs: +(commissionTotal + feesTotal + slipTotal + borrowTotal + marginTotal).toFixed(2) }, coverage, gaps, assumptions, limited, warnings: [...warnings], runtimeMs: Date.now() - t0 };
  }

  function reasonOf(p){ if (rank) return `${featureLabel(rank.feature, rank.params)} = ${p.value === null ? '—' : fmtSmall(rank.feature, p.value)} · מקום ${p.rank}/${rank.top}`; return 'תנאי הכניסה התקיימו'; }
}
const fmtSmall = (f, v) => (['ret', 'gap', 'intraday', 'price_vs_sma', 'sma_ratio', 'dist_high', 'dist_low', 'drawdown', 'vol', 'atr_pct', 'vwap_dev', 'bb_width', 'pullback', 'macd_hist'].includes(f) ? `${(v * 100).toFixed(2)}%` : v.toFixed(2));

export function buildAssumptions(spec, ds, extra = {}){
  const a = [];
  a.push('האות מחושב רק מנתונים עד סגירת יום האות; הביצוע ביום העוקב במחיר הפתיחה/הסגירה הרשמי (אין קנייה במחיר אתמול אחרי שהירידה ידועה).');
  if (spec.entry.timing === 'same_close') a.push('⚠ כניסה בסגירת יום האות מניחה שהאות חושב מנתונים לפני הסגירה — הנחה אופטימית; התוצאה מסומנת כמוגבלת.');
  if (spec.exit.rules.some((r) => ['take_profit', 'stop_loss', 'trailing_stop'].includes(r.type))) a.push('סטופ/יעד נבדקים מול High/Low של הנר היומי: פער בפתיחה מעבר לרמה → מילוי בפתיחה (גם לרעה); נר שנגע בשתיהן → סטופ קודם (שמרני). אין נתונים תוך-יומיים.');
  if (spec.exit.rules.some((r) => r.type === 'condition' && r.at === 'close') || spec.entry.timing === 'next_close') a.push('ביצוע "בסגירה" = פקודת MOC; תנאי שמוערך על סגירת היום ומבוצע באותה סגירה הוא קירוב (בפועל נדרש חישוב דקות לפני הסגירה).');
  if (spec.sizing.dailyLossLimitPct) a.push('מגבלת ההפסד היומי נמדדת על מחירי סגירה (אין נתונים תוך-יומיים) — בפועל החיסול היה קורה מוקדם יותר או מאוחר יותר.');
  a.push(`עלויות: ${spec.costs.model === 'none' ? 'ללא (לא ריאלי)' : spec.costs.model === 'ibkr_fixed' ? `עמלת ${spec.costs.perShare}$/מניה (מינ׳ ${spec.costs.minPerOrder}$)` : `${spec.costs.bps} נ"ב`} + החלקה ${spec.costs.slippageBps} נ"ב לכל צד${spec.costs.spreadBps ? ` + מרווח ${spec.costs.spreadBps} נ"ב` : ''}. אין מודל השפעת שוק מעבר לכך — השתתפות במחזור מוצגת לכל עסקה.`);
  a.push(spec.costs.dividends ? 'דיבידנדים נזקפים ב-ex-date (לונג מקבל, שורט משלם); פיצולים מתואמים בכמות ובמחיר הכניסה.' : 'דיבידנדים לא נכללים.');
  if (spec.signal.direction === 'short') a.push(`שורט: עלות השאלה ${spec.costs.shortBorrowAnnualPct}% לשנה (קבועה; בפועל משתנה לפי מניה). אין מודל של "קשה להשאיל" או uptick.`);
  if (spec.sizing.leverage > 1) a.push(`מינוף ${spec.sizing.leverage}×: ריבית מרג'ין ${spec.costs.marginAnnualPct}% לשנה על מזומן שלילי; אין margin call מדומה.`);
  a.push('מניה שנמחקה: יציאה כפויה בסגירה האחרונה הידועה. חברות במדד — לפי ההרכב ההיסטורי של כל יום כשקיים.');
  if (extra.missingFeatureHits) a.push(`${extra.missingFeatureHits.toLocaleString('en-US')} בדיקות תנאי נפלו בגלל נתון חסר/היסטוריה קצרה (התנאי נחשב "לא מתקיים", לא הומצא ערך).`);
  if (extra.liquidationDays) a.push(`${extra.liquidationDays} ימי חיסול בגלל מגבלת ההפסד היומי.`);
  for (const w of extra.warnings || []) a.push('⚠ ' + w);
  if (ds?.meta?.provider) a.push(`מקור הנתונים: ${ds.meta.provider}${ds.meta.builtAt ? ` (נבנה ${ds.meta.builtAt.slice(0, 10)})` : ''}.`);
  return a;
}
