// ספריית התוכן של הקורס: נושאי שיעור, אוצר מילים עם עברית, נקודת דקדוק, סיפור לקריאה
// בשלוש רמות (A = A1-A2, B = B1, C = B2+), שאלות שמובילות מהטקסט לשיחה אישית, ואתגר.
// תוכן מקורי. המנוע ב-curriculum.js בוחר, מסדר ומתאים לפי הפרופיל והזיכרון.
export const BANDS = { A1: "A", A2: "A", B1: "B", B2: "C", C1: "C", C2: "C" };

export const TOPICS = [
  {
    id: "intro", level: "A1", title: "Introducing yourself", he: "להציג את עצמך",
    goals: ["לספר על עצמך ב-5-6 משפטים", "לשאול ולענות על שאלות היכרות"],
    vocab: [["job", "עבודה, מקצוע"], ["hobby", "תחביב"], ["married", "נשוי/ה"], ["neighborhood", "שכונה"], ["originally", "במקור"], ["free time", "זמן פנוי"]],
    grammar: { name: "Present Simple — to be / have", tip: "I am / I have. אומרים I am a teacher, לא I teacher. יש לי = I have." },
    story: {
      A: "My name is Dana. I am 34 years old and I live in Haifa with my husband and two kids. I work as a nurse in a big hospital. In my free time I like to cook and to walk on the beach. On Fridays we eat dinner with my parents. I want to speak English better because I want to travel.",
      B: "Let me introduce myself. I'm Dana, I'm thirty-four, and I've lived in Haifa my whole life — although I was born in a small town in the north. I work as a nurse at a large hospital, which means long shifts but also a lot of interesting people. In my free time I cook, I walk on the beach, and lately I've started learning English seriously, because next year we're planning a long trip to Australia.",
      C: "I suppose the easiest way to introduce myself is through the things that take up my days. I'm Dana, thirty-four, a nurse in the emergency department of a large hospital in Haifa — a job that is exhausting, unpredictable, and somehow still the thing I'd choose again. I grew up in a small town in the north and moved to the city for university, expecting to leave after a few years; twelve years later, I'm still here, married, with two kids and a stubborn dog. I've decided to take my English seriously this year because a long trip to Australia is finally on the calendar, and I don't want to spend it pointing at menus.",
    },
    questions: ["Where does Dana live, and what is her job?", "What does she do in her free time?", "Why does she want to improve her English?", "Now you: tell me about yourself in the same way — where you live, what you do, what you like.", "What is one thing you and Dana have in common?"],
    challenge: "Introduce yourself for 45 seconds without stopping — name, city, job, family, hobbies, why you learn English.",
  },
  {
    id: "routine", level: "A1", title: "Daily routine", he: "שגרת יום",
    goals: ["לתאר יום רגיל מהבוקר עד הערב", "להשתמש במילות זמן ותדירות"],
    vocab: [["wake up", "להתעורר"], ["commute", "נסיעה לעבודה"], ["usually", "בדרך כלל"], ["schedule", "לוח זמנים"], ["exhausted", "מותש"], ["relax", "להירגע"]],
    grammar: { name: "Present Simple + adverbs of frequency", tip: "always / usually / sometimes / never באים לפני הפועל: I usually wake up at 6." },
    story: {
      A: "Tom wakes up at six every day. He drinks coffee and reads the news. At seven he takes the train to work. He works in an office in Tel Aviv. At one o'clock he eats lunch with friends. He comes home at six, cooks dinner, and watches TV. On Saturday he sleeps late.",
      B: "Tom's weekdays look almost the same. He wakes up at six, drinks a strong coffee, and checks the news before the kids get up. His commute takes forty minutes by train, which he uses to answer emails. Lunch is usually a quick salad at his desk, unless a colleague suggests going out. He gets home around six, exhausted, cooks something simple, and falls asleep on the couch. Saturdays are different: nobody sets an alarm.",
      C: "Tom likes to say that his weekdays run on rails, and it isn't only because of the train. Up at six, coffee that could wake a horse, a quick scan of the headlines before the kids surface; then the forty-minute commute, which he has turned into his most productive hour of the day. He rarely takes a real lunch break — a salad at his desk, eyes still on the screen — and by the time he walks in at six he is too drained to do more than cook something simple and collapse. Saturdays, though, belong to nobody's schedule, and he guards them fiercely.",
    },
    questions: ["What time does Tom wake up, and how does he get to work?", "What does he usually do for lunch?", "Why do you think Saturdays are different for him?", "Describe your own typical day — from waking up until you go to sleep.", "What would you change about your routine if you could?"],
    challenge: "Describe your whole day yesterday, in order, using at least five time words (first, then, after that, at 8, finally).",
  },
  {
    id: "past", level: "A2", title: "Talking about the past", he: "לדבר על העבר",
    goals: ["לספר מה קרה אתמול / בשבוע שעבר", "פעלים חריגים נפוצים בעבר"],
    vocab: [["yesterday", "אתמול"], ["ago", "לפני (זמן)"], ["suddenly", "פתאום"], ["forgot", "שכחתי (forget)"], ["arrived", "הגעתי (arrive)"], ["luckily", "למזלי"]],
    grammar: { name: "Past Simple", tip: "פועל רגיל + ed (worked). חריגים: go→went, see→saw, take→took. שלילה: didn't + פועל בסיס (didn't go, לא didn't went)." },
    story: {
      A: "Last Sunday I had a bad morning. I woke up late because I forgot my alarm. I ran to the bus, but the bus left. I waited twenty minutes. When I arrived at work, my boss was angry. But luckily, at lunch my friend brought me a good sandwich, and the day was better.",
      B: "Last Sunday started badly. I woke up forty minutes late because my phone had died during the night, so there was no alarm. I ran to the bus stop just in time to watch the bus pull away. By the time I arrived at the office, my boss had already started the meeting, and she gave me a look I won't forget. Luckily, the afternoon was calmer, and a colleague brought me coffee and a sandwich, which saved my mood.",
      C: "Last Sunday had the shape of a bad joke. My phone had quietly died overnight, taking the alarm with it, so I surfaced forty minutes late with that specific panic that makes every small task slower. I reached the bus stop just in time to watch the bus pull away, then spent twenty minutes composing apologies in my head. By the time I walked into the office, the meeting had started without me, and my boss offered a look that said everything she was too polite to say. The day recovered, as days do — a colleague appeared with coffee and a sandwich around one — but I've charged my phone every single night since.",
    },
    questions: ["Why did the narrator wake up late?", "What happened at the bus stop?", "How did the day get better?", "Tell me about a morning when everything went wrong for you.", "What did you do yesterday? Tell me three things, in the past tense."],
    challenge: "Tell me the story of your last weekend for 45 seconds, using only the past tense.",
  },
  {
    id: "restaurant", level: "A2", title: "At a restaurant", he: "במסעדה",
    goals: ["להזמין אוכל ולבקש דברים בנימוס", "להתלונן ולפתור בעיה בעדינות"],
    vocab: [["order", "להזמין"], ["waiter", "מלצר"], ["bill", "חשבון"], ["recommend", "להמליץ"], ["allergic", "אלרגי"], ["overcooked", "מבושל יותר מדי"]],
    grammar: { name: "Polite requests — Could I / Would you", tip: "Could I have the menu? / Would you bring the bill, please? — בקשה מנומסת, לא Give me." },
    story: {
      A: "Maya and Ron go to a new restaurant. The waiter gives them the menu. Maya orders fish, and Ron orders pasta. After ten minutes the food comes. Ron's pasta is cold. He calls the waiter and says, 'Excuse me, my pasta is cold.' The waiter says sorry and brings new pasta. At the end they pay the bill and leave a tip.",
      B: "Maya and Ron finally tried the new Italian place near the port. The waiter recommended the sea bass, so Maya ordered it, while Ron went for the mushroom pasta. The food arrived quickly, but Ron's pasta was almost cold in the middle. He waited for the waiter to pass and said politely, 'Excuse me, I think this has been sitting for a while — could you warm it up?' The waiter apologized, brought a fresh plate, and didn't charge them for dessert.",
      C: "Maya and Ron had been meaning to try the new Italian place by the port for months, and on Thursday they finally got a table. The waiter — young, a little too enthusiastic — steered Maya toward the sea bass and Ron toward a mushroom pasta he described as 'life-changing'. The fish was excellent; the pasta, unfortunately, arrived lukewarm at the edges and cold at the center. Ron, who dislikes making a fuss, waited for the right moment and said, 'I'm sorry to bother you, but I think this one sat a bit too long — would you mind warming it up?' To the waiter's credit, he apologized without excuses, returned with a fresh plate, and quietly took dessert off the bill.",
    },
    questions: ["What did Maya and Ron order?", "What was wrong with Ron's dish, and what did he say?", "How did the waiter handle it — do you think that was good service?", "How do you usually react when something is wrong in a restaurant?", "Describe your favorite restaurant to me — what should I order there?"],
    challenge: "Role-play: I'm the waiter. Order a full meal, ask a question about the menu, and then complain politely about something.",
  },
  {
    id: "work", level: "B1", title: "Work and clients", he: "עבודה ולקוחות",
    goals: ["לתאר מצב בעבודה ולהסביר החלטות", "אוצר מילים של שירות ולקוחות"],
    vocab: [["appointment", "פגישה קבועה"], ["customer", "לקוח"], ["complaint", "תלונה"], ["solve", "לפתור"], ["delay", "עיכוב"], ["deadline", "מועד אחרון"]],
    grammar: { name: "Past Simple vs Present Perfect", tip: "I solved it yesterday (זמן מוגדר) / I have solved it (התוצאה חשובה עכשיו). עם yesterday/ago — תמיד Past Simple." },
    story: {
      A: "David arrived at work at 8:30. He opened his email and saw an angry message from a customer. The customer waited two weeks for his order. David called him and said sorry. He sent the order the same day with a small gift. The customer was happy.",
      B: "David arrived at work at 8:30 and opened his email to find an angry message from a customer whose order was two weeks late. Instead of replying by email, he picked up the phone. He apologized, explained that there had been a delay at the warehouse, and promised to send the order that same day — with a small gift for the trouble. The customer, who had expected an argument, was surprised by the call and thanked him.",
      C: "David arrived at 8:30 to an inbox that had clearly not slept. At the top sat a furious email from a customer whose order was now two weeks overdue, written in the kind of capital letters that suggest a person has already told several friends about you. David resisted the urge to answer in writing. He called instead, apologized without hiding behind the warehouse — although the delay genuinely had started there — and promised to ship the order that day, with something extra for the trouble. The customer, braced for a fight, was disarmed by the phone call; by the end he was asking David's advice about a different product.",
    },
    questions: ["What happened when David opened his email?", "Why do you think he called instead of writing back?", "What would you have done in his situation?", "Has something similar ever happened to you at work — a complaint or an angry client?", "What makes a customer trust you again after a problem?"],
    challenge: "Tell me about a difficult day at your work, from the beginning to the end, for about a minute.",
  },
  {
    id: "travel", level: "A2", title: "Travel — at the airport", he: "טיולים — בשדה התעופה",
    goals: ["להסתדר בצ'ק-אין, ביטחון ושער", "לשאול ולהבין הודעות"],
    vocab: [["boarding pass", "כרטיס עלייה למטוס"], ["gate", "שער"], ["luggage", "מזוודות"], ["delayed", "מתעכב"], ["connection", "טיסת המשך"], ["announcement", "הודעה (ברמקול)"]],
    grammar: { name: "Question forms", tip: "Where is the gate? / What time does it board? — מילת שאלה + פועל עזר + נושא." },
    story: {
      A: "Noa is at the airport. She goes to the check-in desk and gives her passport. The woman gives her a boarding pass and says, 'Gate 12, boarding at 9:40.' Noa goes through security. At the gate she hears an announcement: the flight is delayed one hour. She buys a coffee and waits.",
      B: "Noa got to the airport three hours early, as she always does. Check-in was quick: passport, one suitcase, a boarding pass for gate 12. Security took longer because of a laptop she'd forgotten in her bag. At the gate, just as she sat down, an announcement said the flight was delayed by an hour due to weather in Rome. She sighed, bought an overpriced coffee, and used the time to practice the Italian phrases she'd been learning.",
      C: "Noa is the kind of traveler who arrives three hours early and then feels faintly embarrassed about it. Check-in took four minutes; security took fifteen, thanks to a laptop she'd sworn she had packed in the tray. She had barely settled at gate 12 when the announcement came — a one-hour delay, weather over Rome — delivered in the soothing tone airports reserve for bad news. She bought a coffee that cost more than her breakfast, opened her phrasebook, and decided that an extra hour was simply more time to get the Italian right.",
    },
    questions: ["What happens at the check-in desk?", "Why is the flight delayed, and how does Noa react?", "What do you do when a flight is delayed?", "Tell me about your last trip abroad — how was the airport?", "What is the most stressful part of traveling for you, and why?"],
    challenge: "Role-play: I'm the check-in agent. Check in, ask about your seat and your gate, then ask what happens with your connection if the flight is late.",
  },
  {
    id: "story", level: "B1", title: "Telling a story", he: "לספר סיפור",
    goals: ["לספר סיפור עם התחלה, אמצע וסוף", "מילות קישור: first, then, suddenly, in the end"],
    vocab: [["suddenly", "פתאום"], ["realize", "להבין (לקלוט)"], ["embarrassed", "נבוך"], ["in the end", "בסופו של דבר"], ["relieved", "רגוע (אחרי דאגה)"], ["lesson", "לקח"]],
    grammar: { name: "Past Simple + Past Continuous", tip: "I was walking home when I saw a dog. — הרקע ב-was/were + ing, האירוע ב-Past Simple." },
    story: {
      A: "Last year I lost my phone in a taxi. I was very worried. I called the taxi company, but they didn't answer. Then a man called me. He found my phone in his taxi! We met at a café, and I gave him a coffee. I was very happy. Now I always check my bag before I leave a taxi.",
      B: "Last year I left my phone in a taxi and didn't realize until I was already inside my building. I called the company, waited on hold, got nowhere. I was sure it was gone. Two hours later, an unknown number called — it was the driver, who had found it under the seat. We met at a café near the station, and I bought him a coffee he didn't want to accept. I was so relieved I laughed. The lesson? I now check the seat every single time.",
      C: "Last year I managed to lose my phone in a taxi, and the strange part is how long it took me to notice: I was already upstairs, keys in hand, when I reached for a pocket that was suddenly, impossibly empty. The taxi company put me on hold for a while and then apologized in a way that made clear nothing would happen. I had more or less made peace with it when an unknown number rang. The driver — who had found it wedged under the seat — insisted on meeting me halfway. I bought him a coffee he tried three times to refuse, and walked home feeling ridiculous and lucky in equal measure.",
    },
    questions: ["What happened, and when did the narrator realize it?", "How did the story end?", "Why do you think the driver refused the coffee?", "Tell me a story about something you lost or found.", "What lesson do you take from stories like this?"],
    challenge: "Tell me a story that happened to you — with a clear beginning, a problem, and an ending — for one minute. Use 'suddenly' and 'in the end'.",
  },
  {
    id: "phone", level: "B1", title: "Phone conversations", he: "שיחות טלפון",
    goals: ["לתאם, לברר ולהשאיר הודעה בטלפון", "לבקש שיחזרו על משהו בלי להתבייש"],
    vocab: [["hold on", "רגע (בטלפון)"], ["put through", "להעביר שיחה"], ["message", "הודעה"], ["reschedule", "לקבוע מחדש"], ["confirm", "לאשר"], ["available", "זמין"]],
    grammar: { name: "Could you… / I'd like to…", tip: "Could you repeat that? / I'd like to reschedule my appointment. — משפטי בקשה בטלפון." },
    story: {
      A: "Sarah calls the dentist. 'Hello, I'd like to change my appointment.' The receptionist says, 'Hold on, please.' After a minute she says, 'We have Tuesday at 10 or Thursday at 4.' Sarah says, 'Thursday, please.' The receptionist confirms: 'Thursday at 4. Thank you.' Sarah says, 'Thank you, goodbye.'",
      B: "Sarah called the dentist to move her appointment, but the receptionist spoke so fast that she missed half of it. 'Sorry, could you say that again, a little slower?' she asked. The receptionist repeated: Tuesday at ten or Thursday at four. Sarah chose Thursday, asked her to confirm by text message, and hung up feeling proud — a year ago she would have just said 'yes' to whatever she heard.",
      C: "Phone calls in English used to be the thing Sarah avoided most; you can't read a face, and everyone seems to talk faster the moment they can't see you. Yesterday she called the dentist to reschedule and, sure enough, the receptionist rattled off options at a speed that turned them into noise. Instead of guessing, she said, 'I'm sorry, could you slow down a little? I want to get this right.' The receptionist did — Tuesday at ten or Thursday at four — and Sarah took Thursday, asked for a confirmation by text, and hung up feeling, for the first time, like she had actually controlled the call.",
    },
    questions: ["Why did Sarah call, and what did she choose?", "What did she do when she didn't understand?", "Why was she proud at the end?", "What's hard for you about phone calls in English?", "Tell me about a phone call you need to make in English soon — let's practice it."],
    challenge: "Role-play: call me to reschedule an appointment. I'll speak fast — ask me to slow down and confirm the details at the end.",
  },
  {
    id: "directions", level: "A2", title: "Giving directions", he: "הכוונה בדרך",
    goals: ["לשאול ולתת הוראות הגעה", "מילות מקום: next to, across from, straight"],
    vocab: [["straight", "ישר"], ["turn left", "לפנות שמאלה"], ["across from", "ממול"], ["next to", "ליד"], ["crossing", "מעבר חצייה"], ["get lost", "ללכת לאיבוד"]],
    grammar: { name: "Imperatives + prepositions of place", tip: "Go straight, turn left at the bank, it's across from the park. — פועל בציווי בלי נושא." },
    story: {
      A: "A tourist stops me in the street. 'Excuse me, where is the train station?' I say, 'Go straight for two minutes. Turn left at the bank. The station is across from the park, next to a big pharmacy.' He says, 'Thank you!' Then I see that he turns right. I run after him.",
      B: "A tourist stopped me near the market, holding his phone upside down. 'Excuse me, how do I get to the train station?' I pointed: 'Go straight past the bakery, turn left at the bank, and it's across from the park, next to the pharmacy — you can't miss it.' He thanked me warmly, then turned right. I hesitated for a second, felt bad, and ran after him.",
      C: "A tourist stopped me outside the market with the expression of a man who has trusted his phone one time too many. 'Sorry — the train station?' I gave him the full route: straight past the bakery, left at the bank, across from the park, right next to the pharmacy, impossible to miss. He thanked me with real feeling, nodded confidently, and set off in precisely the wrong direction. I stood there for a moment weighing my dignity against his afternoon, and then, of course, I ran after him.",
    },
    questions: ["Where does the tourist want to go, and what are the directions?", "What does he do after saying thank you?", "Why does the narrator run after him?", "Explain to me how to get from your home to the nearest supermarket.", "Have you ever gotten lost in a foreign city? What happened?"],
    challenge: "I'm lost near your house. Give me directions to a place you like — a café, a park — step by step.",
  },
  {
    id: "shopping", level: "A2", title: "Shopping and returns", he: "קניות והחזרות",
    goals: ["לשאול על מידה, מחיר והנחה", "להחזיר מוצר ולהסביר למה"],
    vocab: [["size", "מידה"], ["receipt", "קבלה"], ["refund", "החזר כספי"], ["exchange", "להחליף"], ["discount", "הנחה"], ["fit", "להתאים (במידה)"]],
    grammar: { name: "Comparatives", tip: "smaller / bigger / cheaper — למילים קצרות; more expensive — לארוכות." },
    story: {
      A: "I buy a shirt for my brother. At home he tries it. It is too small. I go back to the shop with the receipt. I say, 'I want to exchange this. Do you have a bigger size?' The seller brings a bigger shirt. It fits. I am happy, and my brother is happy too.",
      B: "I bought my brother a shirt for his birthday, and of course it was too small — he's grown, or I hadn't noticed. I went back with the receipt and asked to exchange it for a larger size. The seller checked, found one, and even mentioned that the same shirt was now twenty percent off, so she refunded the difference. It's a small thing, but it's the reason I keep going back to that shop.",
      C: "I bought my brother a shirt for his birthday and, in the tradition of my family, got the size wrong. He tried it on, we both pretended it fit, and then he laughed. So back I went, receipt in hand, expecting the usual reluctance. Instead the assistant found a larger one in thirty seconds, noticed the shirt had gone on sale since I'd bought it, and refunded the difference without my asking. It cost the shop a few shekels and bought them a customer for life, which strikes me as an excellent deal for everyone.",
    },
    questions: ["What was the problem with the shirt?", "What did the seller do — and what extra thing did she do?", "Why does the narrator keep going back to that shop?", "Do you enjoy shopping, or do you avoid it? Why?", "Tell me about something you returned — was it easy?"],
    challenge: "Role-play: I'm the seller. Return something, explain the problem, and negotiate an exchange or a refund.",
  },
  {
    id: "doctor", level: "B1", title: "At the doctor", he: "אצל הרופא",
    goals: ["לתאר תסמינים ולהבין הוראות", "אוצר מילים של בריאות"],
    vocab: [["symptom", "תסמין"], ["prescription", "מרשם"], ["fever", "חום"], ["dizzy", "סחרחורת"], ["appointment", "תור"], ["recover", "להחלים"]],
    grammar: { name: "Present Perfect for duration — how long", tip: "How long have you had the fever? — I've had it for three days / since Monday." },
    story: {
      A: "I feel bad. I have a headache and a fever. I go to the doctor. She asks, 'How long have you had the fever?' I say, 'Three days.' She checks my throat and says, 'You have an infection.' She gives me a prescription. 'Take one pill every morning and rest.' After four days I feel better.",
      B: "By the third day of fever I gave up and made an appointment. The doctor asked how long I'd had it, whether I felt dizzy, whether I'd been sleeping. She looked at my throat, said 'infection' in the calm voice doctors use, and wrote a prescription: one pill every morning, plenty of water, no work for three days. I argued a little about the work. She didn't argue back — she just looked at me until I agreed.",
      C: "I held out for three days, in the way of people who believe a fever is a matter of willpower, and then made an appointment. The doctor asked the usual questions — how long, how high, any dizziness, how much sleep — with the unhurried efficiency of someone who has heard every possible answer. A quick look at my throat, one word ('infection'), and a prescription: one pill a morning, water, and three days away from work. I opened my mouth to negotiate the last part. She didn't say anything; she simply waited, and it turns out silence is a very persuasive medicine.",
    },
    questions: ["What were the symptoms, and what did the doctor find?", "What instructions did the doctor give?", "Why did the narrator agree to stay home in the end?", "Do you go to the doctor quickly, or do you wait? Why?", "Explain to me, as if I'm your doctor, how you feel when you have the flu."],
    challenge: "Role-play: I'm the doctor. Describe your symptoms, answer my questions, and ask me two questions about the treatment.",
  },
  {
    id: "future", level: "B1", title: "Future plans", he: "תוכניות לעתיד",
    goals: ["לדבר על תוכניות, כוונות ותחזיות", "will / going to / might"],
    vocab: [["plan", "תוכנית, לתכנן"], ["probably", "כנראה"], ["might", "אולי (יכול להיות)"], ["goal", "מטרה"], ["eventually", "בסופו של דבר"], ["save up", "לחסוך"]],
    grammar: { name: "going to vs will vs might", tip: "I'm going to (תוכנית) / I'll (החלטה עכשיו או תחזית) / I might (לא בטוח)." },
    story: {
      A: "Next year I am going to change my job. I want to work with people, not with computers. First, I am going to study for six months. Then I will look for a new job. Maybe I will work in a school. My family says it is a good plan. I am a little afraid, but also excited.",
      B: "Next year I'm going to leave my job in tech — not because it's bad, but because I've realized I want to work with people, not screens. The plan is to study for six months first, then look for something in education. I might teach, or I might work with kids in another way; I honestly don't know yet. My family thinks it's brave. I think it's probably overdue.",
      C: "Next year, if everything goes as planned — and I'm aware of how those words usually end — I'm going to leave a perfectly good job in tech. It isn't that the work is bad; it's that at some point I noticed I was spending my best hours talking to screens, and I'd rather spend them talking to people. The plan, such as it is: six months of study, then a serious look at education. I might end up teaching, or I might find that what I want is something adjacent that I can't name yet. My family calls it brave. I suspect it's simply late.",
    },
    questions: ["What is the narrator going to do next year, and why?", "What is the plan, step by step?", "Why does the family call it brave, and why does the narrator disagree?", "What are your plans for the next year — work, travel, learning?", "What is one goal you want to reach with your English by the summer?"],
    challenge: "Tell me about your plans for the next five years for one minute — use 'going to', 'will', and 'might' at least once each.",
  },
  {
    id: "opinions", level: "B2", title: "Giving opinions", he: "להביע דעה",
    goals: ["להביע דעה, להסכים ולא להסכים בנימוס", "לנמק ולהביא דוגמה"],
    vocab: [["in my opinion", "לדעתי"], ["on the other hand", "מצד שני"], ["convincing", "משכנע"], ["disagree", "לא להסכים"], ["evidence", "ראיה, הוכחה"], ["overrated", "מוערך יתר על המידה"]],
    grammar: { name: "Linking ideas — although / however / whereas", tip: "Although it's expensive, it's worth it. / It's fast; however, it's noisy." },
    story: {
      A: "Two friends talk about phones. Amir says, 'Kids should not have phones before they are 14.' Lior says, 'I don't agree. My son uses his phone to learn.' Amir says, 'But he also plays games all day.' Lior says, 'That is true. Maybe we need rules, not a ban.' In the end they agree: phones are OK, but with rules.",
      B: "Amir and Lior have the same argument every few months. Amir thinks kids shouldn't have smartphones before fourteen — 'they lose the ability to be bored, and boredom is where thinking starts.' Lior disagrees: his son uses his phone to learn languages and to talk to his grandmother abroad. 'And to play games for four hours,' Amir adds. Lior admits that part is true. They usually land in the same place: the problem isn't the phone, it's the absence of rules.",
      C: "Amir and Lior have been having the same argument, in slightly different clothes, for about three years. Amir's position is that children shouldn't have smartphones before fourteen; his best line is that a phone destroys boredom, and boredom is where thinking begins. Lior finds this convincing for about a minute and then remembers his own son, who uses his phone to learn Spanish and to call his grandmother in Argentina — and, Amir points out, to play games for four hours on a Saturday. What's interesting is that neither of them is wrong. The evidence, such as it is, suggests the device matters far less than the rules around it, which is roughly where they always end up.",
    },
    questions: ["What are Amir's and Lior's positions?", "What point does Lior admit is true?", "Where do they end up agreeing?", "What's your opinion — should kids have smartphones before 14? Give me a reason and an example.", "Tell me about a topic where you and a friend disagree."],
    challenge: "Convince me of something you believe strongly, for one minute. Use 'although' or 'on the other hand', and give at least one example.",
  },
  {
    id: "negotiation", level: "B2", title: "Negotiation", he: "משא ומתן",
    goals: ["לבקש, להציע פשרה ולסגור עסקה", "שפה עדינה: I'd be willing to… / What if…"],
    vocab: [["offer", "הצעה"], ["compromise", "פשרה"], ["deal", "עסקה"], ["budget", "תקציב"], ["worth", "שווה"], ["flexible", "גמיש"]],
    grammar: { name: "Conditionals in negotiation", tip: "If you can deliver by Friday, we'll sign today. / What if we split the difference?" },
    story: {
      A: "I want to buy a used car. The price is 40,000. I say, 'It is a lot. My budget is 35,000.' The seller says, 'I can do 38,000.' I say, 'What if I pay today? 36,000.' He thinks. 'OK, 36,500, and I fix the small light.' We shake hands. Good deal.",
      B: "The used car was listed at 40,000, which was above my budget, so I said so directly: 'It's a nice car, but I can go to 35.' The seller shook his head — 38, not a shekel less. I asked about the small broken light and whether he'd be flexible if I paid the same day. He thought about it. 'Thirty-six and a half, and I'll fix the light.' We shook hands. I still don't know who got the better deal, which probably means it was fair.",
      C: "The car was listed at 40,000, and the seller had the relaxed confidence of a man who knows the market. I opened low — 35 — and he laughed politely and came down to 38 as if it cost him something. I mentioned the cracked tail light, which he'd hoped I hadn't noticed, and asked whether same-day payment might change his thinking. It did: 36,500, light repaired, keys by the weekend. We shook on it, and I drove home replaying the conversation, unable to decide who had won — which, my father later told me, is the only reliable sign of a fair deal.",
    },
    questions: ["What was the starting price, and what did the buyer offer?", "What two things helped the buyer get a better price?", "Was it a fair deal? Why does the narrator think so?", "How do you feel about negotiating — do you enjoy it or avoid it?", "Tell me about a negotiation you had — at work, in a shop, with your kids."],
    challenge: "Role-play: I'm selling you a laptop for 5,000. Negotiate me down — use 'what if', mention your budget, and find something to compromise on.",
  },
];

export function topicById(id){ return TOPICS.find(t => t.id === id); }
export function bandFor(level){ return BANDS[level] || "A"; }
