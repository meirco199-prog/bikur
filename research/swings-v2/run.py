# מחקר v2 (מחקר בלבד — לא נוגע בחשבון, בפקודות או במסחר):
#  1. כמה מניה עולה משפל עד נסיגה, והאם "מה שנשאר" אחרי עלייה של X% צפוי;
#  2. איזה סטופ / יעד / סטופ נגרר / סטופ ATR עובד סטטיסטית;
#  3. השיטה היומית של מאיר: קנייה בפתיחה, מכירה בסגירה, סטופ 4% ממחיר הקנייה.
# שיפורים על v1 (d9f49d0:.github/research/swings/run.py): תתי-תקופות, תשואה עודפת מול SPY, סטופ ATR, כניסת פריצה,
# דלי תנודתיות לפי התנודתיות *בזמן הכניסה* (v1 השתמש ב-500 הימים האחרונים = מבט קדימה), seed דטרמיניסטי.
# קלט: מטמון נרות של fetch.py (CACHE_DIR). פלט: summary.md, results.json (באותה תיקייה).
import json, math, os, sys, time, zlib
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get('CACHE_DIR', '/tmp/swcache')
EXTRA = ['CRDO', 'ALAB', 'NBIS', 'SITM', 'LITE', 'MTSI', 'RKLB', 'SMMT', 'HOOD', 'FTAI', 'ECHO', 'COIN', 'SNDK', 'MRVL', 'AMD', 'MU',
         'LRCX', 'KLAC', 'AXON', 'DASH', 'CRWD', 'OKTA', 'MELI', 'TSLA', 'EXPE', 'AEHR', 'VRT', 'FIX', 'TEVA', 'SMCI', 'PLTR', 'NVDA']
ETFS = ['SPY', 'QQQ', 'SMH']
SEMIS = {'LRCX', 'KLAC', 'AMAT', 'MU', 'NVDA', 'AMD', 'AVGO', 'QCOM', 'TXN', 'ADI', 'MCHP', 'NXPI', 'ON', 'MPWR', 'INTC', 'TER', 'SWKS', 'QRVO'}
# ה-API מחזיר שמות סקטור בשני סגנונות (GICS / Yahoo) — מאחדים ל-GICS
SECTOR_NORM = {'Technology': 'Information Technology', 'Healthcare': 'Health Care', 'Financial Services': 'Financials',
               'Consumer Cyclical': 'Consumer Discretionary', 'Consumer Defensive': 'Consumer Staples', 'Basic Materials': 'Materials'}
COST = 0.001  # לסבב (עמלה + מרווח)
H = 60
LVS = (.10, .15, .20, .30, .50, 1.0)
PERIODS = {'2016-2019': (2016, 2019), '2020-2022': (2020, 2022), '2023-2026': (2023, 2026)}
PER_KEYS = ['ALL'] + list(PERIODS)
VB = ['vol<25%', 'vol25-40%', 'vol40-60%', 'vol>60%']

def bars(sym):
    f = os.path.join(CACHE, sym + '.json')
    if not os.path.exists(f): f = os.path.join(CACHE, sym.replace('-', '.') + '.json')  # fetch.py שומר בשם המקורי (BRK.B)
    j = json.load(open(f))
    r = j['chart']['result'][0]; q = r['indicators']['quote'][0]
    df = pd.DataFrame({'t': pd.to_datetime(r['timestamp'], unit='s').normalize(), 'o': q['open'], 'h': q['high'], 'l': q['low'], 'c': q['close']}).dropna()
    df = df[(df.o > 0) & (df.h >= df[['o', 'c']].max(axis=1) - 1e-9) & (df.l <= df[['o', 'c']].min(axis=1) + 1e-9)]
    return df.drop_duplicates('t').reset_index(drop=True)

def period_of(years):
    out = np.full(len(years), -1, np.int8)
    for k, (a, b) in enumerate(PERIODS.values()): out[(years >= a) & (years <= b)] = k
    return out

def vol_bucket(v):
    return np.select([v < .25, v < .40, v < .60], [0, 1, 2], 3).astype(np.int8)

