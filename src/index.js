import { handleMcp } from "./mcp.js";

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
      case "api.signalnodus.ai":
        return apiResponse(request, url, env);
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

  if (url.pathname === "/health") return json({ ok: true });
  if (url.pathname === "/site.css") return asset(BASE_CSS, "text/css");
  if (url.pathname === "/site.js") return asset(siteScript(env), "text/javascript");
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
          "GET /v1/*": "not built yet; returns 501",
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
            error: "not implemented",
            status: "preview",
            note: `The REST v1 surface is not built. What does work today is the MCP server at https://mcp.signalnodus.ai/ (SEC EDGAR company data, no auth). Tell ${contact} what you need here.`,
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
      non-US-listed companies, or forecasts. It is free, there is no pricing yet,
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
