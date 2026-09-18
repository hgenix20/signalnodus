import test from "node:test";
import assert from "node:assert/strict";
import { buildNodes, canaryHtml, canaryToken, swarmsData, swarmsPage, handleCanary, DETECTED_DAYS } from "../src/swarms.js";

const NOW = new Date("2026-09-18T18:00:00Z");
const hit = (ts, asn, org, kind = "trap") => ({ ts, kind, page: "watch", ua: "GPTBot/1.0", asn, org, country: "US", city: "Ashburn", lat: 39.04, lon: -77.49 });

test("hits group by network, newest first, detected inside the window", () => {
  const nodes = buildNodes([hit("2026-09-17T10:00:00Z", 16509, "Amazon.com"), hit("2026-09-18T09:00:00Z", 16509, "Amazon.com", "instruction")], NOW);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].status, "detected");
  assert.equal(nodes[0].events[0].kind, "instruction");
  assert.equal(nodes[0].last_detected, "2026-09-18T09:00:00Z");
});

test(`detected turns back to watching after ${DETECTED_DAYS} days`, () => {
  const [n] = buildNodes([hit("2026-09-03T17:00:00Z", 15169, "Google LLC")], NOW);
  assert.equal(n.status, "watching");
});

test("a hit without coordinates still gets a tile", () => {
  assert.equal(buildNodes([{ ...hit("2026-09-18T01:00:00Z", 1, "X"), lat: null, lon: null }], NOW).length, 1);
});

test("the bait is in the page, hidden, and points at the canary routes", () => {
  const h = canaryHtml("/watch");
  assert.match(h, /hidden aria-hidden="true"/);
  assert.match(h, /\/c\/i\/watch/);
  assert.match(h, /href="\/c\/t\/watch"/);
  assert.equal(canaryToken("/"), "home");
  assert.match(swarmsPage(), /\/c\/i\/swarms/);
  assert.match(swarmsPage(), /swarms\.css/);
});

test("data without D1 still lists the watched and planned nodes", async () => {
  const d = await swarmsData({});
  assert.ok(d.nodes.some((n) => n.status === "watching") && d.nodes.some((n) => n.status === "planned"));
});

test("a canary hit is recorded and answered; a malformed one is 404", async () => {
  const rows = [];
  const env = { BILLING: { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { rows.push([sql, a]); } }), run: async () => {} }) } };
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  const req = new Request("https://signalnodus.ai/c/i/watch", { headers: { "user-agent": "agent" } });
  const res = await handleCanary(req, env, ctx, new URL(req.url));
  await Promise.all(waits);
  assert.equal(res.status, 200);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1][1], "instruction");
  const bad = await handleCanary(req, env, ctx, new URL("https://signalnodus.ai/c/x/../../etc"));
  assert.equal(bad.status, 404);
});

test("every watched tile has a logo or a monogram, and the icons ship with the data", async () => {
  const d = await swarmsData({});
  for (const n of d.nodes) assert.ok((n.icon && d.icons[n.icon]) || n.mono, n.id);
  for (const id of ["x", "tiktok", "truthsocial", "facebook"]) assert.ok(d.nodes.some((n) => n.id === id), id);
});
