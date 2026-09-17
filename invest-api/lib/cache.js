// מטמון KV עם TTL לוגי: מחזיר fresh אם בתוקף, אחרת מנסה לרענן; אם הרענון נכשל — מחזיר stale מסומן.
// לעולם לא מחליף בשקט נתון ישן בחדש-לכאורה: כל תשובה נושאת fetchedAt ו-stale.
export const TTL = { prices: 20 * 3600, quote: 15 * 60, profile: 7 * 86400, facts: 7 * 86400, ratios: 7 * 86400, est: 7 * 86400, analyst: 24 * 3600, news: 6 * 3600, insider: 24 * 3600, etf: 7 * 86400, earn: 7 * 86400, macro: 12 * 3600, fx: 12 * 3600, screener: 24 * 3600 };

export async function cached(db, key, ttlSec, fetcher, { merge } = {}){
  const ex = await db.get(key);
  const age = ex?.fetchedAt ? (Date.now() - Date.parse(ex.fetchedAt)) / 1000 : Infinity;
  if (ex && age < ttlSec) return { ...ex, stale: false, cacheAge: Math.round(age) };
  try {
    const fresh = await fetcher(ex);
    if (!fresh || fresh.missing){
      if (ex) return { ...ex, stale: true, cacheAge: Math.round(age), staleReason: fresh?.reason || 'refresh failed' };
      return fresh || { missing: true, reason: 'no data' };
    }
    const val = merge && ex ? merge(ex, fresh) : fresh;
    val.fetchedAt = new Date().toISOString();
    await db.put(key, val);
    return { ...val, stale: false, cacheAge: 0 };
  } catch (e) {
    await db.logError(key, e.message);
    if (ex) return { ...ex, stale: true, cacheAge: Math.round(age), staleReason: e.message };
    return { missing: true, reason: e.message, kind: e.kind };
  }
}
