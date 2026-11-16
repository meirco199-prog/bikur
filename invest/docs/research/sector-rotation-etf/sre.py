#!/usr/bin/env python3
"""Dual-Momentum Sector Rotation — סימולציה לפי PROTOCOL_v1.0.md (כללים נעולים ב-commit 87e3afa). הרצה אחת בלבד.
שימוש: sre.py run RAW_DIR OUT_DIR   (RAW_DIR = פלט של data_gate/probe.py fetch; בלי תלויות חיצוניות)"""
import json, sys, os, math, datetime as dt, statistics as stt

SECT = ['XLK', 'XLV', 'XLF', 'XLE', 'XLI', 'XLP', 'XLY', 'XLU', 'XLB']
BIL_SWITCH = dt.date(2007, 5, 31)          # מ-31/05/2007 מדד המקלט לפי BIL (עד 30/05 כולל — צבירת ^IRX)
XLRE_DAY, XLRE_FACTOR = dt.date(2016, 9, 19), 1.231
COSTS = (0.0003, 0.0006)
D = lambda ts: dt.datetime.fromtimestamp(ts, dt.timezone.utc).date()


# ---------------- נתונים ----------------
def load(raw):
    px = {}
    for s in SECT + ['SPY', 'BIL', '^IRX']:
        j = json.load(open(f'{raw}/{s.replace("^", "_")}.json'))
        r = j['chart']['result'][0]; q = r['indicators']['quote'][0]
        adj = (r['indicators'].get('adjclose') or [{}])[0].get('adjclose') or [None] * len(r['timestamp'])
        rows = {}
        for i, ts in enumerate(r['timestamp']):
            o, c, a = q['open'][i], q['close'][i], adj[i]
            if c is None: continue
            rows[D(ts + 4 * 3600)] = (o, c, a)
        ev = r.get('events', {})
        divs = {D(int(k) + 4 * 3600): v['amount'] for k, v in (ev.get('dividends') or {}).items()}
        splits = {D(int(k) + 4 * 3600): v['numerator'] / v['denominator'] for k, v in (ev.get('splits') or {}).items()}
        px[s] = {'rows': rows, 'divs': divs, 'splits': splits}
    return px


def calendar(px):
    first = max(min(d for d, r in px[s]['rows'].items() if r[0] and r[1] and r[2]) for s in SECT)
    return [d for d in sorted(px['SPY']['rows']) if d >= first]


def month_ends(cal):
    return [cal[i] for i in range(len(cal)) if i + 1 == len(cal) or cal[i + 1].month != cal[i].month]


def haven_index(px, cal):
    """H (מדד המקלט), rf = תשואת H היומית, cash_r = צבירת ^IRX יומית (לריבית על מזומן). ^IRX חסר — ממולא מהיום הקודם."""
    irx = {d: r[1] for d, r in px['^IRX']['rows'].items() if r[1] is not None}
    bil = {d: r[2] for d, r in px['BIL']['rows'].items() if r[2]}
    H, rf, cash_r, filled = {cal[0]: 1.0}, {cal[0]: 0.0}, {cal[0]: 0.0}, 0
    last = None
    for d in sorted(irx):
        if d > cal[0]: break
        last = irx[d]
    for k in range(1, len(cal)):
        d, p = cal[k], cal[k - 1]
        if p in irx: last = irx[p]
        else: filled += 1
        cash_r[d] = last / 100 * (d - p).days / 360
        rf[d] = cash_r[d] if d < BIL_SWITCH else bil[d] / bil[p] - 1
        H[d] = H[p] * (1 + rf[d])
    return H, rf, cash_r, filled


# ---------------- אותות ----------------
def weights(kind, A, H, cal, i):
    """משקלים יעד ביום האות cal[i]. kind: 'dm' (מומנטום כפול), 'top3' (בלי מסנן), 'ew' (משקל שווה)."""
    if kind == 'ew': return {s: 1 / 9 for s in SECT}, None
    t, t21, t252 = cal[i], cal[i - 21], cal[i - 252]
    M = {s: A[s][t21] / A[s][t252] - 1 for s in SECT}
    R12 = {s: A[s][t] / A[s][t252] - 1 for s in SECT}
    hr = H[t] / H[t252] - 1
    elig = [s for s in SECT if (kind == 'top3' or R12[s] > hr)]
    pick = sorted(elig, key=lambda s: (-M[s], s))[:3]
    info = {'M': M, 'R12': R12, 'haven12': hr, 'eligible': elig, 'pick': pick}
    return {s: 1 / 3 for s in pick}, info


