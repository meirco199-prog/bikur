// קטעי קריאה מקוריים לפי רמה ותחום עניין, עם שאלות הבנה.
export const ARTICLES = [
  {id:"coffee", lvl:"A1", topic:"food", title:"A Morning Coffee",
   text:"Tom wakes up at seven. He makes coffee and toast. He drinks his coffee on the balcony. The morning is quiet. Then he takes the bus to work. He is happy because today is Friday.",
   he:"טום מתעורר בשבע. הוא מכין קפה וטוסט. הוא שותה את הקפה במרפסת. הבוקר שקט. אחר כך הוא נוסע באוטובוס לעבודה. הוא שמח כי היום יום שישי.",
   qs:[
     {q:"מתי טום מתעורר?", opts:["בשש","בשבע","בשמונה","בתשע"], a:1},
     {q:"למה טום שמח?", opts:["הוא בחופשה","היום יום שישי","הוא קיבל מתנה","מזג האוויר יפה"], a:1},
   ]},
  {id:"market", lvl:"A1", topic:"food", title:"At the Market",
   text:"Maya goes to the market on Sunday. She buys apples, bread, and cheese. The tomatoes look fresh, so she buys some too. The seller gives her a small discount. She pays and says thank you.",
   he:"מאיה הולכת לשוק ביום ראשון. היא קונה תפוחים, לחם וגבינה. העגבניות נראות טריות, אז היא קונה גם מהן. המוכר נותן לה הנחה קטנה. היא משלמת ואומרת תודה.",
   qs:[
     {q:"מתי מאיה הולכת לשוק?", opts:["ביום שישי","ביום ראשון","ביום שלישי","בשבת"], a:1},
     {q:"מה המוכר נותן לה?", opts:["שקית","מתנה","הנחה קטנה","קבלה"], a:2},
   ]},
  {id:"tlv", lvl:"A2", topic:"travel", title:"A Weekend Trip",
   text:"Last weekend, Danny and his sister took a train to the north. They walked in a green forest and swam in a small river. In the evening, they ate dinner in a little village. The food was simple but delicious. Danny took many photos. On the way home, they were tired but happy.",
   he:"בסוף השבוע שעבר, דני ואחותו נסעו ברכבת לצפון. הם טיילו ביער ירוק ושחו בנחל קטן. בערב הם אכלו ארוחת ערב בכפר קטן. האוכל היה פשוט אבל טעים. דני צילם המון תמונות. בדרך הביתה הם היו עייפים אבל שמחים.",
   qs:[
     {q:"איך הם הגיעו לצפון?", opts:["באוטובוס","ברכב","ברכבת","באופניים"], a:2},
     {q:"איך היה האוכל?", opts:["יקר","פשוט וטעים","לא טעים","קר"], a:1},
   ]},
  {id:"newjob", lvl:"A2", topic:"work", title:"The New Job",
   text:"Noa started a new job this week. On the first day, she was nervous. Her manager showed her the office and introduced the team. Everyone was friendly. At lunch, two colleagues invited her to join them. By Thursday, she already felt like part of the team.",
   he:"נועה התחילה עבודה חדשה השבוע. ביום הראשון היא הייתה לחוצה. המנהלת שלה הראתה לה את המשרד והציגה את הצוות. כולם היו נחמדים. בצהריים, שני קולגות הזמינו אותה להצטרף אליהם. עד יום חמישי היא כבר הרגישה חלק מהצוות.",
   qs:[
     {q:"איך נועה הרגישה ביום הראשון?", opts:["בטוחה","לחוצה","עייפה","משועממת"], a:1},
     {q:"מה קרה בצהריים?", opts:["הייתה פגישה","קולגות הזמינו אותה","היא הלכה הביתה","היא פגשה לקוח"], a:1},
   ]},
  {id:"phone", lvl:"B1", topic:"tech", title:"A Week Without a Phone",
   text:"Omer decided to try a week without his smartphone. The first two days were difficult — he kept reaching for his pocket. But slowly, things changed. He read two books, slept better, and had longer conversations with his family. When the week ended, he turned his phone back on, but he also made a new rule: no screens after nine in the evening.",
   he:"עומר החליט לנסות שבוע בלי הסמארטפון. היומיים הראשונים היו קשים — הוא כל הזמן שלח יד לכיס. אבל לאט לאט המצב השתנה. הוא קרא שני ספרים, ישן טוב יותר, וניהל שיחות ארוכות יותר עם המשפחה. כשהשבוע נגמר, הוא הדליק את הטלפון שוב, אבל גם קבע כלל חדש: בלי מסכים אחרי תשע בערב.",
   qs:[
     {q:"מה היה קשה בהתחלה?", opts:["לישון","להתרגל בלי הטלפון","לקרוא","לדבר עם המשפחה"], a:1},
     {q:"איזה כלל חדש עומר קבע?", opts:["בלי טלפון בעבודה","בלי מסכים אחרי תשע","לקרוא ספר בשבוע","לישון שמונה שעות"], a:1},
   ]},
  {id:"marathon", lvl:"B1", topic:"sports", title:"The First Marathon",
   text:"When Lior signed up for the city marathon, his friends thought he was joking. He had never run more than five kilometers. He trained for six months, waking up early three times a week. On race day, it rained, and at kilometer thirty he wanted to quit. But the crowd cheered, and he kept going. He crossed the finish line after four and a half hours — exhausted, soaked, and prouder than he had ever been.",
   he:"כשליאור נרשם למרתון העירוני, חבריו חשבו שהוא צוחק. הוא מעולם לא רץ יותר מחמישה קילומטרים. הוא התאמן שישה חודשים, קם מוקדם שלוש פעמים בשבוע. ביום המרוץ ירד גשם, ובקילומטר השלושים הוא רצה לפרוש. אבל הקהל עודד, והוא המשיך. הוא חצה את קו הסיום אחרי ארבע שעות וחצי — מותש, רטוב, וגאה מתמיד.",
   qs:[
     {q:"כמה זמן ליאור התאמן?", opts:["שלושה חודשים","שישה חודשים","שנה","חודש"], a:1},
     {q:"מה קרה בקילומטר 30?", opts:["הוא נפצע","הוא רצה לפרוש","הוא עצר לשתות","הוא הוביל במרוץ"], a:1},
   ]},
  {id:"ai-work", lvl:"B2", topic:"tech", title:"Learning to Work with AI",
   text:"Two years ago, Michal worried that artificial intelligence would replace her job as a translator. Instead, it transformed it. Today she uses AI tools to produce a first draft in seconds, then spends her time on what machines still struggle with: tone, humor, and cultural nuance. Her clients pay for judgment, not typing. 'The tools got faster,' she says, 'but taste is still human.'",
   he:"לפני שנתיים, מיכל חששה שבינה מלאכותית תחליף אותה בעבודתה כמתרגמת. במקום זאת, היא שינתה אותה. היום היא משתמשת בכלי AI כדי להפיק טיוטה ראשונה בשניות, ואז משקיעה את זמנה במה שמכונות עדיין מתקשות בו: טון, הומור וניואנס תרבותי. הלקוחות שלה משלמים על שיקול דעת, לא על הקלדה. 'הכלים נהיו מהירים יותר,' היא אומרת, 'אבל טעם הוא עדיין אנושי.'",
   qs:[
     {q:"ממה מיכל חששה?", opts:["שהשכר יירד","שה-AI יחליף אותה","שלא תמצא לקוחות","שהעבודה תשעמם"], a:1},
     {q:"על מה הלקוחות משלמים לדבריה?", opts:["מהירות","שיקול דעת","כמות מילים","זמינות"], a:1},
   ]},
  {id:"minimalism", lvl:"B2", topic:"general", title:"Less, but Better",
   text:"After moving apartments three times in five years, Yuval counted his boxes and made a decision: everything he hadn't touched in a year would go. He sold, donated, and recycled nearly half of what he owned. The surprising part wasn't the extra space — it was the extra attention. Fewer choices in the morning meant more energy for decisions that actually mattered.",
   he:"אחרי שעבר דירה שלוש פעמים בחמש שנים, יובל ספר את הקופסאות והחליט: כל מה שלא נגע בו שנה — הולך. הוא מכר, תרם ומיחזר כמעט חצי ממה שהיה לו. החלק המפתיע לא היה המקום הפנוי — אלא תשומת הלב הפנויה. פחות בחירות בבוקר משמעותן יותר אנרגיה להחלטות שבאמת חשובות.",
   qs:[
     {q:"מה יובל עשה עם החפצים?", opts:["אחסן אותם","מכר, תרם ומיחזר","זרק הכול","נתן למשפחה"], a:1},
     {q:"מה הפתיע אותו?", opts:["המקום הפנוי","תשומת הלב הפנויה","הכסף שקיבל","הקושי להיפרד"], a:1},
   ]},
  {id:"stadium", lvl:"C1", topic:"sports", title:"The Twelfth Player",
   text:"Sports economists have long debated whether home advantage is a measurable force or a comforting myth. Recent seasons played in empty stadiums offered a rare natural experiment, and the results were striking: without crowds, home teams won noticeably less often, and referees awarded fewer decisions in their favor. The roar of the stands, it turns out, is not merely atmosphere — it subtly scrutinizes and sways every judgment call on the field.",
   he:"כלכלני ספורט מתווכחים מזמן האם יתרון הביתיות הוא כוח מדיד או מיתוס מנחם. עונות שנוהלו באצטדיונים ריקים סיפקו ניסוי טבעי נדיר, והתוצאות היו מרשימות: בלי קהל, קבוצות ביתיות ניצחו פחות באופן ניכר, ושופטים העניקו פחות החלטות לטובתן. שאגת היציעים, מסתבר, היא לא רק אווירה — היא בוחנת ומטה בעדינות כל החלטת שיפוט על המגרש.",
   qs:[
     {q:"מה אפשרו העונות באצטדיונים ריקים?", opts:["חיסכון כספי","ניסוי טבעי נדיר","שיפור ברמת המשחק","פחות פציעות"], a:1},
     {q:"על מי הקהל משפיע לפי הקטע?", opts:["רק על השחקנים","רק על המאמנים","גם על השופטים","על אף אחד"], a:2},
   ]},
];

export function articlesFor(lvl, interests){
  const order = ["A1","A2","B1","B2","C1","C2"];
  const idx = Math.max(0, order.indexOf(lvl));
  // חלון: עד שתי רמות מתחת ועד רמה אחת מעל — כך תמיד יש קטעים נוחים,
  // ולא רק אתגר כבד. קטעים ברמה או מתחתיה מופיעים ראשונים.
  const ok = ARTICLES.filter(a => {
    const d = order.indexOf(a.lvl) - idx;
    return d >= -2 && d <= 1;
  });
  const score = a => {
    const d = order.indexOf(a.lvl) - idx;
    const comfy = d <= 0 ? 0 : 1;                       // ברמה/מתחתיה קודם
    const interest = interests?.includes(a.topic) ? 0 : 1; // תחום עניין קודם
    return comfy * 10 + interest * 4 + order.indexOf(a.lvl); // ואז לפי רמה עולה
  };
  ok.sort((a, b) => score(a) - score(b));
  return ok.length ? ok : ARTICLES;
}
