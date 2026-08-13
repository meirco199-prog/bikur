// מבחן רמה: שאלות מדורגות מ-A1 עד C1. הציון ממופה לרמת CEFR.
// סוגים: vocab (מילה→עברית), sentence (השלמה), grammar, listen (TTS ואז שאלה), read (קטע קצר ושאלה)
export const PLACEMENT = [
  // A1
  {type:"vocab", lvl:"A1", q:"מה פירוש המילה water?", opts:["לחם","מים","חלב","מיץ"], a:1},
  {type:"sentence", lvl:"A1", q:"I ___ from Israel.", opts:["is","are","am","be"], a:2},
  {type:"vocab", lvl:"A1", q:"מה פירוש המילה friend?", opts:["משפחה","חבר","שכן","מורה"], a:1},
  {type:"listen", lvl:"A1", say:"Good morning! How are you today?", q:"מה נאמר בהקלטה?", opts:["ברכת בוקר ושאלה לשלום","הזמנה למסעדה","שאלה על מזג האוויר","פרידה"], a:0},
  // A2
  {type:"grammar", lvl:"A2", q:"She ___ to work by train yesterday.", opts:["goes","went","go","gone"], a:1},
  {type:"vocab", lvl:"A2", q:"מה פירוש המילה expensive?", opts:["זול","מהיר","יקר","קרוב"], a:2},
  {type:"sentence", lvl:"A2", q:"There isn't ___ milk in the fridge.", opts:["some","a","any","many"], a:2},
  {type:"listen", lvl:"A2", say:"The bus leaves at half past seven, so please don't be late.", q:"באיזו שעה יוצא האוטובוס?", opts:["6:30","7:00","7:30","8:30"], a:2},
  // B1
  {type:"grammar", lvl:"B1", q:"I ___ here since 2019.", opts:["live","lived","am living","have lived"], a:3},
  {type:"vocab", lvl:"B1", q:"מה פירוש המילה postpone?", opts:["לבטל","לדחות","לאשר","להקדים"], a:1},
  {type:"read", lvl:"B1", text:"Dana moved to a new city last month. At first she felt lonely, but after joining a running club she made new friends quickly.", q:"איך דנה הכירה חברים חדשים?", opts:["בעבודה","בקורס בישול","במועדון ריצה","דרך השכנים"], a:2},
  {type:"listen", lvl:"B1", say:"I was going to order the fish, but I changed my mind and got the pasta instead.", q:"מה המשמעות?", opts:["הוא הזמין דג","הוא התלבט והזמין פסטה","הוא ביטל את ההזמנה","הוא לא אהב את הפסטה"], a:1},
  // B2
  {type:"grammar", lvl:"B2", q:"If I ___ about the traffic, I would have left earlier.", opts:["knew","had known","know","have known"], a:1},
  {type:"vocab", lvl:"B2", q:"מה פירוש המילה reliable?", opts:["גמיש","אמין","זמין","יקר"], a:1},
  {type:"sentence", lvl:"B2", q:"The project, ___ took six months, was a big success.", opts:["that","who","which","what"], a:2},
  {type:"read", lvl:"B2", text:"Although remote work offers flexibility, many employees report that the boundary between work and home life has become increasingly blurred, leading some companies to encourage 'offline hours'.", q:"מה הבעיה שמתוארת בקטע?", opts:["ירידה בפריון","טשטוש הגבול בין עבודה לבית","מחסור במשרדים","עלויות נסיעה"], a:1},
  // C1
  {type:"vocab", lvl:"C1", q:"מה פירוש המילה feasible?", opts:["בר ביצוע","מסוכן","יוצא דופן","זמני"], a:0},
  {type:"grammar", lvl:"C1", q:"Not until the results were published ___ the scale of the problem.", opts:["we realized","did we realize","we did realize","realized we"], a:1},
];

// ממפה ציון משוקלל לרמת CEFR לפי הרמה הגבוהה ביותר שבה המשתמש ענה טוב
export function scorePlacement(answers){
  // answers: [{lvl, correct}]
  const byLvl = {};
  for (const a of answers){
    byLvl[a.lvl] = byLvl[a.lvl] || {ok:0, n:0};
    byLvl[a.lvl].n++; if (a.correct) byLvl[a.lvl].ok++;
  }
  const order = ["A1","A2","B1","B2","C1"];
  let level = "A1";
  for (const lvl of order){
    const s = byLvl[lvl];
    if (!s || s.n === 0) break;
    if (s.ok / s.n >= 0.5) level = lvl; else break;
  }
  // מי שעבר את C1 בשלמות מקבל C2
  const c1 = byLvl["C1"];
  if (level === "C1" && c1 && c1.ok === c1.n) level = "C2";
  return level;
}
