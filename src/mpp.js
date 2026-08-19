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
import { createFacilitatorConfig } from "@coinbase/x402";

import {
  toolWhoHolds,
  toolInstitutionalHoldings,
  toolInsiderTrades,
  toolLatestFilings,
  toolLookupCompany,
  toolRecentFilings,
  toolCompanyFinancials,
  toolFilingSection,
  toolCompareFilings,
} from "./mcp.js";
import { priceOf, dollars, UNITS_PER_DOLLAR } from "./billing.js";
import { PACKS, mintKey } from "./payments.js";
import { toolEvmBalance, toolEvmGas, toolEvmReceipt, toolTokenPrice } from "./onchain.js";
import { toolFxRate, toolDomainReport, toolPredictionMarkets } from "./market.js";

// Stripe's stated minimum for a card payment made with a shared payment token.
const CARD_MINIMUM_UNITS = 500; // $0.50

let cached = null;
let x402Ready = false;

// Facilitators disagree on how to name a chain: the open one answers in CAIP
// ("eip155:8453"), CDP answers with the short name ("base"). Accept either
// rather than silently withholding the rail over a naming convention.
const BASE_MAINNET_IDS = new Set(["eip155:8453", "base", "8453"]);

// Resolves which facilitator to use. Mainnet x402 settles through Coinbase's
// CDP facilitator, which authenticates with a signed JWT rather than a static
// token, so the SDK builds the headers. Without CDP credentials we fall back to
// a plain URL, which in practice only ever serves testnet.
function resolveFacilitator(env) {
  if (env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET) {
    try {
      return createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET);
    } catch (err) {
      console.error("could not build the CDP facilitator config", err);
    }
  }
  return env.X402_FACILITATOR_URL ? { url: env.X402_FACILITATOR_URL } : null;
}

