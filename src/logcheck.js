// The free log checker at /log-checker: "Which AI crawlers hit your site?"
//
// A visitor pastes an access-log excerpt or drops a log file. Everything below that touches the
// log runs in the visitor's browser: the parsing functions are plain functions exported for the
// tests and inlined into /log-checker.js with Function.prototype.toString, so the page and the
// tests run the same code. The page makes no request with log data; nothing is stored or sent.
import { shell2 } from "./shell2.js";
import { AI_CRAWLERS } from "./aicrawlers.js";

// One access-log line to { ua, bytes, status, path }, or null when the line is not a request.
// Reads the common and combined formats (nginx, Apache, Caddy's common_log), with or without a
// leading virtual host, and JSON lines (Caddy's default access log, and JSON nginx/other logs).
export function parseLine(line) {
  const s = String(line || "").trim();
  if (!s) return null;
  if (s[0] === "{") {
    let o;
    try { o = JSON.parse(s); } catch (e) { return null; }
    if (!o || typeof o !== "object") return null;
    const r = o.request && typeof o.request === "object" ? o.request : {};
    const h = r.headers || o.headers || {};
    let ua = h["User-Agent"] || h["user-agent"] || o.user_agent || o.http_user_agent || o.userAgent || o.ua || "";
    if (Array.isArray(ua)) ua = ua[0] || "";
    const status = Number(o.status ?? o.status_code ?? r.status);
    const bytes = Number(o.size ?? o.bytes ?? o.body_bytes_sent ?? o.bytes_sent ?? 0) || 0;
    const path = r.uri || o.uri || o.request_uri || o.path || "";
    if (!Number.isFinite(status) || status < 100 || status > 599) return null;
    return { ua: String(ua), bytes, status, path: String(path) };
  }
  const m = s.match(/\[[^\]]+\]\s+"((?:[^"\\]|\\.)*)"\s+(\d{3})\s+(\d+|-)(?:\s+"(?:[^"\\]|\\.)*"\s+"((?:[^"\\]|\\.)*)")?/);
  if (!m) return null;
  const req = m[1].split(" ");
  const ua = (m[4] || "").replace(/\\x22|\\"/g, '"');
  return { ua, bytes: m[3] === "-" ? 0 : Number(m[3]), status: Number(m[2]), path: req.length > 1 ? req[1] : "" };
}

// The first crawler whose token appears in the user agent, or null.
export function matchCrawler(ua, crawlers) {
  const low = String(ua || "").toLowerCase();
  if (!low) return null;
  for (const c of crawlers) if (c.logs !== false && low.includes(c.token.toLowerCase())) return c;
  return null;
}

export function newTally() {
  return { lines: 0, requests: 0, skipped: 0, noUA: 0, bytes: 0, hits: {} };
}

export function addLine(t, line, crawlers) {
  if (!String(line || "").trim()) return t;
  t.lines++;
  const r = parseLine(line);
  if (!r) { t.skipped++; return t; }
  t.requests++;
  t.bytes += r.bytes;
  if (!r.ua || r.ua === "-") { t.noUA++; return t; }
  const c = matchCrawler(r.ua, crawlers);
  if (!c) return t;
  const row = t.hits[c.token] || (t.hits[c.token] = { hits: 0, bytes: 0 });
  row.hits++;
  row.bytes += r.bytes;
  return t;
}

// Rows sorted by hits, with each crawler's share of all parsed requests and of all bytes.
export function summarize(t, crawlers) {
  const rows = crawlers.filter((c) => t.hits[c.token]).map((c) => {
    const h = t.hits[c.token];
    return { token: c.token, operator: c.operator, purpose: c.purpose, hits: h.hits, bytes: h.bytes,
      share: t.requests ? h.hits / t.requests : 0, byteShare: t.bytes ? h.bytes / t.bytes : 0 };
  }).sort((a, b) => b.hits - a.hits || b.bytes - a.bytes);
  const aiHits = rows.reduce((n, r) => n + r.hits, 0), aiBytes = rows.reduce((n, r) => n + r.bytes, 0);
  return { lines: t.lines, requests: t.requests, skipped: t.skipped, noUA: t.noUA, bytes: t.bytes, rows, aiHits, aiBytes,
    aiShare: t.requests ? aiHits / t.requests : 0, aiByteShare: t.bytes ? aiBytes / t.bytes : 0 };
}

