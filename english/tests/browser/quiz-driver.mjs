// מניע את התרגיל האדפטיבי על המסך: קורא מיומנות/רמה/שאלה מה-DOM, מוצא את התשובה הנכונה בבנק,
// ועונה לפי policy(skill, level, n) → true=נכון. מחזיר את רצף התשובות.
export async function driveQuiz(p, policy, {settle = () => Promise.resolve()} = {}){
  const seq = []; let guard = 0;
  while (guard++ < 40){
    const info = await p.evaluate(async () => {
      const head = document.querySelector('.slides-head')?.textContent || '';
      const quiz = document.querySelector('.slide-quiz');
      if (!quiz || document.querySelector('.slide-quiz .opt:disabled') || !document.querySelector('.slide-quiz .opt')) return null;
      const meta = quiz.querySelector('.muted')?.textContent || '';
      const level = (meta.match(/רמה (\w\d)/) || [])[1];
      const q = quiz.querySelector('.slide-body')?.textContent || '';
      const title = document.querySelector('.slide-title')?.textContent || '';
      const skill = title.includes('שמיעה') ? 'listening' : title.includes('קריאה') ? 'reading' : title.includes('אוצר') ? 'vocab' : 'grammar';
      const m = await import('./js/data/test.js');
      const item = m.BANK[level]?.find(x => x.q === q);
      return item ? { level, skill, a: item.a, head } : { level, skill, a: -1, head, q };
    });
    if (!info) break;
    if (info.a < 0) throw new Error('item not found in BANK: ' + JSON.stringify(info));
    const n = seq.filter(x => x.skill === info.skill).length + 1;
    const correct = policy(info.skill, info.level, n);
    const idx = correct ? info.a : (info.a + 1) % 4;
    await p.locator('.slide-quiz .opt').nth(idx).click();
    seq.push({ skill: info.skill, level: info.level, correct });
    await p.waitForTimeout(1050);
    await settle();
  }
  return seq;
}
export const LV = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const atMost = T => (skill, level) => LV.indexOf(level) <= LV.indexOf(T);
