#!/usr/bin/env python3
"""שער נתונים — Dual-Momentum Sector Rotation (PROTOCOL_v1.0.md). בדיקת נתונים בלבד: אין אותות, אין סימולציה.
שימוש: probe.py RAW_DIR OUT_DIR   (בלי תלויות חיצוניות)"""
import json, sys, os, time, urllib.request, urllib.error, datetime as dt

SECT = ['XLK', 'XLV', 'XLF', 'XLE', 'XLI', 'XLP', 'XLY', 'XLU', 'XLB']
ALL = SECT + ['SPY', 'BIL']
UA = {'User-Agent': 'Mozilla/5.0 (bikur-research)'}
P1 = 912470400  # 1998-12-01
D = lambda ts: dt.datetime.fromtimestamp(ts, dt.timezone.utc).date()
JUMP = 0.15


def get(u, tries=3, timeout=90):
    err = None
    for k in range(tries):
        t0 = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=timeout) as r:
                return r.status, r.read(), round(time.time() - t0, 1)
        except urllib.error.HTTPError as e:
            err = (e.code, e.read()[:200], round(time.time() - t0, 1))
            if e.code in (429, 500, 502, 503): time.sleep(10 * (k + 1)); continue
            return err
        except Exception as e:
            err = (None, str(e)[:200].encode(), round(time.time() - t0, 1)); time.sleep(5 * (k + 1))
    return err


def fetch(raw):
    os.makedirs(raw, exist_ok=True)
    p2 = int(time.time())
    for s in ALL + ['^IRX']:
        st, b, sec = get(f'https://query1.finance.yahoo.com/v8/finance/chart/{s.replace("^", "%5E")}?period1={P1}&period2={p2}&interval=1d&events=div,splits&includeAdjustedClose=true')
        open(f'{raw}/{s.replace("^", "_")}.json', 'wb').write(b if st == 200 else json.dumps({'error': [st, b.decode('utf8', 'replace')]}).encode())
        print(s, st, len(b), sec, flush=True); time.sleep(2)
    attempts = []
    for u in ['https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTB3&cosd=1998-01-01',
              'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTB3',
              'https://fred.stlouisfed.org/data/DTB3.txt']:
        st, b, sec = get(u, tries=2, timeout=120)
        ok = st == 200 and b and not b.lstrip()[:1] == b'<'
        attempts.append({'url': u, 'status': st, 'bytes': len(b or b''), 'seconds': sec, 'ok': bool(ok),
                         'note': '' if ok else (b or b'')[:160].decode('utf8', 'replace')})
        print('FRED', u, st, sec, ok, flush=True)
        if ok:
            open(f'{raw}/DTB3.{"txt" if u.endswith(".txt") else "csv"}', 'wb').write(b); break
    json.dump(attempts, open(f'{raw}/fred_attempts.json', 'w'), ensure_ascii=False, indent=1)


def load_yahoo(path):
    j = json.load(open(path))
    if 'chart' not in j or not j['chart'].get('result'):
        return None, str(j.get('error') or j.get('chart', {}).get('error'))[:200]
    r = j['chart']['result'][0]; q = r['indicators']['quote'][0]
    adj = (r['indicators'].get('adjclose') or [{}])[0].get('adjclose') or [None] * len(r['timestamp'])
    rows = {}
    for i, ts in enumerate(r['timestamp']):
        rows[D(ts + 4 * 3600)] = {k: q[k][i] for k in ('open', 'high', 'low', 'close', 'volume')} | {'adj': adj[i]}
    ev = r.get('events', {})
    divs = {D(int(k) + 4 * 3600): v['amount'] for k, v in (ev.get('dividends') or {}).items()}
    splits = {D(int(k) + 4 * 3600): f"{v['numerator']}:{v['denominator']}" for k, v in (ev.get('splits') or {}).items()}
    return {'rows': rows, 'divs': divs, 'splits': splits, 'meta': {k: r['meta'].get(k) for k in ('symbol', 'firstTradeDate', 'exchangeName', 'instrumentType')}}, None


def check(s, X, cal):
    rows, dates = X['rows'], sorted(X['rows'])
    good = lambda r: all(r[k] is not None and r[k] > 0 for k in ('open', 'close', 'adj'))
    first = next((d for d in dates if good(rows[d])), None)
    c = [d for d in cal if first and d >= first]
    missing = [str(d) for d in c if d not in rows]
    bad = [str(d) for d in c if d in rows and not good(rows[d])]
    extra = [str(d) for d in dates if first and d >= first and d not in set(cal)]
    jumps, stale, zero_vol, oc_eq, adj_unexpl = [], 0, 0, {}, []
    prev = None
    for d in c:
        r = rows.get(d)
        if not r or not good(r): prev = None; continue
        y = d.year
        oc_eq.setdefault(y, [0, 0]); oc_eq[y][1] += 1
        if abs(r['open'] - r['close']) < 1e-9 and r['high'] == r['low']: oc_eq[y][0] += 1
        if (r['volume'] or 0) == 0: zero_vol += 1
        if prev:
            ra = r['adj'] / prev['adj'] - 1
            if abs(ra) > JUMP: jumps.append([str(d), round(ra, 4)])
            if r['close'] == prev['close'] and r['open'] == prev['open']: stale += 1
            # עקביות Adj/Close: היחס adj/close משתנה רק ביום ex של דיבידנד או פיצול
            k0, k1 = prev['adj'] / prev['close'], r['adj'] / r['close']
            if abs(k1 / k0 - 1) > 0.002 and d not in X['divs'] and d not in X['splits']:
                adj_unexpl.append([str(d), round(k1 / k0 - 1, 4)])
        prev = r
    divs = sorted(X['divs'])
    return {
        'first_valid': str(first) if first else None, 'last': str(dates[-1]) if dates else None,
        'rows': len(rows), 'cal_days_since_first': len(c),
        'missing_vs_spy': len(missing), 'missing_sample': missing[:10],
        'bad_values': len(bad), 'bad_sample': bad[:10], 'extra_days_not_in_spy': extra[:10],
        'jumps_gt_15pct': jumps[:20], 'stale_days_same_open_close_as_prev': stale, 'zero_volume_days': zero_vol,
        'flat_bar_days_by_year': {str(y): v[0] for y, v in sorted(oc_eq.items()) if v[0]},
        'adj_ratio_changes_without_event': len(adj_unexpl), 'adj_unexplained_sample': adj_unexpl[:10],
        'dividends': len(divs), 'first_dividend': str(divs[0]) if divs else None,
        'splits': {str(k): v for k, v in sorted(X['splits'].items())}, 'meta': X['meta'],
        'first_1999_trading_day_present': (dt.date(1999, 1, 4) in rows),
    }


