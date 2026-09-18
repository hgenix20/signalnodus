import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDomain, snippet, canaryPage } from "../src/sites.js";

test("domains are normalized and junk refused", () => {
  assert.equal(normalizeDomain("https://www.Example.com/blog"), "example.com");
  assert.equal(normalizeDomain("news.example.co.uk"), "news.example.co.uk");
  assert.equal(normalizeDomain("not a domain"), null);
  assert.equal(normalizeDomain("<script>"), null);
});

test("the snippet is hidden bait pointing at the site's own canary routes", () => {
  const s = snippet("s0123456789ab");
  assert.match(s, /<div hidden aria-hidden="true"/);
  assert.match(s, /https:\/\/signalnodus\.ai\/c\/s\/s0123456789ab\/i/);
  assert.match(s, /href="https:\/\/signalnodus\.ai\/c\/s\/s0123456789ab\/t"/);
});

test("the sign-up page has the form and says hits count anonymously", () => {
  const html = canaryPage();
  assert.match(html, /data-canary-form/);
  assert.match(html, /without your site's name/);
});