# ---------- גלים (zigzag על סגירות). מחזיר (עלייה, ימים, אינדקס השפל) — רק גלים שהסתיימו בנסיגה ----------
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
                out.append((hi / lo - 1, hi_i - lo_i, lo_i, i)); up, lo, lo_i = False, x, i
        else:
            if x < lo: lo, lo_i = x, i
            elif x >= lo * (1 + r): up, hi, hi_i = True, x, i
    return out

# ---------- כללי יציאה (כניסה בסגירת יום הכניסה; עד H ימים) ----------
def first(mask):
    any_ = mask.any(1); return np.where(any_, mask.argmax(1), mask.shape[1]), any_

def exit_fixed(W, sl=None, tp=None, hold=H):
    """sl: None / סקלר / וקטור לכל עסקה. אותו יום סטופ+יעד → הסטופ קודם (אלא אם נפתח מעל היעד). פער → מילוי בפתיחה."""
    O, Hh, L, C = (w[:, :hold] for w in W); n = len(O); rows = np.arange(n)
    ret = C[:, hold - 1] - 1; days = np.full(n, hold)
    st = np.zeros(n, bool); ds = np.full(n, hold)
    if sl is not None:
        slv = np.broadcast_to(np.asarray(sl, float), (n,))[:, None]
        ds, hs = first(L <= 1 - slv); ds = np.where(hs, ds, hold); st = hs
        px = np.minimum(O[rows, np.minimum(ds, hold - 1)], 1 - slv[:, 0])
        ret = np.where(st, px - 1, ret); days = np.where(st, ds + 1, days)
    if tp is not None:
        dt, ht = first(Hh >= 1 + tp); dt = np.where(ht, dt, hold)
        tk = ht & (~st | (dt < ds) | ((dt == ds) & (O[rows, np.minimum(dt, hold - 1)] >= 1 + tp)))
        px = np.maximum(O[rows, np.minimum(dt, hold - 1)], 1 + tp)
        ret = np.where(tk, px - 1, ret); days = np.where(tk, dt + 1, days)
    return ret - COST, days

def exit_trail(W, ts):
    O, Hh, L, C = W; n = len(O); rows = np.arange(n)
    peak = np.maximum(1.0, np.maximum.accumulate(Hh, 1)); prev = np.concatenate([np.ones((n, 1)), peak[:, :-1]], 1)
    lvl = prev * (1 - ts); d, hit = first(L <= lvl)
    dd = np.minimum(d, H - 1); px = np.minimum(O[rows, dd], lvl[rows, dd])
    return np.where(hit, px - 1, C[:, -1] - 1) - COST, np.where(hit, d + 1, H)

RULES = ([('hold60', {}), ('hold5', {'hold': 5}), ('hold20', {'hold': 20})]
         + [(f'sl{int(s*100)}', {'sl': s}) for s in (.02, .03, .04, .05, .07, .10, .15, .20)]
         + [(f'atr{k:g}', {'atr': k}) for k in (1, 1.5, 2, 3, 4)]
         + [(f'trail{int(s*100)}', {'trail': s}) for s in (.05, .10, .15, .20, .25)]
         + [(f'tp{int(t*100)}', {'tp': t}) for t in (.05, .10, .20, .30)]
         + [(f'sl{int(s*100)}_tp{int(t*100)}', {'sl': s, 'tp': t}) for s in (.05, .10) for t in (.10, .20, .30)]
         + [(f'atr{k:g}_tp{int(t*100)}', {'atr': k, 'tp': t}) for k in (2, 3) for t in (.10, .20, .30)])
RN = [r[0] for r in RULES]

def run_rules(W, atrp):
    R = np.empty((len(W[0]), len(RULES)), np.float32); D = np.empty_like(R, dtype=np.int16)
    for j, (name, p) in enumerate(RULES):
        if 'trail' in p: r, d = exit_trail(W, p['trail'])
        else:
            sl = np.minimum(p['atr'] * atrp, .95) if 'atr' in p else p.get('sl')
            r, d = exit_fixed(W, sl, p.get('tp'), p.get('hold', H))
        R[:, j] = r; D[:, j] = d
    return R, D

