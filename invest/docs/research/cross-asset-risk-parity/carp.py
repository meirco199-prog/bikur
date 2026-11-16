#!/usr/bin/env python3
"""Cross-Asset Momentum + Risk Parity — לפי PROTOCOL_v1.0.md (נעול, commit 9081876). שלב 2 (שער נתונים) ואם PASS — שלבים 3–5.
שימוש: carp.py fetch RAW_DIR | carp.py run RAW_DIR OUT_DIR   (בלי תלויות חיצוניות; numpy לא נדרש)"""
import json, sys, os, math, time, csv, io, urllib.request, urllib.error, datetime as dt, statistics as stt, random

ASSETS = ['SPY', 'TLT', 'GLD', 'DBC']
ALL = ASSETS + ['BIL', 'QQQ']
UA = {'User-Agent': 'Mozilla/5.0 (bikur-research)'}

def get(u, tries=4, timeout=90):
    err = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            err = (e.code, e.read()[:200])
            if e.code in (429, 500, 502, 503): time.sleep(10 * (k + 1)); continue
            return err
        except Exception as e:
            err = (None, str(e).encode()); time.sleep(8 * (k + 1))
    return err

def fetch(raw):
    os.makedirs(raw, exist_ok=True)
    p1, p2 = 1136073600, int(time.time())  # 2006-01-01
    for s in ALL:
        st, b = get(f'https://query1.finance.yahoo.com/v8/finance/chart/{s}?period1={p1}&period2={p2}&interval=1d&events=div,splits&includeAdjustedClose=true')
        open(f'{raw}/{s}.json', 'wb').write(b if st == 200 else json.dumps({'error': [st, b.decode('utf8', 'replace')]}).encode())
        print(s, st, len(b), flush=True); time.sleep(2)
    for sid in ('DTB3', 'FEDFUNDS'):
        st, b = get(f'https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd=2005-01-01')
        open(f'{raw}/{sid}.csv', 'wb').write(b if st == 200 else b'')
        print(sid, st, len(b or b''), flush=True)

D = lambda ts: dt.datetime.fromtimestamp(ts, dt.timezone.utc).date()

def load(raw):
    px, issues = {}, {}
    for s in ALL:
        j = json.load(open(f'{raw}/{s}.json'))
        if 'chart' not in j or not j['chart']['result']:
            issues[s] = 'אין נתונים'; continue
        r = j['chart']['result'][0]; q = r['indicators']['quote'][0]; adj = r['indicators']['adjclose'][0]['adjclose']
        rows = {}
        for i, ts in enumerate(r['timestamp']):
            o, c, a = q['open'][i], q['close'][i], adj[i]
            rows[D(ts + 4 * 3600)] = (o, c, a)  # חותמת זמן של פתיחת המסחר בניו יורק → תאריך המסחר
        divs = {D(int(k) + 4 * 3600): v['amount'] for k, v in (r.get('events', {}).get('dividends') or {}).items()}
        splits = {D(int(k) + 4 * 3600): f"{v['numerator']}:{v['denominator']}" for k, v in (r.get('events', {}).get('splits') or {}).items()}
        px[s] = {'rows': rows, 'divs': divs, 'splits': splits}
    fred = {}
    for sid in ('DTB3', 'FEDFUNDS'):
        t = open(f'{raw}/{sid}.csv').read() if os.path.exists(f'{raw}/{sid}.csv') else ''
        vals = {}
        for line in t.strip().splitlines()[1:]:
            d, v = line.split(',')[:2]
            try: vals[dt.date.fromisoformat(d)] = float(v)
            except ValueError: pass
        fred[sid] = vals
    return px, fred, issues

# ---------------- שער נתונים ----------------
def gate(px, fred, issues):
    out = {'issues': issues, 'series': {}}
    if 'SPY' not in px: out['verdict'] = 'INCONCLUSIVE'; return out
    cal = sorted(d for d in px['SPY']['rows'] if d >= dt.date(2006, 2, 1))
    ok = True
    for s in ALL:
        if s not in px: ok = False; continue
        rows = px[s]['rows']; first = min(d for d in rows if rows[d][2] is not None)
        days = [d for d in cal if d >= first]
        miss = [str(d) for d in days if d not in rows]
        nulls = [str(d) for d in days if d in rows and (None in rows[d] or rows[d][0] <= 0)]
        out['series'][s] = {'first': str(first), 'last': str(max(rows)), 'days': len(days), 'missing_vs_spy': len(miss), 'missing_sample': miss[:10],
                            'null_or_bad': len(nulls), 'null_sample': nulls[:10], 'dividends': len(px[s]['divs']), 'splits': px[s]['splits']}
        need = dt.date(2006, 2, 28) if s in ASSETS + ['QQQ'] else dt.date(2007, 6, 30)
        if first > need or miss or nulls: ok = False
    for sid in ('DTB3', 'FEDFUNDS'):
        v = fred[sid]
        out['series'][sid] = {'n': len(v), 'first': str(min(v)) if v else None, 'last': str(max(v)) if v else None}
        if not v or min(v) > dt.date(2006, 1, 31) or max(v) < dt.date(2026, 9, 1): ok = False
    out['verdict'] = 'PASS' if ok else 'INCONCLUSIVE'
    return out

