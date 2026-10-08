// שומר הגבול של גשר IBKR: הגשר עובד מול חשבון דמה בלבד (מזהה שמתחיל ב-DU). אין עקיפה במשתנה סביבה —
// מסחר בחשבון אמיתי הוא החלטה נפרדת של בעל הריפו (order-gate.js: approval עם hash), לא דבר שהגשר הזה עושה.
export function isPaperAccount(acct){ return typeof acct === 'string' && /^DU/i.test(acct); }

export function assertPaperAccount(acct){
  if (!isPaperAccount(acct)) throw new Error(`החשבון ${acct} לא נראה כחשבון דמה (DU...). הגשר מסרב לעבוד מול חשבון אמיתי.`);
  return acct;
}
