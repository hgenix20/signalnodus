// The crawler-control service: the one offer the front page leads with from 2026-09-21.
//
// A fixed-price job for owner-operated small technical sites on any host. Eligibility comes before
// payment: /qualify collects an intake form into D1 (service_requests), the operator confirms
// fit and scope, and only then does a Stripe Checkout link go out (the `crawler-service` item
// in payments.js). Nothing here takes money on its own and a success-page visit never counts
// as payment; the Stripe webhook does.
import { shell2 } from "./shell2.js";

export const SERVICE = {
  id: "crawler-service",
  cents: 35_000,
  label: "Crawler-control service",
  description:
    "One site on any host, up to four hours of configuration work, delivered within 14 calendar days after agreed access. No subscription.",
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

// The offer as a section, used on the homepage and on /service.
export function offerSection({ heading = "h1" } = {}) {
  const H = heading;
  return `
  <section class="chapter bt0" id="offer" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">For small sites on any host</span>
      <${H}>Get your crawler controls checked, and configured.</${H}>
      <p class="lede mw44">A fixed-price service for owners of small technical sites on any host. We review the request evidence your setup makes available, agree which automated traffic you want to allow or restrict, and implement a small set of approved changes for Cloudflare, nginx, Apache and common managed hosts. You get practical configuration help, not another monitoring subscription.</p>
      <p class="dim mw44">An AI assistant helps with intake and preparation; a human solutions architect approves and performs the configuration work.</p>
    </div>
    <div class="offer-grid">
      <div class="item"><h3>Evidence review</h3><p class="dim">A concise account of observed crawler activity, including what cannot be reliably identified.</p></div>
      <div class="item"><h3>Approved changes</h3><p class="dim">Supported settings for Cloudflare, nginx, Apache and common managed hosts adjusted to your publishing priorities, with a change log and rollback instructions.</p></div>
      <div class="item"><h3>Follow-up check</h3><p class="dim">Tests of the agreed controls and your key legitimate visitor paths, with remaining limitations documented.</p></div>
    </div>
    <div class="offer-terms">
      <p><strong>$350 once.</strong> One site, up to four hours of work, delivered within 14 calendar days after agreed access is available. No subscription. Full refund if we cannot complete the written, agreed scope; completed work does not guarantee elimination of scraping.</p>
      <p class="dim"><strong>Eligibility:</strong> you control a small technical site on Cloudflare, nginx, Apache or a common managed host, and can provide suitable evidence and narrowly scoped access. We confirm fit before payment.</p>
      <p class="dim"><strong>Not:</strong> comprehensive agent identification, legal evidence, emergency incident response, or a promise to stop every scraper.</p>
      <p class="row"><a class="cta" href="/qualify">Check whether your site qualifies</a><a class="cta ghost" href="/canary">Try the free canary first</a></p>
    </div>
  </div></section>`;
}

export function servicePage() {
  const inner = `<main>${offerSection()}
  <section class="chapter" id="how" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">How it goes</span><h2>Fit first, then payment, then four hours of careful work.</h2></div>
    <ol class="steps">
      <li><h3>You tell us what happened</h3><p class="dim">The form asks eight questions: what prompted this, what must keep working, what evidence you have. Thirty minutes of our time to confirm fit, free.</p></li>
      <li><h3>Scope in writing, then checkout</h3><p class="dim">A specific written scope, a start date and the 14-day window before any payment. Stripe checkout, one-off, receipt by email.</p></li>
      <li><h3>Least-privilege access</h3><p class="dim">You make the changes on a call from our instructions, or grant temporary, narrowly scoped access to your stack. Never a password. Access is revoked at the end.</p></li>
      <li><h3>Verify, report, roll back if needed</h3><p class="dim">Agreed tests before and after. A short report that separates what is known from what is not. Rollback instructions stay with you.</p></li>
    </ol>
  </div></section></main>`;
  return shell2("Crawler-control service · Signal Nodus", inner, {
    current: "/service", canonical: "https://signalnodus.ai/service",
    description: "A $350 fixed-price service for small technical sites on any host: review the crawler evidence, agree an allow/restrict policy, implement approved settings, check the result.",
  }).replace("</head>", '<link rel="stylesheet" href="/service.css">\n</head>');
}

const FIELDS = [
  ["site", "Your site", "url", "https://example.com", "The publisher site this is about, and confirm you can authorise changes to it."],
  ["prompted", "What happened that you want addressed, and when?", "textarea", "", "The specific thing: a traffic spike, a hosting warning, content showing up somewhere, a bill."],
  ["outcome", "What would a useful outcome look like?", "textarea", "", ""],
  ["stack", "Hosting stack (server, CDN or platform)", "text", "e.g. WordPress on a VPS behind Cloudflare Free, or nginx on a bare VPS", ""],
  ["evidence", "What request logs, analytics or examples do you have?", "textarea", "", "Cloudflare analytics, server logs, a screenshot, a hosting provider's message. Say what exists; do not paste logs here."],
  ["keep", "Which crawlers, AI services, feeds, APIs or partner integrations must keep working?", "textarea", "", ""],
  ["paths", "The three legitimate visitor paths that matter most", "text", "e.g. homepage, subscribe checkout, subscriber login", ""],
  ["scheduled", "Any configuration changes already scheduled?", "text", "", ""],
  ["email", "Your email", "email", "you@yoursite.com", "We reply within one business day to confirm fit or say plainly that we are not the right fit."],
];

export function qualifyPage() {
  const fields = FIELDS.map(([name, label, type, ph, help]) => {
    const id = `q-${name}`;
    const input = type === "textarea"
      ? `<textarea id="${id}" name="${name}" rows="3" ${name === "outcome" || name === "keep" ? "" : "required"}></textarea>`
      : `<input id="${id}" name="${name}" type="${type === "url" ? "url" : type}" placeholder="${esc(ph)}" autocomplete="${type === "email" ? "email" : "off"}" ${name === "scheduled" ? "" : "required"}>`;
    return `<div class="field"><label for="${id}">${label}</label>${input}${help ? `<p class="dim small">${help}</p>` : ""}</div>`;
  }).join("\n");
  const inner = `<main><section class="chapter bt0" id="qualify" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">Step one · no payment</span><h1>Check whether your site qualifies.</h1>
    <p class="dim mw44">Eight questions. We confirm fit before any payment, and if we are not the right fit we will say so within one business day. An AI assistant reads this first and drafts the reply; a human solutions architect decides.</p></div>
    <form class="qualify-form" data-qualify-form novalidate>
      ${fields}
      <div class="hp" aria-hidden="true"><label for="q-website">Website</label><input id="q-website" name="website" tabindex="-1" autocomplete="off"></div>
      <p class="dim small" data-q-msg role="status">Nothing here is shared with anyone else. Logs stay with you until scope is agreed.</p>
      <button type="submit" class="cta">Send and check fit</button>
    </form>
    <div class="qualify-result" data-qualify-result hidden>
      <h2>Received.</h2><p>Reference <code data-ref></code>. You will hear back within one business day at the address you gave, either with a written scope and a start date or a plain no.</p>
    </div>
  </div></section></main>
<script src="/qualify.js" defer></script>`;
  return shell2("Check fit · Signal Nodus", inner, {
    current: "/qualify", canonical: "https://signalnodus.ai/qualify", index: true,
    description: "Eight questions to check whether the crawler-control service fits your site, before any payment.",
  }).replace("</head>", '<link rel="stylesheet" href="/service.css">\n</head>');
}

export const SERVICE_CSS = `
.offer-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin:1.5rem 0}
.offer-grid .item{border:1px solid var(--line);border-radius:12px;padding:1rem 1.1rem;background:var(--card)}
.offer-terms{border-left:4px solid var(--canary,#FBBF24);padding:.2rem 0 .2rem 1.1rem;margin:1.5rem 0;max-width:52rem}
.offer-terms p{margin:.5rem 0}
.qualify-form{max-width:44rem;margin:1.5rem 0;display:grid;gap:1rem}
.qualify-form .field{display:grid;gap:.35rem}
.qualify-form label{font-weight:600}
.qualify-form input,.qualify-form textarea{width:100%;padding:.7rem .8rem;border-radius:8px;border:1px solid #2a3346;background:#0b0e14;color:inherit;font:inherit;min-height:44px}
.qualify-form input:focus-visible,.qualify-form textarea:focus-visible{outline:2px solid var(--canary,#FBBF24);outline-offset:2px}
.qualify-form .hp{position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden}
.qualify-result{border:1px solid #2a3346;border-radius:12px;padding:1.25rem;max-width:44rem;margin:1rem 0 2rem}
@media (prefers-reduced-motion: no-preference){.offer-grid .item{transition:border-color 200ms ease}.offer-grid .item:hover{border-color:var(--canary,#FBBF24)}}
`;

export const QUALIFY_JS = String.raw`
(function () {
  const form = document.querySelector("[data-qualify-form]");
  if (!form) return;
  const loaded = performance.now(), msg = form.querySelector("[data-q-msg]"), btn = form.querySelector("button"), out = document.querySelector("[data-qualify-result]");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    btn.disabled = true; msg.textContent = "Sending...";
    const data = Object.fromEntries(new FormData(form).entries());
    data.elapsed = performance.now() - loaded;
    fetch("/api/qualify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) })
      .then(r => r.json()).then(d => {
        if (!d.ok) { msg.textContent = d.error || "That didn't work."; btn.disabled = false; return; }
        out.querySelector("[data-ref]").textContent = d.ref;
        out.hidden = false; form.hidden = true; out.scrollIntoView({ behavior: "smooth", block: "start" });
      }).catch(() => { msg.textContent = "That didn't go through. Please try again."; btn.disabled = false; });
  });
})();
`;

async function ensureTable(env) {
  await env.BILLING.prepare(
    "CREATE TABLE IF NOT EXISTS service_requests (ref TEXT PRIMARY KEY, created TEXT NOT NULL, email TEXT NOT NULL, site TEXT NOT NULL, answers TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new')",
  ).run();
}

// POST /api/qualify: the intake form. Same-origin only, honeypot, a human-speed timer, tight sizes.
export async function handleQualify(request, env) {
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  const origin = request.headers.get("origin");
  const ours = origin ? /^https:\/\/(www\.)?signalnodus\.ai$/.test(origin) : request.headers.get("sec-fetch-site") === "same-origin";
  let body = null;
  try { body = JSON.parse((await request.text()).slice(0, 12_000)); } catch {}
  if (!ours || !body || body.website || !(Number(body.elapsed) >= 5000)) {
    return Response.json({ ok: false, error: "Please try again from signalnodus.ai/qualify." }, { status: 400 });
  }
  const email = String(body.email || "").trim().toLowerCase();
  const site = String(body.site || "").trim().slice(0, 300);
  if (!EMAIL.test(email)) return Response.json({ ok: false, error: "That doesn't look like an email address." }, { status: 400 });
  if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(site)) return Response.json({ ok: false, error: "Your site should be a full address, like https://example.com." }, { status: 400 });
  const answers = {};
  for (const [name] of FIELDS) if (name !== "email" && name !== "site") answers[name] = String(body[name] || "").slice(0, 2000);
  if (!env?.BILLING) return Response.json({ ok: false, error: "The form is unavailable right now. Email hgenix@agentmail.to instead." }, { status: 503 });
  await ensureTable(env);
  const ref = "q" + hex(4);
  await env.BILLING.prepare("INSERT INTO service_requests (ref, created, email, site, answers) VALUES (?, ?, ?, ?, ?)")
    .bind(ref, new Date().toISOString(), email, site, JSON.stringify(answers)).run();
  return Response.json({ ok: true, ref });
}