export function analyze(text, crawlers) {
  const t = newTally();
  for (const line of String(text || "").split(/\r?\n/)) addLine(t, line, crawlers);
  return summarize(t, crawlers);
}

// Blocking rules for a list of user-agent tokens, one string per stack.
// robotsOnly: tokens that exist only in robots.txt (they never reach a server, so no server rule).
export function buildRules(tokens, robotsOnly) {
  const extra = (robotsOnly || []).filter((t) => !tokens.includes(t));
  const re = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const robots = "# robots.txt is a request, not a lock: crawlers that honour it stop, others do not.\n"
    + tokens.concat(extra).map((t) => "User-agent: " + t).join("\n") + "\nDisallow: /\n";
  const nginx = "# Inside the server { } block for your site\n"
    + "if ($http_user_agent ~* \"(" + re + ")\") {\n    return 403;\n}\n";
  const apache = "# In the virtual host or .htaccess (needs mod_rewrite)\n"
    + "<IfModule mod_rewrite.c>\n    RewriteEngine On\n    RewriteCond %{HTTP_USER_AGENT} (" + re + ") [NC]\n    RewriteRule ^ - [F,L]\n</IfModule>\n";
  const caddy = "# Caddyfile, inside your site block\n"
    + "@aicrawlers header_regexp User-Agent \"(?i)(" + re + ")\"\n" + "respond @aicrawlers 403\n";
  const vercel = JSON.stringify({ routes: [{ src: "/(.*)", has: [{ type: "header", key: "user-agent", value: ".*(" + re + ").*" }], mitigate: { action: "deny" } }] }, null, 2) + "\n";
  const netlify = "// netlify/edge-functions/block-ai-crawlers.js\n"
    + "const BLOCKED = /(" + re + ")/i;\n\n"
    + "export default async (request, context) => {\n"
    + "  if (BLOCKED.test(request.headers.get(\"user-agent\") || \"\")) {\n"
    + "    return new Response(\"Forbidden\", { status: 403 });\n  }\n"
    + "  return context.next();\n};\n\n"
    + "export const config = { path: \"/*\" };\n";
  const cloudflare = tokens.map((t) => "(lower(http.user_agent) contains \"" + t.toLowerCase() + "\")").join(" or ") + "\n";
  return { robots, nginx, apache, caddy, vercel, netlify, cloudflare };
}

export function fmtBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(n < 10 ? 1 : 0) : String(n)) + " " + u[i];
}

export const STACKS = [
  ["robots", "robots.txt", "Put this in /robots.txt at the root of your site. It is advisory: well-behaved crawlers follow it, and nothing forces the rest to."],
  ["nginx", "nginx", "Reload nginx after adding it (nginx -t, then nginx -s reload). Matched requests get 403."],
  ["apache", "Apache", "Works in the virtual host or in .htaccess when AllowOverride permits rewrites. Matched requests get 403."],
  ["caddy", "Caddy", "Add inside the site block of your Caddyfile, then caddy reload."],
  ["vercel", "Vercel", "Add to vercel.json. Vercel does not allow routes alongside rewrites, redirects or headers in the same file; if yours has those, make the same match a Firewall custom rule in the dashboard (User Agent, matches expression, Deny)."],
  ["netlify", "Netlify", "Save as netlify/edge-functions/block-ai-crawlers.js and deploy. Matched requests get 403."],
  ["cloudflare", "Cloudflare WAF", "Security, WAF, Custom rules, Create rule, Edit expression: paste this and choose Block."],
];

