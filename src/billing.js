// Metering and credits.
//
// Pricing is set against what the market already charges for this exact
// capability, verified from vendor pricing pages on 2026-08-15:
//   sec-api.io  $239/mo (Business) before you can extract 10-K/10-Q sections;
//               $55/mo entry tier does not include extraction.
//   Intrinio    $150/mo individual, $333/mo startup for SEC-derived fundamentals.
//
// So the incumbent price of a section-extraction capability is a few hundred
// dollars a month with a floor you pay whether you use it or not. We charge per
// finished job with no subscription and no floor: a buyer doing fewer than
// ~950 diffs a month pays less here, and one doing thirty pays about $8
// instead of $239.
//
// Credits are integer tenths-of-a-cent. 1000 = $1.00. No floats touch money.

export const UNITS_PER_DOLLAR = 1000;

// Every call that does work costs money. A free tier is a human marketing
// device: a person needs to try before typing a card number. An agent does not
// evaluate, it calls, and if paying is one header then there is nothing for a
// trial to solve. The only free surface is the MCP handshake itself
// (initialize, tools/list), because clients call those automatically to learn
// what exists and charging for discovery would just make the server invisible.
//
// $0.01 is the floor because that is the stablecoin minimum on Stripe machine
// payments. $0.50 on the flagship job is the card floor: Stripe requires at
// least 0.50 USD for a card payment made with a shared payment token, so
// anything cheaper is stablecoin-only and locks out every card-paying agent.
export const PRICING = {
  // Free on purpose, and not as a trial. An agent evaluating an unknown
  // service needs one call that proves the thing works before anyone wires
  // payment to it, and a client that cannot pay yet will otherwise drop the
  // server after its very first request. This is the cheapest call we serve,
  // so it costs almost nothing to leave open as proof of life.
  lookup_company: 0,
  recent_filings: 10, // $0.01
  company_financials: 10, // $0.01
  filing_section: 50, // $0.05
  who_holds: 50, // $0.05 — inverse 13F query via full-text search
  institutional_holdings: 50, // $0.05 — parsed 13F, aggregated by issuer
  insider_trades: 50, // $0.05 — parsed Form 4s; the trading-agent product
  fx_rate: 10, // $0.01 — ECB reference rates
  domain_report: 10, // $0.01 — DNS + RDAP in one call
  prediction_markets: 10, // $0.01 — Polymarket top-volume search
  evm_balance: 10, // $0.01 — onchain cluster, keyless upstream
  evm_gas: 10, // $0.01
  evm_receipt: 10, // $0.01
  token_price: 10, // $0.01
  latest_filings: 10, // $0.01 — the polling product; volume, not margin
  compare_filings: 500, // $0.50 — clears the card minimum, so both rails work
  edgar_search: 10, // $0.01 - EDGAR full-text search, the enrichment on-ramp
  filing_events: 50, // $0.05 - 8-K events with decoded item codes
  activist_stakes: 50, // $0.05 - 13D/13G filings naming a company
  ipo_pipeline: 10, // $0.01 - new S-1/F-1 registrations, market-wide
  government_contracts: 50, // $0.05 - USAspending federal awards
  lobbying: 50, // $0.05 - Senate LDA disclosures
  risk_churn_score: 100, // $0.10 - decision oracle over the diff
  verify_financial_claim: 100, // $0.10 - deterministic XBRL claim check
  x402_audit: 100, // $0.10 - inspect a public x402 endpoint, no payment signed
  token_report: 100, // $0.10 - one-call token due-diligence data
  gas_optimizer: 50, // $0.05 - cheapest gas across chains, USD cost
  cftc_positioning: 50, // $0.05 - CFTC Commitments of Traders, weekly positioning
  energy_data: 50, // $0.05 - EIA prices and grid demand
  crop_data: 50, // $0.05 - USDA NASS yields, production, stocks
  trade_flows: 50, // $0.05 - Census monthly trade by HS chapter
};

export function priceOf(tool) {
  return PRICING[tool] ?? 0;
}

export function dollars(units) {
  return `$${(units / UNITS_PER_DOLLAR).toFixed(2)}`;
}

