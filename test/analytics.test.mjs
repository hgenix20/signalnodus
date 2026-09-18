import test from "node:test";
import assert from "node:assert/strict";
import { rejectReason, handleHit, trafficSummary } from "../src/analytics.js";

const HUMAN = { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1", asn: 7922, origin: "https://signalnodus.ai", ownerCookie: null, ip: "1.2.3.4", ownerIps: [] };

test("a person on a consumer network counts", () => assert.equal(rejectReason(HUMAN), null));
test("the owner never counts, by cookie or IP", () => {
  assert.equal(rejectReason({ ...HUMAN, ownerCookie: "1" }), "owner");
  assert.equal(rejectReason({ ...HUMAN, ownerIps: ["1.2.3.4"] }), "owner");
});
test("bots, datacenters, workers and foreign origins do not count", () => {
  assert.equal(rejectReason({ ...HUMAN, ua: "Mozilla/5.0 (compatible; GPTBot/1.2)" }), "bot_ua");
  assert.equal(rejectReason({ ...HUMAN, ua: "Mozilla/5.0 HeadlessChrome/140" }), "bot_ua");
  assert.equal(rejectReason({ ...HUMAN, ua: "python-requests/2.32" }), "bot_ua");
  assert.equal(rejectReason({ ...HUMAN, asn: 13335 }), "datacenter");
  assert.equal(rejectReason({ ...HUMAN, asn: 24940 }), "datacenter");
  assert.equal(rejectReason({ ...HUMAN, origin: "https://evil.example" }), "origin");
  assert.equal(rejectReason({ ...HUMAN, origin: null }), "origin");
  assert.equal(rejectReason({ ...HUMAN, origin: null, fetchSite: "same-origin" }), null);
  assert.equal(rejectReason({ ...HUMAN, origin: null, fetchSite: "cross-site" }), "origin");
  assert.equal(rejectReason({ ...HUMAN, verifiedBot: true }), "verified_bot");
});

function fakeD1() {
  const visits = new Map(), filtered = new Map();
  const stmt = (sql) => ({
    sql,
    bind: (...a) => ({
      run: async () => {
        if (sql.startsWith("INSERT OR IGNORE INTO visits")) { if (!visits.has(a[0])) visits.set(a[0], { pv: a[0], day: a[2], vid: a[3], path: a[4], ref: a[5], utm_source: a[6] }); }
        else if (sql.startsWith("INSERT INTO visits_filtered")) filtered.set(a[1], (filtered.get(a[1]) || 0) + 1);
        else if (sql.startsWith("UPDATE visits")) { const v = visits.get(a[1]); if (v) v.dwell = a[0]; }
      },
    }),
    run: async () => {},
  });
  return { visits, filtered, db: { prepare: stmt, batch: async () => {} } };
}

const req = (body, headers = {}) => new Request("https://signalnodus.ai/api/hit", { method: "POST", body: JSON.stringify(body), headers: { origin: "https://signalnodus.ai", "user-agent": HUMAN.ua, "cf-connecting-ip": "5.6.7.8", ...headers } });

test("a qualified beacon is stored once with the referrer host; the dwell update follows", async () => {
  const f = fakeD1();
  const env = { BILLING: f.db };
  const r = req({ pv: "abc12345-x", path: "/swarms", ref: "https://t.co/xyz", utm_source: "x" });
  Object.defineProperty(r, "cf", { value: { asn: 7922, country: "US" } });
  assert.equal((await handleHit(r, env, null)).status, 204);
  assert.equal(f.visits.get("abc12345-x").ref, "t.co");
  assert.equal(f.visits.get("abc12345-x").utm_source, "x");
  await handleHit(req({ pv: "abc12345-x", dwell: 42000 }), env, null);
  assert.equal(f.visits.get("abc12345-x").dwell, 42000);
});

test("a filtered beacon is counted by reason, not stored, and still answers 204", async () => {
  const f = fakeD1();
  const r = req({ pv: "abc12345-y", path: "/" }, { cookie: "sn_owner=1" });
  assert.equal((await handleHit(r, { BILLING: f.db }, null)).status, 204);
  assert.equal(f.visits.size, 0);
  assert.equal(f.filtered.get("owner"), 1);
});
