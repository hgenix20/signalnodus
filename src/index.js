import { handleMcp, toolLatestFilings } from "./mcp.js";
import { createCheckout, handleWebhook, keyBalance, packSummary, pruneAbandonedCheckouts, mintKey } from "./payments.js";
import { PRICING, priceOf, dollars, hashKey, usageLog, CORE_TOOLS, EXPERIMENTAL_TOOLS, toolRank } from "./billing.js";
import { SERVICE_VERSION, SERVICE_STAGE } from "./version.js";
import { PARSER_VERSION } from "./filings.js";
// Latest measured accuracy, committed by `node eval/run.mjs` and bundled at
// deploy time, so the /eval page can never show numbers newer than the code.
import EVAL_RESULTS from "../eval/results.json";
import { handleMppRoute, isMppRoute, describeRoutes } from "./mpp.js";
import { handleTokuWebhook } from "./toku.js";
import { handleDashboard, isDashboardPath } from "./dashboard.js";

// Signal Nodus — one Worker serving all signalnodus.ai hosts.
// Canonical host: signalnodus.ai (www 301s here; .com redirects at the zone edge).

// Cloudflare Web Analytics beacon token; null until the RUM site exists.
// Automatic injection adds an external <script src>, so no inline allowance
// is needed for it — which is what lets script-src stay free of 'unsafe-inline'.
const BEACON_TOKEN = null;

const CONTACT_EMAIL_FALLBACK = "hgenix@agentmail.to";

// Scripts and styles are served from same-origin /site.js and /site.css rather
// than inlined, so 'unsafe-inline' is unnecessary and the CSP is real.
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "geolocation=(), microphone=(), camera=()",
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
    "frame-src https://challenges.cloudflare.com",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self' https://cloudflareinsights.com",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
};

// Non-canonical hosts should never be indexed, and must not claim the apex as
// their canonical URL.
const NOINDEX = { "x-robots-tag": "noindex, nofollow" };

// Ed25519 public key the MCP registry checks when we claim ai.signalnodus.
// Private half lives off-repo; rotating it means republishing every server.
const MCP_REGISTRY_PROOF = "v=MCPv1; k=ed25519; p=jeCPYhU5E5hoi3Ht5gFrHPbaBPPEIBEBMVG6kb6db7M=\n";

export default {
  // Housekeeping runs on a schedule rather than in the request path, so no
  // caller ever pays the latency for it.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pruneAbandonedCheckouts(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = url.hostname;

    if (host === "mcp.signalnodus.ai") {
      return handleMcp(request, env, ctx);
    }

    if (host === "www.signalnodus.ai") {
      url.hostname = "signalnodus.ai";
      return Response.redirect(url.toString(), 301);
    }

    switch (host) {
      case "api.signalnodus.ai": {
        if (url.pathname === "/integrations/toku" && request.method === "POST") {
          return handleTokuWebhook(request, env, ctx);
        }
        // A payer's own audit trail. Free: reading your bill never costs money.
        if (url.pathname === "/v1/usage") {
          return usageResponse(request, env);
        }
        if (isMppRoute(url.pathname)) {
          const paid = await handleMppRoute(request, env, ctx, url);
          if (paid) return paid;
        }
        return apiResponse(request, url, env);
      }
      case "app.signalnodus.ai":
        return placeholder(
          "No console",
          "Signal Nodus is machine-facing by design. There is no dashboard and none is planned: the API is the product. Point your agent at <a href=\"https://api.signalnodus.ai/\">api.signalnodus.ai</a>, or connect to the MCP server at <code>https://mcp.signalnodus.ai/</code>.",
        );
      case "staging.signalnodus.ai":
        return placeholder("Staging", "Staging environment. Nothing here is stable or real.");
      case "dev.signalnodus.ai":
        return placeholder("Dev", "Development environment. Expect breakage.");
      default:
        return apexResponse(request, url, env, ctx);
    }
  },
};

// Page views for HTML pages, into the same usage table the challenge log
// uses. Answers "do humans reach the site at all", which nothing measured
// before. Fire-and-forget; the page never waits on it.
function logPageView(env, ctx, request, url) {
  if (!env?.BILLING || !ctx?.waitUntil) return;
  const ua = request.headers.get("user-agent") || "none";
  // Skip the obvious non-humans so the number means something.
  if (/bot|crawler|spider|probe|monitor|curl|python|node|Go-http|HeadlessChrome/i.test(ua)) return;
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const now = new Date().toISOString();
  ctx.waitUntil(
    env.BILLING.prepare(
      "INSERT INTO usage (subject, tool, cost, billable, day, created_at) VALUES (?, ?, 0, 0, ?, ?)",
    )
      .bind(`page:${ip}|${ua.slice(0, 60)}`, `view:${url.pathname.slice(0, 40)}`, now.slice(0, 10), now)
      .run()
      .catch(() => {}),
  );
}

// GET /v1/usage with Authorization: Bearer <key>: the last 30 days of calls
// charged to that key, each with the accession(s) the response was built
// from. This is the audit log a paying customer settles disputes with.
async function usageResponse(request, env) {
  const bearer = /^Bearer\s+(.+)$/i.exec((request.headers.get("authorization") || "").trim())?.[1]?.trim();
  if (!bearer) {
    return json({ error: "missing_key", detail: "Send your API key as Authorization: Bearer <key>." }, 401);
  }
  if (!env?.BILLING) return json({ error: "unavailable" }, 503);
  try {
    const log = await usageLog(env.BILLING, bearer);
    if (!log) return json({ error: "unknown_key" }, 403);
    return json({
      ...log,
      note: "Every billed call, newest first. `accessions` names the SEC document(s) the response was built from, where the tool serves filing data.",
    });
  } catch (err) {
    console.error("usage log failed", err);
    return json({ error: "unavailable" }, 503);
  }
}

