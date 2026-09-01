/* ============================================================
   classify.js — סיווג אוטומטי של תנועות
   ------------------------------------------------------------
   שלושה מקורות ידע, לפי סדר עדיפות יורד:
     1. חוקים שנלמדו מהמשתמש (MerchantRules)
     2. היסטוריית התנועות שכבר אושרו
     3. חוקי בסיס מובנים לבתי עסק נפוצים בישראל
   כל סיווג מלווה בציון ביטחון. סיווג בביטחון נמוך מסומן לבדיקה.
   ============================================================ */

import { normalizeMerchant, similarity, clamp } from '../core/util.js';

/* ============================================================
   חוקי בסיס — בתי עסק נפוצים
   cat: שם הקטגוריה (נפתר מול הקטגוריות של המשתמש)
   space: 'personal' | 'business' | null (לא מכריע)
   ============================================================ */
export const SEED_RULES = [
  /* --- פעולות בנק בדף עו״ש --- */
  /* מופיעות ראשונות: הן ספציפיות יותר מהכללים הכלליים שאחריהן,
     למשל "הראלהלואה" שאחרת היה נתפס ככלל הביטוח של "הראל". */
  { p: ['משכורת-נט', 'משכורת נט', 'משכורת'], cat: 'משכורת', space: 'personal', direction: 'income' },
  { p: ['פועלים-משכנ', 'משכנתא', 'משכנת', 'שכר דירה', 'שכירות'], cat: 'דיור', space: 'personal' },
  { p: ['הראלהלואה', 'הלואה', 'הלוואה'], cat: 'הלוואות', space: 'personal' },
  { p: ['הראל פנסיה', 'פנסיה וגמ', 'קרן השתלמות', 'גמל', 'קופת גמל'], cat: 'חיסכון', space: 'personal' },
  { p: ['ני"ע', 'ניע-קניה', 'ניע-מכירה', 'דיבידנד', 'הזמנת מטח'], cat: 'חיסכון', space: 'personal' },
  { p: ['ישראכרט', 'מקס איט', 'מקס', 'כאל', 'לאומי קארד', 'דיינרס'], cat: 'כרטיסי אשראי', space: 'personal' },
  { p: ['הראל בטוח', 'הראל חברה לביט', 'הפניקס חב', 'מנורה מבטחים'], cat: 'ביטוחים', space: 'personal' },
  { p: ['עמלת', 'עמלה', 'דמי ניהול'], cat: 'עמלות בנק', space: 'personal' },
  { p: ['ההוצאה לפועל', 'המועצה להסדר'], cat: 'אחר', space: 'personal' },
  { p: ['זיכוי מלאומי', 'זיכוי מהמזרחי', 'זיכוי בינלאומי', 'זיכוי מדיסקונט', 'זיכוי מאוצ', 'זיכוי מ'], cat: 'הכנסה נוספת', space: 'personal', direction: 'income' },
  { p: ['שיקים ממשמרת', 'הפקדת שיק'], cat: 'הכנסה נוספת', space: 'personal', direction: 'income' },
  { p: ['שיק'], cat: 'אחר', space: 'personal' },

  /* --- סופר ומזון --- */
  { p: ['שופרסל', 'shufersal'], cat: 'קניות בסופר', space: 'personal' },
  { p: ['רמי לוי', 'rami levy'], cat: 'קניות בסופר', space: 'personal' },
  { p: ['ויקטורי', 'victory'], cat: 'קניות בסופר', space: 'personal' },
  { p: ['יינות ביתן'], cat: 'קניות בסופר', space: 'personal' },
  { p: ['מגה בעיר', 'מגה '], cat: 'קניות בסופר', space: 'personal' },
  { p: ['אושר עד'], cat: 'קניות בסופר', space: 'personal' },
  { p: ['טיב טעם'], cat: 'קניות בסופר', space: 'personal' },
  { p: ['חצי חינם'], cat: 'קניות בסופר', space: 'personal' },
  { p: ['מחסני השוק'], cat: 'קניות בסופר', space: 'personal' },
  { p: ['am pm', 'am:pm', 'סופר יודה'], cat: 'קניות בסופר', space: 'personal' },
  { p: ['שוק העיר', 'קופיקס מרקט'], cat: 'קניות בסופר', space: 'personal' },

  /* --- פארם ובריאות --- */
  { p: ['סופר פארם', 'superpharm', 'super-pharm'], cat: 'בריאות', space: 'personal' },
  { p: ['בי פארם', 'ניו פארם', 'be pharm'], cat: 'בריאות', space: 'personal' },
  { p: ['מכבי', 'כללית', 'מאוחדת', 'לאומית שירותי'], cat: 'בריאות', space: 'personal' },
  { p: ['בית מרקחת'], cat: 'תרופות', space: 'personal' },

  /* --- דלק ורכב --- */
  { p: ['פז ', 'paz', 'יילו', 'yellow'], cat: 'דלק', space: null },
  { p: ['דלק ', 'מנטה', 'delek'], cat: 'דלק', space: null },
  { p: ['סונול', 'sonol'], cat: 'דלק', space: null },
  { p: ['דור אלון', 'alonit', 'אלונית'], cat: 'דלק', space: null },
  { p: ['טן ', 'ten petrol'], cat: 'דלק', space: null },
  { p: ['אלקטרה פאוור', 'ev edge', 'גרינר', 'טעינה חשמלית'], cat: 'טעינת רכב חשמלי', space: 'personal' },
  { p: ['מוסך', 'טסט רכב', 'צמיגי', 'טיב רכב'], cat: 'טיפולי רכב', space: 'personal' },
  { p: ['פנגו', 'pango', 'סלופארק', 'cellopark'], cat: 'רכב', space: null },
  { p: ['כביש 6', 'דרך ארץ', 'כרמלטון'], cat: 'רכב', space: null },

  /* --- תשתיות ובית --- */
  { p: ['חברת החשמל', 'חח"י', 'חשמל לישראל'], cat: 'חשמל', space: null },
  { p: ['מקורות', 'מי אביבים', 'תאגיד מים', 'מיה שמש', 'הגיחון'], cat: 'מים', space: 'personal' },
  { p: ['ארנונה', 'עיריית', 'מועצה מקומית', 'מועצה אזורית'], cat: 'ארנונה', space: null },
  { p: ['סופרגז', 'אמישראגז', 'פזגז', 'דורגז'], cat: 'גז', space: 'personal' },
  { p: ['ועד בית', 'ניהול מבנה'], cat: 'ועד בית', space: 'personal' },

  /* --- תקשורת --- */
  { p: ['פרטנר', 'partner', 'orange'], cat: 'סלולר', space: null },
  { p: ['סלקום', 'cellcom'], cat: 'סלולר', space: null },
  { p: ['פלאפון', 'pelephone'], cat: 'סלולר', space: null },
  { p: ['הוט מובייל', 'hot mobile', 'רמי לוי תקשורת', '019', 'גולן טלקום'], cat: 'סלולר', space: null },
  { p: ['בזק בינלאומי', 'bezeq', 'בזק'], cat: 'אינטרנט', space: null },
  { p: ['הוט', 'hot ', 'yes ', 'סלקום tv'], cat: 'טלוויזיה', space: 'personal' },
  { p: ['netflix', 'נטפליקס'], cat: 'טלוויזיה', space: 'personal' },
  { p: ['spotify', 'ספוטיפיי', 'apple music', 'disney'], cat: 'בילויים', space: 'personal' },

  /* --- ביטוח ופיננסים --- */
  { p: ['הראל', 'כלל ביטוח', 'מנורה', 'מגדל', 'הפניקס', 'איילון', 'שירביט', 'ביטוח ישיר', '9 מיליון', 'שלמה ביטוח'], cat: 'ביטוחים', space: null },
  { p: ['ביטוח לאומי'], cat: 'קצבאות', space: 'personal', direction: 'income' },
  { p: ['עמלת', 'עמלות בנק', 'דמי ניהול חשבון', 'עמלה חודשית'], cat: 'עמלות בנק', space: null },
  { p: ['החזר הלוואה', 'תשלום הלוואה', 'הלוואה'], cat: 'הלוואות', space: null },
  { p: ['משכנתא', 'משכנת'], cat: 'דיור', space: 'personal' },

  /* --- מסעדות ובילוי --- */
  { p: ['מסעד', 'קפה ', 'ארומה', 'לנדוור', 'קפה קפה', 'רולדין', 'גרג'], cat: 'מסעדות', space: null },
  { p: ['וולט', 'wolt', '10bis', 'תן ביס', 'מישלוח'], cat: 'מסעדות', space: null },
  { p: ['מקדונלד', 'burger', 'בורגר', 'ג׳פניקה', 'פיצה', 'פלאפל', 'שווארמה', 'סושי'], cat: 'מסעדות', space: 'personal' },
  { p: ['סינמה סיטי', 'יס פלאנט', 'רב חן', 'הבימה', 'הופעה', 'קולנוע'], cat: 'בילויים', space: 'personal' },
  { p: ['לונה פארק', 'ספארי', 'גן חיות', 'סופרלנד'], cat: 'בילויים', space: 'personal' },

  /* --- קניות --- */
  { p: ['קסטרו', 'castro', 'fox', 'זara', 'zara', 'h&m', 'רנואר', 'גולף', 'american eagle'], cat: 'ביגוד', space: 'personal' },
  { p: ['איקאה', 'ikea', 'ace ', 'הום סנטר', 'urban'], cat: 'קניות שונות', space: 'personal' },
  { p: ['amazon', 'אמזון', 'aliexpress', 'עלי אקספרס', 'ebay', 'shein', 'temu'], cat: 'קניות שונות', space: 'personal' },
  { p: ['ksp', 'קיי אס פי', 'באג', 'ivory', 'אייבורי'], cat: 'מחשוב', space: null },

  /* --- חופשות --- */
  { p: ['booking', 'airbnb', 'מלון', 'אל על', 'el al', 'ישראייר', 'ארקיע', 'wizz', 'ryanair', 'טיסה'], cat: 'חופשות', space: 'personal' },

  /* --- ילדים וחינוך --- */
  { p: ['גן ילדים', 'צהרון', 'בית ספר', 'מתנ"ס', 'משרד החינוך'], cat: 'בתי ספר וגנים', space: 'personal' },
  { p: ['חוג ', 'קונסרבטוריון', 'בית ספר לנהיגה'], cat: 'חוגים', space: 'personal' },

  /* --- ספורט --- */
  { p: ['הולמס פלייס', 'holmes', 'גו אקטיב', 'סינרג', 'איקס פור', 'חדר כושר', 'קאנטרי'], cat: 'חדר כושר', space: 'personal' },

  /* --- הכנסות פרטיות --- */
  { p: ['משכורת', 'שכר עבודה', 'תלוש שכר'], cat: 'משכורת', space: 'personal', direction: 'income' },
  { p: ['קצבת ילדים', 'קצבה', 'מל"ל'], cat: 'קצבאות', space: 'personal', direction: 'income' },
  { p: ['החזר מס', 'מס הכנסה החזר'], cat: 'החזרים', space: 'personal', direction: 'income' },
  { p: ['שכר דירה', 'דמי שכירות'], cat: 'שכירות מנכס', space: 'personal', direction: 'income' },

  /* --- עסקי: פרסום ולידים --- */
  { p: ['facebook', 'meta platforms', 'meta ads', 'פייסבוק'], cat: 'פרסום', space: 'business' },
  { p: ['google ads', 'google adwords', 'גוגל אדס'], cat: 'פרסום', space: 'business' },
  { p: ['taboola', 'outbrain', 'tiktok ads', 'linkedin ads'], cat: 'פרסום', space: 'business' },
  { p: ['לידים', 'leads', 'זאפ', 'zap group'], cat: 'לידים', space: 'business' },

  /* --- עסקי: תוכנה ומחשוב --- */
  { p: ['salesforce', 'hubspot', 'monday.com', 'monday com', 'zoho', 'pipedrive'], cat: 'CRM', space: 'business' },
  { p: ['microsoft', 'office 365', 'google workspace', 'adobe', 'zoom', 'slack', 'dropbox', 'canva', 'openai', 'anthropic', 'notion'], cat: 'תוכנות', space: 'business' },
  { p: ['aws', 'amazon web services', 'digitalocean', 'cloudflare', 'godaddy', 'wix', 'קבוצת נט'], cat: 'תוכנות', space: 'business' },

  /* --- עסקי: שירותים --- */
  { p: ['רואה חשבון', 'רו"ח', 'רואי חשבון'], cat: 'רואה חשבון', space: 'business' },
  { p: ['הנהלת חשבונות', 'חשבשבת', 'ריווחית', 'greeninvoice', 'חשבונית ירוקה', 'ezcount'], cat: 'הנהלת חשבונות', space: 'business' },
  { p: ['עורך דין', 'עו"ד', 'משרד עורכי דין'], cat: 'הוצאות אחרות', space: 'business' },
  { p: ['ביטוח לאומי מעסיק', 'ניכויים', 'מקדמות מס', 'מע"מ', 'מס הכנסה', 'שע"מ'], cat: 'מיסים', space: 'business' },
  { p: ['משכורת עובד', 'שכר עובדים', 'תשלום משכורות'], cat: 'משכורות', space: 'business' },
  { p: ['עמלת סליקה', 'tranzila', 'טרנזילה', 'pelecard', 'קארדקום', 'cardcom', 'meshulam', 'משולם', 'stripe', 'paypal'], cat: 'עמלות סליקה', space: 'business' },
  { p: ['אופיס דיפו', 'ציוד משרדי', 'סטימצקי'], cat: 'ציוד משרדי', space: 'business' },

  /* --- עסקי: הכנסות --- */
  { p: ['עמלת היקף', 'עמלות היקף'], cat: 'עמלות היקף', space: 'business', direction: 'income' },
  { p: ['נפרעים'], cat: 'נפרעים', space: 'business', direction: 'income' },
  { p: ['עמלה', 'עמלות'], cat: 'עמלות', space: 'business', direction: 'income' },
];

