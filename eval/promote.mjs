// Promotes golden.candidate.json to golden.json, applying the hand-curated
// review pass: per-case length overrides where a short section is verified
// correct, and anchor phrases verified by reading the extraction previews
// against the source filings (eval/review.txt). This file IS the record of
// the human pass; regenerate candidates freely, then re-apply.

import { readFile, writeFile } from "node:fs/promises";

const CANDIDATE = new URL("./golden.candidate.json", import.meta.url);
const GOLDEN = new URL("./golden.json", import.meta.url);

// Keyed by case id. `min_chars` overrides mark hand-verified legitimately
// short sections (smaller reporting companies, cross-reference amendments).
// `must_not_contain` anchors force known-wrong extractions to fail honestly.
const REVIEW = {
  "aapl-0000320193-25-000079-1A": { must_contain: ["the following summarizes factors", "investor confidence and employee retention"] },
  "aapl-0000320193-25-000079-7": { must_contain: ["read in conjunction with the consolidated financial statements"] },
  "aapl-0000320193-24-000123-1A": { must_contain: ["whether currently known or unknown", "investor confidence and employee retention"] },
  "msft-0001193125-26-323660-1A": { must_contain: ["subject to various risks and uncertainties", "worker representatives"] },
  "msft-0001193125-26-323660-7": { must_contain: ["chief accounting officer"] },
  "msft-0000950170-25-100235-1A": { must_contain: ["subject to various risks and uncertainties", "worker representatives"] },
  "nvda-0001045810-26-000021-1A": { must_contain: ["should be considered in addition to the other information", "proxy contests"] },
  "nvda-0001045810-25-000023-1A": { must_contain: ["should be considered in addition to the other information", "proxy contests"] },
  "amzn-0001018724-26-000004-1A": { must_contain: ["investment in our securities risky", "without cause"] },
  "amzn-0001018724-25-000004-1A": { must_contain: ["investment in our securities risky", "without cause"] },
  "googl-0001652044-26-000018-1A": { must_contain: ["including but not limited to those described below", "corporate culture"] },
  "meta-0001628280-26-003942-1A": { must_contain: ["consider carefully the risks and uncertainties described below", "brought in delaware"] },
  "tsla-0001628280-26-003952-1A": { must_contain: ["carefully consider the risks described below", "willing to pay for our common stock"] },
  "jpm-0001628280-26-008131-1A": { must_contain: ["material risk factors that could affect"] },
  "wmt-0000104169-26-000055-1A": { must_contain: ["may or may not be able to accurately predict", "customer or shareholder support"] },
  "pfe-0000078003-26-000026-1A": { must_contain: ["material risks to our business", "privacy and other laws"] },
  "unh-0000731766-26-000062-1A": { must_contain: ["cautionary statements", "obtain sufficient funds from our subsidiaries"] },
  "ko-0001628280-26-010047-1A": { must_contain: ["carefully consider the following factors", "lower sales"] },
  "dis-0001744489-25-000155-1A": { must_contain: ["wide range of factors could materially affect future developments", "promulgated thereunder"] },
  "nflx-0001065280-26-000034-1A": { must_contain: ["trading price of our common stock could decline"] },
  "ibm-0000051143-26-000010-1A": { must_contain: ["downturn in economic environment", "liquidity or value of such securities"] },
  "ba-0001628280-26-004357-1A": { must_contain: ["investment in our securities involves risks", "accumulated and unpaid dividends"] },
  "f-0000037996-26-000015-1A": { must_contain: ["grouped into the following categories", "remunerating customers"] },
  "t-0000732717-26-000120-1A": { must_contain: ["cautionary language concerning forward-looking statements", "materially affect our future earnings"] },
  "0001572384-0001640334-23-000162-1A": { must_contain: ["risks related to doing business", "protecting your interests"] },
  // Hand-verified legitimately short items on amended/smaller filings.
  "0001431528-0000943440-09-000520-1A": { min_chars: 100, must_contain: ["not required to provide the information"] },
  "0000766701-0000950134-09-001138-1A": { min_chars: 400, must_contain: ["updated for page references"] },
  "0000766701-0000950134-09-000437-1A": { min_chars: 400, must_contain: ["updated for page references"] },
  "nage-0001654954-20-005725-1A": { min_chars: 1000, must_contain: ["supplementing the risk factors previously disclosed"] },
  "lnby-0001672572-18-000012-1A": { min_chars: 1000, must_contain: ["spot silver"] },
  "aaql-0001672571-18-000005-1A": { min_chars: 1000, must_contain: ["spot silver"] },
  "qdmi-0001213900-23-096057-1A": { min_chars: 1500, must_contain: ["summary of risk factors"] },
  // Amendments with no real item body (exhibit-only or partial amendments):
  // "not found" is the correct answer, any returned text is the failure.
  "wfcf-0001493152-22-009182-1A": { expect_absent: true },
  "sgrp-0000910680-06-000552-1A": { expect_absent: true },
};

const candidate = JSON.parse(await readFile(CANDIDATE, "utf8"));
let anchored = 0;
for (const c of candidate.cases) {
  const r = REVIEW[c.id];
  if (!r) continue;
  anchored++;
  if (r.min_chars) c.min_chars = r.min_chars;
  if (r.max_chars) c.max_chars = r.max_chars;
  if (r.expect_absent) c.expect_absent = true;
  c.anchors = {
    must_contain: r.must_contain || [],
    must_not_contain: r.must_not_contain || [],
  };
}

await writeFile(
  GOLDEN,
  JSON.stringify(
    {
      note: "Golden set for section-boundary accuracy. Generated by build-golden.mjs, curated by promote.mjs. See eval/README.md.",
      promoted: new Date().toISOString().slice(0, 10),
      cases: candidate.cases,
    },
    null,
    2,
  ) + "\n",
);
console.error(`${candidate.cases.length} cases promoted, ${anchored} with hand-curated anchors/overrides`);