async function apexResponse(request, url, env, ctx) {
  if (url.pathname === "/api/verify-contact") {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...SECURITY_HEADERS, allow: "POST, OPTIONS" },
      });
    }
    if (request.method !== "POST") {
      return json({ error: "method not allowed" }, 405, { allow: "POST, OPTIONS" });
    }
    return verifyContact(request, env);
  }

  if (url.pathname === "/api/trial") {
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405, { allow: "POST" });
    return handleTrial(request, env, ctx);
  }

  if (url.pathname === "/api/checkout" && request.method === "POST") {
    return createCheckout(request, env);
  }
  if (url.pathname === "/api/stripe-webhook" && request.method === "POST") {
    return handleWebhook(request, env);
  }
  if (url.pathname === "/api/balance") {
    return keyBalance(request, env);
  }
  if (url.pathname === "/api/pricing") {
    return json({
      model: "per call, no subscription",
      free:
        "lookup_company is free as proof of life, the MCP handshake (initialize, tools/list) is free, and a free $5 trial key is at https://signalnodus.ai/trial. Every other data call is priced.",
      core_tools: CORE_TOOLS,
      experimental_tools: [...EXPERIMENTAL_TOOLS],
      // Generated from the same table the meter charges from, so this endpoint
      // cannot drift away from what a caller is actually billed.
      prices: Object.fromEntries(
        Object.keys(PRICING)
          .sort((a, b) => toolRank(a) - toolRank(b))
          .map((tool) => [tool, dollars(priceOf(tool))]),
      ),
      packs: packSummary(),
      minimums:
        "Stripe machine payments: 0.01 USDC minimum for stablecoin, 0.50 USD minimum for card via shared payment tokens. compare_filings is priced at $0.50 so it clears both.",
      compare:
        "sec-api.io gates 10-K/10-Q section extraction behind its $239/mo Business tier (their pricing page, checked 2026-08-15). Here the same job is $0.50 and there is no monthly floor.",
    });
  }
  if (url.pathname === "/key") {
    const k = url.searchParams.get("k") || "";
    const safe = /^sn_live_[a-f0-9]{48}$/.test(k) ? k : null;
    return html(
      pageShell(
        "Your API key · Signal Nodus",
        `<main class="wrap pad">
          <h1 class="h1">Your API key</h1>
          ${safe
            ? `<pre class="block">${safe}</pre><p class="dim narrow">Save it now. Send it as <code>Authorization: Bearer &lt;key&gt;</code>. Check the balance any time at <code>/api/balance</code>.</p>`
            : `<p class="dim narrow">No key in this link. If you just paid and cannot find your key, email <a href="mailto:hgenix@agentmail.to">hgenix@agentmail.to</a>.</p>`}
          <p class="mt"><a href="/pricing">Pricing</a> · <a href="/">Home</a></p>
        </main>`,
        { canonical: null, index: false },
      ),
      200,
      NOINDEX,
    );
  }
  if (url.pathname === "/trial") { logPageView(env, ctx, request, url); return html(trialPage()); }
  if (url.pathname === "/recipes") { logPageView(env, ctx, request, url); return html(recipesPage()); }
  if (url.pathname === "/radar") {
    logPageView(env, ctx, request, url);
    // The scan hits SEC EDGAR, so cache the built page at the edge for 15
    // minutes rather than recomputing (and re-fetching from SEC) per visitor.
    const cache = caches.default;
    const ck = new Request("https://signalnodus.ai/radar");
    let resp = await cache.match(ck);
    if (!resp) {
      resp = html(await radarPage(env, ctx), 200, { "cache-control": "public, max-age=900" });
      ctx.waitUntil(cache.put(ck, resp.clone()));
    }
    return resp;
  }
  if (url.pathname === "/pricing") { logPageView(env, ctx, request, url); return html(pricingPage()); }
  if (url.pathname === "/status") { logPageView(env, ctx, request, url); return statusPage(env, ctx); }
  if (url.pathname === "/vs") { logPageView(env, ctx, request, url); return html(vsPage()); }
  if (url.pathname === "/eval") { logPageView(env, ctx, request, url); return html(evalPage()); }
  if (url.pathname === "/eval.json") return json(EVAL_RESULTS);
  if (url.pathname === "/research") { logPageView(env, ctx, request, url); return html(researchIndex()); }
  if (url.pathname.startsWith("/research/")) {
    const page = RESEARCH[url.pathname.slice("/research/".length)];
    if (page) { logPageView(env, ctx, request, url); return html(researchPage(page, url.pathname)); }
  }

  if (isDashboardPath(url.pathname)) return handleDashboard(request, env, url);
  if (url.pathname === "/health") return json({ ok: true });
  // IndexNow ownership proof: search engines fetch this to confirm the ping
  // for our URLs came from us. Public by design.
  if (url.pathname === "/075d985daf8bb3f220089899bfd6820b.txt") return asset("075d985daf8bb3f220089899bfd6820b", "text/plain");
  if (url.pathname === "/site.css") return asset(BASE_CSS, "text/css");
  if (url.pathname === "/site.js") return asset(siteScript(env), "text/javascript");
  if (url.pathname === "/llms.txt") return asset(llmsTxt(), "text/plain");
  if (url.pathname === "/icon.svg") return asset(ICON_SVG, "image/svg+xml");
  if (url.pathname === "/agents") return asset(llmsTxt(), "text/plain");
  if (url.pathname === "/.well-known/mpp.json") return json(discoveryDoc());
  // Machine-readable, LLM-free. A directory that has to ask a model whether we
  // speak MCP will get it wrong when its model is down, which is exactly what
  // happened: our public agent-readiness card read "MCP Support: No" while the
  // MCP server was serving traffic.
  if (url.pathname === "/.well-known/mcp.json") return json(mcpDescriptor());
  if (url.pathname === "/.well-known/agent.json" || url.pathname === "/.well-known/agent-card.json") {
    return json(agentCard());
  }
  if (url.pathname === "/openapi.json") return json(openApiDoc(env));
  // Proves to the official MCP registry that we own signalnodus.ai, which is
  // what lets us publish under the ai.signalnodus namespace. Public key only.
  if (url.pathname === "/.well-known/mcp-registry-auth") {
    return asset(MCP_REGISTRY_PROOF, "text/plain");
  }
  if (url.pathname === "/sitemap.xml") {
    return asset(
      `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://signalnodus.ai/</loc></url>
  <url><loc>https://signalnodus.ai/pricing</loc></url>
  <url><loc>https://signalnodus.ai/eval</loc></url>
  <url><loc>https://signalnodus.ai/status</loc></url>
  <url><loc>https://signalnodus.ai/vs</loc></url>
  <url><loc>https://signalnodus.ai/trial</loc></url>
  <url><loc>https://signalnodus.ai/recipes</loc></url>
  <url><loc>https://signalnodus.ai/radar</loc></url>
  <url><loc>https://signalnodus.ai/research</loc></url>
${Object.keys(RESEARCH).map((k) => `  <url><loc>https://signalnodus.ai/research/${k}</loc></url>`).join("\n")}
</urlset>
`,
      "application/xml",
    );
  }
  if (url.pathname === "/robots.txt") {
    return asset("User-agent: *\nAllow: /\nSitemap: https://signalnodus.ai/\n", "text/plain");
  }
  if (url.pathname === "/") { logPageView(env, ctx, request, url); return html(landingPage(env)); }

  // Everything else is genuinely absent; saying so beats serving the landing
  // page under a wrong URL with a 200.
  return html(
    pageShell(
      "Not found · Signal Nodus",
      `<main class="wrap pad"><h1 class="h1">404</h1><p class="dim">No such page. <a href="/">signalnodus.ai</a></p></main>`,
      { canonical: null, index: false },
    ),
    404,
  );
}

const MAX_VERIFY_BODY = 8 * 1024;

async function verifyContact(request, env) {
  if (!env.TURNSTILE_SECRET) {
    // Misconfiguration, not a visitor error: make it visible in logs rather
    // than letting every visitor see a generic "verification failed".
    console.error("TURNSTILE_SECRET is not configured");
    return json({ success: false, error: "verification unavailable" }, 503);
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_VERIFY_BODY) {
    return json({ success: false, error: "body too large" }, 413);
  }

  let token;
  try {
    const raw = await request.text();
    if (raw.length > MAX_VERIFY_BODY) {
      return json({ success: false, error: "body too large" }, 413);
    }
    ({ token } = JSON.parse(raw));
  } catch {
    return json({ success: false, error: "bad request" }, 400);
  }
  if (!token || typeof token !== "string" || token.length > 4096) {
    return json({ success: false, error: "missing token" }, 400);
  }

  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  form.append("remoteip", request.headers.get("cf-connecting-ip") ?? "");

  let outcome;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`siteverify HTTP ${res.status}`);
    outcome = await res.json();
  } catch (err) {
    // An upstream failure is ours, not the visitor's; never let it become an
    // unhandled rejection and a bare 500.
    console.error("turnstile siteverify failed", err);
    return json({ success: false, error: "verification unavailable" }, 503);
  }

  if (!outcome?.success) {
    return json({ success: false, error: "verification failed" }, 403);
  }
  // Guard against a token minted for a different site being replayed here.
  if (outcome.hostname && !isOwnHostname(outcome.hostname)) {
    return json({ success: false, error: "verification failed" }, 403);
  }

  return json({ success: true, email: env.CONTACT_EMAIL || CONTACT_EMAIL_FALLBACK });
}

// Issues a small free-credit key so a developer can try the product from their
// own agent with no card and no signup. Turnstile gates it against scripted
// farming, and one key is issued per connection (the label carries a hash of
// the IP). The credit is tiny and our own compute is near-free, so the worst
// case of abuse costs cents.
const TRIAL_UNITS = 5000; // $5.00 of API credit

async function handleTrial(request, env, ctx) {
  if (!env.TURNSTILE_SECRET || !env.BILLING) {
    return json({ error: "trial unavailable" }, 503);
  }

  let token;
  try {
    const raw = await request.text();
    if (raw.length > MAX_VERIFY_BODY) return json({ error: "body too large" }, 413);
    ({ token } = JSON.parse(raw || "{}"));
  } catch {
    return json({ error: "bad request" }, 400);
  }
  if (!token || typeof token !== "string" || token.length > 4096) {
    return json({ error: "missing token" }, 400);
  }

  // The visitor must clear Turnstile: this is what stops a script from minting
  // free keys in a loop.
  const ip = request.headers.get("cf-connecting-ip") ?? "";
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  form.append("remoteip", ip);
  let outcome;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`siteverify HTTP ${res.status}`);
    outcome = await res.json();
  } catch (err) {
    console.error("trial siteverify failed", err);
    return json({ error: "verification unavailable" }, 503);
  }
  if (!outcome?.success || (outcome.hostname && !isOwnHostname(outcome.hostname))) {
    return json({ error: "verification failed" }, 403);
  }

  // One trial per connection. The label carries a hash of the IP so a repeat
  // request is refused rather than farmed.
  const ipHash = (await hashKey(ip || "unknown")).slice(0, 32);
  const label = `trial:${ipHash}`;
  try {
    const existing = await env.BILLING.prepare("SELECT 1 FROM api_keys WHERE label = ? LIMIT 1")
      .bind(label)
      .first();
    if (existing) {
      return json(
        {
          error: "trial_already_issued",
          detail: "A free test key was already issued for this connection. Buy credit at https://signalnodus.ai/pricing.",
        },
        409,
      );
    }
  } catch (err) {
    console.error("trial dedupe check failed", err);
    // A duplicate trial costs cents; continue rather than deny a real user.
  }

  let key;
  try {
    key = await mintKey(env, TRIAL_UNITS, label);
  } catch (err) {
    console.error("trial mint failed", err);
    return json({ error: "could not issue trial" }, 503);
  }

  return json({
    api_key: key,
    credit: dollars(TRIAL_UNITS),
    usage: "Send as Authorization: Bearer <key> to mcp.signalnodus.ai or api.signalnodus.ai. Balance at https://signalnodus.ai/api/balance.",
    note: "Free test credit, no expiry. Save this key now; it is not stored in plaintext and cannot be shown again.",
  });
}

function isOwnHostname(hostname) {
  return (
    hostname === "signalnodus.ai" ||
    hostname === "www.signalnodus.ai" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  );
}

function apiResponse(request, url, env) {
  const contact = env.CONTACT_EMAIL || CONTACT_EMAIL_FALLBACK;

  // Discovery documents on the host the endpoints actually live on. x402scan
  // registration resolves the ORIGIN of a submitted endpoint URL and fetches
  // its openapi.json from there, so serving these only on the apex made the
  // API host unregisterable.
  if (url.pathname === "/openapi.json") return json(openApiDoc(env));
  if (url.pathname === "/.well-known/mcp.json") return json(mcpDescriptor());
  if (url.pathname === "/.well-known/agent.json" || url.pathname === "/.well-known/agent-card.json") {
    return json(agentCard());
  }
  // The MPP manifest belongs on the host that serves the paid routes, not
  // only on the apex. Index crawlers resolve the origin they were given and
  // then probe ITS routes for a payment challenge: pointed at the apex they
  // find the manifest but every /v1 path 404s, so the seller reads as broken.
  // Agent402's MPP index rejected us for exactly that on 2026-08-23.
  if (url.pathname === "/.well-known/mpp.json") return json(discoveryDoc());
  // Same document under the x402 discovery name, since crawlers look for one
  // or the other and both describe the same priced surface.
  if (url.pathname === "/.well-known/x402" || url.pathname === "/.well-known/x402.json") {
    return json(discoveryDoc());
  }
  // 402 Index domain-ownership proof. Public hash, instant listing approval.
  if (url.pathname === "/.well-known/402index-verify.txt") {
    return asset("7c8bf86a54822a288ab3ac9ad28d2319185dd1c2f7e03b4ad168f9ccc43cf032", "text/plain");
  }

  switch (url.pathname) {
    case "/":
      return json({
        service: "Signal Nodus — amendment-safe SEC filing sections, diffs, and claim checks for AI agents",
        status: SERVICE_STAGE,
        version: SERVICE_VERSION,
        parser_version: PARSER_VERSION,
        canonical: "https://signalnodus.ai",
        core_tools: CORE_TOOLS,
        accuracy: "Section-boundary and diff accuracy measured on a public golden set: https://signalnodus.ai/eval",
        working_today: {
          mcp: {
            url: "https://mcp.signalnodus.ai/",
            transport: "streamable-http",
            auth: "none for the handshake; Bearer key for paid tools",
            core_tools: CORE_TOOLS,
            source: "US SEC EDGAR",
            coverage:
              "US SEC filings are the product. No prices, no news, no non-US-listed companies, no forecasts. Tools outside the SEC path are marked experimental.",
          },
        },
        endpoints: {
          "GET /": "this service descriptor",
          "GET /health": "liveness",
          "GET /v1/usage": "your key's last 30 days of billed calls, with the accession served (Authorization: Bearer <key>)",
        },
        // Machine payments: call the route, get a 402 challenge, pay, retry,
        // get data plus a receipt. No account or signup needed.
        buy_credit_by_machine_payment: {
          route: "GET /v1/credit?pack=taste|starter|builder|scale",
          returns: "an API key with credit on it, usable on the MCP endpoint",
          why: "the MCP endpoint takes a key rather than per-call payment, so this is how an agent gets one without a checkout page",
        },
        human_checkout: "https://signalnodus.ai/pricing (card, ~60 seconds); free $5 trial key at https://signalnodus.ai/trial",
        paid_endpoints: {
          protocol: "MPP (Machine Payments Protocol) over HTTP 402, Stripe-settled",
          rails: "x402 on Base (USDC), Stripe stablecoin on Tempo from $0.01, and card via shared payment token from $0.50",
          routes: describeRoutes(),
        },
        operator: {
          owner: "human-owned and human-accountable",
          email: contact,
          status: "https://signalnodus.ai/status",
        },
      });
    case "/health":
      return json({ ok: true });
    default:
      if (url.pathname.startsWith("/v1/")) {
        return json(
          {
            error: "unknown_route",
            status: "preview",
            note: `Unknown v1 route. The paid routes are listed under paid_endpoints at GET /. The MCP server at https://mcp.signalnodus.ai/ serves the same tools against prepaid credit. Tell ${contact} what is missing.`,
          },
          501,
        );
      }
      return json({ error: "not found" }, 404);
  }
}

// ------------------------------------------------------------------ helpers

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      // Never let a price list or a balance be served from cache: a caller
      // reading a stale price and then being charged the current one is the
      // one billing bug you cannot apologise your way out of.
      "cache-control": "no-store",
      ...SECURITY_HEADERS,
      ...extra,
    },
  });
}

function html(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...SECURITY_HEADERS, ...extra },
  });
}

function asset(body, contentType) {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": `${contentType}; charset=utf-8`,
      "cache-control": "public, max-age=3600",
      ...SECURITY_HEADERS,
    },
  });
}

function placeholder(name, note) {
  return html(
    pageShell(
      `${name} · Signal Nodus`,
      `<main class="wrap pad">
        <h1 class="h1">${name}</h1>
        <p class="dim narrow">${note}</p>
        <p class="mt"><a href="https://signalnodus.ai/">&larr; signalnodus.ai</a></p>
      </main>`,
      { canonical: null, index: false },
    ),
    200,
    NOINDEX,
  );
}

const BASE_CSS = `
/* buy buttons */
.buyrow{display:flex;gap:.8rem;flex-wrap:wrap;margin:.6rem 0 1rem}
button.buy{font:inherit;padding:.6rem 1.2rem;border-radius:6px;border:1px solid #2a5;background:#0a6;color:#fff;cursor:pointer}
button.buy:hover{filter:brightness(1.1)}
button.buy:disabled{opacity:.5;cursor:wait}

/* research pages */
.narrowread{max-width:46rem}
.narrowread table{border-collapse:collapse;margin:1rem 0;width:100%}
.narrowread th,.narrowread td{border:1px solid var(--line,#2a2a2a);padding:.4rem .7rem;text-align:left}
ul.research{list-style:none;padding:0}
ul.research li{margin:0 0 1rem 0}

  :root {
    --bg: #0b0e14; --panel: #11151f; --line: #1f2534;
    --text: #d7dce6; --dim: #8a93a6; --accent: #4fd1a5; --accent2: #7aa2f7;
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    background: var(--bg); color: var(--text);
    font: 16px/1.65 ui-sans-serif, system-ui, "Segoe UI", sans-serif;
    min-height: 100vh;
  }
  code, pre { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; }
  a { color: var(--accent2); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 0 24px; }
  .pad { padding-top: 72px; }
  .mt { margin-top: 24px; }
  .h1 { font-size: 28px; margin-bottom: 12px; }
  .dim { color: var(--dim); }
  .narrow { max-width: 56ch; }
  header.site { padding: 26px 0; border-bottom: 1px solid var(--line); }
  .mark { font-weight: 700; letter-spacing: .14em; font-size: 15px; }
  .mark .dot { color: var(--accent); }
  footer { border-top: 1px solid var(--line); margin-top: 72px; padding: 28px 0 48px; color: var(--dim); font-size: 14px; }
  pre.block {
    background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
    padding: 16px 18px; overflow-x: auto; font-size: 13.5px; line-height: 1.6;
  }
  .hero { padding: 80px 0 56px; }
  .hero h1 { font-size: clamp(30px,5vw,44px); line-height: 1.15; max-width: 22ch; }
  .lede { margin-top: 20px; color: var(--dim); max-width: 58ch; font-size: 18px; }
  .sub { margin-top: 14px; color: var(--dim); max-width: 58ch; }
  h2 { font-size: 20px; margin-bottom: 14px; }
  .ok { color: var(--accent); }
  h2 { font-size: 17px; margin-top: 34px; margin-bottom: 6px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-top: 12px; }
  .stat { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; }
  .stat-l { color: var(--dim); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
  .stat-v { font-size: 24px; margin-top: 4px; font-weight: 600; }
  .stat-n { color: var(--dim); font-size: 12px; margin-top: 2px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .warn { color: #f7b955; }
  .pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 13px; border: 1px solid var(--line); }
  .pill.ok { color: var(--accent); border-color: #24503f; }
  .pill.bad { color: #ff6b6b; border-color: #5a2a2a; }
  table.packs { border-collapse: collapse; margin-top: 8px; }
  table.packs th, table.packs td { text-align: left; padding: 8px 22px 8px 0; border-bottom: 1px solid var(--line); }
  table.packs th { color: var(--dim); font-weight: 600; font-size: 14px; }
  .radar { margin-top: 8px; }
  .radar-item { padding: 14px 0; border-top: 1px solid var(--line); }
  .radar-item:first-child { border-top: none; }
  .radar-co { font-weight: 600; color: var(--text); }
  .radar-meta { font-size: 13.5px; margin-top: 4px; }
  .mono { font-family: ui-monospace, Consolas, monospace; font-size: .9em; }
`;

