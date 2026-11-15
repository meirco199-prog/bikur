#!/usr/bin/env python3
"""שער הנתונים בלבד: (1) בדיקת קיום וגודל של כל קובצי הדגימה החינמיים של Tardis (בקשת HEAD, בלי הורדה);
(2) בדיקה של מקורות חינמיים ב-Deribit לשווי יומי לאורך חיי העסקה (שלב 4), על רגליים שנבחרו בפועל בדגימות.
אין Backtest, אין מסחר ואין מפתח. שימוש: probe.py ANALYSIS_JSON OUT_JSON
"""
import json, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

AN, OUT = sys.argv[1], sys.argv[2]
UA = {'User-Agent': 'bikur-research/1.0 (data-gate)'}


def get(url, method='GET', tries=2, timeout=25):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, method=method, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, dict(r.headers), (r.read() if method == 'GET' else b'')
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers or {}), e.read() if method == 'GET' else b''
        except Exception as e:  # רשת
            if k == tries - 1:
                return None, {}, str(e).encode()
            time.sleep(2 * (k + 1))


out = {'tardis_head': [], 'deribit': {}}
# ---- 1. כל החודשים, כל סוגי הקבצים (במקביל; בריצה הראשונה בקשות HEAD רצופות לקחו יותר מ-20 דקות) ----
jobs = [(f'{y}-{m:02d}', ds, f'https://datasets.tardis.dev/v1/deribit/{ds}/{y}/{m:02d}/01/OPTIONS.csv.gz')
        for y in range(2020, 2027) for m in range(1, 13) if (y, m) <= (2026, 11) for ds in ('options_chain', 'quotes', 'book_snapshot_25', 'trades')]
def head(j):
    st, h, b = get(j[2], 'HEAD', tries=1, timeout=20)
    return {'month': j[0], 'dataset': j[1], 'status': st, 'mb': round(int(h.get('Content-Length', h.get('content-length', 0)) or 0) / 1e6, 1), 'error': (b.decode('utf8', 'replace')[:80] if st is None else None)}
with ThreadPoolExecutor(16) as ex:
    out['tardis_head'] = list(ex.map(head, jobs))
print('HEAD done', flush=True)
# גם יום שאינו הראשון בחודש — כדי לוודא שהגישה החינמית מוגבלת ליום הראשון
for ds in ('options_chain', 'book_snapshot_25'):
    st, h, _ = get(f'https://datasets.tardis.dev/v1/deribit/{ds}/2024/03/02/OPTIONS.csv.gz', 'HEAD')
    out['tardis_head_day2'] = out.get('tardis_head_day2', []) + [{'dataset': ds, 'day': '2024-03-02', 'status': st}]

# ---- 2. Deribit חינמי: האם אפשר לקבל שווי יומי לרגליים שנבחרו ----
months = json.load(open(AN))
samples = [r for r in months if r.get('four_distinct_legs') and r.get('expiry')]
pick = []
for y in ('2020', '2022', '2024', '2025', '2026'):
    c = [r for r in samples if r['month'].startswith(y)]
    if c:
        pick.append(c[0])
