#!/usr/bin/env python3
"""שער נתונים — בדיקת מקורות חינמיים בלבד (בלי מפתחות, בלי רכישה, בלי סימולציה). שימוש: probe_free.py OUT_JSON"""
import json, sys, re, time, urllib.request, urllib.error, html
OUT = sys.argv[1]
UA = {'User-Agent': 'Mozilla/5.0 (bikur-research data-gate)'}
def get(u, tries=2, timeout=40):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()[:300]
        except Exception as e:
            if k == tries - 1: return None, str(e).encode()
            time.sleep(3)
out = {}
# 1. ויקיפדיה — הרכב נוכחי והיסטוריית שינויים
st, b = get('https://en.wikipedia.org/w/api.php?action=parse&page=Nasdaq-100&prop=wikitext&format=json')
try:
    wt = json.loads(b)['parse']['wikitext']['*']
    yrs = sorted({int(y) for y in re.findall(r'==+\s*(?:Changes in |)(\d{4})', wt)})
    out['wikipedia'] = {'status': st, 'chars': len(wt), 'section_years': yrs, 'mentions_delisted_word': len(re.findall(r'(?i)removed|replaced', wt))}
except Exception as e:
    out['wikipedia'] = {'status': st, 'err': str(e)}
# 2. מאגרים קהילתיים
for name, u in [('pypi nasdaq-100-ticker-history', 'https://pypi.org/pypi/nasdaq-100-ticker-history/json'),
                ('github jmccarrell/n100tickers', 'https://api.github.com/repos/jmccarrell/n100tickers'),
                ('github jmccarrell/n100tickers contents', 'https://api.github.com/repos/jmccarrell/n100tickers/contents')]:
    st, b = get(u)
    try:
        j = json.loads(b)
        if isinstance(j, list): out[name] = {'status': st, 'files': [x.get('name') for x in j][:40]}
        else: out[name] = {'status': st, 'summary': j.get('info', {}).get('summary') or j.get('description'), 'version': j.get('info', {}).get('version'),
                           'pushed_at': j.get('pushed_at'), 'release_date': (j.get('urls') or [{}])[0].get('upload_time') if j.get('urls') else None,
                           'desc': (j.get('info', {}).get('description') or '')[:1500]}
    except Exception as e:
        out[name] = {'status': st, 'err': b[:200].decode('utf8', 'replace')}
# 3. Yahoo — מניות שהיו במדד ונמחקו/התמזגו (ומניות קיימות להשוואה)
p1, p2 = 1104537600, int(time.time())  # 2005-01-01
yahoo = {}
for s in ['QQQ', 'BIL', 'SGOV', 'AAPL', 'XLNX', 'ATVI', 'TWTR', 'CELG', 'SGEN', 'SPLK', 'BBBY', 'ALXN', 'MXIM', 'CTXS', 'YHOO', 'ESRX', 'DISCA', 'FB', 'META']:
    st, b = get(f'https://query1.finance.yahoo.com/v8/finance/chart/{s}?period1={p1}&period2={p2}&interval=1d&events=div,splits')
    try:
        r = json.loads(b)['chart']['result'][0]; ts = r.get('timestamp') or []
        ev = r.get('events', {})
        yahoo[s] = {'status': st, 'n': len(ts), 'first': time.strftime('%Y-%m-%d', time.gmtime(ts[0])) if ts else None, 'last': time.strftime('%Y-%m-%d', time.gmtime(ts[-1])) if ts else None,
                    'has_adjclose': 'adjclose' in r.get('indicators', {}), 'divs': len(ev.get('dividends', {})), 'splits': len(ev.get('splits', {}))}
    except Exception:
        yahoo[s] = {'status': st, 'err': b[:160].decode('utf8', 'replace')}
    time.sleep(1)
out['yahoo'] = yahoo
# 4. Stooq — מניות שנמחקו
stooq = {}
for s in ['xlnx.us', 'celg.us', 'twtr.us', 'atvi.us', 'aapl.us']:
    st, b = get(f'https://stooq.com/q/d/l/?s={s}&i=d')
    t = b.decode('utf8', 'replace'); lines = t.strip().splitlines()
    stooq[s] = {'status': st, 'rows': max(0, len(lines) - 1), 'first': lines[1][:10] if len(lines) > 1 else None, 'head': t[:80]}
out['stooq'] = stooq
# 5. FRED — T-Bill 3 חודשים
st, b = get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTB3')
t = b.decode('utf8', 'replace').strip().splitlines()
out['fred_DTB3'] = {'status': st, 'rows': len(t) - 1, 'first': t[1] if len(t) > 1 else None, 'last': t[-1] if t else None}
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False)[:6000])