export async function hashKey(key) {
  const data = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Decides whether a call may proceed and charges for it.
 *
 * Fails OPEN when the database is unavailable: a billing outage should not take
 * the service down, because an unbillable served request costs cents and a dead
 * endpoint costs the customer.
 */
export async function authorize(env, { tool, apiKey, ip }) {
  const cost = priceOf(tool);
  if (cost === 0) return { allowed: true, cost: 0, tier: "free-tool" };

  const db = env?.BILLING;
  if (!db) return { allowed: true, cost: 0, tier: "unmetered", note: "billing not configured" };

  try {
    if (apiKey) return await chargeKey(db, apiKey, tool, cost);
    // No credential: this is where a machine payment challenge belongs.
    return { allowed: false, reason: "payment_required", cost };
  } catch (err) {
    console.error("billing unavailable", err);
    return { allowed: true, cost: 0, tier: "degraded", note: "billing unavailable, served free" };
  }
}

async function chargeKey(db, apiKey, tool, cost) {
  const keyHash = await hashKey(apiKey);
  const row = await db.prepare("SELECT key_hash, credits, active FROM api_keys WHERE key_hash = ?")
    .bind(keyHash)
    .first();

  if (!row) return { allowed: false, reason: "unknown_key", cost };
  if (!row.active) return { allowed: false, reason: "key_disabled", cost };
  if (row.credits < cost) {
    return { allowed: false, reason: "insufficient_credits", cost, balance: row.credits };
  }

  // Conditional update doubles as the concurrency guard: if two calls race,
  // only one can take the last credits.
  const upd = await db
    .prepare("UPDATE api_keys SET credits = credits - ?, last_used = ? WHERE key_hash = ? AND credits >= ?")
    .bind(cost, new Date().toISOString(), keyHash, cost)
    .run();

  if (!upd.meta?.changes) {
    return { allowed: false, reason: "insufficient_credits", cost, balance: row.credits };
  }

  await logUsage(db, keyHash, tool, cost, 1);
  return { allowed: true, cost, tier: "paid", balance: row.credits - cost };
}

async function logUsage(db, subject, tool, cost, billable) {
  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO usage (subject, tool, cost, billable, day, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(subject, tool, cost, billable, now.slice(0, 10), now)
    .run();
}

// Same job as each MCP tool, reachable over plain HTTP where the 402 challenge
// lives. An agent refused on MCP can pay here instead of giving up.
const PAYABLE_ROUTE = {
  lookup_company: "/v1/company",
  recent_filings: "/v1/filings",
  company_financials: "/v1/financials",
  filing_section: "/v1/section",
  compare_filings: "/v1/compare",
  who_holds: "/v1/whoholds",
  institutional_holdings: "/v1/holdings",
  insider_trades: "/v1/insider",
  fx_rate: "/v1/fx/rate",
  domain_report: "/v1/domain/report",
  prediction_markets: "/v1/markets/prediction",
  evm_balance: "/v1/evm/balance",
  evm_gas: "/v1/evm/gas",
  evm_receipt: "/v1/evm/receipt",
  token_price: "/v1/token/price",
  latest_filings: "/v1/latest",
  edgar_search: "/v1/search",
  filing_events: "/v1/events",
  activist_stakes: "/v1/activists",
  ipo_pipeline: "/v1/ipos",
  government_contracts: "/v1/gov/contracts",
  lobbying: "/v1/gov/lobbying",
  risk_churn_score: "/v1/score/churn",
  verify_financial_claim: "/v1/verify/claim",
  x402_audit: "/v1/x402/audit",
  token_report: "/v1/token/report",
  gas_optimizer: "/v1/gas/optimizer",
  cftc_positioning: "/v1/cftc/positioning",
  energy_data: "/v1/energy",
  crop_data: "/v1/crops",
  trade_flows: "/v1/trade",
};

// What a caller gets when they are out of credit. Shaped so an agent can act on
// it without a human reading a pricing page.
export function paymentRequired(decision, tool) {
  const price = priceOf(tool);
  const base = {
    error: "payment_required",
    tool,
    price: dollars(price),
    priceUnits: price,
    currency: "USD",
    how_to_pay: "https://signalnodus.ai/pricing",
    contact: "hgenix@agentmail.to",
  };

  if (decision.reason === "insufficient_credits") {
    return { ...base, reason: "Not enough credits on this key.", balance: dollars(decision.balance || 0) };
  }
  if (decision.reason === "payment_required") {
    return {
      ...base,
      reason:
        "This call costs money and no payment credential was presented. Every data call is priced; there is no free tier and no subscription.",
      pay_with: {
        per_call_x402: PAYABLE_ROUTE[tool]
          ? `GET https://api.signalnodus.ai${PAYABLE_ROUTE[tool]} returns HTTP 402 with WWW-Authenticate: Payment and an x402 PAYMENT-REQUIRED header. Pay it and the same data comes back. No account, no signup.`
          : null,
        buy_a_key_autonomously:
          "GET https://api.signalnodus.ai/v1/credit?pack=starter also answers 402. Settle it and the response body contains a fresh API key. No human in the loop.",
        credit_key: "Or buy credit at https://signalnodus.ai/pricing and send Authorization: Bearer <key>",
        rails: "x402 on Base (USDC) and Stripe machine payments (stablecoin or card).",
      },
    };
  }
  if (decision.reason === "unknown_key") {
    return { ...base, reason: "That API key is not recognised." };
  }
  if (decision.reason === "key_disabled") {
    return { ...base, reason: "That API key is disabled." };
  }
  return { ...base, reason: "Payment required." };
}
