// SEO guide pages under /guides/. First one: how to block AI crawlers, aimed at people who search
// that phrase and land here instead of on the tool. Reuses the same crawler list and rule-generation
// logic as /log-checker (buildRules in logcheck.js) so the snippets never drift from what the checker
// itself would produce.
import { shell2 } from "./shell2.js";
import { AI_CRAWLERS } from "./aicrawlers.js";
import { buildRules } from "./logcheck.js";

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const TOKENS = AI_CRAWLERS.filter((c) => c.logs !== false).map((c) => c.token);
const ROBOTS_ONLY = AI_CRAWLERS.filter((c) => c.logs === false).map((c) => c.token);
const RULES = buildRules(TOKENS, ROBOTS_ONLY);

// One line per operator, built from the same table, so the attribution stays accurate if the
// list changes. Never a claim about behaviour, only who documents the token.
function operatorList() {
  const byOperator = new Map();
  for (const c of AI_CRAWLERS) {
    if (!byOperator.has(c.operator)) byOperator.set(c.operator, []);
    byOperator.get(c.operator).push(c.token);
  }
  return [...byOperator.entries()].map(([op, tokens]) => `${esc(op)} (${tokens.map(esc).join(", ")})`).join("; ");
}

export function guideBlockAICrawlersPage() {
  const inner = `<main>
  <section class="chapter bt0" id="guide" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">guide</span><h1>How to block AI crawlers on your own site</h1>
      <p class="lede">A number of AI companies run automated crawlers that fetch pages to train models, to answer search queries, or to fetch a page on a user's behalf. Each one announces itself with a User-Agent string, documented by its own operator. Below are copyable rules to block the announced list at your server, your CDN, or in robots.txt.</p>
      <p class="dim">Two things worth knowing before you use any of this. A User-Agent header is whatever the sender chose to send, so a rule matches what a request claimed to be, not who actually sent it; a rule here can be worked around by anything willing to lie about its identity. And robots.txt is a request, not a lock: a crawler that honours it stops, and nothing stops the rest. Want to see which of these, if any, actually reach your site before you block anything? Try the free <a href="/log-checker">log checker</a>.</p></div>
    <div class="stack-l">
      <h2>The list this covers</h2>
      <p class="dim">Tokens below are the announced crawler user agents, read from each operator's own documentation: ${operatorList()}. A user agent can be forged, so this says what a request claims to be, not who sent it. Source list and citations: <code>src/aicrawlers.js</code> in this site's repository.</p>

      <h2>nginx</h2>
      <p class="dim small">Inside the <code>server { }</code> block for your site. Reload nginx after adding it (<code>nginx -t</code>, then <code>nginx -s reload</code>). Matched requests get a 403.</p>
      <pre class="code" tabindex="0">${esc(RULES.nginx)}</pre>

      <h2>Apache</h2>
      <p class="dim small">In the virtual host, or in <code>.htaccess</code> when <code>AllowOverride</code> permits rewrites. Needs <code>mod_rewrite</code>. Matched requests get a 403.</p>
      <pre class="code" tabindex="0">${esc(RULES.apache)}</pre>

      <h2>Cloudflare (WAF rule)</h2>
      <p class="dim small">Security &rarr; WAF &rarr; Custom rules &rarr; Create rule &rarr; Edit expression: paste this and choose Block.</p>
      <pre class="code" tabindex="0">${esc(RULES.cloudflare)}</pre>

      <h2>robots.txt</h2>
      <p class="dim small">Put this at the root of your site as <code>/robots.txt</code>. It only asks; see the note above on which crawlers actually stop for it.</p>
      <pre class="code" tabindex="0">${esc(RULES.robots)}</pre>

      <h2>Check it worked</h2>
      <p class="dim">A rule you cannot verify is a guess. Paste your access log into the free <a href="/log-checker">log checker</a> to see which of these, if any, hit your site before and after you apply a rule; the log is read in your browser and never uploaded. If you would rather not do this yourself, Signal Nodus applies rules like these to your site and checks they hold for 350 USD: <a href="/service">the done-for-you service</a>.</p>
    </div>
  </div></section></main>`;
  return shell2("How to block AI crawlers on your own site · Signal Nodus", inner, {
    current: "/guides/block-ai-crawlers",
    canonical: "https://signalnodus.ai/guides/block-ai-crawlers",
    description: "Copyable rules to block announced AI crawlers (GPTBot, ClaudeBot, CCBot, PerplexityBot and others) in nginx, Apache, Cloudflare WAF and robots.txt, with notes on what a rule can and cannot guarantee.",
  });
}