function siteScript(env) {
  const sitekey = JSON.stringify(String(env.TURNSTILE_SITEKEY || ""));
  return `(() => {
  // Buy buttons: create a Stripe checkout session and go there. The API
  // existed all along; the page just never gave humans a way to call it.
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button.buy");
    if (!b) return;
    const status = document.getElementById("buy-status");
    b.disabled = true;
    if (status) status.textContent = "Creating checkout...";
    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pack: b.dataset.pack }),
      });
      const d = await r.json();
      if (d && d.checkout_url) {
        location.href = d.checkout_url;
      } else {
        if (status) status.textContent = "Checkout failed: " + (d && d.error ? d.error : "unknown error");
        b.disabled = false;
      }
    } catch (e) {
      if (status) status.textContent = "Checkout failed; use the curl command below.";
      b.disabled = false;
    }
  });

  const el = () => document.getElementById("contact-result");

  window.onTrialToken = async (token) => {
    const out = document.getElementById("trial-result");
    if (out) out.textContent = "Issuing your key...";
    try {
      const r = await fetch("/api/trial", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const d = await r.json();
      if (r.ok && d.api_key) {
        out.textContent = "";
        const p1 = document.createElement("p");
        p1.textContent = "Your test key (" + (d.credit || "$5.00") + " credit). Save it now; it is not shown again:";
        const pre = document.createElement("pre");
        pre.className = "block";
        pre.textContent = d.api_key;
        const p2 = document.createElement("p");
        p2.className = "sub";
        p2.textContent = "Use it as Authorization: Bearer <key> against mcp.signalnodus.ai or api.signalnodus.ai.";
        out.appendChild(p1);
        out.appendChild(pre);
        out.appendChild(p2);
      } else {
        out.textContent = (d && (d.detail || d.error)) || "Could not issue a key. Buy credit at /pricing.";
      }
    } catch (e) {
      out.textContent = "Something broke. Refresh and try again, or buy credit at /pricing.";
    }
  };

  window.onTurnstileOK = async (token) => {
    const out = el();
    try {
      const r = await fetch("/api/verify-contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const d = await r.json();
      if (d && d.success && d.email) {
        const a = document.createElement("a");
        a.href = "mailto:" + d.email;
        const c = document.createElement("code");
        c.textContent = d.email;
        a.appendChild(c);
        out.textContent = "Write to ";
        out.appendChild(a);
      } else {
        out.textContent = "Verification failed. Refresh and try again.";
      }
    } catch {
      out.textContent = "Something broke. Refresh and try again.";
    }
  };

  // Turnstile's script can be blocked by an extension or a network policy.
  // Give up after ~10s and tell the visitor, rather than polling forever.
  let tries = 0;
  const iv = setInterval(() => {
    if (window.turnstile) {
      clearInterval(iv);
      if (document.getElementById("cf-widget")) {
        window.turnstile.render("#cf-widget", { sitekey: ${sitekey}, theme: "dark", callback: window.onTurnstileOK });
      }
      if (document.getElementById("cf-trial")) {
        window.turnstile.render("#cf-trial", { sitekey: ${sitekey}, theme: "dark", callback: window.onTrialToken });
      }
      return;
    }
    if (++tries > 100) {
      clearInterval(iv);
      const out = el();
      if (out) out.textContent = "The checkpoint could not load. The address is also in the API descriptor at api.signalnodus.ai.";
    }
  }, 100);
})();`;
}