# ---------------- מנוע ----------------
def month_ends(cal):
    return [d for i, d in enumerate(cal) if i + 1 == len(cal) or cal[i + 1].month != d.month]

def rate_on(series, d, monthly=False):
    if monthly: d = d.replace(day=1)
    best = None
    for k in sorted(series):
        if k <= d: best = series[k]
        else: break
    return best

class Rates:
    def __init__(self, fred):
        self.dtb3 = sorted(fred['DTB3'].items()); self.ff = sorted(fred['FEDFUNDS'].items()); self.c = {}
    def _ff(self, arr, d):
        lo, hi, best = 0, len(arr) - 1, arr[0][1]
        while lo <= hi:
            m = (lo + hi) // 2
            if arr[m][0] <= d: best = arr[m][1]; lo = m + 1
            else: hi = m - 1
        return best / 100
    def tbill(self, d): return self._ff(self.dtb3, d)
    def fedfunds(self, d): return self._ff(self.ff, d.replace(day=1))

def signals(adj, cal, t_idx, names):
    """אותות בסגירת יום cal[t_idx]: R126, σ63 שנתי, קווריאנס יומי."""
    R, sig, rets = {}, {}, {}
    for s in names:
        a = adj[s]
        p = [a[cal[i]] for i in range(t_idx - 126, t_idx + 1)]
        R[s] = p[-1] / p[0] - 1
        r = [p[i] / p[i - 1] - 1 for i in range(len(p) - 63, len(p))]
        rets[s] = r; sig[s] = stt.stdev(r) * math.sqrt(252)
    mu = {s: sum(rets[s]) / 63 for s in names}
    cov = {(x, y): sum((rets[x][k] - mu[x]) * (rets[y][k] - mu[y]) for k in range(63)) / 62 for x in names for y in names}
    return R, sig, cov

def target_weights(kind, R, sig, cov):
    if kind == '6040': return {'SPY': 0.6, 'TLT': 0.4, 'GLD': 0.0, 'DBC': 0.0}, 1.0
    inv = {s: 1 / sig[s] for s in ASSETS}; tot = sum(inv.values()); raw = {s: inv[s] / tot for s in ASSETS}
    if kind == 'static_rp': return raw, 1.0
    w = {s: (raw[s] if R[s] > 0 else 0.0) for s in ASSETS}
    if kind == 'v1': return w, 1.0
    var = sum(w[x] * w[y] * cov[(x, y)] for x in ASSETS for y in ASSETS) * 252
    sp = math.sqrt(max(var, 0)); L = 0.0 if sp == 0 else min(2.0, 0.20 / sp)
    return {s: L * w[s] for s in ASSETS}, L

