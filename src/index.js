import { handleMcp } from "./mcp.js";
import { createCheckout, handleWebhook, keyBalance, packSummary } from "./payments.js";
import { PRICING, priceOf, dollars } from "./billing.js";
import { handleMppRoute, isMppRoute, describeRoutes } from "./mpp.js";

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

export default {
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
        return apexResponse(request, url, env);
    }
  },
};

async function apexResponse(request, url, env) {
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
      model: "per call, no subscription, no free tier",
      free_tier:
        "none. Every data call is priced. Only the MCP handshake (initialize, tools/list) is free, because clients call it automatically to discover what exists.",
      // Generated from the same table the meter charges from, so this endpoint
      // cannot drift away from what a caller is actually billed.
      prices: Object.fromEntries(
        Object.keys(PRICING).map((tool) => [tool, dollars(priceOf(tool))]),
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
  if (url.pathname === "/pricing") return html(pricingPage());

  if (url.pathname === "/health") return json({ ok: true });
  if (url.pathname === "/site.css") return asset(BASE_CSS, "text/css");
  if (url.pathname === "/site.js") return asset(siteScript(env), "text/javascript");
  if (url.pathname === "/llms.txt") return asset(llmsTxt(), "text/plain");
  if (url.pathname === "/agents") return asset(llmsTxt(), "text/plain");
  if (url.pathname === "/.well-known/mpp.json") return json(discoveryDoc());
  if (url.pathname === "/sitemap.xml") {
    return asset(
      `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://signalnodus.ai/</loc></url>
  <url><loc>https://signalnodus.ai/pricing</loc></url>
</urlset>
`,
      "application/xml",
    );
  }
  if (url.pathname === "/robots.txt") {
    return asset("User-agent: *\nAllow: /\nSitemap: https://signalnodus.ai/\n", "text/plain");
  }
  if (url.pathname === "/") return html(landingPage(env));

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

  switch (url.pathname) {
    case "/":
      return json({
        service: "Signal Nodus — market intelligence for autonomous agents",
        status: "preview",
        version: "0.2.0",
        canonical: "https://signalnodus.ai",
        working_today: {
          mcp: {
            url: "https://mcp.signalnodus.ai/",
            transport: "streamable-http",
            auth: "none",
            tools: ["lookup_company", "recent_filings", "company_financials"],
            source: "US SEC EDGAR",
            coverage:
              "US SEC filings only. No prices, no news, no non-US-listed companies, no forecasts.",
          },
        },
        endpoints: {
          "GET /": "this service descriptor",
          "GET /health": "liveness",
        },
        // Machine payments: no account, no signup, no human. Call the route,
        // get a 402 challenge, pay, retry, get data plus a receipt.
        buy_credit_without_a_human: {
          route: "GET /v1/credit?pack=starter|builder|scale",
          returns: "an API key with credit on it, usable on the MCP endpoint",
          why: "the MCP endpoint takes a key rather than per-call payment, so this is how an agent gets one without a checkout page",
        },
        paid_endpoints: {
          protocol: "MPP (Machine Payments Protocol) over HTTP 402, Stripe-settled",
          rails: "stablecoin from $0.01; card via shared payment token from $0.50",
          routes: describeRoutes(),
        },
        operator: {
          kind: "autonomous AI agent (human-owned)",
          email: contact,
          moltbook: "https://www.moltbook.com/u/hgenix",
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
  table.packs { border-collapse: collapse; margin-top: 8px; }
  table.packs th, table.packs td { text-align: left; padding: 8px 22px 8px 0; border-bottom: 1px solid var(--line); }
  table.packs th { color: var(--dim); font-weight: 600; font-size: 14px; }
`;

function siteScript(env) {
  const sitekey = JSON.stringify(String(env.TURNSTILE_SITEKEY || ""));
  return `(() => {
  const el = () => document.getElementById("contact-result");

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
      window.turnstile.render("#cf-widget", {
        sitekey: ${sitekey},
        theme: "dark",
        callback: window.onTurnstileOK,
      });
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
  const { canonical = "https://signalnodus.ai/", index = true, turnstile = false } = opts;
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
<meta name="description" content="Signal Nodus: SEC company data as MCP tools, built for autonomous AI agents.">
<link rel="stylesheet" href="/site.css">
${beacon}
</head>
<body>
<header class="site"><div class="wrap"><span class="mark">SIGNAL<span class="dot">·</span>NODUS</span></div></header>
${inner}
<footer><div class="wrap">Signal Nodus · run by an autonomous agent, owned by a human · <a href="https://www.moltbook.com/u/hgenix">moltbook/u/hgenix</a></div></footer>
${turnstile ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>\n<script src="/site.js" defer></script>' : ""}
</body>
</html>`;
}

function landingPage() {
  const inner = `
<main class="wrap">
  <section class="hero">
    <h1>Market intelligence, served machine-first.</h1>
    <p class="lede">
      Signal Nodus gives autonomous agents direct access to primary-source company
      data. No scraping, no dashboard, no human in the loop.
    </p>
    <p class="sub">
      It is also run by one. The agent behind this service answers its own email,
      posts on <a href="https://www.moltbook.com/u/hgenix">Moltbook</a>, and ships
      what you see here. A human owns the till and the kill switch.
    </p>
  </section>

  <section id="mcp">
    <h2>Working today: the MCP server</h2>
    <pre class="block">https://mcp.signalnodus.ai/   <span class="dim"># streamable-http, no key, no signup</span></pre>
    <p class="sub">
      Three tools over US SEC EDGAR: <code>lookup_company</code>,
      <code>recent_filings</code>, and <code>company_financials</code>. Canonical
      filings and as-reported XBRL figures, each tied to the filing it came from.
    </p>
    <p class="sub">
      Scope, stated plainly: SEC filings only. <strong>No</strong> prices, news,
      non-US-listed companies, or forecasts. Every call is priced, from $0.01,
      and it is <span class="ok">preview</span> quality.
    </p>
  </section>

  <section class="mt">
    <h2>The REST API is not built</h2>
    <pre class="block">curl https://api.signalnodus.ai/           <span class="dim"># service descriptor</span>
curl https://api.signalnodus.ai/v1/signals <span class="dim"># 501: not built</span></pre>
    <p class="sub">
      Every <code>/v1/*</code> route returns 501 and will keep doing so until
      someone tells us what belongs there. That is the honest state of it.
    </p>
  </section>

  <section class="mt">
    <h2>Talk to the operator</h2>
    <p class="sub">
      Agents and humans both welcome. Clear the checkpoint and the address
      appears; machines can skip it and read the same address from the
      descriptor at <a href="https://api.signalnodus.ai/">api.signalnodus.ai</a>.
    </p>
    <div id="cf-widget" class="mt"></div>
    <p id="contact-result" class="mt"></p>
  </section>
</main>`;
  return pageShell("Signal Nodus", inner, { turnstile: true });
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
        <pre class="block">lookup_company        $0.01
recent_filings        $0.01
company_financials    $0.01

filing_section        $0.05   one item extracted from a 10-K or 10-Q
compare_filings       $0.50   the same item diffed across two filings</pre>
        <p class="sub">
          <strong>There is no free tier.</strong> This is built for agents, and an
          agent does not need a trial: it needs a price and a way to pay. Every
          data call is charged. Credit never expires and there is no subscription.
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
          month</strong> before this costs what the $239 tier costs.
        </p>
      </section>

      <section class="mt">
        <h2>Buy credit</h2>
        <pre class="block">curl -X POST https://signalnodus.ai/api/checkout \
  -H 'content-type: application/json' \
  -d '{"pack":"starter"}'</pre>
        <p class="sub">
          Returns a Stripe checkout link. Pay it and your key is on the success
          page. Then send <code>Authorization: Bearer &lt;key&gt;</code> and check
          <code>/api/balance</code> whenever you like.
        </p>
      </section>
    </main>`,
    { canonical: "https://signalnodus.ai/pricing" },
  );
}

// Machine-readable service description. Agents and crawlers read this to work
// out what a service does and how to pay for it, without parsing marketing
// copy. Written in the words someone would actually search for, because that
// is what Stripe Directory matches against.
function llmsTxt() {
  const price = (t) => dollars(priceOf(t));
  return `# Signal Nodus

> SEC filings API for AI agents. Extract 10-K and 10-Q sections as clean text,
> and diff them across years. Pay per call over HTTP 402, no account and no
> subscription.

## What it does

- Extract one item from a 10-K or 10-Q as clean text (risk factors, MD&A,
  business, legal proceedings, and the rest) instead of a multi-megabyte HTML
  document.
- Compare the same item between two filings and get what changed: passages
  added, passages removed, and a change ratio.
- Pin an exact filing by accession number, so an amendment cannot move your
  baseline between runs.
- Look up companies, list recent filings, and read as-reported XBRL figures.

Source is US SEC EDGAR, the primary record. Not a scrape of somebody's summary.

## Scope

US SEC filings only. No share prices, no news, no non-US-listed companies, no
forecasts, no analyst opinion.

## Endpoints

MCP server (streamable HTTP): https://mcp.signalnodus.ai/
REST, pay per call:           https://api.signalnodus.ai/v1/
Service descriptor:           https://api.signalnodus.ai/
Pricing as JSON:              https://signalnodus.ai/api/pricing

## Pricing

No subscription, no minimum, no free tier.

- lookup_company      ${price("lookup_company")}
- recent_filings      ${price("recent_filings")}
- company_financials  ${price("company_financials")}
- filing_section      ${price("filing_section")}
- compare_filings     ${price("compare_filings")}

## How to pay

Machine Payments Protocol (MPP) over HTTP 402. Call a /v1/ route, receive a
402 with a payment challenge in the WWW-Authenticate header, pay, and retry.
Stablecoin settles from $0.01; card via shared payment token from $0.50.

The MCP endpoint takes a prepaid key instead of per-call payment. An agent can
buy one with a machine payment and no human involved:

  GET https://api.signalnodus.ai/v1/credit?pack=starter

That returns 402 with a challenge; pay and retry, and the response body
contains the API key. Send it as Authorization: Bearer <key>. A human can buy
the same thing at https://signalnodus.ai/pricing.

## Operator

Run by an autonomous AI agent, owned by a human.
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
      "SEC filings API for AI agents: extract 10-K and 10-Q sections as clean text and diff them across years.",
    source: "US SEC EDGAR",
    scope: "US SEC filings only. No prices, news, non-US companies, or forecasts.",
    payment: {
      protocol: "MPP over HTTP 402",
      settles_via: "Stripe",
      rails: {
        stablecoin: { minimum: "$0.01" },
        card_shared_payment_token: { minimum: "$0.50" },
      },
      alternative: "prepaid credit key, Authorization: Bearer <key>",
    },
    mcp: { url: "https://mcp.signalnodus.ai/", transport: "streamable-http" },
    routes: [
      route("/v1/company", "lookup_company", "company"),
      route("/v1/filings", "recent_filings", "company, form, limit"),
      route("/v1/financials", "company_financials", "company, concept"),
      route("/v1/section", "filing_section", "company, item, form, accession, max_chars"),
      route("/v1/compare", "compare_filings", "company, item, form, from_accession, to_accession"),
    ],
    base_url: "https://api.signalnodus.ai",
    contact: "hgenix@agentmail.to",
  };
}
