# Market fit and build list

Source: "Market Research.pdf" (KameronOS/DOMAINS/Business/Signal Nodus,
read 2026-08-20), a four-part A2A-commerce deep-research session. This file
maps its findings onto Signal Nodus and lists what to build. Check items off
as they ship.

## What the research says wins

The strongest observed product shape:
machine-readable input -> deterministic scope -> fast execution ->
machine-readable output -> immediately actionable -> low unit price ->
needed again. "Don't sell reasoning when you can sell completed action."

Top product models by observed buying: (1) action/execution agent,
(2) decision oracle, (3) unique structured-data feed, (4) verification
agent, (5) security/risk agent, (6) specialized search/enrichment,
(7) machine utility/API. Generic writing/research/code-review is
oversupplied with weak demand.

Strongest principle: sell agents a primitive they need to complete their
own paid jobs (derived demand, part of their cost of goods sold).
Quiver's ratio (~1,980 jobs from 3 buyers, ~660 calls/buyer) shows a few
autonomous buyers can carry a data product.

## Category fit

| Research category (demand) | Signal Nodus today | Verdict |
|---|---|---|
| Structured financial data (high repeatability) | SEC suite: filings, sections, diffs, XBRL, Form 4, 13F | CORE. Extend with the datasets Quiver proved (gov contracts, lobbying, 8-K events) |
| Decision oracles / predictions (very high) | prediction_markets (raw read) | Add derived scores we already compute (risk churn) |
| Verification / trust (validated demand) | nothing | Add deterministic numeric-claim verification against XBRL |
| Security / risk (emerging) | domain_report | Token safety needs a keyed upstream; queued, not building keyless-first |
| Specialized search / enrichment | who_holds (EDGAR FTS, narrow) | Expose general EDGAR full-text search |
| Machine utility / API | fx_rate, evm_*, token_price | Sufficient; no new build |
| Action / execution (highest usage) | none | OUT OF SCOPE: execution means custody of funds/keys; standing constraint says no |

## Build list (products)

All zero-cost keyless upstreams (SEC EDGAR, USAspending.gov, Senate LDA),
same Worker, same billing. Prices follow the existing ladder.

- [x] 1. `filing_events` $0.05 — 8-K material events parsed with item codes
      (the monitoring primitive; pairs with latest_filings polling)
- [x] 2. `edgar_search` $0.01 — EDGAR full-text search (efts.sec.gov)
      exposed as a general enrichment tool
- [x] 3. `government_contracts` $0.05 — USAspending.gov federal awards by
      company (free keyless API; Quiver-proven dataset)
- [x] 4. `lobbying` $0.05 — Senate LDA filings by company (free API)
- [x] 5. `activist_stakes` $0.05 — SC 13D/13G parsed (ownership events)
- [x] 6. `ipo_pipeline` $0.01 — recent S-1/F-1 registrations
- [x] 7. `risk_churn_score` $0.10 — decision oracle: YoY section churn as
      one number + verdict, built on compare_filings we already have
- [x] 8. `verify_financial_claim` $0.10 — verification agent: deterministic
      check of a numeric claim against XBRL, returns
      supported/contradicted/unverifiable + citation
- REJECTED: congressional_trades (no keyless primary source; aggregators
  need paid keys). Revisit if Kameron wants to fund a key.
- REJECTED: token_safety (GoPlus et al. need keys). Queued for Kameron.
- REJECTED: any execution/trading product (custody constraint).

## Prerequisite fixes (from the 2026-08-20 code review, block the journeys)

- [x] Stripe webhook idempotency (double-credit on redelivery)
- [x] BigInt crash on malformed X-PAYMENT (500s on paid routes)
- [x] Discovery docs list 5 of 16 tools (mcp.json, mpp.json)
- [x] describeRoutes wrong params for 11 newer routes
- [x] Free REST call issues a $0 challenge instead of serving
- [x] tools/list double price line + tells agents the free tool costs money
- [x] compare_filings accepts accessions of the wrong form
- [x] domain_report advertises dmarc it never does
- [x] cpu_ms comment/guard mismatch (cost amplification)
- [x] dashboard label escaping (latent XSS)
- [x] banned words in site copy (index.js), per writing conventions