function pageShell(title, inner, opts = {}) {
  const { canonical = "https://signalnodus.ai/", index = true, turnstile = false, description = null } = opts;
  const beacon = BEACON_TOKEN
    ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${BEACON_TOKEN}"}'></script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${canonical ? `<link rel="canonical" href="${canonical}">` : ""}
${index ? "" : '<meta name="robots" content="noindex, nofollow">'}
<meta name="description" content="${description || "Signal Nodus: year-over-year diffs of SEC filing sections, pinned to accession numbers. The diff is the product; raw data is the on-ramp."}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description || "Amendment-safe SEC filing sections, YoY diffs, and claim checks for AI agents, over MCP and HTTP. Priced per call, accuracy measured on a public golden set."}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Signal Nodus">
${canonical ? `<meta property="og:url" content="${canonical}">` : ""}
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="/site.css">
${beacon}
</head>
<body>
<header class="site"><div class="wrap"><span class="mark">SIGNAL<span class="dot">·</span>NODUS</span></div></header>
${inner}
<footer><div class="wrap">Signal Nodus · human-owned · <a href="/status">status</a> · <a href="/eval">accuracy</a> · <a href="https://github.com/hgenix20/signalnodus">source on GitHub</a></div></footer>
<script src="/site.js" defer></script>
${turnstile ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ""}
</body>
</html>`;
}

function landingPage() {
  const inner = `
<main class="wrap">
  <section class="hero">
    <h1>Amendment-safe SEC filing tools for AI agents.</h1>
    <p class="lede">
      Signal Nodus extracts 10-K and 10-Q sections as clean text, diffs them
      year over year at sentence level, and checks numeric claims against
      as-filed XBRL. Every answer is pinned to an accession number, so an
      amended filing can never move a baseline your agent already computed.
    </p>
    <p class="sub">
      Accuracy is the product: section-boundary and diff accuracy are measured
      on a <a href="/eval"><strong>public golden set</strong></a>, every
      filing-derived response carries its accession, filing date, source URL,
      and parser version, and a wrong section is a bug we ask you to
      <a href="/status">report</a>.
    </p>
    <p class="sub">
      Try it from your own agent with a <a href="/trial"><strong>free $5 test key</strong></a>.
      No card, no signup. Humans buy credit with a card in about a minute at
      <a href="/pricing">pricing</a>; agents can pay per call over x402.
    </p>
    <p class="sub">
      A human owns and runs this service; an AI agent handles day-to-day tool
      operations under that owner's control and kill switch.
      <a href="https://github.com/hgenix20/signalnodus">Source on GitHub</a>.
    </p>
  </section>

  <section id="core">
    <h2>The core path</h2>
    <pre class="block">lookup_company          free    resolve ticker to CIK, prove the service works
recent_filings          $0.01   filing index with accession numbers
latest_filings          $0.01   live market-wide filing feed
filing_section          $0.05   one item (1A, 7, 7A...) as clean text
compare_filings         $0.50   sentence-level YoY diff, the flagship
verify_financial_claim  $0.10   claim vs as-filed XBRL: supported or contradicted
filing_events           $0.05   8-K events with decoded item codes</pre>
    <p class="sub">
      That is the product. Other tools exist and are priced on the
      <a href="/pricing">pricing page</a>; anything outside the SEC path is
      marked experimental and is not covered by the accuracy eval.
    </p>
    <p class="sub">
      Scope, stated plainly: primary records only. No news, no forecasts, no
      analyst opinion. See real output on real filings at
      <a href="/research">research</a>, or copy-paste <a href="/recipes">recipes</a>.
    </p>
  </section>

  <section id="mcp" class="mt">
    <h2>Connect over MCP or HTTP</h2>
    <pre class="block">{ "mcpServers": { "signalnodus": { "type": "http", "url": "https://mcp.signalnodus.ai/" } } }</pre>
    <p class="sub">
      Point an MCP client at the server and the tools appear, prices stated in
      each description. The same tools answer over plain HTTP:
    </p>
    <pre class="block">curl "https://api.signalnodus.ai/v1/company?company=NVDA"          <span class="dim"># free</span>
curl "https://api.signalnodus.ai/v1/compare?company=NVDA&amp;item=1A"  <span class="dim"># $0.50, the diff</span></pre>
    <p class="sub">
      An unpaid call to a priced route returns HTTP 402 with an x402 challenge
      on Base. Settle it and the same call returns the data, no account. Or send
      <code>Authorization: Bearer &lt;key&gt;</code> from a prepaid balance, and
      read your own audit log any time at <code>/v1/usage</code>.
    </p>
  </section>

  <section class="mt">
    <h2>Watch it on live filings</h2>
    <p class="sub">
      The <a href="/radar"><strong>live 8-K item feed</strong></a> shows filings
      hitting EDGAR right now with every item code decoded, built with the same
      <code>latest_filings</code> tool you can call.
    </p>
  </section>

  <section class="mt">
    <h2>Talk to the operator</h2>
    <p class="sub">
      Agents and humans both welcome. Clear the checkpoint and the address
      appears; machines can skip it and read the same address from the
      descriptor at <a href="https://api.signalnodus.ai/">api.signalnodus.ai</a>.
      Service health and policies: <a href="/status">status</a>.
    </p>
    <div id="cf-widget" class="mt"></div>
    <p id="contact-result" class="mt"></p>
  </section>
</main>`;
  return pageShell("Signal Nodus", inner, { turnstile: true });
}

// The full 8-K item catalog with a per-item-type severity weight and the
// plain-English stakes. Severity reflects how consequential that ITEM TYPE
// usually is, never a view on any company; the exact ranking rule is printed
// on the feed page itself.
const EIGHTK_SIGNAL = {
  "1.03": [100, "filed for bankruptcy or receivership"],
  "4.02": [98, "said previously issued financials can no longer be relied on (a restatement flag)"],
  "1.05": [95, "disclosed a material cybersecurity incident"],
  "3.01": [92, "received a delisting or listing-standard notice"],
  "2.04": [88, "triggered acceleration of a direct financial obligation"],
  "5.01": [85, "reported a change in control of the company"],
  "4.01": [80, "changed its independent auditor"],
  "2.01": [72, "completed an acquisition or disposition of assets"],
  "5.02": [70, "reported a change in directors or top officers"],
  "1.02": [66, "terminated a material definitive agreement"],
  "2.06": [64, "recorded a material impairment"],
  "2.05": [62, "committed to a restructuring or exit plan"],
  "6.04": [60, "failed to make a required distribution (ABS)"],
  "2.03": [58, "created a direct financial obligation or off-balance-sheet arrangement"],
  "1.01": [55, "entered a material definitive agreement"],
  "2.02": [50, "reported results of operations"],
  "5.06": [45, "reported a change in shell status"],
  "3.03": [45, "materially modified the rights of security holders"],
  "3.02": [40, "sold unregistered equity securities"],
  "5.04": [40, "suspended trading under employee benefit plans"],
  "6.03": [40, "reported a change in a credit enhancement (ABS)"],
  "5.03": [35, "amended its charter or bylaws, or changed its fiscal year"],
  "5.05": [35, "amended or waived its code of ethics"],
  "6.02": [35, "changed a servicer or trustee (ABS)"],
  "5.07": [34, "disclosed shareholder-vote results"],
  "1.04": [30, "reported a mine-safety matter"],
  "5.08": [30, "disclosed shareholder director nominations"],
  "7.01": [30, "disclosed information under Regulation FD"],
  "6.01": [25, "filed ABS informational and computational material"],
  "6.05": [25, "filed a Securities Act updating disclosure"],
  "8.01": [20, "filed an other-events disclosure"],
  "9.01": [5, "attached financial statements and exhibits"],
};

function escHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// A live, public demo of the product: 8-K filings hitting EDGAR right now
// with every item code decoded, built by calling our own tools internally
// (the Worker cannot fetch its own custom domain, so it calls the tool
// functions directly).
async function radarPage(env, ctx) {
  let rows = "";
  try {
    const data = await toolLatestFilings({ form: "8-K", limit: 40 }, ctx);
    const ranked = (data.filings || [])
      .map((f) => {
        const items = (f.items || []).map((it) => ({
          item: it.item,
          title: it.title,
          severity: EIGHTK_SIGNAL[it.item]?.[0] ?? 0,
          stakes: EIGHTK_SIGNAL[it.item]?.[1] || null,
        }));
        if (!items.length) return null;
        const top = items.reduce((a, b) => (b.severity > a.severity ? b : a));
        // The documented ranking rule, printed on the page: highest item-type
        // severity first, then how many substantive items (severity >= 50)
        // the filing reports, then recency as filed.
        const density = items.filter((it) => it.severity >= 50).length;
        return { f, items, top, density };
      })
      .filter(Boolean)
      .sort((a, b) => b.top.severity - a.top.severity || b.density - a.density)
      .slice(0, 15);

    rows = ranked
      .map(({ f, items, top }) => {
        const co = escHtml((f.company || "A public company").replace(/\s+/g, " ").trim());
        const date = escHtml(String(f.filingDate || f.filedAt || "").slice(0, 10));
        const acc = escHtml(f.accessionNumber || "");
        const secUrl = typeof f.indexUrl === "string" && f.indexUrl.startsWith("https://www.sec.gov/") ? f.indexUrl : null;
        const allItems = items.map((it) => escHtml(it.item)).join(", ");
        const lead = top.stakes ? `${co} ${escHtml(top.stakes)}.` : `${co} filed an 8-K.`;
        return `<div class="radar-item">
  <div><span class="radar-co">${lead}</span></div>
  <div class="dim radar-meta">Items ${allItems} &middot; 8-K filed ${date} &middot; ${
          secUrl ? `<a href="${escHtml(secUrl)}">${acc} on SEC EDGAR</a>` : `<span class="mono">${acc}</span>`
        }</div>
</div>`;
      })
      .join("\n");

    if (!rows) rows = `<p class="sub">No decodable 8-K items in the latest batch. This page refreshes every 15 minutes.</p>`;
  } catch (err) {
    console.error("radar build failed", err);
    rows = `<p class="sub">The feed could not reach SEC EDGAR just now. It refreshes every 15 minutes; try again shortly.</p>`;
  }

  const inner = `
<main class="wrap">
  <section class="hero">
    <h1>Live 8-K item feed</h1>
    <p class="lede">8-K filings hitting SEC EDGAR right now, with every item code decoded. Primary-source, refreshed every 15 minutes.</p>
    <p class="sub">Every row was pulled and decoded with the same Signal Nodus tools an agent can call, and links to the filing on SEC EDGAR.</p>
  </section>
  <section>
    <div class="radar">
${rows}
    </div>
    <p class="dim mt">Ranking rule: rows are ordered by the highest item-type severity in the filing, then by how many items of severity 50 or more it reports. Severity weights are fixed per item type (bankruptcy 1.03 = 100 down to exhibits 9.01 = 5) and never reflect a view on any company. Item-code meanings are the SEC's own. Not investment advice.</p>
  </section>
  <section class="mt">
    <h2>Run this from your own agent</h2>
    <pre class="block">// MCP: point your client at the server, then call the tools
https://mcp.signalnodus.ai/     <span class="dim"># lookup_company is free</span>

// or over HTTP, pay per call with a prepaid key or x402 on Base
curl "https://api.signalnodus.ai/v1/latest?form=8-K&amp;limit=40" \\
  -H "authorization: Bearer &lt;key&gt;"</pre>
    <p class="sub">The feed above uses <code>latest_filings</code> and the decoded item codes it carries. Full catalog and prices on the <a href="/pricing">pricing page</a>.</p>
  </section>
</main>`;
  return pageShell("Live 8-K item feed · Signal Nodus", inner, {
    canonical: "https://signalnodus.ai/radar",
    description: "A live feed of 8-K filings hitting SEC EDGAR, with every item code decoded and linked to the source filing. Built on Signal Nodus tools.",
  });
}

// One line per tool, derived from the same PRICING table the meter charges,
// so this page cannot understate the catalog or drift from real prices.
const TOOL_BLURBS = {
  lookup_company: "proves the service works",
  recent_filings: "recent filings with accession numbers",
  company_financials: "as-reported XBRL facts",
  filing_section: "one item extracted from a 10-K or 10-Q",
  edgar_search: "phrase search over all filings since 2001",
  filing_events: "8-K material events, decoded item codes",
  who_holds: "which institutions hold a stock",
  institutional_holdings: "a manager's 13F, parsed",
  insider_trades: "Form 4s parsed into transactions",
  activist_stakes: "13D/13G stakes naming a company",
  ipo_pipeline: "new S-1/F-1 registrations",
  latest_filings: "live market-wide filing feed",
  government_contracts: "federal awards from USAspending",
  lobbying: "Senate LDA disclosures by client",
  cftc_positioning: "CFTC futures positioning, weekly",
  energy_data: "EIA energy prices and grid demand",
  crop_data: "USDA crop yields, production, stocks",
  trade_flows: "US trade by commodity and partner",
  evm_balance: "native balance, Base or Ethereum",
  evm_gas: "current gas price",
  evm_receipt: "transaction receipt",
  token_price: "DEX-aggregated token price",
  fx_rate: "ECB reference FX rates",
  domain_report: "DNS, DMARC, registration age",
  prediction_markets: "Polymarket implied odds",
  rewrite_ratio: "mechanical YoY rewrite ratio of an item",
  verify_financial_claim: "claim vs as-filed XBRL",
  x402_audit: "audit a public x402 endpoint",
  token_report: "token due-diligence data",
  gas_optimizer: "cheapest-chain gas in USD",
  compare_filings: "the flagship: sentence-level YoY diff",
};

function priceBlock() {
  // Core tools first, experimental last and labelled, matching tools/list.
  return Object.keys(PRICING)
    .sort((a, b) => toolRank(a) - toolRank(b))
    .map((tool) => {
      const p = priceOf(tool);
      const price = p === 0 ? "free " : dollars(p).padEnd(5, " ");
      const tag = EXPERIMENTAL_TOOLS.has(tool) ? " [experimental]" : "";
      return `${tool.padEnd(23, " ")}${price}   ${TOOL_BLURBS[tool] || ""}${tag}`.trimEnd();
    })
    .join("\n");
}

function recipesPage() {
  const inner = `
<main class="wrap">
  <section class="hero">
    <h1>Recipes</h1>
    <p class="lede">
      Copy-paste calls your agent can make today. Each one is a real endpoint,
      priced per call, paid with a key or x402 on Base. Grab a
      <a href="/trial">free $5 key</a> first.
    </p>
  </section>
  <section>
    <h2>Diff a 10-K's risk factors, year over year</h2>
    <p class="sub">The flagship. A sentence-level diff of Item 1A across a
      company's two most recent 10-Ks, pinned to accession numbers so an
      amendment can't move a baseline you already computed.</p>
    <pre class="block">curl "https://api.signalnodus.ai/v1/compare?company=NVDA&amp;item=1A" \\
  -H "authorization: Bearer &lt;key&gt;"</pre>
  </section>
  <section class="mt">
    <h2>Watch a ticker for material 8-K events</h2>
    <p class="sub">Decoded item codes, so your agent tells a 4.02 restatement
      flag from a routine 8.01.</p>
    <pre class="block">curl "https://api.signalnodus.ai/v1/events?company=TSLA&amp;limit=10" \\
  -H "authorization: Bearer &lt;key&gt;"</pre>
  </section>
  <section class="mt">
    <h2>Verify a number against the actual filing</h2>
    <p class="sub">A deterministic check of a claimed value against as-reported
      XBRL. Returns supported or contradicted, with the citation.</p>
    <pre class="block">curl "https://api.signalnodus.ai/v1/verify/claim?company=AAPL&amp;concept=Revenues&amp;claimed_value=391035000000&amp;fiscal_year=2024" \\
  -H "authorization: Bearer &lt;key&gt;"</pre>
  </section>
  <section class="mt">
    <h2>See who just filed to go public</h2>
    <p class="sub">New S-1 and F-1 registrations market-wide, the earliest IPO
      signal.</p>
    <pre class="block">curl "https://api.signalnodus.ai/v1/ipos?limit=10" \\
  -H "authorization: Bearer &lt;key&gt;"</pre>
  </section>
  <section class="mt">
    <h2>Track insider selling</h2>
    <p class="sub">Form 4 transactions parsed into who traded, their role,
      shares, and price.</p>
    <pre class="block">curl "https://api.signalnodus.ai/v1/insider?company=NVDA&amp;limit=5" \\
  -H "authorization: Bearer &lt;key&gt;"</pre>
  </section>
  <section class="mt">
    <h2>Over MCP</h2>
    <p class="sub">Point any MCP client at the server and these become tool
      calls, no keys in the URL.</p>
    <pre class="block">https://mcp.signalnodus.ai/   <span class="dim"># streamable-http; Authorization: Bearer &lt;key&gt;</span></pre>
    <p class="sub">Full catalog and prices on the <a href="/pricing">pricing page</a>.</p>
  </section>
</main>`;
  return pageShell("Recipes · Signal Nodus", inner, {
    canonical: "https://signalnodus.ai/recipes",
    description: "Copy-paste SEC-filing API calls for AI agents: diff a 10-K's risk factors, watch 8-K events, verify a number, track insiders, spot IPOs.",
  });
}

function trialPage() {
  const inner = `
<main class="wrap">
  <section class="hero">
    <h1>Free test key</h1>
    <p class="lede">
      Get $5 of API credit to try Signal Nodus from your own agent. No card, no
      signup. Clear the checkpoint and the key appears.
    </p>
    <p class="sub">
      Point an MCP client at <code>mcp.signalnodus.ai</code>, or call
      <code>api.signalnodus.ai</code> over HTTP, with
      <code>Authorization: Bearer &lt;key&gt;</code>. <code>lookup_company</code>
      is free; everything else spends from the $5. See the
      <a href="/radar">radar demo</a> for what the tools return, or the
      <a href="/pricing">full pricing</a>.
    </p>
    <div id="cf-trial" class="mt"></div>
    <p id="trial-result" class="mt"></p>
  </section>
</main>`;
  return pageShell("Free test key · Signal Nodus", inner, {
    canonical: "https://signalnodus.ai/trial",
    turnstile: true,
    description: "Get $5 of free Signal Nodus API credit to try SEC filing intelligence from your agent. No card, no signup.",
  });
}

function pricingPage() {
  const rows = packSummary()
    .map(
      (p) => `<tr><td>${p.label}</td><td>${p.price}</td><td>${p.credits} credit</td><td>${p.diffs} diffs</td></tr>`,
    )
    .join("");

  return pageShell(
    "Pricing · Signal Nodus",
    `<main class="wrap">
      <section class="hero">
        <h1>Pay per job. No subscription.</h1>
        <p class="lede">
          Every call is priced by the work it does, from a cent for a lookup to
          fifty for a finished year-over-year diff. No subscription, no floor.
        </p>
      </section>

      <section>
        <h2>Prices</h2>
        <pre class="block">${priceBlock()}</pre>
        <p class="sub">
          <strong>No subscription and no minimum.</strong> <code>lookup_company</code>
          is free so you can prove the service works before wiring payment to it.
          Everything that does real work is priced per call. Credit never expires.
        </p>
      </section>

      <section class="mt">
        <h2>Credit packs</h2>
        <table class="packs">
          <tr><th>Pack</th><th>Price</th><th>Credit</th><th>Roughly</th></tr>
          ${rows}
        </table>
        <p class="sub">Credit does not expire. There is no monthly fee to cancel.</p>
      </section>

      <section class="mt">
        <h2>Why this is cheaper</h2>
        <p class="sub">
          sec-api.io puts 10-K/10-Q section extraction on its Business tier at
          <strong>$239/month</strong>, and its $55/month entry tier does not
          include extraction at all (their pricing page, checked 15 Aug 2026).
          Intrinio starts at $150/month for SEC-derived fundamentals.
        </p>
        <p class="sub">
          Those are subscriptions: you pay the floor whether you run one job or
          a thousand. Here the same year-over-year diff is <strong>$0.50</strong>
          and the floor is zero. You would need about <strong>480 diffs a
          month</strong> before this costs what the $239 tier costs. Full
          comparison, including when self-hosting beats us: <a href="/vs">/vs</a>.
        </p>
      </section>

      <section class="mt">
        <h2>Buy credit</h2>
        <p class="sub">Card checkout through Stripe. Your API key is on the success page.</p>
        <div class="buyrow">
          <button class="buy" data-pack="starter">Starter &middot; $9</button>
          <button class="buy" data-pack="builder">Builder &middot; $39</button>
          <button class="buy" data-pack="scale">Scale &middot; $149</button>
        </div>
        <p class="sub dim" id="buy-status"></p>
        <p class="sub">Agents buy the same thing without a browser:</p>
        <pre class="block">curl -X POST https://signalnodus.ai/api/checkout \
  -H 'content-type: application/json' \
  -d '{"pack":"starter"}'</pre>
        <p class="sub">
          Or by machine payment with no checkout page:
          <code>GET https://api.signalnodus.ai/v1/credit?pack=starter</code>
          answers 402; settle it and the response body contains your key.
          After buying, send <code>Authorization: Bearer &lt;key&gt;</code>,
          check <code>/api/balance</code> whenever you like, and read your
          audit log at <code>/v1/usage</code>. Card purchases get an emailed
          Stripe receipt for expensing.
        </p>
      </section>
    </main>`,
    { canonical: "https://signalnodus.ai/pricing" },
  );
}

// The comparison a buyer actually runs: what does my real workload cost, and
// what happens when a filing gets amended. Honest about where each option
// wins, including where the answer is "self-host".
function vsPage() {
  const inner = `
<main class="wrap">
  <section class="hero">
    <h1>Signal Nodus vs the alternatives</h1>
    <p class="lede">Priced on a real workload: 20 year-over-year section diffs
    a year, with company lookups and section pulls around them. Not on tool
    counts.</p>
  </section>
  <section>
    <h2>Cost for 20 diffs a year</h2>
    <table class="packs">
      <tr><th></th><th>Signal Nodus</th><th>sec-api.io</th><th>Self-hosted EDGAR parser</th></tr>
      <tr><td>20 diffs + 100 section pulls / year</td><td><strong>$15</strong> (20 &times; $0.50 + 100 &times; $0.05)</td><td><strong>$2,868/yr</strong> ($239/mo Business tier; section extraction is not in the $55 entry tier &mdash; their pricing page, checked 2026-08-15)</td><td><strong>$0 cash</strong> + your engineering time</td></tr>
      <tr><td>Idle months</td><td>$0</td><td>$239/mo regardless</td><td>$0</td></tr>
      <tr><td>Amendment safety</td><td>Accession pinning on every call; unpinned responses warn when a later amendment exists</td><td>Their own tooling; check their docs</td><td>Yours to build and test</td></tr>
      <tr><td>Measured accuracy</td><td><a href="/eval">Published golden-set eval</a>, failures listed, reproducible harness</td><td>Not published, to our knowledge</td><td>Yours to build; our <a href="https://github.com/hgenix20/signalnodus/tree/main/eval">eval harness is open</a> and works on any parser</td></tr>
      <tr><td>Setup</td><td>One MCP URL or one curl</td><td>Account + subscription</td><td>Parser + cache + rate limiting + monitoring</td></tr>
    </table>
  </section>
  <section class="mt">
    <h2>When not to use us</h2>
    <p class="sub">EDGAR is free and several open-source EDGAR MCP servers
    exist. If you run thousands of diffs a month, self-hosting is cheaper than
    anyone's API and you should do it; take our
    <a href="https://github.com/hgenix20/signalnodus">parser and eval set</a>
    with you, they are MIT. What you are paying for here, per call and with no
    floor, is the measured error rate, the amendment handling, and not running
    the infrastructure.</p>
  </section>
  <section class="mt">
    <h2>Try the diff</h2>
    <pre class="block">curl "https://api.signalnodus.ai/v1/compare?company=NVDA&amp;item=1A" \\
  -H "authorization: Bearer &lt;key&gt;"   <span class="dim"># free $5 key at /trial</span></pre>
  </section>
</main>`;
  return pageShell("Compare · Signal Nodus", inner, {
    canonical: "https://signalnodus.ai/vs",
    description: "Signal Nodus vs sec-api.io vs self-hosting an EDGAR parser, priced on 20 diffs a year, with amendment safety and published accuracy compared honestly.",
  });
}

// ------------------------------------------------------------ status + eval

// Live dependency health, the operating policies, and how to report a wrong
// section. Not a marketing surface: every line here is checkable.
async function statusPage(env, ctx) {
  const checks = [];
  const timed = async (name, fn) => {
    const t0 = Date.now();
    try {
      const okRes = await fn();
      checks.push({ name, ok: Boolean(okRes), ms: Date.now() - t0 });
    } catch {
      checks.push({ name, ok: false, ms: Date.now() - t0 });
    }
  };

  await Promise.all([
    timed("billing database (D1)", async () => {
      if (!env?.BILLING) return false;
      await env.BILLING.prepare("SELECT 1").first();
      return true;
    }),
    timed("SEC EDGAR reachable", async () => {
      const res = await fetch("https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&count=1&output=atom", {
        headers: { "user-agent": `SignalNodus/${SERVICE_VERSION} (+https://signalnodus.ai; hgenix@agentmail.to)` },
        signal: AbortSignal.timeout(6000),
      });
      return res.ok;
    }),
  ]);
  checks.push({ name: "Stripe payments configured", ok: Boolean(env?.STRIPE_SECRET_KEY), ms: 0 });
  checks.push({ name: "x402 recipient configured", ok: Boolean(env?.BASE_DEPOSIT_ADDRESS), ms: 0 });

  const rows = checks
    .map(
      (c) =>
        `<tr><td>${escHtml(c.name)}</td><td>${c.ok ? "✅ up" : "❌ down"}</td><td class="dim">${c.ms ? `${c.ms}ms` : ""}</td></tr>`,
    )
    .join("");

  const inner = `
<main class="wrap">
  <section class="hero">
    <h1>Status &amp; policies</h1>
    <p class="lede">Live dependency health, checked as you loaded this page, plus the operating policies a caller should be able to rely on.</p>
  </section>
  <section>
    <h2>Right now</h2>
    <table class="packs"><tr><th>Dependency</th><th>State</th><th></th></tr>${rows}</table>
    <p class="dim">Version ${SERVICE_VERSION} (${SERVICE_STAGE}) &middot; parser ${PARSER_VERSION} &middot; liveness probe: <code>GET https://api.signalnodus.ai/health</code></p>
  </section>
  <section class="mt">
    <h2>Rate limits</h2>
    <p class="sub">Unauthenticated MCP traffic is limited to 60 requests per 60 seconds per caller. Paid and keyed calls are limited by credit, not by rate. If you need sustained volume beyond this, email first and it can be arranged.</p>
  </section>
  <section class="mt">
    <h2>SEC fair access</h2>
    <p class="sub">Every upstream request to EDGAR declares the operator and a contact address in its User-Agent, responses are edge-cached to keep upstream load minimal, and per-caller rate limits stop anyone amplifying traffic into SEC through this service.</p>
  </section>
  <section class="mt">
    <h2>Wrong section? Tell us.</h2>
    <p class="sub">If <code>filing_section</code> or <code>compare_filings</code> returned the wrong text, email <a href="mailto:hgenix@agentmail.to">hgenix@agentmail.to</a> with the accession number and item from your response payload. Reports are answered within 24 hours and confirmed misparses go into the <a href="/eval">public golden set</a> so they cannot regress.</p>
  </section>
  <section class="mt">
    <h2>Operator</h2>
    <p class="sub">Signal Nodus is owned and accountable to a human operator; an AI agent handles day-to-day operations under that owner's control. Contact for everything: <a href="mailto:hgenix@agentmail.to">hgenix@agentmail.to</a>. Paying customers can read their own 30-day audit log at <code>GET https://api.signalnodus.ai/v1/usage</code>.</p>
  </section>
</main>`;
  return html(pageShell("Status · Signal Nodus", inner, {
    canonical: "https://signalnodus.ai/status",
    description: "Live dependency health, rate limits, SEC fair-access policy, and how to report a wrong section.",
  }));
}

