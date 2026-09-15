// עזרים מספריים/תאריכים משותפים ל-engine. פונקציות טהורות בלבד.

export const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

export function clamp(x, lo, hi){ return Math.min(hi, Math.max(lo, x)); }

// מיפוי ליניארי חתוך: worst→0, best→100. worst יכול להיות גדול מ-best (ציון הפוך).
export function ramp(x, worst, best){
  if (!isNum(x)) return null;
  if (worst === best) return 50;
  const t = (x - worst) / (best - worst);
  return Math.round(clamp(t, 0, 1) * 100);
}

export function round(x, d = 2){
  if (!isNum(x)) return null;
  const m = Math.pow(10, d);
  return Math.round(x * m) / m;
}

export function mean(a){
  const v = a.filter(isNum);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

export function median(a){
  const v = a.filter(isNum).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function std(a, sample = true){
  const v = a.filter(isNum);
  if (v.length < 2) return null;
  const m = mean(v);
  const ss = v.reduce((s, x) => s + (x - m) ** 2, 0);
  return Math.sqrt(ss / (sample ? v.length - 1 : v.length));
}

// אחוזון של ערך בתוך סדרה (0-100): כמה מהערכים קטנים ממנו.
export function percentileRank(a, x){
  const v = a.filter(isNum);
  if (!v.length || !isNum(x)) return null;
  const below = v.filter((y) => y < x).length;
  const eq = v.filter((y) => y === x).length;
  return Math.round(((below + eq / 2) / v.length) * 100);
}

// ערך באחוזון נתון (0-100) בסדרה.
export function quantile(a, q){
  const v = a.filter(isNum).sort((x, y) => x - y);
  if (!v.length) return null;
  const pos = (v.length - 1) * clamp(q, 0, 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function pctChange(now, before){
  if (!isNum(now) || !isNum(before) || before === 0) return null;
  return now / before - 1;
}

export function cagr(endV, startV, years){
  if (!isNum(endV) || !isNum(startV) || startV <= 0 || endV <= 0 || !(years > 0)) return null;
  return Math.pow(endV / startV, 1 / years) - 1;
}

export function correlation(a, b){
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const xa = a.slice(-n), xb = b.slice(-n);
  const ma = mean(xa), mb = mean(xb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++){
    if (!isNum(xa[i]) || !isNum(xb[i])) continue;
    num += (xa[i] - ma) * (xb[i] - mb);
    da += (xa[i] - ma) ** 2;
    db += (xb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}

// רגרסיה פשוטה y = alpha + beta*x
export function beta(y, x){
  const n = Math.min(x.length, y.length);
  if (n < 20) return null;
  const xs = x.slice(-n), ys = y.slice(-n);
  const mx = mean(xs), my = mean(ys);
  let cov = 0, vx = 0;
  for (let i = 0; i < n; i++){
    if (!isNum(xs[i]) || !isNum(ys[i])) continue;
    cov += (xs[i] - mx) * (ys[i] - my);
    vx += (xs[i] - mx) ** 2;
  }
  return vx ? cov / vx : null;
}

// ---------- תאריכים (ISO YYYY-MM-DD, UTC) ----------

export function isoDate(d = new Date()){
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

export function addDays(iso, n){
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

export function addMonths(iso, n){
  const d = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return isoDate(d);
}

export function daysBetween(a, b){
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

export function yearsBetween(a, b){ return daysBetween(a, b) / 365.25; }

// hash קצר ודטרמיניסטי (FNV-1a) לחתימת גרסת משקלים
export function hashStr(s){
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function uid(prefix = ''){
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// חיפוש בינארי: אינדקס השורה האחרונה עם תאריך ≤ date (שורות ממוינות עולה, שדה 0 = תאריך)
export function lastIndexOnOrBefore(rows, date){
  let lo = 0, hi = rows.length - 1, ans = -1;
  while (lo <= hi){
    const mid = (lo + hi) >> 1;
    if (rows[mid][0] <= date){ ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// חיתוך שורות עד תאריך (כולל) — הבסיס למניעת look-ahead
export function rowsUntil(rows, date){
  if (!date) return rows;
  const i = lastIndexOnOrBefore(rows, date);
  return rows.slice(0, i + 1);
}
