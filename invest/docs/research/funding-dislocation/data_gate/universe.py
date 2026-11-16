#!/usr/bin/env python3
"""שער נתונים — יקום והתאמת סימבולים + בדיקות זמינות (בלי מפתח, בלי רכישה). שימוש: universe.py OUT_DIR"""
import json, sys, time, re, urllib.request, urllib.error, xml.etree.ElementTree as ET
OUT = sys.argv[1]
UA = {'User-Agent': 'bikur-research/1.0 (data-gate)'}

def req(url, body=None, tries=4, timeout=60, method=None):
    for k in range(tries):
        try:
            data = json.dumps(body).encode() if body is not None else None
            r = urllib.request.Request(url, data=data, headers={**UA, **({'Content-Type': 'application/json'} if body is not None else {})}, method=method)
            with urllib.request.urlopen(r, timeout=timeout) as x:
                return x.status, x.read()
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(10 * (k + 1)); continue
            return e.code, e.read()
        except Exception as e:
            if k == tries - 1: return None, str(e).encode()
            time.sleep(3 * (k + 1))
    return None, b'retries'

out = {}
# 1. Hyperliquid — כל המטבעות כולל שנמחקו
st, b = req('https://api.hyperliquid.xyz/info', {'type': 'meta'})
meta = json.loads(b) if st == 200 else {}
uni = meta.get('universe', [])
out['hl_status'] = st; out['hl_n'] = len(uni); out['hl_delisted'] = sum(1 for u in uni if u.get('isDelisted'))
# 2. Binance — כל הסימבולים שיש להם קובצי fundingRate חודשיים (כולל שנמחקו)
syms, marker = set(), ''
for _ in range(20):
    st2, b2 = req('https://s3-ap-northeast-1.amazonaws.com/data.binance.vision?delimiter=/&prefix=data/futures/um/monthly/fundingRate/' + (f'&marker={marker}' if marker else ''))
    if st2 != 200: out['bn_list_error'] = (st2, b2[:200].decode('utf8', 'replace')); break
    root = ET.fromstring(b2); ns = {'s': root.tag.split('}')[0].strip('{')}
    pre = [p.find('s:Prefix', ns).text for p in root.findall('s:CommonPrefixes', ns)]
    syms |= {p.rstrip('/').split('/')[-1] for p in pre}
    trunc = (root.find('s:IsTruncated', ns).text == 'true')
    if not trunc or not pre: break
    marker = pre[-1]
out['bn_n'] = len(syms)
# 3. התאמה
pairs, unmatched = [], []
for u in uni:
    n = u['name']
    cand = [n + 'USDT'] if not n.startswith('k') or not n[1:].isupper() else ['1000' + n[1:] + 'USDT']
    hit = next((c for c in cand if c in syms), None)
    (pairs if hit else unmatched).append({'hl': n, 'bn': hit, 'delisted': bool(u.get('isDelisted')), 'maxLev': u.get('maxLeverage')})
out['pairs_n'] = len(pairs); out['pairs_delisted_hl'] = sum(1 for p in pairs if p['delisted'])
out['unmatched_hl'] = [u['hl'] for u in unmatched]
json.dump(pairs, open(f'{OUT}/pairs.json', 'w'))
# 4. בדיקות זמינות מחירים/ספר (קיום קבצים בלבד)
def head(url):
    st, _ = req(url, method='HEAD', tries=2, timeout=30); return st
probe = {}
for sym in ('BTCUSDT', 'SOLUSDT', next((p['bn'] for p in pairs if p['delisted']), 'BTCUSDT')):
    for path in ('monthly/klines/{s}/1h/{s}-1h-2024-03.zip', 'monthly/markPriceKlines/{s}/1h/{s}-1h-2024-03.zip',
                 'monthly/premiumIndexKlines/{s}/1h/{s}-1h-2024-03.zip', 'daily/bookDepth/{s}/{s}-bookDepth-2024-03-01.zip',
                 'monthly/bookTicker/{s}/{s}-bookTicker-2023-03.zip', 'daily/bookTicker/{s}/{s}-bookTicker-2024-03-01.zip',
                 'monthly/fundingRate/{s}/{s}-fundingRate-2023-01.zip', 'monthly/fundingRate/{s}/{s}-fundingRate-2026-10.zip'):
        u = 'https://data.binance.vision/data/futures/um/' + path.format(s=sym)
        probe[u] = head(u)
out['bn_files'] = probe
# Hyperliquid — נרות: עד כמה אחורה (רק 5,000 הנרות האחרונים לכל רזולוציה, לפי התיעוד)
hlc = {}
for coin in ('BTC', 'SOL', next((p['hl'] for p in pairs if p['delisted']), 'BTC')):
    for iv in ('1d', '1h'):
        st, b = req('https://api.hyperliquid.xyz/info', {'type': 'candleSnapshot', 'req': {'coin': coin, 'interval': iv, 'startTime': 1672531200000, 'endTime': int(time.time() * 1000)}})
        try:
            c = json.loads(b); hlc[f'{coin}/{iv}'] = {'status': st, 'n': len(c), 'first': time.strftime('%Y-%m-%d', time.gmtime(c[0]['t'] / 1000)) if c else None}
        except Exception:
            hlc[f'{coin}/{iv}'] = {'status': st, 'err': b[:120].decode('utf8', 'replace')}
        time.sleep(1)
out['hl_candles'] = hlc
# Hyperliquid — היסטוריית ספר/עסקאות: רק בארכיון S3 בתשלום-לפי-שליפה (requester pays) — לא נבדק בלי אישור
out['hl_l2_history'] = 'ארכיון S3 של Hyperliquid (requester-pays) — דורש חשבון AWS ותשלום לפי שליפה; לא נבדק'
json.dump(out, open(f'{OUT}/universe.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in out.items() if k != 'bn_files'}, ensure_ascii=False)[:3000])
