// אחסון snapshots: שני מסלולים על אותו יום.
//  1. פר-נייר: snap:{day}:{sym} — ה-cron של ה-Worker (יקום הבסיס, ~130), putIfAbsent, עמיד למקביליות.
//  2. מקובץ (shards): snaps:{day}:{i} — 16 מסמכים ליום, כל אחד מחזיק עשרות ניירות. משמש להזרמה מ-GitHub Actions
//     (כל ה-S&P 500 בלילה = ~16 כתיבות KV במקום 500). ה-shard נקבע לפי hash של הסימבול, אז קריאה של נייר בודד = מסמך אחד.
// הקריאה מאוחדת: getSnap/listSnaps מחפשים בשני המסלולים (פר-נייר גובר).
import { stableHash } from '../engine/mechanical.js';

export const SNAP_SHARDS = 16;
export const shardOf = (sym) => stableHash(String(sym).toUpperCase()) % SNAP_SHARDS;
const shardKey = (day, i) => `snaps:${day}:${i}`;

export async function getSnap(db, day, sym){
  if (!day || !sym) return null;
  const direct = await db.get(`snap:${day}:${sym}`);
  if (direct) return direct;
  const sh = await db.get(shardKey(day, shardOf(sym)));
  return sh?.items?.[sym] || null;
}
export async function listSnaps(db, day){
  const out = new Map();
  for (let i = 0; i < SNAP_SHARDS; i++){ const sh = await db.get(shardKey(day, i)); if (sh?.items) for (const [s, v] of Object.entries(sh.items)) out.set(s, v); }
  for (const k of await db.list(`snap:${day}:`)){ const s = await db.get(k); if (s) out.set(k.slice(`snap:${day}:`.length), s); }
  return [...out.values()];
}
export async function shardSymbols(db, day){
  const syms = new Set();
  for (let i = 0; i < SNAP_SHARDS; i++){ const sh = await db.get(shardKey(day, i)); if (sh?.items) for (const s of Object.keys(sh.items)) syms.add(s); }
  return syms;
}
// כתיבה מקובצת: לא דורסים snapshot קיים עם ציון (חוזה ה-snapshots); "חסר" ניתן להחלפה. מחזיר כמה נכתבו ואילו shards עודכנו
export async function putSnapsBatch(db, day, snaps, { source = 'github-actions' } = {}){
  const groups = new Map();
  for (const s of snaps){ const i = shardOf(s.symbol); if (!groups.has(i)) groups.set(i, []); groups.get(i).push(s); }
  let written = 0, skipped = 0; const shards = [];
  for (const [i, arr] of groups){
    const key = shardKey(day, i);
    const sh = (await db.get(key)) || { day, shard: i, items: {} };
    let changed = false;
    for (const s of arr){
      const sym = s.symbol.toUpperCase();
      const ex = sh.items[sym];
      if (ex && !(ex.missing && !s.missing)){ skipped++; continue; }
      sh.items[sym] = { ...s, symbol: sym, date: day, computedBy: source }; written++; changed = true;
    }
    if (changed){ sh.updatedAt = new Date().toISOString(); sh.count = Object.keys(sh.items).length; await db.put(key, sh); shards.push(i); }
  }
  return { written, skipped, shards };
}