def simulate(px, rates, cal, start_idx, kind, cost):
    O = {s: {d: px[s]['rows'][d][0] for d in px[s]['rows']} for s in ALL}
    C = {s: {d: px[s]['rows'][d][1] for d in px[s]['rows']} for s in ALL}
    A = {s: {d: px[s]['rows'][d][2] for d in px[s]['rows']} for s in ALL}
    bil_first = min(d for d in px['BIL']['rows'])
    me = set(month_ends(cal))
    sh = {s: 0.0 for s in ASSETS + ['BIL']}; cash = 1.0
    nav, pending, prev = [], None, None
    contrib = {s: 0.0 for s in ASSETS + ['BIL']}; traded = 0.0; costs = 0.0; interest = 0.0; Ls = []; wlog = []
    for i in range(start_idx, len(cal)):
        d = cal[i]
        # ריבית על מזומן מהסגירה הקודמת
        if prev is not None:
            days = (d - prev).days
            r = rates.tbill(prev) if cash > 0 else rates.fedfunds(prev) + 0.015
            it = cash * r * days / 360; cash += it; interest += it
        # פתיחה: ביצוע הוראה חודשית
        for s in sh:
            if sh[s] and prev is not None: contrib[s] += sh[s] * (O[s][d] - C[s][prev])
        if pending is not None:
            w, L = pending
            navo = cash + sum(sh[s] * O[s][d] for s in sh if sh[s])
            bil_ok = (d - bil_first).days > 31 and d in O['BIL']
            tw = dict(w); risky = sum(w.values())
            tw['BIL'] = max(0.0, 1 - risky) if bil_ok else 0.0
            for s in sh:
                if s not in O or d not in O[s]: continue
                tgt = tw.get(s, 0.0) * navo / O[s][d]; dsh = tgt - sh[s]
                if abs(dsh) > 1e-12:
                    notional = abs(dsh) * O[s][d]; traded += notional; c = notional * cost; costs += c
                    cash -= dsh * O[s][d] + c; sh[s] = tgt
            Ls.append(L); wlog.append((str(d), {s: round(tw.get(s, 0), 4) for s in sh}, round(L, 3), risky)); pending = None
        # סגירה: דיבידנדים ותנועה מהפתיחה לסגירה
        for s in sh:
            if sh[s]:
                contrib[s] += sh[s] * (C[s][d] - O[s][d])
                dv = px[s]['divs'].get(d)
                if dv: cash += sh[s] * dv; contrib[s] += sh[s] * dv
        v = cash + sum(sh[s] * C[s][d] for s in sh if sh[s])
        nav.append((d, v)); prev = d
        # אות בסוף חודש → ביצוע בפתיחה הבאה
        if d in me and i + 1 < len(cal):
            if kind in ('v1', 'v2', 'static_rp'):
                R, sig, cov = signals(A, cal, i, ASSETS); pending = target_weights(kind, R, sig, cov)
            elif kind == '6040':
                pending = target_weights('6040', None, None, None)
    return {'nav': nav, 'contrib': contrib, 'traded': traded, 'costs': costs, 'interest': interest, 'L': Ls, 'weights': wlog}

def buyhold(px, cal, start_idx, s):
    a = {d: px[s]['rows'][d][2] for d in px[s]['rows']}; base = a[cal[start_idx]]
    return [(d, a[d] / base) for d in cal[start_idx:]]

# ---------------- מדדים ----------------
def metrics(nav, rates, a=None, b=None):
    pts = [(d, v) for d, v in nav if (a is None or d >= a) and (b is None or d <= b)]
    if len(pts) < 3: return None
    d0, v0 = pts[0]; d1, v1 = pts[-1]; yrs = (d1 - d0).days / 365.25
    peak, mdd = v0, 0.0
    for _, v in pts: peak = max(peak, v); mdd = min(mdd, v / peak - 1)
    ex = []
    for k in range(1, len(pts)):
        r = pts[k][1] / pts[k - 1][1] - 1; ex.append(r - rates.tbill(pts[k - 1][0]) / 252)
    m, sd = stt.mean(ex), stt.stdev(ex); dd = math.sqrt(sum(min(0, x) ** 2 for x in ex) / len(ex))
    return {'from': str(d0), 'to': str(d1), 'total': v1 / v0 - 1, 'cagr': (v1 / v0) ** (1 / yrs) - 1 if yrs > 0 else None, 'mdd': mdd,
            'sharpe': m / sd * math.sqrt(252) if sd else None, 'sortino': m / dd * math.sqrt(252) if dd else None, '_ex': ex}

def memmel(ex1, ex2):
    n = min(len(ex1), len(ex2)); x, y = ex1[-n:], ex2[-n:]
    s1, s2 = stt.mean(x) / stt.stdev(x), stt.mean(y) / stt.stdev(y)
    mx, my = stt.mean(x), stt.mean(y)
    rho = sum((x[i] - mx) * (y[i] - my) for i in range(n)) / ((n - 1) * stt.stdev(x) * stt.stdev(y))
    v = (2 - 2 * rho + 0.5 * (s1 ** 2 + s2 ** 2 - 2 * s1 * s2 * rho ** 2)) / n
    z = (s1 - s2) / math.sqrt(v)
    p = 1 - 0.5 * (1 + math.erf(z / math.sqrt(2)))  # חד-צדדי: שארפ 1 גבוה יותר
    return {'z': z, 'p_one_sided': p, 'rho': rho}

