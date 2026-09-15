// The four pages in the revamped shell. Copy is kept from pages.js; the shell, type and chapters are new.
import { shell2 } from "./shell2.js";

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
<li><div><h3>The operator's reasoning system never opens the vault</h3><p class="dim">Enforced in code, not by promise.</p></div></li>
<li><div><h3>Model terms you approve in writing</h3><p class="dim">Commercial terms with no training on inputs; models outside the provider's extended-retention list; zero-retention workspaces where available. Which models and which terms, stated before the engagement.</p></div></li>
<li><div><h3>Your names are never spoken, sent, or remembered</h3><p class="dim">On a never-share list for the engagement: not in summaries, not in messages, not in the operator's own memory.</p></div></li>
<li><div><h3>A ledger of what left</h3><p class="dim">Every call carrying your data is logged: the tokenised text sent, the endpoint, the terms, the time. Delivered to you with the pack.</p></div></li>
<li><div><h3>Canaries before every engagement</h3><p class="dim">A fake dataset seeded with unique strings runs through the whole pipeline; a single canary found anywhere fails the gate. The system does not get to say it is fine; the canary does.</p></div></li>
</ul>`;

function globeStage(withList) {
  return `<div class="globe-stage"><canvas id="globe" role="img" aria-label="A globe with a dot at every place the sentinels watch. Drag or use the arrow keys to turn it; space pauses the spin."></canvas></div>
<div class="globe-controls"><button type="button" id="globe-pause" aria-pressed="false" aria-controls="globe">Pause</button><span class="legend"><span class="live">live</span><span class="building">building</span><span class="planned">planned</span></span></div>
${withList ? '<ul id="sentinel-list" aria-label="Sentinels"></ul>' : ""}`;
}

export function homePage2() {
  const inner = `
<main>
  <section class="hero" id="world" tabindex="-1"><div class="wrap">
    <div class="thesis">
      <span class="eyebrow">Evidence for AI agent deployments</span>
      <h1>When an AI agent acts on your behalf, can you prove why it was allowed to?</h1>
      <p class="dim" style="max-width:48ch">Signal Nodus reconstructs the record of an agent deployment after an incident, a board question, or an examiner's request, and watches the world for the next one.</p>
      <p style="display:flex;gap:10px;flex-wrap:wrap"><a class="cta" href="/review">The incident evidence review</a><a class="cta ghost" href="/watch">See the Watch</a></p>
      <div class="stats" aria-label="The Watch today"><div class="stat"><b>71</b><span>cities watched</span></div><div class="stat"><b>15</b><span>sentinels</span></div><div class="stat"><b>5</b><span>being built</span></div></div>
    </div>
    <div>${globeStage(false)}</div>
  </div></section>

  <section class="chapter" id="proof" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">Proof</span><h2>We run the record on ourselves before we run it for you.</h2><p class="dim">No logos and no invented case studies. What we can show is the discipline itself, applied daily to the system that does the work.</p></div>
    <div class="proof">
      <div class="item"><h3>Expectations before actions</h3><p class="dim">Every uncertain action is preceded by a written expectation and followed by the outcome. Misses stay on the record.</p></div>
      <div class="item"><h3>A human at every door</h3><p class="dim">Nothing is sent, published, bought or deployed without a named person's yes, and the yes is logged.</p></div>
      <div class="item"><h3>Evidence over self-report</h3><p class="dim">The system's own "it worked" is never accepted; a device, a log line or a person confirms it.</p></div>
      <div class="item"><h3>Demotion, never deletion</h3><p class="dim">Old material moves to a colder shelf so anyone can go back and check the work.</p></div>
    </div>
  </div></section>

  <section class="chapter" id="question" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">The question</span><h2>Three questions every agent deployment now gets asked.</h2></div>
    <div class="stack-l">
      <div class="stack"><h3>"What did it expect to happen?"</h3><p class="dim">An agent that acts without a stated expectation cannot be audited, only blamed. The review recovers the expectation for every action it can, and names the ones where none existed.</p></div>
      <div class="stack"><h3>"Who allowed it?"</h3><p class="dim">A policy, a named person, or nothing. The record shows which, action by action, with the hand-off where a human decided.</p></div>
      <div class="stack"><h3>"What happened, and where did it miss?"</h3><p class="dim">Outcomes beside expectations; every mismatch kept, never smoothed over. A miss on the record is what an examiner trusts. A polished story is not.</p></div>
      <p class="dim">Security tools prove the bad was blocked. This proves why the good was allowed.</p>
    </div>
  </div></section>

  <section class="chapter" id="record" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">The record</span><h2>The incident evidence review.</h2><p class="dim">Two to three weeks, one agent deployment. You provide the logs and two interviews. You get the record, its gaps, and a one-page summary written for the people who asked.</p><p><a class="cta" href="/review">How the review runs</a></p></div>
    <div class="stack-l">${RECORD}<p class="dim">Every finding cites the log line it came from. Nothing in the pack is an opinion without a source. Regulators now ask for automatic, tamper-evident logs and for humans who can override and interrupt an agent; insurers and boards ask the same thing in plainer words. The pack is that record, in the shape those requests take.</p></div>
  </div></section>

  <section class="chapter" id="watch" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">The watch</span><h2>Sentinels that notice incidents from the record, not the news.</h2><p class="dim">Filings, breach notices, vendor disclosures, advisories naming the frameworks agents run on, and tripwires of our own that only an automated agent would follow. The globe above shows where they are looking; as more are built, more of the world is watched.</p><p><a class="cta" href="/watch">Every sentinel, mapped</a></p></div>
    <div class="stack-l">${WATCH_BLOCK}<p class="dim">Every signal is a claim until it is verified. Public sources and our own assets only; nothing here probes anyone else's systems.</p></div>
  </div></section>

  <section class="chapter" id="trust" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">Trust</span><h2>Your data never reaches the operator's reasoning system.</h2><p class="dim">A review takes your agent's logs, which are proprietary. The design assumes nothing about trust and proves its own claim: raw data stays in a vault, the models only ever see tokens, and every byte that leaves is logged and handed back to you.</p><p><a class="cta" href="/trust">The eight controls</a></p></div>
    <div class="stack-l"><p class="dim">A human owns and runs this service; an AI system does the reconstruction under that owner's control and kill switch, on the same record-keeping it applies to itself. Write to <a href="mailto:hgenix@agentmail.to">hgenix@agentmail.to</a> with the deployment in one paragraph; a human reads it and replies.</p></div>
  </div></section>
