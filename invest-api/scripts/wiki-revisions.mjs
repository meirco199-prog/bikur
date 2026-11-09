#!/usr/bin/env node
// גרסאות היסטוריות של עמודי ויקיפדיה ("איך הדף נראה בתאריך X") — מקור להרכב מדדים לפי נקודת זמן כשאין טבלת שינויים.
// revisionAt(title, iso): הגרסה האחרונה של הדף לפני התאריך (או null). revisionHtml(revid): ה-HTML המעובד של הגרסה.
// CLI (לפיתוח המפענח): node wiki-revisions.mjs --dump DIR --titles A,B --dates 2008-01-01,2012-01-01
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { get, sleep, log } from './losers-common.mjs';

const API = 'https://en.wikipedia.org/w/api.php';
export async function revisionAt(title, iso){
  const u = `${API}?action=query&format=json&formatversion=2&prop=revisions&rvprop=ids%7Ctimestamp%7Csize&rvlimit=1&rvdir=older&rvstart=${iso}T00:00:00Z&titles=${encodeURIComponent(title)}`;
  try { const p = JSON.parse(await get(u)).query.pages[0], r = p?.revisions?.[0]; return r ? { title, revid: r.revid, ts: r.timestamp, size: r.size } : null; } catch { return null; }
}
export async function revisionHtml(revid){
  try { return JSON.parse(await get(`${API}?action=parse&format=json&formatversion=2&prop=text&oldid=${revid}`)).parse.text; } catch { return null; }
}

async function main(){
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const dir = arg('--dump', 'wiki-dump'), titles = arg('--titles', 'NASDAQ-100').split(','), dates = arg('--dates', '2010-01-01').split(',');
  mkdirSync(dir, { recursive: true });
  for (const t of titles) for (const d of dates){
    const r = await revisionAt(t, d); if (!r){ log(`${t} @ ${d}: none`); continue; }
    const h = await revisionHtml(r.revid); log(`${t} @ ${d}: rev ${r.revid} ${r.ts} size ${r.size} html ${h?.length ?? 0}`);
    if (h) writeFileSync(`${dir}/${t.replace(/[^\w-]/g, '_')}_${d}_${r.revid}.html`, h);
    await sleep(300);
  }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
