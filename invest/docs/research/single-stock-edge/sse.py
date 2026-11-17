#!/usr/bin/env python3
"""מחקר א — Single-Stock Behavioral Edge. סימולציה לפי PROTOCOL_v1.0.md (נעול ב-98c48c8). הרצה אחת בלבד.
שימוש: sse.py run RAW_DIR GATE_JSON OUT_DIR   (RAW_DIR = פלט של data_gate/gate.py fetch; בלי תלויות חיצוניות)"""
import json, sys, os, math, random, datetime as dt, statistics as stt

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data_gate'))
from gate import load  # noqa: E402

START = dt.date(2010, 1, 4)
DEV = (dt.date(2010, 1, 4), dt.date(2018, 12, 31))
VAL = (dt.date(2019, 1, 1), dt.date(2022, 12, 31))
TEST = (dt.date(2023, 1, 1), None)
OOS = (dt.date(2019, 1, 1), None)
CAP0, EXPO, SLIP = 50000.0, 0.5, 2e-4
FAMS = ('MR', 'MOM', 'PB')
N_SEL, MIN_DEV_TRADES, N_RAND, SEED = 5, 20, 2000, 20261117


def half_spread(adv):
    return 1.5e-4 if adv >= 1e9 else 3e-4 if adv >= 1e8 else 7e-4 if adv >= 2e7 else 15e-4 if adv >= 5e6 else 30e-4


# ---------------- נתונים ----------------
class Stock:
    def __init__(self, X, irx_rate):
        rows = X['rows']
        self.d = [d for d in sorted(rows) if all(v is not None and v > 0 for v in rows[d][:3])]
        self.O = [rows[d][0] for d in self.d]; self.C = [rows[d][1] for d in self.d]; self.A = [rows[d][2] for d in self.d]
        V = [rows[d][3] or 0 for d in self.d]
        self.div = [X['divs'].get(d, 0.0) for d in self.d]
        sp = sorted(X['splits'].items())
        # מקדם פיצולים עתידיים: מחיר אמיתי = מחיר מתואם × F; מניות אמיתיות = יחידות מתואמות / F
        self.F = []
        for d in self.d:
            f = 1.0
            for sd, r in sp:
                if sd > d: f *= r
            self.F.append(f)
        dv = [self.C[i] * V[i] for i in range(len(self.d))]
        self.adv = [0.0] * len(self.d)
        acc = 0.0
        for i in range(len(self.d)):  # מחזור ממוצע של 20 הימים הקודמים (לא כולל היום)
            self.adv[i] = acc / min(i, 20) if i else 0.0
            acc += dv[i]
            if i >= 20: acc -= dv[i - 20]
        self.sma = [None] * len(self.d)
        s = 0.0
        for i in range(len(self.d)):
            s += self.A[i]
            if i >= 200: s -= self.A[i - 200]
            if i >= 199: self.sma[i] = s / 200
        self.r = [irx_rate(self.d[i - 1]) * (self.d[i] - self.d[i - 1]).days / 360 if i else 0.0 for i in range(len(self.d))]


def irx_loader(raw):
    X, _ = load(raw, '^IRX')
    pts = sorted((d, r[1]) for d, r in X['rows'].items() if r[1] is not None)
    ds = [p[0] for p in pts]; vs = [p[1] for p in pts]
    import bisect
    def rate(d):
        k = bisect.bisect_right(ds, d) - 1
        return vs[max(k, 0)] / 100
    return rate


# ---------------- אותות ----------------
def signal(S, fam, t):
    A, sma = S.A, S.sma[t]
    if sma is None or t < 3: return False
    if fam == 'MR':
        return A[t] < A[t - 1] < A[t - 2] < A[t - 3] and A[t] >= sma
    if fam == 'MOM':
        return A[t] > A[t - 1] > A[t - 2] > A[t - 3] and A[t] > sma
    return A[t] > sma and A[t] / A[t - 3] - 1 <= -0.05