// POST /api/qualify/approve {ref}: the owner marks an intake approved after fit and scope are
// agreed in writing. Only an approved ref can open the $350 checkout (payments.js). Bearer
// DASHBOARD_TOKEN; by policy the executive never calls this, the owner does.
export async function approveQualify(request, env) {
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")?.[1]?.trim();
  if (!env?.DASHBOARD_TOKEN || bearer !== env.DASHBOARD_TOKEN) return new Response("not found", { status: 404 });
  let body = null;
  try { body = JSON.parse((await request.text()).slice(0, 1000)); } catch {}
  const ref = String(body?.ref || "");
  if (!/^q[0-9a-f]{8}$/.test(ref)) return Response.json({ ok: false, error: "bad ref" }, { status: 400 });
  await ensureTable(env);
  const r = await env.BILLING.prepare("UPDATE service_requests SET status = 'approved' WHERE ref = ?").bind(ref).run();
  if ((r.meta?.changes ?? 0) === 0) return Response.json({ ok: false, error: "unknown ref" }, { status: 404 });
  return Response.json({ ok: true, ref, status: "approved" });
}

// GET /api/qualify/list: the operator's view, bearer DASHBOARD_TOKEN. Never public.
export async function listQualify(request, env) {
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")?.[1]?.trim();
  if (!env?.DASHBOARD_TOKEN || bearer !== env.DASHBOARD_TOKEN) return new Response("not found", { status: 404 });
  await ensureTable(env);
  const rows = (await env.BILLING.prepare("SELECT ref, created, email, site, answers, status FROM service_requests ORDER BY created DESC LIMIT 200").all()).results || [];
  return Response.json({ requests: rows.map((r) => ({ ...r, answers: JSON.parse(r.answers || "{}") })) }, { headers: { "cache-control": "no-store" } });
}

export function thanksPage() {
  const inner = `<main><section class="chapter bt0" tabindex="-1"><div class="wrap"><div class="stack">
    <span class="eyebrow">Payment received</span><h1>Thank you. The clock starts when access is agreed.</h1>
    <p class="dim mw44">Your receipt comes from Stripe by email. We will confirm the payment on our side before any work starts, then agree access and the start date with you in writing. If anything here does not match what you expected, reply to the intake email and we will sort it before anything else happens.</p>
  </div></div></section></main>`;
  return shell2("Thank you · Signal Nodus", inner, { current: "/service", canonical: "https://signalnodus.ai/service/thanks", index: false, description: "Payment received." });
}