# ---------------- סימולציה ----------------
def simulate(px, cal, H, cash_r, start_idx, kind, cost):
    O = {s: {d: px[s]['rows'][d][0] for d in px[s]['rows']} for s in SECT + ['BIL']}
    C = {s: {d: px[s]['rows'][d][1] for d in px[s]['rows']} for s in SECT + ['BIL']}
    A = {s: {d: px[s]['rows'][d][2] for d in px[s]['rows']} for s in SECT}
    me = set(month_ends(cal))
    sh = {s: 0.0 for s in SECT + ['BIL']}; cash = 1.0
    nav, pending, prev = [], None, None
    contrib = {s: 0.0 for s in SECT + ['BIL']}; traded = 0.0; costs = 0.0; interest = 0.0; log = []
    for i in range(start_idx, len(cal)):
        d = cal[i]
        if prev is not None:  # ריבית על מזומן (חיובי או שלילי קטן מעלויות) לפי מדד המקלט
            it = cash * cash_r[d]; cash += it; interest += it
        for s in sh:
            if sh[s] and prev is not None: contrib[s] += sh[s] * (O[s][d] - C[s][prev])
        if pending is not None:
            w, info = pending
            navo = cash + sum(sh[s] * O[s][d] for s in sh if sh[s])
            tw = dict(w); risky = sum(w.values())
            bil_ok = d in O['BIL'] and O['BIL'][d] and d > BIL_SWITCH
            tw['BIL'] = max(0.0, 1 - risky) if bil_ok else 0.0
            for s in sh:
                tgt = tw.get(s, 0.0) * navo / O[s][d] if tw.get(s, 0.0) > 0 else 0.0
                dsh = tgt - sh[s]
                if abs(dsh) > 1e-12:
                    notional = abs(dsh) * O[s][d]; traded += notional; c = notional * cost; costs += c
                    cash -= dsh * O[s][d] + c; sh[s] = tgt
            log.append({'date': str(d), 'w': {s: round(v, 4) for s, v in tw.items() if v > 0}, 'risky': round(risky, 4),
                        **({'pick': info['pick'], 'eligible': info['eligible'], 'haven12': round(info['haven12'], 4)} if info else {})})
            pending = None
        if d == XLRE_DAY and sh['XLF'] > 0:  # הפרדת XLRE: עלות מכירת המניות שחולקו
            sold = sh['XLF'] * O['XLF'][d] * (1 - 1 / XLRE_FACTOR); c = sold * cost; cash -= c; costs += c; traded += sold
        for s in sh:
            if sh[s]:
                contrib[s] += sh[s] * (C[s][d] - O[s][d])
                dv = px[s]['divs'].get(d)
                if dv: cash += sh[s] * dv; contrib[s] += sh[s] * dv
        v = cash + sum(sh[s] * C[s][d] for s in sh if sh[s])
        nav.append((d, v)); prev = d
        if d in me and i + 1 < len(cal):
            pending = weights(kind, A, H, cal, i)
    return {'nav': nav, 'contrib': contrib, 'traded': traded, 'costs': costs, 'interest': interest, 'log': log}


def buyhold(px, cal, start_idx, s):
    a = {d: px[s]['rows'][d][2] for d in px[s]['rows']}; base = a[cal[start_idx]]
    return [(d, a[d] / base) for d in cal[start_idx:]]


