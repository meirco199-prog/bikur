#!/usr/bin/env node
// שער נתונים ל-v1.1: הרכב היסטורי של S&P 400 ו-Russell 2000 מקבצי האחזקות של iShares (IJH, IWM) לפי תאריך. סיכומים בלבד.
const UA = { 'User-Agent': 'Mozilla/5.0', Accept: 'text/csv,*/*' };
const F = { IJH: 'https://www.ishares.com/us/products/239763/ishares-core-sp-midcap-etf/1467271812596.ajax?fileType=csv&fileName=IJH_holdings&dataType=fund', IWM: 'https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/1467271812596.ajax?fileType=csv&fileName=IWM_holdings&dataType=fund' };
const out = {};
for (const [k, u] of Object.entries(F)) for (const d of ['20171229', '20200630', '20221230', '20241231']){
  try { const r = await fetch(`${u}&asOfDate=${d}`, { headers: UA }); const t = await r.text(); const lines = t.split(/\r?\n/); const hdr = lines.findIndex((l) => /^"?Ticker"?,/.test(l)); const rows = hdr >= 0 ? lines.slice(hdr + 1).filter((l) => /^"?[A-Z]/.test(l)) : []; out[k + '_' + d] = { status: r.status, len: t.length, holdings: rows.length, asOf: (t.match(/Fund Holdings as of,?"?([^"\n]+)/) || [])[1], sample: rows.slice(0, 3).map((l) => l.split(',')[0]) }; }
  catch (e){ out[k + '_' + d] = { err: e.message }; }
}
console.log(JSON.stringify(out, null, 1));
