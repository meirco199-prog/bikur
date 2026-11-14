# Slow Core Momentum — research report
Status: **NOT RUN ON MARKET DATA / INCONCLUSIVE** (2026-11-14).

## Implemented
- Isolated branch `research/slow-core-momentum`, no changes to live or paper strategies.
- Frozen strategy specification in PROTOCOL.md.
- Research-only daily CSV simulator in backtest.py: 30-calendar-day signal cycle, 90-day return and volatility ranking, 200-day SMA filter, inverse-vol weights with 60% cap, 50% single-asset allocation, zero-yield cash, next-open execution, fees, daily equity, phase-offset and cost/delay sensitivity.
- Requires an independently verified daily OHLC data export with historical SOL availability. No market data was supplied to this runner.

## Pending before any verdict
1. Validate code with deterministic synthetic fixtures, then independently reproduce calculations on real OHLC data; audit date anchoring and signal timestamps.
2. Add same-date BTC passive and equal-weight BTC/ETH/SOL buy-and-hold benchmarks with fair SOL inception handling.
3. Import frozen XSRA-7 historical series if available; **never touch its live paper tracking**.
4. Add randomized eligible-asset selection controls and a separate illustrative after-tax model.
5. Check monthly/annual equity, trade logs, turnover, liquidity, costs and strict four-part pass criteria.
6. Verify daily price vendor timestamps and market-day continuity.

## Results table
| Strategy | CAGR 2022+ | CAGR test | MDD train/validation/test | Sharpe | Turnover |
|---|---|---|---|---|---|
| Slow Core Momentum | Not measured | Not measured | Not measured | Not measured | Not measured |
| BTC buy-and-hold | Not measured | Not measured | Not measured | Not measured | N/A |
| Equal-weight core passive | Not measured | Not measured | Not measured | Not measured | N/A |
| XSRA-7 historical | Not imported | Not imported | Not imported | Not imported | Not imported |

**Verdict: INCONCLUSIVE** — no fabricated performance figures and no claim of success. No real trades or scheduled jobs executed.
