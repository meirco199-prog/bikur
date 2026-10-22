import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastSessionClose, pricesCoverLastSession } from '../engine/session.js';
import { cached } from '../lib/cache.js';

test('סשן אחרון שנסגר: לפני 16:00 ET → אתמול; אחרי → היום; סוף שבוע → שישי; שעון חורף', () => {
  assert.equal(lastSessionClose(new Date('2026-09-18T04:00:00Z')).date, '2026-09-17'); // 00:00 ET חמישי
  assert.equal(lastSessionClose(new Date('2026-09-17T19:30:00Z')).date, '2026-09-16'); // 15:30 ET — עוד לא נסגר
  assert.equal(lastSessionClose(new Date('2026-09-17T20:01:00Z')).date, '2026-09-17');
  assert.equal(new Date(lastSessionClose(new Date('2026-09-17T20:01:00Z')).closeMs).toISOString(), '2026-09-17T20:00:00.000Z');
  assert.equal(lastSessionClose(new Date('2026-09-19T15:00:00Z')).date, '2026-09-18'); // שבת
  assert.equal(lastSessionClose(new Date('2026-09-21T12:00:00Z')).date, '2026-09-18'); // שני בבוקר
  assert.equal(new Date(lastSessionClose(new Date('2026-01-15T22:00:00Z')).closeMs).toISOString(), '2026-01-15T21:00:00.000Z'); // EST
  assert.equal(pricesCoverLastSession([['2026-09-16', 1, 1, 1, 1, 0]], null, new Date('2026-09-18T04:00:00Z')), false);
  assert.equal(pricesCoverLastSession([['2026-09-17', 1, 1, 1, 1, 0]], null, new Date('2026-09-18T04:00:00Z')), true);
  assert.equal(pricesCoverLastSession([], null), false);
});

test('סדרה שנמשכה לפני הסגירה: השורה של היום היא בר חלקי — לא מכסה את הסשן עד רענון אחרי 16:00 ET', () => {
  const now = new Date('2026-10-22T06:18:00Z'); // 02:18 ET חמישי → הסשן האחרון 21/10, נסגר 20:00Z
  const rows = [['2026-10-20', 1, 1, 1, 1, 0], ['2026-10-21', 1, 1, 1, 1, 0]];
  assert.equal(pricesCoverLastSession(rows, '2026-10-21T18:58:00Z', now), false); // 14:58 ET — בר חלקי
  assert.equal(pricesCoverLastSession(rows, '2026-10-21T20:14:00Z', now), true);  // אחרי הסגירה
  assert.equal(pricesCoverLastSession(rows, null, now), true);                    // בלי חותמת — כמו קודם
  // במהלך הסשן של 22/10 (S=21/10): סדרה שכבר כוללת בר של היום נמשכה אחרי סגירת 21/10 — השורה של 21/10 סופית
  assert.equal(pricesCoverLastSession([...rows, ['2026-10-22', 1, 1, 1, 1, 0]], '2026-10-22T14:00:00Z', new Date('2026-10-22T15:00:00Z')), true);
});

test('מטמון: staleIf מפקיע לפני ה-TTL; בלי staleIf — TTL בלבד', async () => {
  const store = new Map();
  const db = { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => { store.set(k, JSON.stringify(v)); } };
  let fetches = 0;
  const fetcher = async () => { fetches++; return { rows: [['2026-09-17', 1, 1, 1, 5, 0]] }; };
  await cached(db, 'px:X', 3600, fetcher); assert.equal(fetches, 1);
  await cached(db, 'px:X', 3600, fetcher); assert.equal(fetches, 1); // בתוקף
  const r = await cached(db, 'px:X', 3600, fetcher, { staleIf: () => true }); assert.equal(fetches, 2); assert.equal(r.stale, false);
  await cached(db, 'px:X', 3600, fetcher, { staleIf: (ex, age) => age > 100 }); assert.equal(fetches, 2); // צעיר מדי לפקיעה
});
