// E2E: טוען כל מסך בדפדפן אמיתי (Chromium), אוסף שגיאות קונסול/עמוד, מפעיל פעולות מרכזיות.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const BASE = process.env.BASE || 'http://localhost:8000/invest/';
const API = process.env.API || 'http://localhost:8787';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium/chrome-linux/chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[page] ${e.message}`));
page.on('requestfailed', (r) => { if (!r.url().includes('sw.js') && r.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(`[req] ${r.url()} ${r.failure()?.errorText}`); });
await page.goto(BASE); await page.evaluate((api) => localStorage.setItem('invest.settings.v1', JSON.stringify({ apiUrl: api, token: 'secret', computeMode: 'auto', theme: 'dark' })), API); await page.reload(); await page.waitForTimeout(500); errors.length = 0;
const results = [];
const check = async (name, hash, mustHave, action) => {
  const before = errors.length;
  await page.goto(BASE + hash); await page.waitForTimeout(600);
  try { await page.waitForFunction(() => !document.querySelector('#main .spin'), null, { timeout: 30000 }); } catch {}
  if (action){ try { await action(); } catch (e) { errors.push(`[${name}] action failed: ${e.message.split('\n')[0]}`); } }
  const text = await page.textContent('#main');
  const missing = mustHave.filter((t) => !text.includes(t));
  const errs = errors.slice(before);
  results.push({ name, ok: !missing.length && !errs.length, missing, errs });
  await page.screenshot({ path: `/tmp/claude-0/-home-user-bikur/4339afcd-f01b-5f35-b439-92a20b519276/scratchpad/shot-${name}.png`, fullPage: false });
};
await check('dashboard', '#/', ['MARKET STATUS', 'TOP OPPORTUNITIES', 'WATCHLIST', 'BUY SIGNALS', 'SELL', 'MARKET RISK', 'ALERTS']);
await check('opportunities', '#/opportunities', ['Best Overall', 'Best Value', 'Best ETF', 'AVOID']);
await check('signals', '#/signals', ['סיגנלים']);
await check('search', '#/search', ['סריקת נכסים', 'AAPL']);
await check('watchlist', '#/watchlist', ['NVDA', 'Opportunity']);
await check('asset', '#/asset/AAPL', ['AAPL', 'Investment Score', 'Risk/Reward', '5 סיבות בעד'], async () => {
  for (const t of ['tech', 'fund', 'val', 'news', 'analyst', 'risk', 'hist']){ await page.click(`#tabs button[data-t="${t}"]`); await page.waitForTimeout(400); }
  await page.waitForFunction(() => document.querySelector('#pc svg') || document.querySelector('#pc .empty'), null, { timeout: 15000 }).catch(() => {});
  await page.click('#tabs button[data-t="tech"]'); await page.waitForTimeout(800);
  const svgs = await page.$$eval('#tab svg', (a) => a.length); if (svgs < 3) errors.push('[asset] price charts not rendered: ' + svgs);
  await page.click('#tabs button[data-t="fund"]'); const f = await page.textContent('#tab'); if (!f.includes('Revenue') || !f.includes('EDGAR')) errors.push('[asset] fundamentals missing');
  await page.click('#tabs button[data-t="news"]'); const n = await page.textContent('#tab'); if (!n.includes('Reuters')) errors.push('[asset] news missing');
  await page.click('#tabs button[data-t="analyst"]'); const an = await page.textContent('#tab'); if (!an.includes('אנליסטים')) errors.push('[asset] analyst missing'); await page.click('#tabs button[data-t="overview"]'); await page.waitForTimeout(300);
});
await check('asset-etf', '#/asset/SPY', ['SPY', 'Investment Score']);
await check('portfolio', '#/portfolio', ['תיק', 'הקצאה', 'Scenario', 'שוק −10%'], async () => { await page.waitForFunction(() => document.querySelector('#scen table'), null, { timeout: 15000 }).catch(() => errors.push('[portfolio] scenarios not rendered')); await page.click('#tabs button[data-p="aggressive"]'); await page.waitForTimeout(500); });
await check('regime', '#/regime', ['Market Regime', 'הכללים', 'Fear & Greed']);
await check('backtest', '#/backtest', ['Backtest'], async () => { await page.fill('#sym', 'AAPL'); await page.selectOption('#strat', 'signal'); await page.click('#go'); await page.waitForFunction(() => !document.querySelector('#out .spin'), null, { timeout: 120000 }); const t = await page.textContent('#out'); for (const k of ['CAGR', 'Sharpe', 'Max Drawdown', 'Walk-Forward', 'תקופות שוק']) if (!t.includes(k)) errors.push('[backtest] missing ' + k); });
await check('asof', '#/asof', ['As-Of'], async () => { await page.fill('#date', '2024-01-02'); await page.selectOption('#scope', 'watch'); await page.click('#go'); await page.waitForFunction(() => !document.querySelector('#out .spin'), null, { timeout: 180000 }); const t = await page.textContent('#out'); for (const k of ['תיקים מומלצים', 'SPY', 'דירוג מלא']) if (!t.includes(k)) errors.push('[asof] missing ' + k); });
await check('asof-single', '#/asof?symbol=AAPL&date=2023-06-01', ['מה קרה בפועל', '12 חודשים']);
await check('paper', '#/paper', ['Paper Trading'], async () => { await page.click('#buy'); await page.fill('.modal #s', 'MSFT'); await page.fill('.modal #q', '5'); await page.click('.modal #ok'); await page.waitForTimeout(1200); const t = await page.textContent('#main'); if (!t.includes('MSFT')) errors.push('[paper] order not shown'); });
await check('alerts', '#/alerts', ['התראות', 'כללים'], async () => { await page.click('#add'); await page.fill('.modal #s', 'AAPL'); await page.selectOption('.modal #t', 'rsi'); await page.click('.modal #ok'); await page.waitForTimeout(800); const t = await page.textContent('#main'); if (!t.includes('RSI')) errors.push('[alerts] rule not shown'); });
await check('assistant', '#/assistant', ['עוזר מחקר'], async () => { await page.fill('#q', 'מה קרה ל-AAPL היום?'); await page.click('#send'); await page.waitForFunction(() => document.querySelectorAll('.msg.ai').length >= 2 && !document.querySelector('.msg.ai .spin'), null, { timeout: 30000 }); const t = await page.textContent('#chat'); if (!t.includes('AAPL')) errors.push('[assistant] no answer'); });
await check('settings', '#/settings', ['הגדרות', 'משקלים', 'stooq'], async () => { await page.click('#localRun'); await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /נשמרו|שגיאה|אין חיבור/.test(t.textContent)), null, { timeout: 240000 }); const t = [...await page.$$eval('.toast', (a) => a.map((x) => x.textContent))].pop(); if (!/נשמרו \d+/.test(t)) errors.push('[settings] local run: ' + t); });
// search box
await page.goto(BASE + '#/'); await page.fill('#searchInput', 'nvd'); await page.waitForTimeout(700); const sr = await page.textContent('#searchResults'); if (!sr.includes('NVDA')) errors.push('[search] no results');
// mobile
await page.setViewportSize({ width: 390, height: 800 }); await page.goto(BASE + '#/'); await page.waitForTimeout(800); await page.click('#menuBtn'); await page.screenshot({ path: '/tmp/claude-0/-home-user-bikur/4339afcd-f01b-5f35-b439-92a20b519276/scratchpad/shot-mobile.png' });
console.log(JSON.stringify(results, null, 1));
console.log('ERRORS:', errors.length); errors.forEach((e) => console.log(' -', e));
await browser.close();
process.exit(errors.length || results.some((r) => !r.ok) ? 1 : 0);
