#!/usr/bin/env python3
"""מחקר א — שער נתונים (PROTOCOL_v1.0.md סעיף 1). בדיקת נתונים בלבד: אין אותות ואין סימולציה.
שימוש: gate.py fetch RAW_DIR  |  gate.py check RAW_DIR OUT_DIR"""
import json, sys, os, re, time, urllib.request, urllib.error, datetime as dt, urllib.parse

UA = {'User-Agent': 'Mozilla/5.0 (bikur-research)'}
P1 = 1212278400  # 2008-06-01
START = dt.date(2010, 1, 4)
DELISTED = re.compile(r'^[A-Z.]{1,6}-\d{6}$')
TICK = re.compile(r'^[A-Z]{1,5}([.][A-Z])?$')
D = lambda ts: dt.datetime.fromtimestamp(ts, dt.timezone.utc).date()


def get(u, tries=4, timeout=60, hdr=None):
    err = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={**UA, **(hdr or {})}), timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            err = (e.code, e.read()[:300])
            if e.code in (429, 500, 502, 503): time.sleep(8 * (k + 1)); continue
            return err
        except Exception as e:
            err = (None, str(e)[:200].encode()); time.sleep(5 * (k + 1))
    return err


def members_2010(raw):
    hdr = {'Authorization': f"Bearer {os.environ['GITHUB_TOKEN']}"} if os.environ.get('GITHUB_TOKEN') else {}
    st, b = get('https://api.github.com/repos/fja05680/sp500/contents', hdr=hdr)
    files = [f for f in json.loads(b) if re.search(r'Historical Components.*\.csv$', f['name'], re.I)]
    rank = lambda n: ('9' if re.search('updated', n, re.I) else '0') + ''.join(reversed(re.findall(r'\d+', n)))
    files.sort(key=lambda f: rank(f['name']), reverse=True)
    f = files[0]
    st, csv = get(f['download_url'])
    open(f'{raw}/sp500_history.csv', 'wb').write(csv)
    snaps = []
    for line in csv.decode().splitlines()[1:]:
        m = re.match(r'^(\d{4}-\d{2}-\d{2}),"?([^"]*)"?', line)
        if m: snaps.append((m.group(1), [x.strip() for x in m.group(2).split(',') if x.strip()]))
    snaps.sort()
    snap = [s for s in snaps if s[0] <= str(START)][-1]
    return f['name'], snap


def fetch(raw):
    os.makedirs(f'{raw}/yahoo', exist_ok=True)
    name, (sdate, tickers) = members_2010(raw)
    json.dump({'file': name, 'snapshot_date': sdate, 'tickers': tickers}, open(f'{raw}/universe.json', 'w'))
    print('universe', name, sdate, len(tickers), flush=True)
    syms = sorted({t.replace('.', '-') for t in tickers if TICK.match(t)}) + ['SPY', '^IRX']
    p2 = int(time.time())
    for i, s in enumerate(syms):
        st, b = get(f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(s)}?period1={P1}&period2={p2}&interval=1d&events=div,splits&includeAdjustedClose=true')
        open(f'{raw}/yahoo/{s.replace("^", "_")}.json', 'wb').write(b if st == 200 else json.dumps({'error': [st, (b or b'').decode('utf8', 'replace')]}).encode())
        if i % 50 == 0: print(i, s, st, flush=True)
        time.sleep(0.35)


def load(raw, s):
    p = f'{raw}/yahoo/{s.replace("^", "_")}.json'
    if not os.path.exists(p): return None, 'not fetched'
    j = json.load(open(p))
    if 'chart' not in j or not j['chart'].get('result'): return None, 'no series'
    r = j['chart']['result'][0]; q = r['indicators']['quote'][0]
    adj = (r['indicators'].get('adjclose') or [{}])[0].get('adjclose') or [None] * len(r.get('timestamp') or [])
    rows = {}
    for i, ts in enumerate(r.get('timestamp') or []):
        rows[D(ts + 4 * 3600)] = (q['open'][i], q['close'][i], adj[i], q['volume'][i])
    ev = r.get('events', {})
    divs = {D(int(k) + 4 * 3600): v['amount'] for k, v in (ev.get('dividends') or {}).items()}
    splits = {D(int(k) + 4 * 3600): v['numerator'] / v['denominator'] for k, v in (ev.get('splits') or {}).items()}
    ftd = r['meta'].get('firstTradeDate')
    return {'rows': rows, 'divs': divs, 'splits': splits, 'ftd': D(ftd) if ftd else None}, None


