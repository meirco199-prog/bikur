# VRP: Defined-Risk Bitcoin Options — PROTOCOL v1.1

**Status:** LOCKED BEFORE BACKTEST. **Authorized execution in this task:** stages 1–3 only, **STOP AT DATA GATE**.  
**Repository:** `meirco199-prog/bikur`  
**Branch:** `research/vrp-defined-risk-options`  
**Path:** `invest/docs/research/vrp-options/`  
**Version date:** 2026-11-15.

## Purpose
Scientific attempt to falsify the claim that a defined-risk Bitcoin options Iron Condor collecting volatility-risk premium can achieve **at least 20% pre-tax CAGR** with **no more than 35% maximum drawdown** after executable costs. Neither outcome is assumed. No actual trading.

## 1. Repository isolation and freezing
- All work exclusively on `research/vrp-defined-risk-options`. The main branch must not be modified by this project; preserve XSRA-7, the separate Bybit tracker, Slow Core Momentum, all current bots, deployments and schedules unchanged.
- Save this protocol and evaluation criteria in Git **before** looking at strategy performance.
- No real trading, broker credentials or automated merges.
- **Authorization stops after a scientific literature review and a Data Gate report.** Do not write a backtest engine, calculate simulated returns or start paper trading until a separate explicit instruction.

## 2. Prior work and academic review
Read `invest/docs/research/SUMMARY.md` and `invest/docs/RESEARCH_RESULTS.md`; check whether the exact options strategy was evaluated. Review research on BTC implied-versus-realized volatility, option variance risk premium, hedging demand, skew, gamma, vega, delta, tail exposure, liquidity, inverse-accounting and changing market structure. Explicitly seek counterevidence and failed implementations. Academic evidence for delta-hedged short volatility is not automatically evidence for unhedged Iron Condor.

## 3. Mandatory Data Gate before any simulation
Inspect actual data availability from Deribit, Tardis.dev, Amberdata and credible academic datasets, prioritizing **no-cost Tardis first-of-month samples** during 2020–2026.
- Check 12:00–12:05 UTC on the first of each month for actual listed BTC option instruments, expiries, strikes, **timestamped bid and ask**, **per-leg available depth**, Greeks/IV or independently reconstructible inputs, and spot/index.
- Assess continuous daily marked-to-market values, historical fee schedule, contract specs, inverse margin/settlement, data anomalies, and combo/multi-leg execution evidence.
- L2 snapshots/updates can support aggressive order book walking; L3 is not intrinsically required. Passive order queue fills must not be presumed.
- First-day samples may establish *entry liquidity feasibility* but **do not by themselves provide daily MTM for a full holding period**.
- Executable fills must not be inferred from option mid, stale quotes, theoretical prices or trade prints alone. Audit timestamp timezone, original event ordering, missingness and exchange feed incidents.
- Data Gate verdict: **PASS** iff historical execution costs, order availability, daily portfolio valuation and margin mechanics can be estimated credibly; **FAIL** if evidence proves the strategy impossible to execute as stipulated; otherwise **INCONCLUSIVE**. A network or vendor access error is not evidence that the data do not exist.
- **If not PASS stop. Do not write or run a backtest.** No paid purchase without approval. Report verified facts, unverified hypotheses, specific missing data, attributable costs, free feasibility checks and recommendation.

## 4. Contract product separation
Primary historical market: **Deribit BTC inverse options**, denominated/settled in BTC; calculate full USD NAV including any BTC collateral. BTC linear USDC options launched **19 August 2025**; they must not be projected back into prior years. May research linear separately if independently requested and data support it, without post-hoc winner selection. Follow historically applicable settlement and margin rules (including 2026 changes).

## 5. Frozen main strategy rules — no optimization
- Underlying **BTC only**; exchange **Deribit**; four-leg **Iron Condor** with defined maximum expiry loss.
- Decision **1st calendar day of each month at 12:00 UTC**; execute **no earlier than 12:05 UTC** using then-available quotes.
- Pick expiry nearest 30 days within **25–35 days**; if none, skip.
- Four legs, same expiry: **short put ~−25 delta; long put ~−10 delta; short call ~+25 delta; long call ~+10 delta**. Closest available actual listed strike; deterministic tie break must be documented before performance test.
- Single entry filter **IV30/RV30 ≥ 1.20**. IV30 is known-time ~30d ATM implied volatility. RV30 is realized daily BTC return volatility from **preceding 30 days**, annualized with 365. Never use future volatility to decide.
- If filter fails, required contracts/quotes unavailable, or position already open: **cash** / no new position. **No overlapping positions**.
- **Hold to expiry**, no discretionary stop, no rolling, no retuning. Cash returns **0%**.
- Note: benchmark, randomizations, diagnostics and stress scenarios do not authorize signal optimization.