const SAMPLE = [
  '203.0.113.7 - - [24/Sep/2026:10:01:12 +0000] "GET /blog/post-1 HTTP/1.1" 200 18432 "-" "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)"',
  '198.51.100.23 - - [24/Sep/2026:10:01:15 +0000] "GET / HTTP/1.1" 200 9120 "https://news.ycombinator.com/" "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"',
  '192.0.2.44 - - [24/Sep/2026:10:02:03 +0000] "GET /blog/post-2 HTTP/1.1" 200 22011 "-" "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)"',
  '192.0.2.61 - - [24/Sep/2026:10:02:09 +0000] "GET /feed.xml HTTP/1.1" 200 40210 "-" "CCBot/2.0 (https://commoncrawl.org/faq/)"',
  '198.51.100.9 - - [24/Sep/2026:10:03:30 +0000] "GET /about HTTP/1.1" 200 7304 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36"',
  '203.0.113.90 - - [24/Sep/2026:10:04:41 +0000] "GET /blog/post-3 HTTP/1.1" 200 19876 "-" "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)"',
].join("\n");

export function logCheckPage() {
  const tabs = STACKS.map(([id, label], i) => `<button type="button" role="tab" id="lc-tab-${id}" aria-controls="lc-panel" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-stack="${id}">${label}</button>`).join("");
  const inner = `<main><section class="chapter bt0 lc" id="check" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">Free tool · no signup</span><h1>Which AI crawlers hit your site?</h1>
      <p class="lede mw44">Paste a piece of your access log or drop the file. You get the AI crawlers it contains, how many requests and bytes each took, and rules to block them on your stack.</p>
      <p class="lc-private">Your log stays in this browser: it is read here, and nothing is uploaded, stored or sent anywhere.</p></div>
    <form class="lc-form" data-lc-form>
      <label for="lc-text" class="lc-label">Access log lines</label>
      <textarea id="lc-text" rows="8" spellcheck="false" autocomplete="off" placeholder='203.0.113.7 - - [24/Sep/2026:10:01:12 +0000] "GET / HTTP/1.1" 200 5120 "-" "...GPTBot/1.2..."'></textarea>
      <label class="lc-drop" data-lc-drop for="lc-file"><span>Or choose a log file (plain or .gz), or drop it here</span><input id="lc-file" type="file" accept=".log,.txt,.gz,.json,text/plain,application/gzip"></label>
      <p class="dim small">Reads nginx and Apache common or combined format, Caddy's JSON access log, and JSON lines with a user agent field. Other lines are skipped and counted.</p>
      <div class="row"><button type="submit" class="cta">Check the log</button><button type="button" class="cta ghost" data-lc-sample>Try a sample</button></div>
      <p class="dim" data-lc-status role="status" aria-live="polite"></p>
    </form>
    <div class="lc-results" data-lc-results hidden>
      <h2>What the log shows</h2>
      <div class="lc-stats" data-lc-stats></div>
      <div class="scroll"><table class="lc-table"><thead><tr><th scope="col">Crawler</th><th scope="col">Operator</th><th scope="col">Use</th><th scope="col" class="num">Requests</th><th scope="col" class="num">Bytes</th><th scope="col" class="num">Share</th></tr></thead><tbody data-lc-rows></tbody></table></div>
      <p class="dim small">Crawlers are named by the user agent each request announced. A user agent can be forged, so a match says what the request claimed to be. Google-Extended and Applebot-Extended never appear in logs; they exist only as robots.txt controls.</p>
      <h2>Rules to block them</h2>
      <fieldset class="lc-scope"><legend class="dim small">Which crawlers go in the rules</legend>
        <label><input type="radio" name="lc-scope" value="found" checked> The ones in this log</label>
        <label><input type="radio" name="lc-scope" value="all"> Everything on our list</label>
      </fieldset>
      <div class="lc-tabs" role="tablist" aria-label="Your stack">${tabs}</div>
      <div id="lc-panel" role="tabpanel" class="lc-panel">
        <p class="dim small" data-lc-note></p>
        <pre class="code" data-lc-code tabindex="0"></pre>
        <button type="button" class="cta ghost" data-lc-copy>Copy</button>
      </div>
      <p class="lc-offer">Want it done for you? We apply the rules to your site and check they work, for 350 USD. <a href="/qualify">Check whether your site qualifies</a>.</p>
    </div>
  </div></section></main>
<script src="/log-checker.js" defer></script>`;
  return shell2("Which AI crawlers hit your site? · Signal Nodus", inner, {
    current: "/log-checker", canonical: "https://signalnodus.ai/log-checker",
    description: "Paste an access log and see which AI crawlers hit your site, with requests, bytes and ready-to-copy blocking rules. Runs in your browser; nothing is uploaded.",
  }).replace("</head>", '<link rel="stylesheet" href="/log-checker.css">\n</head>');
}

