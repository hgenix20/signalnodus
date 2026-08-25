// The golden-set harness behind https://signalnodus.ai/eval.
//
// Fetches every pinned accession straight from SEC EDGAR, runs the exact
// parser the live service runs (src/filings.js), and scores it with checks
// that do not trust the parser. See eval/README.md for the method.

import { readFile, writeFile } from "node:fs/promises";
import { fetchCached, mulberry32 } from "./lib.mjs";
import { htmlToText, extractItem, diffSections, itemCatalog, PARSER_VERSION } from "../src/filings.js";
import { SERVICE_VERSION } from "../src/version.js";

const GOLDEN = new URL("./golden.json", import.meta.url);
const RESULTS = new URL("./results.json", import.meta.url);

// ---------------------------------------------------------------- section checks

// Loose title regex from the catalog title's first two words, tolerant of
// apostrophe variants, arbitrary separators, and markup that splits a word
// mid-letter ("RIS K FACTORS" is real Microsoft output).
function titleRegex(form, item) {
  const entry = itemCatalog(form).find(([id]) => id === item);
  if (!entry) return null;
  const words = entry[1]
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .filter(Boolean)
    .map((w) => w.split("").join("[^A-Za-z0-9\\n]{0,3}"));
  return new RegExp(words.join("[^A-Za-z0-9\\n]{1,6}"), "i");
}

