// Toku marketplace fulfillment. Toku (toku.agency) is a USD agent-services
// marketplace: buyers hire a listed service, the platform escrows the fee,
// and the worker delivers through the jobs API. Our listings are job-shaped
// wrappers over existing tools, so fulfillment is fully automatic.
//
// Toku webhooks are unsigned, so the webhook is treated as a hint only:
// every action re-fetches the job from Toku's API with our own key and works
// from that authoritative copy, never from the posted payload.

import { toolFilingSection, toolCompareFilings, toolVerifyFinancialClaim } from "./mcp.js";

const TOKU_API = "https://www.toku.agency/api";
const MAX_OUTPUT_CHARS = 100_000;

// Published service ids -> parsers and tools. Ids are stable per listing;
// update here when a listing is added or re-created.
const SERVICES = {
  cmt1lrj6i0001l404vb8b5ey1: {
    name: "filing_section",
    parse: parseCompanyItemForm,
    run: (a, ctx) => toolFilingSection(a, ctx),
  },
  cmt1lrjto000cjx046mr77vjt: {
    name: "compare_filings",
    parse: parseCompanyItemForm,
    run: (a, ctx) => toolCompareFilings(a, ctx),
  },
  cmt1lrkpq000gjx04f54di7jq: {
    name: "verify_financial_claim",
    parse: parseClaim,
    run: (a, ctx) => toolVerifyFinancialClaim(a, ctx),
  },
};

// "TICKER ITEM [FORM]", e.g. "AAPL 1A 10-K" or "NVDA 7".
function parseCompanyItemForm(input) {
  const m = String(input || "").trim().match(/^(\S{1,10})\s+(\S{1,4})(?:\s+(10-K|10-Q))?\s*$/i);
  if (!m) return null;
  return { company: m[1], item: m[2], form: m[3] ? m[3].toUpperCase() : undefined };
}

// "TICKER CONCEPT VALUE FISCAL_YEAR", e.g. "AAPL Revenues 391035000000 2024".
function parseClaim(input) {
  const m = String(input || "").trim().match(/^(\S{1,10})\s+([A-Za-z]{2,80})\s+([\d,.]+)\s+(\d{4})\s*$/);
  if (!m) return null;
  const value = Number(m[3].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return { company: m[1], concept: m[2], claimed_value: value, fiscal_year: Number(m[4]) };
}

async function tokuFetch(env, path, init = {}) {
  return fetch(`${TOKU_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.TOKU_API_KEY}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
}

async function jobAction(env, jobId, body) {
  const res = await tokuFetch(env, `/jobs/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error("toku job action failed", jobId, body.action, res.status, (await res.text()).slice(0, 200));
  return res.ok;
}

async function logTokuJob(env, service, priceCents) {
  if (!env?.BILLING) return;
  const now = new Date().toISOString();
  try {
    // billable=0 keeps Toku revenue out of the Stripe cash numbers; the
    // platform holds those earnings until withdrawal is set up.
    await env.BILLING.prepare(
      "INSERT INTO usage (subject, tool, cost, billable, day, created_at) VALUES (?, ?, ?, 0, ?, ?)",
    )
      .bind("toku:marketplace", `toku:${service}`, Number(priceCents) * 10 || 0, now.slice(0, 10), now)
      .run();
  } catch (err) {
    console.error("could not log toku job", err);
  }
}

export async function handleTokuWebhook(request, env, ctx) {
  const respond = (note) => new Response(JSON.stringify({ ok: true, note }), {
    headers: { "content-type": "application/json" },
  });

  if (!env.TOKU_API_KEY) return respond("not configured");

  let hint = null;
  try {
    hint = await request.json();
  } catch {
    return respond("unreadable payload");
  }
  const jobId = String(hint?.jobId || hint?.data?.id || "").slice(0, 64);
  if (!jobId) return respond("no job id");

  // Authoritative copy. An attacker can POST anything here; only what Toku's
  // own API confirms gets acted on.
  const res = await tokuFetch(env, `/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) return respond("job not found");
  const fetched = await res.json();
  const job = fetched?.job || fetched;

  const status = String(job?.status || "").toUpperCase();
  const service = SERVICES[String(job?.serviceId || "")];
  if (!service) return respond("not one of our services");
  if (status !== "REQUESTED" && status !== "ACCEPTED") return respond(`status ${status}, nothing to do`);

  const args = service.parse(job?.input);
  if (!args) {
    // Wrong input format: cancel so escrow returns, rather than delivering
    // something the buyer did not ask for.
    if (status === "REQUESTED") await jobAction(env, jobId, { action: "cancel" });
    return respond("input did not match the documented format; cancelled");
  }

  if (status === "REQUESTED") {
    const accepted = await jobAction(env, jobId, { action: "accept" });
    if (!accepted) return respond("accept failed");
  }

  let output;
  try {
    const result = await service.run(args, ctx);
    output = JSON.stringify(result, null, 1);
    if (output.length > MAX_OUTPUT_CHARS) output = JSON.stringify(result).slice(0, MAX_OUTPUT_CHARS);
  } catch (err) {
    // Accepted but cannot deliver: cancel rather than charging for an error.
    console.error("toku fulfillment failed", service.name, err);
    await jobAction(env, jobId, { action: "cancel" });
    return respond("tool failed; job cancelled");
  }

  const delivered = await jobAction(env, jobId, { action: "deliver", output });
  if (delivered) ctx?.waitUntil?.(logTokuJob(env, service.name, job?.priceCents));
  return respond(delivered ? "delivered" : "deliver failed");
}
