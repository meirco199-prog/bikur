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
        j = m.group(1); print('next_data bytes:', len(j))
        for k in re.findall(r'"(?:name|title|price|priceMonthly|priceYearly|monthly|yearly|annual|amount|calls|bandwidth)"\s*:\s*("[^"]{0,80}"|[0-9.]+)', j)[:150]: print('  ', k)
    seen = set()
    for l in text_lines(t):
        if len(l) < 160 and l not in seen and re.search(r'^\$|/mo|/month|/year|per month|per year|Starter|Premium|Ultimate|Basic|Free|calls|bandwidth|Historical|Constituent|Screener|Earnings Calendar|Estimates|Bulk|Batch', l, re.I):
            seen.add(l); print(l)
for ep in ['stable/sp-500', 'stable/historical-sp-500', 'stable/search-company-screener', 'stable/company-screener', 'stable/earnings-calendar', 'stable/financial-estimates', 'stable/analyst-estimates', 'stable/earnings-company']:
    print('=== doc', ep)
    t = fetch('https://site.financialmodelingprep.com/developer/docs/' + ep)
    if t.startswith('__ERR__'): print(t); continue
    seen = set(); n = 0
    for l in text_lines(t):
        if len(l) < 200 and l not in seen and re.search(r'Starter|Premium|Ultimate|Basic|Free plan|Available|plan|Legacy|paid|Upgrade', l):
            seen.add(l); print('  ', l); n += 1
            if n > 25: break