# ---------------- מדדים ----------------
def metrics(nav, rf, a=None, b=None):
    pts = [(d, v) for d, v in nav if (a is None or d >= a) and (b is None or d <= b)]
    if len(pts) < 3: return None
    d0, v0 = pts[0]; d1, v1 = pts[-1]; yrs = (d1 - d0).days / 365.25
    peak, mdd, mdd_at = v0, 0.0, None
    for d, v in pts:
        peak = max(peak, v)
        if v / peak - 1 < mdd: mdd, mdd_at = v / peak - 1, d
    ex = [pts[k][1] / pts[k - 1][1] - 1 - rf[pts[k][0]] for k in range(1, len(pts))]
    m, sd = stt.mean(ex), stt.stdev(ex); dd = math.sqrt(sum(min(0, x) ** 2 for x in ex) / len(ex))
    return {'from': str(d0), 'to': str(d1), 'total': v1 / v0 - 1, 'cagr': (v1 / v0) ** (1 / yrs) - 1, 'mdd': mdd, 'mdd_trough': str(mdd_at),
            'sharpe': m / sd * math.sqrt(252) if sd else None, 'sortino': m / dd * math.sqrt(252) if dd else None, '_ex': ex}


def memmel(ex1, ex2):
    n = min(len(ex1), len(ex2)); x, y = ex1[-n:], ex2[-n:]
    mx, my, sx, sy = stt.mean(x), stt.mean(y), stt.stdev(x), stt.stdev(y)
    s1, s2 = mx / sx, my / sy
    rho = sum((x[i] - mx) * (y[i] - my) for i in range(n)) / ((n - 1) * sx * sy)
    v = (2 - 2 * rho + 0.5 * (s1 ** 2 + s2 ** 2 - 2 * s1 * s2 * rho ** 2)) / n
    z = (s1 - s2) / math.sqrt(v)
    return {'z': z, 'p_one_sided': 1 - 0.5 * (1 + math.erf(z / math.sqrt(2))), 'rho': rho}


def yearly(nav):
    out, prev_end = {}, nav[0][1]
    years = sorted({d.year for d, _ in nav})
    for y in years:
        pts = [v for d, v in nav if d.year == y]
        if y == nav[0][0].year and len(pts) == 1: continue  # שנת ההתחלה עם יום אחד בלבד (NAV = 1)
        out[y] = pts[-1] / prev_end - 1; prev_end = pts[-1]
    return out


# ---------------- הרצה ----------------
PERIODS = {'full': None, 'p2008': dt.date(2008, 1, 2), 'p2003': dt.date(2003, 1, 2), 'p2022': dt.date(2022, 1, 3)}
WINDOWS = {'dotcom': (dt.date(2000, 3, 24), dt.date(2002, 10, 9)), 'gfc': (dt.date(2007, 10, 9), dt.date(2009, 3, 9)),
           'covid': (dt.date(2020, 2, 19), dt.date(2020, 3, 23)), 'y2022': (dt.date(2022, 1, 1), dt.date(2022, 12, 31))}


