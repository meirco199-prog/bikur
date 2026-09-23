// מדיניות המסחר של הסוכן האוטונומי — הקובץ היחיד שקובע מה מותר לשלוח לברוקר. קובץ CODEOWNERS: שינוי דורש אישור בעל הריפו.
// מצב חי (live) דורש רשומת אישור עם hash של המדיניות המדויקת (ראה policyHash ב-order-gate.js); כל שינוי במדיניות מבטל את האישור.
// ברירת המחדל כאן היא סימולציה בלבד, בלי מינוף, בלי שורט, בלי נגזרים — כמו RISK_LIMITS של המסלולים הקיימים.
export const TRADING_POLICY = Object.freeze({
  version: 1,
  mode: 'simulation',                 // 'simulation' | 'paper' (IBKR Paper) | 'live' — live רק עם approval תואם
  approval: null,                     // { at, by, policyHash, capitalIls } — נכתב רק על ידי בעל הריפו
  capitalIls: 200000,                 // ההון שמותר לסוכן לסכן (לא בהכרח כל החשבון)
  allowedClasses: Object.freeze(['stock', 'etf']),   // stock | etf | bond | fx | future | option | crypto | cfd
  allowedExchanges: null,             // null = כל בורסה שמופיעה במפת היכולות
  shorting: false,
  shortLeveraged: false,
  unboundedLoss: false,               // מכשירים שההפסד בהם עלול לעלות על ההון שהוקצה (שורט, futures, אופציות שנמכרו, CFD)
  leverage: Object.freeze({ total: 1.0, byClass: Object.freeze({ stock: 1.0, etf: 1.0, bond: 1.0, fx: 1.0, future: 1.0, option: 1.0, crypto: 1.0, cfd: 1.0 }) }), // חשיפה ברוטו ÷ הון
  maxTradeShare: 0.05,                // שווי פקודה אחת ÷ הון
  maxAssetShare: 0.10,                // נייר אחד אחרי הפקודה
  maxSectorShare: 0.25,
  maxStrategyShare: 0.30,
  maxClassShare: Object.freeze({ crypto: 0.05, option: 0.05, future: 0.20, fx: 0.20 }), // תקרות לסוג מכשיר (חסר = בלי תקרה מיוחדת)
  maxDailyLoss: 0.02,                 // הפסד יומי (ממומש+לא ממומש) ÷ הון → עצירת סיכון חדש
  maxDrawdown: 0.10,                  // ירידה מהשיא → עצירת סיכון חדש
  liquidityReserve: 0.10,             // מזומן ÷ הון שחייב להישאר אחרי קנייה
  marginBuffer: 0.30,                 // (כספים זמינים ÷ דרישת margin) ≥ 1 + buffer, כשיש נתוני margin
  noAveragingDown: true,              // אין הגדלת פוזיציה מפסידה
  maxOrdersPerDay: 20,
  requireFreshData: true,             // בלי quote חי מהיום — אין פתיחת פוזיציה
  requireMarketOpen: true,
  killSwitch: false,                  // true = שום פקודה חדשה, גם לא סגירה אוטומטית (סגירה ידנית בלבד)
});
