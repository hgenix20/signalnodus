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

const COOKIE = "sn_dash";

export function isDashboardPath(pathname) {
  return pathname === "/dashboard" || pathname === "/dashboard/logout";
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
       FROM usage GROUP BY tool ORDER BY calls DESC`,
    ).all();

    const daily = await env.BILLING.prepare(
      `SELECT day, COUNT(*) AS calls, SUM(cost) AS charged
       FROM usage WHERE day >= date('now','-13 days')
       GROUP BY day ORDER BY day`,
    ).all();

    const totals = await env.BILLING.prepare(
      `SELECT COUNT(*) AS calls, SUM(cost) AS charged,
              COUNT(DISTINCT subject) AS callers
       FROM usage`,
    ).first();

    return {
      available: true,
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

  checks.push({
    label: "stripe deposit address",
    ok: Boolean(env.TEMPO_DEPOSIT_ADDRESS),
    detail: env.TEMPO_DEPOSIT_ADDRESS ? "set" : "missing",
  });

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
        `<tr><td>${t.tool}</td><td class="num">${t.calls}</td><td class="num">${dollars(Number(t.charged || 0))}</td><td class="num dim">${dollars(priceOf(t.tool))}</td></tr>`,
    )
    .join("");

  const keyRows = (keys.list || [])
    .map(
      (k) =>
        `<tr><td>${k.label}</td><td class="num">${dollars(Number(k.credits || 0))}</td><td>${k.active ? "active" : "off"}</td><td class="dim">${String(k.last_used || "never").slice(0, 10)}</td></tr>`,
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
