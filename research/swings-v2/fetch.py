# הורדת נרות יומיים 10 שנים מ-Yahoo למטמון מקומי (מחקר בלבד).
import json, os, sys, time, urllib.request
CACHE = os.environ.get('CACHE_DIR', '/tmp/swcache'); os.makedirs(CACHE, exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept': 'application/json'}
EXTRA = ['CRDO', 'ALAB', 'NBIS', 'SITM', 'LITE', 'MTSI', 'RKLB', 'SMMT', 'HOOD', 'FTAI', 'ECHO', 'COIN', 'SNDK', 'MRVL', 'AMD', 'MU',
         'LRCX', 'KLAC', 'AXON', 'DASH', 'CRWD', 'OKTA', 'MELI', 'TSLA', 'EXPE', 'AEHR', 'VRT', 'FIX', 'TEVA', 'SMCI', 'PLTR', 'NVDA']
ETFS = ['SPY', 'QQQ', 'SMH']
def get(url, tries=5):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r: return r.read()
        except Exception as e:
            if k == tries - 1: raise
            time.sleep(2 ** (k + 1))
def universe():
    j = json.loads(get('https://invest-api.meirco199.workers.dev/universe/sp500'))
    json.dump(j, open(os.path.join(CACHE, '_sp500.json'), 'w'))
    return [x['symbol'] for x in j['items']]
if __name__ == '__main__':
    syms = list(dict.fromkeys(universe() + EXTRA + ETFS)); bad = []
    for i, s in enumerate(syms):
        p = os.path.join(CACHE, s + '.json')
        if os.path.exists(p): continue
        try: open(p, 'wb').write(get(f'https://query1.finance.yahoo.com/v8/finance/chart/{s.replace(".", "-")}?range=10y&interval=1d&events=splits'))
        except Exception as e: bad.append(s); print('bad', s, e, flush=True)
        time.sleep(0.3)
        if i % 50 == 0: print(i, s, flush=True)
    print('done', len(syms), 'bad', bad)
