import test from "node:test";
import assert from "node:assert/strict";
import { SERVICE, servicePage, qualifyPage, thanksPage, handleQualify, listQualify } from "../src/service.js";
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
  const rows = [];
  return {
    rows,
    prepare(sql) {
      return {
        bind(...args) { return { run: async () => { if (/INSERT INTO service_requests/.test(sql)) rows.push(args); return { meta: { changes: 1 } }; }, all: async () => ({ results: rows.map((r) => ({ ref: r[0], created: r[1], email: r[2], site: r[3], answers: r[4], status: "new" })) }) }; },
        run: async () => ({ meta: { changes: 0 } }),
        all: async () => ({ results: rows.map((r) => ({ ref: r[0], created: r[1], email: r[2], site: r[3], answers: r[4], status: "new" })) }),
      };
    },
  };
}

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
