// הפריסה ל-Cloudflare (.github/workflows/deploy-invest-api.yml) מעלה את worker.js וכל קובץ JS תחת engine/, providers/ ו-lib/ (כולל תת-תיקיות).
// בדיקה: כל מודול שה-Worker מייבא (גם בעקיפין) נמצא בתוך מה שמועלה. רקע: מ-#231 (8/11/2026) ה-Worker ייבא engine/lab/*.js,
// הרשימה הייתה engine/*.js בלבד, וכל הפריסות נכשלו ב-"No such module" עד 13/11 — בלי שאף בדיקה תתפוס את זה.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), REPO = join(ROOT, '..');
test('כל המודולים שה-Worker מייבא נמצאים בתיקיות שהפריסה מעלה, והפריסה מעלה תת-תיקיות', () => {
  const seen = new Set(), q = ['worker.js'];
  while (q.length){
    const f = q.pop(); if (seen.has(f)) continue; seen.add(f);
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) q.push(normalize(join(dirname(f), m[1] || m[2])));
  }
  const outside = [...seen].filter((f) => f !== 'worker.js' && !/^(engine|providers|lib)\//.test(f));
  assert.deepEqual(outside, [], 'מודול מחוץ לתיקיות שהפריסה מעלה');
  assert.deepEqual([...seen].filter((f) => !f.endsWith('.js')), [], 'הפריסה מעלה רק ‎.js — מודול בסיומת אחרת לא יועלה');
  const wf = readFileSync(join(REPO, '.github/workflows/deploy-invest-api.yml'), 'utf8');
  assert.match(wf, /find engine providers lib -name '\*\.js'/, 'הפריסה צריכה להעלות גם תת-תיקיות (find), לא רק engine/*.js');
  assert.ok(seen.size > 50);
});
