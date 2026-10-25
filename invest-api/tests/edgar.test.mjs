import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCompanyFacts } from '../providers/edgar.js';
import { asOf, annual, computeMetrics } from '../engine/fundamentals.js';

// עובדה שנתית בפורמט companyfacts של SEC (שנה קלנדרית; הוגשה בפברואר שאחריה, או בתאריך שנמסר — דוח השוואתי)
const fy = (y, val, filed = `${y + 1}-02-15`) => ({ start: `${y}-01-01`, end: `${y}-12-31`, val, filed, form: '10-K', fy: y, fp: 'FY' });
const cf = (gaap) => ({ cik: 1, entityName: 'Synthetic', facts: { 'us-gaap': Object.fromEntries(Object.entries(gaap).map(([k, arr]) => [k, { units: { USD: arr } }])) } });

// כמו MSFT/VEEV/MU: Revenues נעצר ב-FY2017; RevenueFromContractWithCustomer… מ-FY2018 (כולל השוואתיים מוצגים מחדש ל-2016–2017)
const switched = cf({
  Revenues: [2012, 2013, 2014, 2015, 2016, 2017].map((y) => fy(y, (100 + y - 2012) * 1e6)),
  RevenueFromContractWithCustomerExcludingAssessedTax: [
    fy(2016, 97e6, '2019-02-15'), fy(2017, 98e6, '2019-02-15'),
    ...[2018, 2019, 2020, 2021, 2022, 2023, 2024].map((y) => fy(y, (200 + 10 * (y - 2018)) * 1e6)),
  ],
});

test('EDGAR: Revenue לוקח את התגית שהנקודה האחרונה שלה הכי עדכנית, לא "הראשונה עם נתונים"', () => {
  const n = normalizeCompanyFacts(switched);
  const a = annual(n, 'Revenue');
  assert.equal(a.at(-1).end, '2024-12-31');
  assert.equal(a.at(-1).val, 260e6);
  const m = computeMetrics(n, { price: 10 });
  assert.equal(m.revenue, 260e6);
  assert.ok(Math.abs(m.revenueGrowth - (260 / 250 - 1)) < 1e-9);
});

test('EDGAR: מעבר תגית שומר point-in-time — לפני המעבר רואים את הסדרה הישנה, אחריו הנוכחית גוברת גם על השוואתיים', () => {
  const n = normalizeCompanyFacts(switched);
  // As-Of 2018-06: הדוח הראשון עם התגית החדשה הוגש 2019-02-15 → רק Revenues היה ידוע
  const before = annual(asOf(n, '2018-06-01'), 'Revenue');
  assert.equal(before.at(-1).end, '2017-12-31');
  assert.equal(before.at(-1).val, 105e6);
  // היום: 2016/2017 לפי ההגשה האחרונה (התגית החדשה, מוצגים מחדש); 2012–2015 נשארים מהסדרה הישנה
  const now = annual(n, 'Revenue');
  assert.equal(now.find((f) => f.end === '2017-12-31').val, 98e6);
  assert.equal(now.find((f) => f.end === '2012-12-31').val, 100e6);
  // אין ערבוב תגיות באותה הגשה: עובדות התגית הישנה הוגשו כולן לפני ההגשה הראשונה של החדשה
  const fromNew = (f) => f.val === 97e6 || f.val === 98e6 || f.val >= 200e6;
  assert.ok(n.series.Revenue.filter((f) => f.filed >= '2019-02-15').every(fromNew));
  assert.ok(n.series.Revenue.filter((f) => f.filed < '2019-02-15').every((f) => !fromNew(f)));
});

test('EDGAR: שתי תגיות עדכניות באותה מידה → סדר TAG_MAP (התנהגות קיימת), בלי ערבוב', () => {
  const n = normalizeCompanyFacts(cf({
    Revenues: [2022, 2023, 2024].map((y) => fy(y, 500e6)),
    RevenueFromContractWithCustomerExcludingAssessedTax: [2022, 2023, 2024].map((y) => fy(y, 450e6)),
  }));
  assert.ok(n.series.Revenue.every((f) => f.val === 500e6));
  assert.equal(n.series.Revenue.length, 3);
});

test('EDGAR: תגית אחת → זהה להתנהגות הקודמת; טפסים שאינם 10-K/10-Q מסוננים', () => {
  const n = normalizeCompanyFacts(cf({
    Revenues: [fy(2023, 1e6), fy(2024, 2e6), { ...fy(2025, 9e6), form: '8-K' }],
    CashAndCashEquivalentsAtCarryingValue: [{ end: '2024-12-31', val: 3e5, filed: '2025-02-15', form: '10-K' }],
  }));
  assert.deepEqual(n.series.Revenue.map((f) => f.val), [1e6, 2e6]);
  assert.equal(n.series.Cash[0].val, 3e5);
});
