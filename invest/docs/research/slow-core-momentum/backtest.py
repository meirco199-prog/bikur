"""Slow Core Momentum — research-only daily backtest (locked protocol v1, PROTOCOL.md). Never connects to a broker.

CSV input: date,asset,open,close (UTC daily candles). Strategy rules are frozen in PROTOCOL.md and are NOT changed here.
Changes vs. the first draft (logic/measurement fixes only, see REPORT.md "Code review"):
  * metrics: a window's return now starts from the NAV at the close *before* the window (the first day's return was dropped);
  * turnover: traded notional / PRE-TRADE NAV of that rebalance (was: post-trade close NAV of the execution day);
  * benchmarks: BTC buy-and-hold (matched start) and equal-weight BTC/ETH/SOL buy-and-hold from the first day all three exist;
  * random-selection control, data validation, trade log / equity / yearly-monthly outputs, explicit PASS/FAIL/INCONCLUSIVE verdict.
"""
import argparse, json, os
import numpy as np
import pandas as pd

ASSETS = ("BTC", "ETH", "SOL")
FEE = .0005
SLIP = .0002
START = pd.Timestamp("2022-01-01", tz="UTC")
SPLITS = [("training", "2016-07-01", "2022-07-01"),
          ("validation", "2022-07-01", "2024-09-01"),
          ("test", "2024-09-01", "2026-11-14"),
          ("since_2022", "2022-01-01", "2026-11-14")]
# Pre-registered pass criteria (PROTOCOL.md "Fixed evaluation") — unchanged
PASS = dict(cagr=0.20, max_dd=0.35, turnover=4.0, phase_spread=0.06, min_days=30)


def load(path):
    df = pd.read_csv(path)
    if not {"date", "asset", "open", "close"} <= set(df):
        raise ValueError("CSV requires date,asset,open,close")
    df["date"] = pd.to_datetime(df["date"], utc=True).dt.normalize()
    if df.duplicated(["date", "asset"]).any(): raise ValueError("duplicate bars")
    if not df.asset.isin(ASSETS).all(): raise ValueError("unknown asset")
    if (df[["open", "close"]] <= 0).any().any(): raise ValueError("nonpositive price")
    op = df.pivot(index="date", columns="asset", values="open").reindex(columns=ASSETS)
    cl = df.pivot(index="date", columns="asset", values="close").reindex(columns=ASSETS)
    days = pd.date_range(op.index.min(), op.index.max(), freq="D", tz="UTC")
    return op.reindex(days), cl.reindex(days)


def validate(op, cl):
    """Data audit: per asset first/last day, missing days after listing, close→next-open gaps, extreme daily moves."""
    out = {}
    for a in ASSETS:
        c, o = cl[a], op[a]
        first, last = c.first_valid_index(), c.last_valid_index()
        if first is None: out[a] = {"status": "NO DATA"}; continue
        live = c.loc[first:last]
        gap = (o.shift(-1) / c - 1).loc[first:last].dropna()
        ret = live.pct_change().dropna()
        out[a] = {"first": str(first.date()), "last": str(last.date()), "days": int(live.notna().sum()),
                  "missing_after_listing": int(live.isna().sum()), "missing_open": int(o.loc[first:last].isna().sum()),
                  "max_abs_close_to_next_open": float(gap.abs().max()) if len(gap) else 0.0,
                  "close_to_next_open_over_1pct": int((gap.abs() > .01).sum()),
                  "daily_moves_over_40pct": int((ret.abs() > .40).sum())}
    return out


