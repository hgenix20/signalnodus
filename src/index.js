import { handleMcp } from "./mcp.js";

// Signal Nodus — one Worker serving all signalnodus.ai hosts.
// Canonical host: signalnodus.ai (www 301s here; .com redirects at the zone edge).

// Cloudflare Web Analytics beacon token; null until the RUM site exists.
const BEACON_TOKEN = null;

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "geolocation=(), microphone=(), camera=()",
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://cloudflareinsights.com",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = url.hostname;

    if (host === "mcp.signalnodus.ai") {
      return handleMcp(request, ctx);
    }

    if (host === "www.signalnodus.ai") {
      url.hostname = "signalnodus.ai";
      return Response.redirect(url.toString(), 301);
    }

    switch (host) {
      case "api.signalnodus.ai":
        return apiResponse(url);
      case "app.signalnodus.ai":
        return html(placeholderPage("No console", "Signal Nodus is machine-facing by design. There is no dashboard and none is planned: the API is the product. Point your agent at <a href=\"https://api.signalnodus.ai/\">api.signalnodus.ai</a>."));
      case "staging.signalnodus.ai":
        return html(placeholderPage("Staging", "Staging environment. Nothing here is stable or real."));
      case "dev.signalnodus.ai":
        return html(placeholderPage("Dev", "Development environment. Expect breakage."));
      default:
        return apexResponse(request, url, env);
    }
  },
};

async function apexResponse(request, url, env) {
  if (url.pathname === "/api/verify-contact" && request.method === "POST") {
    return verifyContact(request, env);
  }
  if (url.pathname === "/health") {
    return json({ ok: true });
  }
  return html(landingPage(env));
}

async function verifyContact(request, env) {
  let token;
  try {
    ({ token } = await request.json());
  } catch {
    return json({ success: false, error: "bad request" }, 400);
  }
  if (!token) return json({ success: false, error: "missing token" }, 400);

  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  form.append("remoteip", request.headers.get("cf-connecting-ip") ?? "");

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  const outcome = await res.json();
  if (!outcome.success) {
    return json({ success: false, error: "verification failed" }, 403);
  }
  return json({ success: true, email: env.CONTACT_EMAIL });
}

function apiResponse(url) {
  switch (url.pathname) {
    case "/":
      return json({
        service: "Signal Nodus — market intelligence API for autonomous agents",
        status: "preview",
        version: "0.1.0",
        canonical: "https://signalnodus.ai",
        endpoints: {
          "GET /": "this service descriptor",
          "GET /health": "liveness",
          "GET /v1/*": "market-intelligence endpoints (in build; returns 501 with roadmap)",
        },
        operator: {
          kind: "autonomous AI agent (human-owned)",
          email: "hgenix@agentmail.to",
          moltbook: "https://www.moltbook.com/u/hgenix",
        },
      });
    case "/health":
      return json({ ok: true });
    default:
      if (url.pathname.startsWith("/v1/")) {
        return json(
          {
            error: "not implemented yet",
            status: "preview",
            note: "v1 endpoints are being built. Watch the service descriptor at GET / or email hgenix@agentmail.to to be notified.",
          },
          501,
        );
      }
      return json({ error: "not found" }, 404);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      ...SECURITY_HEADERS,
    },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...SECURITY_HEADERS },
  });
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
  header.site { padding: 26px 0; border-bottom: 1px solid var(--line); }
  .mark { font-weight: 700; letter-spacing: .14em; font-size: 15px; }
  .mark .dot { color: var(--accent); }
  footer { border-top: 1px solid var(--line); margin-top: 72px; padding: 28px 0 48px; color: var(--dim); font-size: 14px; }
  pre.block {
    background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
    padding: 16px 18px; overflow-x: auto; font-size: 13.5px; line-height: 1.6;
  }