D = out['deribit']
for r in pick:
    T0 = int(datetime.strptime(r['month'] + '-01 12:00', '%Y-%m-%d %H:%M').replace(tzinfo=timezone.utc).timestamp() * 1000)
    TE = int(datetime.strptime(r['expiry'], '%Y-%m-%d %H:%M').replace(tzinfo=timezone.utc).timestamp() * 1000)
    for k in ('SP', 'LP', 'SC', 'LC'):
        sym = r['legs'][k]['symbol']; rec = {'month': r['month'], 'leg': k}
        # עסקאות היסטוריות לאורך חיי העסקה (history.deribit.com)
        st, _, body = get(f'https://history.deribit.com/api/v2/public/get_last_trades_by_instrument_and_time?instrument_name={sym}&start_timestamp={T0}&end_timestamp={TE}&count=1000&sorting=asc')
        try:
            tr = json.loads(body)['result']['trades']; days = sorted({datetime.fromtimestamp(t['timestamp'] / 1000, timezone.utc).strftime('%Y-%m-%d') for t in tr})
            rec['trades'] = {'status': st, 'n': len(tr), 'days_with_trade': len(days), 'hold_days': round((TE - T0) / 864e5, 1), 'has_mark_price_field': bool(tr and 'mark_price' in tr[0])}
        except Exception as e:
            rec['trades'] = {'status': st, 'error': body[:200].decode('utf8', 'replace')}
        # נרות לפי עסקאות (TradingView) למכשיר שפקע
        st, _, body = get(f'https://www.deribit.com/api/v2/public/get_tradingview_chart_data?instrument_name={sym}&start_timestamp={T0}&end_timestamp={TE}&resolution=1D')
        try:
            j = json.loads(body); res = j.get('result') or {}
            rec['chart_1d'] = {'status': st, 'candles': len(res.get('ticks', []) or []), 'no_data': res.get('status'), 'error': (j.get('error') or {}).get('message')}
        except Exception:
            rec['chart_1d'] = {'status': st, 'error': body[:200].decode('utf8', 'replace')}
        # מחירי סליקה למכשיר
        st, _, body = get(f'https://www.deribit.com/api/v2/public/get_last_settlements_by_instrument?instrument_name={sym}&type=settlement&count=100')
        try:
            j = json.loads(body); s = (j.get('result') or {}).get('settlements', [])
            rec['settlements_by_instrument'] = {'status': st, 'n': len(s), 'error': (j.get('error') or {}).get('message'), 'fields': sorted(s[0].keys()) if s else []}
        except Exception:
            rec['settlements_by_instrument'] = {'status': st, 'error': body[:200].decode('utf8', 'replace')}
        D.setdefault('legs', []).append(rec)
        time.sleep(0.3)
    # סליקות לפי מטבע ביום שבתוך חיי העסקה: האם יש רשומה לכל מכשיר אופציה, ומאיזה סוג
    mid = T0 + 10 * 864e5
    st, _, body = get(f'https://www.deribit.com/api/v2/public/get_last_settlements_by_currency?currency=BTC&type=settlement&count=1000&search_start_timestamp={int(mid)}')
    try:
        j = json.loads(body); s = (j.get('result') or {}).get('settlements', [])
        inst = [x.get('instrument_name', '') for x in s]
        D.setdefault('settlements_by_currency', []).append({'month': r['month'], 'status': st, 'n': len(s), 'options_in_result': sum(1 for x in inst if x.count('-') == 3),
            'legs_found': [r['legs'][k]['symbol'] for k in ('SP', 'LP', 'SC', 'LC') if r['legs'][k]['symbol'] in inst], 'error': (j.get('error') or {}).get('message'),
            'first_ts': s[-1]['timestamp'] if s else None, 'last_ts': s[0]['timestamp'] if s else None, 'sample': s[:2]})
    except Exception:
        D.setdefault('settlements_by_currency', []).append({'month': r['month'], 'status': st, 'error': body[:200].decode('utf8', 'replace')})
# מדד התנודתיות DVOL (יומי) — קלט ל-IV30, לא שווי של רגליים
st, _, body = get(f'https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&start_timestamp={int(datetime(2020,1,1,tzinfo=timezone.utc).timestamp()*1000)}&end_timestamp={int(time.time()*1000)}&resolution=1D')
try:
    d = json.loads(body)['result']['data']; D['dvol'] = {'status': st, 'n': len(d), 'first': datetime.fromtimestamp(d[0][0] / 1000, timezone.utc).strftime('%Y-%m-%d') if d else None}
except Exception:
    D['dvol'] = {'status': st, 'error': body[:200].decode('utf8', 'replace')}
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
ok = sum(1 for x in out['tardis_head'] if x['status'] == 200)
print(f"Tardis HEAD: {ok}/{len(out['tardis_head'])} זמינים; יום 2: {out.get('tardis_head_day2')}")
print(json.dumps(D, ensure_ascii=False)[:3000])