export const LOGCHECK_CSS = `
section.chapter.lc .wrap{grid-template-columns:minmax(0,1fr);gap:32px;max-width:60rem}
.lc-private{border-left:4px solid var(--canary,#FBBF24);padding:.2rem 0 .2rem 1rem;color:var(--fg)}
.lc-form{display:grid;gap:12px}
.lc-label{font-weight:600}
.lc-form textarea{width:100%;min-height:10rem;padding:.7rem .8rem;border-radius:8px;border:1px solid var(--line);background:#0b0e14;color:inherit;font:400 13px/1.5 var(--mono);resize:vertical}
.lc-drop{display:flex;flex-direction:column;gap:8px;min-height:44px;padding:14px;border:1px dashed var(--line);border-radius:8px;cursor:pointer}
.lc-drop[data-over="true"]{border-color:var(--canary,#FBBF24);background:var(--muted)}
.lc-drop input{min-height:44px;max-width:100%;color:var(--dim)}
.small{font-size:14px}
.lc-results{display:grid;gap:18px}
.lc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.lc-stats div{border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--panel)}
.lc-stats b{display:block;font:700 24px/1.1 var(--display);color:var(--fg);font-variant-numeric:tabular-nums}
.lc-stats span{font-size:13px;color:var(--dim)}
.scroll{overflow-x:auto}
.lc-table{border-collapse:collapse;width:100%;font-size:15px;min-width:34rem}
.lc-table th,.lc-table td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line)}
.lc-table .num{text-align:right;font-variant-numeric:tabular-nums}
.lc-scope{border:0;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:4px 18px}
.lc-scope label{display:inline-flex;align-items:center;gap:8px;min-height:44px;cursor:pointer}
.lc-scope input{width:20px;height:20px;accent-color:var(--canary,#FBBF24)}
.lc-tabs{display:flex;flex-wrap:wrap;gap:6px}
.lc-tabs button{font:500 14px var(--body);color:var(--dim);background:transparent;border:1px solid var(--line);border-radius:4px;padding:0 14px;min-height:44px;cursor:pointer}
.lc-tabs button[aria-selected="true"]{color:var(--ink-on-canary,#0B1426);background:var(--canary,#FBBF24);border-color:var(--canary,#FBBF24)}
.lc-panel{display:grid;gap:10px;justify-items:start}
.lc-panel pre{width:100%;margin:0;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}
.lc-offer{border-top:1px solid var(--line);padding-top:18px}
@media (max-width:480px){.lc-table{font-size:14px}.lc-stats b{font-size:20px}}
`;