/* ============================================================
   סימני זיהוי מרחב (עסקי מול פרטי)
   ============================================================ */
const BUSINESS_HINTS = [
  /חשבונית/, /מע"?מ/, /ניכוי/, /מקדמ(ה|ות)/, /שע"?מ/, /רו"?ח/, /עו"?ד/,
  /סליקה/, /לידים/, /crm/i, /ads?\b/i, /invoice/i, /b2b/i, /בע"?מ/,
  /סוכנות/, /סוכן משנה/, /עמלת/, /נפרעים/, /משרד/, /workspace/i,
];
const PERSONAL_HINTS = [
  /סופר/, /מכולת/, /בית מרקחת/, /גן ילדים/, /צהרון/, /חוג/, /קופת חולים/,
  /נטפליקס/i, /netflix/i, /spotify/i, /מסעד/, /פיצה/, /טיפוח/, /מספרה/,
];

/* ============================================================
   פתרון קטגוריה לפי שם
   ============================================================ */

/** מאתר קטגוריה לפי שם + מרחב + כיוון */
export function findCategory(categories, name, space, direction = 'expense') {
  if (!name) return null;
  const target = String(name).trim();
  const kind = direction === 'income' ? 'income' : 'expense';
  const inSpace = categories.filter((c) => !c.archived && c.kind === kind && (space ? c.space === space : true));
  const hit =
    inSpace.find((c) => c.name === target) ||
    inSpace.find((c) => normalizeMerchant(c.name) === normalizeMerchant(target));
  if (hit) return hit;
  // חיפוש חוצה-מרחבים מותר רק כשלא נדרש מרחב מסוים,
  // אחרת תנועה עסקית עלולה לקבל קטגוריה פרטית.
  if (space) return null;
  return categories.find((c) => !c.archived && c.kind === kind && c.name === target) || null;
}

