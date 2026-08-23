// US macro primary records from free, keyless federal APIs: the CFTC's
// Commitments of Traders report (weekly futures positioning) and the Treasury's
// Fiscal Data service (debt, rates, auctions).
//
// Both are the primary record rather than someone's read of it, which is the
// only kind of data this service sells. Positioning is what commodity and rates
// desks actually reason from, and it is the honest slice of the "commodities
// and energy" gap: we can sell the disclosed record, not a live spot price.

export class MacroError extends Error {}

// A caller's mistake and an upstream failure both surface as a MacroError, but
// they need different HTTP statuses: a bad market name can never succeed on
// retry, so answering 5xx would have a buying agent retry it forever. Flagged
// errors map to 400 in the REST rail; everything else stays 5xx.
function badRequest(message) {
  const err = new MacroError(message);
  err.invalidParams = true;
  return err;
}

const UA = "SignalNodus/0.3 (hgenix@agentmail.to)";
const MAX_UPSTREAM_BYTES = 4_000_000;

const COT_ENDPOINT = "https://publicreporting.cftc.gov/resource/6dca-aqww.json";
const FISCAL_BASE = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Socrata and Fiscal Data both publish daily at most, so cache hard. Same
// shape as govdata.js: the cache API only stores GETs and both of these are
// GETs, so the request URL is the key.
async function cachedJson(url, ctx, ttl) {
  const cache = caches.default;
  const key = new Request(url, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit.json();

  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new MacroError(`upstream returned ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_UPSTREAM_BYTES) throw new MacroError("upstream response too large");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MacroError("upstream returned a non-JSON body");
  }
  ctx?.waitUntil?.(
    cache.put(
      key,
      new Response(text, {
        headers: { "cache-control": `public, max-age=${ttl}`, "content-type": "application/json" },
      }),
    ),
  );
  return parsed;
}

// ------------------------------------------------- CFTC Commitments of Traders

// A SoQL string literal escapes a quote by doubling it. Without this a market
// name containing an apostrophe would break the query, and a caller-supplied
// one could rewrite the WHERE clause.
function soqlLiteral(s) {
  return s.replace(/'/g, "''");
}

// The report separates traders into non-commercial (speculators) and
// commercial (hedgers). Net non-commercial position is the number desks watch,
// so compute it rather than making the buyer do the subtraction.
function shapeCotRow(r) {
  const ncLong = num(r.noncomm_positions_long_all);
  const ncShort = num(r.noncomm_positions_short_all);
  const cLong = num(r.comm_positions_long_all);
  const cShort = num(r.comm_positions_short_all);
  const oi = num(r.open_interest_all);
  const net = ncLong !== null && ncShort !== null ? ncLong - ncShort : null;

  return {
    market: r.market_and_exchange_names || null,
    reportDate: (r.report_date_as_yyyy_mm_dd || "").slice(0, 10) || null,
    openInterest: oi,
    nonCommercial: {
      long: ncLong,
      short: ncShort,
      spreading: num(r.noncomm_postions_spread_all),
      net,
      // Net as a share of open interest is how positioning is compared across
      // contracts of very different size.
      netPctOfOpenInterest: net !== null && oi ? Math.round((net / oi) * 1000) / 10 : null,
      changeInLong: num(r.change_in_noncomm_long_all),
      changeInShort: num(r.change_in_noncomm_short_all),
    },
    commercial: {
      long: cLong,
      short: cShort,
      net: cLong !== null && cShort !== null ? cLong - cShort : null,
      changeInLong: num(r.change_in_comm_long_all),
      changeInShort: num(r.change_in_comm_short_all),
    },
    changeInOpenInterest: num(r.change_in_open_interest_all),
    traders: { total: num(r.traders_tot_all) },
  };
}

export async function toolCftcPositioning(args, ctx) {
  const market = String(args.market || "").trim();
  if (market.length < 2 || market.length > 60) {
    throw badRequest(
      "market must be 2-60 characters matched against the CFTC contract name, e.g. CRUDE OIL, WHEAT, GOLD, COPPER, or S&P 500",
    );
  }
  const weeks = clampInt(args.weeks, 1, 26, 4);

  const where = `upper(market_and_exchange_names) like '%${soqlLiteral(market.toUpperCase())}%'`;
  const url =
    `${COT_ENDPOINT}?$limit=${weeks * 12}` +
    `&$order=report_date_as_yyyy_mm_dd DESC` +
    `&$where=${encodeURIComponent(where)}`;

  const rows = await cachedJson(url, ctx, 21_600);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw badRequest(
      `no CFTC contract name contains "${market}". Names are the report's own, e.g. "WHEAT-SRW - CHICAGO BOARD OF TRADE"; try a shorter fragment.`,
    );
  }

  // One market fragment can match several contracts (WTI trades on two
  // exchanges). Group by contract so a buyer never adds positions across
  // exchanges by accident.
  const byMarket = new Map();
  for (const r of rows) {
    const shaped = shapeCotRow(r);
    if (!shaped.market) continue;
    if (!byMarket.has(shaped.market)) byMarket.set(shaped.market, []);
    const series = byMarket.get(shaped.market);
    if (series.length < weeks) series.push(shaped);
  }

  const contracts = [...byMarket.entries()].map(([name, series]) => ({
    market: name,
    weeks: series.length,
    latest: series[0],
    history: series.slice(1),
  }));

  return {
    query: market,
    matchedContracts: contracts.length,
    latestReportDate: contracts[0]?.latest?.reportDate || null,
    contracts,
    source: "US CFTC Commitments of Traders, futures-only combined report",
    note:
      "Positions are as reported to the CFTC for the Tuesday of each week and published the following Friday, so the newest row is already several days old. Non-commercial is the speculative side and commercial is the hedging side; net is long minus short. Counts are contracts, not dollars, and this is the disclosed record with no forecast or interpretation attached.",
  };
}

