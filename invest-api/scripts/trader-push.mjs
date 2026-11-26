#!/usr/bin/env node
// העברה שעתית מ-IBKR לעוזר המסחר (invest/docs/TRADER.md) — חלופה למפתחות Flex. קריאה בלבד.
//   על השרת (install.sh):  --keygen <file>   יוצר מפתח פרטי אם אין, ומדפיס את המפתח הציבורי (לא סודי)
//   במשימה השעתית:          --pub <b64> --dir <dir>   קורא מ-<dir> את הפלט של כלי IBKR (pr-positions.json, pr-summary.json, pr-trades.json,
//                           ואותו דבר עם co-), בונה תמונת מצב בלי מספרי חשבון, ומדפיס אותה מוצפנת (שורה אחת) + סיכום ל-stderr
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { snapshotFromConnector } from '../engine/trader.js';
import { keygen, publicKeyOf, encrypt } from '../engine/trader-push.js';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
if (arg('--keygen')){
  const f = arg('--keygen');
  if (!existsSync(f)){ writeFileSync(f, keygen(), { mode: 0o640 }); chmodSync(f, 0o640); }
  console.log(publicKeyOf(readFileSync(f, 'utf8'))); process.exit(0);
}
const pub = arg('--pub'), dir = arg('--dir');
if (!pub || !dir){ console.error('שימוש: --pub <מפתח ציבורי> --dir <תיקייה>'); process.exit(2); }
const rd = (n) => { const f = join(dir, n); if (!existsSync(f)) return null; const s = readFileSync(f, 'utf8').trim(); return s ? JSON.parse(s) : null; };
const raw = {};
for (const [id, p] of [['PR', 'pr'], ['CO', 'co']]){ const r = { positions: rd(`${p}-positions.json`), summary: rd(`${p}-summary.json`), trades: rd(`${p}-trades.json`) }; if (r.positions || r.summary) raw[id] = r; }
if (!Object.keys(raw).length){ console.error('אין קבצים'); process.exit(1); }
const snap = snapshotFromConnector(raw, Math.floor(Date.now() / 1000));
for (const [id, A] of Object.entries(snap.accounts)) console.error(`${id}: ${A.positions.length} פוזיציות, ${snap.trades.filter((t) => t.acct === id).length} ביצועים, שער דולר ${A.usdRate ? 'ידוע' : 'לא ידוע'}`);
console.log(encrypt(snap, pub));
