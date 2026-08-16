// נושאי דקדוק: הסבר קצר בעברית, דוגמאות, ותרגול. ההסבר המורחב מוצג רק אחרי טעות.
// כל הסבר טעות (why) נכתב פשוט, ספציפי למשפט, ובלי ז'רגון — כמו מורה שמסביר בשקט.
export const GRAMMAR = [
  {
    id:"present-simple", name:"Present Simple", lvl:"A1",
    short:"משתמשים ב-Present Simple לפעולות קבועות, הרגלים ועובדות. בגוף שלישי יחיד (he/she/it) מוסיפים s לפועל.",
    more:"הרחבה: שאלות ושלילה נבנות עם do/does — He works → Does he work? / He doesn't work. מילים אופייניות: always, usually, every day, never.",
    examples:[
      ["I drink coffee every morning.","אני שותה קפה כל בוקר."],
      ["She works in a hospital.","היא עובדת בבית חולים."],
      ["They don't watch TV.","הם לא צופים בטלוויזיה."],
    ],
    quiz:[
      {q:"She ___ English every day.", opts:["study","studies","studying","studied"], a:1, why:"עם she / he / it מוסיפים s לפועל, לכן studies. (עם I / you / we / they — בלי s.)"},
      {q:"___ he like pizza?", opts:["Do","Is","Does","Are"], a:2, why:"שאלה על he / she / it מתחילה ב-Does. (עם I / you / we / they זה Do.)"},
      {q:"We ___ to work by bus.", opts:["goes","going","go","gone"], a:2, why:"עם we הפועל נשאר רגיל, בלי s: go."},
      {q:"My brother ___ meat.", opts:["don't eat","doesn't eat","not eat","doesn't eats"], a:1, why:"שלילה על 'הוא': doesn't ואז הפועל רגיל — doesn't eat. לא doesn't eats."},
      {q:"The train ___ at 8:00.", opts:["leave","leaves","leaving","is leave"], a:1, why:"לוח זמנים קבוע. train זה 'it', ולכן leaves עם s."},
    ]
  },
  {
    id:"present-progressive", name:"Present Progressive", lvl:"A1",
    short:"משתמשים ב-am/is/are + פועל עם ing לפעולות שקורות עכשיו או סביב עכשיו.",
    more:"הרחבה: I am eating / She is reading / They are playing. מילים אופייניות: now, right now, at the moment. פעלים כמו know, like, want בדרך כלל לא מקבלים ing.",
    examples:[
      ["I'm learning English right now.","אני לומד אנגלית ממש עכשיו."],
      ["She is talking on the phone.","היא מדברת בטלפון."],
      ["They are waiting outside.","הם מחכים בחוץ."],
    ],
    quiz:[
      {q:"Quiet, please! The baby ___.", opts:["sleeps","is sleeping","sleep","slept"], a:1, why:"זה קורה ממש עכשיו, לכן is + פועל עם ing — is sleeping."},
      {q:"Look! It ___.", opts:["rains","rain","is raining","rained"], a:2, why:"המילה Look! אומרת שזה קורה עכשיו מול העיניים — is raining."},
      {q:"We ___ for the bus now.", opts:["wait","are waiting","waits","waited"], a:1, why:"now = קורה כרגע, לכן are waiting."},
      {q:"I ___ this word.", opts:["am knowing","know","knowing","knows"], a:1, why:"יש פעלים (know, like, want) שלא באים עם ing, גם כשזה עכשיו. פשוט: I know."},
    ]
  },
  {
    id:"past-simple", name:"Past Simple", lvl:"A2",
    short:"משתמשים ב-Past Simple לפעולות שהסתיימו בעבר. פעלים רגילים מקבלים ed, ויש פעלים חריגים (go→went, see→saw).",
    more:"הרחבה: שאלות ושלילה עם did + פועל בסיס: Did you go? / I didn't go (לא didn't went!). מילים אופייניות: yesterday, last week, ago, in 2020.",
    examples:[
      ["I visited my grandmother yesterday.","ביקרתי את סבתא שלי אתמול."],
      ["She went to London last year.","היא נסעה ללונדון בשנה שעברה."],
      ["We didn't see the movie.","לא ראינו את הסרט."],
    ],
    quiz:[
      {q:"I ___ to the beach yesterday.", opts:["go","goed","went","gone"], a:2, why:"go הוא פועל מיוחד: בעבר הוא הופך ל-went (לא 'goed')."},
      {q:"___ you call him last night?", opts:["Did","Do","Was","Have"], a:0, why:"שאלה בעבר מתחילה ב-Did, והפועל נשאר רגיל: Did you call?"},
      {q:"She ___ the answer.", opts:["didn't knew","didn't know","don't know","not knew"], a:1, why:"אחרי didn't הפועל חוזר לצורה הרגילה: didn't know (לא 'didn't knew')."},
      {q:"They ___ dinner at eight.", opts:["eated","ate","eaten","eat"], a:1, why:"eat הוא פועל מיוחד: בעבר ate (לא 'eated')."},
      {q:"We ___ TV two hours ago.", opts:["watch","watches","watched","watching"], a:2, why:"ago אומר שזה בעבר. פועל רגיל מקבל ed: watched."},
    ]
  },
  {
    id:"future", name:"Future — will / going to", lvl:"A2",
    short:"will להחלטות רגעיות ותחזיות; be going to לתוכניות שכבר הוחלטו.",
    more:"הרחבה: I'll help you (החלטה עכשיו) לעומת I'm going to visit my parents on Friday (תוכנית קיימת). שלילה: won't = will not.",
    examples:[
      ["I will call you tonight.","אתקשר אליך הערב."],
      ["We are going to move next month.","אנחנו עומדים לעבור דירה בחודש הבא."],
      ["It won't rain tomorrow.","לא ירד גשם מחר."],
    ],
    quiz:[
      {q:"Wait, I ___ you with those bags.", opts:["am going to help","will help","helping","helped"], a:1, why:"החלטת עכשיו, ברגע זה, לעזור — לכן will help."},
      {q:"Look at those clouds! It ___ rain.", opts:["will","is going to","would","won't"], a:1, why:"רואים סימנים (עננים) ומנחשים מה יקרה — לכן going to."},
      {q:"She ___ study medicine next year.", opts:["is going to","will going","going","go to"], a:0, why:"תוכנית שכבר הוחלטה מראש — is going to."},
      {q:"Don't worry, I ___ forget.", opts:["will","won't","am not","don't will"], a:1, why:"won't זה הקיצור של will not — כלומר 'לא אשכח'."},
    ]
  },
  {
    id:"present-perfect", name:"Present Perfect", lvl:"B1",
    short:"have/has + V3 לפעולות שקרו בעבר עם תוצאה או קשר להווה, או לחוויות חיים בלי זמן מוגדר.",
    more:"הרחבה: I have been to Paris (חוויה, לא משנה מתי) לעומת I went to Paris in 2019 (זמן מוגדר → Past Simple). מילים אופייניות: ever, never, already, yet, just, since, for.",
    examples:[
      ["I have finished my homework.","סיימתי את שיעורי הבית (וזה רלוונטי עכשיו)."],
      ["She has never eaten sushi.","היא מעולם לא אכלה סושי."],
      ["We have lived here since 2015.","אנחנו גרים כאן מאז 2015."],
    ],
    quiz:[
      {q:"I ___ this movie three times.", opts:["saw","have seen","see","am seeing"], a:1, why:"חוויה שקרתה עד היום, בלי לומר מתי בדיוק — have seen."},
      {q:"___ you ever ___ to Japan?", opts:["Did / go","Have / been","Do / go","Are / going"], a:1, why:"שאלה על חוויה בחיים ('אי פעם') נבנית כך: Have you ever been...?"},
      {q:"She ___ her keys, so she can't get in.", opts:["lost","has lost","loses","losing"], a:1, why:"קרה בעבר אבל התוצאה עכשיו (אין לה מפתחות) — לכן has lost."},
      {q:"We have known each other ___ ten years.", opts:["since","for","ago","from"], a:1, why:"for בא עם כמות זמן (ten years). since בא עם נקודת התחלה (since 2010)."},
    ]
  },
  {
    id:"comparatives", name:"השוואות — Comparatives & Superlatives", lvl:"A2",
    short:"מילים קצרות: er / est (bigger, biggest). מילים ארוכות: more / most (more expensive). חריגים: good→better→best, bad→worse→worst.",
    more:"הרחבה: משווים עם than: She is taller than me. הכי: the + est/most: the best coffee in town. לא אומרים more better.",
    examples:[
      ["This phone is cheaper than that one.","הטלפון הזה זול יותר מההוא."],
      ["It's the most interesting book I've read.","זה הספר הכי מעניין שקראתי."],
      ["My English is getting better.","האנגלית שלי משתפרת."],
    ],
    quiz:[
      {q:"Today is ___ than yesterday.", opts:["hot","hotter","more hot","hottest"], a:1, why:"מילה קצרה מקבלת er: hot → hotter. (ואז than.)"},
      {q:"This is ___ restaurant in the city.", opts:["better","the best","most good","the goodest"], a:1, why:"good היא מילה מיוחדת: good → better → the best."},
      {q:"The test was ___ than I expected.", opts:["more easy","easyer","easier","most easy"], a:2, why:"easy נגמר ב-y, אז ה-y הופך ל-ier: easier."},
      {q:"This hotel is ___ expensive than ours.", opts:["more","most","much","many"], a:0, why:"מילה ארוכה (expensive) לא מקבלת er — שמים more לפניה: more expensive."},
    ]
  },
  {
    id:"modals", name:"פעלי עזר — can / should / must", lvl:"B1",
    short:"can ליכולת ורשות, should לעצה, must / have to לחובה. אחרי כולם פועל בצורת הבסיס.",
    more:"הרחבה: שלילות — can't (אי אפשר), shouldn't (לא כדאי), mustn't (אסור), don't have to (לא חייבים — אבל מותר!). שימו לב להבדל בין mustn't ל-don't have to.",
    examples:[
      ["You should drink more water.","כדאי לך לשתות יותר מים."],
      ["I can meet you at five.","אני יכול להיפגש איתך בחמש."],
      ["You must wear a seatbelt.","חובה לחגור חגורת בטיחות."],
    ],
    quiz:[
      {q:"You look tired. You ___ go to sleep.", opts:["can","should","must not","would"], a:1, why:"should = כדאי לך. זו עצה ידידותית."},
      {q:"She ___ speak three languages.", opts:["can","should","must","can to"], a:0, why:"can = מסוגלת, יודעת. אחריו פועל רגיל: can speak."},
      {q:"You ___ smoke here. It's forbidden.", opts:["don't have to","shouldn't","mustn't","couldn't"], a:2, why:"forbidden = אסור. 'אסור' באנגלית זה mustn't."},
      {q:"It's free — you ___ pay.", opts:["mustn't","don't have to","can't","shouldn't"], a:1, why:"don't have to = לא חייב (אבל מותר). זה שונה מ-mustn't שפירושו אסור."},
    ]
  },
  {
    id:"prepositions", name:"מילות יחס — in / on / at", lvl:"A2",
    short:"זמן: at 5:00, on Monday, in May. מקום: at the door, on the table, in the room.",
    more:"הרחבה: at לנקודות (at night, at the bus stop), on למשטחים ותאריכים (on the wall, on July 4th), in לתקופות ומרחבים סגורים (in the morning, in the box).",
    examples:[
      ["The meeting is at 3 o'clock on Tuesday.","הפגישה בשלוש ביום שלישי."],
      ["Your keys are on the table.","המפתחות שלך על השולחן."],
      ["We met in 2020.","נפגשנו ב-2020."],
    ],
    quiz:[
      {q:"I wake up ___ 7 o'clock.", opts:["on","in","at","by"], a:2, why:"שעה מדויקת באה עם at: at 7 o'clock."},
      {q:"My birthday is ___ March.", opts:["at","on","in","of"], a:2, why:"חודש בא עם in: in March."},
      {q:"See you ___ Sunday!", opts:["in","on","at","to"], a:1, why:"יום בשבוע בא עם on: on Sunday."},
      {q:"The picture is ___ the wall.", opts:["in","at","on","over"], a:2, why:"משהו על משטח (קיר, שולחן) בא עם on: on the wall."},
    ]
  },
  {
    id:"articles", name:"a / an / the", lvl:"A1",
    short:"a/an לדבר כללי שמוזכר בפעם הראשונה (an לפני צליל תנועה), the לדבר מסוים או שכבר הוזכר.",
    more:"הרחבה: I saw a dog. The dog was small (בפעם השנייה — the). לא שמים a לפני רבים או שמות בלתי ספירים: water, advice, music.",
    examples:[
      ["I need a new phone.","אני צריך טלפון חדש."],
      ["She's an engineer.","היא מהנדסת."],
      ["The sun is strong today.","השמש חזקה היום."],
    ],
    quiz:[
      {q:"He's eating ___ apple.", opts:["a","an","the","—"], a:1, why:"apple מתחיל בצליל תנועה (a-פל), ולפני צליל כזה אומרים an ולא a."},
      {q:"I bought a shirt. ___ shirt is blue.", opts:["A","An","The","This a"], a:2, why:"כבר דיברנו על החולצה הזאת, אז בפעם השנייה אומרים the."},
      {q:"Can you give me ___ advice?", opts:["an","a","some","the a"], a:2, why:"advice לא נספר (אין 'עצה אחת' באנגלית), אז אומרים some advice."},
      {q:"She plays ___ piano.", opts:["a","an","the","—"], a:2, why:"כלי נגינה מקבלים the: play the piano."},
    ]
  },
  {
    id:"conditionals", name:"משפטי תנאי — First & Second Conditional", lvl:"B2",
    short:"תנאי אמיתי: If + הווה, ואז will (If it rains, we'll stay home). תנאי דמיוני: If + עבר, ואז would (If I had time, I would travel).",
    more:"טיפ קטן וחשוב: אחרי If אף פעם לא כותבים will. ובתנאי דמיוני אומרים If I were (לא was): If I were you, I would apologize.",
    examples:[
      ["If you practice daily, you'll improve fast.","אם תתרגל יומיום, תשתפר מהר."],
      ["If I won the lottery, I would buy a house.","אם הייתי זוכה בלוטו, הייתי קונה בית."],
      ["If I were you, I'd take the job.","אם הייתי במקומך, הייתי לוקח את העבודה."],
    ],
    quiz:[
      {q:"If it rains, we ___ at home.", opts:["stay","will stay","would stay","stayed"], a:1, why:"מצב אמיתי שיכול לקרות: אחרי החלק של If (בהווה) בא will — we will stay."},
      {q:"If I ___ rich, I would travel the world.", opts:["am","will be","were","have been"], a:2, why:"זה חלום דמיוני (אני לא באמת עשיר), ובמקרה כזה אומרים were: If I were rich."},
      {q:"If you ___ hard, you'll pass the test.", opts:["will study","study","studied","would study"], a:1, why:"אחרי If אף פעם לא כותבים will — משאירים הווה פשוט: If you study."},
      {q:"If I were you, I ___ apologize.", opts:["will","would","was","am"], a:1, why:"'If I were you' = 'אם הייתי במקומך' — זה דמיוני, ואחרי משפט כזה תמיד בא would, אף פעם will."},
    ]
  },
];

export function grammarById(id){ return GRAMMAR.find(g => g.id === id); }
