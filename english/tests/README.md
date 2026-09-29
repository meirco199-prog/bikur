# בדיקות

| מה | איך מריצים | מה מכוסה |
|---|---|---|
| **יחידה (node, בלי דפדפן)** | `node --test english/tests/unit` (מהשורש) | `adaptive` — A1→C2 בכל המיומנויות, C2→A1, טעות מקרית אחת, ניחוש אחד, תשובה בודדת לא קובעת; `realtime-events` — פענוח אירועי Realtime GA (session.created = מחובר, כתוביות, תמלול, קטיעה/זמנים, כלים, שגיאות, שמות beta); `reminder` — חלון התזכורת לשיעור ב-SW ובשרת push (אזור זמן, פעם ביום); `curriculum` — דיבור בלי הערכת מורה = `null`, חציון מהנמדד, תזכורת מדברת על השיעור הבא |
| **דפדפן (Playwright headless, mock ל-Workers)** | `npm i playwright` פעם אחת (בשורש) + כרומיום של Playwright (או `CHROMIUM=/path`), ואז `english/tests/browser/run.sh` | קורס מלא (אבחון, שקפים, חידונים, סיכום, שיעור 2), תלמיד C1/C2 עם תקלה/ניחוש, תזכורת אמיתית (SW/מנוי מזויפים), fallback כשה-Worker רדום, **realtime נכשל ב-SDP → תג "זרימה רגילה"**, realtime עם WebRTC מזויף (session.created → תג Realtime, כלים, show_slide) |
| **smoke אמיתי מול OpenAI** (בתשלום — שניות) | Actions → "Realtime smoke (OpenAI GA)" → Run; או מקומית `npm i ws && LIVE_URL=https://english-live.meirco199.workers.dev node english/tests/smoke/realtime-smoke.mjs` | `/health` → `/session` (client secret GA) → WebSocket ל-OpenAI עם ה-client secret → `session.created` (מודל + session id) → תגובת טקסט → `POST /v1/realtime/calls` מקבל את ה-auth |

אין צורך להריץ את ה-smoke על כל commit — הוא ידני. הבדיקות האחרות לא נוגעות ברשת.
