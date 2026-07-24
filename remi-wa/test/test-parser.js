// בדיקות למפענח העברית — מריצים עם: npm test
import { parseWhen, parseCommand } from '../src/parser.js';

// יום רביעי, 22/7/2026, 10:00 בבוקר
const NOW = new Date(2026, 6, 22, 10, 0, 0);

let passed = 0, failed = 0;

function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
}

function at(y, mo, d, h, mi = 0) {
  return new Date(y, mo, d, h, mi).getTime();
}

console.log('parseWhen:');
{
  const r = parseWhen('מחר ב-9 להתקשר לדני', NOW);
  check('מחר ב-9', r.at?.getTime() === at(2026, 6, 23, 9), `got ${r.at}`);
  check('  כותרת נקייה', r.rest === 'להתקשר לדני', `got "${r.rest}"`);
}
{
  const r = parseWhen('בעוד 20 דקות להוריד כביסה', NOW);
  check('בעוד 20 דקות', r.at?.getTime() === NOW.getTime() + 20 * 60000, `got ${r.at}`);
  check('  כותרת נקייה', r.rest === 'להוריד כביסה', `got "${r.rest}"`);
}
{
  const r = parseWhen('בעוד חצי שעה לצאת', NOW);
  check('בעוד חצי שעה', r.at?.getTime() === NOW.getTime() + 30 * 60000, `got ${r.at}`);
}
{
  const r = parseWhen('ביום ראשון בשעה 14:30 פגישה עם רואה חשבון', NOW);
  check('ביום ראשון 14:30', r.at?.getTime() === at(2026, 6, 26, 14, 30), `got ${r.at}`);
  check('  כותרת נקייה', r.rest === 'פגישה עם רואה חשבון', `got "${r.rest}"`);
}
{
  const r = parseWhen('היום ב-7 בערב לקנות מתנה', NOW);
  check('היום ב-7 בערב => 19:00', r.at?.getTime() === at(2026, 6, 22, 19), `got ${r.at}`);
}
{
  const r = parseWhen('מחר בבוקר ריצה', NOW);
  check('מחר בבוקר => 09:00', r.at?.getTime() === at(2026, 6, 23, 9), `got ${r.at}`);
}
{
  const r = parseWhen('ב-8 לקחת כדור כל יום', NOW);
  check('כל יום מזוהה', r.recurringDaily === true);
  check('  שעה 8', r.at?.getHours() === 8, `got ${r.at}`);
  check('  כותרת נקייה', r.rest === 'לקחת כדור', `got "${r.rest}"`);
}
{
  const r = parseWhen('25/8 ב-10:00 תור לרופא שיניים', NOW);
  check('תאריך מפורש 25/8', r.at?.getTime() === at(2026, 7, 25, 10), `got ${r.at}`);
}
{
  const r = parseWhen('ב-9 לקום', NOW);
  // 9:00 כבר עבר (עכשיו 10:00) => מחר
  check('שעה שעברה => מחר', r.at?.getTime() === at(2026, 6, 23, 9), `got ${r.at}`);
}
{
  const r = parseWhen('מחרתיים בצהריים לאסוף חבילה', NOW);
  check('מחרתיים בצהריים', r.at?.getTime() === at(2026, 6, 24, 12), `got ${r.at}`);
}
{
  const r = parseWhen('סתם טקסט בלי זמן', NOW);
  check('בלי זמן => null', r.at === null);
}

console.log('\nparseCommand:');
{
  const c = parseCommand('תזכיר לי מחר ב-9 להתקשר לדני', NOW);
  check('תזכורת', c.cmd === 'reminder_add' && c.text === 'להתקשר לדני', JSON.stringify(c));
}
{
  const c = parseCommand('תזכיר לי כל יום ב-8 לקחת כדור', NOW);
  check('תזכורת יומית', c.cmd === 'reminder_add' && c.recurringDaily === true, JSON.stringify(c));
}
{
  const c = parseCommand('תזכיר לי לשתות מים', NOW);
  check('תזכורת בלי זמן', c.cmd === 'reminder_missing_time');
}
{
  const c = parseCommand('משימה: לשלם ארנונה', NOW);
  check('הוספת משימה', c.cmd === 'task_add' && c.text === 'לשלם ארנונה', JSON.stringify(c));
}
{
  const c = parseCommand('משימות', NOW);
  check('רשימת משימות', c.cmd === 'task_list');
}
{
  const c = parseCommand('סיימתי 2', NOW);
  check('סימון ביצוע', c.cmd === 'task_done' && c.index === 2);
}
{
  const c = parseCommand('קבע פגישה עם דני ביום רביעי ב-14:00', NOW);
  check('קביעת אירוע', c.cmd === 'event_add' && c.text.includes('דני'), JSON.stringify(c));
  check('  ליום רביעי הבא', c.at?.getDay() === 3 && c.at > NOW, `got ${c.at}`);
}
{
  const c = parseCommand('מה יש לי היום', NOW);
  check('סדר יום', c.cmd === 'agenda' && c.range === 'today');
}
{
  const c = parseCommand('מה יש לי מחר?', NOW);
  check('סדר יום מחר', c.cmd === 'agenda' && c.range === 'tomorrow');
}
{
  const c = parseCommand('עזרה', NOW);
  check('עזרה', c.cmd === 'help');
}
{
  const c = parseCommand('מחק תזכורת 3', NOW);
  check('מחיקת תזכורת', c.cmd === 'reminder_delete' && c.index === 3);
}
{
  const c = parseCommand('בלה בלה בלה', NOW);
  check('לא מזוהה => unknown', c.cmd === 'unknown');
}

console.log(`\n${passed} עברו, ${failed} נכשלו`);
process.exit(failed ? 1 : 0);
