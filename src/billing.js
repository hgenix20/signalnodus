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
  lookup_company: 10, // $0.01
  recent_filings: 10, // $0.01
  company_financials: 10, // $0.01
  filing_section: 50, // $0.05
  compare_filings: 500, // $0.50 — clears the card minimum, so both rails work
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
        credit_key: "Buy credit at https://signalnodus.ai/pricing, then send Authorization: Bearer <key>",
        machine_payments: "Stripe MPP / x402 per-call payment is being enabled; see /api/pricing for status",
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
