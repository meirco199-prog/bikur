// תיק בסיס 70/30 על לוח משותף (engine/base-vt.js) + runDaily עם rebal/partial: אותם מועדי איזון, בלי הצצה לעתיד, יעד תנודתיות
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseStrat, isMonthEnd, isSunday, VT_PASS } from '../engine/base-vt.js';
import { align, runDaily } from '../engine/research-daily.js';

const D0 = Date.UTC(2020, 0, 1), DAY = 86400e3;
const bars = (f, n = 700) => Array.from({ length: n }, (_, i) => { const c = f(i), o = i ? f(i - 1) : c; return { t: D0 + i * DAY, o, h: Math.max(o, c), l: Math.min(o, c), c }; });
const fb = (i) => 100 * (1 + 0.0015 * i) * (1 + 0.25 * Math.sin(i / 60)) * (1 + 0.03 * Math.sin(i * 1.7)), fe = (i) => 50 * (1 + 0.001 * i) * (1 + 0.3 * Math.sin(i / 45 + 1)) * (1 + 0.05 * Math.sin(i * 2.3));
const mkA = (gb = fb, ge = fe) => align({ BTC: bars(gb), ETH: bars(ge) });
const run = (A, o) => runDaily(A, baseStrat(A, o), { drift: true, rebal: baseStrat(A, o).rebal, partial: true, trace: true }).series;

test('אותם מועדי איזון: פסיבי וממוצע 200 מאוזנים לחלוטין בדיוק באותם ימים (סוף חודש → פתיחת היום הראשון), ושבועי — ביום שני', () => {
  const A = mkA(), p = run(A, { kind: 'passive' }), s = run(A, { kind: 'sma', n: 200 });
  const rp = p.filter((x) => x.reb).map((x) => x.t), rs = s.filter((x) => x.reb).map((x) => x.t);
  assert.deepEqual(rp, rs); assert.ok(rp.length > 15);
  for (const t of rp) assert.equal(new Date(t).getUTCDate(), 1, 'ביצוע ביום הראשון בחודש');
  const w = run(A, { kind: 'passive', rebal: 'week' }).filter((x) => x.reb); assert.ok(w.every((x) => new Date(x.t).getUTCDay() === 1));
  // בפסיבי: אחרי יום איזון המשקלות חוזרים ל-70/30 בדיוק
  for (const x of p.filter((y) => y.reb)) { assert.ok(Math.abs(x.w[0] - 0.7) < 1e-12 && Math.abs(x.w[1] - 0.3) < 1e-12); }
  assert.ok(isMonthEnd(Date.UTC(2020, 0, 31)) && !isMonthEnd(Date.UTC(2020, 0, 30)) && isSunday(Date.UTC(2020, 0, 5)));
});

test('בלי הצצה לעתיד: שינוי המחירים אחרי יום T לא משנה אף משקל ואף תשואה עד T (כל הגרסאות)', () => {
  const T = 450, A1 = mkA(), A2 = mkA((i) => (i <= T ? fb(i) : fb(i) * 2.5), (i) => (i <= T ? fe(i) : fe(i) * 0.3));
  for (const o of [{ kind: 'passive' }, { n: 200 }, { n: 200, slope: 20 }, { n: 200, vt: 0.35, rebal: 'week' }, { n: 150, vt: 0.3, rebal: 'week' }]){
    const s1 = run(A1, o), s2 = run(A2, o), k = s1.findIndex((x) => x.t === A1.days[T]);
    // ביום T ההחלטה מבוססת על T−1 (משקל) והתשואה על פתיחה→סגירה של T, שזהים; אחרי T — מותר להשתנות
    assert.deepEqual(s1.slice(0, k + 1).map((x) => x.w), s2.slice(0, k + 1).map((x) => x.w), JSON.stringify(o));
    assert.deepEqual(s1.slice(0, k + 1).map((x) => x.net), s2.slice(0, k + 1).map((x) => x.net));
  }
});

test('partial: מעבר של מטבע אחד למזומן לא נוגע במטבע השני; יעד תנודתיות מקטין חשיפה ולא עובר 100%', () => {
  const A = mkA((i) => 100 * 1.002 ** i, (i) => (i < 400 ? 50 * 1.002 ** i : 50 * 1.002 ** 400 * 0.99 ** (i - 400)));
  const s = run(A, { n: 200 }); const k = s.findIndex((x, i) => i > 0 && x.w[1] === 0 && s[i - 1].w[1] > 0);
  assert.ok(k > 0, 'אתריום יצא'); if (!s[k].reb) assert.ok(Math.abs(s[k].w[0] - s[k - 1].w[0] * 1) < 0.01, 'ביטקוין לא אוזן ביום היציאה של אתריום');
  const v = run(mkA(), { n: 200, vt: 0.35, rebal: 'week' }); assert.ok(v.every((x) => x.w[0] + x.w[1] <= 1 + 1e-9));
  assert.ok(v.some((x) => x.w[0] + x.w[1] > 0 && x.w[0] + x.w[1] < 0.99), 'הקטנה בפועל');
  assert.equal(VT_PASS.maxDD, 0.35);
});
