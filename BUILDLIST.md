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
