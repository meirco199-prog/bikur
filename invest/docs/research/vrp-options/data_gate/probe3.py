#!/usr/bin/env python3
"""שער הנתונים — בדיקת ספק (CryptoStruct) בלבד, דרך ממשק ציבורי בלי מפתח ובלי רכישה. בלי Backtest.
1. רשימת כל הימים בארכיון של סדרת אופציות BTC ההפוכות ב-Deribit, וחורים בכל תקופת החזקה של הפרוטוקול (מ-2023-10).
2. רשימת הדגימות החינמיות. בהתאם לרישיון (אין הפצה של נתונים גולמיים) — נשמרים רק נתונים נגזרים, לא קבצים גולמיים.
שימוש: probe3.py SAMPLES_JSON OUT_JSON"""
import json, sys, time, urllib.request, urllib.error
from datetime import date, datetime, timedelta, timezone
AN, OUT = sys.argv[1], sys.argv[2]
UA = {'User-Agent': 'bikur-research/1.0 (data-gate)', 'Accept': 'application/json'}
def get(u):
    for k in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(int(e.headers.get('Retry-After', 5)) + 1); continue
            return e.code, {'error': e.read()[:300].decode('utf8', 'replace')}
        except Exception as e:
            time.sleep(3); err = str(e)
    return None, {'error': err}
out = {}
st, b = get('https://cryptostruct.com/api/bundles')
items = b if isinstance(b, list) else (b.get('bundles') or b.get('items') or b.get('series') or [])
out['bundles_status'] = st
out['btc_bundle'] = [x for x in items if 'btc' in json.dumps(x).lower() and 'deribit' in json.dumps(x).lower()]
if not items: out['bundles_raw'] = json.dumps(b)[:3000]
# ימים
days, before, pages = [], '', 0
while pages < 40:
    st, b = get('https://cryptostruct.com/api/bundle/deribit-btc-options/days?limit=500' + (f'&before={before}' if before else ''))
    pages += 1
    if st != 200: out['days_error'] = (st, json.dumps(b)[:500]); break
    rows = b.get('days') if isinstance(b, dict) else b
    if pages == 1: out['days_first_page_sample'] = json.dumps(b)[:800]
    if not rows: break
    days += rows
    nxt = b.get('next_cursor') if isinstance(b, dict) else None
    if not nxt: break
    before = nxt; time.sleep(0.5)
dl = sorted({(r['date'] if isinstance(r, dict) else r) for r in days})
out['n_days'] = len(dl); out['first'] = dl[0] if dl else None; out['last'] = dl[-1] if dl else None
sizes = {r['date']: r.get('size') for r in days if isinstance(r, dict)}
if dl:
    d0, d1 = date.fromisoformat(dl[0]), date.fromisoformat(dl[-1]); have = set(dl)
    miss = [str(d0 + timedelta(i)) for i in range((d1 - d0).days + 1) if str(d0 + timedelta(i)) not in have]
    out['missing_days'] = miss; out['n_missing'] = len(miss)
    small = sorted((s, d) for d, s in sizes.items() if s)[:15]; out['smallest_days'] = small
    # תקופות ההחזקה של הפרוטוקול (מהדגימות שנבחרו), מיום הכניסה ועד הפקיעה
    months = [r for r in json.load(open(AN)) if r.get('four_distinct_legs') and r.get('expiry')]
    per = []
    for r in months:
        a = date.fromisoformat(r['month'] + '-01'); e = datetime.strptime(r['expiry'], '%Y-%m-%d %H:%M').date()
        if e < d0: continue
        hold = [str(a + timedelta(i)) for i in range((e - a).days + 1)]
        per.append({'month': r['month'], 'hold_days': len(hold), 'missing': [d for d in hold if d not in have], 'before_coverage': sum(1 for d in hold if d < dl[0])})
    out['hold_periods'] = per
    out['hold_periods_complete'] = sum(1 for p in per if not p['missing'])
st, b = get('https://cryptostruct.com/api/samples')
out['samples_status'] = st
smp = b if isinstance(b, list) else (b.get('samples') or b.get('items') or [])
out['samples_n'] = len(smp)
out['samples_deribit'] = [x for x in smp if 'deribit' in json.dumps(x).lower()]
out['samples_head'] = json.dumps(smp[:3])[:1500] if smp else json.dumps(b)[:1500]
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in out.items() if k not in ('missing_days', 'hold_periods')}, ensure_ascii=False)[:4000])
print('missing', out.get('n_missing'), out.get('missing_days', [])[:80])