</main>
<script src="/globe.js" defer></script>`;
  return shell2("Signal Nodus", inner, { current: "/", rail: [["world", "The world"], ["proof", "Proof"], ["question", "The question"], ["record", "The record"], ["watch", "The watch"], ["trust", "Trust"]],
    description: "Evidence of why an AI agent was allowed to act: expectation, authority, outcome, and every miss, reconstructed after an incident, and sentinels that watch the world for the next one." });
}

export function reviewPage2() {
  const inner = `<main>
  <section class="chapter" id="review" tabindex="-1" style="border-top:0"><div class="wrap">
    <div class="stack"><span class="eyebrow">the incident evidence review</span><h1>The record, its gaps, and a page for the people who asked.</h1><p class="lede">Two to three weeks, one agent deployment. You provide the logs and two interviews.</p></div>
    <div class="stack-l">${RECORD}
      <div class="stack"><h3>Week one</h3><p class="dim">Scoping call. Log export under the data terms on the <a href="/trust">trust page</a>. First interview: who the agent acts for, and who was supposed to be able to stop it.</p></div>
      <div class="stack"><h3>Week two</h3><p class="dim">Reconstruction. Code rebuilds the timeline and the action record from the logs; judgment is applied only where the record is ambiguous, and every such call is marked as one.</p></div>
      <div class="stack"><h3>Week three</h3><p class="dim">Second interview to check the reconstruction against what people remember. Delivery. A walk-through with whoever has to present it.</p></div>
      <div class="stack"><h3>What this is not</h3><p class="dim">Not legal advice, not a security assessment, not a guardrail product, and no judgment about materiality: the review reports what the record shows and where it is silent. The decisions stay with your counsel and your board.</p></div>
      <div class="stack"><h3>After the review</h3><p class="dim">Most teams find the record should have been written continuously. The same record-keeping can run beside your agents from then on, so the next question has an answer before it is asked. Ask about it at the walk-through.</p><p><a class="cta" href="mailto:hgenix@agentmail.to">Start with one paragraph</a></p></div>
    </div>
  </div></section></main>`;
  return shell2("The incident evidence review · Signal Nodus", inner, { current: "/review", canonical: "https://signalnodus.ai/review", description: "A two-to-three-week reconstruction of an AI agent deployment's record after an incident: timeline, action record, gaps, oversight map, and a one-page board summary." });
}

export function watchPage2() {
  const inner = `<main>
  <section class="hero" id="world" tabindex="-1"><div class="wrap">
    <div class="thesis"><span class="eyebrow">Where the sentinels are looking</span><h1>The Watch.</h1><p class="dim" style="max-width:44ch">Drag the world to turn it, or use the arrow keys. It spins on its own when you let go; Pause stops it.</p><div class="stats" aria-label="The Watch today"><div class="stat"><b>71</b><span>cities</span></div><div class="stat"><b>15</b><span>sentinels</span></div><div class="stat"><b>5</b><span>being built</span></div></div></div>
    <div>${globeStage(false)}</div>
  </div></section>
  <section class="chapter" id="sentinels" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">every sentinel, at the places it covers</span><h2>Drag the world to turn it. It spins on its own when you let go.</h2><p class="dim">Sentinels notice when an AI agent incident becomes public, from the record rather than the news. The map shows the markets, jurisdictions and user populations each one covers. As more sentinels are built, more of the world is watched.</p>${WATCH_BLOCK}</div>
    <div class="stack-l"><ul id="sentinel-list" aria-label="Sentinels"></ul><p class="dim">First, for us: it is how we know who to call, and when. Second, on request, an alert feed for insurers, counsel, and compliance teams who need to know which firms in their book just had an agent incident, from primary sources, before the story runs. Public sources and our own assets only.</p></div>
  </div></section></main>
<script src="/globe.js" defer></script>`;
  return shell2("The Watch · Signal Nodus", inner, { current: "/watch", canonical: "https://signalnodus.ai/watch", description: "Sentinels over filings, breach notices, vendor disclosures, advisories, and canary tripwires, mapped at the places they cover." });
}

export function trustPage2() {
  const inner = `<main>
  <section class="chapter" id="trust" tabindex="-1" style="border-top:0"><div class="wrap">
    <div class="stack"><span class="eyebrow">how your data is handled</span><h1>Raw data never reaches the operator's reasoning system.</h1><p class="lede">The design assumes nothing about trust and proves its own claim.</p><p class="dim">Tokenisation that misses an identifier lets it through; canaries catch systematic leaks, not every one-off. Providers process tokenised text under their terms. None of this replaces the contract: data handling, deletion, and your written approval of the model terms come first.</p></div>
    <div class="stack-l">${CONTROLS}</div>
  </div></section></main>`;
  return shell2("How your data is handled · Signal Nodus", inner, { current: "/trust", canonical: "https://signalnodus.ai/trust", description: "Vault, tokens, code-first reconstruction, approved model terms, a never-share list, a ledger of every byte that left, and canaries before every engagement." });
}
