#!/usr/bin/env python3
"""שער הנתונים — CryptoStruct, בדיקה אחרונה (ממשק ציבורי, בלי מפתח, בלי רכישה, בלי Backtest):
1. דגימה חינמית של אופציית BTC אחת (יום שלם): סוגי ההודעות, ובמיוחד זרם מחיר הסימון/IV/Greeks — כמה עדכונים, באיזה מרווח, אילו שדות.
   לפי הרישיון אין הפצה של נתונים גולמיים: נשמרים רק סטטיסטיקות ושמות שדות. הקובץ הגולמי נמחק בסוף הריצה.
2. לכל תקופת החזקה של הפרוטוקול מאז 2023-10 ולכל אחת מארבע הרגליים: האם קיים קובץ לכל יום (רשימת הימים של המכשיר).
שימוש: probe4.py SAMPLES_JSON OUT_JSON"""
import json, sys, time, subprocess, os, urllib.request, urllib.error, collections
from datetime import date, datetime, timedelta, timezone
AN, OUT = sys.argv[1], sys.argv[2]
UA = {'User-Agent': 'bikur-research/1.0 (data-gate)', 'Accept': 'application/json'}
def get(u, raw=False, timeout=60):
    err = None
    for k in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=timeout) as r:
                b = r.read(); return r.status, (b if raw else json.loads(b))
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(int(e.headers.get('Retry-After', 5)) + 1); continue
            return e.code, {'error': e.read()[:300].decode('utf8', 'replace')}
        except Exception as e:
            err = str(e); time.sleep(3)
    return None, {'error': err}
out = {}
# ---- 1. דגימה ----
st, b = get('https://cryptostruct.com/api/download/sample/14945279/2026-11-05', raw=True, timeout=300)
out['sample'] = {'status': st, 'bytes': len(b) if isinstance(b, bytes) else None}
if st == 200 and isinstance(b, bytes):
    open('/tmp/s.zst', 'wb').write(b)
    txt = subprocess.run(['zstd', '-dc', '/tmp/s.zst'], capture_output=True).stdout.decode('utf8', 'replace').splitlines()
    out['sample']['lines'] = len(txt)
    try:
        out['sample']['masterdata_keys'] = sorted(json.loads(txt[0]).keys())
    except Exception as e:
        out['sample']['masterdata_error'] = str(e)
    types = collections.Counter(); keys = {}; ts = collections.defaultdict(list)
    shapes = collections.Counter()
    for ln in txt[1:]:
        try: m = json.loads(ln)
        except Exception: types['_bad'] += 1; continue
        if isinstance(m, dict):
            t = str(m.get('type') or m.get('t') or m.get('msg') or m.get('kind') or '?')
            if t not in keys: keys[t] = sorted(m.keys())
            cand = [m.get(x) for x in ('ts', 'timestamp', 'venue_ts', 'recv_ts', 'time')]
        elif isinstance(m, list):
            t = str(m[0]) if m and isinstance(m[0], (str, int)) else '?'
            if t not in keys: keys[t] = [type(x).__name__ for x in m]  # מבנה בלבד, בלי ערכים
            cand = m
        else:
            t = type(m).__name__; cand = []
        types[t] += 1
        tsv = next((int(x) for x in cand if isinstance(x, int) and x > 10**18), None)  # חותמת זמן בננו-שניות
        if tsv: ts[t].append(tsv)
    out['sample']['message_types'] = dict(types.most_common(30)); out['sample']['fields_by_type'] = keys
    span = {}
    for t, v in ts.items():
        v.sort(); gaps = [b - a for a, b in zip(v, v[1:])]
        span[t] = {'n': len(v), 'first_utc': datetime.fromtimestamp(v[0] / 1e9, timezone.utc).strftime('%H:%M:%S') if v else None,
                   'last_utc': datetime.fromtimestamp(v[-1] / 1e9, timezone.utc).strftime('%H:%M:%S') if v else None,
                   'max_gap_s': round(max(gaps) / 1e9, 1) if gaps else None, 'median_gap_s': round(sorted(gaps)[len(gaps) // 2] / 1e9, 3) if gaps else None}
    out['sample']['timing_by_type'] = span
    os.remove('/tmp/s.zst')
st, fd = get('https://cryptostruct.com/skills/cryptostruct-market-data/references/day-file-format.md', raw=True)
if isinstance(fd, bytes):
    t = fd.decode('utf8', 'replace'); import re
    out['format_doc_excerpts'] = [t[max(0, m.start() - 300):m.end() + 600] for m in re.finditer(r'(?i)mark|greek|implied|index price|option', t)][:12]
    out['format_doc_head'] = t[:3000]
# ---- 2. רגליים × ימים ----
months = [r for r in json.load(open(AN)) if r.get('four_distinct_legs') and r.get('expiry') and r['month'] >= '2023-10']
legs = []
for r in months:
    a = date.fromisoformat(r['month'] + '-01'); e = min(datetime.strptime(r['expiry'], '%Y-%m-%d %H:%M').date(), date(2026, 11, 14))
    hold = [str(a + timedelta(i)) for i in range((e - a).days + 1)]
    rec = {'month': r['month'], 'hold_days_checked': len(hold), 'legs': {}}
    for k in ('SP', 'LP', 'SC', 'LC'):
        sym = r['legs'][k]['symbol']
        st, s = get(f'https://cryptostruct.com/api/search?q={sym}&venue=deribit&limit=5'); time.sleep(0.6)
        hits = (s.get('results') or s.get('instruments') or s.get('items') or []) if isinstance(s, dict) else (s or [])
        hit = next((h for h in hits if str(h.get('code', '')).upper().startswith(sym.upper())), None)
        if not hit:
            rec['legs'][k] = {'symbol': sym, 'found': False, 'search_status': st, 'n_hits': len(hits), 'raw': json.dumps(s)[:300] if not hits else None}; continue
        iid = hit.get('instrument_id') or hit.get('id')
        st, d = get(f'https://cryptostruct.com/api/instrument/{iid}/days?limit=400'); time.sleep(0.6)
        rows = (d.get('days') if isinstance(d, dict) else d) or []
        have = {x['date'] if isinstance(x, dict) else x for x in rows}
        miss = [x for x in hold if x not in have]
        rec['legs'][k] = {'symbol': sym, 'found': True, 'instrument_id': iid, 'code': hit.get('code'), 'days_status': st, 'days_listed': len(have), 'missing': miss}
    rec['all_legs_all_days'] = all(v.get('found') and not v.get('missing') for v in rec['legs'].values())
    legs.append(rec); print(r['month'], rec['all_legs_all_days'], {k: (len(v.get('missing', [])) if v.get('found') else 'X') for k, v in rec['legs'].items()}, flush=True)
out['legs_by_hold'] = legs
out['holds_all_legs_all_days'] = sum(1 for x in legs if x['all_legs_all_days'])
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
print(json.dumps(out['sample'], ensure_ascii=False)[:4000])
