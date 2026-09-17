// מגבלות סיכון קשיחות — "מנוע הסיכונים". האוטומט (engine/autopilot.js) לא יכול לחרוג מהן, רק להיות שמרני יותר.
// לכסף אמיתי: הקובץ הזה צריך להיות מוגן (branch protection / CODEOWNERS) כך ששינוי בו דורש אישור של בעל החשבון,
// ולא של הסוכן שכותב את שאר הקוד. Object.freeze מונע שינוי בזמן ריצה.
export const RISK_LIMITS = Object.freeze({
  maxActiveShare: 0.20,        // מניות בודדות: לא יותר מ-20% מהתיק (hard cap, גם אם הפרופיל אומר אחרת)
  maxPositionShare: 0.10,      // נייר בודד: לא יותר מ-10% מהתיק
  maxOpenRisk: 0.03,           // סכום (שווי × מרחק לעצירה) על כל המניות הבודדות ≤ 3% מהתיק
  maxSectorOpenRisk: 0.015,    // אותו דבר לענף אחד ≤ 1.5%
  maxBuysPerDay: 3,
  leverage: false,             // אין מינוף, אין מזומן שלילי
  shortSelling: false,
  options: false,
  requireEarningsDateLive: true, // בכסף אמיתי: אין תאריך דוח ידוע → אין פתיחת פוזיציה חדשה
  allowedTypes: Object.freeze(['stock', 'etf']),
});