def run(raw, outd):
    os.makedirs(outd, exist_ok=True)
    px, fred, issues = load(raw)
    g = gate(px, fred, issues)
    json.dump(g, open(f'{outd}/data_gate.json', 'w'), ensure_ascii=False, indent=1, default=str)
    print('GATE', g['verdict'], flush=True)
    if g['verdict'] != 'PASS':
        open(f'{outd}/report.md', 'w').write(f"# שער נתונים: {g['verdict']} — עצירה\n\n```\n{json.dumps(g, ensure_ascii=False, indent=1, default=str)[:6000]}\n```\n"); return
    rates = Rates(fred)
    cal = sorted(set.intersection(*[set(px[s]['rows']) for s in ASSETS + ['QQQ']]))
    cal = [d for d in cal if d >= dt.date(2006, 2, 6)]
    me = month_ends(cal)
    first_sig = next(d for d in me if cal.index(d) >= 126 + 0)
    start_idx = cal.index(first_sig)  # NAV מתחיל בסגירת יום האות הראשון; מסחר ראשון בפתיחה הבאה
    res = {}
    for kind in ('v1', 'v2', '6040', 'static_rp'):
        for cost in (0.0003, 0.0006):
            res[f'{kind}@{cost}'] = simulate(px, rates, cal, start_idx, kind, cost)
    bh = {s: buyhold(px, cal, start_idx, s) for s in ('SPY', 'QQQ')}
    P = {'full': (None, None), 'train': (None, dt.date(2015, 12, 31)), 'valid': (dt.date(2016, 1, 1), dt.date(2021, 12, 31)),
         'test': (dt.date(2022, 1, 1), None), 'since2016': (dt.date(2016, 1, 1), None)}
    W = {'2008': (dt.date(2007, 10, 9), dt.date(2009, 3, 9)), 'covid': (dt.date(2020, 2, 19), dt.date(2020, 3, 23)), '2022': (dt.date(2022, 1, 1), dt.date(2022, 12, 31))}
    def nav_of(k): return res[k]['nav'] if k in res else bh[k]
    keys = ['v1@0.0003', 'v2@0.0003', '6040@0.0003', 'static_rp@0.0003', 'SPY', 'QQQ', 'v1@0.0006', 'v2@0.0006', '6040@0.0006', 'static_rp@0.0006']
    M = {k: {p: metrics(nav_of(k), rates, *ab) for p, ab in {**P, **W}.items()} for k in keys}
    out = {'gate': g, 'start': str(cal[start_idx]), 'end': str(cal[-1]), 'metrics': {k: {p: ({x: y for x, y in v.items() if x != '_ex'} if v else None) for p, v in pm.items()} for k, pm in M.items()}}
    # מבחן מובהקות (גרסה 1 מול 60/40 ו-Static RP), כל התקופה
    out['memmel_v1'] = {b: memmel(M['v1@0.0003']['full']['_ex'], M[f'{b}@0.0003']['full']['_ex']) for b in ('6040', 'static_rp')}
    # מחזור ותרומה
    for k in ('v1@0.0003', 'v2@0.0003', '6040@0.0003', 'static_rp@0.0003'):
        r = res[k]; nav = [v for _, v in r['nav']]; yrs = (r['nav'][-1][0] - r['nav'][0][0]).days / 365.25
        tot = sum(r['contrib'].values()) or 1
        out.setdefault('extra', {})[k] = {'turnover': r['traded'] / (sum(nav) / len(nav)) / yrs, 'costs': r['costs'], 'interest': r['interest'],
            'contrib_share': {s: v / tot for s, v in r['contrib'].items()}, 'contrib_abs': r['contrib'],
            'avg_L': (sum(r['L']) / len(r['L'])) if r['L'] else None, 'max_L': max(r['L']) if r['L'] else None,
            'share_months_L_gt1': (sum(1 for x in r['weights'] if x[3] > 1 + 1e-9) / len(r['weights'])) if r['weights'] else None}
    # משקלים בחלונות המשבר
    for k in ('v1@0.0003', 'v2@0.0003'):
        for wn, (a, b) in W.items():
            ws = [x for x in res[k]['weights'] if a <= dt.date.fromisoformat(x[0]) <= b]
            out.setdefault('crisis_weights', {}).setdefault(k, {})[wn] = ws
    # קריטריונים
    m1, m2, m2d = M['v1@0.0003'], M['v2@0.0003'], M['v2@0.0006']
    c1 = {'sharpe_full_gt_1': m1['full']['sharpe'] > 1.0, 'mdd_full_le_18': m1['full']['mdd'] >= -0.18,
          'sharpe_beats_6040': m1['full']['sharpe'] > M['6040@0.0003']['full']['sharpe'] and out['memmel_v1']['6040']['p_one_sided'] < 0.05,
          'sharpe_beats_static_rp': m1['full']['sharpe'] > M['static_rp@0.0003']['full']['sharpe'] and out['memmel_v1']['static_rp']['p_one_sided'] < 0.05}
    def v2ok(m): return {'cagr_since2016_ge_20': m['since2016']['cagr'] >= 0.20, 'cagr_full_ge_20': m['full']['cagr'] >= 0.20,
                         'mdd_train': m['train']['mdd'] >= -0.35, 'mdd_valid': m['valid']['mdd'] >= -0.35, 'mdd_test': m['test']['mdd'] >= -0.35}
    c2 = {**v2ok(m2), **{'double_costs_' + k: v for k, v in v2ok(m2d).items()}}
    out['criteria'] = {'v1': c1, 'v1_PASS': all(c1.values()), 'v2': c2, 'v2_PASS': all(c2.values())}
    json.dump(out, open(f'{outd}/results.json', 'w'), ensure_ascii=False, indent=1, default=str)
    # דוח
    pc = lambda x: '—' if x is None else f'{100 * x:.1f}%'
    f2 = lambda x: '—' if x is None else f'{x:.2f}'
    names = {'v1@0.0003': 'גרסה 1 — בלי מינוף', 'v2@0.0003': 'גרסה 2 — יעד תנודתיות 20%', '6040@0.0003': '60/40', 'static_rp@0.0003': 'Static Risk Parity',
             'SPY': 'SPY קנה-והחזק', 'QQQ': 'QQQ קנה-והחזק', 'v1@0.0006': 'גרסה 1, עלויות כפולות', 'v2@0.0006': 'גרסה 2, עלויות כפולות',
             '6040@0.0006': '60/40, עלויות כפולות', 'static_rp@0.0006': 'Static RP, עלויות כפולות'}
    L = [f"# תוצאות — Cross-Asset Momentum + Risk Parity (PROTOCOL v1.0)", '', f"תקופה: {out['start']} → {out['end']}. שער נתונים: {g['verdict']}.", '']
    for per, title in (('full', 'כל התקופה'), ('train', 'אימון 2006–2015'), ('valid', 'אימות 2016–2021'), ('test', 'מבחן 2022–2026'), ('since2016', 'מ-2016')):
        L += [f'## {title}', '', '| תיק | CAGR | ירידה מקס׳ יומית | Sharpe | Sortino |', '|---|---|---|---|---|']
        for k in keys:
            m = M[k][per]
            if m: L.append(f"| {names[k]} | {pc(m['cagr'])} | {pc(m['mdd'])} | {f2(m['sharpe'])} | {f2(m['sortino'])} |")
        L.append('')
    L += ['## משברים (תשואה בחלון / ירידה מקסימלית בחלון)', '', '| תיק | 2008 | קורונה 2020 | 2022 |', '|---|---|---|---|']
    for k in keys[:6]:
        cells = []
        for wn in ('2008', 'covid', '2022'):
            m = M[k][wn]
            cells.append('—' if not m else f"{pc(m['total'])} / {pc(m['mdd'])}")
        L.append(f"| {names[k]} | " + ' | '.join(cells) + ' |')
    L += ['', '## מחזור, תרומה ומינוף', '', '| תיק | מחזור שנתי | SPY | TLT | GLD | DBC | BIL | מינוף ממוצע | מקסימלי | חודשים מעל 100% |', '|---|---|---|---|---|---|---|---|---|---|']
    for k, e in out['extra'].items():
        cs = e['contrib_share']
        L.append(f"| {names[k]} | {f2(e['turnover'])} | " + ' | '.join(pc(cs[s]) for s in ('SPY', 'TLT', 'GLD', 'DBC', 'BIL')) + f" | {f2(e['avg_L'])} | {f2(e['max_L'])} | {pc(e['share_months_L_gt1'])} |")
    L += ['', '## מובהקות (גרסה 1, כל התקופה, Jobson-Korkie בתיקון Memmel, חד-צדדי)', '']
    for b, t in out['memmel_v1'].items(): L.append(f"- מול {names[b + '@0.0003']}: z = {t['z']:.2f}, p = {t['p_one_sided']:.3f}")
    L += ['', '## קריטריונים נעולים', '', f"- **גרסה 1: {'PASS' if out['criteria']['v1_PASS'] else 'FAIL'}** — " + ', '.join(f"{k}={'✅' if v else '❌'}" for k, v in c1.items()),
          f"- **גרסה 2: {'PASS' if out['criteria']['v2_PASS'] else 'FAIL'}** — " + ', '.join(f"{k}={'✅' if v else '❌'}" for k, v in c2.items())]
    open(f'{outd}/report.md', 'w').write('\n'.join(L) + '\n')
    print('\n'.join(L))

if __name__ == '__main__':
    if sys.argv[1] == 'fetch': fetch(sys.argv[2])
    else: run(sys.argv[2], sys.argv[3])