/** קטגוריית ברירת המחדל כשאין התאמה */
export function fallbackCategory(categories, space, direction) {
  const kind = direction === 'income' ? 'income' : 'expense';
  const names = kind === 'income' ? ['אחר', 'הכנסות אחרות'] : ['אחר', 'הוצאות אחרות'];
  for (const n of names) {
    const c = findCategory(categories, n, space, direction);
    if (c) return c;
  }
  return categories.find((c) => !c.archived && c.kind === kind && c.space === space) || null;
}

/* ============================================================
   בניית אינדקס היסטוריה
   ============================================================ */

/** אינדקס בתי עסק מתוך תנועות שאושרו — הבסיס ללמידה מהשימוש */
export function buildHistoryIndex(transactions) {
  const map = new Map();
  for (const tx of transactions) {
    if (tx.status === 'pending') continue;
    const key = normalizeMerchant(tx.merchant || tx.name);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(tx);
  }
  const index = new Map();
  for (const [key, list] of map) {
    const catCount = new Map();
    const spaceCount = new Map();
    const typeCount = new Map();
    for (const tx of list) {
      if (tx.categoryId) catCount.set(tx.categoryId, (catCount.get(tx.categoryId) || 0) + 1);
      spaceCount.set(tx.space, (spaceCount.get(tx.space) || 0) + 1);
      if (tx.expenseType) typeCount.set(tx.expenseType, (typeCount.get(tx.expenseType) || 0) + 1);
    }
    const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    const tc = top(catCount), sc = top(spaceCount), tt = top(typeCount);
    index.set(key, {
      key,
      total: list.length,
      categoryId: tc?.[0] || null,
      categoryHits: tc?.[1] || 0,
      space: sc?.[0] || null,
      spaceHits: sc?.[1] || 0,
      expenseType: tt?.[0] || null,
      sample: list[0],
    });
  }
  return index;
}