# ---------------- ביצוע ----------------
def buy(S, i, cash, mult):
    h = (half_spread(S.adv[i]) + SLIP) * mult
    px = S.O[i] * (1 + h)
    sh = EXPO * cash / px
    real = sh / S.F[i]
    comm = min(max(1.0, 0.005 * real), 0.01 * sh * px) * mult
    sh = (EXPO * cash - comm) / px
    return sh, sh * px + comm, comm + sh * S.O[i] * h


def sell(S, i, sh, mult, px0=None):
    h = (half_spread(S.adv[i]) + SLIP) * mult
    p = (S.O[i] if px0 is None else px0) * (1 - h)
    real = sh / S.F[i]
    comm = (min(max(1.0, 0.005 * real), 0.01 * sh * p) + 0.0000278 * sh * p + min(0.000166 * real, 8.3)) * mult
    return sh * p - comm, comm + sh * (S.O[i] if px0 is None else px0) * h


def simulate(S, fam, mult, i0, i1=None, entries=None):
    """מסלול יומי מ-i0 (סגירה) עד i1. entries=None → לפי האותות; אחרת רשימת (כניסה, משך) קבועה (כניסות אקראיות).
    מחזיר nav [(תאריך, שווי)], עסקאות, עלויות."""
    i1 = len(S.d) - 1 if i1 is None else i1
    cash, sh, nav, trades, costs = CAP0, 0.0, [], [], 0.0
    pend_in = pend_out = None; e = None; basis = 0.0; eq_in = 0.0; divs_in = 0.0
    plan = dict(entries) if entries else None
    if plan:
        pend_in = None
    for i in range(i0, i1 + 1):
        if i > i0: cash += cash * S.r[i]
        if plan and i in plan and sh == 0: pend_in = i; pend_out = i + plan[i]
        if pend_out is not None and i == pend_out and sh > 0:
            v, c = sell(S, i, sh, mult); cash += v; costs += c
            trades.append({'in': e, 'out': i, 'days': i - e, 'pnl': v - basis + divs_in, 'eq': eq_in, 'date': S.d[e]})
            sh = 0.0; pend_out = None
        if pend_in is not None and i == pend_in and sh == 0:
            eq_in = cash
            sh, basis, c = buy(S, i, cash, mult); cash -= basis; costs += c; e = i; divs_in = 0.0; pend_in = None
        if sh > 0 and e is not None and i > e and S.div[i]:
            dv = sh * S.div[i]; cash += dv; divs_in += dv
        if not plan and sh > 0 and pend_out is None:
            if fam == 'MR':
                if S.A[i] > S.A[i - 1] or i - e >= 4: pend_out = i + 1
            else:
                hold = 3 if fam == 'MOM' else 5
                if i - e + 1 >= hold: pend_out = i + 1
        nav.append((S.d[i], cash + sh * S.C[i]))
        if not plan and sh == 0 and pend_in is None and i < i1 and signal(S, fam, i):
            pend_in = i + 1
    if sh > 0:  # סוף הנתונים (מחיקה או סוף התקופה): סגירה בסגירה האחרונה
        v, c = sell(S, i1, sh, mult, px0=S.C[i1]); cash += v; costs += c
        trades.append({'in': e, 'out': i1, 'days': i1 - e, 'pnl': v - basis + divs_in, 'eq': eq_in, 'date': S.d[e], 'forced': True})
        nav[-1] = (S.d[i1], cash)
    return nav, trades, costs


# ---------------- מדדים ----------------
def extend_cash(nav, cal_after, irx_rate):
    """מניה שנמחקה: אחרי הסדרה — מזומן שצובר ^IRX עד סוף לוח השנה."""
    out = list(nav); d0, v = nav[-1]
    for d in cal_after:
        v *= 1 + irx_rate(d0) * (d - d0).days / 360; out.append((d, v)); d0 = d
    return out