// Asks a facilitator what it actually settles, so we never quote a chain it
// cannot verify.
async function facilitatorSupports(facilitator, acceptedNetworks) {
  try {
    const base = String(facilitator.url).replace(/\/+$/, "");
    // CDP signs a separate JWT per endpoint, so the headers for /supported are
    // not the headers for /verify. Using the wrong set returns 401.
    let headers = {};
    if (typeof facilitator.createAuthHeaders === "function") {
      const built = await facilitator.createAuthHeaders();
      headers = built?.supported || built?.list || built?.verify || {};
    }
    const res = await fetch(`${base}/supported`, {
      headers,
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) {
      console.warn(`facilitator /supported returned ${res.status}`);
      return false;
    }
    const body = await res.json();
    return (body?.kinds || []).some((k) => acceptedNetworks.has(String(k?.network)));
  } catch (err) {
    console.error("facilitator capability check failed", err);
    return false;
  }
}

// Must actually run initialisation rather than read the flag: the dashboard
// renders in isolates that may never have served a payment route, where the
// flag is still false and would report a healthy rail as withheld.
export async function x402Status(env) {
  await getMppx(env);
  return x402Ready;
}

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
    const deposits = {};
    if (env.TEMPO_DEPOSIT_ADDRESS) deposits.tempo = env.TEMPO_DEPOSIT_ADDRESS;
    if (env.BASE_DEPOSIT_ADDRESS) deposits.base = env.BASE_DEPOSIT_ADDRESS;

    const factory = mppStripe.create({
      client,
      networkId: env.STRIPE_PROFILE_ID,
      livemode: !env.STRIPE_SECRET_KEY.includes("_test_"),
      ...(Object.keys(deposits).length ? { depositAddresses: deposits } : {}),
    });

    const methods = factory.defaultMethods();

    // x402 on Base, added on top of Stripe's defaults. This is the rail most
    // agents in the wild actually speak, and defaultMethods() does not include
    // it, because settlement runs through an x402 facilitator rather than
    // Stripe.
    //
    // The rail is only offered if the configured facilitator actually settles
    // the chain we are quoting. The public facilitator serves Base Sepolia
    // (84532) while we charge on Base mainnet (8453); advertising a challenge
    // against it would mean an agent pays and the payment never verifies,
    // which is worse than not offering the rail at all.
    x402Ready = false;
    const facilitator = resolveFacilitator(env);
    if (env.BASE_DEPOSIT_ADDRESS && facilitator) {
      if (await facilitatorSupports(facilitator, BASE_MAINNET_IDS)) {
        try {
          methods.push(
            factory.base.charge({
              recipient: env.BASE_DEPOSIT_ADDRESS,
              x402: { facilitator },
            }),
          );
          x402Ready = true;
        } catch (err) {
          console.error("could not register the x402 Base method", err);
        }
      } else {
        console.warn(`x402 rail withheld: ${facilitator.url} does not settle Base mainnet`);
      }
    }

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
function chargesFor(units, env) {
  const amount = amountString(units);
  const charges = [["tempo/charge", { amount }]];

  // x402 on Base, offered only when the facilitator can actually settle it.
  // Listed early because a client that speaks x402 and finds no x402 option
  // simply leaves.
  if (x402Ready) {
    charges.push(["evm/charge", { amount }]);
  }

  if (units >= CARD_MINIMUM_UNITS) {
    charges.push(["stripe/charge", { amount }]);
  }
  return charges;
}

// What each route looks like to a shopper. CDP's Bazaar (the discovery index
// agents query for payable x402 endpoints) lists resources by the `bazaar`
// extension found in their PAYMENT-REQUIRED payload: an input/output example
// pair, so an agent knows what it is buying before it pays. mppx verification
// only requires that its own extension key survive untouched, so adding a
// sibling key is safe: containsExtensions checks the mppx entry and ignores
// the rest.
const BAZAAR_INFO = {
  "/v1/company": {
    q: { company: "NVDA" },
    out: { name: "NVIDIA CORP", cik: "0001045810", tickers: ["NVDA"], exchanges: ["Nasdaq"] },
  },
  "/v1/filings": {
    q: { company: "NVDA", form: "10-K", limit: "2" },
    out: { returned: 2, filings: [{ form: "10-K", filingDate: "2026-02-25", accessionNumber: "0001045810-26-000021" }] },
  },
  "/v1/financials": {
    q: { company: "NVDA", concept: "Assets" },
    out: { concept: "Assets", unit: "USD", returned: 40, facts: [{ end: "2026-01-25", val: 111601000000 }] },
  },
  "/v1/section": {
    q: { company: "NVDA", item: "1A", form: "10-K", max_chars: "3000" },
    out: { item: "1A", characters: 3000, pinned: false, text: "Item 1A. Risk Factors ..." },
  },
  "/v1/compare": {
    q: { company: "NVDA", item: "1A" },
    out: { summary: { added: 161, removed: 141, unchanged: 335, changeRatio: 0.325 }, added: ["..."], removed: ["..."] },
  },
  "/v1/whoholds": {
    q: { company: "NVDA", limit: "25" },
    out: { company: "NVIDIA CORP", totalReportingManagers: 1253, holders: [{ manager: "McLaughlin Asset Management, Inc.", cik: "0002112239", filedAt: "2026-08-12" }] },
  },
  "/v1/holdings": {
    q: { company: "Berkshire Hathaway", top: "10" },
    out: { manager: "BERKSHIRE HATHAWAY INC", distinctIssuers: 40, holdings: [{ issuer: "APPLE INC", valueUsd: 60000000000, pctOfPortfolio: 22.5 }] },
  },
  "/v1/insider": {
    q: { company: "NVDA", limit: "5" },
    out: { company: "NVIDIA CORP", returned: 5, filings: [{ insider: "HUANG JEN HSUN", roles: ["officer","director"], transactions: [{ code: "S", meaning: "open-market sale", shares: 75000, pricePerShare: 181.32 }] }] },
  },
  "/v1/latest": {
    q: { form: "8-K", limit: "20" },
    out: { form: "8-K", returned: 20, filings: [{ form: "8-K", company: "EXAMPLE CORP", accessionNumber: "0001234567-26-000123", items: [{ item: "1.01", title: "Entry into a Material Definitive Agreement" }] }] },
  },
  "/v1/evm/balance": {
    q: { chain: "base", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    out: { chain: "base", balanceEth: 0.0421, atBlock: "50113122" },
  },
  "/v1/evm/gas": {
    q: { chain: "base" },
    out: { chain: "base", gasPriceGwei: 0.006, atBlock: "50113122" },
  },
  "/v1/evm/receipt": {
    q: { chain: "base", tx: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" },
    out: { status: "success", gasUsed: "52341", logCount: 2 },
  },
  "/v1/token/price": {
    q: { chain: "base", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    out: { symbol: "USDC", priceUsd: 1.0, volume24hUsd: 51234567.0 },
  },
  "/v1/fx/rate": {
    q: { from: "USD", to: "EUR,GBP,JPY" },
    out: { base: "USD", date: "2026-08-18", rates: { EUR: 0.86386, GBP: 0.73933, JPY: 159.7 } },
  },
  "/v1/domain/report": {
    q: { domain: "example.com" },
    out: { resolves: true, ageDays: 11208, registrar: "ICANN", hasSpf: false, nameservers: ["a.iana-servers.net"] },
  },
  "/v1/markets/prediction": {
    q: { q: "fed", limit: "5" },
    out: { returned: 5, markets: [{ question: "Fed rate cut in September?", outcomePrices: [0.62, 0.38], volumeUsd: 1234567.0 }] },
  },
  "/v1/credit": {
    q: { pack: "starter" },
    out: { api_key: "sn_live_...", credit: "$10.00", note: "settling the 402 IS the registration; no account exists" },
  },
};

// Rewrites the PAYMENT-REQUIRED header on an outgoing 402 so the payload
// carries the bazaar extension next to mppx's. Anything malformed passes
// through untouched: a challenge that settles beats one that markets.
function withBazaar(challengeResponse, pathname) {
  const info = BAZAAR_INFO[pathname];
  const raw = challengeResponse?.headers?.get?.("PAYMENT-REQUIRED");
  if (!info || !raw) return challengeResponse;
  try {
    // mppx emits unpadded base64 and atob refuses it, so pad for decode and
    // strip the padding again after encode to hand back the same dialect.
    const pad = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    const payload = JSON.parse(atob(pad));
    payload.extensions = {
      ...(payload.extensions || {}),
      bazaar: {
        // The flag CDP actually keys indexing on. Without it the extension is
        // decoration; with it, the service is cataloged after the first
        // payment the facilitator sees.
        discoverable: true,
        info: {
          input: { type: "http", method: "GET", queryParams: info.q },
          output: { type: "json", example: info.out },
        },
      },
    };
    const headers = new Headers(challengeResponse.headers);
    headers.set("PAYMENT-REQUIRED", btoa(JSON.stringify(payload)).replace(/=+$/, ""));
    // The standard x402 client (x402-fetch, what Coinbase's own docs hand every
    // buyer) reads the payload from the RESPONSE BODY, not the header. mppx
    // only writes the header, so a stock client crashed on our 402 with
    // undefined.map and could never pay, no matter how much USDC it held.
    // Serve the same payload both places: header for MPP clients, body for
    // x402 clients. The problem+json body it replaces was for humans, and
    // humans are not the ones paying here.
    headers.set("content-type", "application/json");
    // Same translation problem as the facilitators: the stock client's enum
    // wants the short chain name, the CAIP id crashes it. Body speaks the
    // client's dialect; the header keeps CAIP for MPP clients.
    const resourceUrl = payload?.resource?.url || "";
    const bodyPayload = {
      ...payload,
      x402Version: 1,
      accepts: (payload.accepts || []).map((a) => ({
        ...a,
        network: a.network === "eip155:8453" ? "base" : a.network,
        // v1 field names the stock client validates. Values are the same
        // facts the v2 fields already carry, spelled the old way.
        maxAmountRequired: a.maxAmountRequired ?? a.amount,
        payTo: a.payTo ?? a.recipient,
        resource: a.resource ?? resourceUrl,
        description: a.description ?? "",
        mimeType: a.mimeType ?? "application/json",
        maxTimeoutSeconds: a.maxTimeoutSeconds ?? 300,
      })),
    };
    return new Response(JSON.stringify(bodyPayload), {
      status: challengeResponse.status,
      headers,
    });
  } catch (err) {
    console.error("bazaar enrichment failed; serving the plain challenge", err);
    return challengeResponse;
  }
}

const ROUTES = {
  "/v1/company": { tool: "lookup_company", run: toolLookupCompany },
  "/v1/filings": { tool: "recent_filings", run: toolRecentFilings },
  "/v1/financials": { tool: "company_financials", run: toolCompanyFinancials },
  "/v1/section": { tool: "filing_section", run: toolFilingSection },
  "/v1/compare": { tool: "compare_filings", run: toolCompareFilings },
  "/v1/latest": { tool: "latest_filings", run: toolLatestFilings },
  "/v1/evm/balance": { tool: "evm_balance", run: toolEvmBalance },
  "/v1/evm/gas": { tool: "evm_gas", run: toolEvmGas },
  "/v1/evm/receipt": { tool: "evm_receipt", run: toolEvmReceipt },
  "/v1/token/price": { tool: "token_price", run: toolTokenPrice },
  "/v1/fx/rate": { tool: "fx_rate", run: toolFxRate },
  "/v1/domain/report": { tool: "domain_report", run: toolDomainReport },
  "/v1/markets/prediction": { tool: "prediction_markets", run: toolPredictionMarkets },
  "/v1/insider": { tool: "insider_trades", run: toolInsiderTrades },
  "/v1/holdings": { tool: "institutional_holdings", run: toolInstitutionalHoldings },
  "/v1/whoholds": { tool: "who_holds", run: toolWhoHolds },
};

export function isMppRoute(pathname) {
  return pathname === "/v1/credit" || Object.hasOwn(ROUTES, pathname);
}

export function describeRoutes() {
  return Object.entries(ROUTES).map(([path, r]) => ({
    path,
    price: dollars(priceOf(r.tool)),
    rails: priceOf(r.tool) >= CARD_MINIMUM_UNITS
      ? ["stablecoin-tempo", "x402-base", "card"]
      : ["stablecoin-tempo", "x402-base"],
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
  if (url.pathname === "/v1/credit") return handleCreditPurchase(request, env, url, ctx);

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
    paid = await mppx.compose(...chargesFor(price, env))(request);
  } catch (err) {
    console.error("mpp compose failed", err);
    return json({ error: "payment_processing_failed" }, 502);
  }

  // No credential yet: hand back the challenge and let the agent pay.
  // Record it. Without this there is no way to tell "nobody found us" from
  // "people found us, saw the price, and walked away", and those two have
  // opposite fixes.
  if (paid.status === 402) {
    ctx?.waitUntil?.(logChallenge(env, route.tool, request));
    return withBazaar(paid.challenge, url.pathname);
  }

  // Paid. Do the work, and only then attach the receipt.
  try {
    const args = Object.fromEntries(url.searchParams.entries());
    const data = await route.run(args, ctx);
    ctx?.waitUntil?.(logSettled(env, route.tool, request, price));
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

// Buy a credit key with a machine payment. This is the piece that removes the
// last human from the loop: previously an agent could pay per call on /v1/*,
// but to use the MCP endpoint someone had to complete a Stripe checkout page.
// Now an agent pays here and gets a usable key back in the response.
async function handleCreditPurchase(request, env, url, ctx) {
  const packId = String(url.searchParams.get("pack") || "starter");
  const pack = PACKS[packId];
  if (!pack) {
    return json(
      {
        error: "unknown_pack",
        packs: Object.fromEntries(
          Object.entries(PACKS).map(([id, p]) => [
            id,
            { price: `$${(p.cents / 100).toFixed(2)}`, credit: dollars(p.units) },
          ]),
        ),
      },
      400,
    );
  }

  const mppx = await getMppx(env);
  if (!mppx) {
    return json(
      {
        error: "machine_payments_unavailable",
        detail:
          "Per-call payment is not configured yet. A human can buy the same credit at https://signalnodus.ai/pricing.",
      },
      503,
    );
  }

  // Charge the pack price. Every pack clears the card floor, so both rails are
  // offered and the caller picks whichever it can settle.
  const units = Math.round((pack.cents / 100) * UNITS_PER_DOLLAR);

  let paid;
  try {
    paid = await mppx.compose(...chargesFor(units, env))(request);
  } catch (err) {
    console.error("credit purchase compose failed", err);
    return json({ error: "payment_processing_failed" }, 502);
  }
  if (paid.status === 402) {
    ctx?.waitUntil?.(logChallenge(env, "credit_purchase", request));
    return withBazaar(paid.challenge, "/v1/credit");
  }

  // Paid. Mint the key only now, so an unpaid attempt leaves nothing behind.
  try {
    const apiKey = await mintKey(env, pack.units, `mpp:${packId}`);
    return paid.withReceipt(
      json({
        api_key: apiKey,
        credit: dollars(pack.units),
        pack: pack.label,
        expires: "never",
        use_with: {
          mcp: "https://mcp.signalnodus.ai/",
          header: "Authorization: Bearer <api_key>",
          balance: "https://signalnodus.ai/api/balance",
        },
        note: "Save this key now. It is not stored in plaintext and cannot be shown again.",
      }),
    );
  } catch (err) {
    console.error("could not mint key after payment", err);
    return paid.withReceipt(
      json(
        {
          error: "paid_but_key_not_issued",
          detail: "Payment succeeded but the key could not be created.",
          refund: "Email hgenix@agentmail.to with this receipt.",
        },
        502,
      ),
    );
  }
}

// A payment challenge that was issued and never taken up is the single most
// informative event this service produces right now: it means someone arrived,
// understood the offer, and declined it.
async function logChallenge(env, tool, request) {
  if (!env?.BILLING) return;
  const now = new Date().toISOString();
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const agent = (request.headers.get("user-agent") || "none").slice(0, 80);
  try {
    await env.BILLING.prepare(
      "INSERT INTO usage (subject, tool, cost, billable, day, created_at) VALUES (?, ?, 0, 0, ?, ?)",
    )
      .bind(`challenge:${ip}|${agent}`, `402:${tool}`, now.slice(0, 10), now)
      .run();
  } catch (err) {
    console.error("could not log challenge", err);
  }
}

// A machine payment that actually settled. This used to log nothing at all,
// which meant an agent could pay us over x402 and every number on the
// dashboard would still read zero. It is deliberately given the SAME subject
// shape as the challenge above, because that is the only way the two events
// can ever be joined: an unpaid caller is known by address and user agent,
// while a credit-key caller is known by key hash, and those two identifier
// spaces never overlap.
async function logSettled(env, tool, request, price) {
  if (!env?.BILLING) return;
  const now = new Date().toISOString();
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const agent = (request.headers.get("user-agent") || "none").slice(0, 80);
  try {
    await env.BILLING.prepare(
      "INSERT INTO usage (subject, tool, cost, billable, day, created_at) VALUES (?, ?, ?, 1, ?, ?)",
    )
      .bind(`challenge:${ip}|${agent}`, `x402:${tool}`, price, now.slice(0, 10), now)
      .run();
  } catch (err) {
    console.error("could not log settled payment", err);
  }
}