// Latest measured accuracy, bundled at deploy time from eval/results.json.
// The dataset and harness are public in the repo; anyone can re-run them.
function evalPage() {
  const r = EVAL_RESULTS;
  const sec = r?.section_boundary || {};
  const diff = r?.diff || {};
  const fails = (sec.failures || [])
    .map((f) => `<tr><td class="mono">${escHtml(f.id)}</td><td>${escHtml(f.reason)}</td></tr>`)
    .join("");

  const inner = `
<main class="wrap">
  <section class="hero">
    <h1>Accuracy, measured</h1>
    <p class="lede">
      Section extraction and diffing are evaluated against a public golden set
      of real EDGAR filings, including amended filings and known-messy layouts.
      The dataset and harness are in the
      <a href="https://github.com/hgenix20/signalnodus/tree/main/eval">open repo</a>;
      every number below is reproducible with <code>node eval/run.mjs</code>.
    </p>
    <p class="sub">Last run ${escHtml(String(r?.ran_at || "not yet published"))} &middot; parser ${escHtml(String(r?.parser_version || PARSER_VERSION))} &middot; JSON at <a href="/eval.json">/eval.json</a></p>
  </section>

  <section>
    <h2>Section boundaries</h2>
    <pre class="block">cases                    ${sec.cases ?? "n/a"}
passed                   ${sec.passed ?? "n/a"}
pass rate                ${sec.pass_rate != null ? (sec.pass_rate * 100).toFixed(1) + "%" : "n/a"}
  non-amended filings    ${sec.pass_rate_non_amended != null ? (sec.pass_rate_non_amended * 100).toFixed(1) + "%" : "n/a"}
  amended filings (/A)   ${sec.pass_rate_amended != null ? (sec.pass_rate_amended * 100).toFixed(1) + "%" : "n/a"}</pre>
    <p class="sub">
      A case passes only if the extracted section starts at the real item
      heading, contains none of the table-of-contents signature, does not run
      into the next item, stays inside a plausible length band, and contains
      the hand-verified anchor phrases for that filing. Any single failed
      check fails the case.
    </p>
  </section>

  <section class="mt">
    <h2>Diff precision and recall</h2>
    <pre class="block">perturbation trials      ${diff.trials ?? "n/a"}
sentence precision       ${diff.precision != null ? (diff.precision * 100).toFixed(1) + "%" : "n/a"}
sentence recall          ${diff.recall != null ? (diff.recall * 100).toFixed(1) + "%" : "n/a"}
false-positive reformats ${diff.reformat_false_positives ?? "n/a"}</pre>
    <p class="sub">
      Method: real extracted sections are perturbed with known edits
      (sentences removed, sentences inserted, and cosmetic reformatting that
      must NOT register), then the diff's reported changes are scored against
      the known edit set. Ground truth is constructed, so precision and recall
      are exact, and a reformat that shows up as a change counts against us.
    </p>
  </section>

  ${fails ? `<section class="mt"><h2>Open failures</h2><table class="packs"><tr><th>Case</th><th>Why it fails</th></tr>${fails}</table><p class="sub">Failures stay listed until fixed; they are the to-do list, not a secret.</p></section>` : ""}

  <section class="mt">
    <h2>Reproduce it</h2>
    <pre class="block">git clone https://github.com/hgenix20/signalnodus
cd signalnodus &amp;&amp; node eval/run.mjs</pre>
    <p class="sub">The harness fetches the pinned accessions straight from SEC EDGAR and runs the same parser the live service runs. Found a filing we get wrong? Email <a href="mailto:hgenix@agentmail.to">hgenix@agentmail.to</a> with the accession; confirmed misparses join this set.</p>
  </section>
</main>`;
  return pageShell("Accuracy eval · Signal Nodus", inner, {
    canonical: "https://signalnodus.ai/eval",
    description: "Published section-boundary and diff accuracy for Signal Nodus, measured on a public golden set of real SEC filings. Reproducible from the open repo.",
  });
}

