#!/usr/bin/env python3
"""שער נתונים — משיכת מימון שמומש בפועל: Hyperliquid (שעתי, API ציבורי) ו-Binance (קבצים חודשיים data.binance.vision), 2023-01..2026-10.
שימוש: fetch.py PAIRS_JSON SHARD NSHARDS OUT_DIR"""
import json, sys, time, io, zipfile, csv, os, urllib.request, urllib.error
P, SH, NS, OUT = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
os.makedirs(f'{OUT}/hl', exist_ok=True); os.makedirs(f'{OUT}/bn', exist_ok=True)
UA = {'User-Agent': 'bikur-research/1.0 (data-gate)'}
T0, T1 = 1672531200000, 1793491200000  # 2023-01-01 .. 2026-11-01
def req(url, body=None, tries=6, timeout=60):
    for k in range(tries):
        try:
            data = json.dumps(body).encode() if body is not None else None
            r = urllib.request.Request(url, data=data, headers={**UA, **({'Content-Type': 'application/json'} if body is not None else {})})
            with urllib.request.urlopen(r, timeout=timeout) as x: return x.status, x.read()
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(15 * (k + 1)); continue
            return e.code, b''
        except Exception:
            time.sleep(5 * (k + 1))
    return None, b''
pairs = [p for i, p in enumerate(sorted(json.load(open(P)), key=lambda x: x['hl'])) if i % NS == SH]
log = []
for p in pairs:
    t, rows, pages, err = T0, [], 0, None
    while t < T1 and pages < 200:
        st, b = req('https://api.hyperliquid.xyz/info', {'type': 'fundingHistory', 'coin': p['hl'], 'startTime': t, 'endTime': T1})
        pages += 1
        if st != 200: err = st; break
        x = json.loads(b)
        if not x: break
        rows += [(int(r['time']), r['fundingRate']) for r in x]
        t = int(x[-1]['time']) + 1
        time.sleep(2.2)
        if len(x) < 500: break
    with open(f"{OUT}/hl/{p['hl']}.csv", 'w') as f:
        f.writelines(f'{a},{b}\n' for a, b in rows)
    bn, miss = [], 0
    for y in range(2023, 2027):
        for m in range(1, 13):
            if (y, m) > (2026, 10): break
            st, b = req(f"https://data.binance.vision/data/futures/um/monthly/fundingRate/{p['bn']}/{p['bn']}-fundingRate-{y}-{m:02d}.zip", tries=3)
            if st != 200: miss += 1; continue
            z = zipfile.ZipFile(io.BytesIO(b)); txt = z.read(z.namelist()[0]).decode()
            for r in csv.reader(txt.splitlines()):
                if r and r[0].isdigit(): bn.append((int(r[0]), r[1], r[2]))
    with open(f"{OUT}/bn/{p['bn']}.csv", 'w') as f:
        f.writelines(f'{a},{b},{c}\n' for a, b, c in bn)
    log.append({**p, 'hl_rows': len(rows), 'hl_pages': pages, 'hl_err': err, 'bn_rows': len(bn), 'bn_missing_months': miss})
    print(log[-1], flush=True)
json.dump(log, open(f'{OUT}/log-{SH}.json', 'w'))
