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
