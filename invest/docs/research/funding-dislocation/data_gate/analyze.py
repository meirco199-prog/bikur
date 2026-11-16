#!/usr/bin/env python3
"""שלב 2 — חסם עליון לכדאיות לפי FEASIBILITY_PROTOCOL.md (נעול). רק מימון שמומש; בלי מחירים, בלי החלקה — זה לא Backtest.
שימוש: analyze.py DATA_DIR PAIRS_JSON OUT_JSON OUT_MD"""
import json, sys, os, glob, math, collections, statistics as st
D, P, OJ, OM = sys.argv[1:5]
H = 3600000
ENTER, EXIT, WIN, MINH = 0.30, 0.10, 72, 60
FEE_RT = 0.0019
PERIODS = [('2023–2024', '2023-01-01', '2025-01-01'), ('2025', '2025-01-01', '2026-01-01'), ('2026 (עד 31/10)', '2026-01-01', '2026-11-01')]
import datetime as dt
def hb(s): return int(dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc).timestamp() * 1000) // H
pairs = json.load(open(P))
logs = {}
for f in glob.glob(f'{D}/log-*.json'):
    for r in json.load(open(f)): logs[r['hl']] = r
cov, series = [], {}
for p in pairs:
    fh, fb = f"{D}/hl/{p['hl']}.csv", f"{D}/bn/{p['bn']}.csv"
    if not (os.path.exists(fh) and os.path.exists(fb)): continue
    Hh = {}
    for line in open(fh):
        t, r = line.strip().split(','); Hh[round(int(t) / H)] = float(r)
    Bh, sett = {}, []
    for line in open(fb):
        t, iv, r = line.strip().split(',')
        T = round(int(t) / H); ivh = int(float(iv)) if iv not in ('', 'None') else 8
        sett.append(T)
        for k in range(ivh): Bh[T - k] = float(r) / ivh
    hrs = sorted(set(Hh) & set(Bh))
    s = {h: (Bh[h] - Hh[h]) * 8760 for h in hrs}
    series[p['hl']] = (s, sorted(set(sett)))
    yrs = collections.Counter(dt.datetime.utcfromtimestamp(h * 3600).year for h in hrs)
    cov.append({'hl': p['hl'], 'bn': p['bn'], 'delisted_hl': p['delisted'], 'hl_first': dt.datetime.utcfromtimestamp(min(Hh) * 3600).strftime('%Y-%m-%d') if Hh else None,
                'bn_first': dt.datetime.utcfromtimestamp(min(Bh) * 3600).strftime('%Y-%m-%d') if Bh else None, 'overlap_hours': len(hrs), 'by_year': dict(yrs),
                'bn_intervals': sorted({int(float(l.split(',')[1])) for l in open(fb) if l.split(',')[1] not in ('', 'None')}), 'log': logs.get(p['hl'])})
# --- מכונת מצבים לכל זוג ---
trades, cap = [], collections.defaultdict(dict)   # cap[hour][coin] = captured annualized spread
uncond = collections.defaultdict(dict)
for coin, (s, sett) in series.items():
    pos, ent = 0, None
    for T in sett:
        w = [s[h] for h in range(T - WIN + 1, T + 1) if h in s]
        nxt = sett[sett.index(T) + 1] if False else None
        if len(w) < MINH: m = None
        else: m = sum(w) / len(w)
        if pos and (m is None or abs(m) < EXIT or (m > 0) != (pos > 0)):
            trades[-1].update(exit=T); pos = 0
        if not pos and m is not None and abs(m) > ENTER:
            pos = 1 if m > 0 else -1; trades.append({'coin': coin, 'dir': pos, 'entry': T, 'm_entry': m, 'exit': None})
        if m is not None: uncond[T][coin] = (1 if m > 0 else -1)
    # שעות בפוזיציה
for tr in trades:
    s = series[tr['coin']][0]; end = tr['exit'] or max(s)
    vals = []
    for h in range(tr['entry'] + 1, end + 1):
        if h in s: cap[h][tr['coin']] = tr['dir'] * s[h]; vals.append(tr['dir'] * s[h])
    tr['hours'] = end - tr['entry']; tr['captured_mean'] = (sum(vals) / len(vals)) if vals else 0.0
