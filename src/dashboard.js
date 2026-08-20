// Private operator dashboard.
//
// The point is an honest picture, not a flattering one. Cash collected and
// credit consumed are different numbers and are shown as different numbers:
// credit spent inside the system is not money, and conflating them is how a
// pre-revenue business convinces itself it has revenue.
//
// Not a customer-facing product. Token-gated, noindexed, and it answers 404
// rather than 401 when unauthenticated, so its existence is not advertised.

import { dollars, PRICING, priceOf } from "./billing.js";
import { x402Status } from "./mpp.js";

const COOKIE = "sn_dash";

export function isDashboardPath(pathname) {
  return (
    pathname === "/dashboard" ||
    pathname === "/dashboard/logout" ||
    pathname === "/dashboard/deposit-address" ||
    pathname === "/dashboard/x402-check"
  );
}

function cookieValue(request, name) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

// Constant-time-ish compare so a token cannot be guessed a character at a time.
function sameToken(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handleDashboard(request, env, url) {
  const token = env.DASHBOARD_TOKEN;
  if (!token) return notFound();

  if (url.pathname === "/dashboard/logout") {
    return new Response(null, {
      status: 302,
      headers: {
        location: "/",
        "set-cookie": `${COOKIE}=; Path=/dashboard; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
      },
    });
  }

  // Handing the token in the query string once exchanges it for a cookie, so
  // it stops living in the address bar and in history.
  const supplied = url.searchParams.get("k");
  if (supplied) {
    if (!sameToken(supplied, token)) return notFound();
    return new Response(null, {
      status: 302,
      headers: {
        location: "/dashboard",
        "set-cookie": `${COOKIE}=${token}; Path=/dashboard; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict`,
      },
    });
  }

  if (!sameToken(cookieValue(request, COOKIE), token)) return notFound();

  // Operator action: ask Stripe for an on-chain deposit address. Kept behind
  // the dashboard token because it touches the Stripe account, and read-only
  // in effect since Stripe returns the existing address if one exists.
  if (url.pathname === "/dashboard/deposit-address") {
    const network = (url.searchParams.get("network") || "base").toLowerCase();
    if (!/^[a-z]{2,20}$/.test(network)) {
      return Response.json({ error: "bad network" }, { status: 400 });
    }
    try {
      const res = await fetch("https://api.stripe.com/v1/crypto/deposit_addresses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "stripe-version": "2026-05-27.preview",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ network }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.json();
      return Response.json({ status: res.status, network, body }, { headers: { "cache-control": "no-store" } });
    } catch (err) {
      return Response.json({ error: String(err?.message || err) }, { status: 502 });
    }
  }

  // Diagnostic: why is the x402 rail not being offered? Reports the shape of
  // what CDP returns without ever echoing a credential.
  if (url.pathname === "/dashboard/x402-check") {
    const out = { hasKeyId: Boolean(env.CDP_API_KEY_ID), hasSecret: Boolean(env.CDP_API_KEY_SECRET) };
    try {
      const { createFacilitatorConfig } = await import("@coinbase/x402");
      const f = createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET);
      out.url = f.url;
      out.hasAuthHook = typeof f.createAuthHeaders === "function";

      let built = null;
      try {
        built = await f.createAuthHeaders();
        out.authShape = built && typeof built === "object" ? Object.keys(built) : typeof built;
        const first = built?.verify || built?.list || built;
        out.headerNames = first && typeof first === "object" ? Object.keys(first) : null;
      } catch (e) {
        out.authError = String(e?.message || e).slice(0, 200);
      }

      for (const [label, headers] of [
        ["with-supported-headers", built?.supported || {}],
        ["with-verify-headers", built?.verify || {}],
      ]) {
        try {
          const res = await fetch(`${String(f.url).replace(/\/+$/, "")}/supported`, {
            headers: headers && typeof headers === "object" ? headers : {},
            signal: AbortSignal.timeout(10000),
          });
          const text = await res.text();
          out[label] = { status: res.status, body: text.slice(0, 300) };
        } catch (e) {
          out[label] = { error: String(e?.message || e).slice(0, 160) };
        }
      }
    } catch (e) {
      out.fatal = String(e?.message || e).slice(0, 250);
    }
    return Response.json(out, { headers: { "cache-control": "no-store" } });
  }

  const [money, usage, keys, health] = await Promise.all([
    stripePicture(env),
    usagePicture(env),
    keyPicture(env),
    healthPicture(env),
  ]);

  return new Response(render({ money, usage, keys, health }), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
    },
  });
}

// Challenge subjects embed caller-controlled user-agent strings; anything
// rendered from them gets escaped, no exceptions.
function esc(x) {
  return String(x)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function notFound() {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
}

// ------------------------------------------------------------------- money

async function stripePicture(env) {
  if (!env.STRIPE_SECRET_KEY) return { configured: false };

  const get = async (path) => {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`stripe ${path} -> ${res.status}`);
    return res.json();
  };

  try {
    const since = Math.floor(Date.now() / 1000) - 30 * 86400;
    const [balance, charges] = await Promise.all([
      get("balance"),
      get(`charges?limit=100&created[gte]=${since}`),
    ]);

    const paid = (charges.data || []).filter((c) => c.paid && !c.refunded);
    const grossCents = paid.reduce((n, c) => n + (c.amount || 0), 0);
    const refundedCents = (charges.data || []).reduce((n, c) => n + (c.amount_refunded || 0), 0);

    const sumCents = (arr) => (arr || []).reduce((n, b) => n + (b.amount || 0), 0);

    return {
      configured: true,
      livemode: paid[0]?.livemode ?? !String(env.STRIPE_SECRET_KEY).includes("_test_"),
      availableCents: sumCents(balance.available),
      pendingCents: sumCents(balance.pending),
      grossCents,
      refundedCents,
      chargeCount: paid.length,
    };
  } catch (err) {
    return { configured: true, error: String(err?.message || err).slice(0, 120) };
  }
}

// ------------------------------------------------------------------- usage

async function usagePicture(env) {
  if (!env.BILLING) return { available: false };
  try {
    const byTool = await env.BILLING.prepare(
      `SELECT tool, COUNT(*) AS calls, SUM(cost) AS charged
       FROM usage WHERE billable = 1 GROUP BY tool ORDER BY calls DESC`,
    ).all();

    const daily = await env.BILLING.prepare(
      `SELECT day, COUNT(*) AS calls, SUM(cost) AS charged
       FROM usage WHERE billable = 1 AND day >= date('now','-13 days')
       GROUP BY day ORDER BY day`,
    ).all();

    // x402 rows are money received, not prepaid credit being drawn down, so
    // they are excluded here and reported on their own line. Adding them to
    // "credit consumed" would double-count a payment as a liability.
    const totals = await env.BILLING.prepare(
      `SELECT COUNT(*) AS calls, SUM(cost) AS charged,
              COUNT(DISTINCT subject) AS callers
       FROM usage WHERE billable = 1 AND tool NOT LIKE 'x402:%'`,
    ).first();

    // Someone who was shown a price and then actually paid it.
    //
    // The previous version counted every distinct payer since challenge
    // logging began, without requiring that the payer had ever BEEN shown a
    // challenge. My own credit-key testing therefore registered as a
    // conversion, and the dashboard read "1" under the label "the number that
    // matters" while cash collected was zero. A metric that invents a customer
    // is worse than no metric.
    //
    // This now requires the same subject to appear as a challenge and then as
    // a settled machine payment afterwards. Only the x402 path can satisfy it,
    // because that is the only path where the payer keeps the identity they
    // had when they were refused. Someone who sees a 402, walks to the website
    // and buys a key is genuinely unattributable here, and is counted nowhere
    // rather than counted wrongly.
    const paidAfter = await env.BILLING.prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT c.subject
         FROM (SELECT subject, MIN(created_at) AS first_seen
                 FROM usage
                WHERE billable = 0 AND tool LIKE '402:%'
                GROUP BY subject) c
         JOIN usage p
           ON p.subject = c.subject
          AND p.billable = 1
          AND p.tool LIKE 'x402:%'
          AND p.created_at > c.first_seen
         GROUP BY c.subject
       )`,
    ).first();

    const settled = await env.BILLING.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(cost),0) AS amount
       FROM usage WHERE billable = 1 AND tool LIKE 'x402:%'`,
    ).first();

    // Who the arrivals actually are. The subject carries address and user
    // agent, which is what separates a directory health probe from a real
    // buyer who saw the price and left, and those two need different fixes.
    const visitors = await env.BILLING.prepare(
      `SELECT subject, COUNT(*) AS challenges, MAX(created_at) AS last_seen,
              GROUP_CONCAT(DISTINCT tool) AS tools
       FROM usage WHERE billable = 0 AND tool LIKE '402:%'
       GROUP BY subject ORDER BY MAX(created_at) DESC LIMIT 20`,
    ).all();

    // Monitors and our own healthcheck are traffic, not demand. Counting them
    // flattered the funnel: the visitor number read 22 while buyer-shaped
    // subjects numbered about six.
    const NOT_DEMAND =
      `subject NOT LIKE '%x402-observer%' AND subject NOT LIKE '%EndpointProbe%'
       AND subject NOT LIKE '%CarbonMonitor%' AND subject NOT LIKE '%healthcheck%'
       AND subject NOT LIKE 'challenge:2a01:4f8:c015:6024%'`;
    // Human page views, logged by the Worker since 2026-08-19. Bots filtered
    // at write time; this is the closest thing to "did a person see pricing".
    const pageViews = await env.BILLING.prepare(
      `SELECT tool AS page, COUNT(*) AS views, COUNT(DISTINCT subject) AS people,
              MAX(created_at) AS last_seen
       FROM usage WHERE billable = 0 AND tool LIKE 'view:%'
       GROUP BY tool ORDER BY views DESC LIMIT 10`,
    ).all();

    const challenges = await env.BILLING.prepare(
      `SELECT COUNT(*) AS shown, COUNT(DISTINCT subject) AS visitors
       FROM usage WHERE billable = 0 AND tool LIKE '402:%' AND ${NOT_DEMAND}`,
    ).first();

    return {
      available: true,
      challengesShown: Number(challenges?.shown || 0),
      paidAfterChallenge: Number(paidAfter?.n || 0),
      challengeVisitors: Number(challenges?.visitors || 0),
      visitorRows: visitors.results || [],
      pageViewRows: pageViews.results || [],
      settledCount: Number(settled?.n || 0),
      settledAmount: Number(settled?.amount || 0),
      byTool: byTool.results || [],
      daily: daily.results || [],
      calls: Number(totals?.calls || 0),
      charged: Number(totals?.charged || 0),
      callers: Number(totals?.callers || 0),
    };
  } catch (err) {
    return { available: false, error: String(err?.message || err).slice(0, 120) };
  }
}

async function keyPicture(env) {
  if (!env.BILLING) return { available: false };
  try {
    const rows = await env.BILLING.prepare(
      `SELECT label, credits, active, created_at, last_used FROM api_keys ORDER BY created_at DESC LIMIT 25`,
    ).all();
    const list = rows.results || [];
    return {
      available: true,
      list,
      active: list.filter((k) => k.active).length,
      outstanding: list.filter((k) => k.active).reduce((n, k) => n + Number(k.credits || 0), 0),
    };
  } catch (err) {
    return { available: false, error: String(err?.message || err).slice(0, 120) };
  }
}

// ------------------------------------------------------------------ health

// Checks the dependencies this service actually rests on. Deliberately does
// not fetch its own hostnames: a Worker calling its own custom domain is a
// loopback that Cloudflare rejects with 522, which looks like an outage and
// is not one. What matters is whether the things underneath are reachable.
async function healthPicture(env) {
  const checks = [];

  // D1: can we read the table the meter writes to?
  try {
    await env.BILLING.prepare("SELECT 1 AS ok").first();
    checks.push({ label: "database", ok: true, detail: "reachable" });
  } catch {
    checks.push({ label: "database", ok: false, detail: "unreachable" });
  }

  // SEC EDGAR is the upstream every paid call depends on.
  try {
    const res = await fetch("https://data.sec.gov/submissions/CIK0000320193.json", {
      headers: { "user-agent": "SignalNodus/0.3 (hgenix@agentmail.to)" },
      signal: AbortSignal.timeout(12000),
    });
    checks.push({ label: "sec edgar", ok: res.ok, detail: `HTTP ${res.status}` });
  } catch {
    checks.push({ label: "sec edgar", ok: false, detail: "unreachable" });
  }

  checks.push({
    label: "machine payments",
    ok: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PROFILE_ID),
    detail: env.STRIPE_SECRET_KEY && env.STRIPE_PROFILE_ID ? "configured" : "not configured",
  });

  const x402Live = await x402Status(env);
  checks.push({
    label: "x402 base rail",
    ok: x402Live,
    detail: x402Live
      ? "live on Base mainnet"
      : env.BASE_DEPOSIT_ADDRESS
        ? "withheld: facilitator does not settle Base mainnet"
        : "no deposit address",
  });

  checks.push({
    label: "stripe deposit address",
    ok: Boolean(env.TEMPO_DEPOSIT_ADDRESS),
    detail: env.TEMPO_DEPOSIT_ADDRESS ? "set" : "missing",
  });

  // The question that decides whether anyone can pay at all. Stablecoin needs
  // Stripe to approve the "Stablecoins and Crypto" payment method, and until
  // they do, the only rail left is cards through a shared payment token, which
  // very few agents can produce today.
  if (env.STRIPE_SECRET_KEY) {
    try {
      const res = await fetch("https://api.stripe.com/v1/account", {
        headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
        signal: AbortSignal.timeout(12000),
      });
      const acct = await res.json();
      const caps = acct?.capabilities || {};
      const cryptoCap = Object.entries(caps).find(([k]) => /crypto|stablecoin/i.test(k));
      checks.push({
        label: "stablecoin rail",
        ok: cryptoCap?.[1] === "active",
        detail: cryptoCap ? `${cryptoCap[0]}: ${cryptoCap[1]}` : "not requested",
      });
      checks.push({
        label: "card rail",
        ok: caps.card_payments === "active",
        detail: `card_payments: ${caps.card_payments || "unknown"}`,
      });
    } catch {
      checks.push({ label: "stripe capabilities", ok: false, detail: "could not read" });
    }
  }

  return checks;
}

// ------------------------------------------------------------------ render

const money = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

function bar(values, width = 640, height = 90) {
  if (!values.length) return '<p class="dim">No usage recorded yet.</p>';
  const max = Math.max(...values.map((v) => v.calls), 1);
  const gap = 6;
  const w = Math.max(8, (width - gap * (values.length - 1)) / values.length);
  const bars = values
    .map((v, i) => {
      const h = Math.max(2, (v.calls / max) * (height - 20));
      const x = i * (w + gap);
      const y = height - h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="#4fd1a5"><title>${v.day}: ${v.calls} calls</title></rect>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="daily calls">${bars}</svg>`;
}

function render({ money: m, usage, keys, health }) {
  const allOk = health.every((h) => h.ok);

  const cash = !m.configured
    ? `<p class="dim">Stripe is not configured on this deployment.</p>`
    : m.error
      ? `<p class="warn">Stripe unavailable: ${m.error}</p>`
      : `<div class="grid">
           ${stat("Collected, 30d", money(m.grossCents), `${m.chargeCount} charge${m.chargeCount === 1 ? "" : "s"}`)}
           ${stat("Available", money(m.availableCents), "settled in Stripe")}
           ${stat("Pending", money(m.pendingCents), "not yet settled")}
           ${stat("Refunded", money(m.refundedCents), "last 30d")}
         </div>
         <p class="dim mt">Mode: <strong>${m.livemode ? "LIVE, real money" : "test"}</strong>.</p>`;

  const toolRows = (usage.byTool || [])
    .map(
      (t) =>
        `<tr><td>${esc(t.tool)}</td><td class="num">${t.calls}</td><td class="num">${dollars(Number(t.charged || 0))}</td><td class="num dim">${dollars(priceOf(t.tool))}</td></tr>`,
    )
    .join("");

  const keyRows = (keys.list || [])
    .map(
      (k) =>
        `<tr><td>${esc(k.label)}</td><td class="num">${dollars(Number(k.credits || 0))}</td><td>${k.active ? "active" : "off"}</td><td class="dim">${String(k.last_used || "never").slice(0, 10)}</td></tr>`,
    )
    .join("");

  const healthRows = health
    .map(
      (h) =>
        `<span class="pill ${h.ok ? "ok" : "bad"}">${h.label}: ${h.detail}</span>`,
    )
    .join(" ");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Signal Nodus · operator</title>
<link rel="stylesheet" href="/site.css">
</head><body>
<header class="site"><div class="wrap">
  <span class="mark">SIGNAL<span class="dot">·</span>NODUS</span>
  <span class="dim" style="margin-left:14px">operator dashboard</span>
</div></header>

<main class="wrap pad">
  <h1 class="h1">${allOk ? "All systems normal" : "Something needs attention"}</h1>
  <p class="mt">${healthRows}</p>

  <h2 class="mt">Cash</h2>
  <p class="dim narrow">Money actually collected through Stripe. This is the only number here that is revenue.</p>
  ${cash}

  <h2 class="mt">Credit and liability</h2>
  <p class="dim narrow">Credit sold but not yet consumed is a service you still owe, not income.</p>
  <div class="grid">
    ${stat("Outstanding credit", keys.available ? dollars(keys.outstanding) : "—", "owed as future calls")}
    ${stat("Active keys", keys.available ? String(keys.active) : "—", "")}
    ${stat("Credit consumed", usage.available ? dollars(usage.charged) : "—", "billed against keys")}
    ${stat("Distinct callers", usage.available ? String(usage.callers) : "—", "all time")}
  </div>

  <h2 class="mt">Human page views</h2>
  <p class="dim narrow">Site pages seen by browsers, bots filtered at write time. Empty means no human has visited since logging began.</p>
  ${(usage.pageViewRows || []).length
    ? `<table class="packs"><tr><th>Page</th><th>Views</th><th>People</th><th>Last seen</th></tr>${usage.pageViewRows
        .map((v) => `<tr><td>${esc(String(v.page).slice(5))}</td><td>${v.views}</td><td>${v.people}</td><td class="dim">${esc(String(v.last_seen).slice(0, 16))}</td></tr>`)
        .join("")}</table>`
    : '<p class="dim">None yet.</p>'}

  <h2 class="mt">Who arrived</h2>
  <p class="dim narrow">Challenge subjects, newest first. A health probe hits one route on a schedule; a real buyer walks the catalog.</p>
  <table class="packs">
    <tr><th>Subject</th><th>Challenges</th><th>Tools</th><th>Last seen</th></tr>
    ${(usage.visitorRows || [])
      .map(
        (v) =>
          `<tr><td class="dim">${esc(String(v.subject).slice(10, 90))}</td><td>${v.challenges}</td><td class="dim">${esc(String(v.tools || "").replace(/402:/g, "").slice(0, 60))}</td><td class="dim">${esc(String(v.last_seen).slice(0, 16))}</td></tr>`,
      )
      .join("")}
  </table>

  <h2 class="mt">Demand</h2>
  <p class="dim narrow">A payment challenge shown and not taken up means someone arrived, saw the price, and declined. No challenges at all means nobody arrived, which is a different problem with a different fix.</p>
  <div class="grid">
    ${stat("Challenges shown", usage.available ? String(usage.challengesShown) : "—", "402s issued")}
    ${stat("Distinct visitors", usage.available ? String(usage.challengeVisitors) : "—", "saw a price")}
    ${stat("Settled machine payments", usage.available ? String(usage.settledCount) : "—", usage.available ? dollars(usage.settledAmount) + " received over x402" : "")}
    ${stat("Paid after being refused", usage.available ? String(usage.paidAfterChallenge) : "—", "same caller, challenged then paid")}
  </div>

  <h2 class="mt">Calls, last 14 days</h2>
  ${usage.available ? bar(usage.daily) : '<p class="warn">Usage data unavailable.</p>'}

  <h2 class="mt">By tool</h2>
  ${
    toolRows
      ? `<table class="packs"><tr><th>Tool</th><th>Calls</th><th>Charged</th><th>Unit price</th></tr>${toolRows}</table>`
      : '<p class="dim">No calls recorded yet.</p>'
  }

  <h2 class="mt">Keys</h2>
  ${
    keyRows
      ? `<table class="packs"><tr><th>Label</th><th>Balance</th><th>State</th><th>Last used</th></tr>${keyRows}</table>`
      : '<p class="dim">No keys issued.</p>'
  }

  <p class="mt dim">Generated ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC · <a href="/dashboard/logout">sign out</a></p>
</main>
</body></html>`;
}

function stat(label, value, note) {
  return `<div class="stat"><div class="stat-l">${label}</div><div class="stat-v">${value}</div><div class="stat-n">${note}</div></div>`;
}