DAILY_STOPS = [None, .02, .03, .04, .05, .07]
DCOLS = ['stopNone', 'stop2', 'stop3', 'stop4', 'stop5', 'stop7', 'overnight', 'intraday', 'closeclose', 'spyIntraday', 'spyOvernight']

def main():
    t0 = time.time()
    src = 'invest-api /universe/sp500'
    try:
        uni = json.load(open(os.path.join(CACHE, '_sp500.json')))['items']
        meta = {x['symbol'].replace('.', '-'): SECTOR_NORM.get(x['sector'], x['sector']) for x in uni}
    except Exception as e:
        src = 'invest-api/config.json (fallback)'; meta = {}
    syms = list(dict.fromkeys(list(meta) + EXTRA + ETFS))
    spy = bars('SPY').set_index('t')
    S, SW, TR, DY = [], [], [], []  # מטא-נתונים לנייר, גלים, עסקאות, ימים
    bad = []
    for k, s in enumerate(syms):
        try: df = bars(s)
        except Exception: bad.append(s); continue
        if len(df) < 400: bad.append(s); continue
        sid = len(S)
        sec = 'ETF' if s in ETFS else meta.get(s, 'Meir/other (לא ב-S&P)')
        if s in SEMIS or 'Semiconductor' in sec: semis = True
        else: semis = False
        S.append({'sym': s, 'sector': sec, 'semis': semis, 'meir': s in EXTRA, 'etf': s in ETFS, 'start': str(df.t.iloc[0].date())})
        o, h, l, c = (df[x].values.astype(float) for x in 'ohlc')
        yrs = df.t.dt.year.values; per = period_of(yrs)
        lr = np.r_[np.nan, np.diff(np.log(c))]
        vol = pd.Series(lr).rolling(63, min_periods=40).std().values * math.sqrt(252)
        vb = vol_bucket(np.nan_to_num(vol, nan=.3))
        cp = np.r_[np.nan, c[:-1]]
        trr = np.nanmax(np.vstack([h - l, np.abs(h - cp), np.abs(l - cp)]), 0)
        atrp = pd.Series(trr).rolling(14).mean().values / c
        al = spy.reindex(df.t).ffill(); sc, so = al.c.values, al.o.values
        # גלים
        for rr in (.05, .10, .20):
            for rise, d, li, ei_ in zigzag_upswings(c, rr):
                # מימוש בפועל: קנייה בסגירה הראשונה שבה העלייה מהשפל >= X%, מכירה בסגירה שאישרה את הנסיגה
                real = []
                for lv in LVS:
                    if rise < lv: real.append(np.nan); continue
                    j = li + int(np.argmax(c[li:ei_ + 1] >= c[li] * (1 + lv) - 1e-12))
                    real.append(c[ei_] / c[j] - 1 - COST)
                SW.append((sid, rr, rise, d, per[li], vb[li], *real))
        # כניסות
        ret = np.r_[np.nan, c[1:] / c[:-1] - 1]; offhi = c / h - 1
        hi20 = pd.Series(h).shift(1).rolling(20).max().values
        allidx = np.arange(70, len(df) - H - 1)
        rng = np.random.default_rng(zlib.crc32(s.encode()))
        entries = {'random': np.sort(rng.choice(allidx, size=min(len(allidx), 120), replace=False)),
                   'dip5': allidx[ret[allidx] <= -0.05],
                   'up3_offhigh3': allidx[(ret[allidx] >= 0.03) & (offhi[allidx] <= -0.03)],
                   'breakout20': allidx[c[allidx] > hi20[allidx]]}
        for ei, (en, idx) in enumerate(entries.items()):
            if not len(idx): continue
            rg = idx[:, None] + np.arange(1, H + 1)[None, :]; base = c[idx][:, None]
            W = (o[rg] / base, h[rg] / base, l[rg] / base, c[rg] / base)
            R, D = run_rules(W, atrp[idx])
            spr = sc[rg] / sc[idx][:, None]
            X = R - (np.take_along_axis(spr, D.astype(np.int64) - 1, 1) - 1).astype(np.float32)
            TR.append((np.full(len(idx), sid, np.int32), np.full(len(idx), ei, np.int8), per[idx], vb[idx], yrs[idx].astype(np.int16), R, D, X))
        # יום מסחר אחד: קנייה בפתיחה, מכירה בסגירה, סטופ x% מהפתיחה (מילוי בדיוק ברמה — אופטימי מעט)
        i = np.arange(71, len(df))
        cols = []
        for x in DAILY_STOPS:
            rv = c[i] / o[i] - 1
            if x: rv = np.where(l[i] <= o[i] * (1 - x), -x, rv)
            cols.append(rv - COST)
        cols += [o[i] / c[i - 1] - 1, c[i] / o[i] - 1, c[i] / c[i - 1] - 1, sc[i] / so[i] - 1, so[i] / sc[i - 1] - 1]
        DY.append((np.full(len(i), sid, np.int32), per[i], vb[i - 1], np.vstack(cols).T.astype(np.float32)))
        if k % 50 == 0: print(k, s, f'{time.time()-t0:.0f}s', flush=True)
    St = pd.DataFrame(S)
    print('loaded', len(St), 'bad', bad, f'{time.time()-t0:.0f}s', flush=True)
    R = analyze(St, SW, TR, DY, entries_names=list(entries))
    R['meta'] = {'n_symbols': int((~St.etf).sum()), 'etfs': ETFS, 'bad': bad, 'universe_source': src, 'cost_roundtrip': COST, 'holdMax': H,
                 'first_date': min(St.start), 'periods': PERIODS, 'survivorship': 'current S&P 500 constituents (as of the API date) + Meir names; delisted/removed stocks are absent',
                 'segments_note': 'vol buckets use trailing 63-day realized vol at entry; sectors normalized to GICS names'}
    json.dump(R, open(os.path.join(HERE, 'results.json'), 'w'), indent=0, ensure_ascii=False)
    write_md(R); print('done', f'{time.time()-t0:.0f}s')