// ------------------------------------------------------- Treasury Fiscal Data
//
// NOT REGISTERED, and deliberately so. Cloudflare Workers cannot complete a
// TLS handshake with api.fiscaldata.treasury.gov: every fetch from the Worker
// returns 525 or hangs until timeout, while the same URL answers in ~0.5s from
// a normal client. Verified 2026-08-23 by pointing our own x402_audit tool at
// the endpoint, which reported 525 unreachable. SEC EDGAR and USAspending.gov
// are reached from the same Worker without trouble, so this is specific to
// that host rather than to .gov origins.
//
// The code below is correct and stays here because re-registering it is a
// four-line change if Cloudflare ever routes that origin. Do not wire it into
// PRICING, ROUTES or the MCP catalog until a fetch from the deployed Worker
// actually succeeds; selling a route that always fails is worse than not
// listing it.

// Each dataset is a different endpoint with its own fields, so expose a small
// named set rather than letting a caller pass an arbitrary path: an open path
// parameter would make this an SSRF surface against treasury.gov.
const FISCAL_DATASETS = {
  avg_interest_rates: {
    path: "/v2/accounting/od/avg_interest_rates",
    sort: "-record_date",
    label: "Average interest rates on US Treasury securities, monthly",
  },
  debt_to_penny: {
    path: "/v2/accounting/od/debt_to_penny",
    sort: "-record_date",
    label: "Total public debt outstanding, daily",
  },
  auctions_query: {
    path: "/v1/accounting/od/auctions_query",
    sort: "-auction_date",
    label: "Treasury auction results by security",
  },
  exchange_rates: {
    path: "/v1/accounting/od/rates_of_exchange",
    sort: "-record_date",
    label: "Treasury reporting rates of exchange, quarterly",
  },
};

export async function toolTreasuryData(args, ctx) {
  const id = String(args.dataset || "").trim().toLowerCase();
  const ds = FISCAL_DATASETS[id];
  if (!ds) {
    throw badRequest(
      `unknown dataset "${args.dataset || ""}". Supported: ${Object.keys(FISCAL_DATASETS).join(", ")}`,
    );
  }
  const limit = clampInt(args.limit, 1, 100, 10);

  // Fiscal Data uses bracketed parameters and rejects them unencoded.
  const url =
    `${FISCAL_BASE}${ds.path}` +
    `?page%5Bsize%5D=${limit}&page%5Bnumber%5D=1&sort=${encodeURIComponent(ds.sort)}`;

  const body = await cachedJson(url, ctx, 21_600);
  const rows = Array.isArray(body?.data) ? body.data : [];
  if (rows.length === 0) throw new MacroError(`Treasury returned no rows for ${id}`);

  return {
    dataset: id,
    description: ds.label,
    returned: rows.length,
    totalAvailable: num(body?.meta?.["total-count"]),
    latestRecordDate: rows[0]?.record_date || rows[0]?.auction_date || null,
    rows,
    source: "US Treasury Fiscal Data (fiscaldata.treasury.gov), official published figures",
    note:
      "Rows are returned exactly as Treasury publishes them, newest first, with no derived or adjusted values. Field names and units are Treasury's own; amounts are US dollars unless the field name says otherwise.",
  };
}
