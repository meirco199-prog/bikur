# מחקר (זמני, ענף בלבד): כמה מניה עולה עד שהיא נסוגה, ואיזה סטופ / יעד / סטופ נגרר עובד סטטיסטית — לפי סקטורים.
# נתונים: S&P 500 (ויקיפדיה, סקטור GICS) + מניות שמאיר סוחר בהן + ETF-ים לייחוס; נרות יומיים של 10 שנים מ-Yahoo.
# פלט: out/summary.md (טבלאות) + out/results.json. שום דבר כאן לא נוגע בחשבון או במסחר.
import io, json, math, os, sys, time, random
import urllib.request
import numpy as np
import pandas as pd

OUT = os.path.join(os.path.dirname(__file__), 'out'); os.makedirs(OUT, exist_ok=True)
CACHE = os.environ.get('CACHE_DIR', '/tmp/swcache'); os.makedirs(CACHE, exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 (compatible; bikur-research/1.0)', 'Accept': 'application/json,text/html'}
EXTRA = ['CRDO', 'ALAB', 'NBIS', 'SITM', 'LITE', 'MTSI', 'RKLB', 'SMMT', 'HOOD', 'FTAI', 'ECHO', 'COIN', 'SNDK', 'MRVL', 'AMD', 'MU',
         'LRCX', 'KLAC', 'AXON', 'DASH', 'CRWD', 'OKTA', 'MELI', 'TSLA', 'EXPE', 'AEHR', 'VRT', 'FIX', 'TEVA', 'SMCI', 'PLTR', 'NVDA']
ETFS = ['SPY', 'QQQ', 'SMH']
COST = 0.001  # עלות לסבב (עמלות + פער קנייה-מכירה), 0.1%

def get(url, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r: return r.read()
        except Exception as e:
            if k == tries - 1: raise
            time.sleep(2 + 3 * k)

def sp500():
    html = get('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies').decode('utf-8', 'replace')
    t = pd.read_html(io.StringIO(html))[0]
    return [(str(r['Symbol']).replace('.', '-'), str(r['GICS Sector']), str(r['GICS Sub-Industry'])) for _, r in t.iterrows()]

def bars(sym):
    p = os.path.join(CACHE, sym + '.json')
    if os.path.exists(p): j = json.load(open(p))
    else:
        j = json.loads(get(f'https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=10y&interval=1d&events=splits'))
        json.dump(j, open(p, 'w')); time.sleep(0.35)
    r = j['chart']['result'][0]; q = r['indicators']['quote'][0]
    df = pd.DataFrame({'t': pd.to_datetime(r['timestamp'], unit='s').normalize(), 'o': q['open'], 'h': q['high'], 'l': q['low'], 'c': q['close']}).dropna()
    df = df[(df.o > 0) & (df.h >= df[['o', 'c']].max(axis=1) - 1e-9) & (df.l <= df[['o', 'c']].min(axis=1) + 1e-9)]
    return df.drop_duplicates('t').reset_index(drop=True)

# ---------- 1. גלים (zigzag): כמה עולה מניה מהשפל עד השיא, כש"נסיגה" = ירידה של r% מהשיא ----------
def zigzag_upswings(c, r):
    out, lo, lo_i, hi, hi_i, up = [], c[0], 0, c[0], 0, None
    for i in range(1, len(c)):
        x = c[i]
        if up is None:
            if x >= lo * (1 + r): up, hi, hi_i = True, x, i
            elif x <= hi * (1 - r): up, lo, lo_i = False, x, i
            if x < lo: lo, lo_i = x, i
            if x > hi: hi, hi_i = x, i
        elif up:
            if x > hi: hi, hi_i = x, i
            elif x <= hi * (1 - r):
                out.append((hi / lo - 1, hi_i - lo_i)); up, lo, lo_i = False, x, i
        else:
            if x < lo: lo, lo_i = x, i
            elif x >= lo * (1 + r): up, hi, hi_i = True, x, i
    return out  # רק גלים שהסתיימו בנסיגה

# ---------- 2. כללי יציאה על כניסות בסגירה ----------
H = 60  # ימי מסחר מקסימום
def windows(df, idx):
    o, h, l, c = (df[k].values for k in 'ohlc')
    idx = idx[idx + H < len(c)]
    if not len(idx): return None
    base = c[idx][:, None]; rng = idx[:, None] + np.arange(1, H + 1)[None, :]
    return o[rng] / base, h[rng] / base, l[rng] / base, c[rng] / base

def first(mask):
    any_ = mask.any(1); return np.where(any_, mask.argmax(1), H), any_

def exit_fixed(W, sl=None, tp=None, hold=H):
    O, Hh, L, C = (w[:, :hold] for w in W); n = len(O); rows = np.arange(n)
    ds, hs = first(L <= 1 - sl) if sl else (np.full(n, hold), np.zeros(n, bool))
    dt, ht = first(Hh >= 1 + tp) if tp else (np.full(n, hold), np.zeros(n, bool))
    ds = np.where(hs, ds, hold); dt = np.where(ht, dt, hold)
    ret = C[:, hold - 1] - 1; days = np.full(n, hold)
    st = hs & (ds <= dt)  # אותו יום: סטופ קודם (שמרני), אלא אם נפתח מעל היעד
    if sl:
        px = np.minimum(O[rows, np.minimum(ds, hold - 1)], 1 - sl)
        ret = np.where(st, px - 1, ret); days = np.where(st, ds + 1, days)
    if tp:
        tk = ht & (~st | ((dt == ds) & (O[rows, np.minimum(dt, hold - 1)] >= 1 + tp)))
        px = np.maximum(O[rows, np.minimum(dt, hold - 1)], 1 + tp)
        ret = np.where(tk, px - 1, ret); days = np.where(tk, dt + 1, days)
    return ret - COST, days

def exit_trail(W, ts):
    O, Hh, L, C = W; n = len(O); rows = np.arange(n)
    peak = np.maximum(1.0, np.maximum.accumulate(Hh, 1)); prev = np.concatenate([np.ones((n, 1)), peak[:, :-1]], 1)
    lvl = prev * (1 - ts); d, hit = first(L <= lvl)
    dd = np.minimum(d, H - 1); px = np.minimum(O[rows, dd], lvl[rows, dd])
    return np.where(hit, px - 1, C[:, -1] - 1) - COST, np.where(hit, d + 1, H)

def stats(ret, days):
    if not len(ret): return None
    return {'n': int(len(ret)), 'mean': float(ret.mean()), 'median': float(np.median(ret)), 'win': float((ret > 0).mean()),
            'days': float(days.mean()), 'perDay': float(ret.mean() / days.mean()), 'p10': float(np.percentile(ret, 10))}

RULES = [('hold', {}), *[(f'sl{int(s*100)}', {'sl': s}) for s in (.02, .03, .04, .05, .07, .10, .15, .20)],
         *[(f'tp{int(t*100)}', {'tp': t}) for t in (.03, .05, .08, .10, .15, .20, .30)],
         *[(f'sl{int(s*100)}_tp{int(t*100)}', {'sl': s, 'tp': t}) for s in (.04, .07, .10) for t in (.05, .10, .20)],
         *[(f'trail{int(s*100)}', {'trail': s}) for s in (.05, .08, .10, .15, .20, .25)],
         ('hold5', {'hold': 5}), ('hold20', {'hold': 20})]

def run_rules(W):
    res = {}
    for name, p in RULES:
        if 'trail' in p: r, d = exit_trail(W, p['trail'])
        else: r, d = exit_fixed(W, p.get('sl'), p.get('tp'), p.get('hold', H))
        res[name] = (r, d)
    return res

def main():
    t0 = time.time()
    try: uni = sp500()
    except Exception as e: print('wikipedia failed', e); uni = []
    meta = {s: (sec, sub) for s, sec, sub in uni}
    syms = list(dict.fromkeys([s for s, _, _ in uni] + EXTRA + ETFS))
    print('universe', len(syms))
    acc = {}  # (segment, entry, rule) -> list of arrays
    swing = {}  # (segment, r) -> list of (rise, days)
    intraday = {}  # segment -> dict
    on_vs_id = []
    vols = {}
    bad = []
    for k, s in enumerate(syms):
        try: df = bars(s)
        except Exception as e: bad.append(s); continue
        if len(df) < 400: bad.append(s); continue
        c = df.c.values; r1 = np.diff(np.log(c)); vol = float(r1[-500:].std() * math.sqrt(252)); vols[s] = vol
        sec = meta.get(s, ('ETF' if s in ETFS else 'Meir/other', ''))[0]
        sub = meta.get(s, ('', ''))[1]
        segs = ['ALL', sec] + (['Semis'] if 'Semiconductor' in sub else []) + (['MeirNames'] if s in EXTRA else [])
        segs += ['vol>60%' if vol > .6 else 'vol40-60%' if vol > .4 else 'vol25-40%' if vol > .25 else 'vol<25%']
        if s in ETFS: segs = [s]
        # גלים
        for rr in (.05, .10, .15, .20):
            sw = zigzag_upswings(c, rr)
            for g in segs: swing.setdefault((g, rr), []).extend(sw)
        # כניסות
        ret = np.r_[np.nan, c[1:] / c[:-1] - 1]
        offhi = df.c.values / df.h.values - 1
        rng = np.random.default_rng(abs(hash(s)) % 2**32)
        allidx = np.arange(21, len(df) - H - 1)
        entries = {
            'random': rng.choice(allidx, size=min(len(allidx), 120), replace=False),
            'dip5': allidx[ret[allidx] <= -0.05],
            'up3_offhigh3': allidx[(ret[allidx] >= 0.03) & (offhi[allidx] <= -0.03)],
        }
        for en, idx in entries.items():
            W = windows(df, np.sort(idx))
            if W is None: continue
            for rn, (rv, dv) in run_rules(W).items():
                for g in segs: acc.setdefault((g, en, rn), []).append((rv, dv))
        # יום מסחר אחד: קנייה בפתיחה, מכירה בסגירה, סטופ X% מהפתיחה / יעד Y%
        o, h, l = df.o.values[1:], df.h.values[1:], df.l.values[1:]; cc = c[1:]
        idr = {}
        for x in (None, .01, .02, .03, .04, .05, .07):
            rv = cc / o - 1
            if x: rv = np.where(l <= o * (1 - x), -x, rv)
            idr[f'stop{int(x*100) if x else "None"}'] = float(rv.mean() - COST)
        for y in (.01, .02, .03, .05):
            rv = np.where(h >= o * (1 + y), y, cc / o - 1); idr[f'tp{int(y*100)}'] = float(rv.mean() - COST)
        idr['overnight'] = float((o / c[:-1] - 1).mean()); idr['intraday'] = float((cc / o - 1).mean())
        for g in segs: intraday.setdefault(g, []).append(idr)
        if k % 50 == 0: print(k, s, f'{time.time()-t0:.0f}s', flush=True)
    # ---------- סיכום ----------
    R = {'meta': {'n_symbols': len(vols), 'bad': bad, 'years': 10, 'cost_roundtrip': COST, 'holdMax': H}, 'swings': {}, 'rules': {}, 'intraday': {}}
    for (g, rr), sw in swing.items():
        if len(sw) < 30: continue
        a = np.array([x[0] for x in sw]); d = np.array([x[1] for x in sw])
        cont = {}
        for lv in (.05, .10, .15, .20, .30, .50, 1.0):
            if lv < rr: continue  # כל גל שנספר כבר עלה לפחות r% (כך מוגדר גל)
            m = a >= lv
            if m.sum() >= 30:
                cont[f'{int(lv*100)}'] = {'n': int(m.sum()), 'p_more10': float((a[m] >= (1 + lv) * 1.10 - 1).mean()), 'remain_median': float(np.median((1 + a[m]) / (1 + lv) - 1)), 'remain_mean': float(np.mean((1 + a[m]) / (1 + lv) - 1))}
        R['swings'][f'{g}|{int(rr*100)}'] = {'n': int(len(a)), 'mean': float(a.mean()), 'median': float(np.median(a)), 'p25': float(np.percentile(a, 25)), 'p75': float(np.percentile(a, 75)), 'p90': float(np.percentile(a, 90)), 'days_median': float(np.median(d)), 'continuation': cont}
    for (g, en, rn), lst in acc.items():
        rv = np.concatenate([x[0] for x in lst]); dv = np.concatenate([x[1] for x in lst])
        st = stats(rv, dv)
        if st and st['n'] >= 200: R['rules'][f'{g}|{en}|{rn}'] = st
    for g, lst in intraday.items():
        R['intraday'][g] = {k: float(np.mean([x[k] for x in lst])) for k in lst[0]} | {'n_symbols': len(lst)}
    json.dump(R, open(os.path.join(OUT, 'results.json'), 'w'), indent=1)
    write_md(R); print('done', f'{time.time()-t0:.0f}s')

def pct(x, d=1): return '—' if x is None else f'{x*100:+.{d}f}%'

def write_md(R):
    L = [f"# מחקר גלים וסטופים — {R['meta']['n_symbols']} ניירות, 10 שנים, עלות {R['meta']['cost_roundtrip']*100:.1f}% לסבב\n"]
    segs = sorted({k.split('|')[0] for k in R['swings']})
    L.append('## 1. גלים: עלייה מהשפל עד השיא (נסיגה = ירידה של 10% מהשיא)\n| סגמנט | גלים | חציון | ממוצע | 25% | 75% | 90% | ימים (חציון) |\n|---|---|---|---|---|---|---|---|')
    for g in segs:
        s = R['swings'].get(f'{g}|10')
        if s: L.append(f"| {g} | {s['n']} | {pct(s['median'],0)} | {pct(s['mean'],0)} | {pct(s['p25'],0)} | {pct(s['p75'],0)} | {pct(s['p90'],0)} | {s['days_median']:.0f} |")
    for rr in (5, 10, 20):
        s = R['swings'].get(f'ALL|{rr}')
        if s: L.append(f"\n**ALL, נסיגה {rr}%:** חציון {pct(s['median'],0)}, ממוצע {pct(s['mean'],0)}, 90% {pct(s['p90'],0)}")
    L.append('\n## 2. "אחרי שעלתה X% — כמה עוד נשאר?" (נסיגה 10%)\n| סגמנט | עלתה | גלים | סיכוי לעוד +10% | חציון ההמשך | ממוצע ההמשך |\n|---|---|---|---|---|---|')
    for g in ['ALL', 'Information Technology', 'Semis', 'MeirNames', 'vol>60%', 'vol<25%']:
        s = R['swings'].get(f'{g}|10')
        if not s: continue
        for lv, c in s['continuation'].items(): L.append(f"| {g} | {lv}% | {c['n']} | {c['p_more10']*100:.0f}% | {pct(c['remain_median'],0)} | {pct(c['remain_mean'],0)} |")
    for en in ('random', 'dip5', 'up3_offhigh3'):
        L.append(f'\n## 3. כללי יציאה — כניסה: {en} (עד 60 ימי מסחר, אחרי עלות)\n| סגמנט | כלל | עסקאות | ממוצע | חציון | הצלחות | ימים | לכל יום | 10% הגרועות |\n|---|---|---|---|---|---|---|---|---|')
        for g in ['ALL', 'Information Technology', 'Semis', 'MeirNames', 'vol>60%', 'vol<25%', 'Financials', 'Health Care', 'Energy', 'Consumer Discretionary', 'Industrials']:
            rows = [(k.split('|')[2], v) for k, v in R['rules'].items() if k.startswith(f'{g}|{en}|')]
            if not rows: continue
            best = sorted(rows, key=lambda x: -x[1]['mean'])
            keep = {'hold', 'hold5', 'hold20', 'sl4', 'sl10', 'tp10', 'trail15'} | {best[0][0], best[1][0]}
            for rn, v in rows:
                if rn in keep: L.append(f"| {g} | {rn}{' ⭐' if rn == best[0][0] else ''} | {v['n']} | {pct(v['mean'],2)} | {pct(v['median'],2)} | {v['win']*100:.0f}% | {v['days']:.0f} | {pct(v['perDay'],3)} | {pct(v['p10'],1)} |")
    L.append('\n## 4. יום מסחר אחד: קנייה בפתיחה, מכירה בסגירה (ממוצע ליום, אחרי עלות 0.1%)\n| סגמנט | בלי סטופ | סטופ 2% | 3% | 4% | 5% | 7% | יעד 2% | יעד 3% | לילה (סגירה→פתיחה, בלי עלות) | יום (פתיחה→סגירה, בלי עלות) |\n|---|---|---|---|---|---|---|---|---|---|---|')
    for g, v in sorted(R['intraday'].items()):
        L.append(f"| {g} | {pct(v['stopNone'],3)} | {pct(v['stop2'],3)} | {pct(v['stop3'],3)} | {pct(v['stop4'],3)} | {pct(v['stop5'],3)} | {pct(v['stop7'],3)} | {pct(v['tp2'],3)} | {pct(v['tp3'],3)} | {pct(v['overnight'],3)} | {pct(v['intraday'],3)} |")
    open(os.path.join(OUT, 'summary.md'), 'w').write('\n'.join(L) + '\n')

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'selftest':
        # בדיקה עצמית על נתונים סינתטיים (בלי רשת)
        rng = np.random.default_rng(1)
        def fake(s):
            n = 2500; c = 100 * np.exp(np.cumsum(rng.normal(0.0003, 0.02, n))); o = c * np.exp(rng.normal(0, .005, n))
            h = np.maximum(o, c) * np.exp(np.abs(rng.normal(0, .008, n))); l = np.minimum(o, c) * np.exp(-np.abs(rng.normal(0, .008, n)))
            return pd.DataFrame({'t': pd.date_range('2016-01-01', periods=n), 'o': o, 'h': h, 'l': l, 'c': c})
        globals()['bars'] = fake; globals()['sp500'] = lambda: [(f'S{i}', 'Information Technology' if i % 2 else 'Energy', 'Semiconductors' if i % 3 == 0 else 'x') for i in range(20)]
        globals()['EXTRA'] = ['S1']; globals()['ETFS'] = []
    main()
