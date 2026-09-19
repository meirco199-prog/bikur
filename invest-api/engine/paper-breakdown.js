// פירוק חשבון התרגול המאוזן: רווח/הפסד מצטבר לפי נייר, עמלות, הפרשי מטבע ובחירת נייר, ידני מול אוטומט, ושינויים מאז
// הפעלת גרסת האוטומט הנוכחית. פונקציה טהורה: מקבלת עסקאות ומחירים נוכחיים, לא נוגעת ב-DB. לא מייחסת הפסד לאסטרטגיה
// בלי לבדוק מתי הפוזיציה נפתחה — כל שורה נושאת תאריך פתיחה וגרסת האוטומט שהייתה בתוקף אז (אם ידועה).
import { isNum, round } from './util.js';
import { bucketOf } from './tracks.js';

const isAutoReason = (r) => /^אוטומט:/.test(r || '');
// הערה על עמלות: costIls (עלות הכניסה) כבר כולל את עמלת הכניסה, ולכן unrealizedIls (מחושב מול costIls) כבר נטו ממנה;
// pnlIls של הברוקר בעסקה סגורה מחושב מתמורה ברוטו פחות costIls, כך שגם הוא כבר נטו מעמלת הכניסה אך *לא* מעמלת היציאה —
// היא מנוכה כאן בנפרד. feesIls בפירוק הוא מדד מידע ("כמה שולם בעמלות בסך הכול") ואינו מנוכה שוב מ-netIls, אחרת עמלת
// הכניסה הייתה נספרת פעמיים.

// פיצול P&L לפני עמלה לתרומת מחיר (ב-fx הכניסה, "אילו הדולר לא זז") ותרומת מטבע (השארית)
// entryFx/exitFx: שערי הדולר-שקל בכניסה וביציאה (או עכשיו לפוזיציה פתוחה)
function splitPnl(qty, entryPrice, entryFx, exitPrice, exitFx){
  if (![qty, entryPrice, entryFx, exitPrice, exitFx].every(isNum)) return { priceIls: null, fxIls: null, totalIls: null };
  const totalIls = qty * exitPrice * exitFx - qty * entryPrice * entryFx;
  const priceIls = qty * (exitPrice - entryPrice) * entryFx;
  const fxIls = totalIls - priceIls;
  return { priceIls: round(priceIls, 2), fxIls: round(fxIls, 2), totalIls: round(totalIls, 2) };
}

/**
 * paperBreakdown — פירוק מלא של חשבון התרגול.
 * trades: כל הרישומים (פתוחים+סגורים) מ-PaperBroker.trades().
 * priceOf(symbol) → מחיר נוכחי (USD/ILS לפי המטבע של הנכס); fx → שער דולר-שקל נוכחי.
 * table: rank.table (לשיוך דלי הקצאה ולשם הנייר); nameOf(symbol) → שם עברי/לועזי.
 * journal: auto:journal (למיפוי יום→גרסת כללים, לקביעת מתי הופעלה האסטרטגיה הנוכחית).
 * currentVersion: AUTO_RULES.version הנוכחי; targets: PROFILES[profile].sleeves.
 */