function headingRegex(item) {
  const esc = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*item\\s*${esc}\\b`, "i");
}

// Heading + adjacent title, so a prose cross-reference ("see Item 7A") does
// not trip the overrun check.
function nextItemRegex(form, item) {
  const catalog = itemCatalog(form);
  const idx = catalog.findIndex(([id]) => id === item);
  if (idx === -1 || idx + 1 >= catalog.length) return null;
  const [nid, ntitle] = catalog[idx + 1];
  const esc = nid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const words = ntitle.split(/\s+/).slice(0, 2).map((w) => w.replace(/[^A-Za-z]/g, ""));
  return new RegExp(`item\\s*${esc}\\b[\\s\\S]{0,80}?${words.filter(Boolean).join("\\W+")}`, "i");
}

const LENGTH_BANDS = { "1A": [2000, 600000], 7: [2000, 600000], 2: [2000, 600000] };

function checkCase(c, section) {
  // Some amended filings legitimately contain no body for the item (partial
  // amendments, exhibit-only filings). For those, "not found" is the correct
  // answer and returning any text at all is the failure.
  if (c.expect_absent) {
    return section ? "expected no section for this filing, but text was returned" : null;
  }
  if (!section) return "extraction returned null";

  if (!headingRegex(c.item).test(section)) return "does not start at the item heading";

  const trx = titleRegex(c.form, c.item);
  const head = section.slice(0, 250);
  const tm = trx ? trx.exec(head) : null;
  if (trx && !tm) return "item title not at the start of the section";
  // A closing quote or parenthesis right after the title is the signature of
  // a cross-reference capture ('described under "Item 1A. Risk Factors" ...'),
  // not a section heading.
  if (tm) {
    const after = head.slice(tm.index + tm[0].length).replace(/^[\s.]*/, "");
    if (/^[”"’')\]]/.test(after)) return "matched a cross-reference, not the section heading";
  }

  const tocHits = (section.slice(0, 3000).match(/^\s*item\s+\d{1,2}[A-C]?\b/gim) || []).length;
  if (tocHits >= 4) return "table-of-contents signature inside the section";

  // Overrun check: the next item's heading inside this section. Filing prose
  // cross-references items inline ("as well as Item 7A Quantitative and
  // Qualitative Disclosures..."), so a hit only counts when it sits at a line
  // start or right after sentence-ending punctuation, which is where a real
  // heading lives after HTML-to-text conversion.
  const nrx = nextItemRegex(c.form, c.item);
  if (nrx) {
    const body = section.slice(300);
    const g = new RegExp(nrx.source, "gi");
    let m2;
    while ((m2 = g.exec(body)) !== null) {
      const before = body.slice(Math.max(0, m2.index - 20), m2.index);
      if (/\n\s*$/.test(before) || /[.?!:]\s*$/.test(before)) return "section runs into the next item";
      if (m2.index === g.lastIndex) g.lastIndex++;
    }
  }

  // Per-case overrides beat the generic band: a smaller reporting company's
  // Item 1A can legitimately be one sentence, and that is hand-verified per
  // case rather than waved through globally.
  const band = LENGTH_BANDS[c.item] || [300, 600000];
  const min = c.min_chars ?? band[0];
  const max = c.max_chars ?? band[1];
  if (section.length < min) return `implausibly short (${section.length} chars)`;
  if (section.length > max) return `implausibly long (${section.length} chars)`;

  for (const phrase of c.anchors?.must_contain || []) {
    if (!section.toLowerCase().includes(phrase.toLowerCase())) return `missing anchor: "${phrase}"`;
  }
  for (const phrase of c.anchors?.must_not_contain || []) {
    if (section.toLowerCase().includes(phrase.toLowerCase())) return `contains excluded phrase: "${phrase}"`;
  }
  return null;
}

// ---------------------------------------------------------------- diff trials

// Mirrors the sentence segmentation in src/filings.js so constructed ground
// truth aligns exactly with the diff's units.
function toSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(])|\n{2,}/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 40);
}

function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
}

function dedupe(sentences) {
  const seen = new Set();
  const out = [];
  for (const s of sentences) {
    const n = norm(s);
    if (!seen.has(n)) {
      seen.add(n);
      out.push(s);
    }
  }
  return out;
}

function perturbationTrial(sentences, rng, caseId, trialNo) {
  const S = sentences.slice();
  const removeCount = Math.min(8, Math.floor(S.length / 6));
  const removed = [];
  for (let i = 0; i < removeCount; i++) {
    const idx = Math.floor(rng() * S.length);
    removed.push(S.splice(idx, 1)[0]);
  }
  const added = [];
  for (let i = 0; i < removeCount; i++) {
    const marker = `Evaluation marker sentence ${caseId}-${trialNo}-${i}: inserted by the harness to measure diff recall against known edits.`;
    added.push(marker);
    S.splice(Math.floor(rng() * (S.length + 1)), 0, marker);
  }

  const diff = diffSections(sentences.join("\n\n"), S.join("\n\n"), { maxItems: 500 });
  const expAdd = new Set(added.map(norm));
  const expRem = new Set(removed.map(norm));
  const repAdd = diff.added.map(norm);
  const repRem = diff.removed.map(norm);

  const tp = repAdd.filter((s) => expAdd.has(s)).length + repRem.filter((s) => expRem.has(s)).length;
  return {
    tp,
    reported: repAdd.length + repRem.length,
    expected: expAdd.size + expRem.size,
  };
}

// Cosmetic edits only: whitespace, comma spacing, and leading-word case, the
// reformatting real filings actually go through between years. The diff must
// report zero changes. (Edits that alter sentence tokenization itself, like
// inserting periods, are substantive by definition and are not tested here.)
function reformatTrial(sentences, rng) {
  const S = sentences.map((s) => {
    let t = s;
    if (rng() < 0.5) t = t.replace(/, /g, " ,  ");
    if (rng() < 0.5) t = t.replace(/ /g, (m) => (rng() < 0.3 ? "   " : m));
    if (rng() < 0.5) t = t.charAt(0).toLowerCase() + t.slice(1);
    return t;
  });
  const diff = diffSections(sentences.join("\n\n"), S.join("\n\n"), { maxItems: 500 });
  return diff.summary.added + diff.summary.removed;
}

// ------------------------------------------------------------------------ main

async function main() {
  const golden = JSON.parse(await readFile(GOLDEN, "utf8"));
  const cases = golden.cases;
  const failures = [];
  const sections = new Map();
  let passed = 0;
  const byAmended = { true: { cases: 0, passed: 0 }, false: { cases: 0, passed: 0 } };

  for (const c of cases) {
    let reason;
    try {
      const raw = await fetchCached(c.documentUrl);
      const text = htmlToText(raw);
      const section = extractItem(text, c.form, c.item);
      if (section) sections.set(c.id, section);
      reason = checkCase(c, section);
    } catch (err) {
      reason = `fetch/parse error: ${err.message}`;
    }
    const bucket = byAmended[String(Boolean(c.amended))];
    bucket.cases++;
    if (reason) {
      failures.push({ id: c.id, reason });
      console.error(`FAIL ${c.id}: ${reason}`);
    } else {
      passed++;
      bucket.passed++;
      console.error(`pass ${c.id}`);
    }
  }

  // Diff trials run on real extracted sections that passed, seeded for
  // reproducibility.
  const rng = mulberry32(20260825);
  let trials = 0;
  let tp = 0;
  let reported = 0;
  let expected = 0;
  let reformatFP = 0;
  const usable = cases.filter((c) => c.item === "1A" && sections.has(c.id)).slice(0, 15);
  for (const c of usable) {
    const S = dedupe(toSentences(sections.get(c.id)));
    if (S.length < 40) continue;
    for (let t = 0; t < 2; t++) {
      const r = perturbationTrial(S, rng, c.id, t);
      trials++;
      tp += r.tp;
      reported += r.reported;
      expected += r.expected;
    }
    reformatFP += reformatTrial(S, rng);
    trials++;
  }

  const results = {
    ran_at: new Date().toISOString().slice(0, 10),
    parser_version: PARSER_VERSION,
    service_version: SERVICE_VERSION,
    section_boundary: {
      cases: cases.length,
      passed,
      pass_rate: cases.length ? Number((passed / cases.length).toFixed(4)) : null,
      pass_rate_non_amended: byAmended.false.cases
        ? Number((byAmended.false.passed / byAmended.false.cases).toFixed(4))
        : null,
      pass_rate_amended: byAmended.true.cases
        ? Number((byAmended.true.passed / byAmended.true.cases).toFixed(4))
        : null,
      failures,
    },
    diff: {
      trials,
      precision: reported ? Number((tp / reported).toFixed(4)) : null,
      recall: expected ? Number((tp / expected).toFixed(4)) : null,
      reformat_false_positives: reformatFP,
    },
    method: "See eval/README.md. Reproduce with `node eval/run.mjs`.",
  };

  await writeFile(RESULTS, JSON.stringify(results, null, 2) + "\n");
  console.error(
    `\nsection: ${passed}/${cases.length} (amended ${byAmended.true.passed}/${byAmended.true.cases}) | ` +
      `diff p=${results.diff.precision} r=${results.diff.recall} reformatFP=${reformatFP}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
