// מנוע האבחון האדפטיבי — טהור, בלי דפדפן. הרצה: node --test english/tests/unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, estimateLevel, isDone, LEVELS, MAX_ITEMS } from '../../js/adaptive.js';
import { BANK } from '../../js/data/test.js';

const TYPE_TO_SKILL = { vocab: 'vocab', grammar: 'grammar', sentence: 'grammar', listen: 'listening', read: 'reading' };
const pool = skill => level => BANK[level].filter(q => TYPE_TO_SKILL[q.type] === skill);
// תלמיד עם רמה אמיתית T: נכון על פריט ברמה ≤ T; flukes[n] כופה תוצאה בפריט n
function simulate(T, start, flukes = {}, skill = 'grammar'){
  const run = createRun({ start, pool: pool(skill) });
  const seq = []; let n = 0;
  while (run.next()){
    n++;
    let correct = LEVELS.indexOf(run.level) <= LEVELS.indexOf(T);
    if (flukes[n] !== undefined) correct = flukes[n];
    run.answer(correct); seq.push(run.level + (correct ? '✓' : '✗'));
  }
  return { est: run.estimate(), seq: seq.join(' '), n };
}

test('A1 → C2: start A1, all correct ⇒ C2 confident (full range measurable)', () => {
  for (const skill of ['listening', 'reading', 'vocab', 'grammar']){
    const r = simulate('C2', 'A1', {}, skill);
    assert.equal(r.est.level, 'C2', `${skill}: ${r.seq}`);
    assert.equal(r.est.confident, true, `${skill}: ${r.seq}`);
    assert.ok(r.n <= MAX_ITEMS + 1, `${skill}: ${r.n} items`);
  }
});
test('C2 → A1: start C2, all wrong ⇒ A1 (floor) confident', () => {
  const r = simulate('__none__', 'C2');   // אף רמה לא "≤ T" → הכול שגוי
  assert.equal(r.est.level, 'A1', r.seq);
  assert.equal(r.est.floor, true);
  assert.equal(r.est.confident, true);
});
test('one accidental WRONG answer does not drop a whole level (C1 student)', () => {
  assert.equal(simulate('C1', 'B2', { 2: false }).est.level, 'C1');
  assert.equal(simulate('C1', 'C1', { 1: false }).est.level, 'C1');
});
test('one lucky CORRECT answer does not raise a whole level (B2 student)', () => {
  assert.equal(simulate('B2', 'B2', { 2: true }).est.level, 'B2');
});
test('declared level too high / too low still converges', () => {
  assert.equal(simulate('B1', 'C1').est.level, 'B1');
  assert.equal(simulate('C2', 'A2').est.level, 'C2');
});
test('a single correct answer alone is not a confirmed level', () => {
  const e = estimateLevel([{ level: 'C1', correct: true }]);
  assert.equal(e.confident, false); assert.equal(e.level, 'B2');
});
test('stops at the ceiling after 2×C2 and never runs forever', () => {
  assert.equal(isDone([{ level: 'C2', correct: true }, { level: 'C2', correct: true }]), true);
  let tot = 0; const N = 240;
  for (let i = 0; i < N; i++) tot += simulate(LEVELS[i % 6], LEVELS[(i * 7) % 6]).n;
  assert.ok(tot / N < 5, 'average items per skill should stay short: ' + (tot / N).toFixed(1));
});
