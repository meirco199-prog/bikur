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
    {type:"read",     text:"Ben has a dog. The dog is black and white. Every morning Ben and the dog walk in the park.", q:"What color is the dog?", opts:["Brown","Black and white","White","Grey"], a:1},
    {type:"vocab",    q:"מה הפירוש של 'house'?", opts:["רחוב","בית","חנות","גן"], a:1},
    {type:"listen",   say:"My sister has two cats and one dog.", q:"כמה חתולים יש לאחות?", opts:["אחד","שניים","שלושה","אין"], a:1},
    {type:"listen",   say:"I eat breakfast at eight and go to work by bus.", q:"איך הדובר מגיע לעבודה?", opts:["ברכבת","ברגל","באוטובוס","במכונית"], a:2},
    {type:"read",     text:"Sara lives in a small flat. She has a red bike. On Sunday she rides to the sea with her friend.", q:"What color is Sara's bike?", opts:["Blue","Red","Green","Black"], a:1},
    {type:"read",     text:"Today is Monday. The library is open from ten to six. On Friday it is closed.", q:"When does the library open?", opts:["At six","At ten","On Friday","At eight"], a:1},
  ],
  A2: [
    {type:"grammar",  q:"Yesterday we ___ to the beach.", opts:["go","went","gone","goes"], a:1},
    {type:"vocab",    q:"מה הפירוש של 'expensive'?", opts:["זול","יקר","מהיר","קרוב"], a:1},
    {type:"sentence", q:"There isn't ___ bread left.", opts:["some","any","a","many"], a:1},
    {type:"grammar",  q:"This car is ___ than mine.", opts:["fast","faster","fastest","more fast"], a:1},
    {type:"listen",   say:"The train leaves at half past seven, so please don't be late.", q:"מתי יוצאת הרכבת?", opts:["7:00","7:15","7:30","8:30"], a:2},
    {type:"read",     text:"Maya works in a small bookshop. She starts at nine and finishes at five. On Fridays the shop closes early, at two.", q:"When does the shop close on Fridays?", opts:["At nine","At two","At five","It doesn't close"], a:1},
    {type:"vocab",    q:"מה הפירוש של 'crowded'?", opts:["ריק","צפוף","שקט","רחוק"], a:1},
    {type:"vocab",    q:"מה הפירוש של 'appointment'?", opts:["פגישה/תור","חופשה","מכתב","מתנה"], a:0},
    {type:"listen",   say:"Sorry, the doctor is busy today. Can you come tomorrow at ten?", q:"מה מוצע לדובר?", opts:["לחכות היום","לבוא מחר בעשר","לבוא מחר בשתיים","לחזור בשבוע הבא"], a:1},
    {type:"listen",   say:"We wanted to go to the park, but it started raining, so we stayed home and watched a film.", q:"מה הם עשו בסוף?", opts:["הלכו לפארק","נשארו בבית וראו סרט","הלכו לקולנוע","יצאו לקניות"], a:1},
    {type:"read",     text:"Last summer Dan visited his grandmother in the north. Every morning they picked fruit in her garden, and in the evening she taught him old songs.", q:"What did Dan do in the mornings?", opts:["Sang songs","Picked fruit","Went swimming","Cooked dinner"], a:1},
    {type:"read",     text:"The new café on our street is cheap and friendly, but it is very small, so on weekends you often have to wait for a table.", q:"What is the problem with the café?", opts:["It is expensive","The staff are rude","It is small","It is far away"], a:2},
  ],
  B1: [
    {type:"grammar",  q:"I ___ in Haifa since 2018.", opts:["live","lived","have lived","am living"], a:2},
    {type:"vocab",    q:"מה הפירוש של 'postpone'?", opts:["לבטל","לדחות","להקדים","לאשר"], a:1},
    {type:"sentence", q:"The woman ___ helped me was very kind.", opts:["which","who","what","whom"], a:1},
    {type:"grammar",  q:"If it rains tomorrow, we ___ at home.", opts:["stay","will stay","would stay","stayed"], a:1},
    {type:"vocab",    q:"מה הפירוש של 'available'?", opts:["עסוק","זמין","יקר","חסר"], a:1},
    {type:"read",     text:"Tom had never enjoyed running. But after his doctor warned him about his health, he started jogging every morning. Six months later, he finished his first 10-kilometer race.", q:"Why did Tom start running?", opts:["He always loved it","His doctor warned him about his health","He wanted to win money","His friends made him"], a:1},
    {type:"listen",   say:"I was going to call you last night, but my phone died before I could find your number.", q:"למה הדובר לא התקשר?", opts:["הוא שכח","הטלפון שלו נכבה","היה מאוחר מדי","הוא לא רצה"], a:1},
    {type:"vocab",    q:"מה הפירוש של 'reluctant'?", opts:["נלהב","מהסס/לא מתלהב","עייף","מופתע"], a:1},
    {type:"listen",   say:"I'd rather take the early train, even though it means getting up at five, because the later one is always packed.", q:"Why does the speaker prefer the early train?", opts:["It is cheaper","It is faster","The later one is crowded","She likes waking up early"], a:2},
    {type:"listen",   say:"Unless the client sends the files by noon, we won't be able to finish the report this week.", q:"What does finishing the report depend on?", opts:["The weather","The client sending files by noon","A meeting on Friday","The manager's approval"], a:1},
    {type:"read",     text:"When Noa moved abroad she expected to feel lonely, but the opposite happened: her neighbours invited her to dinner in the first week, and within a month she had joined a local choir.", q:"How did Noa's experience compare with her expectations?", opts:["It was as lonely as she feared","It was better than she expected","She never met anyone","She moved back home"], a:1},
    {type:"read",     text:"The city council has decided to close the main square to cars on weekends. Shop owners are worried about losing customers, while residents say the square is finally quiet enough to enjoy.", q:"Who is unhappy with the decision?", opts:["Residents","Shop owners","The council","Tourists"], a:1},
  ],
  B2: [
    {type:"grammar",  q:"If I had known, I ___ you.", opts:["will help","would help","would have helped","helped"], a:2},
    {type:"vocab",    q:"מה הפירוש של 'reliable'?", opts:["גמיש","אמין","זמני","יקר"], a:1},
    {type:"sentence", q:"We need to ___ a decision by Friday.", opts:["do","make","take","have"], a:1},
    {type:"grammar",  q:"By the time we arrived, the film ___.", opts:["already started","has already started","had already started","was already start"], a:2},
    {type:"vocab",    q:"מה הפירוש של 'overwhelmed'?", opts:["משועמם","מוצף (רגשית)","נלהב","אדיש"], a:1},
    {type:"read",     text:"Although the new policy was meant to save money, many employees felt it actually made their work slower. Managers, however, insisted the savings were worth the inconvenience.", q:"What does the passage suggest about the policy?", opts:["Everyone agreed it succeeded","It clearly failed completely","Its value was disputed","It was cancelled quickly"], a:2},
    {type:"listen",   say:"If the meeting had started on time, we would have finished before lunch instead of rushing through the last two points.", q:"What actually happened?", opts:["The meeting finished before lunch","The meeting started late","They skipped lunch","They cancelled two points"], a:1},
    {type:"vocab",    q:"מה הפירוש של 'to undermine'?", opts:["לחזק","לערער/לחתור תחת","להסביר","לדחות"], a:1},
    {type:"listen",   say:"Had I realised how long the queue would be, I would have booked the tickets online like everyone else.", q:"What did the speaker actually do?", opts:["Booked online","Waited in a long queue","Skipped the event","Arrived early"], a:1},
    {type:"listen",   say:"The manager admitted that the delay was down to poor planning rather than the supplier, which surprised nobody on the team.", q:"What caused the delay, according to the manager?", opts:["The supplier","Poor planning","The team","Bad weather"], a:1},
    {type:"read",     text:"Critics argue that the app's popularity owes less to its design than to aggressive marketing; its defenders point out that plenty of well-funded apps have flopped, which suggests users genuinely value it.", q:"What do the defenders imply?", opts:["Marketing explains everything","Design is irrelevant","Funding guarantees success","Users really like the app"], a:3},
    {type:"read",     text:"Although remote work has cut commuting time for many employees, some report that the boundary between work and home has all but disappeared, leaving them working longer hours than before.", q:"What downside is mentioned?", opts:["Longer commutes","Lower salaries","Working longer hours","Fewer meetings"], a:2},
  ],
  C1: [
    {type:"vocab",    q:"מה הפירוש של 'feasible'?", opts:["מסוכן","בר ביצוע","זמני","יוצא דופן"], a:1},
    {type:"grammar",  q:"Not until she left ___ how much he missed her.", opts:["he realized","did he realize","he did realize","realized he"], a:1},
    {type:"sentence", q:"The negotiations eventually broke ___ without an agreement.", opts:["up","down","off","out"], a:1},
    {type:"vocab",    q:"מה הפירוש של 'compelling' (a compelling argument)?", opts:["חלש","משכנע","מבלבל","ארוך"], a:1},
    {type:"sentence", q:"___ his experience, he was not offered the job.", opts:["Despite","Although","However","Because"], a:0},
    {type:"read",     text:"The author's tone throughout the essay is one of measured skepticism: she neither dismisses the new technology outright nor embraces the sweeping promises made on its behalf, preferring instead to ask who ultimately benefits.", q:"How does the author feel about the technology?", opts:["Enthusiastic and hopeful","Completely dismissive","Cautious and questioning","Uninformed and confused"], a:2},
    {type:"listen",   say:"Despite the board's reservations, the proposal was approved on the condition that costs be reviewed quarterly.", q:"What was the outcome?", opts:["The proposal was rejected","It was approved without conditions","It was approved with a condition","It was postponed for a quarter"], a:2},
    {type:"vocab",    q:"מה הפירוש של 'to allude to'?", opts:["לרמוז ל-","להכחיש","לצטט במדויק","להתעלם מ-"], a:0},
    {type:"listen",   say:"Whatever the merits of the plan, and there are several, pushing it through without consulting the staff is bound to backfire.", q:"What is the speaker's main concern?", opts:["The plan has no merits","The staff were not consulted","The plan is too expensive","The timing is wrong"], a:1},
    {type:"listen",   say:"She conceded that the figures were accurate, yet maintained that they had been presented in a way that was, to put it mildly, misleading.", q:"What is her position on the figures?", opts:["They are wrong","They are accurate but misleadingly presented","They are irrelevant","They were hidden"], a:1},
    {type:"read",     text:"The biography is scrupulously researched, yet its very thoroughness works against it: the reader is so buried in detail that the man himself, contradictory and restless, never quite comes into focus.", q:"What is the reviewer's main criticism?", opts:["The research is careless","There is too much detail to see the subject clearly","The subject is uninteresting","The book is too short"], a:1},
    {type:"read",     text:"It would be naive to attribute the region's recovery solely to the new investment; the groundwork had been laid a decade earlier by reforms that were deeply unpopular at the time.", q:"What does the author suggest about the reforms?", opts:["They were popular and effective","They contributed to the recovery despite being unpopular","They failed completely","They came after the investment"], a:1},
  ],
  C2: [
    {type:"vocab",    q:"מה הפירוש של 'ubiquitous'?", opts:["נדיר","נמצא בכל מקום","מיושן","סודי"], a:1},
    {type:"sentence", q:"Rarely ___ such a unanimous response from critics.", opts:["a film has received","has a film received","a film received","received a film"], a:1},
    {type:"vocab",    q:"מה המשמעות של 'to concede a point'?", opts:["להתעקש על העמדה","להודות שהצד השני צודק בנקודה","לשנות נושא","לחזור על טיעון"], a:1},
    {type:"sentence", q:"The committee's decision, ___ controversial, was ultimately upheld.", opts:["while","despite","however","because"], a:0},
    {type:"read",     text:"Her prose has a deceptive simplicity; what reads at first as plain reportage reveals, on closer inspection, a carefully layered irony that quietly undercuts its own certainties.", q:"What is implied about her writing?", opts:["It is simple and direct","It only appears simple but is subtly complex","It is careless and unclear","It is heavily decorated"], a:1},
    {type:"read",     text:"Far from being a neutral tool, the algorithm encodes the priorities of those who build it — a fact its designers are often the last to acknowledge.", q:"What is the main point?", opts:["Algorithms are fully objective","Algorithms reflect their makers' choices","Designers understand their tools best","The tool is simply broken"], a:1},
    {type:"listen",   say:"Far from settling the matter, the report merely reframed the question in terms nobody had asked for.", q:"What does the speaker think of the report?", opts:["It resolved the issue","It answered the right question","It did not settle anything","It was widely welcomed"], a:2},
    {type:"vocab",    q:"מה הפירוש של 'perfunctory' (a perfunctory apology)?", opts:["כן ועמוק","שטחי, נעשה כלאחר יד","מאוחר","ארוך ומפורט"], a:1},
    {type:"sentence", q:"So absorbed ___ in the book that she missed her stop.", opts:["she was","was she","she had been","had she"], a:1},
    {type:"listen",   say:"One might be forgiven for assuming the reforms were cosmetic, were it not for the quiet but decisive shift in who now holds the purse strings.", q:"What does the speaker imply about the reforms?", opts:["They are purely cosmetic","They are more substantial than they seem","They have been reversed","They are unpopular"], a:1},
    {type:"listen",   say:"His resignation, tendered with characteristic understatement, said less about the scandal itself than about how thoroughly he had lost the confidence of his own allies.", q:"What is the main point?", opts:["The scandal was minor","He resigned loudly","He had lost his allies' support","He denied everything"], a:2},
    {type:"read",     text:"That the treaty survived at all is remarkable; that it did so largely intact, despite being disowned by the very government that negotiated it, borders on the inexplicable.", q:"What is surprising about the treaty?", opts:["It was quickly rejected","It remained mostly unchanged despite its own government disowning it","It was renegotiated","It was never signed"], a:1},
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
