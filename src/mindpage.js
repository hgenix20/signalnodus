// The /mind page: genix mind, a personal AI operations assistant, compared honestly against three
// named alternatives. Arrives mostly from personal email, so the page leads with the comparison
// table rather than a pitch. Every competitor price cites where it was checked and when; a cell with
// no source is left out rather than guessed. The waitlist reuses the shared table in waitlist.js
// (see src/waitlist.js), told apart from the canary-kit list by the `what` value "genix-mind".
import { shell2 } from "./shell2.js";

const CHECKED = "as of September 2026";

const row = (feature, ...cells) => `<tr><td>${feature}</td>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
const src = (href) => `<a href="${href}" rel="noopener nofollow">source</a>`;

const MOTION_SRC = "https://www.usemotion.com/pricing";
const LINDY_SRC = "https://www.lindy.ai/pricing";
const SUPERHUMAN_SRC = "https://help.superhuman.com/hc/en-us/articles/38456109456147-Pricing-Plans";

const COMPARE_TABLE = `<div class="scroll"><table class="rec">
  <tr><th></th><th>genix mind</th><th>Motion</th><th>Lindy</th><th>Superhuman</th></tr>
  ${row(
    "Price",
    "$39/mo, planned price at launch",
    `$19/seat/mo, Pro AI individual plan (${src(MOTION_SRC)}, ${CHECKED})`,
    `$29.99&ndash;$199.99/mo per user (Plus/Pro/Max), no free plan (${src(LINDY_SRC)}, ${CHECKED})`,
    `$30/mo Starter, $40/mo Business (${src(SUPERHUMAN_SRC)}, ${CHECKED})`,
  )}
  ${row(
    "What that price covers",
    "The assistant only. It is planned to run on the ChatGPT Plus or Claude Pro plan you sign in with yourself, so most people already pay the other roughly $20/mo",
    `Its own AI is part of the $19 (${src(MOTION_SRC)})`,
    `Model use is metered by credits inside the price (${src(LINDY_SRC)})`,
    `Its own AI features are part of the price (${src(SUPERHUMAN_SRC)})`,
  )}
  ${row(
    "What it does",
    "Inbox triage, deadlines and follow-ups, memory across weeks, drafted replies, a weekly report",
    `Calendar and task scheduling (${src(MOTION_SRC)})`,
    `Agents you configure yourself for a job of your choosing (${src(LINDY_SRC)})`,
    `Email client with AI drafting, an "Ask AI" feature and triage, on the Business plan (${src(SUPERHUMAN_SRC)})`,
  )}
  ${row(
    "Free way to start",
    "Planned: a free self-hosted version. Not available yet, no public repo",
    "&mdash;",
    "&mdash;",
    "&mdash;",
  )}