def metrics(nav, irx_rate, a=None, b=None):
    idx = [k for k, (d, _) in enumerate(nav) if (a is None or d >= a) and (b is None or d <= b)]
    if len(idx) < 3: return None
    k0 = idx[0] - 1 if idx[0] > 0 else idx[0]
    pts = nav[k0:idx[-1] + 1]
    (d0, v0), (d1, v1) = pts[0], pts[-1]
    yrs = (d1 - d0).days / 365.25
    peak, mdd = v0, 0.0
    for _, v in pts: peak = max(peak, v); mdd = min(mdd, v / peak - 1)
    ex = [pts[k][1] / pts[k - 1][1] - 1 - irx_rate(pts[k - 1][0]) * (pts[k][0] - pts[k - 1][0]).days / 360 for k in range(1, len(pts))]
    sd = stt.stdev(ex) if len(ex) > 2 else 0
    return {'mult': v1 / v0, 'cagr': (v1 / v0) ** (1 / yrs) - 1 if yrs > 0 and v1 > 0 else -1, 'mdd': mdd,
            'sharpe': stt.mean(ex) / sd * math.sqrt(252) if sd > 1e-9 else 0.0}


def spearman(x, y):
    def rk(v):
        o = sorted(range(len(v)), key=lambda i: v[i]); r = [0] * len(v)
        for p, i in enumerate(o): r[i] = p
        return r
    rx, ry = rk(x), rk(y); n = len(x)
    if n < 3: return None
    mx, my = stt.mean(rx), stt.mean(ry)
    num = sum((rx[i] - mx) * (ry[i] - my) for i in range(n))
    den = math.sqrt(sum((v - mx) ** 2 for v in rx) * sum((v - my) ** 2 for v in ry))
    return num / den if den else None


def q(v, p):
    s = sorted(v); return s[min(len(s) - 1, int(p * len(s)))] if s else None