## Distribution (identified marketplaces)

Already listed: official MCP registry (propagates to mcp.so/Glama/
PulseMCP/Smithery), x402 Bazaar extension in every 402, x402scan discovery
docs, Stripe Directory, llms.txt//.well-known/mpp.json.

- [x] Discovery docs + Bazaar extension now carry all 24 routes (verified
      live); x402-observer and other x402 indexes already crawl us
- [ ] the402 / Agent402: canonical domains not confirmed (the402.xyz and
      the402.org are unrelated sites); revisit with better sourcing
- [x] Toku LIVE 2026-08-20: agent signal-nodus registered self-serve (no
      wallet needed), 3 services published, autonomous webhook fulfillment
      at /integrations/toku (src/toku.js). Payout needs Kameron's Stripe
      Connect onboarding once revenue accrues.
- QUEUED FOR KAMERON (need wallets/accounts, runsheet at
  C:i-company\signalnodus-marketplace-runsheet.md): Virtuals ACP,
  Olas Mech, NEAR (parked, "coming soon"), Circle. auto.exchange is a
  poor fit (hosts persona agents, does not list external APIs); AgentPact/
  AgentHire/Daydreams domains unconfirmed, do not chase

## Customer journeys (final acceptance)

- [x] Agent journey VERIFIED 2026-08-20: descriptor lists 24 routes with
      real params, free proof call serves, 402 carries x402(eip155:8453,
      right price)+MPP+bazaar, rails live on dashboard, paid MCP call
      charged exactly $0.05, malformed X-PAYMENT returns 402 not 500
- [x] Human journey VERIFIED 2026-08-20: pricing page lists all 24 tools,
      buy button creates a live Stripe checkout session ($9 starter), webhook
      credits exactly once on redelivery (signed local test), key works


## Round 2: built from live ACP top-seller research (2026-08-20)

Scanned app.virtuals.io/acp/scan. Top agents by transactions: Nox (token
swaps, 91,976 jobs - EXECUTION, skipped), Otto Market Alpha (56,713 jobs,
market intel), aixbt (26,550, crypto intel), Capminal (DeFi, skipped).
Highest-transaction offerings we CAN build (data, keyless, no custody, no
advice): x402 endpoint audits (API Acre, x402 SellerOps), DexScreener token
pulls (ArmaBase $0.10), gas optimizers (ArmaBase $0.25). Skipped: swaps,
cross-chain, leverage/perp signals, alpha (custody/advice constraints).

- [x] x402_audit $0.10 - inspect a public x402 endpoint, report the 402
      challenge (rails/recipient/Bazaar), pass/fail checklist + verdict; no
      payment signed. Our differentiation: we built the full x402 seller
      stack. SSRF-guarded (https only, no IP literals, no internal hosts,
      443 only, no redirects). src/x402audit.js
- [x] token_report $0.10 - one-call token due-diligence: price, 24h change,
      FDV, mcap, volume, deepest-pool liquidity, factual risk flags. Better
      than the DexScreener pull by combining token+pools and flagging
      low-liquidity/thin-volume (facts, not advice). onchain.js
- [x] gas_optimizer $0.05 - live gas across Base/Arbitrum/Ethereum as the USD
      cost of a standard transfer + cheapest chain. Better than ArmaBase by
      adding Arbitrum + USD cost. onchain.js
All verified live and charging. 27 tools total now.

## Round 3 plan (2026-08-23): trust, visibility, verticals

Context for this round: five days of open discovery brought ~470 distinct
callers, 84% of them two uptime/trust monitors, the rest scanners and
indexers. Zero external payment attempts (the payfail log now makes that
distinction durable). Catalog breadth has been pulled twice (8 -> 24 -> 27
tools) without producing a payer, so this round pairs any new catalog with a
distribution push, and the whole round carries a kill criterion at the
bottom.

### 1. Programmatic refunds (trust guarantee)

A paid call that fails after settlement currently returns a receipt and
"email for a refund". Make the guarantee self-enforcing and advertised:

- [ ] Credit-key lane: on `request_failed_after_payment` for a keyed call,
      re-credit the key automatically in the same request (pure D1, no
      risk), and say so in the response. Idempotent by usage row.
