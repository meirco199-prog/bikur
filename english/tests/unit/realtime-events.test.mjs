// פענוח אירועי Realtime GA (live.js) — בלי WebRTC: מזרימים אירועים למטפל ובודקים מצב/כתוביות/כלים/מדדים.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// live.js מייבא store/ai שנוגעים ב-localStorage בטעינה — shim מינימלי
globalThis.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
globalThis.window = globalThis;
const { createEventHandler, newLiveState } = await import('../../js/live.js');

function rig(){
  const state = newLiveState();
  const sent = [], calls = [];
  let t = 1000; const now = () => t;
  const handlers = {
    onConnected: (m) => calls.push(['connected', m]), onTeacherText: (txt, done) => calls.push(['teacher', txt, done]),
    onUserText: (txt) => calls.push(['user', txt]), onTeacherSpeaking: (on) => calls.push(['tspk', on]),
    onUserSpeaking: (on) => calls.push(['uspk', on]), onError: (m) => calls.push(['error', m]),
    onTool: (name, args) => { calls.push(['tool', name, args]); return { ok: true, echoed: name }; },
  };
  const handle = createEventHandler({ state, handlers, send: (o) => sent.push(o), now });
  return { state, sent, calls, handle, tick: (ms) => { t += ms; } };
}

test('session.created marks REALTIME CONNECTED and records the model; a bare fetch does not', () => {
  const r = rig();
  assert.equal(r.state.connected, false);
  r.handle({ type: 'session.created', session: { id: 'sess_1', model: 'gpt-realtime-2.1-mini', type: 'realtime' } });
  assert.equal(r.state.connected, true);
  assert.equal(r.state.sessionModel, 'gpt-realtime-2.1-mini');
  assert.deepEqual(r.calls[0], ['connected', 'gpt-realtime-2.1-mini']);
});
test('GA output audio transcript events → streaming captions + transcript', () => {
  const r = rig();
  r.handle({ type: 'response.output_audio_transcript.delta', response_id: 'r1', delta: 'Hi ' });
  r.handle({ type: 'response.output_audio_transcript.delta', response_id: 'r1', delta: 'Meir!' });
  r.handle({ type: 'response.output_audio_transcript.done', response_id: 'r1', transcript: 'Hi Meir!' });
  assert.deepEqual(r.calls.filter(c => c[0] === 'teacher').map(c => c[1]), ['Hi ', 'Hi Meir!', 'Hi Meir!']);
  assert.deepEqual(r.state.transcript, [{ role: 'assistant', content: 'Hi Meir!' }]);
  assert.equal(r.state.connected, true, 'any server event proves the connection');
});
test('legacy beta transcript names are still accepted', () => {
  const r = rig();
  r.handle({ type: 'response.audio_transcript.done', response_id: 'r1', transcript: 'Old name' });
  assert.equal(r.state.transcript[0].content, 'Old name');
});
test('student transcription (GA) → caption + transcript', () => {
  const r = rig();
  r.handle({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: ' I went home ', usage: { type: 'tokens' } });
  assert.deepEqual(r.state.transcript, [{ role: 'user', content: 'I went home' }]);
});
test('barge-in: speech_started while the teacher is talking counts as an interruption; talk time is measured', () => {
  const r = rig();
  r.handle({ type: 'output_audio_buffer.started' }); r.tick(2000);
  r.handle({ type: 'input_audio_buffer.speech_started' });
  assert.equal(r.state.metrics.interruptions, 1);
  r.handle({ type: 'output_audio_buffer.cleared' });
  assert.equal(r.state.teacherSpeaking, false);
  assert.equal(r.state.metrics.teacherMs, 2000);
  r.tick(1500); r.handle({ type: 'input_audio_buffer.speech_stopped' });
  assert.equal(r.state.metrics.studentMs, 1500);
  assert.equal(r.state.metrics.longestMs, 1500);
});
test('response latency = teacher stopped → student started', () => {
  const r = rig();
  r.handle({ type: 'output_audio_buffer.started' }); r.tick(500);
  r.handle({ type: 'output_audio_buffer.stopped' }); r.tick(800);
  r.handle({ type: 'input_audio_buffer.speech_started' });
  assert.deepEqual(r.state.metrics.latencies, [800]);
  assert.equal(r.state.metrics.interruptions, 0);
});
test('tool call → handler result returned as function_call_output + response.create', () => {
  const r = rig();
  r.handle({ type: 'response.function_call_arguments.done', call_id: 'c1', name: 'show_slide', arguments: '{"index":3}' });
  assert.deepEqual(r.calls.find(c => c[0] === 'tool'), ['tool', 'show_slide', { index: 3 }]);
  assert.equal(r.sent[0].type, 'conversation.item.create');
  assert.equal(r.sent[0].item.call_id, 'c1');
  assert.deepEqual(JSON.parse(r.sent[0].item.output), { ok: true, echoed: 'show_slide' });
  assert.equal(r.sent[1].type, 'response.create');
  r.handle({ type: 'response.function_call_arguments.done', call_id: 'c2', name: 'end_lesson_summary', arguments: '{"improved":"a","weak":"b","next":"c"}' });
  assert.equal(r.state.lessonSummary.next, 'c');
});
test('error events reach onError and are remembered', () => {
  const r = rig();
  r.handle({ type: 'error', error: { type: 'invalid_request_error', message: 'boom' } });
  assert.deepEqual(r.calls.find(c => c[0] === 'error'), ['error', 'boom']);
  assert.equal(r.state.lastError, 'boom');
});