def check(raw, out):
    os.makedirs(out, exist_ok=True)
    uni = json.load(open(f'{raw}/universe.json'))
    spy, _ = load(raw, 'SPY'); irx, _ = load(raw, '^IRX')
    cal = sorted(d for d, r in spy['rows'].items() if r[1])
    good = lambda r: r and all(x is not None and x > 0 for x in r[:3])
    res, reasons = {}, {}
    for t in uni['tickers']:
        if DELISTED.match(t) or not TICK.match(t):
            reasons[t] = 'סימון מחיקה בקובץ ההרכב / סימבול לא תקני'; continue
        s = t.replace('.', '-')
        X, err = load(raw, s)
        if not X: reasons[t] = 'אין סדרה ב-Yahoo'; continue
        dates = sorted(d for d, r in X['rows'].items() if good(r))
        if not dates: reasons[t] = 'סדרה ריקה'; continue
        if X['ftd'] and X['ftd'] > dt.date(2008, 12, 31): reasons[t] = f"סימבול ממוחזר / חדש (firstTradeDate {X['ftd']})"; continue
        pre = [d for d in dates if d < START]
        if len(pre) < 200: reasons[t] = f'היסטוריה קצרה לפני 2010 ({len(pre)} ימים)'; continue
        first, last = dates[0], dates[-1]
        c = [d for d in cal if first <= d <= last]
        miss = [d for d in c if not good(X['rows'].get(d))]
        if len(miss) > 0.01 * len(c): reasons[t] = f'פערים: {len(miss)} ימים ({len(miss) / len(c):.1%})'; continue
        unexpl = 0; prev = None
        for d in c:
            r = X['rows'].get(d)
            if not good(r): prev = None; continue
            if prev:
                k0, k1 = prev[2] / prev[1], r[2] / r[1]
                if abs(k1 / k0 - 1) > 0.002 and d not in X['divs'] and d not in X['splits']: unexpl += 1
            prev = r
        res[s] = {'first': str(first), 'last': str(last), 'missing_days': len(miss), 'adj_unexplained': unexpl,
                  'dividends': len(X['divs']), 'splits': len(X['splits']), 'alive': last >= cal[-1] - dt.timedelta(days=7),
                  'has_2020_03': any(dt.date(2020, 3, 1) <= d <= dt.date(2020, 3, 31) for d in dates),
                  'has_2022': any(d.year == 2022 for d in dates)}
    n = len(uni['tickers']); ok = len(res)
    ended = {s: v['last'] for s, v in res.items() if not v['alive']}
    by_reason = {}
    for t, r in reasons.items(): by_reason.setdefault(r.split(' (')[0].split(':')[0], []).append(t)
    irx_ok = irx and len([d for d in cal if d >= dt.date(2009, 1, 1) and d not in irx['rows']]) < 30
    verdict = 'PASS_WITH_SURVIVORSHIP_GAP' if ok / n >= 0.60 and irx_ok else 'INCONCLUSIVE'
    out_j = {'universe_file': uni['file'], 'snapshot_date': uni['snapshot_date'], 'members': n, 'eligible': ok,
             'eligible_share': ok / n, 'missing': n - ok, 'missing_by_reason': {k: len(v) for k, v in by_reason.items()},
             'missing_list': reasons, 'ended_before_now': ended,
             'eligible_without_2020_03_while_alive': [s for s, v in res.items() if not v['has_2020_03'] and v['last'] > '2020-04-01'],
             'adj_unexplained_total': sum(v['adj_unexplained'] for v in res.values()),
             'adj_unexplained_top': sorted(((v['adj_unexplained'], s) for s, v in res.items()), reverse=True)[:10],
             'spy_calendar': [str(cal[0]), str(cal[-1]), len(cal)], 'irx_ok': bool(irx_ok), 'verdict': verdict,
             'eligible_list': sorted(res)}
    json.dump(out_j, open(f'{out}/data_gate.json', 'w'), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in out_j.items() if k not in ('missing_list', 'eligible_list')}, ensure_ascii=False)[:3000])


if __name__ == '__main__':
    if sys.argv[1] == 'fetch': fetch(sys.argv[2])
    else: check(sys.argv[2], sys.argv[3])
