# DATA GATE REPORT — VRP Defined-Risk BTC Options, protocol v1.1
**Date:** 2026-11-15 UTC  
**Verdict:** **INCONCLUSIVE**. **STOP: no backtest authorized or performed.**

## Executive decision
Public authoritative documentation confirms that free first-of-month Deribit options files **should be available** from Tardis, with historical quotes, options chain and top-25 order-book snapshots. However **actual file records were not obtained from this execution environment**, and therefore availability for the needed BTC strikes, valid timely bids and offers, quantities and per-leg depth **at 12:00–12:05 UTC across 2020–2026 is not verified**. Furthermore free first-day-of-month samples alone cannot provide daily marked-to-market valuations through monthly option holding periods. There is no basis for realistic profit, CAGR, drawdown, fills or PASS at this stage.

## Direct availability checks attempted (NOT successful downloads)
- Tried direct dataset HTTP retrieval of `https://datasets.tardis.dev/v1/deribit/options_chain/2020/03/01/OPTIONS.csv.gz` using an execution-container HTTPS request. **Outcome:** DNS name resolution blocked in this environment. No data downloaded.
- Tried opening the above URL with web retrieval; **outcome:** binary gzip inaccessible via browsing interface.
- Tried `https://datasets.tardis.dev/v1/deribit/book_snapshot_25/2025/03/01/OPTIONS.csv.gz`; same binary-access limitation.
- Tried `https://api.tardis.dev/v1/exchanges/deribit`; access limitation.
- **Do not misclassify this tool/connectivity problem as absent vendor data**. Actual file GET/CRC, row counts, timestamps, symbol coverage, book coverage and completeness remain **unverified**.

## Verified through vendor/exchange documentation (NOT row-level audited)
1. Tardis Deribit coverage is documented from **2019-03-30** and docs list `OPTIONS` sample datasets for `trades`, `quotes`, `options_chain`, `book_snapshot_25`, with examples dated **2020-03-01**.
2. Tardis explicitly documents **no-key first-day-of-each-month CSV downloads**; datasets are gzip and split by calendar day, per dataset channel and exchange.
3. `options_chain` schema is documented with listed instrument, strike, expiration, bid/ask/IV/Greeks, but not proof those fields are non-null at the chosen execution minute.
4. `book_snapshot_25` is listed for OPTIONS; depth at the specified time, frequency, stale/empty snapshots and 10-delta wing liquidity remain untested.
5. Deribit public historical trade endpoints exist (e.g. https://history.deribit.com/api/v2/public/get_last_trades_by_instrument_and_time ) but trade prints are **not** reconstructable contemporaneous 4-leg L2 depth.
6. Deribit inverse BTC options are BTC-settled. BTC USDC linear options were added **2025-08-19** and cannot be back-projected into earlier years. The BTC inverse exercise/settlement process changed **2026-08-01**; accounting needs historically accurate rules.

## Reproducible sample URL manifest
All URLs are **vendor-documented format**, not proof of file/row content:
- 2020-03-01: https://datasets.tardis.dev/v1/deribit/options_chain/2020/03/01/OPTIONS.csv.gz
- 2020-09-01: https://datasets.tardis.dev/v1/deribit/quotes/2020/09/01/OPTIONS.csv.gz
- 2021-03-01: https://datasets.tardis.dev/v1/deribit/book_snapshot_25/2021/03/01/OPTIONS.csv.gz
- 2022-03-01: https://datasets.tardis.dev/v1/deribit/options_chain/2022/03/01/OPTIONS.csv.gz
- 2023-03-01: https://datasets.tardis.dev/v1/deribit/quotes/2023/03/01/OPTIONS.csv.gz
- 2024-03-01: https://datasets.tardis.dev/v1/deribit/book_snapshot_25/2024/03/01/OPTIONS.csv.gz
- 2025-03-01: https://datasets.tardis.dev/v1/deribit/book_snapshot_25/2025/03/01/OPTIONS.csv.gz
- 2026-03-01: https://datasets.tardis.dev/v1/deribit/options_chain/2026/03/01/OPTIONS.csv.gz

## Specific unresolved variables
| Need | Supported by published documentation | Verified on actual records? | Consequence |
|---|---|---|---|
| Exact listed monthly 25/10 delta four-leg BTC instruments | May be derived from chain | **No** | Cannot identify tradable legs |
| Fresh bid/ask **12:00–12:05 UTC** | Quotes documented | **No** | No executable credit |
| Top-25 depth at 12:05 | Snapshots documented | **No** | No size-capacity or walking-book model |
| Historical combo or staggered-leg execution | COMBOS feed may exist in more recent periods | **No** | Cannot bound legging risk |
| Daily continuous marks throughout ~30-day hold | First-day sample alone **insufficient** | **No** | No legitimate daily max DD |
| Historical BTC collateral and margin state | Exchange docs partially cover rules | **No** | Forced-liquidation risk unresolved |
| Synchronized raw timestamp and feed integrity | Vendor docs describe timestamps/order | **No** | Need file audit |

## Cost to obtain more data (published list, quote required)
Vendor: https://tardis.dev/ , Options category page (2026-11-15 search snapshot):
- **Free first-of-month samples: $0**, constrained to one day per month.
- **Solo Options: listed around $700 per month**; CSV downloads, annual billing includes **four years** of history, not the full 2020–2026 range. Monthly access typically only **four months**. An annual commitment at that advertised monthly rate approximates **$8,400**, subject to vendor terms.
- **Business Options: listed around $3,000 per month**, yearly billing accesses all historical records; annual cost approximately **$36,000** at the listed rate, subject to quotation.
- **Academic Options: listed around $350/month** with eligibility restrictions and quarterly/yearly minimum, generally not usable without proof of academic status.
- Other vendors (Amberdata and other reseller quotes): **cost NOT VERIFIED**, do not assert a specific dollar range.
- Ask provider about a *limited date-range/single-exchange historical extract or evaluation trial* before considering an expensive plan. Any purchase requires explicit authorization.

## What can be done for FREE (only after a session with dataset download access)
A. Download `options_chain`, `quotes`, `book_snapshot_25` for 1st-of-month samples in representative years 2020–2026.
B. Validate file integrity and row timestamps; restrict to 11:55–12:15 UTC; count available BTC inverse 25/10 delta strikes and check listed expiries 25–35 days.
C. Check positive bid/ask, quote age, spread relative to premium, displayed depth of all four options, and whether a $4k worst-case-loss position can fit (with actual contract lot increments) at opening.
D. Compare multiple calendar samples, report coverage by year and specifically detect missing 10-delta protective offers.
E. Determine whether any **no-cost** source provides daily synchronized option marks and margin information across the intervening ~30 days. If not, Data Gate cannot become PASS for performance research solely on monthly samples.
**Do not produce CAGR, PnL or maximum drawdown from the samples alone.**

## Final determination
**INCONCLUSIVE, DATA GATE NOT PASSED.** Documented free sample availability is sufficiently promising to justify **download-and-inspect feasibility**, not a $50k executable backtest. This environment could not verify byte-level datasets; no purchase, no option data simulation, no code trading engine and no interaction with existing automated systems.

## Sources
- https://docs.tardis.dev/historical-data-details/deribit
- https://docs.tardis.dev/downloadable-csv-files
- https://docs.tardis.dev/faq/billing-and-subscriptions
- https://tardis.dev/
- https://insights.deribit.com/education/usdc-settled-btc-eth-options-launch/
- https://support.deribit.com/hc/en-us/articles/31424939096093-Inverse-Options
- https://static.deribit.com/files/DeribitInstitutionalSetupGuide.pdf
