---
applies_to: [english-ai/, english-live/, english-push/]
docs: [english/README.md]
---
# מדיניות סקירה — אפליקציית האנגלית (english/, english-ai/, english-live/, english-push/)

- **אין fake metrics**: כל ציון, אחוז, "רמה" או התקדמות שמוצגים ללומד חייבים לנבוע ממדידה אמיתית בקוד. ערך קבוע, אקראי
  או "משוער" שמוצג כמדד = MISLEADING UI/METRIC חוסם.
- **הגייה (pronunciation) רק אם באמת נמדדה**: ציון הגייה מוצג רק כשיש תוצאת זיהוי/השוואה בפועל; בלי מדידה — לא להציג ציון.
- **realtime ו-fallback חייבים להישאר**: השיעור החי עובד גם בלי `OPENAI_API_KEY` (STT/TTS של הדפדפן, עם קטיעה). שינוי שמסיר
  את ה-fallback, או שגורם לזרימת ה-realtime להיכשל בלי נפילה שקטה לזרימה הרגילה = REGRESSION חוסם.
- **Mobile Chrome (אנדרואיד) הוא היעד הראשי**: Web Speech API, אודיו, PWA והתקנה חייבים לעבוד שם; iOS — best effort.
- **אין סודות בצד הלקוח**: כל קריאת AI דרך ה-Workers (`english-ai`, `english-live`); הלקוח מקבל רק client_secret קצר-חיים.
- **course / placement / slides חייבים לעבוד באמת**: אבחון רמה (placement) מבוסס תשובות בפועל, הקורס מתקדם לפי הנתונים
  שנשמרו, והשקפים מוצגים ונשלטים כפי שהתיאור מבטיח — לא placeholder.
- **אופליין ו-PWA**: `sw.js` cache version מתקדם כשמשנים קבצים סטטיים; אחרת המשתמש נתקע על גרסה ישנה (REGRESSION).
- **localStorage** הוא מקור האמת להתקדמות: שינוי במבנה הנתונים דורש מיגרציה או תאימות לאחור.
