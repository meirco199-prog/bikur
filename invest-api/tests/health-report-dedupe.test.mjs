// דוח התקינות היומי ב-Issue #25 (tick-invest.yml): בדיקת הכפילות חייבת לראות את כל התגובות מהיום, לא רק את העמוד הראשון.
// הבאג (ChatGPT, Issue #25, 2/11): comments?per_page=100 בלי --paginate מחזיר את 100 התגובות הוותיקות ביותר, ולכן ב-Issue
// עם יותר מ-100 תגובות הדוח של היום "לא נמצא" ופורסם שוב בכל ריצה מתוזמנת.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const wf = readFileSync(new URL('../../.github/workflows/tick-invest.yml', import.meta.url), 'utf8');
const line = wf.split('\n').find((l) => l.includes('POSTED=$(gh api'));

test('tick-invest: בדיקת הכפילות של דוח התקינות עוברת על כל העמודים ומסננת לפי היום', () => {
  assert.ok(line, 'שורת POSTED=$(gh api …) קיימת בשלב הדוח');
  assert.match(line, /--paginate/, 'חייב --paginate — אחרת נקרא רק העמוד הראשון');
  assert.match(line, /since=\$\{TODAY\}T00:00:00Z/, 'מצמצם לתגובות מהיום');
  assert.match(line, /<!-- health-report \$TODAY -->/, 'מחפש את הסמן של היום עצמו');
  assert.ok(!/\|\s*last\s*\|/.test(line), 'בלי "last" על עמוד בודד');
  assert.match(wf, /\[ -n "\$POSTED" \]; then echo "דוח התקינות של \$TODAY כבר פורסם/, 'מדלג כשנמצא דוח מהיום');
});

// הרצת ביטוי ה-jq בפועל (אם jq מותקן — קיים ברץ של GitHub) על שני "עמודים", כשהדוח של היום בעמוד השני
test('tick-invest: ביטוי ה-jq מוצא דוח של היום גם כשהוא לא בעמוד הראשון, ומתעלם מדוח של יום אחר', (t) => {
  let hasJq = true;
  try { execFileSync('jq', ['--version'], { stdio: 'ignore' }); } catch { hasJq = false; }
  if (!hasJq) { t.skip('jq לא מותקן'); return; }
  const m = line.match(/--jq "(.*?)" 2>/);
  assert.ok(m, 'נמצא ביטוי --jq');
  const today = '2026-11-02';
  // פענוח המירכאות של bash: \" → " ו-$TODAY → היום
  const expr = m[1].replace(/\\"/g, '"').replace(/\$TODAY/g, today);
  const run = (pages) => pages.map((p) => execFileSync('jq', ['-r', expr], { input: JSON.stringify(p) }).toString()).join('').trim();
  const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, body: i === 5 ? '<!-- health-report 2026-11-01 -->\n## דוח' : 'תגובה' }));
  const page2 = [{ id: 101, body: '**ChatGPT** הערה' }, { id: 102, body: `<!-- health-report ${today} -->\n## דוח תקינות` }];
  assert.equal(run([page1, page2]), '102');
  assert.equal(run([page1]), '', 'דוח של אתמול לא נחשב לדוח של היום');
  assert.equal(run([[{ id: 7, body: `ציטוט: <!-- health-report ${today} -->` }]]), '', 'רק תגובה שמתחילה בסמן');
});
