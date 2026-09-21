// The four pages in the revamped shell. Copy is kept from pages.js; the shell, type and chapters are new.
import { shell2 } from "./shell2.js";
import { SENTINELS } from "./watchdata.js";

function watchStats() {
  const s = SENTINELS.sentinels || [];
  const cities = new Set(s.flatMap((x) => (x.watches || []).map((w) => w.lat + "," + w.lon))).size;
  return { cities, sentinels: s.length, building: s.filter((x) => x.status === "building").length, live: s.filter((x) => x.status === "live").length };
}

const RECORD = `<pre class="record" aria-label="What the review delivers"><b>timeline</b>        every relevant action, in order, with its source
<b>action record</b>   expected · authorised by · outcome · mismatch, per action
<b>gap list</b>        where no expectation, no authority, or no outcome was recorded
<b>oversight map</b>   where a human could have overridden, and whether one did
<b>mapping</b>         each finding against the logging and human-oversight duties you are asked about
<b>board page</b>      one page, plain language, for the people who asked the question</pre>`;

const WATCH_BLOCK = `<pre class="record" aria-label="What the sentinels watch"><b>filings</b>         material cybersecurity incident disclosures, within days of filing
<b>breach notices</b>  state attorney-general and federal portals
<b>vendors</b>         incident posts from model providers and cloud platforms
<b>advisories</b>      security advisories naming agent frameworks and tool servers
<b>tripwires</b>       canary endpoints on assets we control, tripped only by bots</pre>`;

const CONTROLS = `<ul class="controls">
<li><div><h3>A locked vault</h3><p class="dim">Your logs land in an encrypted store outside the operator's own memory, under your contract, with a deletion date that is kept and logged.</p></div></li>
<li><div><h3>Tokens at the door</h3><p class="dim">Names, people, systems, hosts, identifiers and amounts become stable tokens before anything else touches the data. The mapping never leaves the vault.</p></div></li>
<li><div><h3>Code first</h3><p class="dim">The timeline and the action record are rebuilt by deterministic code. A model is consulted only on bounded, tokenised excerpts where judgment is needed, and every such call is marked in the pack.</p></div></li>
<li><div><h3>The reasoning system never opens the vault</h3><p class="dim">Code enforces this; it is not a promise.</p></div></li>
<li><div><h3>Model terms you approve in writing</h3><p class="dim">Commercial terms with no training on inputs; models outside the provider's extended-retention list; zero-retention workspaces where available. Which models and which terms, stated before the engagement.</p></div></li>
<li><div><h3>Your names are never spoken, sent or remembered</h3><p class="dim">They go on a never share list for the engagement and stay out of summaries, messages and the operator's own memory.</p></div></li>
<li><div><h3>A ledger of what left</h3><p class="dim">Every call carrying your data is logged: the tokenised text sent, the endpoint, the terms, the time. Delivered to you with the pack.</p></div></li>
<li><div><h3>Canaries before every engagement</h3><p class="dim">A fake dataset seeded with unique strings runs through the whole pipeline before your data does. One canary found anywhere fails the gate.</p></div></li>
</ul>`;

function statsHtml(cityLabel) {
  const t = watchStats();
  return `<div class="stats" aria-label="The Watch today"><div class="stat"><b>${t.cities}</b><span>${cityLabel}</span></div><div class="stat"><b>${t.sentinels}</b><span>sentinels</span></div><div class="stat"><b>${t.live}</b><span>live${t.building ? `, ${t.building} being built` : ""}</span></div></div>`;
}

function globeStage(withList) {
  return `<div class="globe-stage"><canvas data-globe role="img" aria-label="A globe with a dot at every place the sentinels watch. Drag or use the arrow keys to turn it; space pauses the spin."></canvas></div>
<div class="globe-controls"><span class="legend"><span class="live">live</span><span class="building">building</span><span class="planned">planned</span></span></div>
${withList ? '<ul data-sentinel-list aria-label="Sentinels"></ul>' : ""}`;
}

