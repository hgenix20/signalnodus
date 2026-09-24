// Privacy, terms, and the gate, in the second shell. Every statement on the privacy page is
// backed by code in this repository (logPageView, logChallenge and logSettled in mpp.js, chargeKey
// and logUsage in billing.js, anonymizeIdentifiedRows on the daily cron, handleTrial, payments.js,
// oauth.js). Change the code and this page together.
import { shell2 } from "./shell2.js";

export const EFFECTIVE = "2026-09-17";
export const PRIVACY_EFFECTIVE = "2026-09-18";
const MAIL = '<a href="mailto:hgenix@agentmail.to">hgenix@agentmail.to</a>';
const GATE_RAW = "https://raw.githubusercontent.com/hgenix20/signalnodus/main/gate/agent-gate.mjs";
const GATE_SRC = "https://github.com/hgenix20/signalnodus/blob/main/gate/agent-gate.mjs";

const row = (a, b, c) => `<tr><td>${a}</td><td>${b}</td><td>${c}</td></tr>`;

export function privacyPage3() {
  const inner = `<main>
  <section class="chapter bt0" id="privacy" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">privacy</span><h1>What is recorded, where it goes, and how to have it removed.</h1>
      <p class="lede">Effective ${PRIVACY_EFFECTIVE}. Signal Nodus is a human-owned service with no separate legal entity. The operator answers at ${MAIL}.</p>
      <p class="dim">The site and its API run on Cloudflare Workers with a Cloudflare D1 database, so Cloudflare handles every request as the hosting provider under its own terms.</p></div>
    <div class="stack-l">
      <h2>By activity</h2>
      <div class="scroll"><table class="rec">
        <tr><th>When you</th><th>We record</th><th>Kept</th></tr>
        ${row("view a page on signalnodus.ai", "your IP address, the first 60 characters of your user agent, the path, and the time; obvious bots are skipped", "IP and user agent are erased after 90 days by a daily job; the row survives only as a count")}
        ${row("read pages on signalnodus.ai for a few seconds", "our visitor count: the page, the host of the site that linked you, any utm tags in the link, your country, whether you are on a touch screen, and how long you read. You are counted by a hash of your IP address and user agent salted with the day, so the same visit counts once and cannot be linked across days; the IP address itself is not stored. Nothing is recorded if the page script does not run, if you leave within a few seconds, or if you come from a hosting network", "as counts, with no IP address and no cookie identifier")}
    ${row("sign up for early access on the swarm page", "your email, the use you chose, where you came from, and the same daily visitor hash", "until you ask us to remove it; used only to write to you about the canary kit")}
    ${row("register a site for a free canary at /canary ", "your email, your domain, a public site id and a secret key for your private page, and the daily visitor hash", "while your canary is active, or until you ask us to delete it")}
    ${row("run an automated agent or crawler that requests one of our canary links, on our site or a customer's", "the user agent it sent, the network it came from (AS number and name), the city, country and approximate coordinates Cloudflare assigns, connection details (protocol, TLS version, Accept and Accept-Language headers, the Cloudflare location, round-trip time, and Cloudflare's bot score and connection fingerprint when present), the page, and the time. No IP address. A person browsing normally never reaches these links", "as the canary record. Public pages show only counts by category and country and never name a network or company; the site owner sees the hits on their own site in full")}
    ${row("sign in to the operator dashboard", "two cookies: one that keeps the operator signed in for 30 days, and one that stops that browser from being counted as a visitor. Visiting /nocount sets the second on any browser", "30 days and 400 days")}
    ${row("email us, including a request for a review", "your message, at our mail provider (AgentMail)", "until the matter is closed")}
        ${row("take part in an incident evidence review", "nothing under this page. An engagement runs under signed data terms, and the controls on <a href=\"/trust\">the trust page</a> apply: raw logs stay in a vault, names become tokens before anything else touches them, and every byte that leaves is logged and handed back with the pack", "as the signed terms say")}
        ${row("appear in a source the Watch reads", "the Watch reads public filings, notices and advisories, and our own servers. It keeps the public record it found and its source link. It does not look people up", "while the signal is open")}
        ${row("use the AI crawler log checker at <a href=\"/log-checker\">/log-checker</a>", "nothing. The log you paste or drop is read by a script in your browser and is never uploaded, stored or sent to us or anyone else; only the ordinary page view above is recorded", "nothing kept")}
        ${row("install the gate from <a href=\"/gate\">the gate page</a>", "nothing. It runs on your machine, writes its record to your disk, and sends nothing anywhere", "nothing kept")}
        ${row("call an API tool with a key (MCP or HTTP)", "a SHA-256 hash of the key (the key itself is never stored), the tool name, the price charged, the time, and the SEC accession numbers the answer was built from", "as the billing record for that key; the last 30 days are readable at <code>/v1/usage</code>")}
        ${row("call a priced route without a key", "your IP address, the first 80 characters of your user agent, the tool, the time, and the amount if a payment settled", "IP and user agent are erased after 90 days")}
        ${row("take a free test key at <code>/trial</code>", "a truncated SHA-256 hash of your IP address as the key's label, so one connection gets one key; the Turnstile check sends your IP and the challenge token to Cloudflare", "for the life of the key")}
        ${row("buy credit with a card", "Stripe collects the card details and the receipt email; we never see the card. We store the hash of the key that was minted, Stripe's event ids, and the pack bought", "abandoned checkouts are deleted after 72 hours; completed ones stay as the billing record")}
        ${row("pay per call over x402", "the settlement is a public transaction on the Base blockchain handled by Coinbase's facilitator; on our side it is logged like any unkeyed call", "as above; the blockchain record is permanent and outside our control")}
        ${row("connect through a client's OAuth flow (Claude.ai, Claude Desktop, Claude Code)", "you paste your key on our consent page; it is sealed into an authorization code that expires in five minutes and handed back to your client as the bearer token", "nothing kept")}
        ${row("reveal the contact address on <code>/compliance</code>", "only the Turnstile check with Cloudflare", "nothing kept")}
      </table></div>
      <h2>What leaves the service</h2>
      <p class="dim">The arguments you send to an API tool go to the source that holds the data: SEC EDGAR for the core tools, and for the experimental ones EIA, USDA NASS, the US Census Bureau, USAspending, the Senate lobbying disclosure database, the ECB, Polymarket, public EVM RPC endpoints, and DNS and RDAP servers. Those requests carry our identity in the User-Agent, never yours. Payment providers see what they need to take a payment. Cloudflare's error logs can include an IP address and user agent when a request fails, and Cloudflare keeps those briefly under its own policy.</p>
      <h2>What we do not do</h2>
      <p class="dim">No selling or sharing of data for anyone else's use. No advertising. No profiling. No cookies of our own; Cloudflare's Turnstile and bot protection may set theirs. An MCP client sends us only the arguments of the tool it calls, and we never receive your conversation.</p>
      <h2>Your requests</h2>
      <p class="dim">Email ${MAIL}. To find your records, give the key hash (the first characters of <code>sha256(key)</code>) or the IP address and approximate time. We send what we hold and delete it on request, except a billing row needed to settle an open payment dispute. A person replies within one business day.</p>
      <p class="dim fs14">See also <a href="/terms">the terms</a> and <a href="/trust">how engagement data is handled</a>.</p>
    </div>
  </div></section></main>`;
  return shell2("Privacy · Signal Nodus", inner, { current: "/privacy", canonical: "https://signalnodus.ai/privacy", description: "What Signal Nodus records when you use the site, the gate, the review and the API, how long it is kept, and how to have it removed." });
}

