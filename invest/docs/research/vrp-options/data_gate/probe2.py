#!/usr/bin/env python3
"""שער הנתונים בלבד — שלב 4 (שווי יומי), בדיקה משלימה. בלי Backtest, בלי תשואה, בלי מפתח.
1. לכל חודש שבו נבחרו 4 רגליים: כל העסקאות הציבוריות של כל רגל לאורך חיי העסקה (history.deribit.com, עם דפדוף מלא —
   בבדיקה הראשונה הבקשה נקטעה ב-1,000 עסקאות). מודדים באיזה חלק מהימים יש לכל רגל לפחות עסקה אחת, ובאיזה חלק מהימים
   יש עסקה לכל ארבע הרגליים יחד. לכל עסקה Deribit מצרפת את מחיר הסימון (mark_price) של הבורסה באותו רגע.
2. public/get_mark_price_history (היסטוריית מחיר סימון) — לרגליים שפקעו ולרגליים פעילות, כדי לדעת אם זה מקור לשווי יומי.
3. Tardis: GET חלקי (בתים ראשונים בלבד) ליום השני בחודש — בדיקת HEAD בריצה הקודמת החזירה 404 גם לקבצים שהורדו בפועל,
   ולכן אינה ראיה. כאן בודקים בבקשת GET אמיתית.
4. בדיקה חוזרת של קובצי העסקאות לחודשים שבהם נספרו 0 עסקאות (2026-02, 2026-07).
שימוש: probe2.py SAMPLES_JSON OUT_JSON
"""
import json, sys, time, urllib.request, urllib.error, gzip, io
from datetime import datetime, timezone

AN, OUT = sys.argv[1], sys.argv[2]
UA = {'User-Agent': 'bikur-research/1.0 (data-gate)'}
T_START = time.time()


def get(url, headers=None, timeout=30, tries=3):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={**UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()
        except Exception as e:
            if k == tries - 1:
                return None, str(e).encode()
            time.sleep(3 * (k + 1))


def ms(s):
    return int(datetime.strptime(s, '%Y-%m-%d %H:%M').replace(tzinfo=timezone.utc).timestamp() * 1000)


def day(t):
    return datetime.fromtimestamp(t / 1000, timezone.utc).strftime('%Y-%m-%d')


months = [r for r in json.load(open(AN)) if r.get('four_distinct_legs') and r.get('expiry')]
out = {'legs_daily': [], 'mark_price_history': [], 'tardis_day2_get': [], 'trades_recheck': []}

# ---- 1. עסקאות עם דפדוף מלא ----
for r in months:
    if time.time() - T_START > 1800:
        out['legs_daily'].append({'month': r['month'], 'skipped': 'מגבלת זמן'}); continue
    T0 = ms(r['month'] + '-01 12:05'); TE = ms(r['expiry'])
    hold = sorted({day(t) for t in range(T0, TE, 3600 * 1000)})
    per = {}
    for k in ('SP', 'LP', 'SC', 'LC'):
        sym = r['legs'][k]['symbol']; start = T0; days = {}; n = 0; err = None; pages = 0
        while start < TE and pages < 60:
            st, body = get(f'https://history.deribit.com/api/v2/public/get_last_trades_by_instrument_and_time?instrument_name={sym}&start_timestamp={start}&end_timestamp={TE}&count=1000&sorting=asc')
            pages += 1
            try:
                res = json.loads(body)['result']; tr = res['trades']
            except Exception:
                err = f'{st}: {body[:120]!r}'; break
            for t in tr:
                d = day(t['timestamp']); n += 1
                days[d] = t.get('mark_price')  # מחיר הסימון של הבורסה בעסקה האחרונה ביום
            if not res.get('has_more') or not tr:
                break
            start = tr[-1]['timestamp'] + 1
            time.sleep(0.15)
        per[k] = {'symbol': sym, 'trades': n, 'pages': pages, 'days_with_trade': len([d for d in hold if d in days]), 'error': err,
                  'longest_gap_days': max((len(g) for g in ''.join('1' if d in days else '0' for d in hold).split('1')), default=0)}
        per[k]['_days'] = set(days)
    all4 = [d for d in hold if all(d in per[k]['_days'] for k in per)]
    any_gap = ''.join('1' if d in all4 else '0' for d in hold)
    for k in per:
        per[k].pop('_days')
    out['legs_daily'].append({'month': r['month'], 'expiry': r['expiry'], 'hold_days': len(hold), 'legs': per,
                              'days_all_four_traded': len(all4), 'share_all_four': round(len(all4) / len(hold), 3) if hold else None,
                              'longest_gap_all_four_days': max((len(g) for g in any_gap.split('1')), default=0)})
    print(r['month'], len(all4), '/', len(hold), {k: per[k]['days_with_trade'] for k in per}, flush=True)

# ---- 2. היסטוריית מחיר סימון ----
pick = [months[0], months[len(months) // 2], months[-1]]
for r in pick:
    for k in ('SP', 'LC'):
        sym = r['legs'][k]['symbol']; T0 = ms(r['month'] + '-01 12:05'); TE = min(ms(r['expiry']), int(time.time() * 1000))
        st, body = get(f'https://www.deribit.com/api/v2/public/get_mark_price_history?instrument_name={sym}&start_timestamp={T0}&end_timestamp={TE}')
        try:
            j = json.loads(body); res = j.get('result')
            out['mark_price_history'].append({'month': r['month'], 'symbol': sym, 'status': st, 'points': len(res or []), 'error': (j.get('error') or {}).get('message'),
                                              'first': day(res[0][0]) if res else None, 'last': day(res[-1][0]) if res else None})
        except Exception:
            out['mark_price_history'].append({'month': r['month'], 'symbol': sym, 'status': st, 'error': body[:200].decode('utf8', 'replace')})

# ---- 3. Tardis: יום שני בחודש, GET חלקי ----
for url in ('https://datasets.tardis.dev/v1/deribit/options_chain/2024/03/02/OPTIONS.csv.gz',
            'https://datasets.tardis.dev/v1/deribit/book_snapshot_25/2024/03/02/OPTIONS.csv.gz',
            'https://datasets.tardis.dev/v1/deribit/options_chain/2024/03/01/OPTIONS.csv.gz'):
    st, body = get(url, headers={'Range': 'bytes=0-2047'}, tries=2)
    out['tardis_day2_get'].append({'url': url, 'status': st, 'bytes': len(body or b''), 'body_head': (body[:160].decode('utf8', 'replace') if st and st >= 400 else None)})

# ---- 4. עסקאות: בדיקה חוזרת לחודשים עם 0 ----
for m in ('2026-02', '2026-07'):
    y, mo = m.split('-')
    st, body = get(f'https://datasets.tardis.dev/v1/deribit/trades/{y}/{mo}/01/OPTIONS.csv.gz', timeout=300, tries=2)
    rec = {'month': m, 'status': st, 'bytes': len(body or b'')}
    try:
        txt = gzip.GzipFile(fileobj=io.BytesIO(body)).read().decode()
        lines = txt.splitlines(); rec['rows'] = len(lines) - 1; rec['btc_rows'] = sum(1 for l in lines[1:] if l.split(',')[1].startswith('BTC-'))
    except Exception as e:
        rec['error'] = f'{type(e).__name__}: {body[:120]!r}'
    out['trades_recheck'].append(rec)

json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in out.items() if k != 'legs_daily'}, ensure_ascii=False)[:3000])