export function homePage2() {
  const inner = `
<main>
  <section class="hx" id="top" tabindex="-1"><div class="wrap">
    <div>
      <span class="eyebrow">For independent publishers on Cloudflare</span>
      <h1>Get your crawler controls checked, and configured.</h1>
      <p class="lede">A fixed-price service for independent publishers using Cloudflare. We review the request evidence your setup makes available, agree which automated traffic you want to allow or restrict, and implement a small set of approved changes. Practical configuration help, not another monitoring subscription.</p>
      <p class="row"><a class="cta" href="/qualify">Check whether your site qualifies</a><a class="cta ghost" href="/service">What you get for $350</a></p>
      <a class="proofpill" href="/agents-index">Our own site: 6 automated visitors caught by the canary in its first two days</a>
    </div>
    <div class="products">
      <a class="product canary" href="/service"><span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 3 6v6c0 5 3.8 9.4 9 10 5.2-.6 9-5 9-10V6z"/><path d="m9 12 2 2 4-4"/></svg></span><div><h3>Evidence review <span class="tag">What is known</span></h3><p>A concise account of observed crawler activity, including what cannot be reliably identified.</p></div></a>
      <a class="product sentinel" href="/service"><span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></span><div><h3>Approved changes <span class="tag">With rollback</span></h3><p>Supported Cloudflare settings adjusted to your publishing priorities, with a change log and rollback instructions.</p></div></a>
      <a class="product tripwire" href="/service"><span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span><div><h3>Follow-up check <span class="tag">Verified</span></h3><p>Tests of the agreed controls and your key visitor paths, with remaining limitations documented.</p></div></a>
    </div>
  </div></section>

  <section class="chapter" id="terms" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">The terms, in full</span><h2>$350 once. Fit confirmed before payment.</h2>
      <p class="dim mw44">One site, up to four hours of work, delivered within 14 calendar days after agreed access is available. No subscription. Full refund if we cannot complete the written, agreed scope; completed work does not guarantee elimination of scraping.</p>
      <p class="dim mw44"><strong>Eligibility:</strong> you control a publisher website on Cloudflare and can provide suitable evidence and narrowly scoped access. <strong>Not:</strong> comprehensive agent identification, legal evidence, emergency incident response, or a promise to stop every scraper.</p>
      <p class="dim mw44">An AI assistant helps with intake and preparation; a human solutions architect approves and performs the configuration work.</p>
    </div>
  </div></section>

  <section class="chapter" id="how" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">The free canary, the instrument we use ourselves</span><h2>Two lines that show you what automated visitors do on your pages.</h2><p class="dim mw44">Free, and optional. It is one piece of evidence for the review, not a comprehensive measure of agent traffic, and it is how we keep the record on our own site first. <a href="/canary">Put one on your site</a>.</p></div>
    <ol class="steps">
      <li><h3>Paste two lines</h3><p class="dim">A hidden note that asks an agent to fetch a URL, and a link robots.txt forbids. Readers never see either.</p></li>
      <li><h3>Requests consistent with automated discovery</h3><p class="dim">A fetch of the forbidden link means something automated read the page. A fetch of the URL named in the hidden note is stronger: something followed an instruction a person never saw. Your page reports the two apart.</p></li>
      <li><h3>You see what it claimed</h3><p class="dim">The user agent it presented, the network, the country, and whether it came through a VPN or a cloud range. A claimed identity is not a verified operator, and a cloud address is not proof of concealment; the page says so.</p></li>
    </ol>
  </div></section>

  <section class="chapter" id="proof" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">Proof</span><h2>We keep this record on ourselves first.</h2><p class="dim">There are no client logos or case studies here yet. What we can show is the method, applied every day to the system that does the work.</p></div>
    <div class="proof">
      <div class="item"><h3>Expectations before actions</h3><p class="dim">Every uncertain action is preceded by a written expectation and followed by the outcome. Misses stay on the record.</p></div>
      <div class="item"><h3>A human at every door</h3><p class="dim">Nothing is sent, published, bought or deployed without a named person's yes, and the yes is logged.</p></div>
      <div class="item"><h3>Evidence over self-report</h3><p class="dim">A device, a log line or a person confirms each result. The system's own report of success is not enough.</p></div>
      <div class="item"><h3>Nothing is deleted</h3><p class="dim">Old material moves to slower storage, so anyone can go back and check the work.</p></div>
    </div>
  </div></section>

  <section class="chapter" id="question" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">The question</span><h2>Three questions every agent deployment now gets asked.</h2></div>
    <div class="stack-l">
      <div class="stack"><h3>"What did it expect to happen?"</h3><p class="dim">Without a stated expectation an action can only be judged after the fact. The review recovers the expectation for every action it can and names the ones where none was recorded.</p></div>
      <div class="stack"><h3>"Who allowed it?"</h3><p class="dim">A policy, a named person, or nothing. The record shows which, action by action, with the hand-off where a human decided.</p></div>
      <div class="stack"><h3>"What happened, and where did it miss?"</h3><p class="dim">Outcomes sit beside expectations, and every mismatch stays in the record. Examiners trust a record that shows its misses.</p></div>
      <p class="dim">Security tools show what was blocked. The review shows why an allowed action was allowed, which is the question a board or an examiner asks.</p>
    </div>
  </div></section>

  <section class="chapter" id="record" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">The record</span><h2>The incident evidence review.</h2><p class="dim">Two to three weeks, one agent deployment. You provide the logs and two interviews. You get the record, its gaps, and a one-page summary written for the people who asked.</p><p><a class="cta ghost" href="/review">How the review works</a></p></div>
    <div class="stack-l">${RECORD}<p class="dim">Every finding cites the log line it came from, so nothing in the pack is an opinion without a source. Regulators ask for automatic, tamper-evident logs and for a person who can override or interrupt an agent. Insurers and boards ask the same in plainer words. The pack answers those requests in the form they take.</p></div>
  </div></section>

  <section class="chapter" id="watch" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">The watch</span><h2>Sentinels that notice incidents from the record, not the news.</h2><p class="dim">The sentinels read incident filings, breach notices, vendor disclosures, and security advisories that name the frameworks agents run on. A few are tripwires on our own servers that only an automated agent would follow. The globe above shows where each one is looking, and it fills in as more are built.</p><p><a class="cta ghost" href="/watch">Every sentinel, mapped</a> <a class="cta ghost" href="/swarms">The swarm watch</a></p></div>
    <div class="stack-l">${WATCH_BLOCK}<p class="dim">Every signal is treated as a claim until someone verifies it. The sentinels read public sources and our own servers only.</p></div>
  </div></section>

  <section class="chapter" id="trust" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">Trust</span><h2>Your logs never reach the system that does the reasoning.</h2><p class="dim">A review takes your agent's logs, which are proprietary. Raw data stays in a vault, the models see tokens in place of names, and every byte that leaves is logged and handed back to you with the pack.</p><p><a class="cta ghost" href="/trust">The eight controls</a></p></div>
    <div class="stack-l"><p class="dim">A person owns and runs this service. An AI system does the reconstruction under that person's control, with a kill switch, and keeps the same record of its own work.</p><p class="mt14"><a class="cta" href="mailto:hgenix@agentmail.to?subject=Incident%20evidence%20review">Request a review</a></p></div>
  </div></section>
</main>
<script src="/globe.js" defer></script>`;
  return shell2("Signal Nodus", inner, { current: "/", rail: [["world", "The world"], ["proof", "Proof"], ["question", "The question"], ["record", "The record"], ["watch", "The watch"], ["trust", "Trust"]],
    description: "Evidence of why an AI agent was allowed to act: expectation, authority, outcome, and every miss, reconstructed after an incident, and sentinels that watch the world for the next one." });
}