def fred_check(raw, cal):
    p = next((f'{raw}/{f}' for f in ('DTB3.csv', 'DTB3.txt') if os.path.exists(f'{raw}/{f}')), None)
    out = {'attempts': json.load(open(f'{raw}/fred_attempts.json')), 'available': bool(p)}
    if not p: return out
    vals, dots = {}, 0
    for line in open(p).read().splitlines():
        parts = line.replace('\t', ',').replace('  ', ',').split(',')
        parts = [x.strip() for x in parts if x.strip()]
        if len(parts) < 2: continue
        try: d = dt.date.fromisoformat(parts[0])
        except ValueError: continue
        if parts[1] == '.' or parts[1] == '': dots += 1; continue
        vals[d] = float(parts[1])
    ds = sorted(vals)
    c = [d for d in cal if d >= dt.date(1999, 1, 1)]
    miss = [d for d in c if d not in vals]
    # פער "אמיתי" = יותר מ-5 ימי מסחר רצופים בלי ערך
    runs, cur = [], []
    for d in c:
        if d in vals:
            if len(cur) > 5: runs.append([str(cur[0]), str(cur[-1]), len(cur)])
            cur = []
        else: cur.append(d)
    out.update({'first': str(ds[0]), 'last': str(ds[-1]), 'n': len(ds), 'dot_values': dots,
                'spy_days_without_value_since_1999': len(miss), 'sample_missing': [str(d) for d in miss[:15]],
                'runs_gt5_days': runs[:10], 'min': min(vals[d] for d in ds if d.year >= 1999), 'max': max(vals[d] for d in ds if d.year >= 1999)})
    return out, vals


def main(raw, out):
    os.makedirs(out, exist_ok=True)
    data, errs = {}, {}
    for s in ALL + ['^IRX']:
        X, e = load_yahoo(f'{raw}/{s.replace("^", "_")}.json')
        if X: data[s] = X
        else: errs[s] = e
    cal = sorted(d for d, r in data['SPY']['rows'].items() if r['close'])
    res = {'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'calendar': [str(cal[0]), str(cal[-1]), len(cal)],
           'errors': errs, 'yahoo': {s: check(s, data[s], cal) for s in ALL if s in data}}
    fr = fred_check(raw, cal)
    fvals = None
    if isinstance(fr, tuple): fr, fvals = fr
    res['fred_dtb3'] = fr
    if '^IRX' in data:
        irx = {d: r['close'] for d, r in data['^IRX']['rows'].items() if r['close']}
        res['irx_reference_only'] = {'first': str(min(irx)), 'last': str(max(irx)), 'n': len(irx),
                                     'spy_days_without_value_since_1999': sum(1 for d in cal if d.year >= 1999 and d not in irx)}
        if fvals:
            com = [d for d in fvals if d in irx]
            diffs = sorted(abs(fvals[d] - irx[d]) for d in com)
            res['irx_reference_only']['vs_dtb3'] = {'common_days': len(com), 'median_abs_diff_pct_pts': round(diffs[len(diffs) // 2], 4) if diffs else None,
                                                    'p95_abs_diff': round(diffs[int(len(diffs) * .95)], 4) if diffs else None}
    # חפיפת BIL ↔ DTB3
    bil = res['yahoo'].get('BIL', {}).get('first_valid')
    res['bil_dtb3_handoff'] = {'bil_first': bil, 'dtb3_covers_until_bil': bool(fvals and bil and max(fvals) >= dt.date.fromisoformat(bil))}
    # ימים שבהם כל 9 הסקטורים תקינים מ-1999
    s9 = [d for d in cal if d.year >= 1999 and all(d in data[s]['rows'] and data[s]['rows'][d]['close'] and data[s]['rows'][d]['adj'] for s in SECT if s in data)]
    res['all9_valid_days_since_1999'] = [len(s9), sum(1 for d in cal if d.year >= 1999)]
    json.dump(res, open(f'{out}/data_gate.json', 'w'), ensure_ascii=False, indent=1)
    print(json.dumps(res, ensure_ascii=False)[:4000])


if __name__ == '__main__':
    if sys.argv[1] == 'fetch': fetch(sys.argv[2])
    else: main(sys.argv[2], sys.argv[3])