# ---------------- הרצה ----------------
def run(raw, gate_json, outd):
    os.makedirs(outd, exist_ok=True)
    g = json.load(open(gate_json))
    rate = irx_loader(raw)
    spyX, _ = load(raw, 'SPY')
    spy = sorted((d, r[2]) for d, r in spyX['rows'].items() if r[2])
    cal = [d for d, _ in spy if d >= START]
    spy_nav = [(d, a) for d, a in spy if d >= START - dt.timedelta(days=5)]
    PER = {'dev': DEV, 'val': VAL, 'test': TEST, 'oos': OOS, 'full': (None, None)}
    rows, S_by = [], {}
    for s in g['eligible_list']:
        X, _ = load(raw, s)
        S = Stock(X, rate); S_by[s] = S
        i0 = next((k for k, d in enumerate(S.d) if d >= START), None)
        if i0 is None: continue
        i0 -= 1  # הסגירה שלפני 04/01/2010 — נקודת הבסיס; אותות מהסגירה הזו
        bh = [(S.d[k], S.A[k]) for k in range(i0, len(S.d))]
        tail = [d for d in cal if d > S.d[-1]]
        if tail: bh = extend_cash(bh, tail, rate)
        for fam in FAMS:
            nav, tr, costs = simulate(S, fam, 1.0, i0)
            if tail: nav = extend_cash(nav, tail, rate)
            row = {'sym': s, 'fam': fam, 'trades': {p: sum(1 for t in tr if (a is None or t['date'] >= a) and (b is None or t['date'] <= b)) for p, (a, b) in PER.items()},
                   'costs': costs, 'delisted_end': str(S.d[-1]) if tail else None}
            for p, (a, b) in PER.items():
                row[p] = metrics(nav, rate, a, b)
                row['bh_' + p] = metrics(bh, rate, a, b)
            rows.append(row)
        print('done', s, flush=True)
    n_combos = len(rows)
    # בחירה לפי הפיתוח בלבד
    sel = []
    for fam in FAMS:
        cand = [r for r in rows if r['fam'] == fam and r['trades']['dev'] >= MIN_DEV_TRADES and r['dev']]
        cand.sort(key=lambda r: (-r['dev']['sharpe'], r['sym']))
        sel += cand[:N_SEL]
    rng = random.Random(SEED)
    alpha = 0.05 / len(sel) if sel else 0.05
    spy_m = {p: metrics(spy_nav, rate, a, b) for p, (a, b) in PER.items()}
    cash_m = {}
    for p, (a, b) in PER.items():
        ds = [d for d in cal if (a is None or d >= a) and (b is None or d <= b)]
        v, nv = 1.0, [(ds[0] - dt.timedelta(days=1), 1.0)]
        for k, d in enumerate(ds):
            v *= 1 + rate(nv[-1][0]) * (d - nv[-1][0]).days / 360; nv.append((d, v))
        cash_m[p] = metrics(nv, rate)
    detail = []
    for r in sel:
        S = S_by[r['sym']]
        o0 = next((k for k, d in enumerate(S.d) if d >= OOS[0]), None)
        if o0 is None:
            detail.append({**r, 'note': 'אין נתונים מחוץ למדגם'}); continue
        o0 -= 1
        nav_o, tr_o, _ = simulate(S, r['fam'], 1.0, o0)
        tail = [d for d in cal if d > S.d[-1]]
        if tail: nav_o = extend_cash(nav_o, tail, rate)
        mult_actual = nav_o[-1][1] / CAP0
        # כניסות אקראיות: אותו מספר עסקאות ואותם משכים, בלי חפיפה, אותה תקופה
        L = [t['days'] for t in tr_o]; T = len(S.d) - o0 - 1; ge = 0; mults = []
        for _ in range(N_RAND):
            if not L: break
            Ls = L[:]; rng.shuffle(Ls)
            M = T - sum(Ls) - len(Ls)
            if M < 0: break
            u = sorted(rng.randint(0, M) for _ in Ls)
            ent, off = {}, 0
            for k, Lk in enumerate(Ls):
                st_ = o0 + 1 + u[k] + off; ent[st_] = max(1, Lk); off += Lk + 1
            nv, _, _ = simulate(S, r['fam'], 1.0, o0, entries=sorted(ent.items()))
            if tail: nv = extend_cash(nv, tail, rate)
            m = nv[-1][1] / CAP0; mults.append(m); ge += m >= mult_actual
        p = (1 + ge) / (1 + len(mults)) if mults else None
        # עסקאות חריגות ותלות בשנה
        rs = sorted((t['pnl'] / t['eq'] for t in tr_o), reverse=True)
        mult_ex3 = mult_actual
        for x in rs[:3]: mult_ex3 /= (1 + x)
        yrs = (nav_o[-1][0] - nav_o[0][0]).days / 365.25
        cagr_ex3 = mult_ex3 ** (1 / yrs) - 1 if mult_ex3 > 0 else -1
        ylog, prev = {}, nav_o[0][1]
        for y in sorted({d.year for d, _ in nav_o[1:]}):
            v = [x for d, x in nav_o if d.year == y][-1]; ylog[y] = math.log(v / prev); prev = v
        tot = sum(ylog.values())
        max_share = max(ylog.values()) / tot if tot > 0 else None
        # עלויות כפולות (מסלול מלא)
        i0 = next(k for k, d in enumerate(S.d) if d >= START) - 1
        nav2, tr2, c2 = simulate(S, r['fam'], 2.0, i0)
        if tail: nav2 = extend_cash(nav2, tail, rate)
        m2 = {pp: metrics(nav2, rate, a, b) for pp, (a, b) in PER.items()}
        crit = {'1_cagr_oos_ge_15_and_val_test_pos': r['oos']['cagr'] >= 0.15 and r['val']['cagr'] > 0 and r['test']['cagr'] > 0,
                '2_mdd_full_le_20': r['full']['mdd'] >= -0.20,
                '3_random_p_lt_bonf': p is not None and p < alpha,
                '4_no_outliers': cagr_ex3 > cash_m['oos']['cagr'] and max_share is not None and max_share <= 0.5,
                '5_double_cost_cagr_oos_ge_15': m2['oos']['cagr'] >= 0.15}
        detail.append({**r, 'oos_fresh_mult': mult_actual, 'oos_fresh_trades': len(tr_o), 'random_p': p,
                       'random_mean_mult': stt.mean(mults) if mults else None, 'random_median_mult': q(mults, 0.5) if mults else None,
                       'cagr_oos_ex_top3': cagr_ex3, 'max_year_share': max_share, 'double_cost': m2, 'double_cost_total': c2,
                       'criteria': crit, 'all_ok': all(crit.values())})
    # התפלגות והתמדה
    dist = {}
    for fam in FAMS:
        rr = [r for r in rows if r['fam'] == fam and r['dev'] and r['oos']]
        el = [r for r in rr if r['trades']['dev'] >= MIN_DEV_TRADES]
        dist[fam] = {'n': len(rr), 'n_eligible_for_selection': len(el),
                     'spearman_dev_vs_oos_sharpe': spearman([r['dev']['sharpe'] for r in el], [r['oos']['sharpe'] for r in el]),
                     'dev_cagr_q': [q([r['dev']['cagr'] for r in rr], x) for x in (0.1, 0.25, 0.5, 0.75, 0.9)],
                     'oos_cagr_q': [q([r['oos']['cagr'] for r in rr], x) for x in (0.1, 0.25, 0.5, 0.75, 0.9)],
                     'oos_sharpe_q': [q([r['oos']['sharpe'] for r in rr], x) for x in (0.1, 0.25, 0.5, 0.75, 0.9)],
                     'share_oos_beats_cash': sum(1 for r in rr if r['oos']['cagr'] > cash_m['oos']['cagr']) / len(rr),
                     'share_oos_beats_bh': sum(1 for r in rr if r['bh_oos'] and r['oos']['cagr'] > r['bh_oos']['cagr']) / len(rr),
                     'share_oos_ge_15': sum(1 for r in rr if r['oos']['cagr'] >= 0.15) / len(rr),
                     'share_full_mdd_le_20': sum(1 for r in rr if r['full']['mdd'] >= -0.20) / len(rr),
                     'median_trades_full': q([r['trades']['full'] for r in rr], 0.5)}
    any_ok = any(d.get('all_ok') for d in detail)
    verdict = ('INCONCLUSIVE' if g['missing'] > 0 else 'PASS') if any_ok else 'FAIL'
    out = {'protocol_commit': '98c48c8', 'members_2010': g['members'], 'eligible': g['eligible'], 'missing': g['missing'],
           'combos_tested': n_combos, 'selected': len(sel), 'alpha_bonferroni': alpha, 'spy': spy_m, 'cash': cash_m,
           'distribution': dist, 'selected_detail': detail, 'verdict': verdict}
    json.dump(out, open(f'{outd}/results.json', 'w'), ensure_ascii=False, indent=1, default=str)
    with open(f'{outd}/all_combos.csv', 'w') as f:
        f.write('sym,fam,trades_dev,trades_oos,dev_cagr,dev_sharpe,val_cagr,test_cagr,oos_cagr,oos_sharpe,full_cagr,full_mdd,bh_oos_cagr,delisted_end\n')
        for r in rows:
            g_ = lambda p, k: '' if not r[p] else f"{r[p][k]:.4f}"
            f.write(f"{r['sym']},{r['fam']},{r['trades']['dev']},{r['trades']['oos']},{g_('dev','cagr')},{g_('dev','sharpe')},{g_('val','cagr')},"
                    f"{g_('test','cagr')},{g_('oos','cagr')},{g_('oos','sharpe')},{g_('full','cagr')},{g_('full','mdd')},{g_('bh_oos','cagr')},{r['delisted_end'] or ''}\n")
    report(out, outd)
    print('VERDICT', verdict, flush=True)


