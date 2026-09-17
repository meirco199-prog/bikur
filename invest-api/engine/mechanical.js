// יקום מכני — פונקציה טהורה. כלל: חברי S&P 500 → סינון נזילות → מכסה לפי ענף (יחסית להרכב המדד) → הגדולות בענף.
// למה מכסה: התוכנית החינמית (KV 1,000 כתיבות/יום, מכסות ספקים) לא מאפשרת לנתח 500 חברות כל לילה. המכסה נשמרת
// פרופורציונלית להרכב הענפי של המדד כדי לא להטות לטכנולוגיה/מגה-קאפ יותר מהמדד עצמו.
// cap/maxAddPerRun גדולים מהמדד: כל חברי ה-S&P 500 נכנסים (הניתוח שלהם רץ ב-GitHub Actions ונשמר ב-shards, לא כתיבה לכל נייר)
export const MECHANICAL_RULE = { minVolume: 500000, cap: 600, maxAddPerRun: 600, minMembersForSectorQuota: 3 };
// דגימה יציבה כשאין נתוני גודל: hash של הסימבול (לא אלפביתי, לא אקראי בין ריצות)
export const stableHash = (s) => { let h = 2166136261; for (const ch of String(s)){ h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };

// members: [{symbol,name,sector}] (S&P 500), liquidity: Map/obj symbol → {volume, marketCap, sector?, name?}
export function selectMechanical({ members = [], liquidity = {}, cap = MECHANICAL_RULE.cap, minVolume = MECHANICAL_RULE.minVolume } = {}){
  const liq = (s) => liquidity[s] || null;
  const valid = members.filter((m) => m?.symbol && /^[A-Z][A-Z0-9.\-]{0,6}$/.test(m.symbol));
  const withLiq = valid.filter((m) => liq(m.symbol));
  // נזילות: אם אין נתוני מחזור לאף חבר (screener נכשל) — לא מסננים ומסמנים
  const liquidityKnown = withLiq.length >= valid.length * 0.5;
  const liquid = liquidityKnown ? valid.filter((m) => (liq(m.symbol)?.volume ?? 0) >= minVolume) : valid;
  const sectorOf = (m) => m.sector || liq(m.symbol)?.sector || 'Unknown';
  // גודל ידוע (שווי שוק / משקל במדד) → הגדולות בענף; לא ידוע → דגימה מרובדת יציבה לפי hash (לא אלפביתי)
  const sizeKnown = liquid.filter((m) => (liq(m.symbol)?.marketCap ?? 0) > 0).length >= liquid.length * 0.5;
  const capOf = (m) => (sizeKnown ? (liq(m.symbol)?.marketCap ?? 0) : -stableHash(m.symbol));
  const bySector = new Map();
  for (const m of liquid){ const s = sectorOf(m); if (!bySector.has(s)) bySector.set(s, []); bySector.get(s).push(m); }
  for (const arr of bySector.values()) arr.sort((a, b) => capOf(b) - capOf(a) || a.symbol.localeCompare(b.symbol));
  // מכסה לענף: לפי חלקו בקבוצה המסוננת (עיגול למטה, לפחות minMembers), ואז השלמה עד cap לפי שווי שוק כללי
  const n = liquid.length || 1;
  const quota = new Map([...bySector.entries()].map(([s, arr]) => [s, Math.min(arr.length, Math.max(Math.min(arr.length, MECHANICAL_RULE.minMembersForSectorQuota), Math.floor(cap * arr.length / n)))]));
  const chosen = new Set();
  for (const [s, arr] of bySector) for (const m of arr.slice(0, quota.get(s))) chosen.add(m.symbol);
  const rest = liquid.filter((m) => !chosen.has(m.symbol)).sort((a, b) => capOf(b) - capOf(a) || a.symbol.localeCompare(b.symbol));
  for (const m of rest){ if (chosen.size >= cap) break; chosen.add(m.symbol); }
  const out = liquid.filter((m) => chosen.has(m.symbol)).slice(0, cap).map((m) => ({ symbol: m.symbol, name: m.name || liq(m.symbol)?.name || m.symbol, sector: sectorOf(m), marketCap: capOf(m) || null, volume: liq(m.symbol)?.volume ?? null }));
  const sectors = Object.fromEntries([...bySector.keys()].sort().map((s) => [s, { members: bySector.get(s).length, selected: out.filter((x) => x.sector === s).length }]));
  return { items: out, members: valid.length, liquid: liquid.length, liquidityKnown, sizeKnown, sectors, rule: `S&P 500 → ${liquidityKnown ? `מחזור יומי ≥ ${minVolume.toLocaleString('en-US')}` : 'נזילות לא נבדקה (חברי המדד נזילים בהגדרה)'} → מכסה לענף לפי חלקו במדד → ${sizeKnown ? 'הגדולות בענף' : 'דגימה מרובדת יציבה (אין נתוני גודל)'} (עד ${cap})` };
}