def _eligible(cl, day):
    """Assets passing the absolute filters at the close of `day`: (score, asset, vol30)."""
    h = cl.loc[:day]
    if len(h) < 201: return []
    out = []
    for asset in ASSETS:
        s = h[asset].dropna()
        if len(s) < 201 or s.index[-1] != day: continue
        if (s.index[-201:].to_series().diff().iloc[1:] != pd.Timedelta(days=1)).any(): continue  # missing data → not eligible
        ret = s.pct_change()
        gain = s.iloc[-1] / s.iloc[-91] - 1                       # 90-day cumulative return
        vol90 = ret.iloc[-90:].std(ddof=1)                         # sample std of 90 daily simple returns
        vol30 = ret.iloc[-30:].std(ddof=1)
        if gain > 0 and s.iloc[-1] > s.iloc[-200:].mean() and vol90 > 0 and vol30 > 0:  # close > 200-day SMA
            out.append((gain / vol90, asset, vol30))
    out.sort(key=lambda v: (-v[0], v[1]))                          # equal scores broken alphabetically
    return out


def _weights(pick):
    if not pick: return {}
    if len(pick) == 1: return {pick[0][1]: .5}                     # one eligible: 50% asset, 50% cash
    a, b = pick[:2]
    w = np.clip((1 / a[2]) / ((1 / a[2]) + (1 / b[2])), .4, .6)   # inverse 30-day vol, capped 40%–60%
    return {a[1]: float(w), b[1]: float(1 - w)}


def targets(cl, day, rng=None):
    el = _eligible(cl, day)
    if rng is not None and len(el) > 2:                            # random control: uniform choice among eligible, same filters/weights
        idx = sorted(rng.choice(len(el), size=2, replace=False)); el = [el[i] for i in idx]
    return _weights(el[:2])


def run(op, cl, offset=0, slippage=SLIP, delay=1, fee=FEE, rng=None):
    dates = cl.index
    first = START + pd.Timedelta(days=offset)
    signals, d = {}, first
    while d <= dates[-1]:
        if d in dates: signals[d + pd.Timedelta(days=delay)] = (d, targets(cl, d, rng))
        d += pd.Timedelta(days=30)
    units = {a: 0. for a in ASSETS}; cash = 1.; records = []; trades = []; costs = 0.
    for day in dates:
        if day < START: continue
        if day in signals:
            sig_day, desired = signals[day]
            px = op.loc[day]
            if any(pd.isna(px[a]) for a in set(desired) | {a for a in ASSETS if units[a] > 0}):
                raise ValueError(f"missing execution open {day}")
            nav = cash + sum(units[a] * px[a] for a in ASSETS if units[a] > 0)   # pre-trade NAV at the execution open
            for a in ASSETS:                                                       # sell first
                target = desired.get(a, 0) * nav
                current = units[a] * px[a] if units[a] > 0 else 0.
                if current > target + 1e-12:
                    qty = (current - target) / px[a]
                    units[a] -= qty; cash += qty * px[a] * (1 - fee - slippage); costs += qty * px[a] * (fee + slippage)
                    trades.append((str(day.date()), str(sig_day.date()), a, "SELL", float(qty * px[a]), float(nav)))
            buys = [(a, max(0., desired[a] * nav - units[a] * px[a])) for a in ASSETS if a in desired]
            buys = [(a, v) for a, v in buys if v > 1e-12]
            scale = min(1., cash / (sum(v for _, v in buys) * (1 + fee + slippage))) if buys else 1.
            for a, v in buys:
                spent = v * scale; units[a] += spent / px[a]
                cash -= spent * (1 + fee + slippage); costs += spent * (fee + slippage)
                trades.append((str(day.date()), str(sig_day.date()), a, "BUY", float(spent), float(nav)))
        px = cl.loc[day]
        if any(pd.isna(px[a]) for a in ASSETS if units[a] > 0):
            raise ValueError(f"missing marking close {day}")
        nav = cash + sum(units[a] * px[a] for a in ASSETS if units[a] > 0)
        records.append((day, nav, sum(units[a] * px[a] for a in ASSETS if units[a] > 0) / nav, costs))
    eq = pd.DataFrame(records, columns=["date", "nav", "exposure", "cum_costs"]).set_index("date")
    return eq, pd.DataFrame(trades, columns=["date", "signal_date", "asset", "side", "notional", "pretrade_nav"])