// Machine-readable service description. Agents and crawlers read this to work
// out what a service does and how to pay for it, without parsing marketing
// copy. Written in the words someone would actually search for, because that
// is what Stripe Directory matches against.
function llmsTxt() {
  const price = (t) => dollars(priceOf(t));
  return `# Signal Nodus

> Amendment-safe SEC filing tools for AI agents: extract 10-K and 10-Q
> sections as clean text, diff them year over year, and verify numeric claims
> against as-filed XBRL. Pay per call, no account and no subscription.
> Accuracy is measured on a public golden set: https://signalnodus.ai/eval

## The core path (this is the product)

- lookup_company (free): resolve a ticker to the company's SEC identity, and
  prove the service works before paying anything.
- recent_filings / latest_filings: the filing record with accession numbers.
- filing_section: one item from a 10-K or 10-Q (risk factors, MD&A, business,
  legal proceedings...) as clean text, instead of a multi-megabyte HTML
  document.
- compare_filings (the flagship): sentence-level diff of the same item across
  two filings: passages added, passages removed, change ratio.
- verify_financial_claim: a numeric claim checked deterministically against
  the company's own XBRL as filed. Returns supported, contradicted, or
  unverifiable, with the citation.
- filing_events: 8-K filings decoded into material events by item code.

Every filing-derived response carries accessionNumber, filingDate, a source
URL, and parserVersion. Pin any call to an exact accession number and an
amended filing can never move a baseline you already computed; unpinned calls
warn when a later amendment exists.

## Scope

US SEC filings are the product. No news, no forecasts, no analyst opinion, no
share-price history. Supporting and experimental tools (13F holdings, insider
trades, IPO pipeline, US government awards and lobbying, market utilities)
are priced in the catalog and marked experimental where they leave the SEC
path; they are not covered by the accuracy eval.

## Endpoints

MCP server (streamable HTTP): https://mcp.signalnodus.ai/
REST, pay per call:           https://api.signalnodus.ai/v1/
Service descriptor:           https://api.signalnodus.ai/
Pricing as JSON:              https://signalnodus.ai/api/pricing
Accuracy eval:                https://signalnodus.ai/eval (JSON: /eval.json)
Status and policies:          https://signalnodus.ai/status
Your audit log:               GET https://api.signalnodus.ai/v1/usage (Bearer key)

## Core prices

- lookup_company          free (proof of life)
- recent_filings          ${price("recent_filings")}
- latest_filings          ${price("latest_filings")}  market-wide live filing feed
- filing_section          ${price("filing_section")}
- compare_filings         ${price("compare_filings")}  the flagship YoY diff
- verify_financial_claim  ${price("verify_financial_claim")}
- filing_events           ${price("filing_events")}  8-K item codes decoded

Full catalog, including supporting and experimental tools, at
https://signalnodus.ai/api/pricing.

## How to pay

Humans: a free $5 trial key at https://signalnodus.ai/trial (no card), and
card checkout for credit packs at https://signalnodus.ai/pricing in about a
minute. Receipts are emailed on card purchases.

Agents: Machine Payments Protocol (MPP) over HTTP 402. Call a /v1/ route,
receive a 402 with a payment challenge in the WWW-Authenticate header, pay,
and retry. Rails: x402 on Base (USDC, chain 8453), Stripe stablecoin on Tempo
from $0.01, card via shared payment token from $0.50.

The MCP endpoint takes a prepaid key instead of per-call payment. An agent can
buy one with a machine payment, no account needed:

  GET https://api.signalnodus.ai/v1/credit?pack=taste   ($0.09 starter pack)
  GET https://api.signalnodus.ai/v1/credit?pack=starter ($9)

That returns 402 with a challenge; pay and retry, and the response body
contains the API key. Send it as Authorization: Bearer <key>.

## Operator

Human-owned and human-accountable. An AI agent handles day-to-day tool
operations under the owner's control and kill switch.
Contact: hgenix@agentmail.to
`;
}

// Structured counterpart to llms.txt, for clients that would rather parse JSON
// than prose.
function discoveryDoc() {
  const route = (path, tool, params) => ({
    path,
    method: "GET",
    price: dollars(priceOf(tool)),
    price_units_tenths_of_cent: priceOf(tool),
    params,
  });
  return {
    name: "Signal Nodus",
    description:
      "Market intelligence API for AI agents: SEC filing section diffs pinned to accession numbers, " +
      "8-K events, 13D/13G stakes, insider trades, 13F holdings, IPO registrations, full-text EDGAR " +
      "search, XBRL claim verification, US federal contracts and lobbying, plus market utilities.",
    source: "Primary records: US SEC EDGAR, USAspending.gov, Senate LDA, ECB, public chain RPC",
    scope: "US-listed companies and US federal data. No news, forecasts, opinion, or price history.",
    payment: {
      protocol: "MPP over HTTP 402",
      settles_via: "Stripe",
      rails: {
        x402_base: {
          network: "eip155:8453",
          asset: "USDC",
          note: "standard x402; no account with us required",
        },
        stablecoin_tempo: { minimum: "$0.01" },
        card_shared_payment_token: { minimum: "$0.50" },
      },
      alternative: "prepaid credit key, Authorization: Bearer <key>",
    },
    mcp: { url: "https://mcp.signalnodus.ai/", transport: "streamable-http" },
    // Derived from the live route table, priced routes FIRST. Index crawlers
    // probe the first advertised route to confirm a seller actually charges,
    // and lookup_company is free, so leading with it made us read as a
    // non-paying endpoint. Agent402's MPP index rejected us for exactly that
    // on 2026-08-23 ("no WWW-Authenticate: Payment challenge on the probed
    // endpoint") even though every priced route challenges correctly.
    routes: describeRoutes()
      .slice()
      .sort((a, b) => priceOf(b.tool) - priceOf(a.tool))
      .map((r) => route(r.path, r.tool, r.params)),
    base_url: "https://api.signalnodus.ai",
    contact: "hgenix@agentmail.to",
  };
}

// ------------------------------------------------------- machine discovery

function mcpDescriptor() {
  return {
    name: "signalnodus",
    version: SERVICE_VERSION,
    description:
      "Amendment-safe SEC filing tools: extract 10-K/10-Q sections as clean text, " +
      "diff them year over year at sentence level, verify numeric claims against " +
      "as-filed XBRL, and decode 8-K events. Everything pinned to accession numbers " +
      "so an amendment can never move a baseline. Accuracy measured on a public " +
      "golden set (signalnodus.ai/eval). Priced per call; supporting tools beyond " +
      "the SEC path are marked experimental.",
    homepage: "https://signalnodus.ai",
    openapi: "https://signalnodus.ai/openapi.json",
    transports: [{ type: "streamable-http", url: "https://mcp.signalnodus.ai/" }],
    core_tools: CORE_TOOLS,
    // Every registered tool; a hand list here once hid 11 of 16 from
    // directories that gate on this descriptor. Core tools lead.
    capabilities: Object.keys(PRICING).sort((a, b) => toolRank(a) - toolRank(b)),
    payment: {
      protocols: ["x402", "mpp"],
      networks: ["eip155:8453"],
      assets: ["USDC"],
      per_call: true,
      subscription: false,
      account_required: false,
      // The claim that matters to an agent: it can get a credential without a
      // human, because paying IS the registration.
      autonomous_credential: "https://api.signalnodus.ai/v1/credit?pack=starter",
    },
    contact_email: "hgenix@agentmail.to",
  };
}

// A2A-style agent card. A2A directories and clients look for it at
// /.well-known/agent.json (original spec path) and /.well-known/agent-card.json
// (the renamed one); serve both. The card is honest about transports: this
// service speaks MCP and plain HTTP with x402, not A2A JSON-RPC, and the card
// says so rather than letting a strict A2A client discover it by failing.
function agentCard() {
  return {
    name: "Signal Nodus",
    description:
      "Amendment-safe SEC filing tools from primary records only: sentence-level " +
      "year-over-year diffs of 10-K/10-Q sections pinned to accession numbers, " +
      "section extraction, XBRL claim verification, and decoded 8-K events, with " +
      "supporting tools marked experimental. Accuracy measured on a public golden " +
      "set (signalnodus.ai/eval). Interfaces: MCP (streamable HTTP) and plain HTTP " +
      "GET. Not an A2A JSON-RPC endpoint. Payment: per-call x402 on Base (USDC) or " +
      "a prepaid credit key; no account, no subscription, no signup.",
    url: "https://api.signalnodus.ai",
    version: SERVICE_VERSION,
    documentationUrl: "https://signalnodus.ai",
    provider: { organization: "Signal Nodus (human-owned)", url: "https://signalnodus.ai" },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    additionalInterfaces: [
      { transport: "mcp+streamable-http", url: "https://mcp.signalnodus.ai/" },
      { transport: "http+json", url: "https://api.signalnodus.ai", openapi: "https://api.signalnodus.ai/openapi.json" },
    ],
    payment: {
      protocols: ["x402", "mpp"],
      networks: ["eip155:8453"],
      assets: ["USDC"],
      per_call: true,
      account_required: false,
      autonomous_credential: "https://api.signalnodus.ai/v1/credit?pack=starter",
    },
    // Derived from the live route table, same as every other discovery doc
    // here; a hand list would drift the moment a tool ships.
    skills: describeRoutes().map((r) => ({
      id: r.tool,
      name: r.tool,
      description: `GET ${r.path}, ${r.price} per call. Params: ${r.params || "none"}.`,
      tags: ["market-data", "per-call", "x402"],
    })),
    contact_email: "hgenix@agentmail.to",
  };
}

function priced(tool) {
  const p = priceOf(tool);
  return p === 0 ? "free" : dollars(p);
}

function q(name, desc, required = false) {
  return { name, in: "query", required, schema: { type: "string" }, description: desc };
}

// USDC on Base, the asset every priced route quotes.
const USDC_BASE_ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// Machine-readable payment terms per operation, in the shape MPP indexes
// read. Without this an OpenAPI crawler sees ordinary GET routes and files
// the whole API as unpriced: MPPScan skipped all 32 of ours as "unprotected"
// on 2026-08-23 for exactly that, which also left us unmatched in every
// downstream router that joins against its registry. Derived from the live
// price table so it cannot drift from what the meter actually charges.
function paymentInfo(tool, recipient) {
  const units = priceOf(tool);
  if (!units || !recipient) return null;
  // Prices are tenths of a cent; USDC has 6 decimals, so one unit is 1000
  // atomic USDC.
  const atomic = String(units * 1000);
  return {
    amount: atomic,
    currency: USDC_BASE_ASSET,
    description: `1 ${tool} call`,
    intent: "charge",
    method: "evm",
    network: "8453",
    recipient,
    price: { mode: "fixed", currency: "USD", amount: (units / 1000).toFixed(6) },
    protocols: [
      {
        x402: {
          scheme: "exact",
          network: "eip155:8453",
          currency: USDC_BASE_ASSET,
          recipient,
        },
      },
      {
        mpp: {
          method: "evm",
          intent: "charge",
          network: "8453",
          currency: USDC_BASE_ASSET,
          recipient,
        },
      },
    ],
  };
}


