// מעבדה — צינור הנתונים: פורמט הקבצים (manifest + universe + shards לפי עשור) → loadDataset → simulate, ו-lab-run ללא דפדפן.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { rowsToCompact, mergeCompact, dayNum, isoOf, membershipFromDaily } from '../engine/lab/data.js';
import { loadDataset } from '../scripts/lab-run.mjs';
import { simulate } from '../engine/lab/simulate.js';
import { syntheticRows } from './helpers.mjs';

function writeSynthetic(dir, { n = 2600, syms = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF'] } = {}){
  mkdirSync(join(dir, 'bars'), { recursive: true }); mkdirSync(join(dir, 'universe'), { recursive: true });
  const manifest = { version: 1, builtAt: '2026-11-08T00:00:00Z', provider: 'synthetic', from: '2014-01-01', universes: { sp500: { pointInTime: true } }, symbols: {}, missing: ['GONE'], sectors: {}, notes: [] };
  const all = [...syms, 'SPY'];
  all.forEach((s, i) => {
    const c = rowsToCompact(s, syntheticRows({ n, start: '2014-01-02', seed: i + 1, price: 50 + i * 10 }), { meta: { sector: i % 2 ? 'Tech' : 'Energy' } });
    const groups = new Map(); c.d.forEach((day, j) => { const dec = Math.floor(new Date(day * 86400000).getUTCFullYear() / 10) * 10; if (!groups.has(dec)) groups.set(dec, []); groups.get(dec).push(j); });
    manifest.symbols[s] = { from: isoOf(c.d[0]), to: isoOf(c.d[c.d.length - 1]), n: c.d.length, sector: c.meta.sector, decades: [] };
    for (const [dec, idx] of groups){ const part = { s, d: idx.map((j) => c.d[j]), o: idx.map((j) => c.o[j]), h: idx.map((j) => c.h[j]), l: idx.map((j) => c.l[j]), c: idx.map((j) => c.c[j]), v: idx.map((j) => c.v[j]), a: idx.map((j) => c.a[j]), div: [], split: [], meta: c.meta }; writeFileSync(join(dir, 'bars', `${s}.${dec}.json`), JSON.stringify(part)); manifest.symbols[s].decades.push(dec); }
    manifest.sectors[s] = c.meta.sector;
  });
  // חברות: GONE חבר עד 2016 בלי נתונים; FFF מצטרף רק ב-2020
  const u = membershipFromDaily([{ day: '2014-01-02', symbols: [...syms.slice(0, 5), 'GONE'] }, { day: '2016-06-01', symbols: syms.slice(0, 5) }, { day: '2020-01-02', symbols: syms }]);
  writeFileSync(join(dir, 'universe', 'sp500.json'), JSON.stringify({ id: 'sp500', pointInTime: true, ...u }));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}

test('loadDataset: טוען רק את העשורים הדרושים, מאחד shards, מכיר ביקום וב-SPY כלוח שנה; coverage מונה את GONE', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lab-')); writeSynthetic(dir);
  const ds = loadDataset(dir, { from: '2021-01-01', to: '2023-12-31' });
  assert.equal(ds.series.size, 7); assert.ok(ds.universes.sp500 && ds.universe.pointInTime);
  const spy = ds.series.get('SPY'); assert.ok(isoOf(spy.from) < '2021-01-01' && isoOf(spy.from) >= '2019-11-01', 'חימום ~400 יום'); assert.ok(isoOf(spy.to) <= '2023-12-31');
  const full = loadDataset(dir, {}); assert.ok(full.series.get('AAA').n > 2500, 'איחוד שני עשורים');
  const cov = full.coverage(); assert.deepEqual(cov.missing, ['GONE']); assert.equal(cov.total, 7);
  const r = simulate(ds, { universe: { type: 'index', index: 'sp500', filters: { minDollarVol: 0, minPrice: 0 } }, signal: { rank: { feature: 'ret', params: { days: 1 }, order: 'asc', top: 2 } }, exit: { rules: [{ type: 'time', days: 1 }] }, sizing: { capital: 20000, maxPositions: 2 } });
  assert.ok(!r.error && r.trades.length > 100 && r.from >= '2021-01-01');
  assert.ok(r.trades.some((t) => t.symbol === 'FFF'), 'FFF חבר מ-2020');
  const r2 = simulate(full, { universe: { type: 'index', index: 'sp500', filters: { minDollarVol: 0, minPrice: 0 } }, period: { from: '2015-01-01', to: '2015-12-31' }, signal: { rank: { feature: 'ret', params: { days: 1 }, order: 'asc', top: 2 } }, exit: { rules: [{ type: 'time', days: 1 }] }, sizing: { capital: 20000, maxPositions: 2 } });
  assert.ok(!r2.trades.some((t) => t.symbol === 'FFF'), 'FFF לא במדד ב-2015');
  const blocked = simulate(full, { universe: { type: 'index', index: 'nasdaq100' }, signal: { rank: { feature: 'ret', params: { days: 1 }, order: 'asc', top: 2 } } });
  assert.ok(blocked.blocked && /nasdaq100/.test(blocked.error));
});

