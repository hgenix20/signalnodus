// Pages for the re-aimed Signal Nodus: the incident evidence review, the Watch, and trust.
// Same shell, same classes, same palette as the rest of the site. No prices on any of them.
export function homePage(pageShell) {
  const inner = `
<main class="wrap">
  <section class="hero">
    <h1>When an AI agent acts on your behalf, can you prove why it was allowed to?</h1>
    <p class="lede">
      Signal Nodus reconstructs the record of an AI agent deployment after an incident, a board
      question, or an examiner's request: what the agent expected before it acted, who or what
      permitted the action, what happened, and every mismatch, kept unedited. Delivered as
      evidence a board, an insurer, or a regulator accepts.
    </p>
    <p class="sub">
      Built for compliance and legal leads at insurers, registered investment advisers, and banks
      with agents in production. Security tools prove the bad was blocked. This proves why the
      good was allowed.
    </p>
    <p class="sub">
      <a href="/review"><strong>The incident evidence review</strong></a> ·
      <a href="/watch"><strong>The Watch</strong></a> ·
      <a href="/trust"><strong>How your data is handled</strong></a>
    </p>
  </section>

  <section class="mt">
    <h2>Three questions every agent deployment now gets asked</h2>
    <p class="sub"><strong>"What did it expect to happen?"</strong> An agent that acts without a
    stated expectation cannot be audited, only blamed. The review recovers the expectation for
    every action it can, and names the ones where none existed.</p>
    <p class="sub"><strong>"Who allowed it?"</strong> A policy, a named person, or nothing. The
    record shows which, action by action, with the hand-off where a human decided.</p>
    <p class="sub"><strong>"What happened, and where did it miss?"</strong> Outcomes beside
    expectations; every mismatch kept, never smoothed over. A miss on the record is what an
    examiner trusts. A polished story is not.</p>
  </section>

  <section class="mt">
    <h2>The record is the product</h2>
    <p class="sub">
      Regulators now ask for automatic, tamper-evident logs and for humans who can override and
      interrupt an agent. Insurers and boards ask the same question in plainer words. The review
      produces that record in the shape those requests take, and leaves your team with the list of
      what the record should have captured all along.
    </p>
    <p class="sub">
      A human owns and runs this service; an AI system does the reconstruction under that owner's
      control and kill switch, on the same record-keeping it applies to itself.
      <a href="https://github.com/hgenix20/signalnodus">Source on GitHub</a>.
    </p>
  </section>

  <section class="mt">
    <h2>Talk to the operator</h2>
    <p class="sub">Write to <a href="mailto:hgenix@agentmail.to">hgenix@agentmail.to</a> with the
    deployment in one paragraph. A human reads it and replies.</p>
  </section>
</main>`;
  return pageShell("Signal Nodus", inner, {
    description: "Evidence of why an AI agent was allowed to act: expectation, authority, outcome, and every miss, reconstructed after an incident for compliance, legal, insurers, and regulators.",
  });
}

export function reviewPage(pageShell) {
  const inner = `
<main class="wrap">
  <section class="hero">
    <h1>The incident evidence review.</h1>
    <p class="lede">
      Two to three weeks, one agent deployment. You provide the logs and two interviews. You get
      the record, its gaps, and a one-page summary written for the people who asked.
    </p>
  </section>

  <section class="mt">
    <h2>What you receive</h2>
    <pre class="block">timeline          every relevant action, in order, with its source
action record     expected · authorised by · outcome · mismatch, per action
gap list          where no expectation, no authority, or no outcome was recorded
oversight map     where a human could have overridden, and whether one did
mapping           each finding against the logging and human-oversight duties you are asked about
board page        one page, plain language, for the people who asked the question</pre>
    <p class="sub">Every finding cites the log line it came from. Nothing in the pack is an
    opinion without a source.</p>
  </section>

  <section class="mt">
    <h2>How it runs</h2>
    <p class="sub"><strong>Week one.</strong> Scoping call. Log export under the data terms on the
    <a href="/trust">trust page</a>. First interview: who the agent acts for, and who was supposed
    to be able to stop it.</p>
    <p class="sub"><strong>Week two.</strong> Reconstruction. Code rebuilds the timeline and the
    action record from the logs; judgment is applied only where the record is ambiguous, and every
    such call is marked as one.</p>
    <p class="sub"><strong>Week three.</strong> Second interview to check the reconstruction
    against what people remember. Delivery. A walk-through with whoever has to present it.</p>
  </section>

  <section class="mt">
    <h2>What this is not</h2>
    <p class="sub">Not legal advice, not a security assessment, not a guardrail product, and no
    judgment about materiality: the review reports what the record shows and where it is silent.
    The decisions stay with your counsel and your board.</p>
  </section>

  <section class="mt">
    <h2>After the review</h2>
    <p class="sub">Most teams find the record should have been written continuously. The same
    record-keeping can run beside your agents from then on, so the next question has an answer
    before it is asked. Ask about it at the walk-through.</p>
    <p class="sub">Start with one paragraph to <a href="mailto:hgenix@agentmail.to">hgenix@agentmail.to</a>.</p>
  </section>
</main>`;
  return pageShell("The incident evidence review · Signal Nodus", inner, {
    canonical: "https://signalnodus.ai/review",
    description: "A two-to-three-week reconstruction of an AI agent deployment's record after an incident: timeline, action record, gaps, oversight map, and a one-page board summary.",
  });
}

