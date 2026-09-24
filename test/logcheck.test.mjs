import test from "node:test";
import assert from "node:assert/strict";
import { parseLine, matchCrawler, analyze, buildRules, fmtBytes, logCheckPage, LOGCHECK_JS, LOGCHECK_CSS } from "../src/logcheck.js";
import { AI_CRAWLERS } from "../src/aicrawlers.js";
import { privacyPage3 } from "../src/pages3.js";

const NGINX = '203.0.113.7 - - [24/Sep/2026:10:01:12 +0000] "GET /blog/post-1 HTTP/1.1" 200 18432 "-" "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)"';
const APACHE = '192.0.2.44 - frank [10/Oct/2026:13:55:36 -0700] "GET /apache_pb.gif HTTP/1.0" 200 2326 "http://www.example.com/start.html" "Mozilla/5.0 (compatible; ClaudeBot/1.0; \\"quoted\\" +claudebot@anthropic.com)"';
const COMMON = '127.0.0.1 - - [10/Oct/2026:13:55:36 -0700] "GET /index.html HTTP/1.1" 304 -';
const VHOST = 'example.com:443 192.0.2.61 - - [24/Sep/2026:10:02:09 +0000] "GET /feed.xml HTTP/1.1" 200 40210 "-" "CCBot/2.0 (https://commoncrawl.org/faq/)"';
const NGINX_ESC = '198.51.100.1 - - [24/Sep/2026:10:02:09 +0000] "GET / HTTP/2.0" 200 100 "-" "Mozilla/5.0 \\x22x\\x22 (compatible; PerplexityBot/1.0)"';
const CADDY = JSON.stringify({ level: "info", ts: 1790000000.1, logger: "http.log.access", msg: "handled request",
  request: { remote_ip: "192.0.2.9", method: "GET", uri: "/docs", headers: { "User-Agent": ["Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)"] } },
  bytes_read: 0, user_id: "", duration: 0.01, size: 5120, status: 200 });
const JSON_NGINX = JSON.stringify({ time: "2026-09-24T10:00:00Z", status: "200", body_bytes_sent: "999", request_uri: "/x", http_user_agent: "Amazonbot/0.1" });
const HUMAN = '198.51.100.9 - - [24/Sep/2026:10:03:30 +0000] "GET /about HTTP/1.1" 200 7304 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0 Safari/537.36"';