// Square mark for directory listings: a node with two signal arcs. Inline SVG
// so there is no asset pipeline and nothing to 404 when a registry crawls it.
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Signal Nodus">
<rect width="64" height="64" rx="12" fill="#0d1117"/>
<g fill="none" stroke="#4fd1a5" stroke-width="3.2" stroke-linecap="round">
<path d="M38.5 22.5a13 13 0 0 1 0 19"/>
<path d="M46 15a23.5 23.5 0 0 1 0 34"/>
</g>
<circle cx="24" cy="32" r="6.5" fill="#4fd1a5"/>
</svg>`;

function openApiDoc(env) {
  const recipient = env?.BASE_DEPOSIT_ADDRESS || null;
  const paid = {
    description:
      "Payment required. Carries WWW-Authenticate: Payment and an x402 " +
      "PAYMENT-REQUIRED header. Settle it and repeat the request.",
    content: { "application/problem+json": { schema: { type: "object" } } },
  };
  const ok = { description: "Success", content: { "application/json": { schema: { type: "object" } } } };
  const path = (tool, summary, params) => {
    const pay = paymentInfo(tool, recipient);
    return {
      get: {
        summary,
        description: `${summary} Costs ${priced(tool)} per call. No account and no subscription.`,
        parameters: params,
        // An explicit auth mode on every route, priced or free. Crawlers that
        // cannot tell how a route authenticates skip it rather than guess.
        security: pay ? [{ bearerAuth: [] }, { x402Payment: [] }] : [],
        responses: pay ? { 200: ok, 402: paid } : { 200: ok },
        ...(pay ? { "x-payment-info": pay } : {}),
      },
    };
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Signal Nodus",
      version: SERVICE_VERSION,
      description:
        "What changed in a filing, priced per call. compare_filings returns a " +
        "sentence-level year-over-year diff of any 10-K/10-Q item, pinned to " +
        "accession numbers; the other routes are cheap on-ramps to it. Every route answers HTTP 402 " +
        "with an x402 challenge when no payment is presented; there is no " +
        "signup step to fail at, because settling the challenge issues the " +
        "credential. An MCP server over streamable HTTP is at " +
        "https://mcp.signalnodus.ai/ .",
      contact: { email: "hgenix@agentmail.to" },
      license: { name: "Data from US SEC EDGAR, a public primary source" },
      // Indexes read this to tell an agent how to actually use the API.
      "x-guidance":
        "Every route is a single GET with query parameters and returns JSON. " +
        "Start with GET /v1/company to resolve a ticker to a CIK; it is free and " +
        "proves the service works before any payment. The flagship is GET /v1/compare, " +
        "a sentence-level year-over-year diff of one 10-K or 10-Q item, pinned to " +
        "accession numbers so an amendment cannot move the baseline. Pay per call " +
        "either by settling the x402 challenge on the 402 response, or by sending a " +
        "prepaid key as Authorization: Bearer <key>; a key can be bought without a " +
        "human at GET /v1/credit. There is no signup and no subscription. A 400 means " +
        "the request itself is wrong and will never succeed unchanged; a 5xx means the " +
        "service failed rather than the request.",
    },
    servers: [{ url: "https://api.signalnodus.ai" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Prepaid credit key: `Authorization: Bearer <key>`. Buy one by machine payment at GET /v1/credit, no signup step.",
        },
        x402Payment: {
          type: "apiKey",
          in: "header",
          name: "X-PAYMENT",
          description: "Settle the x402 challenge from the 402 response and repeat the request with the signed payment.",
        },
      },
    },
    paths: {
      "/v1/company": path("lookup_company", "Resolve a ticker or name to a CIK and metadata.", [
        q("company", "Ticker or company name.", true),
      ]),
      "/v1/filings": path("recent_filings", "List recent filings with accession numbers.", [
        q("company", "Ticker or company name.", true),
        q("form", "Form type, for example 10-K."),
        q("limit", "Maximum filings to return."),
      ]),
      "/v1/financials": path("company_financials", "As-reported XBRL facts for one concept.", [
        q("company", "Ticker or company name.", true),
        q("concept", "XBRL concept, for example Assets.", true),
      ]),
      "/v1/section": path("filing_section", "One item from a filing as clean text.", [
        q("company", "Ticker or company name.", true),
        q("item", "Item identifier, for example 1A.", true),
        q("form", "Form type, for example 10-K."),
        q("accession", "Pin an exact filing so an amendment cannot move the baseline."),
        q("max_chars", "Truncate the returned text."),
      ]),
      "/v1/compare": path("compare_filings", "Sentence-level diff of one item across two filings.", [
        q("company", "Ticker or company name.", true),
        q("item", "Item identifier, for example 1A.", true),
        q("form", "Form type, for example 10-K."),
        q("from_accession", "Older filing to compare from."),
        q("to_accession", "Newer filing to compare to."),
      ]),
      "/v1/whoholds": path("who_holds", "Which 13F managers hold a company, with total count.", [
        q("company", "Ticker or company name.", true),
        q("limit", "Managers to return, max 100."),
      ]),
      "/v1/holdings": path("institutional_holdings", "An institutional manager's latest 13F parsed: top positions by value.", [
        q("company", "Manager name or CIK.", true),
        q("top", "Positions to return, max 100."),
      ]),
      "/v1/insider": path("insider_trades", "A company's latest Form 4 filings parsed into insider transactions.", [
        q("company", "Ticker or company name.", true),
        q("limit", "Form 4 filings to parse, max 10."),
      ]),
      "/v1/latest": path("latest_filings", "Market-wide feed of filings as they land at EDGAR.", [
        q("form", "Filter to one form type, e.g. 8-K."),
        q("limit", "Entries to return, max 40."),
      ]),
      "/v1/evm/balance": path("evm_balance", "Native balance of any address, Base or Ethereum.", [
        q("chain", "base or ethereum. Default base."),
        q("address", "0x address.", true),
      ]),
      "/v1/evm/gas": path("evm_gas", "Current gas price, Base or Ethereum.", [
        q("chain", "base or ethereum. Default base."),
      ]),
      "/v1/evm/receipt": path("evm_receipt", "Transaction receipt: status, gas used, logs.", [
        q("chain", "base or ethereum. Default base."),
        q("tx", "Transaction hash.", true),
      ]),
      "/v1/token/price": path("token_price", "Token price, FDV, market cap, 24h volume from aggregated DEX data.", [
        q("chain", "base or ethereum. Default base."),
        q("token", "Token contract address.", true),
      ]),
      "/v1/fx/rate": path("fx_rate", "ECB reference FX rates, one base to up to ten symbols.", [
        q("from", "Base currency, ISO 4217. Default USD."),
        q("to", "Comma list of target currencies. Default EUR."),
      ]),
      "/v1/domain/report": path("domain_report", "One-call domain report: DNS records, SPF, registration age, registrar, expiry.", [
        q("domain", "Bare hostname, e.g. example.com.", true),
      ]),
      "/v1/markets/prediction": path("prediction_markets", "Top-volume Polymarket markets with implied probabilities, optionally filtered.", [
        q("q", "Substring filter over market questions."),
        q("limit", "Markets to return, max 25."),
      ]),
      "/v1/search": path("edgar_search", "Exact-phrase full-text search over all EDGAR filings since 2001.", [
        q("q", "Exact phrase, 2-200 characters.", true),
        q("forms", "Comma list of form types, e.g. 10-K,8-K."),
        q("from", "Start date, YYYY-MM-DD."),
        q("to", "End date, YYYY-MM-DD."),
        q("limit", "Hits to return, max 50."),
      ]),
      "/v1/events": path("filing_events", "A company's 8-K material events with decoded item codes.", [
        q("company", "Ticker or company name.", true),
        q("item", "Item-code filter, e.g. 5.02."),
        q("limit", "Events to return, max 25."),
        q("include_amendments", "Also include 8-K/A amendments."),
      ]),
      "/v1/activists": path("activist_stakes", "Schedule 13D/13G filings naming a company: activist and passive stakes.", [
        q("company", "Ticker or company name.", true),
        q("days", "Lookback window in days, 30-730."),
        q("limit", "Filings to return, max 100."),
      ]),
      "/v1/ipos": path("ipo_pipeline", "New S-1/F-1 registrations market-wide: the earliest IPO signal.", [
        q("limit", "Filings to return, max 40."),
        q("include_amendments", "Also include S-1/A and F-1/A."),
      ]),
      "/v1/gov/contracts": path("government_contracts", "US federal prime contract awards to a company, from USAspending.gov.", [
        q("company", "Recipient name, e.g. Lockheed Martin.", true),
        q("days", "Lookback window in days, 30-1825."),
        q("limit", "Awards to return, max 25."),
      ]),
      "/v1/energy": path("energy_data", "US energy prices and grid demand from EIA.", [
        q("series", "electricity_price, fuel_price or grid_demand.", true),
        q("state", "Two-letter state code, for electricity_price."),
        q("sector", "RES, COM, IND, TRA or ALL, for electricity_price."),
        q("region", "Balancing-authority code, for grid_demand."),
        q("limit", "Rows to return, max 100."),
      ]),
      "/v1/crops": path("crop_data", "USDA NASS crop and livestock estimates.", [
        q("commodity", "NASS commodity name, e.g. CORN.", true),
        q("statistic", "YIELD, PRODUCTION, AREA HARVESTED, AREA PLANTED, STOCKS or PRICE RECEIVED."),
        q("year", "Four-digit year."),
        q("state", "Two-letter state code. Omit for national."),
        q("limit", "Rows to return, max 100."),
      ]),
      "/v1/trade": path("trade_flows", "US monthly imports or exports by HS chapter and partner.", [
        q("hs_code", "Two-digit HS chapter, e.g. 87.", true),
        q("year", "Four-digit year.", true),
        q("month", "Month, 01 through 12.", true),
        q("direction", "exports or imports. Default exports."),
      ]),
      "/v1/cftc/positioning": path(
        "cftc_positioning",
        "CFTC Commitments of Traders positioning for a futures contract.",
        [
          q("market", "Contract name fragment, e.g. CRUDE OIL, WHEAT, GOLD.", true),
          q("weeks", "Weeks of history per contract, max 26."),
        ],
      ),
      "/v1/gov/lobbying": path("lobbying", "US Senate LDA lobbying disclosures for a client company.", [
        q("company", "Client company name.", true),
        q("year", "Filing year filter."),
        q("limit", "Filings to return, max 25."),
      ]),
      "/v1/score/rewrite": path("rewrite_ratio", "Mechanical year-over-year rewrite ratio of a filing item: added sentences over total sentences, with a magnitude band. Not a risk opinion.", [
        q("company", "Ticker or company name.", true),
        q("item", "Item identifier. Default 1A."),
        q("form", "10-K or 10-Q. Default 10-K."),
      ]),
      "/v1/x402/audit": path("x402_audit", "Inspect a public x402 endpoint and report its 402 challenge; no payment signed.", [
        q("url", "Absolute https URL of the x402 resource.", true),
      ]),
      "/v1/token/report": path("token_report", "One-call token due-diligence data: price, liquidity, volume, flags.", [
        q("chain", "base, ethereum, or arbitrum. Default base."),
        q("token", "Token contract address.", true),
      ]),
      "/v1/gas/optimizer": path("gas_optimizer", "Cheapest-chain gas as USD cost of a standard transfer.", [
        q("chains", "Comma list from base, arbitrum, ethereum."),
      ]),
      "/v1/verify/claim": path("verify_financial_claim", "Deterministic check of a numeric claim against as-filed XBRL.", [
        q("company", "Ticker or company name.", true),
        q("concept", "XBRL concept, e.g. Revenues.", true),
        q("claimed_value", "The asserted value.", true),
        q("fiscal_year", "Fiscal year of the claim."),
        q("fiscal_period", "FY, Q1-Q4. Default FY."),
        q("end", "Exact period end date, alternative to fiscal_year."),
        q("tolerance_pct", "Match tolerance percent. Default 0.5."),
      ]),
      "/v1/credit": {
        get: {
          summary: "Buy a reusable API key with a machine payment.",
          description:
            "Answers 402. Settle the challenge and the response body contains a " +
            "working API key. This is the whole registration flow: there is no " +
            "email, no confirmation link, and no CAPTCHA.",
          parameters: [q("pack", "taste, starter, builder, or scale.")],
          responses: { 200: ok, 402: paid },
        },
      },
    },
  };
}

// ------------------------------------------------------------------ research
//
// Findings computed with the product, published where a search engine can see
// them. Every number is pinned to accession numbers so a reader can reproduce
// it against the SEC's own documents instead of trusting us. This exists on
// our own domain because publishing analysis only on a social feed hands the
// authority to someone else's page.

const RESEARCH = {
  "diff-an-amended-10k": {
    title: "Walkthrough: diffing a messy amended 10-K without getting burned",
    date: "2026-08-25",
    summary:
      "A real 10-K with two amendments, three parser traps it springs, and the pinned commands that survive them. Includes the trap that caught our own parser.",
    body: `
<p>DUET Acquisition Corp. (CIK 1890671), a SPAC, filed its 10-K for fiscal 2021
on 2022-03-30 (accession <span class="mono">0001493152-22-008123</span>). Item
1A is five sentences: as a smaller reporting company it was "not required to
provide the information required by this Item." Nine months later it filed two
amendments, <span class="mono">0001493152-22-036834</span> (2022-12-30) and
<span class="mono">0001493152-23-001096</span> (2023-01-10), which add real
risk-factor disclosure. This one filing chain springs three separate parser
traps.</p>

<h2>Trap 1: the cross-reference that looks like a heading</h2>
<p>The amendment's forward-looking-statements paragraph contains this text:</p>
<pre class="block">...including the factors set forth in &ldquo;Part I &mdash;
Item 1A. Risk Factors&rdquo; in this Annual Report.</pre>
<p>After HTML rendering, <span class="mono">Item 1A. Risk Factors</span> lands
at the start of a line. A parser that extracts "from the Item 1A heading"
matches it and returns the forward-looking-statements boilerplate as the risk
factors, with no error. <strong>Our parser did exactly this until version
2026-08-25.1.</strong> The golden-set eval caught it (the case is
<span class="mono">0001890671-0001493152-22-036834-1A</span> in
<a href="https://github.com/hgenix20/signalnodus/tree/main/eval">eval/</a>),
and the fix skips heading matches preceded by citation context. The correct
extraction is 4,743 characters starting at the real heading.</p>

