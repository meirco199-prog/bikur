// מבחן רמה אדפטיבי ורציני. בנק שאלות מדורג A1→C2, כמה שאלות לכל רמה,
// עם קטעי קריאה והיסק אמיתיים ברמות הגבוהות — כדי שלא ניתן "ליפול" ל-C1
// בלי באמת להבין טקסט ברמה הזאת. האלגוריתם האדפטיבי נמצא ב-placement.js.
export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export const BANK = {
  A1: [
    {type:"vocab",    q:"מה הפירוש של 'water'?", opts:["מים","לחם","חלב","מיץ"], a:0},
    {type:"vocab",    q:"מה הפירוש של 'friend'?", opts:["שכן","חבר","מורה","אח"], a:1},
    {type:"grammar",  q:"She ___ a doctor.", opts:["am","is","are","be"], a:1},
    {type:"grammar",  q:"They ___ football every Sunday.", opts:["plays","play","playing","is play"], a:1},
    {type:"sentence", q:"I ___ up at seven o'clock.", opts:["get","gets","getting","got"], a:0},
    {type:"listen",   say:"The shop opens at nine in the morning.", q:"מתי נפתחת החנות?", opts:["בשבע","בתשע","באחת עשרה","בשמונה"], a:1},
  ],
  A2: [
    {type:"grammar",  q:"Yesterday we ___ to the beach.", opts:["go","went","gone","goes"], a:1},
    {type:"vocab",    q:"מה הפירוש של 'expensive'?", opts:["זול","יקר","מהיר","קרוב"], a:1},
    {type:"sentence", q:"There isn't ___ bread left.", opts:["some","any","a","many"], a:1},
    {type:"grammar",  q:"This car is ___ than mine.", opts:["fast","faster","fastest","more fast"], a:1},
    {type:"listen",   say:"The train leaves at half past seven, so please don't be late.", q:"מתי יוצאת הרכבת?", opts:["7:00","7:15","7:30","8:30"], a:2},
    {type:"read",     text:"Maya works in a small bookshop. She starts at nine and finishes at five. On Fridays the shop closes early, at two.", q:"When does the shop close on Fridays?", opts:["At nine","At two","At five","It doesn't close"], a:1},
  ],
  B1: [
    {type:"grammar",  q:"I ___ in Haifa since 2018.", opts:["live","lived","have lived","am living"], a:2},
    {type:"vocab",    q:"מה הפירוש של 'postpone'?", opts:["לבטל","לדחות","להקדים","לאשר"], a:1},
    {type:"sentence", q:"The woman ___ helped me was very kind.", opts:["which","who","what","whom"], a:1},
    {type:"grammar",  q:"If it rains tomorrow, we ___ at home.", opts:["stay","will stay","would stay","stayed"], a:1},
    {type:"vocab",    q:"מה הפירוש של 'available'?", opts:["עסוק","זמין","יקר","חסר"], a:1},
    {type:"read",     text:"Tom had never enjoyed running. But after his doctor warned him about his health, he started jogging every morning. Six months later, he finished his first 10-kilometer race.", q:"Why did Tom start running?", opts:["He always loved it","His doctor warned him about his health","He wanted to win money","His friends made him"], a:1},
  ],
  B2: [
    {type:"grammar",  q:"If I had known, I ___ you.", opts:["will help","would help","would have helped","helped"], a:2},
    {type:"vocab",    q:"מה הפירוש של 'reliable'?", opts:["גמיש","אמין","זמני","יקר"], a:1},
    {type:"sentence", q:"We need to ___ a decision by Friday.", opts:["do","make","take","have"], a:1},
    {type:"grammar",  q:"By the time we arrived, the film ___.", opts:["already started","has already started","had already started","was already start"], a:2},
    {type:"vocab",    q:"מה הפירוש של 'overwhelmed'?", opts:["משועמם","מוצף (רגשית)","נלהב","אדיש"], a:1},
    {type:"read",     text:"Although the new policy was meant to save money, many employees felt it actually made their work slower. Managers, however, insisted the savings were worth the inconvenience.", q:"What does the passage suggest about the policy?", opts:["Everyone agreed it succeeded","It clearly failed completely","Its value was disputed","It was cancelled quickly"], a:2},
  ],
  C1: [
    {type:"vocab",    q:"מה הפירוש של 'feasible'?", opts:["מסוכן","בר ביצוע","זמני","יוצא דופן"], a:1},
    {type:"grammar",  q:"Not until she left ___ how much he missed her.", opts:["he realized","did he realize","he did realize","realized he"], a:1},
    {type:"sentence", q:"The negotiations eventually broke ___ without an agreement.", opts:["up","down","off","out"], a:1},
    {type:"vocab",    q:"מה הפירוש של 'compelling' (a compelling argument)?", opts:["חלש","משכנע","מבלבל","ארוך"], a:1},
    {type:"sentence", q:"___ his experience, he was not offered the job.", opts:["Despite","Although","However","Because"], a:0},
    {type:"read",     text:"The author's tone throughout the essay is one of measured skepticism: she neither dismisses the new technology outright nor embraces the sweeping promises made on its behalf, preferring instead to ask who ultimately benefits.", q:"How does the author feel about the technology?", opts:["Enthusiastic and hopeful","Completely dismissive","Cautious and questioning","Uninformed and confused"], a:2},
  ],
  C2: [
    {type:"vocab",    q:"מה הפירוש של 'ubiquitous'?", opts:["נדיר","נמצא בכל מקום","מיושן","סודי"], a:1},
    {type:"sentence", q:"Rarely ___ such a unanimous response from critics.", opts:["a film has received","has a film received","a film received","received a film"], a:1},
    {type:"vocab",    q:"מה המשמעות של 'to concede a point'?", opts:["להתעקש על העמדה","להודות שהצד השני צודק בנקודה","לשנות נושא","לחזור על טיעון"], a:1},
    {type:"sentence", q:"The committee's decision, ___ controversial, was ultimately upheld.", opts:["while","despite","however","because"], a:0},
    {type:"read",     text:"Her prose has a deceptive simplicity; what reads at first as plain reportage reveals, on closer inspection, a carefully layered irony that quietly undercuts its own certainties.", q:"What is implied about her writing?", opts:["It is simple and direct","It only appears simple but is subtly complex","It is careless and unclear","It is heavily decorated"], a:1},
    {type:"read",     text:"Far from being a neutral tool, the algorithm encodes the priorities of those who build it — a fact its designers are often the last to acknowledge.", q:"What is the main point?", opts:["Algorithms are fully objective","Algorithms reflect their makers' choices","Designers understand their tools best","The tool is simply broken"], a:1},
  ],
};

// קובע רמה מתוצאות המבחן האדפטיבי. עולה כל עוד הרמה עברה בבירור (≥60%),
// ונעצר ברמה הראשונה שנכשלה בבירור (נוסתה מספיק ומתחת ל-60%). מחמיר בכוונה
// כדי למנוע "נפילה" לרמה גבוהה מדי מתשובה בודדת שקלעה.
export function computeLevel(results){
  let level = LEVELS[0];
  for (let j = 0; j < LEVELS.length; j++){
    const r = results[LEVELS[j]];
    if (!r || r.n === 0) continue;         // רמה שלא נוסתה — דילגנו עליה בעלייה, נחשבת כעברה
    const ratio = r.ok / r.n;
    if (ratio >= 0.6) level = LEVELS[j];   // עברה בבירור — מתקדמים
    else if (r.n >= 2) break;              // נוסתה מספיק ולא עברה — עוצרים כאן
    // n==1 עם תוצאה חלשה: מידע דל, לא עוצרים ולא מקדמים
  }
  return level;
}
