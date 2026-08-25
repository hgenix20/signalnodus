// Builds the candidate golden set. Writes golden.candidate.json and
// review.txt; a human reads the review file and promotes cases into
// golden.json. Inclusion criteria are parser-independent on purpose: a case
// enters the set because the raw document demonstrably contains the item,
// never because our parser happens to handle it.

import { mkdir, writeFile } from "node:fs/promises";
import { fetchCached, UA } from "./lib.mjs";
import { htmlToText, extractItem } from "../src/filings.js";

// Large, mid, and habitually messy filers across sectors. INTC is included
// deliberately: its 10-K layout is a known-hard case.
const TICKERS = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "WMT",
  "XOM", "PFE", "UNH", "KO", "DIS", "NFLX", "INTC", "IBM", "BA", "F", "T",
];

const OUT = new URL("./golden.candidate.json", import.meta.url);
const REVIEW = new URL("./review.txt", import.meta.url);

function pad(cik) {
  return String(cik).padStart(10, "0");
}

function docUrl(cik, accession, primaryDocument) {
  const bare = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${bare}/${primaryDocument}`;
}

async function submissions(cik) {
  return JSON.parse(await fetchCached(`https://data.sec.gov/submissions/CIK${pad(cik)}.json`));
}

function pickForms(sub, form, n) {
  const r = sub.filings?.recent || {};
  const out = [];
  for (let i = 0; i < (r.form || []).length && out.length < n; i++) {
    if (r.form[i] === form) {
      out.push({
        accession: r.accessionNumber[i],
        filingDate: r.filingDate[i],
        primaryDocument: r.primaryDocument[i],
      });
    }
  }
  return out;
}

async function main() {
  await mkdir(new URL("./.cache/", import.meta.url), { recursive: true });

  const tickerMapRaw = JSON.parse(await fetchCached("https://www.sec.gov/files/company_tickers.json"));
  const byTicker = new Map();
  for (const k of Object.keys(tickerMapRaw)) {
    byTicker.set(tickerMapRaw[k].ticker.toUpperCase(), {
      cik: pad(tickerMapRaw[k].cik_str),
      name: tickerMapRaw[k].title,
    });
  }

  const cases = [];
  const review = [];

  for (const t of TICKERS) {
    const co = byTicker.get(t);
    if (!co) {
      console.error(`no CIK for ${t}`);
      continue;
    }
    const sub = await submissions(co.cik);
    const tenKs = pickForms(sub, "10-K", 2);
    const tenQs = pickForms(sub, "10-Q", 1);

    if (tenKs[0]) {
      for (const item of ["1A", "7"]) {
        cases.push(caseFor(t, co, "10-K", tenKs[0], item, false));
      }
    }
    // The prior 10-K's 1A gives run.mjs a real diff pair per company.
    if (tenKs[1]) cases.push(caseFor(t, co, "10-K", tenKs[1], "1A", false));
    if (tenQs[0]) cases.push(caseFor(t, co, "10-Q", tenQs[0], "2", false));
    console.error(`${t}: ${tenKs.length} 10-K, ${tenQs.length} 10-Q`);
  }

  // Amended annual reports, sampled market-wide by full-text search. The
  // inclusion test below is parser-independent: the raw document must name
  // Item 1A and risk factors. Whether our parser then extracts it correctly
  // is exactly what the eval measures.
  const fts = JSON.parse(
    await fetchCached(
      'https://efts.sec.gov/LATEST/search-index?q=%22risk+factors%22&forms=10-K%2FA',
    ),
  );
  const hits = (fts?.hits?.hits || []).slice(0, 25);
  let amendedKept = 0;
  for (const h of hits) {
    if (amendedKept >= 12) break;
    const src = h?._source || {};
    const [adsh] = String(h?._id || "").split(":");
    const ciks = src.ciks || [];
    if (!adsh || !ciks.length) continue;
    const cik = pad(ciks[0]);
    let sub;
    try {
      sub = await submissions(cik);
    } catch {
      continue;
    }
    const r = sub.filings?.recent || {};
    const idx = (r.accessionNumber || []).indexOf(adsh);
    if (idx === -1 || r.form[idx] !== "10-K/A") continue;
    const filing = {
      accession: adsh,
      filingDate: r.filingDate[idx],
      primaryDocument: r.primaryDocument[idx],
    };
    // Parser-independent inclusion check on the RAW text.
    let raw;
    try {
      raw = await fetchCached(docUrl(cik, filing.accession, filing.primaryDocument));
    } catch {
      continue;
    }
    const text = htmlToText(raw);
    const mentions = (text.match(/item\s*1A/gi) || []).length;
    if (mentions < 2 || !/risk\s*factors/i.test(text)) continue;
    const co = { cik, name: sub.name || ciks[0] };
    cases.push(caseFor(sub.tickers?.[0] || cik, co, "10-K/A", filing, "1A", true));
    amendedKept++;
    console.error(`10-K/A kept: ${co.name} ${adsh}`);
  }

  // Extraction preview for the human review pass. This does NOT gate
  // inclusion; it exists so anchors can be hand-written per case.
  for (const c of cases) {
    try {
      const raw = await fetchCached(c.documentUrl);
      const text = htmlToText(raw);
      const section = extractItem(text, c.form, c.item);
      review.push(
        `== ${c.id}\n${c.company} ${c.form} ${c.accession} item ${c.item}\n` +
          (section
            ? `chars=${section.length}\nSTART| ${section.slice(0, 220).replace(/\n/g, " ")}\nEND  | ${section.slice(-220).replace(/\n/g, " ")}\n`
            : "EXTRACTION RETURNED NULL\n"),
      );
    } catch (err) {
      review.push(`== ${c.id}\nFETCH FAILED: ${err.message}\n`);
    }
  }

  await writeFile(OUT, JSON.stringify({ generated: new Date().toISOString(), cases }, null, 2));
  await writeFile(REVIEW, review.join("\n"));
  console.error(`${cases.length} candidate cases written`);
}

function caseFor(ticker, co, form, filing, item, amended) {
  return {
    id: `${String(ticker).toLowerCase()}-${filing.accession}-${item}`.replace(/[^a-z0-9-]/gi, ""),
    company: co.name,
    cik: co.cik,
    form,
    item,
    accession: filing.accession,
    filingDate: filing.filingDate,
    primaryDocument: filing.primaryDocument,
    documentUrl: docUrl(co.cik, filing.accession, filing.primaryDocument),
    amended,
    anchors: { must_contain: [], must_not_contain: [] },
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