</table></div>`;

export function mindPage() {
  const inner = `<main>
  <section class="chapter bt0" id="mind" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">for independent consultants, freelancers and fractional operators</span>
      <h1>An AI that runs your operations, on the plan you already pay for.</h1>
      <p class="lede">genix mind is a personal AI operations assistant. It runs all day on its own small server, using the ChatGPT Plus or Claude Pro subscription you already have, and asks before it sends anything or spends anything.</p>
      <p class="row"><a class="cta" href="#waitlist">Join the waitlist</a><a class="cta ghost" href="#compare">See how it compares</a></p>
      <p class="dim fs14">genix mind is an AI assistant, not a person. Joining the waitlist is not a purchase; nothing is charged, and no card is asked for.</p>
    </div>
  </div></section>

  <section class="chapter" id="what" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">what it does</span><h2>Five jobs, run every day, with a human still deciding.</h2></div>
    <div class="stack-l">
      <div class="stack"><h3>Triages your inbox</h3><p class="dim">Reads what came in and sorts it. It drafts replies for you to send; it does not send on its own.</p></div>
      <div class="stack"><h3>Tracks deadlines and follow-ups</h3><p class="dim">Notices what you committed to and what nobody answered, and keeps a list rather than letting it slide.</p></div>
      <div class="stack"><h3>Remembers context</h3><p class="dim">Holds what you told it across weeks, so you are not re-explaining the same client or project every time.</p></div>
      <div class="stack"><h3>Drafts replies and a weekly report</h3><p class="dim">Writes a first pass in your voice; you edit and send it, or don't.</p></div>
      <div class="stack"><h3>Asks before it sends or spends</h3><p class="dim">Anything that leaves your inbox, publishes anywhere, or costs money waits for your yes. That is a rule the assistant follows, not a setting you have to remember to turn on.</p></div>
    </div>
  </div></section>

  <section class="chapter" id="proof" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">one test, not a promise</span><h2>In a timed test on one real inbox, a weekly sweep took under a minute.</h2>
      <p class="dim mw44">By hand, the same sweep took 12 minutes. This was one test on one inbox, run once; it is not a guarantee of what your week looks like, and results will vary with how much mail you get and how it's organized today.</p>
    </div>
  </div></section>

  <section class="chapter" id="compare" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">how it's different</span><h2>Compared against Motion, Lindy and Superhuman.</h2>
      <p class="dim mw44">Priced on what each vendor's own page says, checked ${CHECKED}. Where a page didn't state a number or a feature plainly, that cell is left blank rather than guessed. This says nothing about how well any of these products work; it only says what they cost and what they're built to do.</p>
    </div>
    <div class="stack-l">${COMPARE_TABLE}
      <p class="dim fs14">Motion is a calendar and task app; Lindy is a general agent-building platform; Superhuman is an email client. genix mind is built specifically for the operations work around a solo practice: inbox, deadlines, memory and a weekly report, together, with the model cost left with you.</p>
    </div>
  </div></section>

  <section class="chapter" id="price" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">price, planned at launch</span><h2>$39 a month is the planned price at launch, on top of the plan you already have.</h2>
      <p class="dim mw44">Most people in this audience already pay around $20/mo for ChatGPT Plus or Claude Pro. genix mind is planned at $39/mo on top of that, hosted for you. A free, self-hosted version is also planned, for anyone willing to run it themselves once it exists; it does not exist yet and there is no public repo today. Nothing on this page is available for purchase or download now; the waitlist is the only thing you can actually do here.</p>
    </div>
  </div></section>

  <section class="chapter" id="waitlist" tabindex="-1"><div class="wrap">
    <div class="stack"><span class="eyebrow">not open yet</span><h2>Join the waitlist.</h2>
      <p class="dim mw44">genix mind is an AI assistant that Signal Nodus is building. Leave your email and we'll write when it's ready to try. This is a waitlist, not a purchase: nothing is charged, and no card is asked for.</p>
    </div>
    <form class="waitlist-form" data-mind-waitlist novalidate aria-label="Join the genix mind waitlist">
      <label for="mw-email">Email</label>
      <div class="row"><input id="mw-email" name="email" type="email" autocomplete="email" required placeholder="you@yourdomain.com"><button type="submit" class="cta">Join the waitlist</button></div>
      <div class="hp" aria-hidden="true"><label for="mw-website">Website</label><input id="mw-website" name="website" tabindex="-1" autocomplete="off"></div>
    </form>
    <p class="waitlist-msg dim fs14" data-mw-msg role="status">We'll only use this to write to you when genix mind is ready to try.</p>
  </div></section>
</main>
<script src="/mind.js" defer></script>`;
  return shell2("genix mind: an AI operations assistant on your own plan · Signal Nodus", inner, {
    current: "/mind",
    canonical: "https://signalnodus.ai/mind",
    description: "genix mind: a personal AI operations assistant that triages your inbox, tracks deadlines, remembers context and drafts a weekly report, on the ChatGPT Plus or Claude Pro plan you already have. Compared against Motion, Lindy and Superhuman.",
  });
}

export const MIND_JS = String.raw`
(function () {
  const form = document.querySelector("[data-mind-waitlist]");
  if (!form) return;
  const loaded = performance.now();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const msg = document.querySelector("[data-mw-msg]"), btn = form.querySelector("button"), email = form.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = "That doesn't look like an email address."; form.email.focus(); return; }
    btn.disabled = true; msg.textContent = "Sending...";
    const q = new URLSearchParams(location.search);
    fetch("/api/early-access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        what: "genix-mind",
        website: form.website.value,
        elapsed: Math.round(performance.now() - loaded),
        source: [q.get("utm_source"), q.get("utm_campaign")].filter(Boolean).join("/") || document.referrer.slice(0, 80),
      }),
    })
      .then((r) => r.json())
      .then((d) => { msg.textContent = d.message || d.error || "Thanks."; if (d.ok) { form.email.value = ""; btn.textContent = "You're on the list"; } else btn.disabled = false; })
      .catch(() => { msg.textContent = "That didn't go through. Please try again."; btn.disabled = false; });
  });
})();
`;
