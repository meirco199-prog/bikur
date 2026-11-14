"""Export BTC/ETH/SOL daily candles from the project's historical dataset (xsra-data.json.gz, Coinbase Exchange public
candles, granularity 86400 s, UTC days — the same data used by research 7יח–7כז) to backtest.py's CSV format."""
import gzip, json, sys
import pandas as pd

src, out = sys.argv[1], sys.argv[2]
d = json.load(gzip.open(src))
rows = []
for a in ("BTC", "ETH", "SOL"):
    for b in d["bars"][a]:
        rows.append((pd.Timestamp(b["t"], unit="ms", tz="UTC").normalize(), a, b["o"], b["c"]))
df = pd.DataFrame(rows, columns=["date", "asset", "open", "close"]).sort_values(["asset", "date"])
assert not df.duplicated(["date", "asset"]).any(), "duplicate bars"
assert (pd.Timestamp(b["t"], unit="ms", tz="UTC") == pd.Timestamp(b["t"], unit="ms", tz="UTC").normalize() for b in d["bars"]["BTC"]), "non-midnight timestamps"
df["date"] = df["date"].dt.strftime("%Y-%m-%d")
df.to_csv(out, index=False)
meta = {"source": "Coinbase Exchange public daily candles (api.exchange.coinbase.com, granularity 86400, UTC)", "file": src,
        "assets": {a: {"first": df[df.asset == a].date.min(), "last": df[df.asset == a].date.max(), "rows": int((df.asset == a).sum())} for a in ("BTC", "ETH", "SOL")}}
print(json.dumps(meta, indent=2))
