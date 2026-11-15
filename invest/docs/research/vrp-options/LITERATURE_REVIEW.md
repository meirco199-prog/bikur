# Scientific literature note — VRP Defined-Risk BTC Options (2026-11-15)
**Scope:** Stage 2 only. No backtest, no simulated performance, no trading.

## Existing repository research
Read `invest/docs/research/SUMMARY.md` and `invest/docs/RESEARCH_RESULTS.md` on 2026-11-15. They document extensive crypto momentum, trend, intraday volatility breakout, crash/funding and other research. They do **not** document a complete, reproducible defined-risk Deribit BTC options Iron Condor backtest. Previous apparent advantages often vanished after cost/liquidity/robustness tests, so the same skepticism applies.

## Economic mechanism
The economic hypothesis is that traders pay for convex protection against BTC uncertainty, leaving option implied volatility/variance typically rich relative to subsequently realized volatility. A systematic seller may earn compensation for warehousing crash/gap/vega/gamma/liquidity/collateral risk. The measured IV of the last 30 days' options is **not** an unbiased guaranteed forecast of the next 30 days; even IV30/RV30 > 1.20 can occur before unprecedented realized moves. A four-leg Iron Condor sells both put/call premium and purchases wings to define terminal risk, but those wings can make the *net premium* marginal after spread/fees. It is generally NOT delta-neutral, its delta changes along the path, and its margin-currency risks may dominate.

## Academic evidence and limitations
1. **Vladimir Lucic & Artur Sepp, 2024, _Valuation and Hedging of Cryptocurrency Inverse Options_, Quantitative Finance 24(7), 851–869;** DOI https://doi.org/10.1080/14697688.2024.2364804 . Deribit empirical analysis reports option volatility selling risk premia in delta-hedged strategies and demonstrates importance of currency accounting and inverse contracts. **Cannot be directly extrapolated** to static four-leg unhedged condors or to net profits at $50k size.
2. **Christina Atanasova, Terrel Miao, Ignacio Segarra & Frederick Willeboordse, 2026, _What Do Crypto Options Tell Us? Risk Premia Implied by BTC Option Prices_,** SSRN https://ssrn.com/abstract=6771170 . Deribit option-derived VRP was reported positive and persistent; higher-order risk and volatility-of-volatility significant. The existence of pricing premia **does not establish executable excess returns** on 25/10-delta spread structures.
3. **_Pricing Kernels and Risk Premia implied in Bitcoin Options_, 2023, Risks,** https://doi.org/10.3390/risks11050085 : reports historically substantial implied-realized volatility premium in the sample; emphasizes volatility clustering and estimation uncertainty. Regime dependence cannot be dismissed.
4. **_The price of crypto-market volatility risk_, 2026**, https://doi.org/10.1016/j.ribaf.2026.103374 : examines cross-sectional crypto volatility beta and finds nonuniform/negative pricing of extreme volatility-beta exposures. **Not an Iron Condor test**, but counterweights simplistic claims of a uniform positive VRP exploitable by all positions.

## Risks / plausible failure mechanisms
- Short convexity in abrupt declines **and** rallies: max expiry payoff risk is defined for completed spreads but gap, adverse mark-to-market, forced liquidation and orphaned legs still matter.
- High volatility / skew can rationally price jump and tail risks; high IV/RV can indicate *imminent* risk, not mispricing.
- Wing liquidity and quoted depth can be insufficient, especially older timestamps; multi-leg executable cost may exceed expected premium.
- BTC inverse settlement and collateral conversion can create unhedged BTC/USD exposure and margin constraints. BTC USDC-settled linear options began 2025-08-19, not earlier (https://insights.deribit.com/education/usdc-settled-btc-eth-options-launch/).
- From 2026-08-01 BTC inverse option settlement uses a two-step futures mechanism; inspect historical terms rather than current terms retroactively (https://support.deribit.com/hc/en-us/articles/31424939096093-Inverse-Options).
- Academic samples, model assumptions and statistical uncertainty are insufficient to claim 20% CAGR or <=35% DD.

**Interpretation:** Positive prior for the *existence of risk compensation*, zero verified evidence here that this exact entry, 4-leg payoff, 8% sizing and $50k executable strategy can deliver the user's risk/return target. Data Gate is decisive.