export function termsPage3() {
  const inner = `<main>
  <section class="chapter bt0" id="terms" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">terms</span><h1>The terms, in the order you are likely to need them.</h1>
      <p class="lede">Effective ${EFFECTIVE}. Signal Nodus is owned and run by a person, with no separate legal entity. Using the site, the gate or the review means you accept what is written here.</p></div>
    <div class="stack-l">
      <h2>1. The incident evidence review</h2>
      <p class="dim">A review is a professional engagement: one agent deployment, two to three weeks, the record, its gaps, and a one-page summary for the people who asked. It starts only with a signed statement of work and signed data terms, and those documents govern it: scope, price, confidentiality, and what happens to your logs (the controls are on <a href="/trust">the trust page</a>). Nothing on this site is an offer you accept by clicking, and an email asking for a review commits neither of us. The review reports what the record shows and where it is silent. It is not legal advice or a security assessment, and it makes no judgment about materiality; those decisions stay with your counsel and your board.</p>
      <h2>2. The gate</h2>
      <p class="dim">The gate is open source under the MIT licence and comes as it is. It is a pattern list over command text that stops a fixed set of destructive commands for a person to approve and keeps a local record. It reduces one kind of accident and does not replace least-privilege credentials, backups, or review. It sends nothing anywhere. You run it on your own machines at your own risk.</p>
      <h2>3. The Watch and the site</h2>
      <p class="dim">The Watch lists public sources and what they published. Every signal is a claim until someone verifies it, and nothing on the Watch is a statement that a named firm did anything wrong. The pages describe a method and a service; they are not legal advice.</p>
      <h2>4. Availability and changes</h2>
      <p class="dim">The site and the gate are run with care and without an uptime promise; <a href="/status">the status page</a> shows their state. These terms can change; a change is dated at the top of this page. A signed engagement keeps the terms it was signed under.</p>
      <h2>5. Liability</h2>
      <p class="dim">To the extent the law allows, the site, the gate and the Watch are provided as they are, without warranties, and the operator's total liability for them is limited to what you paid for them, which for the gate and the site is nothing. A signed engagement sets its own terms and this paragraph does not limit them.</p>
      <h2>6. The earlier API</h2>
      <p class="dim">An SEC filings API and MCP server from before this service still run for existing keys at the prices in <code>/api/pricing</code>. Its data is public SEC filings with their source, not investment advice; credit is prepaid and unused credit is refunded on request; keep to the rate limits and do not resell a key. It is not what this site is about, and it may be retired with notice on <a href="/status">the status page</a>.</p>
      <h2>7. Contact</h2>
      <p class="dim">${MAIL}. A person reads and replies within one business day. Privacy is covered at <a href="/privacy">/privacy</a>.</p>
    </div>
  </div></section></main>`;
  return shell2("Terms · Signal Nodus", inner, { current: "/terms", canonical: "https://signalnodus.ai/terms", description: "Terms for the incident evidence review, the open-source gate, the Watch, and the Signal Nodus site." });
}