/* ============================================================
   הסיווג עצמו
   ============================================================ */

/**
 * סיווג שורה גולמית אחת.
 * מחזיר { categoryId, space, expenseType, confidence, reason, source, needsReview, needsSpaceReview }
 */
/* ענפי חברות האשראי שניתן למפות בבטחה לקטגוריה. ענף מעורפל
   ("שונות", "שיווק ישיר") נשאר בלי מיפוי — עדיף "דורש בדיקה" על סיווג שגוי. */
const BRANCH_CATEGORIES = {
  "תש' רשויות": 'ארנונה',
  'רשויות': 'ארנונה',
  'קמעונאות דלק': 'דלק',
  'דלק': 'דלק',
  'מסעדות/קפה': 'מסעדות',
  'מסעדות': 'מסעדות',
  'מזון': 'קניות בסופר',
  'סופרמרקטים': 'קניות בסופר',
  'מכולת': 'קניות בסופר',
  'ביטוח': 'ביטוחים',
  'פנאי/ספורט': 'בילויים',
  'תרבות': 'בילויים',
  'טוטו/פיס': 'בילויים',
  'ביגוד/הנעלה': 'ביגוד',
  'הלבשה': 'ביגוד',
  'תרופות': 'תרופות',
  'רפואה': 'בריאות',
  'בריאות': 'בריאות',
  'תיירות': 'חופשות',
  'תעופה': 'חופשות',
  'מלונות': 'חופשות',
  'חנויות פארם': 'בריאות',
};