# --- תיק: חלוקה שווה בין העסקאות הפתוחות ---
def run(L, pstart, pend):
    hrs = range(pstart, pend); tot = 0.0; fees = 0.0; inv = 0; nopen = []
    entries = collections.defaultdict(list); exits = collections.defaultdict(list)
    for tr in trades:
        if pstart <= tr['entry'] < pend: entries[tr['entry']].append(tr)
        if tr['exit'] and pstart <= tr['exit'] < pend: exits[tr['exit']].append(tr)
    for h in hrs:
        c = cap.get(h, {})
        if c:
            inv += 1; nopen.append(len(c)); tot += (L / 2) * (sum(c.values()) / len(c)) / 8760
        n = max(1, len(cap.get(h + 1, {})) or len(c))
        for tr in entries.get(h, []) + exits.get(h, []):
            fees += (FEE_RT / 2) * (25000 * L / n) / 50000
    yrs = len(hrs) / 8760
    return {'gross_ann': tot / yrs, 'fees_ann': fees / yrs, 'net_ann': (tot - fees) / yrs, 'invested_share': inv / len(hrs), 'avg_open': (sum(nopen) / len(nopen)) if nopen else 0}
# --- ביקורת (16/11, אחרי הערת ChatGPT): run() המקורי נשמר כמו שהוא כדי לשחזר את התוצאה הנעולה. כאן — אותו מודל בדיוק, עם תיקון
# שתי שגיאות חשבונאיות מוכחות בלבד, ובנפרד — עלות האיזון שהמודל מניח (משקל 1/n בכל שעה) אבל לא חייב:
#  (1) עמלת יציאה חושבה לפי מספר הפוזיציות *אחרי* היציאה (cap[h+1]) — הפוזיציה היוצאת הייתה בגודל 1/len(cap[h]).
#  (2) עסקאות שלא יצאו (מטבע שנמחק / סוף הנתונים) לא חויבו בעמלת יציאה.
#  (3) איזון: מעבר ממשקל 1/n_h ל-1/n_{h+1} בכל פוזיציה שנשארת = מסחר בשתי הרגליים; מחויב באותה עמלת לוקח (0.0475% לביצוע).
def run_fixed(L, pstart, pend):
    hrs = range(pstart, pend); tot = 0.0; fees = 0.0; reb = 0.0; gap_hours = 0
    entries = collections.defaultdict(list); exits = collections.defaultdict(list)
    for tr in trades:
        if pstart <= tr['entry'] < pend: entries[tr['entry']].append(tr)
        last = tr['exit'] if tr['exit'] else max(series[tr['coin']][0])
        if pstart <= last < pend: exits[last].append(tr)
    for h in hrs:
        c = cap.get(h, {}); c1 = cap.get(h + 1, {})
        if c: tot += (L / 2) * (sum(c.values()) / len(c)) / 8760
        for tr in entries.get(h, []):
            fees += (FEE_RT / 2) * (25000 * L / max(1, len(c1))) / 50000
        for tr in exits.get(h, []):
            fees += (FEE_RT / 2) * (25000 * L / max(1, len(c))) / 50000
        if c and c1:
            stay = set(c) & set(c1)
            d = abs(1 / len(c1) - 1 / len(c)) * 25000 * L
            reb += len(stay) * (FEE_RT / 2) * d / 50000
    yrs = len(hrs) / 8760
    return {'gross_ann': tot / yrs, 'fees_ann': fees / yrs, 'net_ann': (tot - fees) / yrs, 'rebalance_ann': reb / yrs, 'net_incl_rebalance_ann': (tot - fees - reb) / yrs}
def gap_stats(pstart, pend):
    # שעות שבהן עסקה פתוחה אבל אין פער מימון לאותה שעה (חוסר נתונים) — ההון שלה מחולק בשקט בין האחרות
    miss = tot = 0
    for tr in trades:
        s = series[tr['coin']][0]; end = tr['exit'] or max(s)
        for h in range(max(tr['entry'] + 1, pstart), min(end + 1, pend)):
            tot += 1; miss += (h not in s)
    return {'position_hours': tot, 'missing_hours': miss}
def uncond_run(pstart, pend, L=2):
    # בלי סינון: בכל המטבעות, תמיד בפנים בכיוון האות האחרון (גולמי, בלי עמלות)
    last, tot, hrs = {}, 0.0, 0
    setts = sorted(T for T in uncond if pstart - 24 <= T < pend)
    si = 0
    for h in range(pstart, pend):
        while si < len(setts) and setts[si] < h: last.update(uncond[setts[si]]); si += 1
        v = [d * series[c][0][h] for c, d in last.items() if h in series[c][0]]
        if v: tot += (L / 2) * (sum(v) / len(v)) / 8760; hrs += 1
    return tot / ((pend - pstart) / 8760)
