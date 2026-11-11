// בדיקות למנוע הבדיקה לאחור של שיטת הקורס של עמית (engine/amit-course.js) על נתונים סינתטיים
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare, triggers, execute, randomTriggers, grid, keyOf, CANON, CATS, trailingMean, RISK_USD } from '../engine/amit-course.js';

const T0 = Date.UTC(2024, 0, 1);
// מסלול מחירים לפי דקה: מערך של {c, v, l?, h?, o?}
function series(path){
  const n = path.length, m = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n) };
  path.forEach((p, i) => { const prev = i ? path[i - 1].c : p.c; m.t[i] = T0 + i * 60e3; m.o[i] = p.o ?? prev; m.c[i] = p.c; m.h[i] = p.h ?? Math.max(m.o[i], p.c) * 1.0002; m.l[i] = p.l ?? Math.min(m.o[i], p.c) * 0.9998; m.v[i] = p.v ?? 1000; });
  return m;
}
// 3 ימים של דשדוש סביב 100, ירידה לאזור הריזיקה (עוקבים 1.8–3%), נר טריגר עם ווליום, ואז: 'up' חזרה ל-100 / 'down' המשך ל-93
function scenario(kind){
  const p = [];
  for (let i = 0; i < 3 * 1440; i++) p.push({ c: 100 + 0.05 * Math.sin(i / 7) });
  for (let k = 1; k <= 20; k++) p.push({ c: 100 - k * 0.13 });             // → 97.4
  p.push({ o: 97.45, c: 97.3, l: 97.2, h: 97.5, v: 20000 });                 // טריגר: מתחת לחצי האזור (97.6), ווליום ×20
  if (kind === 'up') for (let k = 1; k <= 240; k++) p.push({ c: Math.min(100.5, 97.3 + k * 0.03) });
  else for (let k = 1; k <= 240; k++) p.push({ c: Math.max(93, 97.3 - k * 0.03) });
  for (let k = 0; k < 600; k++) p.push({ c: p.at(-1).c });
  return series(p);
}

test('trailingMean: ממוצע של N הקודמים, בלי הערך הנוכחי', () => {
  const m = trailingMean(Float64Array.from([1, 2, 3, 4, 5]), 2);
  assert.ok(Number.isNaN(m[1])); assert.equal(m[2], 1.5); assert.equal(m[4], 3.5);
});

test('טריגר: עוגן בשפל הדשדוש, כניסה בחצי התחתון של האזור עם ווליום', () => {
  const ctx = prepare(scenario('up')), tg = triggers(ctx, 'follow', CANON);
  assert.equal(tg.length, 1);
  const g = tg[0];
  assert.ok(Math.abs(g.anchor - 99.95) < 0.05, `anchor ${g.anchor}`);
  assert.equal(g.c, 97.3); assert.equal(g.L, 97.2); assert.equal(g.evt, false);
  // בלי ווליום חריג אין טריגר
  assert.equal(triggers(ctx, 'follow', { ...CANON, kv: 50 }).length, 0);
  // רק נר ירוק: נר הטריגר אדום → אין
  assert.equal(triggers(ctx, 'follow', { ...CANON, candle: 'green' }).length, 0);
});

test('תחילת ירידה לא נחשבת דשדוש (העוגן לא יורד עם המחיר)', () => {
  const ctx = prepare(scenario('down')), tg = triggers(ctx, 'follow', CANON);
  assert.ok(tg.length >= 1); assert.ok(tg[0].anchor > 99.8);
});

test('30-60-90 עד הסטופ: הפסד מלא ≈ 1R + עלויות, כל 3 המנות התמלאו', () => {
  const ctx = prepare(scenario('down')), tg = triggers(ctx, 'follow', CANON), [tr] = execute(ctx, tg.slice(0, 1), { coin: 'AVAX', entry: 'ladder', exit: 'course' });
  assert.equal(tr.fills, 3); assert.equal(tr.why, 'סטופ');
  assert.ok(Math.abs(tr.gross + RISK_USD) < 8, `gross ${tr.gross}`);
  assert.ok(tr.fees > 0 && tr.spread > 0 && tr.slip > 0);
});

test('חזרה למעלה: רק המנה הראשונה בפנים — רווח, יציאה ביעד', () => {
  const ctx = prepare(scenario('up')), tg = triggers(ctx, 'follow', CANON), [tr] = execute(ctx, tg, { coin: 'AVAX', entry: 'ladder', exit: 'course' });
  assert.equal(tr.fills, 1); assert.ok(tr.gross > 0); assert.match(tr.why, /יעד/);
  // כניסה אחת (כל הסכום): אותו מהלך, רווח גדול יותר
  const [one] = execute(ctx, tg, { coin: 'AVAX', entry: 'single', exit: 'course' });
  assert.ok(one.gross > tr.gross * 2);
});