<h2>Trap 2: the amendment that moves your baseline</h2>
<p>Diff "the two most recent annual filings" naively in January 2023 and the
amendments silently become one side of your comparison. Against the original
10-K, the 2022-12-30 amendment's Item 1A shows <strong>18 sentences added, 1
removed, 4 unchanged: an 81.8% change ratio</strong>. That is real disclosure
change worth knowing about, but only if you know an amendment is what you are
reading. Every unpinned response here says exactly which accession it used and
warns when a later amendment exists; it never switches documents between
runs.</p>

<h2>Trap 3: the amendment that changes nothing</h2>
<p>Diffing the two amendments against each other: <strong>0 added, 0 removed,
22 unchanged</strong>. The 2023-01-10 refiling did not touch Item 1A. A
pipeline that re-baselines on every new filing would have re-processed and
re-alerted on a no-op. (The inverse trap also exists: some 10-K/As are
exhibit-only and contain no Item 1A at all, and the correct answer there is
"not found", never whatever text happens to sit near the words. That case is
in the golden set too.)</p>

<h2>Reproduce it</h2>
<pre class="block"># the original: five sentences of "not required"
curl "https://api.signalnodus.ai/v1/section?company=1890671&amp;form=10-K&amp;item=1A&amp;accession=0001493152-22-008123" \\
  -H "authorization: Bearer &lt;key&gt;"

# the amendment: the real risk factors, pinned so it can never drift
curl "https://api.signalnodus.ai/v1/section?company=1890671&amp;form=10-K/A&amp;item=1A&amp;accession=0001493152-22-036834" \\
  -H "authorization: Bearer &lt;key&gt;"

# diff the two amendments: 0 added, 0 removed
curl "https://api.signalnodus.ai/v1/compare?company=1890671&amp;form=10-K/A&amp;item=1A&amp;from_accession=0001493152-22-036834&amp;to_accession=0001493152-23-001096" \\
  -H "authorization: Bearer &lt;key&gt;"</pre>
<p>A free $5 key is at <a href="/trial">/trial</a>. Every response carries the
accession, filing date, source URL, and parser version it was computed from,
so any of these numbers can be checked against the SEC's own documents.</p>`,
  },
  "nvidia-risk-factor-churn-2021-2026": {
    title: "NVIDIA's risk factors: six years of churn, and the 2022 break",
    date: "2026-08-18",
    summary:
      "Sentence-level diffs of Item 1A across six 10-K pairs. FY2026 is the calmest section in six years; FY2022 was a near-total rewrite.",
    body: `
<p>We diffed Item 1A (Risk Factors) of every NVIDIA 10-K against the one before
it, sentence by sentence, from the primary EDGAR documents. The change ratio is
the share of sentences in the newer filing that do not appear in the older one.</p>
<table>
<tr><th>Filed</th><th>Change ratio</th><th>Added</th><th>Removed</th><th>Unchanged</th></tr>
<tr><td>2021-02-26</td><td>0.515</td><td>156</td><td>124</td><td>147</td></tr>
<tr><td>2022-03-18</td><td><strong>0.892</strong></td><td>290</td><td>268</td><td><strong>35</strong></td></tr>
<tr><td>2023-02-24</td><td>0.729</td><td>274</td><td>223</td><td>102</td></tr>
<tr><td>2024-02-21</td><td>0.612</td><td>290</td><td>193</td><td>184</td></tr>
<tr><td>2025-02-26</td><td>0.420</td><td>200</td><td>197</td><td>276</td></tr>
<tr><td>2026-02-25</td><td>0.325</td><td>161</td><td>141</td><td>335</td></tr>
</table>
<p>Two findings. First, FY2026's 0.325 is the calmest this section has been in
six years, on a monotonic decline from the 2022 peak; a single-year number
that looks high in isolation is low against its own history. Second, FY2022 is
not an edit. 35 sentences surviving out of 325 is a company replacing its own
risk disclosure, filed weeks after the crypto-mining demand collapse.</p>
<p>For anyone using NVDA history in volatility estimates or stress
calibration, that 2022 break matters: the pre-2022 and post-2022 disclosure
samples are closer to two different companies than one continuous series, and
averaging across the break understates tail risk on both sides. Credit to a
risk agent on Moltbook for that framing, and for the objection that forced the
baseline to be computed at all.</p>
<p>Accession chain, oldest to newest: 0001045810-20-000010, -21-000010,
-22-000036, -23-000017, -24-000029, -25-000023, -26-000021.</p>`,
  },
  "megacap-risk-factor-churn": {
    title: "Risk-factor churn across the megacaps: a 3.4x spread",
    date: "2026-08-18",
    summary:
      "The same sentence-level measure across nine megacaps. AMZN 0.155 to AAPL 0.522 on the latest pairs, and NVDA-2022-class rewrites have a base rate of one.",
    body: `
<p>The same measurement across the largest issuers, latest 10-K against the
prior one:</p>
<table>
<tr><th>Ticker</th><th>Latest pair</th><th>Change ratio</th></tr>
<tr><td>AAPL</td><td>FY2024 to FY2025</td><td>0.522</td></tr>
<tr><td>GOOGL</td><td>FY2025 to FY2026</td><td>0.477</td></tr>
<tr><td>AVGO</td><td>FY2024 to FY2025</td><td>0.476</td></tr>
<tr><td>MSFT</td><td>FY2025 to FY2026</td><td>0.406</td></tr>
<tr><td>AMD</td><td>FY2025 to FY2026</td><td>0.357</td></tr>
<tr><td>TSLA</td><td>FY2025 to FY2026</td><td>0.327</td></tr>
<tr><td>NVDA</td><td>FY2025 to FY2026</td><td>0.325</td></tr>
<tr><td>META</td><td>FY2025 to FY2026</td><td>0.253</td></tr>
<tr><td>AMZN</td><td>FY2025 to FY2026</td><td>0.155</td></tr>
</table>
<p>A 3.4x spread, so the metric does not cluster: the information is in the
outliers and in each name's own history. Running five to six pairs per name,
no other filing in roughly thirty pairs approaches NVIDIA's 2022 rewrite
(0.892 with 35 surviving sentences); in this sample that event class has a
base rate of one. AAPL runs years of near-boilerplate (0.18 to 0.20)
punctuated by discrete revision events in 2021 and 2025; MSFT and AVGO drift
upward across years.</p>
<p>What this measures: editing activity, not exposure. A lightly reworded
sentence counts as one removal plus one addition, and four new sentences on
export controls can matter more than forty reworded boilerplate ones. Both
tails are informative. The calm middle is mostly noise, and low churn after
years of convergence can mean stable boilerplate rather than low risk.</p>`,
  },
  "x402-seller-compatibility": {
    title: "Why agents stop at your x402 paywall: three compatibility walls, measured",
    date: "2026-08-19",
    summary:
      "We instrumented the stock x402 client against our own 402 flow and found three failure walls, none of which reported an error. Fixing them took a day; finding them took real buyer traffic going nowhere.",
    body: `
<p>Our payment funnel showed a pattern that will be familiar to new x402
sellers: agents arriving from directories, walking the catalog, requesting
paid routes repeatedly, and never settling. The usual reading is "no funded
wallets" or "price too high". Before accepting that, we ran the stock client
(x402-fetch, the library Coinbase's own quickstarts hand every buyer) against
our own endpoints with a throwaway key, and logged every step. It hit three
separate walls, and none of them reported an error.</p>

<h3>Wall 1: the challenge payload was only in a header</h3>
<p>Our 402 carried the payment options in the <code>PAYMENT-REQUIRED</code>
header (the v2 header-transport style some server SDKs emit). The stock
client reads the <strong>response body</strong>. Result: a crash inside the
client before anything was signed. Fix: serve the same payload in both
places.</p>

<h3>Wall 2: v2 field names and CAIP network ids</h3>
<p>The client validates the body against the v1 schema: it wants
<code>maxAmountRequired</code>, <code>payTo</code>, <code>resource</code>,
and a short network name like <code>base</code>. Our payload said
<code>amount</code>, <code>recipient</code>, and <code>eip155:8453</code>,
all of which fail its enum and type checks. Fix: emit v1 spellings in the
body alongside the v2 fields.</p>

<h3>Wall 3: the payment itself was ignored</h3>
<p>The worst one. After fixing the first two walls, the client parsed the
challenge, signed a valid EIP-3009 authorization, and sent a correct v1
<code>X-PAYMENT</code> header. Our payment middleware only understood its own
proprietary payment encoding, treated the standard payment as <em>no payment
at all</em>, and re-issued the challenge with no error. A funded buyer paying
correctly would loop forever. Every "agent that stopped at payment" in our
logs was an agent paying into that wall.</p>
<p>Fix: parse v1 <code>X-PAYMENT</code> directly, verify and settle against
the facilitator before the middleware sees the request, serve only after
settlement, return the receipt in <code>X-PAYMENT-RESPONSE</code>, and put a
reason in the body of every rejected payment. The wordless re-challenge was
half the bug: a buyer that is told <em>why</em> can fix its side.</p>

<h3>How to test your own paywall in five minutes</h3>
<p>Wrap the real client with a throwaway key and watch where it stops:</p>
<pre>import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";
const acct = privateKeyToAccount("0x" + "11".repeat(32)); // no funds, no risk
const f = wrapFetchWithPayment(fetch, acct);
await f("https://your-api.example/paid-route");</pre>
<p>The correct end state is a 402 whose body says the facilitator rejected
the signature or balance. If the client crashes, you have wall 1 or 2. If it
sends a payment and gets a bare re-challenge, you have wall 3, and so does
every buyer you have ever had.</p>

<p>All three walls are invisible from the seller's side: the challenge log
just shows repeat 402s, indistinguishable from window-shopping. The
ecosystem's directories now probe uptime and schema quality, but nothing
probes <em>settleability with the stock client</em>, which is the only thing
a buyer actually needs. Until something does, run the five-minute test.</p>`,
  },
  "accession-pinning-point-in-time": {
    title: "Why accession-number pinning is the whole product",
    date: "2026-08-18",
    summary:
      "Amendments get new accession numbers instead of overwriting old ones. Pinning is what keeps a baseline honest, in backtests and in year-over-year diffs.",
    body: `
<p>EDGAR is content-addressed by accident of regulation: an amendment gets its
own accession number rather than overwriting the filing it amends. Most
tooling ignores this and serves "the latest version", which means an amended
10-K can rewrite data your analysis thought it saw at the time with nothing flagging the change, and
you find out much later, if at all.</p>
<p>Everything this service returns can be pinned to an exact accession number.
A diff computed last quarter still means the same thing this quarter, and a
backtest that keys off anything fundamental stays point-in-time honest: the
past cannot be revised after the fact to flatter the present.</p>
<p>The failure this prevents is not hypothetical. The first user who described
their EDGAR workflow to us reported that the server they used "served the
latest amendment, invalidating my baseline with no warning", and that pinning alone
would have saved them a week of baseline-tracking. That sentence is the
product.</p>`,
  },
};

function researchIndex() {
  const items = Object.entries(RESEARCH)
    .map(
      ([slug, p]) =>
        `<li><a href="/research/${slug}">${p.title}</a><br><span class="dim">${p.date} - ${p.summary}</span></li>`,
    )
    .join("\n");
  return pageShell(
    "Research - Signal Nodus",
    `<main class="wrap pad">
      <h1 class="h1">Research</h1>
      <p class="dim narrow">Findings computed with the same tools we sell. Every number is pinned
      to accession numbers, so reproduce them rather than trust them.</p>
      <ul class="research">${items}</ul>
      <p class="mt"><a href="/">Home</a> - <a href="/pricing">Pricing</a></p>
    </main>`,
    { canonical: "https://signalnodus.ai/research" },
  );
}

function researchPage(page, pathname) {
  return pageShell(
    `${page.title} - Signal Nodus`,
    `<main class="wrap pad narrowread">
      <h1 class="h1">${page.title}</h1>
      <p class="dim">${page.date}</p>
      ${page.body}
      <hr>
      <p class="dim">Computed with the Signal Nodus MCP server: 10-K and 10-Q section
      extraction and sentence-level diffs, pinned by accession number, priced per call.
      Company lookup is free and needs no key: <code>https://mcp.signalnodus.ai/</code>.
      <a href="/pricing">Pricing</a> - <a href="/research">More research</a></p>
    </main>`,
    { canonical: `https://signalnodus.ai${pathname}`, description: page.summary },
  );
}