export function classifyRow(row, ctx) {
  const { categories, rules = [], historyIndex = new Map(), account = null, defaultSpace = 'personal' } = ctx;

  const text = `${row.merchant || ''} ${row.description || ''} ${row.typeText || ''}`;
  const norm = normalizeMerchant(text);
  const rawLower = text.toLowerCase();
  const merchantNorm = normalizeMerchant(row.merchant || '');
  const direction = row.direction || 'expense';

  let best = null;

  /* --- 1. חוקים של המשתמש (עדיפות עליונה) --- */
  for (const rule of [...rules].sort((a, b) => b.priority - a.priority)) {
    if (!ruleMatches(rule, row, norm)) continue;
    const exact = normalizeMerchant(rule.pattern) === merchantNorm;
    best = {
      categoryId: rule.categoryId,
      space: rule.space || null,
      expenseType: rule.expenseType || null,
      confidence: rule.learned ? (exact ? 99 : 94) : (exact ? 95 : 88),
      reason: `חוק ${rule.learned ? 'שנלמד' : 'קיים'}: ${rule.pattern}`,
      source: 'rule',
      ruleId: rule.id,
    };
    break;
  }

  /* --- 2. היסטוריה: אותו בית עסק סווג בעבר --- */
  if (!best && merchantNorm) {
    const hit = historyIndex.get(merchantNorm);
    if (hit && hit.categoryId) {
      const purity = hit.categoryHits / hit.total;
      best = {
        categoryId: hit.categoryId,
        space: hit.space,
        expenseType: hit.expenseType,
        confidence: Math.round(clamp(72 + purity * 24 + Math.min(hit.total, 5), 72, 97)),
        reason: `סווג כך ${hit.total} פעמים בעבר`,
        source: 'history',
      };
    }
  }

  /* --- 3. חוקי בסיס מובנים לבתי עסק מוכרים --- */
  if (!best) {
    for (const seed of SEED_RULES) {
      if (seed.direction && seed.direction !== direction) continue;
      const hitPattern = seed.p.find((p) => patternHit(norm, rawLower, p));
      if (!hitPattern) continue;
      const space = seed.space || guessSpace(norm, account, defaultSpace).space;
      const cat = findCategory(categories, seed.cat, space, direction);
      if (!cat) continue;
      const exact = normalizeMerchant(hitPattern) === merchantNorm;
      best = {
        categoryId: cat.id,
        space: seed.space || null,
        expenseType: cat.defaultExpenseType || null,
        confidence: exact ? 92 : 84,
        reason: `זוהה בית עסק: ${hitPattern}`,
        source: 'seed',
      };
      break;
    }
  }

  /* --- 4. התאמה מקורבת להיסטוריה --- */
  // אחרון בסדר העדיפויות: התאמת מחרוזות מקורבת חלשה יותר מזיהוי ודאי של בית עסק.
  if (!best && merchantNorm && merchantNorm.length >= 4) {
    let bestSim = 0, bestHit = null;
    for (const [key, hit] of historyIndex) {
      if (!hit.categoryId) continue;
      const sim = similarity(key, merchantNorm);
      if (sim > bestSim) { bestSim = sim; bestHit = hit; }
    }
    if (bestHit && bestSim >= 0.78) {
      best = {
        categoryId: bestHit.categoryId,
        space: bestHit.space,
        expenseType: bestHit.expenseType,
        confidence: Math.round(clamp(bestSim * 82, 55, 82)),
        reason: `דומה ל"${bestHit.sample?.merchant || bestHit.key}"`,
        source: 'similar',
      };
    }
  }

  /* --- 4.5 ענף העסקה מדוח האשראי --- */
  // חברות האשראי מציינות ענף לכל עסקה. הוא פחות אמין מזיהוי בית עסק,
  // אך טוב בהרבה מ"לא זוהה", ולכן משמש רק כשאין התאמה טובה יותר.
  if (!best && row.sourceCategory) {
    const branch = normalizeMerchant(row.sourceCategory);
    const name = Object.keys(BRANCH_CATEGORIES).find((k) => branch === normalizeMerchant(k));
    if (name) {
      const space = guessSpace(norm, account, defaultSpace).space;
      const cat = findCategory(categories, BRANCH_CATEGORIES[name], space, direction);
      if (cat) {
        best = {
          categoryId: cat.id,
          space: null,
          expenseType: cat.defaultExpenseType || null,
          confidence: 74,
          reason: `ענף בדוח האשראי: ${row.sourceCategory}`,
          source: 'branch',
        };
      }
    }
  }

  /* --- 5. הכרעת מרחב --- */
  const spaceGuess = guessSpace(norm, account, defaultSpace);
  const space = best?.space || spaceGuess.space;
  const spaceConfidence = best?.space ? Math.max(spaceGuess.confidence, best.confidence) : spaceGuess.confidence;

  /* --- 6. אין התאמה: קטגוריית ברירת מחדל בביטחון נמוך --- */
  if (!best) {
    const fb = fallbackCategory(categories, space, direction);
    best = {
      categoryId: fb?.id || null,
      space,
      expenseType: direction === 'income' ? null : 'variable',
      confidence: 30,
      reason: 'לא זוהה בית עסק מוכר',
      source: 'fallback',
    };
  }

  /* --- 7. תיקוף הקטגוריה מול המרחב והכיוון בפועל --- */
  let categoryId = best.categoryId;
  const cat = categories.find((c) => c.id === categoryId);
  const wantKind = direction === 'income' ? 'income' : 'expense';
  if (!cat || cat.kind !== wantKind || cat.space !== space) {
    const byName = cat ? findCategory(categories, cat.name, space, direction) : null;
    categoryId = byName?.id || fallbackCategory(categories, space, direction)?.id || null;
    if (!byName && cat) best.confidence = Math.min(best.confidence, 60);
  }

  const expenseType = direction === 'income'
    ? null
    : (best.expenseType || categories.find((c) => c.id === categoryId)?.defaultExpenseType || 'variable');

  const confidence = Math.round(clamp(best.confidence, 0, 100));

  return {
    categoryId,
    space,
    expenseType,
    confidence,
    spaceConfidence,
    reason: best.reason,
    source: best.source,
    ruleId: best.ruleId || null,
    needsReview: confidence < 70,
    needsSpaceReview: spaceConfidence < 65,
  };
}

