# משיכת היסטוריית נרות 15 דקות (מחקר בלבד, בלי מפתחות): Coinbase Exchange, גיבוי Bitstamp. פלט: data/<SYM>.json.gz
import json, gzip, time, sys, os, urllib.request
DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 180
SYMS = ["BTC", "ETH", "LTC", "BCH", "ADA"]
OUT = os.path.join(os.path.dirname(__file__), "data"); os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "bikur-research/1.0", "Accept": "application/json"}
def get(url):
    for i in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r: return json.load(r)
        except Exception as e:
            print("retry", url[:90], e, file=sys.stderr); time.sleep(2 ** i)
    raise RuntimeError("failed " + url)
def iso(s): return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(s))
now = int(time.time()) // 900 * 900; start = now - DAYS * 86400
for sym in SYMS:
    rows = {}
    try:
        t = start
        while t < now:
            e = min(t + 300 * 900, now)
            for r in get(f"https://api.exchange.coinbase.com/products/{sym}-USD/candles?granularity=900&start={iso(t)}&end={iso(e)}"):
                rows[int(r[0])] = [int(r[0]), r[3], r[2], r[1], r[4], r[5]]   # t,o,h,l,c,v
            t = e; time.sleep(0.15)
        src = "coinbase"
    except Exception as ex:
        print(sym, "coinbase failed:", ex, "→ bitstamp", file=sys.stderr); rows = {}; t = start
        while t < now:
            j = get(f"https://www.bitstamp.net/api/v2/ohlc/{sym.lower()}usd/?step=900&limit=1000&start={t}")
            data = j.get("data", {}).get("ohlc", [])
            if not data: break
            for r in data: rows[int(r["timestamp"])] = [int(r["timestamp"]), float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"]), float(r["volume"])]
            t = int(data[-1]["timestamp"]) + 900; time.sleep(0.3)
        src = "bitstamp"
    out = sorted(v for k, v in rows.items() if k + 900 <= now)
    with gzip.open(os.path.join(OUT, f"{sym}.json.gz"), "wt") as f: json.dump({"sym": sym, "src": src, "bars": out}, f, separators=(",", ":"))
    print(sym, src, len(out), iso(out[0][0]) if out else None, iso(out[-1][0]) if out else None)