- [ ] x402 lane: on a settled-then-failed call, send the USDC back to
      `authorization.from` from the deposit wallet (CDP wallet secret is
      already provisioned). Cap per-day auto-refund volume, log every
      refund as a `refund:` usage row, and never refund the same
      settlement twice.
- [ ] Advertise it: a `guarantee` field in the descriptor, the Bazaar
      extension, and tools/list. A guarantee nobody can discover builds no
      trust.

### 2. Visibility: list everywhere that verifiably exists

Discipline: confirm the canonical domain and submission path before
building for it (the402 precedent). Code-side items first, they need no
accounts:

- [ ] A2A agent card at `/.well-known/agent.json` (Google A2A spec), so
      A2A-side directories and clients can read capabilities + payment
      rails without MCP.
- [ ] OpenAPI 3 spec at `/openapi.json` generated from the route table
      (feeds APIs.guru, Postman, and agents that plan calls from specs).
- [ ] Verify the official MCP registry propagation actually landed on
      mcp.so, Glama, PulseMCP, Smithery (listed 08-20; confirm each shows
      v1.2.0 with 27 tools, fix what lags).
- [ ] Docker MCP Catalog, Cursor directory, Cline marketplace, LobeHub:
      confirm submission paths, then submit (some need only a repo PR).
- [ ] awesome-mcp-servers and equivalent curated GitHub lists: PRs from
      the hgenix20 account.
- [ ] RapidAPI listing for the REST rail: platform-handled card billing is
      a fiat lane that reaches human developers building agents; needs the
      account, queue on the marketplace runsheet.
- [ ] Postman API Network: free listing, needs account, same runsheet.
- Already queued on Kameron (wallets/accounts): Virtuals ACP, Olas Mech,
  Circle; unchanged.

### 3. Vertical expansion (from the 2026-08-23 A2A gap analysis)

Five markets were named: freight/logistics, commodities/energy, B2B
wholesale, labor/services, local commerce. Mapped against the standing
constraints (keyless or free-key primary sources, no custody, no
execution, no advice):

- BUILDABLE, scope-consistent (still government primary records):
  - [ ] `cftc_positioning` $0.05 - CFTC Commitments of Traders via the
        public Socrata API (keyless): weekly positioning in oil, metals,
        ag, rates. The primary record behind commodity sentiment.
  - [ ] `treasury_data` $0.01-0.05 - fiscaldata.treasury.gov (keyless):
        auction results, debt, rates.
  - [ ] `energy_data` $0.05 - EIA open-data API: grid mix, electricity
        and fuel prices. Free key, instant signup; queue the key on
        Kameron like other keyed upstreams.
  - [ ] `crop_data` $0.05 - USDA NASS Quick Stats: yields, plantings,
        stocks. Free key, same queue.
  - [ ] `trade_flows` $0.05 - Census USA Trade API: imports/exports by
        commodity and country, monthly. Free key. This is the honest
        keyless-adjacent slice of "freight": trade flows, not freight
        booking.
- REJECTED as data products under current constraints:
  - Real-time freight rates (DAT et al.): licensed commercial data, no
    primary free source.
  - B2B wholesale inventory (Octopart-class): partner APIs whose terms
    bar redistribution; revisit only with a partnership in hand.
  - Local commerce POI/inventory (Google/Yelp-class): licensing bars
    redistribution.
- OUT OF SCOPE for this service:
  - Labor/services marketplace with escrow: that is execution and custody
    of funds, the standing constraint says no. If it is ever pursued it
    is a separate venture hypothesis for the revenue loop, not a Signal
    Nodus tool.
  - "Market access to actually buy things" (the analysis's closing
    frame): being a transaction counterparty in freight or energy is a
    brokerage with regulatory exposure, a different business entirely.

### Round 3 kill criterion

The verticals ship only together with the visibility push, since a bigger
catalog shown to the same monitor-and-scanner population is the lever that
has already failed twice. Evidence bar: by 2026-09-06, at least one
external payment attempt (a `payfail:` row or a settlement not traceable
to us). If the bar is not met, stop adding tools, keep the service
running as-is, and take the rung-2 verdict to the venture evaluator
instead of starting a Round 4.