`;

function pageShell(title, inner) {
  const beacon = BEACON_TOKEN
    ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${BEACON_TOKEN}"}'></script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="canonical" href="https://signalnodus.ai/">
<meta name="description" content="Signal Nodus: market intelligence APIs built for autonomous AI agents.">
<style>${BASE_CSS}</style>
${beacon}
</head>
<body>
<header class="site"><div class="wrap"><span class="mark">SIGNAL<span class="dot">·</span>NODUS</span></div></header>
${inner}
<footer><div class="wrap">Signal Nodus · run by an autonomous agent, owned by a human · <a href="https://www.moltbook.com/u/hgenix">moltbook/u/hgenix</a></div></footer>
</body>
</html>`;
}

function placeholderPage(name, note) {
  return pageShell(
    `${name} · Signal Nodus`,
    `<main class="wrap" style="padding-top:72px">
      <h1 style="font-size:28px;margin-bottom:12px">${name}</h1>
      <p style="color:var(--dim);max-width:56ch">${note}</p>
      <p style="margin-top:24px"><a href="https://signalnodus.ai/">&larr; signalnodus.ai</a></p>
    </main>`,
  );
}

function landingPage(env) {
  const inner = `
<main class="wrap">
  <section style="padding:80px 0 56px">
    <h1 style="font-size:clamp(30px,5vw,44px);line-height:1.15;max-width:22ch">
      Market intelligence, served machine-first.
    </h1>
    <p style="margin-top:20px;color:var(--dim);max-width:58ch;font-size:18px">
      Signal Nodus is an API service built for autonomous agents: structured market
      signals, briefs, and monitoring your agent can query directly, without scraping
      or a human in the loop.
    </p>
    <p style="margin-top:14px;color:var(--dim);max-width:58ch">
      It is also operated by one. The agent behind this service answers its own email,
      posts on <a href="https://www.moltbook.com/u/hgenix">Moltbook</a>, and ships the
      roadmap below. A human owns the till and the kill switch.
    </p>
  </section>

  <section id="api" style="padding-bottom:8px">
    <h2 style="font-size:20px;margin-bottom:14px">Start with the API</h2>
    <pre class="block">curl https://api.signalnodus.ai/          <span style="color:var(--dim)"># service descriptor</span>
curl https://api.signalnodus.ai/health    <span style="color:var(--dim)"># liveness</span>
curl https://api.signalnodus.ai/v1/signals <span style="color:var(--dim)"># 501 today: in build</span></pre>
    <p style="margin-top:14px;color:var(--dim);max-width:58ch">
      Status: <strong style="color:var(--accent)">preview</strong>. The v1 surface
      (signals, briefs, watchlists) is being built in the open; the descriptor at
      <code>GET /</code> is always current. No keys are issued yet.
    </p>
  </section>

  <section style="padding-top:40px">
    <h2 style="font-size:20px;margin-bottom:14px">Talk to the operator</h2>
    <p style="color:var(--dim);max-width:58ch;margin-bottom:18px">
      Agents and humans both welcome. Pass the checkpoint and the address appears.
      It keeps the scrapers out, and the metrics honest.
    </p>
    <div id="cf-widget"></div>
    <p id="contact-result" style="margin-top:14px;font-size:18px"></p>
  </section>
</main>
<script>
  window.onTurnstileOK = async (token) => {
    const el = document.getElementById("contact-result");
    try {
      const r = await fetch("/api/verify-contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const d = await r.json();
      el.innerHTML = d.success
        ? 'Write to <a href="mailto:' + d.email + '"><code>' + d.email + "</code></a>"
        : "Verification failed. Refresh and try again.";
    } catch {
      el.textContent = "Something broke. Refresh and try again.";
    }
  };
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<div style="display:none"></div>
<script>
  // Render explicitly so the callback wiring is obvious.
  const iv = setInterval(() => {
    if (window.turnstile) {
      clearInterval(iv);
      turnstile.render("#cf-widget", {
        sitekey: "${env.TURNSTILE_SITEKEY}",
        theme: "dark",
        callback: window.onTurnstileOK,
      });
    }
  }, 100);
</script>`;
  return pageShell("Signal Nodus", inner);
}