def buy_and_hold(op, cl, weights, start=None, fee=FEE, slippage=SLIP):
    """Buy `weights` once at the open of `start` (default: first day all weighted assets have an open), never rebalance."""
    assets = [a for a, w in weights.items() if w > 0]
    if start is None: start = max(op[a].first_valid_index() for a in assets)
    px = op.loc[start]; units = {a: weights[a] / (px[a] * (1 + fee + slippage)) for a in assets}
    cash = 1 - sum(weights[a] for a in assets)
    rows = [(d, cash + sum(units[a] * cl.loc[d, a] for a in assets)) for d in cl.index if d >= start]
    eq = pd.DataFrame(rows, columns=["date", "nav"]).set_index("date"); eq["exposure"] = 1.; eq["cum_costs"] = 0.
    return eq, pd.DataFrame(columns=["date", "signal_date", "asset", "side", "notional", "pretrade_nav"])


def metrics(eq, trades, start, end):
    st, en = pd.Timestamp(start, tz="UTC"), pd.Timestamp(end, tz="UTC")
    nav = eq["nav"]; s = nav.loc[(nav.index >= st) & (nav.index < en)]
    if len(s) < 2: return {"status": "INCONCLUSIVE", "days": int(len(s))}
    prev = nav.loc[nav.index < s.index[0]]
    base = float(prev.iloc[-1]) if len(prev) else float(s.iloc[0])       # NAV at the close before the window
    path = pd.concat([pd.Series([base], index=[s.index[0] - pd.Timedelta(days=1)]), s])
    yrs = len(s) / 365.25
    cagr = float((s.iloc[-1] / base) ** (1 / yrs) - 1)
    dd = float((path / path.cummax() - 1).min())
    rets = path.pct_change().dropna()
    sharpe = float(rets.mean() / rets.std() * np.sqrt(365)) if rets.std() > 0 else None
    t = trades.loc[(trades.date >= start) & (trades.date < end)]
    turnover = float((t.notional / t.pretrade_nav).sum() / yrs) if len(t) else 0.
    c = eq["cum_costs"]; cost = float((c.loc[s.index[-1]] - (c.loc[prev.index[-1]] if len(prev) else 0.)) / base)
    return dict(status="MEASURED", first=str(s.index[0].date()), last=str(s.index[-1].date()), days=int(len(s)), cagr=cagr,
                max_drawdown=dd, sharpe=sharpe, annual_turnover=turnover, trades=int(len(t)), cost_pct_of_start=cost,
                exposure=float(eq["exposure"].loc[s.index].mean()))


def periodic(eq, freq):
    nav = eq["nav"]; key = nav.index.strftime("%Y" if freq == "Y" else "%Y-%m")
    last = nav.groupby(key).last(); first = nav.groupby(key).first()
    prev = pd.concat([first.iloc[:1], last.iloc[:-1]]); prev.index = last.index
    return (last / prev - 1).round(4).to_dict()