def run(raw, outd):
    os.makedirs(outd, exist_ok=True)
    px = load(raw)
    cal = calendar(px)
    H, rf, cash_r, filled = haven_index(px, cal)
    assert abs(px['XLF']['splits'].get(XLRE_DAY, 0) - XLRE_FACTOR) < 1e-6, 'XLRE split event missing'
    me = month_ends(cal)
    first_sig = next(d for d in me if cal.index(d) >= 252)
    start_idx = cal.index(first_sig)
    res = {f'{k}@{c}': simulate(px, cal, H, cash_r, start_idx, k, c) for k in ('dm', 'top3', 'ew') for c in COSTS}
    spy = buyhold(px, cal, start_idx, 'SPY')
    navs = {**{k: r['nav'] for k, r in res.items()}, 'SPY': spy}
    M = {k: {p: metrics(n, rf, a) for p, a in PERIODS.items()} for k, n in navs.items()}
    Wm = {k: {w: metrics(n, rf, a, b) for w, (a, b) in WINDOWS.items()} for k, n in navs.items()}
    strip = lambda v: {x: y for x, y in v.items() if x != '_ex'} if v else None
    out = {'protocol_commit': '87e3afa', 'start_signal': str(first_sig), 'first_trade': str(cal[start_idx + 1]), 'end': str(cal[-1]),
           'irx_forward_filled_days': filled,
           'metrics': {k: {p: strip(v) for p, v in pm.items()} for k, pm in M.items()},
           'windows': {k: {w: strip(v) for w, v in pm.items()} for k, pm in Wm.items()},
           'yearly': {k: {str(y): r for y, r in yearly(n).items()} for k, n in navs.items()}}
    out['memmel'] = {c: {b: {p: memmel(M[f'dm@{c}'][p]['_ex'], M[bk][p]['_ex']) for p in PERIODS}
                         for b, bk in (('SPY', 'SPY'), ('EW', f'ew@{c}'))} for c in COSTS}
    for k, r in res.items():
        nv = [v for _, v in r['nav']]; yrs = (r['nav'][-1][0] - r['nav'][0][0]).days / 365.25
        tot = sum(r['contrib'].values()) or 1
        lg = r['log']
        out.setdefault('extra', {})[k] = {
            'turnover': r['traded'] / (sum(nv) / len(nv)) / yrs, 'costs': r['costs'], 'interest': r['interest'],
            'contrib_share': {s: v / tot for s, v in r['contrib'].items()},
            'avg_risky': sum(x['risky'] for x in lg) / len(lg), 'months': len(lg),
            'months_all_haven': sum(1 for x in lg if x['risky'] < 1e-9),
            'months_by_n': {n: sum(1 for x in lg if abs(x['risky'] - n / 3) < 1e-6) for n in (0, 1, 2, 3)} if k.startswith('dm') else None,
            'pick_count': {s: sum(1 for x in lg if s in x.get('pick', [])) for s in SECT} if not k.startswith('ew') else None}
    # קריטריונים (שלב 4 + פרט יישום 9)
    def crit(c):
        m, s, e = M[f'dm@{c}'], M['SPY'], M[f'ew@{c}']
        a = {p: m[p]['mdd'] >= -0.20 for p in PERIODS}
        b = {p: {'sharpe_gt_spy': m[p]['sharpe'] > s[p]['sharpe'], 'sharpe_gt_ew': m[p]['sharpe'] > e[p]['sharpe'],
                 'sortino_gt_spy': m[p]['sortino'] > s[p]['sortino'], 'sortino_gt_ew': m[p]['sortino'] > e[p]['sortino']} for p in ('full', 'p2008')}
        return {'A_mdd_le_20_each_period': a, 'B_risk_adjusted': b,
                'A_ok': all(a.values()), 'B_ok': all(all(v.values()) for v in b.values())}
    cb, cd = crit(COSTS[0]), crit(COSTS[1])
    sig = {b: out['memmel'][COSTS[1]][b]['full']['p_one_sided'] < 0.05 for b in ('SPY', 'EW')}
    C_ok = cd['A_ok'] and cd['B_ok'] and all(sig.values())
    out['criteria'] = {'base_cost': cb, 'double_cost': cd, 'C_significance_double_cost_full': sig, 'C_ok': C_ok,
                       'verdict': 'PASS' if cb['A_ok'] and cb['B_ok'] and C_ok else 'FAIL'}
    with open(f'{outd}/results.json', 'w') as f: json.dump(out, f, ensure_ascii=False, indent=1, default=str)
    with open(f'{outd}/monthly_holdings.csv', 'w') as f:
        f.write('trade_date,risky,picks,eligible,haven_12m,weights\n')
        for x in res['dm@0.0003']['log']:
            f.write(f"{x['date']},{x['risky']},{' '.join(x['pick'])},{' '.join(x['eligible'])},{x['haven12']},{json.dumps(x['w']).replace(',', ';')}\n")
    with open(f'{outd}/nav_daily.csv', 'w') as f:
        ks = list(navs)
        f.write('date,' + ','.join(ks) + '\n')
        for i in range(len(spy)):
            f.write(str(spy[i][0]) + ',' + ','.join(f'{navs[k][i][1]:.6f}' for k in ks) + '\n')
    report(out, outd)
    print('VERDICT', out['criteria']['verdict'], flush=True)


