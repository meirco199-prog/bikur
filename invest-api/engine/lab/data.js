// מעבדת האסטרטגיות — שכבת הנתונים. טהור (רץ ב-Node, ב-Worker של Cloudflare וב-Web Worker בדפדפן), בלי רשת.
//
// פורמט קובץ סדרה (compact, מופק על ידי scripts/lab-data.mjs ונשמר בענף lab-data):
//   { s:'AAPL', d:[ימים מאז 1970-01-01], o:[], h:[], l:[], c:[], v:[], a:[סגירה מתואמת], div:[[day,amt]], split:[[day,ratio]], meta:{name,sector,exchange,delisted} }
// שני סוגי מחירים נשמרים בכוונה (דרישה 10): מחירים גולמיים (o/h/l/c) לדימוי ביצוע — זה המחיר שבו באמת אפשר היה לקנות;
// סגירה מתואמת (a) לחישוב תשואות/אינדיקטורים ארוכים שחוצים פיצולים ודיבידנדים.
//
// לוח שנה: איחוד ימי המסחר של כל הסדרות (או של סדרת-אב כמו SPY). כל סדרה ממופה ללוח (pos[k] = אינדקס שורה או -1 = אין נר).
// חברות במדד point-in-time: מרווחי [מיום, עד יום) לכל סימבול — ביום k נבדקות רק מניות שהיו חברות באותו יום (דרישה 1 + 10).

export const DAY_MS = 86400000;
export const dayNum = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY_MS);
export const isoOf = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);
export const weekdayOf = (day) => new Date(day * DAY_MS).getUTCDay(); // 0=א' … 6=ש'
export const monthOf = (day) => new Date(day * DAY_MS).getUTCMonth() + 1;
export const yearOf = (day) => new Date(day * DAY_MS).getUTCFullYear();

const F64 = (a) => (a instanceof Float64Array ? a : Float64Array.from(a, (x) => (x === null || x === undefined ? NaN : +x)));

// סדרה אחת בזיכרון. מערכי Float64 (NaN = חסר). dayIndex: Map(יום → שורה).
export class Series {
  constructor(compact){
    if (!compact || !Array.isArray(compact.d)) throw new Error('סדרה לא תקינה: חסר מערך ימים d');
    this.sym = compact.s; this.n = compact.d.length;
    this.day = Int32Array.from(compact.d);
    this.o = F64(compact.o); this.h = F64(compact.h); this.l = F64(compact.l); this.c = F64(compact.c); this.v = compact.v && compact.v.length === compact.d.length ? F64(compact.v) : new Float64Array(compact.d.length);
    this.a = compact.a ? F64(compact.a) : this.c.slice();
    if ([this.o, this.h, this.l, this.c, this.a].some((x) => x.length !== this.n)) throw new Error(`סדרה ${this.sym}: אורכי מערכים לא תואמים`);
    for (let i = 1; i < this.n; i++) if (this.day[i] <= this.day[i - 1]) throw new Error(`סדרה ${this.sym}: ימים לא ממוינים/כפולים ב-${isoOf(this.day[i])}`);
    this.div = (compact.div || []).map(([d, amt]) => [d, +amt]).sort((x, y) => x[0] - y[0]);
    this.split = (compact.split || []).map(([d, r]) => [d, +r]).sort((x, y) => x[0] - y[0]);
    this.meta = compact.meta || {};
    this.dayIndex = new Map(); for (let i = 0; i < this.n; i++) this.dayIndex.set(this.day[i], i);
    this._adjOHL = null;
  }
  get from(){ return this.n ? this.day[0] : null; }
  get to(){ return this.n ? this.day[this.n - 1] : null; }
  // מקדם התאמה ליום i (adjClose/close) — להמרת open/high/low למונחים מתואמים
  factor(i){ const c = this.c[i]; return c > 0 && this.a[i] > 0 ? this.a[i] / c : 1; }
  adjOHL(){
    if (!this._adjOHL){
      const ao = new Float64Array(this.n), ah = new Float64Array(this.n), al = new Float64Array(this.n);
      for (let i = 0; i < this.n; i++){ const f = this.factor(i); ao[i] = this.o[i] * f; ah[i] = this.h[i] * f; al[i] = this.l[i] * f; }
      this._adjOHL = { o: ao, h: ah, l: al };
    }
    return this._adjOHL;
  }
  // אירועים ביום נתון (דיבידנד ex-date / פיצול) — O(log n) לא נדרש, הרשימות קצרות
  dividendOn(day){ let s = 0; for (const [d, amt] of this.div) if (d === day) s += amt; return s; }
  splitOn(day){ for (const [d, r] of this.split) if (d === day) return r; return null; }
  // חיתוך לטווח ימים (עם חימום) — חוסך זיכרון בדפדפן
  slice(fromDay, toDay){
    let i0 = 0, i1 = this.n; while (i0 < this.n && this.day[i0] < fromDay) i0++; while (i1 > i0 && this.day[i1 - 1] > toDay) i1--;
    return new Series({ s: this.sym, d: Array.from(this.day.subarray(i0, i1)), o: this.o.subarray(i0, i1), h: this.h.subarray(i0, i1), l: this.l.subarray(i0, i1), c: this.c.subarray(i0, i1), v: this.v.subarray(i0, i1), a: this.a.subarray(i0, i1), div: this.div.filter(([d]) => d >= fromDay && d <= toDay), split: this.split.filter(([d]) => d >= fromDay && d <= toDay), meta: this.meta });
  }
}

