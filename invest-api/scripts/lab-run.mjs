#!/usr/bin/env node
// מעבדת האסטרטגיות — הרצה ללא דפדפן (GitHub Actions / מקומי) של תבנית או spec על מערך נתונים שנבנה ב-lab-data.mjs.
// שימוש: node lab-run.mjs --data lab-data-out --template top10-losers-1d [--from 2006-01-01] [--to 2026-11-01] [--optimize] [--walk] --out results/x.json
// הפלט: תוצאה מלאה (עסקאות, הון, מדדים, פילוחים, הנחות, כיסוי) + סיכום Markdown בעברית (--md).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { buildDataset, mergeCompact, Series } from '../engine/lab/data.js';
import { simulate } from '../engine/lab/simulate.js';
import { analyze } from '../engine/lab/metrics.js';
import { optimize, walkForward, monteCarlo, significance, periodBreakdown } from '../engine/lab/optimize.js';
import { byId } from '../engine/lab/library.js';
import { normalizeSpec, explainSpec } from '../engine/lab/schema.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; }, has = (k) => process.argv.includes(k);
const DATA = arg('--data', 'lab-data-out'), OUT = arg('--out', ''), MD = arg('--md', '');
const log = (...a) => console.error(...a);

export function loadDataset(dir, { from = null, to = null, symbols = null, index = 'sp500' } = {}){
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const universes = {}; for (const id of Object.keys(manifest.universes || {})){ const p = join(dir, 'universe', `${id}.json`); if (existsSync(p)) universes[id] = JSON.parse(readFileSync(p, 'utf8')); }
  const fromYear = from ? +from.slice(0, 4) - 2 : 0, toYear = to ? +to.slice(0, 4) : 9999;
  const want = symbols ? new Set(symbols) : null, series = [];
  for (const [sym, m] of Object.entries(manifest.symbols)){
    if (want && !want.has(sym)) continue;
    const parts = m.decades.filter((d) => d + 9 >= fromYear && d <= toYear).map((d) => JSON.parse(readFileSync(join(dir, 'bars', `${sym}.${d}.json`), 'utf8')));
    const c = mergeCompact(parts); if (c) series.push(c);
  }
  return buildDataset({ manifest, series, universes, universe: universes[index] || null, sectors: manifest.sectors, from, to, calendarFrom: series.some((s) => s.s === 'SPY') ? 'SPY' : null });
}

function md(spec, res, a, extra){
  const P = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`), N = (x, d = 2) => (x === null || x === undefined ? '—' : (+x).toFixed(d)), $ = (x) => (x === null || x === undefined ? '—' : Math.round(x).toLocaleString('en-US') + '$');
  const b = Object.entries(a.benchmarks).filter(([, v]) => v).map(([k, v]) => `| ${k} (Buy&Hold) | ${P(v.metrics.totalReturn)} | ${P(v.metrics.cagr)} | ${P(v.metrics.maxDD)} | ${N(v.metrics.sharpe)} | — |`).join('\n');
  const lines = [`# ${spec.name} — ${res.from} → ${res.to}`, '', `מחקר בלבד — אין כסף, אין פקודות. Backtest אינו תחזית.`, '', `**הגדרה:** ${spec.description || ''}`, '', '## תוצאה', '', '| | תשואה כוללת | CAGR | ירידה מקסימלית | Sharpe | עסקאות |', '|---|---|---|---|---|---|', `| **האסטרטגיה** | ${P(a.series.totalReturn)} | ${P(a.series.cagr)} | ${P(a.series.maxDD)} | ${N(a.series.sharpe)} | ${a.trades.count} |`, b, '', `הון התחלתי ${$(res.capital)} → ${$(res.finalEquity)} · רווח/הפסד ${$(res.finalEquity - res.capital)} · עלויות כוללות ${$(res.totals.costs)} (עמלות ${$(res.totals.commission)}, רגולטור ${$(res.totals.fees)}, החלקה ${$(res.totals.slippage)}) · דיבידנדים ${$(res.totals.dividends)}`, '', `אחוז עסקאות רווחיות ${P(a.trades.winRate)} · רווח ממוצע לעסקה ${P(a.trades.avgTradePct)} · Profit Factor ${N(a.trades.profitFactor)} · Sortino ${N(a.series.sortino)} · Calmar ${N(a.series.calmar)} · תנודתיות שנתית ${P(a.series.annVol)} · VaR 95% יומי ${P(a.series.var95)} · רצף הפסדים מקסימלי ${a.trades.maxLosingStreak} עסקאות`, ''];
  lines.push('## לפי שנה', '', '| שנה | תשואה | עסקאות | אחוז רווחיות |', '|---|---|---|---|');
  for (const y of a.breakdowns.byYear) lines.push(`| ${y.key} | ${P(a.periodic.yearly[y.key])} | ${y.count} | ${P(y.winRate)} |`);
  if (extra.periods?.length){ lines.push('', '## תקופות שוק', '', '| תקופה | אסטרטגיה | ירידה | SPY | עסקאות |', '|---|---|---|---|---|'); for (const p of extra.periods.filter((x) => !x.missing)) lines.push(`| ${p.label} (${p.from}→${p.to}) | ${P(p.totalReturn)} | ${P(p.maxDD)} | ${p.bench ? P(p.bench.totalReturn) : '—'} | ${p.trades} |`); }
  if (extra.significance && !extra.significance.error) lines.push('', '## מובהקות', '', `t = ${extra.significance.tStat}, p = ${extra.significance.pValue} (bootstrap ${extra.significance.pBootstrap}); Probabilistic Sharpe ${extra.significance.probabilisticSharpe}. **${extra.significance.verdict}.**`);
  if (extra.mc && !extra.mc.error) lines.push('', '## Monte Carlo (ערבוב סדר העסקאות)', '', `הון סופי: אחוזון 5 ${$(extra.mc.finalEquity.p5)} · חציון ${$(extra.mc.finalEquity.median)} · אחוזון 95 ${$(extra.mc.finalEquity.p95)}; ירידה מקסימלית חציונית ${P(extra.mc.maxDD.median)}; הסתברות להפסד ${P(extra.mc.probLoss)}.`, '', ...extra.mc.limitations.map((l) => `- ${l}`));
  if (extra.optimize && !extra.optimize.error){ const o = extra.optimize; lines.push('', `## אופטימיזציה (${o.combos} צירופים, יעד: ${o.objective})`, '', `אימון ${o.ranges.train.from}→${o.ranges.train.to} · אימות ${o.ranges.val.from}→${o.ranges.val.to} · מבחן ${o.ranges.test.from}→${o.ranges.test.to}`, '', `נבחר (לפי האימות): \`${JSON.stringify(o.chosen)}\` · במבחן: CAGR ${P(o.test.summary?.cagr)}, Sharpe ${N(o.test.summary?.sharpe)}, ירידה ${P(o.test.summary?.maxDD)}`, '', ...(o.warnings.length ? o.warnings.map((w) => `- ⚠ ${w}`) : ['- אין אזהרות Overfitting'])); }
  if (extra.walk && !extra.walk.error){ const w = extra.walk; lines.push('', `## Walk-Forward (${w.windows.length} חלונות)`, '', `OOS משורשר: CAGR ${P(w.oosMetrics?.cagr)}, ירידה ${P(w.oosMetrics?.maxDD)}, Sharpe ${N(w.oosMetrics?.sharpe)} · ${w.oosPositiveWindows}/${w.windows.length} חלונות חיוביים · ${w.stability.label}${w.warning ? ` · ⚠ ${w.warning}` : ''}`); }
  lines.push('', '## נתונים, כיסוי והנחות', '', `- כיסוי: ${res.coverage.note}${res.coverage.missing?.length ? ` (${res.coverage.missing.length} חסרות)` : ''}`, `- פערים בנרות: ${(res.gaps.ratio * 100).toFixed(2)}% מהנרות הצפויים`, ...res.assumptions.map((x) => `- ${x}`), `- פקודות שלא בוצעו: ${JSON.stringify(res.skipped)}`, '', `_${res.limited ? '**התוצאה מסומנת כמוגבלת** (ראה כיסוי/הנחות).' : 'התוצאה אינה מסומנת כמוגבלת.'}_`);
  return lines.join('\n');
}

