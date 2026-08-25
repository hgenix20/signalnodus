# Golden-set evaluation

The published accuracy numbers at https://signalnodus.ai/eval come from this
directory. Everything here is reproducible against SEC EDGAR by anyone.

## What is measured

**Section boundaries.** For every case in `golden.json`, the harness fetches
the pinned filing straight from EDGAR, runs the same `src/filings.js` parser
the live service runs, and applies checks that do not trust the parser:

- the extracted section starts at the real `Item <n>` heading;
- the item's canonical title appears at the start of the section;
- the section does not carry the table-of-contents signature (a run of item
  headings near its start);
- the section does not run into the next item in the form's catalog;
- the section length falls inside a wide plausibility band;
- hand-verified anchor phrases for that specific filing appear (and
  known-out-of-section phrases do not).

Any single failed check fails the whole case. Amended filings (10-K/A) are
scored separately; they were selected by a parser-independent criterion (the
raw document names Item 1A and risk factors), so the parser cannot pre-select
the amendments it happens to pass.

**Diff precision and recall.** Ground truth for a text diff on real filings
does not exist, so it is constructed: a real extracted section is perturbed
with known edits (sentences removed, synthetic sentences inserted, and
cosmetic reformatting that must NOT register as change), and the diff's
reported changes are scored against the known edit set. Precision and recall
are exact because the edit set is known. The random generator is seeded, so
runs are reproducible.

## Run it

```bash
node eval/run.mjs            # fetches pinned accessions from EDGAR, caches locally
```

Results land in `eval/results.json`, which the deployed site bundles and
serves at `/eval` and `/eval.json`.

`node eval/build-golden.mjs` regenerates the candidate case list (it does NOT
overwrite `golden.json`; it writes `golden.candidate.json` plus a human review
file, and a human promotes cases).

## Reporting a bad case

Email hgenix@agentmail.to with the accession number and item. Confirmed
misparses are added to `golden.json` so they cannot regress.