// המרת שורות [[iso,o,h,l,c,v],…] (הפורמט של שאר ה-engine) לפורמט compact
export function rowsToCompact(sym, rows, { adj = null, div = [], split = [], meta = {} } = {}){
  const out = { s: sym, d: [], o: [], h: [], l: [], c: [], v: [], a: [], div: div.map(([d, a]) => [typeof d === 'string' ? dayNum(d) : d, a]), split: split.map(([d, r]) => [typeof d === 'string' ? dayNum(d) : d, r]), meta };
  rows.forEach((r, i) => { out.d.push(typeof r[0] === 'string' ? dayNum(r[0]) : r[0]); out.o.push(r[1]); out.h.push(r[2]); out.l.push(r[3]); out.c.push(r[4]); out.v.push(r[5] ?? 0); out.a.push(adj ? adj[i] : r[4]); });
  return out;
}

// חברות במדד: מרשימות יומיות [{day, symbols:[…]}] (ממוינות) → מרווחים {SYM: [[from, to|null], …]} (to = היום הראשון שבו כבר לא חבר)
export function membershipFromDaily(snapshots){
  const snaps = snapshots.map((s) => ({ day: typeof s.day === 'string' ? dayNum(s.day) : s.day, set: new Set(s.symbols) })).sort((a, b) => a.day - b.day);
  const members = {}, open = new Map();
  for (const s of snaps){
    for (const sym of s.set) if (!open.has(sym)) open.set(sym, s.day);
    for (const [sym, from] of [...open]) if (!s.set.has(sym)){ (members[sym] ||= []).push([from, s.day]); open.delete(sym); }
  }
  for (const [sym, from] of open) (members[sym] ||= []).push([from, null]);
  return { members, from: snaps[0]?.day ?? null, to: snaps[snaps.length - 1]?.day ?? null, snapshots: snaps.length };
}
export function isMember(intervals, day){ if (!intervals) return false; for (const [a, b] of intervals) if (day >= a && (b === null || day < b)) return true; return false; }

