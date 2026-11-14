"""Automated tests for backtest.py on deterministic synthetic data (python -m unittest test_backtest.py)."""
import os, sys, tempfile, unittest
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
import backtest as bt

D0 = pd.Timestamp("2021-01-01", tz="UTC")


def frame(series, start=D0):
    """series: {asset: np.array of closes}; open = previous close (first open = close)."""
    rows = []
    for a, c in series.items():
        for i, x in enumerate(c):
            if np.isnan(x): continue
            o = c[i - 1] if i and not np.isnan(c[i - 1]) else x
            rows.append((start + pd.Timedelta(days=i), a, o, x))
    df = pd.DataFrame(rows, columns=["date", "asset", "open", "close"])
    f = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False); df.to_csv(f.name, index=False); return f.name


def wave(n, g, a, ph, base):
    i = np.arange(n); return base * (1 + g) ** i * (1 + a * np.sin(i / 40 + ph)) * (1 + .02 * np.sin(i * 1.7 + ph))


N = 1500
BASE = {"BTC": wave(N, .0012, .25, 0, 100), "ETH": wave(N, .0010, .35, 1, 50), "SOL": wave(N, .0015, .45, 2, 20)}


class TestBacktest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.op, cls.cl = bt.load(frame(BASE))

    def test_rebalance_dates_every_30_days_executed_next_open(self):
        eq, tr = bt.run(self.op, self.cl)
        sig = sorted(set(pd.to_datetime(tr.signal_date)))
        for a, b in zip(sig, sig[1:]): self.assertEqual((b - a).days % 30, 0)
        for r in tr.itertuples(): self.assertEqual((pd.Timestamp(r.date) - pd.Timestamp(r.signal_date)).days, 1)
        self.assertTrue(all(((pd.Timestamp(s) - pd.Timestamp("2022-01-01")).days % 30) == 0 for s in tr.signal_date))
        _, tr2 = bt.run(self.op, self.cl, delay=2)
        for r in tr2.itertuples(): self.assertEqual((pd.Timestamp(r.date) - pd.Timestamp(r.signal_date)).days, 2)
        _, tr3 = bt.run(self.op, self.cl, offset=7)
        self.assertTrue(all(((pd.Timestamp(s) - pd.Timestamp("2022-01-08")).days % 30) == 0 for s in tr3.signal_date))

    def test_no_lookahead(self):
        T = pd.Timestamp("2023-06-10", tz="UTC"); k = (T - D0).days
        alt = {a: np.concatenate([c[:k + 1], c[k + 1:] * (3 if a == "SOL" else .3)]) for a, c in BASE.items()}
        op2, cl2 = bt.load(frame(alt))
        e1, t1 = bt.run(self.op, self.cl); e2, t2 = bt.run(op2, cl2)
        pd.testing.assert_series_equal(e1.nav.loc[:T], e2.nav.loc[:T])
        self.assertEqual(t1[t1.date <= str(T.date())].to_dict("records"), t2[t2.date <= str(T.date())].to_dict("records"))
        # targets on day d use only closes up to d
        d = pd.Timestamp("2023-03-01", tz="UTC")
        self.assertEqual(bt.targets(self.cl, d), bt.targets(self.cl.loc[:d], d))

    def test_weights_cap_single_none_and_tiebreak(self):
        self.assertEqual(bt._weights([]), {})
        self.assertEqual(bt._weights([(1, "ETH", .02)]), {"ETH": .5})
        w = bt._weights([(2, "BTC", .01), (1, "SOL", .05)]); self.assertAlmostEqual(w["BTC"], .6); self.assertAlmostEqual(w["SOL"], .4)
        w = bt._weights([(2, "BTC", .02), (1, "ETH", .025)]); self.assertAlmostEqual(w["BTC"], (1 / .02) / (1 / .02 + 1 / .025))
        n = 400; up = 100 * 1.003 ** np.arange(n)
        op, cl = bt.load(frame({"BTC": up, "ETH": up / 2, "SOL": up / 5}))                 # identical scores → alphabetical: BTC, ETH
        el = bt._eligible(cl, cl.index[-1]); self.assertEqual([e[1] for e in el[:2]], ["BTC", "ETH"])
        dn = 100 * .998 ** np.arange(n)
        op, cl = bt.load(frame({"BTC": up, "ETH": dn, "SOL": dn / 3})); self.assertEqual(bt.targets(cl, cl.index[-1]), {"BTC": .5})
        op, cl = bt.load(frame({"BTC": dn, "ETH": dn, "SOL": dn})); self.assertEqual(bt.targets(cl, cl.index[-1]), {})

    def test_sma200_and_200_observations_and_missing_data(self):
        n = 230; c = 100 * 1.002 ** np.arange(n)
        op, cl = bt.load(frame({"BTC": c, "ETH": c, "SOL": np.concatenate([np.full(n - 150, np.nan), c[-150:]])}))
        self.assertNotIn("SOL", bt.targets(cl, cl.index[-1]))                              # fewer than 201 observations
        c2 = c.copy(); c2[-1] = c2[-200:].mean() * .99                                       # below 200-day SMA (but 90-day return > 0)
        op, cl = bt.load(frame({"BTC": c2, "ETH": c, "SOL": c}))
        self.assertNotIn("BTC", bt.targets(cl, cl.index[-1]))
        c3 = c.copy(); c3[n - 50] = np.nan                                                  # missing day inside the window
        op, cl = bt.load(frame({"BTC": c3, "ETH": c, "SOL": c}))
        self.assertNotIn("BTC", bt.targets(cl, cl.index[-1]))

    def test_costs_round_trip_and_turnover(self):
        n = 800; flat = np.full(n, 100.)
        op, cl = bt.load(frame({"BTC": 100 * 1.002 ** np.arange(n), "ETH": flat, "SOL": flat}))
        eq, tr = bt.run(op, cl)
        first = tr.iloc[0]; self.assertEqual(first.side, "BUY"); self.assertAlmostEqual(first.pretrade_nav, 1.)
        # one asset eligible (BTC) → 50% invested; cost of the first buy = 0.5 × (fee + slippage)
        d = pd.Timestamp(first.date, tz="UTC")
        self.assertAlmostEqual(eq.cum_costs.loc[d], .5 * (bt.FEE + bt.SLIP) / (1 + bt.FEE + bt.SLIP) * (1 + bt.FEE + bt.SLIP), places=12)
        m = bt.metrics(eq, tr, "2022-01-01", "2026-01-01")
        exp = (tr.notional / tr.pretrade_nav).sum() / m["days"] * 365.25
        self.assertAlmostEqual(m["annual_turnover"], exp)
        _, tr2 = bt.run(op, cl, slippage=2 * bt.SLIP); e2, _ = bt.run(op, cl, slippage=2 * bt.SLIP)
        self.assertLess(e2.nav.iloc[-1], eq.nav.iloc[-1])

    def test_metrics_include_first_day_and_buy_and_hold(self):
        idx = pd.date_range("2022-01-01", periods=5, freq="D", tz="UTC")
        eq = pd.DataFrame({"nav": [1, 1.1, 1.21, 1.21, 1.21], "exposure": 1., "cum_costs": 0.}, index=idx)
        tr = pd.DataFrame(columns=["date", "signal_date", "asset", "side", "notional", "pretrade_nav"])
        m = bt.metrics(eq, tr, "2022-01-02", "2022-01-06")
        self.assertAlmostEqual((1 + m["cagr"]) ** (4 / 365.25), 1.21, places=9)              # 1.0 → 1.21 including the first day's return
        e, _ = bt.buy_and_hold(self.op, self.cl, {a: 1 / 3 for a in bt.ASSETS})
        self.assertEqual(e.index[0], max(self.op[a].first_valid_index() for a in bt.ASSETS))
        self.assertTrue((e.exposure == 1).all())

    def test_random_control_keeps_filters(self):
        eq, tr = bt.run(self.op, self.cl, rng=np.random.default_rng(1))
        for r in tr[tr.side == "BUY"].itertuples():
            el = [x[1] for x in bt._eligible(self.cl, pd.Timestamp(r.signal_date, tz="UTC"))]
            self.assertIn(r.asset, el)


if __name__ == "__main__":
    unittest.main()