export function paperBreakdown({ trades = [], account, priceOf, fx, table = [], nameOf = (s) => s, journal = [], currentVersion = null, targets = null } = {}){
  const currentStart = journal.filter((j) => j.executed && j.rulesVersion === currentVersion).map((j) => j.day).sort()[0] || null;

  const bySymbol = new Map();
  const get = (sym) => { if (!bySymbol.has(sym)) bySymbol.set(sym, { symbol: sym, name: nameOf(sym), realizedIls: 0, unrealizedIls: 0, feesIls: 0, priceEffectIls: 0, fxEffectIls: 0, qtyOpen: 0, autopilotIls: 0, manualIls: 0, trades: 0, bucket: bucketOf(sym, table) }); return bySymbol.get(sym); };

  let totalRealized = 0, totalUnrealized = 0, totalFees = 0, totalPriceEffect = 0, totalFxEffect = 0;
  let sinceStartIls = 0, beforeStartIls = 0, sinceStartTrades = 0, beforeStartTrades = 0;
  let manualIls = 0, autopilotIls = 0, manualTrades = 0, autopilotTrades = 0;

  for (const t of trades){
    const s = get(t.symbol);
    const entryDay = (t.snapDate || t.date || '').slice(0, 10);
    const auto = isAutoReason(t.reason);
    const isCurrentStrategy = auto && currentStart && entryDay >= currentStart;
    s.trades++;
    const entryFee = t.feeIls || 0;
    s.feesIls += entryFee; totalFees += entryFee;

    if (t.exitDate){
      // סגורה: רווח/הפסד ממומש, כולל עמלת יציאה
      const exitFee = t.exitFeeIls || 0;
      s.feesIls += exitFee; totalFees += exitFee;
      const pnl = round((isNum(t.pnlIls) ? t.pnlIls : 0) - exitFee, 2); // נטו מעמלת היציאה (עמלת הכניסה כבר בתוך costIls)
      s.realizedIls += pnl; totalRealized += pnl;
      const split = splitPnl(t.qty, t.price, t.fx, t.exitPrice, t.exitFx);
      if (isNum(split.priceIls)){ s.priceEffectIls += split.priceIls; s.fxEffectIls += split.fxIls; totalPriceEffect += split.priceIls; totalFxEffect += split.fxIls; }
      if (auto){
        s.autopilotIls += pnl; autopilotIls += pnl; autopilotTrades++;
        if (isCurrentStrategy){ sinceStartIls += pnl; sinceStartTrades++; } else { beforeStartIls += pnl; beforeStartTrades++; }
      } else { s.manualIls += pnl; manualIls += pnl; manualTrades++; }
    } else {
      // פתוחה: רווח/הפסד לא ממומש לפי המחיר הנוכחי
      const cur = priceOf(t.symbol);
      s.qtyOpen += t.qty;
      if (isNum(cur)){
        const valIls = t.qty * cur * (t.currency === 'ILS' ? 1 : fx);
        const unreal = round(valIls - (t.costIls || 0), 2);
        s.unrealizedIls += unreal; totalUnrealized += unreal;
        const split = splitPnl(t.qty, t.price, t.fx, cur, t.currency === 'ILS' ? 1 : fx);
        if (isNum(split.priceIls)){ s.priceEffectIls += split.priceIls; s.fxEffectIls += split.fxIls; totalPriceEffect += split.priceIls; totalFxEffect += split.fxIls; }
        if (auto){ s.autopilotIls += unreal; autopilotIls += unreal; if (isCurrentStrategy) sinceStartIls += unreal; else beforeStartIls += unreal; } else { s.manualIls += unreal; manualIls += unreal; }
      }
      if (auto){ autopilotTrades++; if (isCurrentStrategy) sinceStartTrades++; else beforeStartTrades++; } else manualTrades++;
    }
  }

  const bySymbolArr = [...bySymbol.values()].map((s) => ({ ...s, netIls: round(s.realizedIls + s.unrealizedIls, 2), realizedIls: round(s.realizedIls, 2), unrealizedIls: round(s.unrealizedIls, 2), feesIls: round(s.feesIls, 2), priceEffectIls: round(s.priceEffectIls, 2), fxEffectIls: round(s.fxEffectIls, 2), autopilotIls: round(s.autopilotIls, 2), manualIls: round(s.manualIls, 2) })).sort((a, b) => a.netIls - b.netIls);

  // הקצאה: יעד (מהפרופיל) מול בפועל (מהחזקות בפועל, לפי דלי) ומזומן פנוי
  const buckets = { stocks: 0, etf: 0, bonds: 0, gold: 0 };
  for (const t of trades) if (!t.exitDate && isNum(priceOf(t.symbol))) buckets[bucketOf(t.symbol, table)] += t.qty * priceOf(t.symbol) * (t.currency === 'ILS' ? 1 : fx);
  const totalIls = account.cashIls + Object.values(buckets).reduce((s, v) => s + v, 0);
  const allocation = { target: targets, actual: { stocksShare: totalIls ? round(buckets.stocks / totalIls, 3) : 0, etfShare: totalIls ? round(buckets.etf / totalIls, 3) : 0, bondsShare: totalIls ? round(buckets.bonds / totalIls, 3) : 0, goldShare: totalIls ? round(buckets.gold / totalIls, 3) : 0, cashShare: totalIls ? round(account.cashIls / totalIls, 3) : 0 }, freeCashIls: round(account.cashIls, 2) };

  const netTotal = round(totalRealized + totalUnrealized, 2); // כבר נטו מכל העמלות (כניסה דרך costIls, יציאה כאן למעלה); feesIls נשאר למידע בלבד
  return {
    totals: { realizedIls: round(totalRealized, 2), unrealizedIls: round(totalUnrealized, 2), feesIls: round(totalFees, 2), priceEffectIls: round(totalPriceEffect, 2), fxEffectIls: round(totalFxEffect, 2), netIls: netTotal },
    bySource: { autopilot: { netIls: round(autopilotIls, 2), trades: autopilotTrades }, manual: { netIls: round(manualIls, 2), trades: manualTrades } },
    strategy: { currentVersion, activeSinceDay: currentStart, sinceIls: round(sinceStartIls, 2), sinceTrades: sinceStartTrades, beforeIls: round(beforeStartIls, 2), beforeTrades: beforeStartTrades, note: currentStart ? `גרסה ${currentVersion} פעילה מ-${currentStart} — כולל רק עסקאות אוטומט; עסקאות ידניות נספרות בנפרד` : 'האוטומט עדיין לא רץ בגרסה הנוכחית' },
    allocation, bySymbol: bySymbolArr,
    reconciliation: { initialIls: account.initialIls, netPnlIls: netTotal, expectedTotalIls: round(account.initialIls + netTotal, 2), actualTotalIls: round(totalIls, 2), diffIls: round(round(account.initialIls + netTotal, 2) - totalIls, 2) },
  };
}