// מערך הנתונים המלא לבדיקה אחת
export class Dataset {
  // series: Series[] · universe: {members, from, to} | null (null = כל הסדרות חברות תמיד) · sectors: {SYM: 'Technology'} · meta: {source, builtAt, …}
  constructor({ series = [], universe = null, sectors = {}, meta = {}, calendarFrom = null } = {}){
    this.series = new Map(); for (const x of series){ const s = x instanceof Series ? x : new Series(x); this.series.set(s.sym, s); }
    this.universe = universe; this.sectors = sectors || {}; this.meta = meta || {};
    const master = calendarFrom && this.series.get(calendarFrom);
    const days = new Set(); if (master) master.day.forEach((d) => days.add(d)); else for (const s of this.series.values()) s.day.forEach((d) => days.add(d));
    this.calendar = Int32Array.from([...days].sort((a, b) => a - b));
    this.calIndex = new Map(); this.calendar.forEach((d, k) => this.calIndex.set(d, k));
    this.pos = new Map(); // sym → Int32Array (k → row | -1)
    for (const s of this.series.values()){ const p = new Int32Array(this.calendar.length).fill(-1); for (let i = 0; i < s.n; i++){ const k = this.calIndex.get(s.day[i]); if (k !== undefined) p[k] = i; } this.pos.set(s.sym, p); }
  }
  get symbols(){ return [...this.series.keys()]; }
  get n(){ return this.calendar.length; }
  dayAt(k){ return this.calendar[k]; }
  isoAt(k){ return isoOf(this.calendar[k]); }
  // אינדקס לוח ראשון ≥ יום (או אחרון ≤ יום)
  kOnOrAfter(day){ let lo = 0, hi = this.calendar.length; while (lo < hi){ const m = (lo + hi) >> 1; if (this.calendar[m] < day) lo = m + 1; else hi = m; } return lo; }
  kOnOrBefore(day){ const k = this.kOnOrAfter(day); return k < this.n && this.calendar[k] === day ? k : k - 1; }
  rowIndex(sym, k){ const p = this.pos.get(sym); return p ? p[k] : -1; }
  // נר גולמי ליום k (או null אם אין נר — יום ללא מסחר בנייר הזה)
  bar(sym, k){ const i = this.rowIndex(sym, k); if (i < 0) return null; const s = this.series.get(sym); return { i, day: s.day[i], o: s.o[i], h: s.h[i], l: s.l[i], c: s.c[i], v: s.v[i], a: s.a[i] }; }
  memberAt(sym, k){ if (!this.universe) return this.series.has(sym); return isMember(this.universe.members?.[sym], this.calendar[k]); }
  // חברות במדד ביום k — רק סימבולים שיש להם סדרה (אחרים נספרים כחסרים ב-coverage)
  membersAt(k){ const out = []; for (const sym of this.series.keys()) if (this.memberAt(sym, k)) out.push(sym); return out; }
  sectorOf(sym){ return this.sectors[sym] || this.series.get(sym)?.meta?.sector || null; }
  // דוח כיסוי (דרישה 10): כמה חברי מדד היסטוריים יש להם מחירים, וכמה חסרים (בדרך כלל מניות שנמחקו)
  coverage(fromK = 0, toK = this.n - 1){
    if (!this.universe) return { pointInTime: false, note: 'אין הרכב מדד היסטורי — היקום הוא רשימה קבועה (הטיית שורדים אפשרית)', withData: this.series.size, missing: [], ratio: 1 };
    const seen = new Set(), missing = new Set();
    const a = this.calendar[fromK], b = this.calendar[toK];
    for (const [sym, iv] of Object.entries(this.universe.members || {})){
      const active = iv.some(([x, y]) => x <= b && (y === null || y > a)); if (!active) continue;
      if (this.series.has(sym)) seen.add(sym); else missing.add(sym);
    }
    const total = seen.size + missing.size;
    return { pointInTime: true, universeFrom: isoOf(this.universe.from), universeTo: isoOf(this.universe.to), withData: seen.size, missing: [...missing].sort(), total, ratio: total ? seen.size / total : 0, note: missing.size ? `${missing.size} מתוך ${total} חברי המדד בתקופה ללא נתוני מחיר (ברובן מניות שנמחקו) — הטיית שורדים חלקית, התוצאה מסומנת כמוגבלת` : 'כל חברי המדד בתקופה עם נתונים' };
  }
  // ספירת נרות חסרים (פערים) לכל סימבול בטווח — מדד שלמות
  gaps(fromK, toK){ let gaps = 0, bars = 0; for (const [sym, p] of this.pos){ const s = this.series.get(sym); for (let k = fromK; k <= toK; k++){ const d = this.calendar[k]; if (d < s.from || d > s.to) continue; bars++; if (p[k] < 0) gaps++; } } return { bars, gaps, ratio: bars ? gaps / bars : 0 }; }
}

// בניית Dataset מהקבצים שה-UI/סקריפט טענו: manifest + series compact + universe + sectors; חיתוך לטווח עם חימום
export function buildDataset({ manifest = {}, series = [], universe = null, sectors = null, from = null, to = null, warmupDays = 400, calendarFrom = null } = {}){
  const fromDay = from ? dayNum(from) - warmupDays : -Infinity, toDay = to ? dayNum(to) : Infinity;
  const list = series.map((c) => (c instanceof Series ? c : new Series(c))).map((s) => (from || to ? s.slice(fromDay, toDay) : s)).filter((s) => s.n > 0);
  return new Dataset({ series: list, universe, sectors: sectors || manifest.sectors || {}, meta: { source: manifest.source || null, builtAt: manifest.builtAt || null, provider: manifest.provider || null, notes: manifest.notes || [] }, calendarFrom });
}