export function reviewPage2() {
  const inner = `<main>
  <section class="chapter bt0" id="review" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">the incident evidence review</span><h1>The record, its gaps, and one page for the people who asked.</h1><p class="lede">Two to three weeks for one agent deployment. You provide the logs and two interviews.</p></div>
    <div class="stack-l">${RECORD}
      <div class="stack"><h3>Week one</h3><p class="dim">Scoping call. Log export under the data terms on the <a href="/trust">trust page</a>. First interview: who the agent acts for, and who was supposed to be able to stop it.</p></div>
      <div class="stack"><h3>Week two</h3><p class="dim">Reconstruction. Code rebuilds the timeline and the action record from the logs. Where the record is ambiguous a person decides, and the pack marks each of those decisions.</p></div>
      <div class="stack"><h3>Week three</h3><p class="dim">Second interview to check the reconstruction against what people remember. Delivery. A walk-through with whoever has to present it.</p></div>
      <div class="stack"><h3>What this is not</h3><p class="dim">The review reports what the record shows and where it is silent. It is not legal advice or a security assessment, and it makes no judgment about materiality. Those decisions stay with your counsel and your board.</p></div>
      <div class="stack"><h3>After the review</h3><p class="dim">Most teams find the record should have been written as the agent ran. The same record keeping can run beside your agents from then on, so the next question already has its answer. Ask about it at the walk through.</p><p><a class="cta" href="mailto:hgenix@agentmail.to?subject=Incident%20evidence%20review">Request a review</a></p><p class="dim fs14">Email a few lines about the deployment and what was asked of it. A person replies within one business day.</p></div>
    </div>
  </div></section></main>`;
  return shell2("The incident evidence review · Signal Nodus", inner, { current: "/review", canonical: "https://signalnodus.ai/review", description: "A two-to-three-week reconstruction of an AI agent deployment's record after an incident: timeline, action record, gaps, oversight map, and a one-page board summary." });
}

