import test from "node:test";
import assert from "node:assert/strict";
import { SERVICE, servicePage, qualifyPage, thanksPage, handleQualify, listQualify, approveQualify } from "../src/service.js";
import { homePage2 } from "../src/pages2.js";

test("the service is a one-off at $350 and says so", () => {
  assert.equal(SERVICE.cents, 35_000);
  const html = servicePage();
  assert.match(html, /\$350 once/);
  assert.match(html, /Full refund if we cannot complete the written, agreed scope/);
  assert.match(html, /We confirm fit before payment/);
  assert.match(html, /href="\/qualify"/);
});

test("the homepage leads with the offer and no longer overclaims the canary", () => {
  const html = homePage2();
  assert.match(html, /Get your crawler controls checked, and configured/);
  assert.match(html, /Check whether your site qualifies/);
  assert.match(html, /Requests consistent with automated discovery/);
  assert.doesNotMatch(html, /every hit is a real agent/);
  assert.doesNotMatch(html, /disguised as an iPhone/);
  assert.doesNotMatch(html, /Catch the AI agents working your site/);
});

test("the qualification form asks the intake questions and has a honeypot", () => {
  const html = qualifyPage();
  assert.match(html, /data-qualify-form/);
  for (const name of ["site", "prompted", "stack", "evidence", "keep", "paths", "email"]) {
    assert.match(html, new RegExp(`name="${name}"`), `field ${name}`);
  }
  assert.match(html, /name="website"/);
  assert.match(html, /no payment/i);
});

test("the thanks page never treats the visit as payment", () => {
  assert.match(thanksPage(), /confirm the payment on our side before any work starts/);
});

function req(body, { origin = "https://signalnodus.ai", method = "POST" } = {}) {
  const init = { method, headers: { origin, "content-type": "application/json" } };
  if (method !== "GET" && method !== "HEAD" && body != null) init.body = JSON.stringify(body);
  return new Request("https://signalnodus.ai/api/qualify", init);
}

const good = {
  site: "https://example-publisher.com", prompted: "traffic doubled overnight", outcome: "", stack: "WordPress behind Cloudflare Free",
  evidence: "Cloudflare analytics", keep: "Googlebot", paths: "home, subscribe, login", scheduled: "", email: "owner@example-publisher.com", elapsed: 9000,
};

function fakeDb() {
  // rows: [ref, created, email, site, answers]; status kept beside them
  const rows = [], status = new Map();
  const view = () => rows.map((r) => ({ ref: r[0], created: r[1], email: r[2], site: r[3], answers: r[4], status: status.get(r[0]) || "new" }));
  return {
    rows, status,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            run: async () => {
              if (/INSERT INTO service_requests/.test(sql)) { rows.push(args); status.set(args[0], "new"); return { meta: { changes: 1 } }; }
              if (/UPDATE service_requests SET status = 'approved'/.test(sql)) { const has = rows.some((r) => r[0] === args[0]); if (has) status.set(args[0], "approved"); return { meta: { changes: has ? 1 : 0 } }; }
              return { meta: { changes: 1 } };
            },
            first: async () => {
              if (/FROM service_requests WHERE ref = \? AND status = 'approved'/.test(sql)) { const r = view().find((x) => x.ref === args[0] && x.status === "approved"); return r ? { ref: r.ref, email: r.email } : null; }
              return null;
            },
            all: async () => ({ results: view() }),
          };
        },
        run: async () => ({ meta: { changes: 0 } }),
        all: async () => ({ results: view() }),
      };
    },
  };
}

import { createCheckout } from "../src/payments.js";

test("the $350 checkout refuses without an owner-approved intake, and approval is token-gated", async () => {
  const env = { BILLING: fakeDb(), DASHBOARD_TOKEN: "t0k", STRIPE_SECRET_KEY: "sk_test_x" };
  const submitted = await (await handleQualify(req(good), env)).json();
  const checkout = (ref) => createCheckout(new Request("https://signalnodus.ai/api/checkout", { method: "POST", body: JSON.stringify({ pack: "crawler-service", qualify_ref: ref }) }), env);
  assert.equal((await checkout(undefined)).status, 403);
  assert.equal((await checkout(submitted.ref)).status, 403, "submitted but not approved");
  const approve = (ref, token) => approveQualify(new Request("https://signalnodus.ai/api/qualify/approve", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify({ ref }) }), env);
  assert.equal((await approve(submitted.ref, undefined)).status, 404);
  assert.equal((await approve("q00000000", "t0k")).status, 404);
  assert.equal((await approve(submitted.ref, "t0k")).status, 200);
  assert.equal(env.BILLING.status.get(submitted.ref), "approved");
  // Approved: the gate opens and the next step is the Stripe call, which this test does not make.
  const r = await checkout(submitted.ref);
  assert.notEqual(r.status, 403);
});

test("intake refuses bots, foreign origins and junk, and stores a good submission", async () => {
  const env = { BILLING: fakeDb(), DASHBOARD_TOKEN: "t0k" };
  assert.equal((await handleQualify(req(good, { method: "GET" }), env)).status, 405);
  assert.equal((await handleQualify(req(good, { origin: "https://evil.example" }), env)).status, 400);
  assert.equal((await handleQualify(req({ ...good, website: "spam" }), env)).status, 400);
  assert.equal((await handleQualify(req({ ...good, elapsed: 500 }), env)).status, 400);
  assert.equal((await handleQualify(req({ ...good, email: "nope" }), env)).status, 400);
  assert.equal((await handleQualify(req({ ...good, site: "example.com" }), env)).status, 400);
  const ok = await handleQualify(req(good), env);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.ok, true);
  assert.match(body.ref, /^q[0-9a-f]{8}$/);
  assert.equal(env.BILLING.rows.length, 1);
  assert.equal(env.BILLING.rows[0][2], "owner@example-publisher.com");
});

test("the operator list is 404 without the token and lists with it", async () => {
  const env = { BILLING: fakeDb(), DASHBOARD_TOKEN: "t0k" };
  await handleQualify(req(good), env);
  const anon = await listQualify(new Request("https://signalnodus.ai/api/qualify/list"), env);
  assert.equal(anon.status, 404);
  const ok = await listQualify(new Request("https://signalnodus.ai/api/qualify/list", { headers: { authorization: "Bearer t0k" } }), env);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.requests.length, 1);
  assert.equal(body.requests[0].answers.prompted, "traffic doubled overnight");
});
