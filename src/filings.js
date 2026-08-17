// Filing section extraction and comparison.
//
// This is the part worth paying for. Raw EDGAR is free and anyone can fetch a
// filing; what nobody wants to do is turn a 3MB HTML blob into the one section
// they care about, and then diff it against last year's. That is the job the
// first real prospect described abandoning, and it is what the incumbents gate
// behind a monthly subscription.

// 10-K items. Order matters: boundaries are found by locating the next item.
const ITEMS_10K = [
  ["1", "Business"],
  ["1A", "Risk Factors"],
  ["1B", "Unresolved Staff Comments"],
  ["1C", "Cybersecurity"],
  ["2", "Properties"],
  ["3", "Legal Proceedings"],
  ["4", "Mine Safety Disclosures"],
  ["5", "Market for Registrant's Common Equity"],
  ["6", "Selected Financial Data"],
  ["7", "Management's Discussion and Analysis"],
  ["7A", "Quantitative and Qualitative Disclosures About Market Risk"],
  ["8", "Financial Statements and Supplementary Data"],
  ["9", "Changes in and Disagreements with Accountants"],
  ["9A", "Controls and Procedures"],
  ["9B", "Other Information"],
  ["10", "Directors, Executive Officers and Corporate Governance"],
  ["11", "Executive Compensation"],
  ["12", "Security Ownership"],
  ["13", "Certain Relationships and Related Transactions"],
  ["14", "Principal Accountant Fees and Services"],
  ["15", "Exhibits and Financial Statement Schedules"],
];

const ITEMS_10Q = [
  ["1", "Financial Statements"],
  ["2", "Management's Discussion and Analysis"],
  ["3", "Quantitative and Qualitative Disclosures About Market Risk"],
  ["4", "Controls and Procedures"],
  ["1A", "Risk Factors"],
  ["5", "Other Information"],
  ["6", "Exhibits"],
];

// A section this long is unambiguously the real thing rather than a contents
// entry. Below it we need the positional tie-breaker.
const SUBSTANTIAL_SECTION = 400;
// Short enough to be "Item 1B. Unresolved Staff Comments None." and no shorter.
const MIN_SECTION = 25;

export function itemCatalog(form) {
  const f = String(form || "").toUpperCase();
  if (f.startsWith("10-Q")) return ITEMS_10Q;
  return ITEMS_10K;
}

export function knownItem(form, item) {
  const want = String(item || "").toUpperCase().replace(/^ITEM\s*/i, "").trim();
  return itemCatalog(form).find(([id]) => id === want) || null;
}

// ------------------------------------------------------------ HTML to text

// Filings are HTML with heavy inline styling and tables. We want readable text
// with paragraph breaks preserved, because the item boundaries and the diff
// both depend on line structure.
export function htmlToText(html) {
  let s = html;

  // Drop anything that never carries filing prose.
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<ix:header\b[^>]*>[\s\S]*?<\/ix:header>/gi, " ");

  // Structural tags become newlines so paragraphs survive.
  s = s.replace(/<\/(p|div|tr|h[1-6]|li|table|section)\s*>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/t[dh]\s*>/gi, "\t");

  s = s.replace(/<[^>]+>/g, " ");

  s = decodeEntities(s);

  // Normalise whitespace but keep paragraph structure.
  s = s.replace(/\r/g, "");
  // Collapse runs of spaces without eating the tabs written above, which are
  // the only thing carrying table cell boundaries. The previous version of
  // this line had a tab inside the character class, so every cell separator
  // was inserted and then destroyed one line later, and a table arrived as an
  // undifferentiated run of words with no column boundaries at all.
  s = s.replace(/[^\S\n\t]+/g, " ");
  s = s.replace(/ ?\t[ \t]*/g, "\t");
  s = s.replace(/[ \t]*\n[ \t]*/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");

  return stripRunningHeaders(s).trim();
}

// Filings repeat a running header or footer on every printed page, and the
// renderer drops it into the middle of a sentence. It reads as noise on its
// own, but the real damage is in diffing: footers carry page numbers, page
// numbers move between years, and every one of them would then register as a
// substantive change.
const RUNNING_HEADER = [
  /^\s*\d{1,4}\s*$/, // a bare page number
  /\|\s*(19|20)\d\d\s+Form\s+10-[KQ]\s*\|/i, // "Apple Inc. | 2025 Form 10-K | 21"
  /^\s*Form\s+10-[KQ]\s*\|\s*\d+\s*$/i,
  /^\s*Table of Contents\s*$/i,
  /^\s*\(continued\)\s*$/i,
];

