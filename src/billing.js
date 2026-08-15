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
// finished job with no subscription and no floor, which means a buyer doing
// fewer than ~2,400 diffs a month pays less here, and a buyer doing ten pays
// almost nothing instead of $239.
//
// Credits are integer tenths-of-a-cent. 1000 = $1.00. No floats touch money.

export const UNITS_PER_DOLLAR = 1000;

// Reads are free: they are the on-ramp, they are cheap to serve, and charging
// for them would just push people back to fetching EDGAR themselves.
export const PRICING = {
  lookup_company: 0,
  recent_filings: 0,
  company_financials: 0,
  filing_section: 20, // $0.02 — one section pulled out of a filing
  compare_filings: 100, // $0.10 — the finished year-over-year diff
};

export const FREE_DAILY_BILLABLE = 25;

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

function today() {
  return new Date().toISOString().slice(0, 10);
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
    return await chargeFreeTier(db, ip, tool, cost);
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

async function chargeFreeTier(db, ip, tool, cost) {
  const subject = `ip:${ip || "unknown"}`;
  const day = today();
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM usage WHERE subject = ? AND day = ? AND billable = 1")
    .bind(subject, day)
    .first();

  const used = Number(row?.n || 0);
  if (used >= FREE_DAILY_BILLABLE) {
    return { allowed: false, reason: "free_tier_exhausted", cost, used, limit: FREE_DAILY_BILLABLE };
  }

  await logUsage(db, subject, tool, 0, 1);
  return {
    allowed: true,
    cost: 0,
    tier: "free",
    remainingToday: FREE_DAILY_BILLABLE - used - 1,
  };
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

  if (decision.reason === "free_tier_exhausted") {
    return {
      ...base,
      reason: `Free tier used up for today (${decision.limit} billable calls per day, no signup needed). It resets at 00:00 UTC.`,
      free_daily_limit: decision.limit,
    };
  }
  if (decision.reason === "insufficient_credits") {
    return { ...base, reason: "Not enough credits on this key.", balance: dollars(decision.balance || 0) };
  }
  if (decision.reason === "unknown_key") {
    return { ...base, reason: "That API key is not recognised." };
  }
  if (decision.reason === "key_disabled") {
    return { ...base, reason: "That API key is disabled." };
  }
  return { ...base, reason: "Payment required." };
}