test('הסטופ: עוד stopExtra מתחת לקו ההנזלה העמוק (2.8% מתחת לשפל הטריגר בעוקבים)', () => {
  const c = CATS.follow; assert.equal(c.flush[1] + c.stopExtra, 2.8);
  assert.deepEqual(CATS.vol.next.zone, [7, 9]); assert.equal(CATS.vol.next.stopExtra, 2.8);
});

test('קבוצת ביקורת אקראית: אותו מספר טריגרים, ממוינים, דטרמיניסטי', () => {
  const ctx = prepare(scenario('up')), tg = triggers(ctx, 'follow', CANON);
  const a = randomTriggers(ctx, tg, 3), b = randomTriggers(ctx, tg, 3);
  assert.equal(a.length, tg.length); assert.deepEqual(a.map((x) => x.i), b.map((x) => x.i));
  assert.ok(Math.abs(a[0].L / a[0].c - tg[0].L / tg[0].c) < 1e-12);
});

test('רשת: 128 גרסאות ייחודיות, כולל הגרסה הנאמנה', () => {
  const g = grid(); assert.equal(g.length, 128); assert.equal(new Set(g.map(keyOf)).size, 128);
  assert.ok(g.some((v) => keyOf(v) === keyOf(CANON)));
});

test('סטופ צמוד ויעד קבוע: כניסה אחת, סטופ 1% מתחת לכניסה, יעד +1%', () => {
  const ctxD = prepare(scenario('down')), tgD = triggers(ctxD, 'follow', CANON);
  const [lo] = execute(ctxD, tgD.slice(0, 1), { coin: 'AVAX', entry: 'single', exit: 1, stop: 1 });
  assert.equal(lo.why, 'סטופ'); assert.ok(Math.abs(lo.gross + RISK_USD) < 8, `gross ${lo.gross}`);
  assert.ok(Math.abs(lo.notional - RISK_USD / 0.01) < 1);           // 1% סטופ → 40,000$ נומינלי ל-400$ סיכון
  const ctxU = prepare(scenario('up')), tgU = triggers(ctxU, 'follow', CANON);
  const [hi] = execute(ctxU, tgU, { coin: 'AVAX', entry: 'single', exit: 1, stop: 1 });
  assert.equal(hi.why, 'יעד'); assert.ok(Math.abs(hi.gross - hi.notional * 0.01) < 1, `gross ${hi.gross}`);
});

test("כניסה 'deep': רק בהנזלה; המחיר קפץ בלי לרדת → אין עסקה, המחיר ירד → מתמלא", () => {
  const ctxU = prepare(scenario('up')), tgU = triggers(ctxU, 'follow', CANON);
  assert.equal(execute(ctxU, tgU, { coin: 'AVAX', entry: 'deep', exit: 'course' }).length, 0);
  const ctxD = prepare(scenario('down')), tgD = triggers(ctxD, 'follow', CANON), [tr] = execute(ctxD, tgD.slice(0, 1), { coin: 'AVAX', entry: 'deep', exit: 'course' });
  assert.equal(tr.fills, 2); assert.ok(tr.tEntry > tgD[0].t);
});

test("טריגר 'reclaim': רק אחרי ירידה מתחת לאזור וחזרה בנר ירוק", () => {
  const p = [];
  for (let i = 0; i < 3 * 1440; i++) p.push({ c: 100 + 0.05 * Math.sin(i / 7) });
  for (let k = 1; k <= 30; k++) p.push({ c: 100 - k * 0.12 });               // → 96.4: מתחת לתחתית האזור (96.95) ולהנזלה הראשונה (96.56)
  p.push({ o: 96.4, c: 97.3, l: 96.35, h: 97.35, v: 20000 });                   // נר ירוק חוזר לאזור עם ווליום
  for (let k = 0; k < 600; k++) p.push({ c: 97.3 + Math.min(2, k * 0.01) });
  const ctx = prepare(series(p)), tg = triggers(ctx, 'follow', { ...CANON, candle: 'reclaim' });
  assert.equal(tg.length, 1); assert.equal(tg[0].c, 97.3);
  assert.equal(triggers(prepare(scenario('up')), 'follow', { ...CANON, candle: 'reclaim' }).length, 0); // בלי ירידה מתחת לאזור
});