/**
 * האם דפוס מופיע בטקסט.
 * דפוסים שמכילים ספרות בלבד (למשל "019") נעלמים בנרמול,
 * ולכן נבדקים מול הטקסט הגולמי ובגבולות מילה.
 */
function patternHit(norm, rawLower, pattern) {
  const np = normalizeMerchant(pattern);
  if (np) return norm.includes(np);
  const raw = String(pattern).trim().toLowerCase();
  if (!raw) return false;
  return new RegExp(`(^|[^\\d])${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\d]|$)`).test(rawLower);
}

function ruleMatches(rule, row, norm) {
  if (!rule.pattern) return false;
  if (rule.direction && rule.direction !== row.direction) return false;
  const pat = rule.pattern;
  if (rule.matchType === 'regex') {
    try { return new RegExp(pat, 'i').test(`${row.merchant} ${row.description}`); }
    catch { return false; }
  }
  const np = normalizeMerchant(pat);
  if (!np) return false;
  if (rule.matchType === 'exact') return normalizeMerchant(row.merchant) === np;
  return norm.includes(np);
}

/** הכרעת עסקי/פרטי לפי החשבון, מילות מפתח והעדפת ברירת מחדל */
export function guessSpace(normText, account, defaultSpace = 'personal') {
  // החשבון שאליו שויך הקובץ הוא האינדיקציה החזקה ביותר
  if (account?.space) {
    const hintsAgainst = account.space === 'business'
      ? PERSONAL_HINTS.some((r) => r.test(normText))
      : BUSINESS_HINTS.some((r) => r.test(normText));
    return { space: account.space, confidence: hintsAgainst ? 58 : 88 };
  }
  const biz = BUSINESS_HINTS.filter((r) => r.test(normText)).length;
  const per = PERSONAL_HINTS.filter((r) => r.test(normText)).length;
  if (biz > per) return { space: 'business', confidence: clamp(62 + biz * 8, 62, 90) };
  if (per > biz) return { space: 'personal', confidence: clamp(62 + per * 8, 62, 90) };
  return { space: defaultSpace, confidence: 45 };
}

