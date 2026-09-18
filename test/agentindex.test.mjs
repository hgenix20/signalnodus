import test from "node:test";
import assert from "node:assert/strict";
import { uaFamily, buildIndex, indexPage, publicSummary } from "../src/agentindex.js";

test("families come from the claimed user agent, most specific first", () => {
  assert.equal(uaFamily("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)").name, "GPTBot");
  assert.equal(uaFamily("Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)").name, "ClaudeBot");
  assert.equal(uaFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15").name, "Claims to be a normal browser");
  assert.equal(uaFamily("python-requests/2.32").name, "Python HTTP client");
  assert.equal(uaFamily("").name, "No user agent");
});

test("the index counts obeyed and trapped per family, ranks by obeyed", () => {
  const rows = buildIndex([
    { ts: "2026-09-18T10:00:00Z", kind: "trap", page: "home", ua: "GPTBot/1.2", org: "Microsoft" },
    { ts: "2026-09-18T11:00:00Z", kind: "instruction", page: "home", ua: "Mozilla/5.0 (iPhone)", org: "6 COLLYER QUAY" },
    { ts: "2026-09-18T11:01:00Z", kind: "trap", page: "home", ua: "Mozilla/5.0 (iPhone)", org: "6 COLLYER QUAY" },
  ]);
  assert.equal(rows[0].family, "Claims to be a normal browser");
  assert.equal(rows[0].obeyed, 1); assert.equal(rows[0].trapped, 1);
  assert.deepEqual(rows[1].networks, ["Microsoft"]);
});

test("the public summary counts agents and categories, and the page names no claimed company", () => {
  const hits = [
    { ts: "2026-09-18T10:00:00Z", kind: "trap", page: "home", ua: "Mozilla/5.0 (compatible; GPTBot/1.2)", asn: 8075, org: "Microsoft" },
    { ts: "2026-09-18T11:00:00Z", kind: "instruction", page: "home", ua: "Mozilla/5.0 (iPhone)", asn: 132203, org: "Tencent" },
    { ts: "2026-09-18T11:10:00Z", kind: "trap", page: "home", ua: "Mozilla/5.0 (iPhone)", asn: 132203, org: "Tencent" },
  ];
  const d = publicSummary(hits);
  assert.equal(d.agents_caught, 2);
  assert.equal(d.obeyed, 1); assert.equal(d.trapped, 2);
  assert.deepEqual(d.by_category.map((c) => c.category).sort(), ["Agents disguised as a person's browser", "Self-declared AI crawlers and assistants"]);
  const html = indexPage(d);
  assert.ok(!/GPTBot|Tencent|Microsoft/.test(html));
  assert.match(html, /2<\/b><span>agents caught/);
  assert.match(indexPage(publicSummary([])), /Nothing has taken the bait yet/);
});

import { netKind } from "../src/netkind.js";
test("network kind flags hidden origins", () => {
  assert.equal(netKind({ asn: 132203, org: "Tencent" }).kind, "hosting");
  assert.equal(netKind({ asn: 13335 }).kind, "cloudflare");
  assert.equal(netKind({ asn: 1, org: "x", country: "T1" }).kind, "tor");
  assert.equal(netKind({ asn: 9009, org: "M247" }).kind, "vpn");
  assert.equal(netKind({ asn: 7922, org: "Comcast" }).hidden, false);
  const d = publicSummary([{ ts: "2026-09-18T11:00:00Z", kind: "trap", page: "home", ua: "Mozilla/5.0 (iPhone)", asn: 132203, org: "Tencent", country: "US" }]);
  assert.equal(d.hidden_agents, 1);
  assert.match(indexPage(d), /United States/);
});
