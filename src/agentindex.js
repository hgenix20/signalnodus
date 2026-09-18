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

const AI_FAMILIES = new Set(["GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai", "Perplexity-User", "PerplexityBot", "Google AI crawler", "Bytespider", "CCBot", "Amazonbot", "Meta crawler", "DuckAssistBot", "cohere-ai", "Diffbot", "Applebot"]);

// The public page shows only these categories; which company a request claimed stays private.
export function category(family) {
  if (AI_FAMILIES.has(family)) return "Self-declared AI crawlers and assistants";
  if (family === "Googlebot" || family === "Bingbot") return "Search engine crawlers";
  if (family === "Claims to be a normal browser") return "Agents disguised as a person's browser";
  if (["Headless browser", "Python HTTP client", "curl", "Go HTTP client", "Node.js HTTP client"].includes(family)) return "Scripts and automated browsers";
  return "Other and unidentified";
}

// Counts for the public: agents caught (distinct network and user agent), hits, and hits by category.
export function publicSummary(hits) {
  const agents = new Set(), cats = new Map();
  let obeyed = 0, trapped = 0, first = null, last = null;
  for (const h of hits) {
    agents.add(`${h.asn || h.org || "?"}|${h.ua || ""}`);
    if (h.kind === "instruction") obeyed++; else trapped++;
    const c = category(uaFamily(h.ua).name);
    const r = cats.get(c) || { category: c, obeyed: 0, trapped: 0, agents: new Set() };
    if (h.kind === "instruction") r.obeyed++; else r.trapped++;
    r.agents.add(`${h.asn || h.org || "?"}|${h.ua || ""}`);
    cats.set(c, r);
    if (!first || h.ts < first) first = h.ts;
    if (!last || h.ts > last) last = h.ts;
  }
  return { agents_caught: agents.size, hits: hits.length, obeyed, trapped, first, last,
    by_category: [...cats.values()].map((r) => ({ category: r.category, agents: r.agents.size, obeyed: r.obeyed, trapped: r.trapped })).sort((a, b) => b.agents - a.agents) };
}

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

async function allHits(env) {
  if (!env?.BILLING) return [];
  try {
    const r = await env.BILLING.prepare("SELECT ts, kind, page, ua, asn, org, country, city FROM canary_hits ORDER BY id DESC LIMIT 5000").all();
    return r.results || [];
  } catch { return []; }
}

// Public: counts only.
export async function publicData(env) {
  return { updated: new Date().toISOString(), ...publicSummary(await allHits(env)) };
}

// Private (dashboard token): named rows and the recent raw hits.
export async function privateData(env) {
  const hits = await allHits(env);
  return { updated: new Date().toISOString(), ...publicSummary(hits), rows: buildIndex(hits), recent: hits.slice(0, 200) };
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function indexPage(d) {
  const cats = d.by_category.length
    ? d.by_category.map((r) => `<tr><th scope="row">${esc(r.category)}</th><td class="num">${r.agents}</td><td class="num">${r.obeyed}</td><td class="num">${r.trapped}</td></tr>`).join("")
    : `<tr><td colspan="4" class="dim">Nothing has taken the bait yet.</td></tr>`;
  const inner = `<main>
  <section class="chapter bt0" id="agent-index" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">live from the canaries on this site</span><h1>The Agent Obedience Index.</h1>
    <p class="dim mw44">Every page here carries a note that only software reads, asking it to fetch a URL, and a link no person can see that robots.txt forbids. A person never reaches either, so everything that does is an automated agent.</p></div>
    <div class="idx-stats"><div><b>${d.agents_caught}</b><span>agents caught</span></div><div><b>${d.obeyed}</b><span>obeyed a hidden instruction</span></div><div><b>${d.trapped}</b><span>followed a forbidden link</span></div></div>
    <div class="idx-wrap"><table class="idx"><thead><tr><th scope="col">What they claimed to be</th><th scope="col" class="num">Agents</th><th scope="col" class="num">Obeyed</th><th scope="col" class="num">Forbidden link</th></tr></thead><tbody>${cats}</tbody></table></div>
    <p class="dim mw44">An agent is one network and user agent pair. Categories come from what each request claimed; user agents can be forged, which is why we publish categories and not names. The named breakdown, by claimed agent and network, is available to customers and partners. ${d.first ? `Counting since ${esc(d.first.slice(0, 10))}.` : ""}</p>
    <p><a class="cta" href="/swarms#ea-h">Put the same canaries on your site</a></p>
  </div></section></main>`;
  return shell2("Agent Obedience Index · Signal Nodus", inner, { current: "/agents-index", canonical: "https://signalnodus.ai/agents-index", description: "How many AI agents obey hidden instructions and ignore robots.txt, counted live from canaries on signalnodus.ai." })
    .replace("</head>", '<link rel="stylesheet" href="/agents-index.css">\n</head>');
}

export const INDEX_CSS = `
.idx-stats{display:flex;flex-wrap:wrap;gap:1rem;margin:1.5rem 0}
.idx-stats div{flex:1 1 10rem;border:1px solid #2a3346;border-radius:10px;padding:1rem}
.idx-stats b{display:block;font-size:2.2rem;line-height:1.1;color:#f7768e;font-variant-numeric:tabular-nums}
.idx-stats span{font-size:.9em;color:#8a93a6}
.idx-wrap{overflow-x:auto;margin:1.5rem 0;border:1px solid #2a3346;border-radius:10px}
.idx{border-collapse:collapse;width:100%;min-width:40rem;font-size:.95em}
.idx th,.idx td{padding:.65rem .8rem;border-bottom:1px solid #1c2433;text-align:left;vertical-align:top}
.idx thead th{font-size:.8em;font-weight:600;color:#8a93a6}
.idx .num{text-align:right;font-variant-numeric:tabular-nums}
.idx tbody th .small{display:block;font-weight:400;font-size:.8em;margin-top:.15rem}
`;
