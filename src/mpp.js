// Machine Payments Protocol: agents pay per call, no account, no human.
//
// The flow is HTTP-native. A caller with no payment credential gets a 402
// carrying a challenge; it pays, retries, and gets the data plus a receipt.
// That is the whole reason this exists: an agent cannot complete a checkout
// page, so anything that requires one is not really sold to agents.
//
// Two rails, and the prices are set by their floors rather than by taste:
// stablecoin clears at $0.01, cards via shared payment tokens need $0.50. A
// call priced below the card floor is offered on stablecoin only, because
// advertising a card challenge we cannot settle would just fail at payment.

import Stripe from "stripe";
import { Mppx, stripe as mppStripe } from "mppx/server";

import {
  toolLookupCompany,
  toolRecentFilings,
  toolCompanyFinancials,
  toolFilingSection,
  toolCompareFilings,
} from "./mcp.js";
import { priceOf, dollars, UNITS_PER_DOLLAR } from "./billing.js";

// Stripe's stated minimum for a card payment made with a shared payment token.
const CARD_MINIMUM_UNITS = 500; // $0.50

let cached = null;

// Built once per isolate. Returns null until the operator has supplied the
// Stripe credentials, which keeps the rest of the Worker serving normally
// instead of failing closed on a half-configured payment rail.
async function getMppx(env) {
  if (cached !== null) return cached;

  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PROFILE_ID) {
    cached = false;
    return false;
  }

  try {
    const client = new Stripe(env.STRIPE_SECRET_KEY);
    const methods = mppStripe
      .create({
        client,
        networkId: env.STRIPE_PROFILE_ID,
        livemode: !env.STRIPE_SECRET_KEY.includes("_test_"),
        ...(env.TEMPO_DEPOSIT_ADDRESS
          ? { depositAddresses: { tempo: env.TEMPO_DEPOSIT_ADDRESS } }
          : {}),
      })
      .defaultMethods();

    cached = Mppx.create({
      methods,
      secretKey: await challengeSigningKey(env.STRIPE_SECRET_KEY),
    });
    return cached;
  } catch (err) {
    console.error("mpp init failed", err);
    cached = false;
    return false;
  }
}

// Challenges are HMAC-bound so the server can verify one it issued without
// storing it. Mirrors Stripe's documented derivation.
async function challengeSigningKey(stripeSecret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(stripeSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("mpp-challenge-signing"));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

function amountString(units) {
  return (units / UNITS_PER_DOLLAR).toFixed(2);
}

// Which challenges to offer for a given price. Below the card floor only the
// stablecoin rail can actually settle.
function chargesFor(units) {
  const charges = [["tempo/charge", { amount: amountString(units) }]];
  if (units >= CARD_MINIMUM_UNITS) {
    charges.push(["stripe/charge", { amount: amountString(units) }]);
  }
  return charges;
}

const ROUTES = {
  "/v1/company": { tool: "lookup_company", run: toolLookupCompany },
  "/v1/filings": { tool: "recent_filings", run: toolRecentFilings },
  "/v1/financials": { tool: "company_financials", run: toolCompanyFinancials },
  "/v1/section": { tool: "filing_section", run: toolFilingSection },
  "/v1/compare": { tool: "compare_filings", run: toolCompareFilings },
};

export function isMppRoute(pathname) {
  return Object.hasOwn(ROUTES, pathname);
}

export function describeRoutes() {
  return Object.entries(ROUTES).map(([path, r]) => ({
    path,
    price: dollars(priceOf(r.tool)),
    rails: priceOf(r.tool) >= CARD_MINIMUM_UNITS ? ["stablecoin", "card"] : ["stablecoin"],
    params:
      path === "/v1/compare"
        ? "company, item, form, from_accession, to_accession"
        : path === "/v1/section"
          ? "company, item, form, accession, max_chars"
          : path === "/v1/financials"
            ? "company, concept"
            : "company, form, limit",
  }));
}

export async function handleMppRoute(request, env, ctx, url) {
  const route = ROUTES[url.pathname];
  if (!route) return null;

  const price = priceOf(route.tool);
  const mppx = await getMppx(env);

  if (!mppx) {
    return json(
      {
        error: "machine_payments_unavailable",
        detail:
          "Per-call payment is not configured on this deployment yet. Buy credit at https://signalnodus.ai/pricing and use the MCP endpoint with Authorization: Bearer <key>.",
        price: dollars(price),
      },
      503,
    );
  }

  let paid;
  try {
    paid = await mppx.compose(...chargesFor(price))(request);
  } catch (err) {
    console.error("mpp compose failed", err);
    return json({ error: "payment_processing_failed" }, 502);
  }

  // No credential yet: hand back the challenge and let the agent pay.
  if (paid.status === 402) return paid.challenge;

  // Paid. Do the work, and only then attach the receipt.
  try {
    const args = Object.fromEntries(url.searchParams.entries());
    const data = await route.run(args, ctx);
    return paid.withReceipt(json({ ...data, _paid: dollars(price) }));
  } catch (err) {
    // The caller has already paid, so be explicit rather than generic. A
    // refund is a support matter, not something to paper over.
    console.error("paid call failed", route.tool, err);
    return paid.withReceipt(
      json(
        {
          error: "request_failed_after_payment",
          detail: String(err?.message || err).slice(0, 300),
          refund: "Email hgenix@agentmail.to with this receipt for a refund.",
        },
        502,
      ),
    );
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
