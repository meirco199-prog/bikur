// אבחון חשבון התרגול: מאיפה מגיע הרווח/הפסד "מההתחלה". מדפיס חשבון, פוזיציות, עסקאות סגורות, פירוק, התאמה (reconciliation)
// ויומן האוטומט — בלי לשנות כלום. שימוש: WORKER_URL=https://... node invest-api/scripts/paper-check.mjs
const W = (process.env.WORKER_URL || '').replace(/\/$/, '');
if (!W){ console.error('WORKER_URL חסר'); process.exit(1); }
const get = async (p) => { const r = await fetch(`${W}/${p}`); const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 300), _status: r.status }; } };
const n = (v) => (typeof v === 'number' ? Math.round(v).toLocaleString('en-US') : String(v));
const paper = await get('paper');
console.log('=== paper-check: חשבון');
console.log(JSON.stringify({ account: paper.account, totalIls: paper.totalIls, cashIls: paper.cashIls, valueIls: paper.valueIls, pnlIls: paper.pnlIls, pnlPct: paper.pnlPct, realizedIls: paper.realizedIls, commissionsIls: paper.commissionsIls, trades: paper.trades, closedCount: paper.closedCount, asOf: paper.asOf, sessionDate: paper.sessionDate, pricedAsOf: paper.pricedAsOf, stale: paper.stale, staleSymbols: paper.staleSymbols, fx: paper.fx }, null, 0));
console.log('=== פוזיציות פתוחות (עלות → שווי)');
for (const p of paper.positions || []) console.log(`${p.symbol.padEnd(8)} qty=${p.qty} avg=${p.avgPrice} cur=${p.current} cost=${n(p.costIls)} value=${n(p.valueIls)} pnl=${n(p.pnlIls)} (${p.pnlPct}) asOf=${p.priceAsOf} ${p.priceSource || ''}${p.priceStale ? ' STALE' : ''} day=${n(p.dayPnlIls)} lots=${(p.lotIds || []).length}`);
console.log('=== עסקאות סגורות');
for (const x of paper.closed || []) console.log(`${x.symbol.padEnd(8)} ${x.date}→${x.exitDate} qty=${x.qty} in=${x.price} out=${x.exitPrice} pnlIls=${n(x.pnlIls)} fee=${x.feeIls ?? ''} src=${x.source || x.reason || ''}`);
console.log('=== עסקאות פתוחות (lots)');
for (const x of paper.open || []) console.log(`${x.symbol.padEnd(8)} ${x.date} qty=${x.qty} price=${x.price} fx=${x.fx} costIls=${n(x.costIls)} fee=${x.feeIls ?? ''} src=${x.source || ''} reason=${String(x.reason || '').slice(0, 60)}`);
console.log('=== עקומת שווי (day,total,spy)');
for (const e of paper.equity || []) console.log(JSON.stringify(e));
const bd = await get('paper/breakdown');
console.log('=== פירוק');
console.log(JSON.stringify({ totals: bd.totals, bySource: bd.bySource, strategy: bd.strategy, reconciliation: bd.reconciliation }, null, 0));
for (const s of bd.bySymbol || []) console.log(`${(s.symbol || '').padEnd(8)} realized=${n(s.realizedIls)} unrealized=${n(s.unrealizedIls)} fees=${n(s.feesIls)} price=${n(s.priceEffectIls)} fx=${n(s.fxEffectIls)}`);
const ag = await get('aggressive/report');
console.log('=== אגרסיבי: שערוך');
console.log(JSON.stringify({ day: ag.day, sessionDate: ag.sessionDate, pricedAsOf: ag.pricedAsOf, stale: ag.stale, staleSymbols: ag.staleSymbols, totalIls: ag.totalIls, cashIls: ag.cashIls, metrics: ag.metrics }, null, 0));
for (const p of ag.positions || []) console.log(`${(p.symbol || '').padEnd(8)} qty=${p.qty} price=${p.price} asOf=${p.priceAsOf} ${p.priceSource || ''}${p.priceStale ? ' STALE' : ''} value=${n(p.valueIls)} entry=${p.entry} pnl=${p.pnlPct}`);
for (const e of (ag.equity || []).slice(-8)) console.log('eq', JSON.stringify([e[0], e[1], e[2], e[3], e[5] ?? null]));
const auto = await get('auto');
console.log('=== אוטומט');
console.log(JSON.stringify({ enabled: auto.enabled, profile: auto.profile, version: auto.rules?.version, last: auto.last ? { day: auto.last.day, executed: auto.last.executed, notes: auto.last.notes || auto.last.legacyNotes || null } : null }, null, 0));
for (const j of (auto.journal || []).slice(0, 12)) console.log(`${j.day} ${j.at || ''} executed=${j.executed} ${String(j.reason || j.note || (j.notes || []).join(' | ') || '').slice(0, 160)} orders=${JSON.stringify((j.orders || []).map((o) => [o.side, o.symbol, o.qty, o.price, o.ok, o.error].filter((v) => v !== undefined)))}`);