## 6. Risk accounting and collateral
- Reference portfolio **USD 50,000**. Max **theoretical per-trade expiry loss 8%** of then-current portfolio NAV **including fees and execution costs**.
- Model exact four-leg expiry payoff and delta/vega/gamma/theta exposures, daily MTM, changing collateral requirement, inverse BTC conversion, forced liquidation, partial fill, venue/counterparty exposure.
- Distinguish theoretical defined-risk expiry payoff from entire-portfolio risks, particularly BTC-collateral exposure and execution of incomplete hedges. Do not claim 50–70% portfolio drawdown from gamma alone where a complete funded spread truly limits max expiry loss to 8%.
- Daily portfolio NAV and max drawdown, **not monthly expiry marks**. If daily values cannot be obtained: INCONCLUSIVE, not an optimistic max DD.

## 7. Realistic execution
- Sell at available **bid**, buy at available **ask**, walk actual order book levels for the complete required size. Check all four legs; do not assert atomic combo fills without verified mechanism/data.
- If sequential legs, model or bound legging risk, timestamps and partial fills; if impossible to bound credibly: INCONCLUSIVE.
- Include applicable per-period trading, spread, slippage, settlement, collateral and currency conversion fees. Also assess **USD 100,000** feasibility.

## 8. Pre-specified benchmarks
Compare matched dates/fees and risk where feasible:
1. BTC buy-and-hold;
2. zero-yield cash;
3. **identical Iron Condor without IV/RV filter**;
4. randomized calendar entries with the same number of positions and permissible markets;
5. BTC/cash mix with comparable risk;
6. other **defined-risk** short-vol reference if execution and maximum loss are truly comparable.
Never treat naked straddle/strangle as equal-risk to an Iron Condor.

## 9. Economic attribution
Decompose observed P&L by delta, gamma, theta, vega, skew, liquidity and costs. Does the filter add value beyond generic short volatility or simply select rising/quiet BTC regimes? Realized volatility *after* entry is **diagnostic only**, never a signal.

## 10. Frozen stress tests
Base execution, **1.5x** and **2x** costs, **additional five-minute delay**, portfolio sizing **$50k/$100k**, year-by-year/regime outcomes, five worst trades, absence of five best trades (concentration diagnostic only). These are never used to choose more profitable thresholds.

## 11. Historical periods, conditional on data
Training 2020–2022; validation 2023–2024; historical test 2025–2026-11-14; cumulative since 2022-01-01. Report actual unbroken coverage. Historical test is **not** independent forward evidence. Account for scarce monthly trades and correlated macro regimes.

## 12. Pre-registered PASS conditions
All conditions must hold on accurately executable and mark-to-market data:
1. CAGR **≥ 20%** since 2022-01-01;
2. CAGR **≥ 20%** in historical test;
3. max DD **≤ 35%** in every adequately covered evaluation period;
4. net positive expectancy at **2x costs**;
5. better risk-adjusted performance than identical **unfiltered Iron Condor**;
6. adequate number of independent opportunities and coverage for meaningful inference;
7. executable capacity at **USD 50,000**;
8. no uncontrolled breach of defined risk from collateral, settlement or legging.
**FAIL** on sufficient data if criteria violated; **INCONCLUSIVE** on insufficient data. Historical PASS would only authorize consideration of a separate forward paper test, not real trading.

## 13. Final report when separately authorized
Scientific review; actual dataset/source/time coverage audit; immutable rules; reproducible tested code; performance by year; benchmarks; CAGR, Sharpe, Sortino, max DD, realized cost, feasible notional; per-trade and tail losses; BTC margin and forced liquidation risks; explicit PASS/FAIL/INCONCLUSIVE and next steps. No fabrication, no retuning after inspection.

## Current execution boundary — 2026-11-15
**Only stages 1, 2, 3 were requested.** A Data Gate result and literature memo may be committed to this research branch; **no backtest engine or performance simulation** is authorized.