export function watchPage2() {
  const inner = `<main>
  <section class="hero" id="world" tabindex="-1"><div class="wrap">
    <div class="thesis"><span class="eyebrow">Where the sentinels are looking</span><h1>The Watch.</h1><p class="dim mw44">Drag the world to turn it, or use the arrow keys. It turns on its own again five seconds after you let go.</p>${statsHtml("cities")}</div>
    <div>${globeStage(false)}</div>
  </div></section>
  <section class="chapter" id="sentinels" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">every sentinel, at the places it covers</span><h2>Drag the world to turn it. It spins on its own when you let go.</h2><p class="dim">Sentinels notice when an AI agent incident becomes public by reading the record rather than the news. The map shows the markets, jurisdictions and user populations each one covers, and it fills in as more are built.</p>${WATCH_BLOCK}</div>
    <div class="stack-l"><ul data-sentinel-list aria-label="Sentinels"></ul><p class="dim">We use it to know who to call and when. On request it is also an alert feed for insurers, counsel and compliance teams who need to know which firms in their book just had an agent incident, from primary sources and before the story runs.</p></div>
  </div></section></main>
<script src="/globe.js" defer></script>`;
  return shell2("The Watch · Signal Nodus", inner, { current: "/watch", canonical: "https://signalnodus.ai/watch", description: "Sentinels over filings, breach notices, vendor disclosures, advisories, and canary tripwires, mapped at the places they cover." });
}

export function trustPage2() {
  const inner = `<main>
  <section class="chapter bt0" id="trust" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">how your data is handled</span><h1>Raw data never reaches the system that does the reasoning.</h1><p class="lede">Eight controls, each one checkable.</p><p class="dim">The limits are stated too. A token pass that misses an identifier lets it through. Canaries catch systematic leaks and can miss a one off. Providers process tokenised text under their own terms. The contract comes first: data handling, deletion, and your written approval of the model terms.</p></div>
    <div class="stack-l">${CONTROLS}</div>
  </div></section></main>`;
  return shell2("How your data is handled · Signal Nodus", inner, { current: "/trust", canonical: "https://signalnodus.ai/trust", description: "Vault, tokens, code-first reconstruction, approved model terms, a never-share list, a ledger of every byte that left, and canaries before every engagement." });
}
