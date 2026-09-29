// completeLesson: לא נמדד = null (דיבור בלי הערכת מורה), חציון רק מהנמדד, והתזכורת מדברת על השיעור הבא.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// store/notify נוגעים ב-localStorage/Notification בטעינה — shims מינימליים (אין דפדפן)
globalThis.localStorage = { _m: {}, getItem(k){ return this._m[k] ?? null; }, setItem(k, v){ this._m[k] = v; }, removeItem(k){ delete this._m[k]; } };
globalThis.window = globalThis;
try { Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true }); } catch {}
const { S } = await import('../../js/store.js');
const { buildPlacementLesson, completeLesson, quizDetail } = await import('../../js/curriculum.js');
const { reminderState } = await import('../../js/notify.js');

const answers = (skill, seq) => seq.map(([level, correct]) => ({ skill, level, correct }));

test('placement without a teacher assessment ⇒ speaking stays null (never guessed); level = median of measured', () => {
  S.profile.level = 'C1'; S.profile.name = 'מאיר';
  const plan = buildPlacementLesson();
  const quiz = [
    ...answers('listening', [['C1', true], ['C2', true], ['C2', true]]),
    ...answers('reading', [['C1', true], ['C2', false], ['C1', true], ['C2', false]]),
    ...answers('vocab', [['C1', true], ['C2', true], ['C2', true]]),
    ...answers('grammar', [['C1', false], ['B2', true], ['C1', false], ['B2', true]]),
  ];
  const res = completeLesson(plan, { quizAnswers: quiz, teacherSkills: null, secs: 900, mode: 'text' });
  assert.equal(res.skills.speaking, null);
  assert.equal(res.skills.pronunciation, null);
  assert.deepEqual([res.skills.listening, res.skills.reading, res.skills.vocab, res.skills.grammar], ['C2', 'C1', 'C2', 'B2']);
  assert.equal(S.profile.level, 'C1', 'median of C2,C1,C2,B2 (speaking excluded)');
  assert.equal(S.course.placementDone, true);
  assert.equal(S.course.next.n, 2);
  const d = quizDetail(quiz);
  assert.equal(d.reading.items, 4); assert.equal(d.reading.confident, true);
});
test('teacher assessment sets speaking; a later check only raises on measured improvement', () => {
  const plan = { kind: 'check', n: 9, title: 'Progress check', topicId: null, vocab: [], goals: [] };
  completeLesson(plan, { quizAnswers: answers('grammar', [['B2', true], ['C1', false], ['B2', true], ['C1', false]]), teacherSkills: { speaking: 'B2' } });
  assert.equal(S.course.skills.speaking, 'B2');
  assert.equal(S.course.skills.grammar, 'B2', 'not lowered, not raised without measured improvement');
});
test('after completing a lesson the reminder state already names the next lesson', () => {
  S.course.schedule = { weekday: 2, time: '19:30', durationMin: 30, teacherId: 'sarah' };
  const st = reminderState();
  assert.match(st.lesson.title, new RegExp('Lesson ' + S.course.next.n + ' — '));
  assert.equal(S.course.next.n, S.course.done.length + 1);
  assert.equal(st.lesson.weekday, 2);
});