const GATE_SETTINGS = `{
  "hooks": {
    "PreToolUse":  [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "node ~/.agent-gate/agent-gate.mjs" }] }],
    "PostToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "node ~/.agent-gate/agent-gate.mjs" }] }]
  }
}`;

const GATE_RULES = [
  ["prisma-data-loss", "<code>prisma db push --accept-data-loss</code>, <code>prisma migrate reset</code>"],
  ["drizzle-force", "<code>drizzle-kit push --force</code>"],
  ["db-reset", "<code>supabase db reset</code>, <code>rails db:drop</code>, <code>dropdb</code>"],
  ["sql-destroy", "<code>DROP TABLE</code>, <code>TRUNCATE</code>, a <code>DELETE FROM</code> with no <code>WHERE</code>"],
  ["terraform-destroy", "<code>terraform destroy</code>, <code>pulumi destroy</code>"],
  ["kubectl-delete", "deleting a namespace, a volume claim, or <code>--all</code>; <code>helm uninstall</code>"],
  ["cloud-delete", "<code>aws s3 rm --recursive</code>, <code>az group delete</code>, <code>gcloud … delete</code>"],
  ["docker-prune", "<code>docker system prune</code>, <code>docker compose down -v</code>"],
  ["git-force", "<code>git push --force</code> (<code>--force-with-lease</code> passes)"],
  ["git-discard", "<code>git reset --hard</code>, <code>git clean -f</code>"],
  ["disk-write", "<code>dd of=/dev/…</code>, <code>mkfs</code>"],
  ["rm-outside", "a recursive <code>rm</code> that leaves the working directory, takes <code>.git</code>, or names a variable the gate cannot resolve"],
].map(([id, what]) => `<tr><td><code>${id}</code></td><td>${what}</td></tr>`).join("");

