// The Agent Obedience Index: what the canaries on this site have caught, grouped by the agent a
// request claimed to be. Everything here is a claim from the request (its user agent) plus the network
// Cloudflare placed it on. A user agent can be forged, so the index says "a request claiming X", never
// "X did". Built from canary_hits (see swarms.js); no IP addresses exist to show.
import { shell2 } from "./shell2.js";

// Ordered: the first pattern that matches names the family. Operators are named as the user agent
// token documents them, not as a finding about the company.
const FAMILIES = [
  [/GPTBot/i, "GPTBot", "OpenAI's training crawler, by its user agent"],
  [/ChatGPT-User/i, "ChatGPT-User", "ChatGPT fetching a page for a user, by its user agent"],
  [/OAI-SearchBot/i, "OAI-SearchBot", "OpenAI search crawler, by its user agent"],
  [/ClaudeBot/i, "ClaudeBot", "Anthropic's crawler, by its user agent"],
  [/Claude-User/i, "Claude-User", "Claude fetching a page for a user, by its user agent"],
  [/Claude-SearchBot/i, "Claude-SearchBot", "Anthropic search crawler, by its user agent"],
  [/anthropic-ai/i, "anthropic-ai", "Anthropic user agent token"],
  [/Perplexity-User/i, "Perplexity-User", "Perplexity fetching for a user, by its user agent"],
  [/PerplexityBot/i, "PerplexityBot", "Perplexity crawler, by its user agent"],
  [/Google-Extended|Google-CloudVertexBot/i, "Google AI crawler", "Google AI crawling token"],
  [/Googlebot/i, "Googlebot", "Google search crawler, by its user agent"],
  [/bingbot/i, "Bingbot", "Microsoft Bing crawler, by its user agent"],
  [/Applebot/i, "Applebot", "Apple crawler, by its user agent"],
  [/Bytespider/i, "Bytespider", "ByteDance crawler, by its user agent"],
  [/CCBot/i, "CCBot", "Common Crawl, by its user agent"],
  [/Amazonbot/i, "Amazonbot", "Amazon crawler, by its user agent"],
  [/meta-externalagent|FacebookBot|facebookexternalhit/i, "Meta crawler", "Meta crawler, by its user agent"],
  [/DuckAssistBot/i, "DuckAssistBot", "DuckDuckGo assistant, by its user agent"],
  [/cohere-ai/i, "cohere-ai", "Cohere user agent token"],
  [/Diffbot/i, "Diffbot", "Diffbot, by its user agent"],
  [/HeadlessChrome|Puppeteer|Playwright/i, "Headless browser", "an automated browser that says so"],
  [/python-requests|python-urllib|aiohttp|httpx/i, "Python HTTP client", "a script, by its user agent"],
  [/curl\//i, "curl", "a command-line client"],
  [/Go-http-client/i, "Go HTTP client", "a program, by its user agent"],
  [/node-fetch|undici|axios/i, "Node.js HTTP client", "a program, by its user agent"],
  [/bot|crawl|spider/i, "Other self-declared bot", "a user agent that calls itself a bot"],
  [/Mozilla\//i, "Claims to be a normal browser", "a user agent that looks like a person's browser; a person never reaches a canary, so this is an agent in disguise"],
];

export function uaFamily(ua) {
  const s = String(ua || "");
  for (const [re, name, note] of FAMILIES) if (re.test(s)) return { name, note };
  return { name: s ? "Unrecognised user agent" : "No user agent", note: "no known pattern" };
}

// Pure: canary hits in, index rows out. Sorted by how many times the family obeyed a hidden instruction.
export function buildIndex(hits) {
  const rows = new Map();
  for (const h of hits) {
    const fam = uaFamily(h.ua);
    let r = rows.get(fam.name);
    if (!r) { r = { family: fam.name, note: fam.note, obeyed: 0, trapped: 0, pages: new Set(), networks: new Map(), first: h.ts, last: h.ts }; rows.set(fam.name, r); }
    if (h.kind === "instruction") r.obeyed++; else r.trapped++;
    r.pages.add(h.page);
    const net = h.org || "unknown network";
    r.networks.set(net, (r.networks.get(net) || 0) + 1);
    if (h.ts < r.first) r.first = h.ts;
    if (h.ts > r.last) r.last = h.ts;
  }
  return [...rows.values()]
    .map((r) => ({ family: r.family, note: r.note, obeyed: r.obeyed, trapped: r.trapped, pages: r.pages.size,
      networks: [...r.networks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n), network_count: r.networks.size, first: r.first, last: r.last }))
    .sort((a, b) => b.obeyed - a.obeyed || b.trapped - a.trapped || a.family.localeCompare(b.family));
}

export async function indexData(env) {
  let hits = [];
  if (env?.BILLING) {
    try {
      const r = await env.BILLING.prepare("SELECT ts, kind, page, ua, org FROM canary_hits ORDER BY id DESC LIMIT 5000").all();
      hits = r.results || [];
    } catch { hits = []; }
  }
  return { updated: new Date().toISOString(), hits: hits.length, rows: buildIndex(hits) };
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function indexPage(data) {
  const body = data.rows.length
    ? data.rows.map((r) => `<tr><th scope="row">${esc(r.family)}<span class="dim small">${esc(r.note)}</span></th><td class="num">${r.obeyed}</td><td class="num">${r.trapped}</td><td>${esc(r.networks.join(", "))}${r.network_count > 3 ? ` <span class="dim">+${r.network_count - 3} more</span>` : ""}</td><td class="dim">${esc(r.first.slice(0, 10))} to ${esc(r.last.slice(0, 10))}</td></tr>`).join("")
    : `<tr><td colspan="5" class="dim">Nothing has taken the bait yet.</td></tr>`;
  const inner = `<main>
  <section class="chapter bt0" id="agent-index" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">live from the canaries on this site</span><h1>The Agent Obedience Index.</h1>
    <p class="dim mw44">Every page here carries a note that only software reads, asking it to fetch a URL, and a link no person can see that robots.txt forbids. A person never reaches either. This table counts what reached them, grouped by the agent each request claimed to be. ${data.hits} hits so far.</p></div>
    <div class="idx-wrap"><table class="idx"><thead><tr><th scope="col">Claimed agent</th><th scope="col" class="num">Obeyed the hidden instruction</th><th scope="col" class="num">Followed the forbidden link</th><th scope="col">Networks it came from</th><th scope="col">Seen</th></tr></thead><tbody>${body}</tbody></table></div>
    <p class="dim mw44">How to read this: a row is what requests <em>claimed</em> to be, from their user agent, and the networks Cloudflare placed them on. User agents can be forged, so a row is not proof that the named company sent the request; "claims to be a normal browser" is software that disguised itself. We store no IP addresses. Updated live.</p>
    <p><a class="cta" href="/swarms#ea-h">Put the same canaries on your site</a> <a class="cta ghost" href="/agents-index.json">The data as JSON</a></p>
  </div></section></main>`;
  return shell2("Agent Obedience Index · Signal Nodus", inner, { current: "/agents-index", canonical: "https://signalnodus.ai/agents-index", description: "Which AI agents and crawlers obey hidden instructions and ignore robots.txt, counted live from canaries on signalnodus.ai." })
    .replace("</head>", '<link rel="stylesheet" href="/agents-index.css">\n</head>');
}

export const INDEX_CSS = `
.idx-wrap{overflow-x:auto;margin:1.5rem 0;border:1px solid #2a3346;border-radius:10px}
.idx{border-collapse:collapse;width:100%;min-width:40rem;font-size:.95em}
.idx th,.idx td{padding:.65rem .8rem;border-bottom:1px solid #1c2433;text-align:left;vertical-align:top}
.idx thead th{font-size:.8em;font-weight:600;color:#8a93a6}
.idx .num{text-align:right;font-variant-numeric:tabular-nums}
.idx tbody th .small{display:block;font-weight:400;font-size:.8em;margin-top:.15rem}
`;