const UI = String.raw`
  const form = document.querySelector("[data-lc-form]");
  if (!form) return;
  const $ = (s) => document.querySelector(s);
  const text = $("#lc-text"), file = $("#lc-file"), drop = $("[data-lc-drop]"), status = $("[data-lc-status]");
  const results = $("[data-lc-results]"), code = $("[data-lc-code]"), note = $("[data-lc-note]");
  const tabs = [...document.querySelectorAll(".lc-tabs [role=tab]")];
  let last = null, stack = "robots";
  const pct = (x) => (x * 100 < 0.1 && x > 0 ? "<0.1" : (x * 100).toFixed(x * 100 < 10 ? 1 : 0)) + "%";

  function el(tag, txt, cls) { const e = document.createElement(tag); if (txt != null) e.textContent = txt; if (cls) e.className = cls; return e; }

  function render(s) {
    last = s;
    const stats = $("[data-lc-stats]");
    stats.replaceChildren();
    for (const [v, l] of [[s.requests.toLocaleString(), "requests read"], [s.aiHits.toLocaleString(), "from AI crawlers"], [pct(s.aiShare), "of requests"], [fmtBytes(s.aiBytes), "sent to AI crawlers (" + pct(s.aiByteShare) + ")"]]) {
      const d = el("div"); d.append(el("b", v), el("span", l)); stats.append(d);
    }
    const body = $("[data-lc-rows]");
    body.replaceChildren();
    if (!s.rows.length) {
      const tr = el("tr"), td = el("td", "No known AI crawler user agents in these lines.");
      td.colSpan = 6; tr.append(td); body.append(tr);
    }
    for (const r of s.rows) {
      const tr = el("tr");
      tr.append(el("td", r.token), el("td", r.operator), el("td", r.purpose), el("td", r.hits.toLocaleString(), "num"), el("td", fmtBytes(r.bytes), "num"), el("td", pct(r.share), "num"));
      body.append(tr);
    }
    const skip = [];
    if (s.skipped) skip.push(s.skipped.toLocaleString() + " lines were not in a format this reads and were skipped");
    if (s.noUA) skip.push(s.noUA.toLocaleString() + " requests had no user agent (common log format leaves it out)");
    status.textContent = skip.length ? skip.join("; ") + "." : "";
    if (!s.rows.length) document.querySelector("input[name=lc-scope][value=all]").checked = true;
    results.hidden = false;
    showRules();
  }

  function showRules() {
    const scope = (document.querySelector("input[name=lc-scope]:checked") || {}).value;
    const all = scope === "all" || !last || !last.rows.length;
    const tokens = all ? CRAWLERS.filter((c) => c.logs !== false).map((c) => c.token) : last.rows.map((r) => r.token);
    const robotsOnly = all ? CRAWLERS.filter((c) => c.logs === false).map((c) => c.token) : [];
    const rules = buildRules(tokens, robotsOnly);
    code.textContent = rules[stack];
    note.textContent = (STACKS.find((x) => x[0] === stack) || [])[2] || "";
  }

  function run(s) { render(s); results.scrollIntoView({ behavior: "smooth", block: "start" }); }

  async function readFile(f) {
    status.textContent = "Reading " + f.name + " in this browser...";
    const t = newTally();
    let stream = f.stream();
    if (/\.gz$/i.test(f.name)) {
      if (typeof DecompressionStream === "undefined") { status.textContent = "This browser cannot unpack .gz files. Unzip it first, or paste some lines."; return; }
      stream = stream.pipeThrough(new DecompressionStream("gzip"));
    }
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const l of lines) addLine(t, l, CRAWLERS);
      }
      if (buf) addLine(t, buf, CRAWLERS);
    } catch (e) { status.textContent = "That file could not be read as text."; return; }
    run(summarize(t, CRAWLERS));
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (file.files && file.files[0]) { readFile(file.files[0]); return; }
    if (!text.value.trim()) { status.textContent = "Paste some log lines or choose a file first."; text.focus(); return; }
    run(analyze(text.value, CRAWLERS));
  });
  file.addEventListener("change", () => { if (file.files && file.files[0]) readFile(file.files[0]); });
  $("[data-lc-sample]").addEventListener("click", () => { text.value = SAMPLE; file.value = ""; run(analyze(SAMPLE, CRAWLERS)); });
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.dataset.over = "true"; });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => { drop.dataset.over = "false"; });
  drop.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) readFile(f); });
  document.querySelectorAll("input[name=lc-scope]").forEach((r) => r.addEventListener("change", showRules));

  function select(tab, focus) {
    for (const t of tabs) { const on = t === tab; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; }
    stack = tab.dataset.stack;
    document.getElementById("lc-panel").setAttribute("aria-labelledby", tab.id);
    if (focus) tab.focus();
    showRules();
  }
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (d) { e.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });
  const copy = $("[data-lc-copy]");
  copy.addEventListener("click", () => {
    const done = () => { copy.textContent = "Copied"; setTimeout(() => { copy.textContent = "Copy"; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(code.textContent).then(done, () => { copy.textContent = "Select and copy"; });
    else { const r = document.createRange(); r.selectNodeContents(code); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  });
`;

// The browser script: the same parsing functions the tests import, plus the page wiring.
export const LOGCHECK_JS = `(function () {
"use strict";
const CRAWLERS = ${JSON.stringify(AI_CRAWLERS)};
const STACKS = ${JSON.stringify(STACKS)};
const SAMPLE = ${JSON.stringify(SAMPLE)};
${[parseLine, matchCrawler, newTally, addLine, summarize, analyze, buildRules, fmtBytes].map((f) => f.toString()).join("\n")}
${UI}
})();
`;