export function gatePage3() {
  const inner = `<main>
  <section class="chapter bt0" id="gate" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">the gate · free and open source</span><h1>A door the agent cannot open by itself.</h1>
      <p class="lede">Coding agents have dropped production databases with a flag whose name says it destroys data. The gate stops that command at the shell, shows it to a person, and keeps a record of who let it through.</p>
      <p class="row"><a class="cta" href="${GATE_SRC}">Read the source</a><a class="cta ghost" href="#install">Install in two minutes</a></p>
      <p class="dim fs14">One file, no dependencies, no network calls, no model. MIT licence.</p></div>
    <div class="stack-l">
      <h2>What it does</h2>
      <p class="dim">It is a Claude Code hook on the Bash tool. Before a command runs, the gate matches it against a fixed list. A match is never run on the agent's own say: Claude Code asks you, with the reason, or refuses outright when you set <code>AGENT_GATE_MODE=deny</code>. Everything else passes untouched to the normal permission flow.</p>
      <p class="dim">Each match is written to <code>~/.agent-gate/record.jsonl</code>: the time, the session, the directory, the rule, the command, the decision, and, after the fact, whether it ran. That file answers the question a post-mortem starts with: what was attempted, and who allowed it.</p>
      <h2>What it gates</h2>
      <div class="scroll"><table class="rec"><tr><th>Rule</th><th>Stops for a person</th></tr>${GATE_RULES}</table></div>
      <p class="dim fs14">The three commands behind the public reports that prompted it are in the test suite: a forced <code>drizzle-kit push</code>, a Prisma push with <code>--accept-data-loss</code>, and a <code>terraform destroy</code>.</p>
      <h2 id="install" tabindex="-1">Install</h2>
      <pre class="code">mkdir -p ~/.agent-gate
curl -fsSL ${GATE_RAW} -o ~/.agent-gate/agent-gate.mjs</pre>
      <p class="dim">Read the file before you trust it; it is about 160 lines. Then add the hook to <code>~/.claude/settings.json</code> (or a project's <code>.claude/settings.json</code>). Node 18 or later.</p>
      <pre class="code">${GATE_SETTINGS.replace(/</g, "&lt;")}</pre>
      <h2>What it is not</h2>
      <p class="dim">It is a pattern list over the command text, not a sandbox. An agent that writes the same operation into a script and runs the script is not caught, and neither is a destructive call made through an SDK. Scoped credentials and tested backups remain the real defence. The gate covers the moment an agent reaches for the flag.</p>
      <h2>Running agents in a team?</h2>
      <p class="dim">We are looking for three teams to shape what comes next: one policy for every developer's agent, the record collected in one place, approvals that reach the right person, and hard spending caps per run and per day. If an agent has cost you data or money, a few lines about what happened is the most useful thing you can send. ${MAIL}</p>
    </div>
  </div></section></main>`;
  return shell2("The gate · Signal Nodus", inner, { current: "/gate", canonical: "https://signalnodus.ai/gate", description: "A free, open-source Claude Code hook that stops destructive commands for a person to approve and keeps a record of who allowed what." });
}