/* ============================================================
   למידה
   ============================================================ */

/**
 * יצירת חוק חדש מהחלטת המשתמש.
 * הדפוס נגזר מהחלק המשמעותי בשם בית העסק (ללא מספרי סניף).
 */
export function learnFromDecision(row, decision) {
  const pattern = derivePattern(row.merchant || row.name || '');
  if (!pattern) return null;
  return {
    pattern,
    matchType: 'contains',
    categoryId: decision.categoryId,
    space: decision.space || null,
    direction: decision.direction || null,
    expenseType: decision.expenseType || null,
    priority: 90,
    learned: true,
    hits: 1,
  };
}

/** "שופרסל דיל רמת גן 1234" → "שופרסל דיל" */
export function derivePattern(merchant) {
  const clean = String(merchant || '')
    .replace(/[‎‏]/g, '')
    .replace(/\b\d{2,}\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!clean) return '';
  const words = clean.split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return clean;
  return words.slice(0, Math.min(2, words.length)).join(' ');
}

/** רמת ביטחון → תווית ומחלקת עיצוב */
export function confidenceLabel(c) {
  if (c >= 90) return { label: 'בטוח', cls: 'hi' };
  if (c >= 70) return { label: 'כנראה נכון', cls: 'mid' };
  return { label: 'דורש בדיקה', cls: 'lo' };
}
