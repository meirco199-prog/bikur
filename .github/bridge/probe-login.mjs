// בדיקה (בלי פרטי כניסה): מה יש בדף הכניסה של IBKR שה-Client Portal Gateway מגיש — האם יש מתג Live/Paper, אילו שדות וכפתורים.
// רץ על ה-runner של GitHub עם Playwright. מדפיס טקסט בלבד. שימוש: node .github/bridge/probe-login.mjs [url]
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://www.interactivebrokers.com/sso/Login?forwardTo=22&RL=1&ip2loc=on';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.setDefaultTimeout(30000);
await page.goto(url, { waitUntil: 'networkidle' }).catch((e) => console.log('goto:', e.message));
await page.waitForTimeout(4000);
console.log('URL:', page.url());
console.log('TITLE:', await page.title());
const info = await page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const txt = (el) => (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const attrs = (el) => ['id', 'name', 'type', 'role', 'aria-label', 'aria-checked', 'data-testid', 'class'].map((a) => el.getAttribute(a) ? `${a}=${el.getAttribute(a).slice(0, 60)}` : '').filter(Boolean).join(' ');
  return {
    inputs: [...document.querySelectorAll('input,select,textarea')].map((el) => `${attrs(el)} | placeholder=${el.getAttribute('placeholder') || ''} | visible=${vis(el)}`),
    buttons: [...document.querySelectorAll('button,a,[role=button],[role=switch],[role=tab],label,.toggle,.switch')].filter(vis).map((el) => `${el.tagName} "${txt(el)}" | ${attrs(el)}`).filter((s) => s.length > 8).slice(0, 80),
    paper: [...document.querySelectorAll('*')].filter((el) => /paper/i.test(el.textContent || '') && el.children.length === 0).map((el) => `${el.tagName} "${txt(el)}" | ${attrs(el)} | visible=${vis(el)}`).slice(0, 20),
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 1500),
  };
});
console.log('\n--- INPUTS'); info.inputs.forEach((s) => console.log(' ', s));
console.log('\n--- BUTTONS/SWITCHES'); info.buttons.forEach((s) => console.log(' ', s));
console.log('\n--- ELEMENTS MENTIONING "paper"'); info.paper.forEach((s) => console.log(' ', s));
console.log('\n--- PAGE TEXT'); console.log(info.text);
await browser.close();