def seg_masks(St, sid, vb):
    """שם סגמנט → מסכה בוליאנית על השורות (sid = נייר לכל שורה, vb = דלי תנודתיות לכל שורה)."""
    m = {}
    etf = St.etf.values[sid]; sec = St.sector.values[sid]
    m['ALL'] = ~etf
    for g in sorted(set(St.sector) - {'ETF'}): m[g] = sec == g
    m['Semis'] = St.semis.values[sid] & ~etf
    m['MeirNames'] = St.meir.values[sid]
    for b, name in enumerate(VB): m[name] = (vb == b) & ~etf
    for e in ETFS:
        if e in set(St.sym): m[e] = St.sym.values[sid] == e
    return m

def pmask(per, pk): return np.ones(len(per), bool) if pk == 'ALL' else per == list(PERIODS).index(pk)

def analyze(St, SW, TR, DY, entries_names):
    out = {'swings': {}, 'continuation': {}, 'rules': {}, 'rules_yearly': {}, 'daily': {}}
    # ---- גלים ----
    sw = pd.DataFrame(SW, columns=['sid', 'rr', 'rise', 'days', 'per', 'vb'] + [f'real{int(lv*100)}' for lv in LVS])
    M = seg_masks(St, sw.sid.values, sw.vb.values)
    for g, mg in M.items():
        for pk in PER_KEYS:
            for rr in (.05, .10, .20):
                mm = mg & pmask(sw.per.values, pk) & (sw.rr.values == rr)
                a = sw.rise.values[mm]; d = sw.days.values[mm]; sub = sw[mm]
                if len(a) < 30: continue
                out['swings'][f'{g}|{pk}|{int(rr*100)}'] = {'n': int(len(a)), 'mean': float(a.mean()), 'median': float(np.median(a)), 'p25': float(np.percentile(a, 25)),
                                                            'p75': float(np.percentile(a, 75)), 'p90': float(np.percentile(a, 90)), 'days_median': float(np.median(d))}
                if rr != .10: continue
                cont = {}
                for lv in LVS:
                    x = a[a >= lv]
                    if len(x) < 30: continue
                    rem = (1 + x) / (1 + lv) - 1
                    realized = sub[f'real{int(lv*100)}'].values[a >= lv]  # קנייה בסגירה הראשונה ב-X%+, מכירה בסגירת הנסיגה
                    cont[str(int(lv * 100))] = {'n': int(len(x)), 'p_more10': float((rem >= .10).mean()), 'remain_median': float(np.median(rem)),
                                                'remain_mean': float(rem.mean()), 'realized_mean': float(realized.mean()), 'realized_win': float((realized > 0).mean())}
                out['continuation'][f'{g}|{pk}'] = cont
    # ---- כללי יציאה ----
    sid = np.concatenate([t[0] for t in TR]); ent = np.concatenate([t[1] for t in TR]); per = np.concatenate([t[2] for t in TR])
    vb = np.concatenate([t[3] for t in TR]); yr = np.concatenate([t[4] for t in TR])
    Rm = np.concatenate([t[5] for t in TR]); Dm = np.concatenate([t[6] for t in TR]); Xm = np.concatenate([t[7] for t in TR])
    del TR
    M = seg_masks(St, sid, vb)
    for ei, en in enumerate(entries_names):
        me = ent == ei
        for g, mg in M.items():
            for pk in PER_KEYS:
                mm = me & mg & pmask(per, pk)
                n = int(mm.sum())
                if n < 200: continue
                r = Rm[mm].astype(float); d = Dm[mm].astype(float); x = Xm[mm].astype(float)
                mean = r.mean(0); dmean = d.mean(0)
                for j, rn in enumerate(RN):
                    out['rules'][f'{g}|{en}|{pk}|{rn}'] = {'n': n, 'mean': float(mean[j]), 'median': float(np.median(r[:, j])), 'win': float((r[:, j] > 0).mean()),
                        'days': float(dmean[j]), 'perDay': float(mean[j] / dmean[j]), 'p10': float(np.percentile(r[:, j], 10)),
                        'se': float(r[:, j].std() / math.sqrt(n)), 'excess': float(x[:, j].mean()), 'excess_win': float((x[:, j] > 0).mean())}
        # שנה-שנה (ALL + כמה סגמנטים): כמה שנים כל כלל עקף "החזקה 60"
        for g in ['ALL', 'Semis', 'MeirNames', 'vol>60%', 'vol<25%', 'Information Technology']:
            if g not in M: continue
            ys = {}
            for y in sorted(set(yr[me & M[g]].tolist())):
                mm = me & M[g] & (yr == y)
                if mm.sum() < 100: continue
                ys[str(y)] = {'n': int(mm.sum()), **{rn: float(v) for rn, v in zip(RN, Rm[mm].astype(float).mean(0))}}
            out['rules_yearly'][f'{g}|{en}'] = ys
    del Rm, Dm, Xm
    # ---- יומי ----
    sid = np.concatenate([t[0] for t in DY]); per = np.concatenate([t[1] for t in DY]); vb = np.concatenate([t[2] for t in DY])
    V = np.concatenate([t[3] for t in DY]).astype(float)
    M = seg_masks(St, sid, vb)
    for g, mg in M.items():
        for pk in PER_KEYS:
            mm = mg & pmask(per, pk)
            n = int(mm.sum())
            if n < 1000: continue
            v = V[mm]; mean = np.nanmean(v, 0); sd = np.nanstd(v, 0)
            rec = {c: float(mean[j]) for j, c in enumerate(DCOLS)}
            rec.update({c + '_se': float(sd[j] / math.sqrt(n)) for j, c in enumerate(DCOLS)})
            rec['stop4_hit'] = float((v[:, DCOLS.index('stop4')] <= -.04 - COST + 1e-7).mean())
            rec['intraday_excess'] = float(np.nanmean(v[:, DCOLS.index('intraday')] - v[:, DCOLS.index('spyIntraday')]))
            rec['overnight_excess'] = float(np.nanmean(v[:, DCOLS.index('overnight')] - v[:, DCOLS.index('spyOvernight')]))
            rec['n_days'] = n
            out['daily'][f'{g}|{pk}'] = rec
    return out