// ירידה שממלאת את כל 3 המנות (עד 95.7), חזרה קצרה מעל הממוצע (96.7, מתחת ליעד), ואז המשך ירידה לסטופ
function dipScenario(){
  const p = [];
  for (let i = 0; i < 3 * 1440; i++) p.push({ c: 100 + 0.05 * Math.sin(i / 7) });
  for (let k = 1; k <= 20; k++) p.push({ c: 100 - k * 0.13 });
  p.push({ o: 97.45, c: 97.3, l: 97.2, h: 97.5, v: 20000 });
  for (let k = 1; k <= 53; k++) p.push({ c: 97.3 - k * 0.03 });              // → 95.71: המנות 60 (96.81) ו-90 (95.84) מתמלאות
  for (let k = 1; k <= 33; k++) p.push({ c: 95.71 + k * 0.03 });             // → 96.7
  for (let k = 1; k <= 140; k++) p.push({ c: Math.max(93, 96.7 - k * 0.03) }); // → 93: הסטופ (94.48)
  for (let k = 0; k < 600; k++) p.push({ c: p.at(-1).c });
  return series(p);
}

test('מילוי מלא (בקשת מאיר 11/11): בלי כלל → הפסד מלא; יציאה בממוצע / סטופ צמוד אחרי המנה השלישית / זמן → הפסד קטן', () => {
  const ctx = prepare(dipScenario()), tg = triggers(ctx, 'follow', CANON).slice(0, 1), o = { coin: 'AVAX', entry: 'ladder', exit: 'course' };
  const [base] = execute(ctx, tg, o);
  assert.equal(base.fills, 3); assert.equal(base.why, 'סטופ'); assert.ok(Math.abs(base.gross + RISK_USD) < 8, `gross ${base.gross}`);
  const [be] = execute(ctx, tg, { ...o, full: { be: 0 } });
  assert.equal(be.fills, 3); assert.equal(be.why, 'יציאה בממוצע'); assert.ok(Math.abs(be.gross) < 1, `gross ${be.gross}`);
  const [sl] = execute(ctx, tg, { ...o, full: { sl: 0.3 } });
  assert.equal(sl.why, 'סטופ'); assert.ok(sl.gross < -100 && sl.gross > -250, `gross ${sl.gross}`);
  const [tm] = execute(ctx, tg, { ...o, full: { min: 30 } });
  assert.equal(tm.why, 'זמן אחרי מילוי מלא'); assert.ok(tm.gross > base.gross);
  assert.ok(tm.tExit - tm.tEntry >= 30 * 60e3);
});

test('משקלות: בלי המנה השלישית → 2 מילויים, הגודל עדיין לפי הפסד מלא = 1R; ברירת המחדל לא משתנה', () => {
  const ctx = prepare(scenario('down')), tg = triggers(ctx, 'follow', CANON).slice(0, 1), o = { coin: 'AVAX', entry: 'ladder', exit: 'course' };
  const [two] = execute(ctx, tg, { ...o, weights: [1 / 3, 2 / 3, 0] });
  assert.equal(two.fills, 2); assert.ok(Math.abs(two.gross + RISK_USD) < 8, `gross ${two.gross}`);
  const [a] = execute(ctx, tg, o), [b] = execute(ctx, tg, { ...o, weights: [1 / 6, 1 / 3, 1 / 2] });
  assert.equal(a.gross, b.gross); assert.equal(a.notional, b.notional);
});

test('מנה שלישית רק אחרי אישור (confirm3): ירידה ישרה → בלי השלישית, הפסד קטן מ-1R; חזרה מעל הקו → נקנית בשוק', () => {
  const o = { coin: 'AVAX', entry: 'ladder', exit: 'course' };
  const ctxD = prepare(scenario('down')), tgD = triggers(ctxD, 'follow', CANON).slice(0, 1), [d] = execute(ctxD, tgD, { ...o, confirm3: 4 });
  assert.equal(d.fills, 2); assert.equal(d.why, 'סטופ'); assert.ok(d.gross > -320 && d.gross < -200, `gross ${d.gross}`);
  const ctx = prepare(dipScenario()), tg = triggers(ctx, 'follow', CANON).slice(0, 1), [a] = execute(ctx, tg, { ...o, confirm3: 4 }), [base] = execute(ctx, tg, o);
  assert.equal(a.fills, 3); assert.ok(a.notional > 0 && Math.abs(a.notional - base.notional) < 1);
});

test('סטופ לפי ATR: k × ATR(14) של 15 דק׳ מתחת למנה האחרונה; הגודל לפי הפסד מלא', () => {
  const ctx = prepare(scenario('down')), tg = triggers(ctx, 'follow', CANON).slice(0, 1);
  assert.ok(ctx.q.atr14[ctx.idx15[tg[0].i] - 1] > 0);
  const [a] = execute(ctx, tg, { coin: 'AVAX', entry: 'ladder', exit: 'course', stopAtr: 2 });
  assert.equal(a.why, 'סטופ'); assert.ok(a.gross < 0 && a.gross > -RISK_USD - 10, `gross ${a.gross}`);
});
