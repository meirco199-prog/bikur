// לוגיקת התזכורת לשיעור — ב-service worker (מורץ ב-vm) ובשרת ה-push (import) — עם שעונים מזויפים.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../..', import.meta.url));

const src = fs.readFileSync(root + 'english/sw.js', 'utf8');
const ctx = vm.createContext({ self: { addEventListener(){}, registration: {}, clients: {} }, caches: { open: async () => ({ addAll(){} }) }, indexedDB: {}, console, Promise, Date, String, parseInt, JSON, Uint8Array });
vm.runInContext(src + '\nself.__lessonDue = lessonDue;', ctx);
const swDue = (st, d) => ctx.self.__lessonDue(st, d);
const st = { enabled: true, lesson: { weekday: 2, time: '19:30', title: 'Sarah · Lesson 2' } };
const tue = (h, m) => new Date(2026, 8, 29, h, m); // יום שלישי

test('service worker: lesson reminder window and guards', () => {
  assert.equal(swDue(st, tue(19, 21)), true, '9 min before');
  assert.equal(swDue(st, tue(19, 50)), true, '20 min after, still in window');
  assert.equal(swDue(st, tue(19, 14)), false, '15 min before: not yet');
  assert.equal(swDue(st, new Date(2026, 8, 30, 19, 25)), false, 'other weekday');
  assert.equal(swDue({ ...st, enabled: false }, tue(19, 21)), false, 'notifications off');
  assert.equal(swDue({ ...st, lessonNotifiedOn: '2026-09-29' }, tue(19, 21)), false, 'once per day');
  assert.equal(swDue({ enabled: true }, tue(19, 21)), false, 'no schedule');
});

const { lessonDue } = await import('../../../english-push/worker.js');
const rec = { endpoint: 'https://push.example/x', enabled: true, tz: -180, lesson: { weekday: 2, time: '19:30' } };
test('push server: lesson due computed in the client time zone, once per local day', () => {
  const at = Date.UTC(2026, 8, 29, 16, 21); // 19:21 בישראל (קיץ, tz=-180)
  assert.equal(lessonDue(rec, at), true);
  assert.equal(lessonDue({ ...rec, tz: 0 }, at), false, 'same instant is 16:21 for a UTC client');
  assert.equal(lessonDue({ ...rec, tz: 0 }, Date.UTC(2026, 8, 29, 19, 25)), true);
  assert.equal(lessonDue(rec, Date.UTC(2026, 8, 29, 16, 55)), false, '25 min after: outside window');
  assert.equal(lessonDue({ ...rec, lessonNotifiedOn: '2026-09-29' }, at), false);
  assert.equal(lessonDue({ ...rec, lesson: { weekday: 0, time: '00:35' } }, Date.UTC(2026, 9, 3, 21, 30)), true, 'weekday in local time');
});