res = {'coverage': cov, 'n_pairs_with_data': len(series), 'periods': {}}
for name, a, b in PERIODS:
    pa, pb = hb(a), hb(b)
    T = [t for t in trades if pa <= t['entry'] < pb]
    by_coin = collections.Counter()
    for h in range(pa, pb):
        c = cap.get(h, {})
        for k, v in c.items(): by_coin[k] += v / len(c)
    totc = sum(by_coin.values()) or 1
    top = by_coin.most_common(5)
    res['periods'][name] = {
        'pairs_with_data': sum(1 for c, (s, _) in series.items() if any(pa <= h < pb for h in (min(s), max(s))) or (min(s) < pa and max(s) >= pb)),
        'trades': len(T), 'coins_traded': len({t['coin'] for t in T}),
        'median_hold_days': round(st.median([t['hours'] for t in T]) / 24, 1) if T else None,
        'median_entry_spread': round(st.median([abs(t['m_entry']) for t in T]), 3) if T else None,
        'median_captured_spread': round(st.median([t['captured_mean'] for t in T]), 3) if T else None,
        'share_trades_captured_negative': round(sum(1 for t in T if t['captured_mean'] < 0) / len(T), 3) if T else None,
        'L1': run(1, pa, pb), 'L2': run(2, pa, pb), 'L3': run(3, pa, pb),
        'unfiltered_L2_gross': uncond_run(pa, pb),
        'audit': {'L1': run_fixed(1, pa, pb), 'L2': run_fixed(2, pa, pb), 'L3': run_fixed(3, pa, pb), 'gaps': gap_stats(pa, pb), 'open_at_end_trades': sum(1 for t in T if not t['exit'])},
        'top5_coins_share': [(k, round(v / totc, 3)) for k, v in top],
    }
json.dump(res, open(OJ, 'w'), ensure_ascii=False, indent=1, default=str)
L = ['# שלב 2 — אומדן מימון חלקי (מימון שמומש ועמלות בסיס בלבד; לא חסם עליון ולא Backtest)', '', f"זוגות עם נתונים: {len(series)}", '',
     '| תקופה | עסקאות | מטבעות | החזקה חציונית (ימים) | פער בכניסה (חציון) | פער שנאסף בפועל (חציון) | עסקאות עם פער שלילי | זמן מושקע | L=1 נטו | **L=2 נטו** | L=3 נטו | בלי סינון L=2 (ברוטו) | 5 המטבעות המובילים |',
     '|---|---|---|---|---|---|---|---|---|---|---|---|---|']
pc = lambda x: f'{100*x:.1f}%' if x is not None else '—'
for name, r in res['periods'].items():
    L.append(f"| {name} | {r['trades']} | {r['coins_traded']} | {r['median_hold_days']} | {pc(r['median_entry_spread'])} | {pc(r['median_captured_spread'])} | {pc(r['share_trades_captured_negative'])} | {pc(r['L2']['invested_share'])} | {pc(r['L1']['net_ann'])} | **{pc(r['L2']['net_ann'])}** (ברוטו {pc(r['L2']['gross_ann'])}) | {pc(r['L3']['net_ann'])} | {pc(r['unfiltered_L2_gross'])} | " + ', '.join(f'{k} {pc(v)}' for k, v in r['top5_coins_share']) + ' |')
L += ['', '## ביקורת חשבונאית (16/11) — אותו מודל, אחרי תיקון שגיאות מוכחות', '',
      '| תקופה | L=2 נטו כפי שננעל | L=2 נטו אחרי תיקון עמלות (1)+(2) | עלות איזון שלא חויבה (3) | L=2 נטו כולל איזון | עסקאות בלי יציאה | שעות פוזיציה בלי נתון |',
      '|---|---|---|---|---|---|---|']
for name, r in res['periods'].items():
    a = r['audit']; g = a['gaps']
    L.append(f"| {name} | {pc(r['L2']['net_ann'])} | {pc(a['L2']['net_ann'])} | {pc(a['L2']['rebalance_ann'])} | {pc(a['L2']['net_incl_rebalance_ann'])} | {a['open_at_end_trades']} | {g['missing_hours']} / {g['position_hours']} |")
open(OM, 'w').write('\n'.join(L) + '\n')
print('\n'.join(L))