def verdict(res, bench_eq3):
    """PROTOCOL.md primary criteria; each item PASS/FAIL/INCONCLUSIVE; overall FAIL if any FAIL, else INCONCLUSIVE if any, else PASS."""
    b = res["base"]; mind = PASS["min_days"]
    def ok(key): return b[key]["status"] == "MEASURED" and b[key]["days"] >= mind
    items = {}
    items["1_cagr"] = ("INCONCLUSIVE" if not (ok("since_2022") and ok("test")) else
                       "PASS" if b["since_2022"]["cagr"] >= PASS["cagr"] and b["test"]["cagr"] >= PASS["cagr"] else "FAIL")
    dd = [b[k]["max_drawdown"] for k in ("training", "validation", "test") if ok(k)]
    items["2_max_dd_each"] = ("FAIL" if any(-x > PASS["max_dd"] for x in dd) else
                              "INCONCLUSIVE" if len(dd) < 3 else "PASS")
    items["3_turnover"] = ("INCONCLUSIVE" if not ok("since_2022") else "PASS" if b["since_2022"]["annual_turnover"] < PASS["turnover"] else "FAIL")
    e = bench_eq3["since_2022"]
    items["4_vs_eq3_cagr_and_sharpe"] = ("INCONCLUSIVE" if not ok("since_2022") or e["status"] != "MEASURED" else
                                         "PASS" if b["since_2022"]["cagr"] > e["cagr"] and (b["since_2022"]["sharpe"] or -9) > (e["sharpe"] or -9) else "FAIL")
    overall = "FAIL" if "FAIL" in items.values() else "INCONCLUSIVE" if "INCONCLUSIVE" in items.values() else "PASS"
    return {"items": items, "overall": overall}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--csv", required=True)
    p.add_argument("--out", default="slow_core_results.json")
    p.add_argument("--outdir", default=None, help="write equity/trades CSVs here")
    p.add_argument("--random-trials", type=int, default=200)
    args = p.parse_args()
    op, cl = load(args.csv)
    results = {"data_audit": validate(op, cl), "protocol_pass": PASS, "fees": {"fee": FEE, "slippage": SLIP}}
    runs = {}
    for name, offset, slip, delay, fee in [("base", 0, SLIP, 1, FEE), ("double_slippage", 0, 2 * SLIP, 1, FEE), ("delay_two_days", 0, SLIP, 2, FEE),
                                           ("info_fee_0.10pct", 0, SLIP, 1, .001)] + [(f"phase_{i}", i, SLIP, 1, FEE) for i in range(1, 30)]:
        eq, tr = run(op, cl, offset, slip, delay, fee); runs[name] = (eq, tr)
        results[name] = {key: metrics(eq, tr, a, b) for key, a, b in SPLITS}
    btc_m = buy_and_hold(op, cl, {"BTC": 1.}, start=START + pd.Timedelta(days=1))          # matched start: first execution open
    btc_l = buy_and_hold(op, cl, {"BTC": 1.})                                               # from data start (training coverage)
    eq3 = buy_and_hold(op, cl, {a: 1 / 3 for a in ASSETS})                                  # first day all three exist, no rebalancing
    for name, (eq, tr) in {"bench_btc_matched": btc_m, "bench_btc_full": btc_l, "bench_eq3_passive": eq3}.items():
        runs[name] = (eq, tr); results[name] = {key: metrics(eq, tr, a, b) for key, a, b in SPLITS}
    # 30 phase offsets (0..29): CAGR spread since 2022 (secondary robustness)
    cg = [results["base" if i == 0 else f"phase_{i}"]["since_2022"]["cagr"] for i in range(30)]
    results["phase_robustness"] = {"min": min(cg), "max": max(cg), "median": float(np.median(cg)), "spread": max(cg) - min(cg),
                                   "spread_lt_6pp": (max(cg) - min(cg)) < PASS["phase_spread"]}
    # random-selection control
    rc = []
    for seed in range(args.random_trials):
        eq, tr = run(op, cl, rng=np.random.default_rng(seed)); m = metrics(eq, tr, "2022-01-01", "2026-11-14"); rc.append(m["cagr"])
    base_c = results["base"]["since_2022"]["cagr"]
    results["random_control"] = {"trials": len(rc), "median_cagr": float(np.median(rc)), "pct_trials_below_strategy": float(np.mean([x < base_c for x in rc])),
                                 "identical_trials": int(sum(abs(x - base_c) < 1e-12 for x in rc))}
    results["yearly"] = {k: periodic(runs[k][0], "Y") for k in ("base", "bench_btc_matched", "bench_eq3_passive")}
    results["monthly_base"] = periodic(runs["base"][0], "M")
    results["verdict"] = verdict(results, results["bench_eq3_passive"])
    if args.outdir:
        os.makedirs(args.outdir, exist_ok=True)
        runs["base"][0].to_csv(os.path.join(args.outdir, "equity_base.csv"), float_format="%.6f")
        runs["base"][1].to_csv(os.path.join(args.outdir, "trades_base.csv"), index=False, float_format="%.6f")
    with open(args.out, "w") as f: json.dump(results, f, indent=2)
    print(json.dumps({"base": results["base"], "verdict": results["verdict"]}, indent=2))


if __name__ == "__main__":
    main()
