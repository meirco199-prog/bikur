#!/usr/bin/env python3
"""שער הנתונים — בדיקת ספק בלבד (בלי רכישה, בלי הרשמה, בלי מפתח): שליפת דפים ציבוריים, טקסט וקישורים.
שימוש: vendor_fetch.py OUT_DIR URL...  — כותב לכל דף קובץ טקסט נקי וקובץ קישורים."""
import sys, re, html, os, urllib.request, urllib.parse
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 (research; data-gate)'}
seen = set()
def fetch(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40) as r:
            return r.status, r.headers.get('Content-Type', ''), r.read(3_000_000)
    except Exception as e:
        return getattr(e, 'code', None), '', str(e).encode()
def save(u):
    if u in seen: return []
    seen.add(u)
    st, ct, b = fetch(u)
    t = b.decode('utf8', 'replace')
    links = sorted(set(urllib.parse.urljoin(u, x) for x in re.findall(r'href=["\']([^"\'#]+)', t)))
    txt = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', t, flags=re.S | re.I)
    txt = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', txt)))
    n = re.sub(r'[^a-z0-9]+', '_', u.lower())[:90]
    open(f'{OUT}/{n}.txt', 'w').write(f'URL {u}\nSTATUS {st} {ct}\n\n{txt[:60000]}\n\nLINKS\n' + '\n'.join(links))
    print(u, st, len(b), flush=True)
    return links
first = []
for u in sys.argv[2:]:
    first += [(u, l) for l in save(u)]
# קישורים רלוונטיים באותו אתר (מחירון, שאלות, דוגמה, תיעוד, תנאים) — עומק אחד
key = re.compile(r'pric|faq|sample|free|doc|term|licen|options|deribit|format|schema|download', re.I)
for src, l in first:
    if urllib.parse.urlparse(l).netloc == urllib.parse.urlparse(src).netloc and key.search(l) and len(seen) < 45:
        save(l)