NAMES = {'dm@0.0003': 'מומנטום כפול (0.03%)', 'dm@0.0006': 'מומנטום כפול (0.06%)', 'top3@0.0003': '3 מובילים בלי מסנן (0.03%)',
         'top3@0.0006': '3 מובילים בלי מסנן (0.06%)', 'ew@0.0003': '9 סקטורים משקל שווה (0.03%)', 'ew@0.0006': '9 סקטורים משקל שווה (0.06%)',
         'SPY': 'SPY קנה-והחזק'}
PN = {'full': 'כל התקופה', 'p2008': '2008–2026', 'p2003': '2003–2026', 'p2022': '2022–2026'}


def pct(x): return '—' if x is None else f'{x * 100:+.1f}%'


def report(o, outd):
    L = [f"# Dual-Momentum Sector Rotation — תוצאות (PROTOCOL v1.0, commit {o['protocol_commit']})", '',
         f"אות ראשון {o['start_signal']}, מסחר ראשון {o['first_trade']}, עד {o['end']}. ^IRX ממולא קדימה: {o['irx_forward_filled_days']} ימים.", '',
         f"**פסיקה: {o['criteria']['verdict']}**", '']
    for p, pn in PN.items():
        L += [f'## {pn}', '', '| תיק | CAGR | ירידה מקס׳ | Sharpe | Sortino |', '|---|---|---|---|---|']
        for k in NAMES:
            m = o['metrics'][k][p]
            L.append(f"| {NAMES[k]} | {pct(m['cagr'])} | {pct(m['mdd'])} | {m['sharpe']:.2f} | {m['sortino']:.2f} |")
        L.append('')
    L += ['## חלונות משבר (תשואה / ירידה מקס׳)', '', '| תיק | דוט-קום 2000–2002 | 2008 | קורונה | 2022 |', '|---|---|---|---|---|']
    for k in NAMES:
        w = o['windows'][k]
        L.append(f"| {NAMES[k]} | " + ' | '.join(f"{pct(w[x]['total'])} / {pct(w[x]['mdd'])}" for x in WINDOWS) + ' |')
    L += ['', '## מובהקות (Jobson-Korkie/Memmel, חד-צדדי, מומנטום כפול מול ההשוואה)', '', '| עלות | מול | ' + ' | '.join(PN.values()) + ' |',
          '|---|---|---|---|---|---|']
    for c in COSTS:
        for b in ('SPY', 'EW'):
            L.append(f"| {c * 100:.2f}% | {b} | " + ' | '.join(f"p={o['memmel'][c][b][p]['p_one_sided']:.3f}" for p in PN) + ' |')
    ys = sorted(o['yearly']['SPY'])
    L += ['', '## תשואה לפי שנה', '', '| שנה | ' + ' | '.join(NAMES[k] for k in ('dm@0.0003', 'top3@0.0003', 'ew@0.0003', 'SPY')) + ' |', '|---|---|---|---|---|']
    for y in ys:
        L.append(f'| {y} | ' + ' | '.join(pct(o['yearly'][k][y]) for k in ('dm@0.0003', 'top3@0.0003', 'ew@0.0003', 'SPY')) + ' |')
    e = o['extra']['dm@0.0003']
    L += ['', '## מומנטום כפול — חשיפה ומחזור (0.03%)', '',
          f"- חודשים: {e['months']}; חשיפה ממוצעת למניות: {e['avg_risky'] * 100:.0f}%; חודשים ב-100% מקלט: {e['months_all_haven']}; לפי מספר סקטורים: {e['months_by_n']}",
          f"- מחזור שנתי: {e['turnover']:.2f}; עלויות מצטברות: {e['costs']:.4f} (ביחידות NAV התחלתי); ריבית על מזומן: {e['interest']:.4f}",
          f"- חודשי החזקה לפי סקטור: {e['pick_count']}",
          f"- תרומה לרווח: " + ', '.join(f'{s} {v * 100:.0f}%' for s, v in sorted(e['contrib_share'].items(), key=lambda x: -x[1])), '',
          '## קריטריונים', '', '```', json.dumps(o['criteria'], ensure_ascii=False, indent=1), '```']
    open(f'{outd}/report.md', 'w').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    run(sys.argv[2], sys.argv[3])