test("nginx combined line", () => {
  assert.deepEqual(parseLine(NGINX), { ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)", bytes: 18432, status: 200, path: "/blog/post-1" });
});

test("Apache combined line with escaped quotes in the user agent", () => {
  const r = parseLine(APACHE);
  assert.equal(r.status, 200);
  assert.equal(r.bytes, 2326);
  assert.match(r.ua, /ClaudeBot\/1\.0; "quoted"/);
  const e = parseLine(NGINX_ESC);
  assert.match(e.ua, /"x"/);
  assert.equal(matchCrawler(e.ua, AI_CRAWLERS).token, "PerplexityBot");
});

test("common log format: no user agent, dash bytes", () => {
  assert.deepEqual(parseLine(COMMON), { ua: "", bytes: 0, status: 304, path: "/index.html" });
});

test("virtual-host prefixed line", () => {
  const r = parseLine(VHOST);
  assert.equal(r.bytes, 40210);
  assert.equal(matchCrawler(r.ua, AI_CRAWLERS).token, "CCBot");
});

test("Caddy JSON access log and generic JSON lines", () => {
  const c = parseLine(CADDY);
  assert.equal(c.bytes, 5120);
  assert.equal(c.status, 200);
  assert.equal(c.path, "/docs");
  assert.equal(matchCrawler(c.ua, AI_CRAWLERS).token, "Bytespider");
  const j = parseLine(JSON_NGINX);
  assert.equal(j.bytes, 999);
  assert.equal(matchCrawler(j.ua, AI_CRAWLERS).token, "Amazonbot");
});

test("unknown and malformed lines are ignored", () => {
  for (const l of ["", "   ", "hello world", "2026/09/24 10:00:00 [error] 123#0: *1 open() failed", "{not json", '{"msg":"no status"}', "[24/Sep/2026] GET / 200"]) {
    assert.equal(parseLine(l), null, l);
  }
});

test("matching is case-insensitive and ignores robots.txt-only tokens", () => {
  assert.equal(matchCrawler("mozilla/5.0 (compatible; gptbot/1.0)", AI_CRAWLERS).token, "GPTBot");
  assert.equal(matchCrawler("Claude-User/1.0", AI_CRAWLERS).token, "Claude-User");
  assert.equal(matchCrawler("Google-Extended", AI_CRAWLERS), null);
  assert.equal(matchCrawler("Mozilla/5.0 Chrome/128", AI_CRAWLERS), null);
  assert.equal(matchCrawler("", AI_CRAWLERS), null);
});

test("analyze counts hits, bytes and shares, and skips junk", () => {
  const s = analyze([NGINX, NGINX, HUMAN, COMMON, "garbage", VHOST].join("\n"), AI_CRAWLERS);
  assert.equal(s.lines, 6);
  assert.equal(s.requests, 5);
  assert.equal(s.skipped, 1);
  assert.equal(s.noUA, 1);
  assert.equal(s.rows[0].token, "GPTBot");
  assert.equal(s.rows[0].hits, 2);
  assert.equal(s.rows[0].bytes, 36864);
  assert.equal(s.rows[0].share, 2 / 5);
  assert.equal(s.aiHits, 3);
  assert.equal(s.aiBytes, 36864 + 40210);
  assert.equal(s.aiByteShare, (36864 + 40210) / (36864 + 7304 + 40210));
});

test("crawler list: unique tokens, no token inside another", () => {
  const toks = AI_CRAWLERS.map((c) => c.token.toLowerCase());
  assert.equal(new Set(toks).size, toks.length);
  for (const a of toks) for (const b of toks) if (a !== b) assert.ok(!b.includes(a), `${a} inside ${b}`);
  for (const t of ["GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "PerplexityBot", "Bytespider", "Google-Extended", "Amazonbot", "Meta-ExternalAgent"]) {
    assert.ok(AI_CRAWLERS.some((c) => c.token === t), t);
  }
});

test("rules for each stack", () => {
  const r = buildRules(["GPTBot", "ClaudeBot"], ["Google-Extended"]);
  assert.match(r.robots, /User-agent: GPTBot\nUser-agent: ClaudeBot\nUser-agent: Google-Extended\nDisallow: \/\n/);
  assert.match(r.robots, /not a lock/);
  assert.match(r.nginx, /if \(\$http_user_agent ~\* "\(GPTBot\|ClaudeBot\)"\) \{\n    return 403;\n\}/);
  assert.match(r.apache, /RewriteCond %\{HTTP_USER_AGENT\} \(GPTBot\|ClaudeBot\) \[NC\]\n    RewriteRule \^ - \[F,L\]/);
  assert.match(r.caddy, /@aicrawlers header_regexp User-Agent "\(\?i\)\(GPTBot\|ClaudeBot\)"\nrespond @aicrawlers 403/);
  const v = JSON.parse(r.vercel);
  assert.equal(v.routes[0].mitigate.action, "deny");
  assert.equal(v.routes[0].has[0].key, "user-agent");
  assert.match(r.netlify, /const BLOCKED = \/\(GPTBot\|ClaudeBot\)\/i;/);
  assert.match(r.netlify, /export const config = \{ path: "\/\*" \};/);
  assert.equal(r.cloudflare, '(lower(http.user_agent) contains "gptbot") or (lower(http.user_agent) contains "claudebot")\n');
  assert.doesNotMatch(r.nginx, /Google-Extended/);
});

test("fmtBytes", () => {
  assert.equal(fmtBytes(0), "0 B");
  assert.equal(fmtBytes(512), "512 B");
  assert.equal(fmtBytes(1536), "1.5 KB");
  assert.equal(fmtBytes(40 * 1024 * 1024), "40 MB");
});

test("the page says nothing leaves the browser, links /qualify once, and has every stack", () => {
  const html = logCheckPage();
  assert.match(html, /Which AI crawlers hit your site\?/);
  assert.match(html, /nothing is uploaded, stored or sent anywhere/);
  assert.equal((html.match(/href="\/qualify"/g) || []).length, 2); // the nav link plus the one call to action
  assert.match(html, /350 USD/);
  for (const s of ["robots", "nginx", "apache", "caddy", "vercel", "netlify", "cloudflare"]) assert.match(html, new RegExp(`data-stack="${s}"`));
  assert.doesNotMatch(html, /style="/);
  assert.doesNotMatch(html, /<script>(?!\{)/);
});

test("the browser script compiles and never makes a request", () => {
  assert.doesNotThrow(() => new Function(LOGCHECK_JS));
  assert.doesNotMatch(LOGCHECK_JS, /fetch\(|XMLHttpRequest|sendBeacon|localStorage|WebSocket/);
  assert.match(LOGCHECK_CSS, /min-height:44px/);
});

test("the privacy page says the log checker collects nothing", () => {
  assert.match(privacyPage3(), /log checker.*never uploaded, stored or sent/);
});