# ---------- summary.md ----------
def pct(x, d=1): return '—' if x is None else f'{x*100:+.{d}f}%'
KEY_SEGS = ['ALL', 'Information Technology', 'Semis', 'MeirNames', 'vol<25%', 'vol25-40%', 'vol40-60%', 'vol>60%']
SHOW_RULES = ['hold60', 'hold20', 'hold5', 'sl2', 'sl3', 'sl4', 'sl5', 'sl7', 'sl10', 'sl15', 'sl20', 'atr1', 'atr1.5', 'atr2', 'atr3', 'atr4',
              'trail5', 'trail10', 'trail15', 'trail20', 'trail25', 'tp5', 'tp10', 'tp20', 'tp30', 'sl10_tp30', 'atr3_tp30', 'atr3_tp20', 'sl5_tp10']

def write_md(R):
    m = R['meta']; L = []
    L.append(f"# מחקר גלים וסטופים v2 — {m['n_symbols']} מניות + {len(m['etfs'])} ETF, מ-{m['first_date']}, עלות {m['cost_roundtrip']*100:.1f}% לסבב\n")
    L.append(f"מקור היקום: {m['universe_source']}. **הטיית שורדים:** {m['survivorship']} (ראה CONCLUSIONS.md). תתי-תקופות לפי תאריך הכניסה/השפל. "
             "\"עודף\" = תשואת העסקה (אחרי עלות) פחות תשואת SPY מסגירת יום הכניסה עד סגירת יום היציאה. דלי תנודתיות = תנודתיות 63 יום בזמן הכניסה. "
             "עסקאות חופפות בזמן (אותה מניה/אותם ימים) — טעות התקן (se) מוערכת בחסר; היציבות בין התקופות חשובה ממנה.\n")
    L.append('## 0. הטיית שורדים — כיוון ההטיה לכל מסקנה\n')
    L.append('- היקום הוא רכיבי S&P 500 **הנוכחיים** + המניות של מאיר (שנבחרו כי הצליחו). מניות שנפלו מהמדד/נמחקו ב-10 השנים חסרות.')
    L.append('- **תשואות ממוצעות והחזקה ארוכה (hold60) — מוטות כלפי מעלה.** המניות החסרות הן בעיקר אלה שירדו ולא חזרו.')
    L.append('- **סטופים — ההטיה לטובת "בלי סטופ".** אצל השורדים כל ירידה חזרה בסוף; אצל מניות שקרסו הסטופ היה חוסך. לכן "סטופ רחב/ATR עדיף על צמוד" אמין יותר מ-"סטופ לא משתלם בכלל".')
    L.append('- **כניסות "קנייה בירידה" (dip5, up3_offhigh3) — מוטות חזק כלפי מעלה:** מניה שירדה 5% ביום ושרדה עד היום היא מראש מקרה של התאוששות.')
    L.append('- **"כמה נשאר אחרי X%" / מעקב מגמה — מוטה כלפי מעלה** (מניות שעלו נכנסו למדד; חלק מהן נכנסו בזכות העליות האלה).')
    L.append('- **יומי: לילה מול יום — הטיה קטנה בהשוואה.** ההטיה מעלה את שניהם; היחס ביניהם (רוב התשואה בלילה) עקבי בכל 3 התקופות וגם ב-SPY/QQQ, שאין להם הטיית שורדים.')
    L.append('- MeirNames ודלי vol>60% מוטים הכי הרבה (בחירה בדיעבד) — ההבדלים *בין כללים* בתוכם שימושיים, הרמה המוחלטת לא.\n')
    L.append('שינויים מול v1: (1) ב-v1 עסקה שפגעה ביעד ואחר כך בסטופ נרשמה כסטופ — תוקן (משפר כללי סטופ+יעד); (2) "מימוש" בטבלה 2 לפי סגירות אמיתיות ולא לפי רמות מדויקות; (3) דלי תנודתיות בזמן הכניסה; (4) seed קבוע.\n')
    # 1 swings
    L.append('## 1. גלים: עלייה משפל עד שיא (נסיגה = ירידה של 10% מהשיא, בסגירות)\n')
    L.append('| סגמנט | ' + ' | '.join(f'{p}: גלים / חציון / 90%' for p in PER_KEYS) + ' | ימים (חציון, הכול) |\n|---|' + '---|' * (len(PER_KEYS) + 1))
    segs = sorted({k.split('|')[0] for k in R['swings']}, key=lambda g: (g not in KEY_SEGS, KEY_SEGS.index(g) if g in KEY_SEGS else 0, g))
    for g in segs:
        cells = []
        for pk in PER_KEYS:
            s = R['swings'].get(f'{g}|{pk}|10'); cells.append(f"{s['n']} / {pct(s['median'],0)} / {pct(s['p90'],0)}" if s else '—')
        s = R['swings'].get(f'{g}|ALL|10')
        L.append(f"| {g} | " + ' | '.join(cells) + f" | {s['days_median']:.0f} |" if s else '')
    for rr in (5, 20):
        cells = []
        for pk in PER_KEYS:
            s = R['swings'].get(f'ALL|{pk}|{rr}'); cells.append(f"{pk}: חציון {pct(s['median'],0)}, 90% {pct(s['p90'],0)}" if s else '')
        L.append(f"\n**ALL, נסיגה {rr}%:** " + '; '.join(cells))
    # 2 continuation
    L.append('\n## 2. "אחרי שעלתה X% מהשפל — כמה עוד נשאר?" (נסיגה 10%)\n')
    L.append('"מימוש" = קונים בסגירה הראשונה שבה העלייה מהשפל ≥X% ומוכרים בסגירה שבה המניה ירדה 10% מהשיא (אחרי עלות). כלומר זו אסטרטגיית מעקב-מגמה שאפשר לבצע בזמן אמת, לא "נבואה". השוואה הוגנת: trail10 על כניסה אקראית בטבלה 3.\n')
    L.append('| סגמנט | תקופה | עלתה | גלים | סיכוי לעוד +10% | חציון ההמשך | ממוצע ההמשך | ממוצע מימוש | מימוש חיובי |\n|---|---|---|---|---|---|---|---|---|')
    for g in ['ALL', 'Information Technology', 'Semis', 'MeirNames', 'vol>60%', 'vol<25%']:
        for pk in PER_KEYS:
            for lv, c in R['continuation'].get(f'{g}|{pk}', {}).items():
                if lv in ('10', '20', '30', '50', '100'):
                    L.append(f"| {g} | {pk} | {lv}% | {c['n']} | {c['p_more10']*100:.0f}% | {pct(c['remain_median'],0)} | {pct(c['remain_mean'],0)} | {pct(c['realized_mean'],1)} | {c['realized_win']*100:.0f}% |")
    # 3 rules
    for en in ('random', 'dip5', 'up3_offhigh3', 'breakout20'):
        L.append(f'\n## 3.{en}. כללי יציאה — כניסה: {en} (בסגירה, עד 60 ימי מסחר, אחרי עלות)\n')
        for g in KEY_SEGS:
            if f'{g}|{en}|ALL|hold60' not in R['rules']: continue
            n = R['rules'][f'{g}|{en}|ALL|hold60']['n']
            L.append(f'\n**{g}** (עסקאות: {n}) — ממוצע לעסקה / עודף מול SPY, לפי תקופה; ימים, 10% הגרועות והצלחות — לכל התקופה\n')
            L.append('| כלל | ' + ' | '.join(f'{p} ממוצע' for p in PER_KEYS) + ' | ' + ' | '.join(f'{p} עודף' for p in PER_KEYS) + ' | ימים | 10% גרועות | הצלחות | לכל יום |\n|---|' + '---|' * (2 * len(PER_KEYS) + 4))
            best = {pk: max((rn for rn in RN if f'{g}|{en}|{pk}|{rn}' in R['rules']), key=lambda rn: R['rules'][f'{g}|{en}|{pk}|{rn}']['mean'], default=None) for pk in PER_KEYS}
            for rn in SHOW_RULES:
                a = R['rules'].get(f'{g}|{en}|ALL|{rn}')
                if not a: continue
                mc = [(pct(R['rules'][f'{g}|{en}|{pk}|{rn}']['mean'], 2) + (' ⭐' if best[pk] == rn else '')) if f'{g}|{en}|{pk}|{rn}' in R['rules'] else '—' for pk in PER_KEYS]
                xc = [pct(R['rules'][f'{g}|{en}|{pk}|{rn}']['excess'], 2) if f'{g}|{en}|{pk}|{rn}' in R['rules'] else '—' for pk in PER_KEYS]
                L.append(f"| {rn} | " + ' | '.join(mc) + ' | ' + ' | '.join(xc) + f" | {a['days']:.0f} | {pct(a['p10'],1)} | {a['win']*100:.0f}% | {pct(a['perDay'],3)} |")
            bb = [f'{pk}: {best[pk]}' for pk in PER_KEYS if best[pk]]
            L.append('\nהטוב ביותר בממוצע (מכל ' + str(len(RN)) + ' הכללים): ' + '; '.join(bb))
    # 3b sector table
    L.append('\n## 3.sectors. כניסה אקראית — לפי סקטור: hold60 מול הסטופ הטוב, לפי תקופה\n')
    L.append('| סגמנט | ' + ' | '.join(f'{p}: hold60 / sl7 / atr3 / trail15 / הטוב' for p in PER_KEYS) + ' |\n|---|' + '---|' * len(PER_KEYS))
    for g in sorted({k.split('|')[0] for k in R['rules']}):
        cells = []
        for pk in PER_KEYS:
            if f'{g}|random|{pk}|hold60' not in R['rules']: cells.append('—'); continue
            q = lambda rn: R['rules'][f'{g}|random|{pk}|{rn}']['mean']
            b = max(RN, key=q)
            cells.append(f"{pct(q('hold60'),1)} / {pct(q('sl7'),1)} / {pct(q('atr3'),1)} / {pct(q('trail15'),1)} / {b} {pct(q(b),1)}")
        L.append(f'| {g} | ' + ' | '.join(cells) + ' |')
    # 3c yearly
    L.append('\n## 3.yearly. כמה שנים (מתוך כל השנים) כל כלל עקף את hold60 — כניסה אקראית\n')
    cmp = ['sl4', 'sl7', 'sl10', 'sl20', 'atr2', 'atr3', 'atr4', 'trail10', 'trail15', 'trail25', 'tp10', 'tp20', 'tp30', 'hold20']
    L.append('| סגמנט | ' + ' | '.join(cmp) + ' |\n|---|' + '---|' * len(cmp))
    for key, ys in R['rules_yearly'].items():
        if not key.endswith('|random') or not ys: continue
        L.append(f"| {key.split('|')[0]} | " + ' | '.join(f"{sum(1 for v in ys.values() if v[c] > v['hold60'])}/{len(ys)}" for c in cmp) + ' |')
    # 4 daily
    L.append('\n## 4. השיטה היומית: קנייה בפתיחה, מכירה בסגירה (ממוצע ליום-מניה, אחרי עלות 0.1%)\n')
    L.append('"לילה" = סגירה→פתיחה, "יום" = פתיחה→סגירה, "החזקה" = סגירה→סגירה (שלושתם בלי עלות). עודף = מול SPY באותו חלון. סטופ ממולא בדיוק ברמה (אופטימי מעט).\n')
    L.append('| סגמנט | תקופה | ימים | בלי סטופ | סטופ 2% | 3% | 4% | 5% | 7% | % ימים שסטופ 4% נפגע | לילה | יום | החזקה | עודף לילה | עודף יום |\n|---|' + '---|' * 15)
    for g in sorted({k.split('|')[0] for k in R['daily']}, key=lambda g: (g not in KEY_SEGS, KEY_SEGS.index(g) if g in KEY_SEGS else 0, g)):
        for pk in PER_KEYS:
            v = R['daily'].get(f'{g}|{pk}')
            if not v: continue
            L.append(f"| {g} | {pk} | {v['n_days']} | {pct(v['stopNone'],3)} | {pct(v['stop2'],3)} | {pct(v['stop3'],3)} | {pct(v['stop4'],3)} | {pct(v['stop5'],3)} | {pct(v['stop7'],3)} | {v['stop4_hit']*100:.1f}% | {pct(v['overnight'],3)} | {pct(v['intraday'],3)} | {pct(v['closeclose'],3)} | {pct(v['overnight_excess'],3)} | {pct(v['intraday_excess'],3)} |")
    open(os.path.join(HERE, 'summary.md'), 'w').write('\n'.join(x for x in L if x is not None) + '\n')

if __name__ == '__main__':
    main()
