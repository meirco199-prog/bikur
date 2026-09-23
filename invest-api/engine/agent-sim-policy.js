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
  shortLeveraged: false,              // אין שורט על ETF ממונף/הפוך/VIX (squeeze, borrow 3%+); לונג על הלא-ממונף בכיוון ההפוך במקום (AI_COUNCIL#21)
  unboundedLoss: true,                // שורט, חוזים ו-ETF ממונפים — ההפסד עלול לעלות על הסכום שהוקצה; מוגן ע"י עצירות וחיסול margin
  leverage: Object.freeze({ total: 3.0, byClass: Object.freeze({ stock: 2.0, etf: 3.0, bond: 3.0, fx: 5.0, future: 5.0, option: 1.0, crypto: 1.0, cfd: 1.0 }) }), // חשיפה אפקטיבית (כולל מינוף פנימי של ETF ממונף) ÷ הון
  maxTradeShare: 0.10,                // פקודה אחת ≤ 10% מההון (בחשיפה אפקטיבית)
  maxAssetShare: 0.15,
  maxSectorShare: 0.30,               // אשכול (tech/energy/metals/index…) ≤ 30% — מגבלת מתאם גסה לפני מינוף (AI_COUNCIL#21)
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
