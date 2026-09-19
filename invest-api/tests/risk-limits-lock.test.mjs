// נעילת מנוע הסיכון: קובע את הערכים הנוכחיים של כל מגבלות הסיכון הקשיחות כ"נכס קפוא". שינוי לא מכוון בהם (למשל
// דריסה בטעות בזמן ריפקטור, או שינוי בקובץ אחד בלי לשים לב שהוא משפיע על הערכים) שובר את הבדיקה הזו וחוסם פריסה
// (deploy-invest-api.yml, job "test" חייב לעבור לפני job "deploy").
// מגבלה חשובה, לא לפספס: זו *לא* הגנה מפני שינוי מכוון על ידי מי שיש לו הרשאת push לריפו — כולל סוכן AI. אפשר
// לשנות את engine/risk-limits.js (או TRACK_LIMITS_C/AGGR_RULES/AUTO_RULES) ואת הקובץ הזה יחד, באותו commit,
// וה-CI יעבור. שינוי מכוון ולגיטימי חייב לעדכן את שני הקבצים יחד — כך שהוא לפחות מופיע כשינוי גלוי בדיף — אבל
// זה לא מונע ממישהו עם גישת push לעשות זאת בלי אישור. ההגנה האמיתית מפני שינוי מכוון היא Branch Protection על
// main (Require pull request + Require review from Code Owners, הגדרה ידנית ב-GitHub) — לא הקובץ הזה.
// פירוט מלא: invest/docs/SECURITY.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RISK_LIMITS } from '../engine/risk-limits.js';
import { TRACK_LIMITS_C, TRACKS } from '../engine/tracks.js';
import { AGGR_RULES } from '../engine/aggressive.js';
import { AUTO_RULES } from '../engine/autopilot.js';

test('RISK_LIMITS (חשבון התרגול המאוזן, regB) קפוא ותואם את הערכים המאושרים', () => {
  assert.deepStrictEqual(RISK_LIMITS, {
    maxActiveShare: 0.20,
    maxPositionShare: 0.10,
    maxOpenRisk: 0.03,
    maxSectorOpenRisk: 0.015,
    maxBuysPerDay: 3,
    leverage: false,
    shortSelling: false,
    options: false,
    requireEarningsDateLive: true,
    allowedTypes: ['stock', 'etf'],
  });
  assert.ok(Object.isFrozen(RISK_LIMITS), 'RISK_LIMITS חייב להישאר Object.freeze');
});

test('TRACK_LIMITS_C (מסלול regC בלבד) קפוא ותואם את הערכים המאושרים', () => {
  assert.deepStrictEqual(TRACK_LIMITS_C, {
    maxActiveShare: 0.40,
    maxPositionShare: 0.08,
    maxOpenRisk: 0.05,
    maxSectorOpenRisk: 0.02,
    maxBuysPerDay: 3,
    leverage: false,
    shortSelling: false,
    options: false,
    requireEarningsDateLive: true,
    allowedTypes: ['stock', 'etf'],
  });
  assert.ok(Object.isFrozen(TRACK_LIMITS_C));
});

test('AGGR_RULES (המסלול האגרסיבי הקיים + aggrB) קפוא ותואם — כולל עצירות (stopPct/trailPct)', () => {
  assert.deepStrictEqual(AGGR_RULES, {
    version: 1, initialIls: 200000,
    core: 'SPY', coreWeight: 0.20,
    stocksWeight: 0.75, cashReserve: 0.05,
    maxPositions: 10, positionWeight: 0.075, maxSector: 0.40, maxBuysPerDay: 5,
    model: 'D', buyActions: ['STRONG BUY', 'BUY'], sellActions: ['SELL'],
    stopPct: 0.12, trailPct: 0.15,
    bearStocksTarget: 0.25,
    riskOffOnlyStrong: true,
    slippage: 0.001, feeIls: 4,
    coreDriftPct: 0.05,
    cooldownDays: 7,
    lookThrough: true,
  });
  assert.ok(Object.isFrozen(AGGR_RULES));
});

test('AUTO_RULES (חשבון התרגול + regB/regC) — שדות הסיכון הקשיחים לא זזו', () => {
  assert.deepStrictEqual(
    { riskBudget: AUTO_RULES.riskBudget, stopMin: AUTO_RULES.stopMin, stopMax: AUTO_RULES.stopMax, stopVolFactor: AUTO_RULES.stopVolFactor, stopBearFactor: AUTO_RULES.stopBearFactor, maxConcentration: AUTO_RULES.maxConcentration, maxBuysPerRun: AUTO_RULES.maxBuysPerRun, minCoverage: AUTO_RULES.minCoverage, requiredComponents: AUTO_RULES.requiredComponents, minEligibleUniverse: AUTO_RULES.minEligibleUniverse },
    { riskBudget: 0.005, stopMin: 0.08, stopMax: 0.20, stopVolFactor: 0.5, stopBearFactor: 0.75, maxConcentration: 1.5, maxBuysPerRun: 3, minCoverage: 0.85, requiredComponents: ['fundamental', 'valuation', 'growth', 'momentum'], minEligibleUniverse: 100 }
  );
});

test('TRACKS: הקצאות היעד (sleeves) ומגבלות כל מסלול חדש תואמות את מה שאושר', () => {
  assert.deepStrictEqual(TRACKS.regB.profile.sleeves, { coreEquity: 0.60, stocks: 0.20, bonds: 0.10, gold: 0.05, cash: 0.05 });
  assert.equal(TRACKS.regB.limits, RISK_LIMITS, 'regB לא עוקף את מגבלות חשבון התרגול — אותו אובייקט בדיוק');
  assert.deepStrictEqual(TRACKS.regC.profile.sleeves, { coreEquity: 0.40, stocks: 0.40, bonds: 0.10, gold: 0.05, cash: 0.05 });
  assert.equal(TRACKS.regC.limits, TRACK_LIMITS_C, 'regC משתמש במגבלות הנפרדות שלו, לא במגבלות חשבון התרגול');
  assert.equal(TRACKS.aggrB.rules.equityFloor, 0.70);
  assert.equal(TRACKS.aggrB.rules.coreMax, 0.70);
  assert.equal(TRACKS.aggrB.rules.model, 'DF');
  assert.equal(TRACKS.aggrB.rules.stopPct, AGGR_RULES.stopPct, 'aggrB חולק את אותה רמת עצירה כמו המסלול האגרסיבי הקיים');
  assert.equal(TRACKS.aggrB.rules.trailPct, AGGR_RULES.trailPct);
});
