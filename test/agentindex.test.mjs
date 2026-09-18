import test from "node:test";
import assert from "node:assert/strict";
import { uaFamily, buildIndex, indexPage } from "../src/agentindex.js";

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

test("the page escapes what requests claimed and says claims are not proof", () => {
  const html = indexPage({ hits: 1, rows: buildIndex([{ ts: "2026-09-18T10:00:00Z", kind: "trap", page: "home", ua: "x", org: "<script>alert(1)</script>" }]) });
  assert.ok(!html.includes("<script>alert(1)"));
  assert.match(html, /not proof/);
  assert.match(indexPage({ hits: 0, rows: [] }), /Nothing has taken the bait yet/);
});