FN = {'MR': 'משפחה 1 — Mean Reversion', 'MOM': 'משפחה 2 — מומנטום קצר', 'PB': 'משפחה 3 — Pullback'}


def pc(x): return '—' if x is None else f'{x * 100:+.1f}%'


def report(o, outd):
    L = [f"# Single-Stock Behavioral Edge — תוצאות (PROTOCOL v1.0, commit {o['protocol_commit']})", '',
         f"חברי S&P 500 ב-2010: {o['members_2010']} · כשירים: {o['eligible']} · חסרים: {o['missing']} · שילובים שנבדקו: {o['combos_tested']} · "
         f"נבחרו בפיתוח: {o['selected']} · סף בונפרוני: p < {o['alpha_bonferroni']:.4f}", '', f"**פסיקה: {o['verdict']}**", '',
         '## השוואות (CAGR / ירידה מקס׳ / Sharpe)', '', '| | פיתוח | אימות | מבחן | מחוץ למדגם | כל התקופה |', '|---|---|---|---|---|---|']
    for nm, m in (('SPY', o['spy']), ('מזומן (‎^IRX)', o['cash'])):
        L.append(f'| {nm} | ' + ' | '.join(f"{pc(m[p]['cagr'])} / {pc(m[p]['mdd'])} / {m[p]['sharpe']:.2f}" for p in ('dev', 'val', 'test', 'oos', 'full')) + ' |')
    L += ['', '## 15 הנבחרים (לפי Sharpe בפיתוח)', '',
          '| מניה | משפחה | עסקאות פיתוח/מחוץ | פיתוח CAGR / Sharpe | אימות | מבחן | מחוץ למדגם CAGR / Sharpe | ירידה מקס׳ (הכול) | קנה-והחזק מחוץ | p אקראי | בלי 3 הטובות | עלויות ×2 מחוץ | עובר? |',
          '|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for d in o['selected_detail']:
        if 'criteria' not in d: L.append(f"| {d['sym']} | {d['fam']} | — | {d.get('note','')} |"); continue
        L.append(f"| {d['sym']} | {d['fam']} | {d['trades']['dev']}/{d['trades']['oos']} | {pc(d['dev']['cagr'])} / {d['dev']['sharpe']:.2f} | {pc(d['val']['cagr'])} | "
                 f"{pc(d['test']['cagr'])} | {pc(d['oos']['cagr'])} / {d['oos']['sharpe']:.2f} | {pc(d['full']['mdd'])} | {pc(d['bh_oos']['cagr'] if d['bh_oos'] else None)} | "
                 f"{'—' if d['random_p'] is None else format(d['random_p'], '.3f')} | {pc(d['cagr_oos_ex_top3'])} | {pc(d['double_cost']['oos']['cagr'])} | {'✅' if d['all_ok'] else '❌'} |")
    L += ['', '## התפלגות כל השילובים והתמדה', '',
          '| משפחה | שילובים | ספירמן פיתוח↔מחוץ (Sharpe) | CAGR מחוץ: 10/25/50/75/90% | מנצח מזומן | מנצח קנה-והחזק | ≥15% מחוץ | ירידה ≤20% | עסקאות (חציון) |',
          '|---|---|---|---|---|---|---|---|---|']
    for f, d in o['distribution'].items():
        sp = '—' if d['spearman_dev_vs_oos_sharpe'] is None else f"{d['spearman_dev_vs_oos_sharpe']:+.2f}"
        L.append(f"| {FN[f]} | {d['n']} | {sp} | {' / '.join(pc(x) for x in d['oos_cagr_q'])} | {d['share_oos_beats_cash']:.0%} | {d['share_oos_beats_bh']:.0%} | "
                 f"{d['share_oos_ge_15']:.0%} | {d['share_full_mdd_le_20']:.0%} | {d['median_trades_full']} |")
    L += ['', '## קריטריונים לכל נבחר', '', '```', json.dumps([{d['sym'] + '/' + d['fam']: d.get('criteria')} for d in o['selected_detail']], ensure_ascii=False, indent=0), '```']
    open(f'{outd}/report.md', 'w').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    run(sys.argv[2], sys.argv[3], sys.argv[4])
