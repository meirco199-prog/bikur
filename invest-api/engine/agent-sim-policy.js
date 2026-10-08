// מדיניות הסימולציה של הסוכן האוטונומי הרב-נכסי. קובץ CODEOWNERS.
// הרקע (AI_COUNCIL#21): בעל הריפו, 23/9/2026 — "אני רוצה שתשנה לגמרי את האפליקציה במהות שלה. אני לא רוצה את התיק הסולידי…
// שתדע איפה להשקיע בסחורות, בקריפטו, במניות עם הזדמנויות. למכור, לקנות. בניירות ערך במינוף… תוכנת דמה שתדמה את כל ההשקעות
// שניתן לעשות שם [ב-IBKR]… כל סוג של השקעה יהיה רלוונטי. גם מינופים."
// לכן: כל סוגי המכשירים, שורט ומינוף — **בסימולציה בלבד** (mode: simulation; כסף אמיתי דורש אישור נפרד עם hash, ראה order-gate.js).
// עצירות החשבון (הפסד יומי, ירידה מהשיא, kill switch) נשארות מחייבות גם בסימולציה — כך לומדים אם המערכת שורדת לפני שמדברים על כסף.
export const AGENT_SIM_POLICY = Object.freeze({
  version: 1,
  mode: 'simulation',
  approval: null,
  capitalIls: 200000,
  allowedClasses: Object.freeze(['stock', 'etf', 'crypto', 'fx', 'future']),
  allowedExchanges: null,
  shorting: true,
  unboundedLoss: true,                // שורט, חוזים ו-ETF ממונפים — ההפסד עלול לעלות על הסכום שהוקצה; מוגן ע"י עצירות וחיסול margin
  leverage: Object.freeze({ total: 3.0, byClass: Object.freeze({ stock: 2.0, etf: 3.0, bond: 3.0, fx: 5.0, future: 5.0, option: 1.0, crypto: 1.0, cfd: 1.0 }) }), // חשיפה אפקטיבית (כולל מינוף פנימי של ETF ממונף) ÷ הון
  maxTradeShare: 0.10,                // פקודה אחת ≤ 10% מההון (בחשיפה אפקטיבית)
  maxAssetShare: 0.15,
  maxSectorShare: 0.35,
  maxStrategyShare: 0.45,
  maxClassShare: Object.freeze({ crypto: 0.15, fx: 0.30, future: 0.50, etf: 1.5, stock: 1.0 }),
  maxDailyLoss: 0.04,                 // 4% ביום → אין סיכון חדש עד מחר
  maxDrawdown: 0.20,                  // 20% מהשיא → אין סיכון חדש עד החלטת בעל הריפו
  liquidityReserve: 0,                // margin account: אין דרישת מזומן חיובי; ההגנה היא marginBuffer
  marginBuffer: 0.25,                 // כספים זמינים ÷ דרישת margin ≥ 1.25 אחרי הפקודה
  noAveragingDown: true,
  maxOrdersPerDay: 12,
  requireFreshData: true,             // מחיר סגירה של סשן ההחלטה לכל מכשיר; מחיר ישן = אין פקודה
  requireMarketOpen: true,
  killSwitch: false,                  // ניתן להדלקה מבחוץ (KV agent:kill) בלי שינוי קוד
});

// פרופיל אגרסיבי (החלטת מאיר, 8/10/2026: "אני רוצה שהדמה יפעל באופן אגרסיבי"). **סימולציה/דמה בלבד.**
// מה משתנה: הכושר לפעול — תקרות הפקודה/נכס/אסטרטגיה/ענף ומכסת הפקודות. ב-7/10 החשיפה הייתה 0.84× מול מינוף מותר 3×;
// החסם היה תקרות האסטרטגיה והענף, לא המינוף. מה מוחמר: הפסד יומי, ירידה מהשיא, margin buffer וקריפטו. המינוף הכולל במקסימום (×3, כמו המאוזן — התקרה של חשבון הדמה עצמו).
// מה לא משתנה: mode=simulation, approval=null, kill switch ושער הפקודות. כסף אמיתי דורש approval עם hash (order-gate.js).
export const AGENT_SIM_POLICY_AGGRESSIVE = Object.freeze({
  ...AGENT_SIM_POLICY,
  version: 2,
  profile: 'aggressive',
  leverage: Object.freeze({ ...AGENT_SIM_POLICY.leverage, byClass: Object.freeze({ ...AGENT_SIM_POLICY.leverage.byClass, option: 3.0 }) }), // option: הפרמיה היא ההפסד המקסימלי, אין אשראי עליה — כך שתקרת הסוג לא תחסום אופציה כשהחשבון כבר מנוצל;  // מקסימום (החלטת מאיר 8/10): ×3 = כוח הקנייה של חשבון הדמה (buyingPower ÷ netLiq ≈ 3.02 ב-7/10); מעבר לכך IBKR דוחה פקודות
  maxTradeShare: 0.12,
  maxAssetShare: 0.18,
  maxSectorShare: 0.40,
  maxStrategyShare: 0.55,
  allowedClasses: Object.freeze([...AGENT_SIM_POLICY.allowedClasses, 'option']),   // אופציות: קנייה בלבד (engine/options.js), סימולציה בלבד
  maxClassShare: Object.freeze({ ...AGENT_SIM_POLICY.maxClassShare, crypto: 0.10, option: 0.15 }),
  options: Object.freeze({ enabled: true, premiumBudgetPct: 0.03, maxContractPremiumPct: 0.06, minDte: 30, maxOpen: 3, maxNewPerDay: 1, stopPct: 0.5, exitDte: 2 }),
  maxDailyLoss: 0.03,
  maxDrawdown: 0.15,
  marginBuffer: 0.30,
  maxOrdersPerDay: 20,
});

export const AGENT_POLICY_PROFILES = Object.freeze({ balanced: AGENT_SIM_POLICY, aggressive: AGENT_SIM_POLICY_AGGRESSIVE });
// ברירת המחדל לדמה. חזרה למאוזן בלי שינוי קוד: POST /agent/profile?profile=balanced (KV agent:profile).
export const DEFAULT_AGENT_PROFILE = 'aggressive';
