# בדיקת מסלולי FMP מתוך GitHub Actions (הסביבה של הסוכן חסומה לאתר): מחלץ מחירים ותוויות זמינות מדפי התמחור והתיעוד.
import re, html, sys, urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept': 'text/html'}
def fetch(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r: return r.read().decode('utf-8', 'ignore')
    except Exception as e: return f'__ERR__ {e}'
def text_lines(t):
    t = re.sub(r'<script.*?</script>|<style.*?</style>', '', t, flags=re.S)
    return [l.strip() for l in html.unescape(re.sub(r'<[^>]+>', '\n', t)).split('\n') if l.strip()]

print('=== pricing page')
t = fetch('https://site.financialmodelingprep.com/pricing-plans')
if t.startswith('__ERR__'): print(t)
else:
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', t, re.S)
    if m:
        import json
        j = m.group(1); print('next_data bytes:', len(j))
        KEY = re.compile(r'Screener|Estimates|Earnings Calendar|Historical S&P|Constituent|Calls|Bandwidth|Price|Starter|Premium|Ultimate|Basic|Free', re.I)
        out = []
        def walk(o, path=''):
            if isinstance(o, dict):
                flat = {k: v for k, v in o.items() if not isinstance(v, (dict, list))}
                if any(isinstance(v, str) and KEY.search(v) for v in flat.values()) or any(re.search(r'price|amount|monthly|annual|yearly', k, re.I) for k in flat):
                    out.append((path, json.dumps(flat, ensure_ascii=False)[:400]))
                for k, v in o.items(): walk(v, path + '/' + k)
            elif isinstance(o, list):
                for i, v in enumerate(o[:200]): walk(v, path + f'[{i}]')
        try:
            walk(json.loads(j))
            for pth, d in out[:220]: print(' ', pth[-70:], d)
        except Exception as e: print('parse error', e)
    seen = set()
    for l in text_lines(t):
        if len(l) < 160 and l not in seen and re.search(r'^\$|/mo|/month|/year|per month|per year|Starter|Premium|Ultimate|Basic|Free|calls|bandwidth|Historical|Constituent|Screener|Earnings Calendar|Estimates|Bulk|Batch', l, re.I):
            seen.add(l); print(l)
print('=== pricing page text (all lines, in order)')
t = fetch('https://site.financialmodelingprep.com/pricing-plans')
if not t.startswith('__ERR__'):
    for l in text_lines(t)[:260]: print(' ', l[:120])
print('=== docs/pricing')
t = fetch('https://site.financialmodelingprep.com/developer/docs/pricing')
if t.startswith('__ERR__'): print(t)
else:
    for l in text_lines(t):
        if re.search(r'\$|/mo|/yr|Starter|Premium|Ultimate|Basic|Calls|Screener|Estimates|Earnings|Constituent|S&P', l) and len(l) < 160: print(' ', l)
for ep in ['stable/sp-500', 'stable/historical-sp-500', 'stable/search-company-screener', 'stable/company-screener', 'stable/earnings-calendar', 'stable/financial-estimates', 'stable/analyst-estimates', 'stable/earnings-company']:
    print('=== doc', ep)
    t = fetch('https://site.financialmodelingprep.com/developer/docs/' + ep)
    if t.startswith('__ERR__'): print(t); continue
    seen = set(); n = 0
    for l in text_lines(t):
        if len(l) < 200 and l not in seen and re.search(r'Starter|Premium|Ultimate|Basic|Free plan|Available|plan|Legacy|paid|Upgrade', l):
            seen.add(l); print('  ', l); n += 1
            if n > 25: break