function stripRunningHeaders(text) {
  return text
    .split("\n")
    .filter((line) => {
      // Real prose is never a running header, so never risk cutting it.
      if (line.length > 120) return true;
      return !RUNNING_HEADER.some((re) => re.test(line));
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", hellip: "…", reg: "®",
  trade: "™", copy: "©", sect: "§",
};

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function safeChar(code) {
  if (!Number.isFinite(code) || code < 9 || code > 0x10ffff) return " ";
  try {
    return String.fromCodePoint(code);
  } catch {
    return " ";
  }
}

// ------------------------------------------------------- section extraction

// Builds a regex that matches an item heading such as "Item 1A." or
// "ITEM 1A - RISK FACTORS", tolerating the punctuation and spacing filings use.
function itemHeadingRegex(id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*item\\s*${escaped}\\s*[.:\\-\\u2013\\u2014)]?\\s*`, "im");
}

/**
 * Pulls one item out of a filing's text.
 *
 * Filings repeat item headings in the table of contents, so the first match is
 * usually not the section. We take the LAST heading occurrence that has
 * meaningful text after it, which skips the contents page without needing to
 * parse the contents page.
 */
export function extractItem(text, form, itemId) {
  const catalog = itemCatalog(form);
  const idx = catalog.findIndex(([id]) => id === itemId);
  if (idx === -1) return null;

  const starts = allMatches(text, itemHeadingRegex(itemId));
  if (starts.length === 0) return null;

  // Candidate ends: any later item heading in the catalog.
  const laterIds = catalog.slice(idx + 1).map(([id]) => id);

  const candidates = [];
  for (const start of starts) {
    let end = text.length;
    for (const laterId of laterIds) {
      const m = firstMatchFrom(text, itemHeadingRegex(laterId), start + 1);
      if (m !== -1 && m < end) end = m;
    }
    candidates.push({ start, body: text.slice(start, end).trim() });
  }
  if (candidates.length === 0) return null;

  const longest = candidates.reduce((a, b) => (b.body.length > a.body.length ? b : a));

  // Normally the real section is the longest match and the short ones are
  // contents-page entries. But some items are genuinely one line: Item 1B is
  // almost always "None." If every candidate is short, the contents entry and
  // the real section are both short, so take the last one, because the body of
  // a filing always follows its table of contents.
  if (longest.body.length >= SUBSTANTIAL_SECTION) return longest.body;

  const last = candidates[candidates.length - 1];
  return last.body.length >= MIN_SECTION ? last.body : null;
}

function allMatches(text, re) {
  const out = [];
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m;
  while ((m = g.exec(text)) !== null) {
    out.push(m.index);
    if (m.index === g.lastIndex) g.lastIndex++;
    if (out.length > 200) break;
  }
  return out;
}

function firstMatchFrom(text, re, from) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  g.lastIndex = from;
  const m = g.exec(text);
  return m ? m.index : -1;
}

// -------------------------------------------------------------------- diff

// Sentence-level comparison. Word diffs on a 60-page risk-factors section are
// unreadable and enormous; what a caller actually wants is "these paragraphs
// are new, these are gone".
export function diffSections(oldText, newText, { maxItems = 60 } = {}) {
  const a = toSentences(oldText);
  const b = toSentences(newText);

  const aSet = new Set(a.map(normalizeForCompare));
  const bSet = new Set(b.map(normalizeForCompare));

  const added = [];
  const removed = [];

  // Count every changed sentence. These loops used to stop at maxItems * 3,
  // capping added and removed at exactly 180 on heavily revised filings, and
  // unchanged and changeRatio were then derived from the truncated count. The
  // effect was silent and backwards: the more a company rewrote its risk
  // factors, the LOWER its reported change ratio, because every change past
  // the 180th was counted as unchanged. Four megacaps reporting exactly 180
  // added is what gave it away.
  //
  // Counting in full costs the Set lookup, which was already being paid. Only
  // the returned passages are limited, and `truncated` already says so.
  for (const s of b) {
    if (!aSet.has(normalizeForCompare(s))) added.push(s);
  }
  for (const s of a) {
    if (!bSet.has(normalizeForCompare(s))) removed.push(s);
  }

  const unchanged = b.length - added.length;
  return {
    summary: {
      sentencesBefore: a.length,
      sentencesAfter: b.length,
      added: added.length,
      removed: removed.length,
      unchanged: Math.max(0, unchanged),
      changeRatio: b.length ? Number((added.length / b.length).toFixed(3)) : 0,
    },
    added: added.slice(0, maxItems),
    removed: removed.slice(0, maxItems),
    truncated: added.length > maxItems || removed.length > maxItems,
  };
}

function toSentences(text) {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(])|\n{2,}/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 40);
}

// Compare on lowercased alphanumerics so reformatting, punctuation changes and
// re-flowed whitespace do not read as substantive edits.
function normalizeForCompare(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
}
