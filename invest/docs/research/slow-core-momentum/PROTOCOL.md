# Slow Core Momentum — locked protocol v1
Status: PRE-REGISTERED, NOT RUN. Research only. No trades, deployments, scheduled jobs, or changes to XSRA-7 / PR #264.

## Frozen strategy
Universe BTC ETH SOL, USD-denominated spot daily OHLC; historical listing dates, no forward fill before listing. Stablecoin cash has 0% yield. Decision every 30 calendar days from 2022-01-01 UTC (and separately phase offsets 0..29 days), at close; execute at next daily open. 90-day cumulative return > 0 and close > 200-day simple moving average; 200 observations required. Rank eligible by 90-day return divided by sample standard deviation of 90 daily simple returns; select top two. If two: weights inverse 30-day daily-return volatility, capped at 60% each (so 40%-60%). If one: 50% asset, 50% cash. If none: all cash. Equal scores broken alphabetically. Existing positions held until next rebalance. Fees 0.05% and slippage 0.02% PER traded side. Cash 0%. No leverage.
Benchmark BTC buy-and-hold; equal-weight BTC/ETH/SOL passive with initial allocation at the first date all three are available and held without further rebalancing (and a matched-start BTC benchmark); XSRA-7 historical results are NOT inferred or synthesized. Only use an independently obtained frozen trade/equity series and common dates/cost assumptions for XSRA-7 comparison.

## Fixed evaluation
Training 2016-07-01 to 2022-07-01; validation 2022-07-01 to 2024-09-01; test 2024-09-01 to 2026-11-14 (exclusive end, available data permitting). Aggregate from 2022-01-01. Warmup does not count toward performance. Report each period's actual coverage; never silently extrapolate.
Primary pass only if all: (1) CAGR >=20% from 2022-01-01 and in test; (2) max drawdown <=35% in EACH training/validation/test; (3) annual turnover <4x; (4) CAGR and Sharpe both greater than equal-weight three-core passive on identical investable dates. Record pass/fail/INCONCLUSIVE if insufficient data. Report 30 phase-offset CAGR spread <6 percentage points as secondary robustness, not substitute for primary. Double SLIPPAGE only, plus one extra day execution delay; do not select winners.
Turnover = sum absolute traded dollar notional / pretrade NAV per rebalance, annualized by calendar years. Sharpe daily returns, annualized sqrt(365), zero risk-free. Drawdown based on daily marked-to-market NAV, not monthly endpoints.
Random selection benchmark: among eligible assets select uniformly up to two, preserving all absolute filters and weighting; multiple seeded trials and identical time windows.
Tax: pre-tax is decision metric. A separate illustrative after-tax comparison may model 25% realized gains with loss carryforwards; do not imply this is exact Israeli tax liability or tax advice. Do not alter trading signals to optimize taxes.

## Audit requirements
Timestamp/data availability checks; no close-to-open lookahead; missing data detection; data vendor provenance; trade log; equity curves; monthly/yearly returns; costs; risk; liquidity; dates and fee comparability. No claims of completed results until real data and reproducible output exist.