async function main(){
  const tpl = arg('--template', ''), specFile = arg('--spec', '');
  let spec = tpl ? byId(tpl)?.spec : specFile ? JSON.parse(readFileSync(specFile, 'utf8')) : null;
  if (!spec) throw new Error('נדרש --template <id> או --spec <file>');
  spec = normalizeSpec({ ...spec, period: { ...(spec.period || {}), from: arg('--from', spec.period?.from || null), to: arg('--to', spec.period?.to || null) } });
  const t0 = Date.now();
  const ds = loadDataset(DATA, { from: spec.period.from, to: spec.period.to, index: spec.universe.index, symbols: spec.universe.type === 'list' ? [...spec.universe.symbols, ...spec.benchmarks, spec.period.regimeSymbol] : null });
  log(`dataset: ${ds.series.size} series, ${ds.n} days, universes=${Object.keys(ds.universes).join(',')} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  const res = simulate(ds, spec, { onProgress: (p) => { if (Math.round(p * 100) % 10 === 0) log(`sim ${Math.round(p * 100)}%`); } });
  if (res.error) throw new Error(res.error);
  const a = analyze(res);
  const extra = { periods: periodBreakdown(res, res.benchmarks.SPY), significance: significance(res), mc: monteCarlo(res.trades, { capital: res.capital }) };
  const params = tpl ? byId(tpl).params : spec.params;
  if (has('--optimize') && params && Object.keys(params).length){ log('optimize…'); extra.optimize = optimize(ds, spec, { params, objective: arg('--objective', 'sharpe'), onProgress: ({ phase, frac }) => { if (Math.round(frac * 100) % 20 === 0) log(`${phase} ${Math.round(frac * 100)}%`); } }); if (extra.optimize.test) delete extra.optimize.test.result; }
  if (has('--walk') && params && Object.keys(params).length){ log('walk-forward…'); extra.walk = walkForward(ds, spec, params, { isYears: +arg('--is', 3), oosYears: +arg('--oos', 1) }); }
  const out = { template: tpl || null, spec, explanation: explainSpec(spec).sections, result: { ...res, signals: res.signals.slice(-250) }, analysis: a, ...extra, runtimeMs: Date.now() - t0, builtAt: ds.meta.builtAt, provider: ds.meta.provider };
  if (OUT){ mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(out)); }
  const report = md(spec, res, a, extra);
  if (MD){ mkdirSync(dirname(MD), { recursive: true }); writeFileSync(MD, report); }
  console.log(report);
}
if (process.argv[1] && process.argv[1].endsWith('lab-run.mjs')) main().catch((e) => { log('::error::' + e.message); process.exit(1); });