test('lab-run.mjs: הרצה ללא דפדפן כותבת JSON + דוח Markdown בעברית עם כיסוי והנחות', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lab-')); writeSynthetic(dir, { n: 1300 });
  const out = join(dir, 'results', 'x.json'), md = join(dir, 'results', 'x.md');
  const stdout = execFileSync(process.execPath, ['invest-api/scripts/lab-run.mjs', '--data', dir, '--template', 'top10-losers-1d', '--out', out, '--md', md], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.ok(existsSync(out) && existsSync(md));
  const j = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(j.template, 'top10-losers-1d'); assert.ok(j.analysis.series.cagr !== undefined && j.result.trades.length > 0 && j.explanation.length === 7 && j.significance && j.mc);
  assert.match(stdout, /## תוצאה/); assert.match(stdout, /GONE|חסרות|כיסוי/); assert.match(stdout, /Backtest אינו תחזית/);
});

test('mergeCompact: shards לא ממוינים מתאחדים לפי זמן', () => {
  const a = { s: 'X', d: [10, 11], o: [1, 1], h: [1, 1], l: [1, 1], c: [1, 1], v: [1, 1], a: [1, 1], div: [[11, 0.1]], split: [] }, b = { s: 'X', d: [1, 2], o: [2, 2], h: [2, 2], l: [2, 2], c: [2, 2], v: [2, 2], a: [2, 2], div: [], split: [[2, 2]] };
  const m = mergeCompact([a, b]); assert.deepEqual(m.d, [1, 2, 10, 11]); assert.deepEqual(m.o, [2, 2, 1, 1]); assert.equal(m.div.length, 1); assert.equal(m.split.length, 1); assert.equal(mergeCompact([null]), null);
});

test('parseMembershipCsv: קובץ fja05680 ללא הנחה על שמות עמודות (date,tickers / Date,Tickers / סדר הפוך) → מרווחי חברות', async () => {
  const { parseMembershipCsv } = await import('../scripts/lab-data.mjs');
  const syms = Array.from({ length: 320 }, (_, i) => 'S' + i).join(',');
  const a = parseMembershipCsv(`date,tickers\n1996-01-02,"${syms}"\n1996-01-03,"${syms},NEW"\n`);
  assert.equal(a.length, 2); assert.equal(a[0].day, '1996-01-02'); assert.equal(a[0].symbols.length, 320); assert.ok(a[1].symbols.includes('NEW'));
  const b = parseMembershipCsv(`Tickers,Date\n"${syms}",2001-05-05 00:00:00\n`); assert.equal(b[0].day, '2001-05-05'); assert.equal(b[0].symbols.length, 320);
  assert.deepEqual(parseMembershipCsv('date,tickers\n2001-01-01,"A,B"\n'), [], 'שורה עם פחות מ-300 סימבולים נפסלת'); assert.deepEqual(parseMembershipCsv(null), []);
  const m = membershipFromDaily(a); assert.deepEqual(m.members.NEW, [[dayNum('1996-01-03'), null]]);
});