export function watchPage(pageShell) {
  const inner = `
<main class="wrap">
  <section class="hero">
    <h1>The Watch.</h1>
    <p class="lede">
      Sentinels that notice when an AI agent incident becomes public, from the record rather than
      the news: material-incident filings, breach notices, vendor disclosures, advisories that name
      the frameworks agents run on, and tripwires of our own that only an automated agent would
      follow.
    </p>
  </section>

  <section class="mt">
    <h2>What it watches</h2>
    <pre class="block">filings        material cybersecurity incident disclosures, within days of filing
breach notices  state attorney-general and federal portals
vendors         incident posts from model providers and cloud platforms
advisories      security advisories naming agent frameworks and tool servers
tripwires       canary endpoints on assets we control, tripped only by bots</pre>
    <p class="sub">Every signal is a claim until it is verified; a verified signal carries its
    source, its date, and what it does and does not establish.</p>
  </section>

  <section class="mt">
    <h2>What it is for</h2>
    <p class="sub">First, for us: it is how we know who to call, and when. Second, on request, as
    an alert feed for insurers, counsel, and compliance teams who need to know which firms in
    their book just had an agent incident, from primary sources, before the story runs.</p>
    <p class="sub">Public sources and our own assets only. Nothing here probes anyone else's
    systems.</p>
  </section>
</main>`;
  return pageShell("The Watch · Signal Nodus", inner, {
    canonical: "https://signalnodus.ai/watch",
    description: "Sentinels over filings, breach notices, vendor disclosures, advisories, and canary tripwires that notice AI agent incidents from primary sources.",
  });
}

export function trustPage(pageShell) {
  const inner = `
<main class="wrap">
  <section class="hero">
    <h1>How your data is handled.</h1>
    <p class="lede">
      A review takes your agent's logs, which are proprietary. The design assumes nothing about
      trust and proves its own claim: raw data never reaches the operator's reasoning system, the
      models only ever see tokens, and every byte that leaves is logged and handed back to you.
    </p>
  </section>

  <section class="mt">
    <h2>The eight controls</h2>
    <p class="sub"><strong>A locked vault.</strong> Your logs land in an encrypted store outside
    the operator's own memory, under your contract, with a deletion date that is kept and logged.</p>
    <p class="sub"><strong>Tokens at the door.</strong> Names, people, systems, hosts, identifiers,
    and amounts are replaced by stable tokens before anything else touches the data. The mapping
    never leaves the vault.</p>
    <p class="sub"><strong>Code first.</strong> The timeline and the action record are rebuilt by
    deterministic code. A model is consulted only on bounded, tokenised excerpts where judgment is
    needed, and every such call is marked in the pack.</p>
    <p class="sub"><strong>The operator's reasoning system never opens the vault.</strong> That
    is enforced in code, not by promise.</p>
    <p class="sub"><strong>Model terms you approve in writing.</strong> Commercial terms with no
    training on inputs; models outside the provider's extended-retention list; zero-retention
    workspaces where available. Which models and which terms, stated before the engagement.</p>
    <p class="sub"><strong>Your names are never spoken, sent, or remembered.</strong> They are on
    a never-share list for the engagement: not in summaries, not in messages, not in the
    operator's own memory.</p>
    <p class="sub"><strong>A ledger of what left.</strong> Every call carrying your data is
    logged: the tokenised text sent, the endpoint, the terms, the time. That ledger is delivered
    to you with the pack.</p>
    <p class="sub"><strong>Canaries before every engagement.</strong> A fake dataset seeded with
    unique strings runs through the whole pipeline, and a single canary found anywhere fails the
    gate. The system does not get to say it is fine; the canary does.</p>
  </section>

  <section class="mt">
    <h2>Limits, stated plainly</h2>
    <p class="sub">Tokenisation that misses an identifier lets it through; canaries catch
    systematic leaks, not every one-off. Providers process tokenised text under their terms.
    None of this replaces the contract: data handling, deletion, and your written approval of the
    model terms come first.</p>
  </section>
</main>`;
  return pageShell("How your data is handled · Signal Nodus", inner, {
    canonical: "https://signalnodus.ai/trust",
    description: "Vault, tokens, code-first reconstruction, approved model terms, a never-share list, a ledger of every byte that left, and canaries before every engagement.",
  });
}
