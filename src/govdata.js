// US government spending and lobbying data from free, keyless federal APIs:
// USAspending.gov (federal contract awards) and the Senate LDA database
// (lobbying disclosures). Both are the primary record, not aggregations.
//
// These are the datasets whose repeat machine demand is proven elsewhere
// (Quiver sells them at ~660 calls per buyer); here they are priced per call
// with no key and no subscription, same as every other tool.

export class GovError extends Error {}

const UA = "SignalNodus/0.3 (hgenix@agentmail.to)";
const MAX_UPSTREAM_BYTES = 4_000_000;

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

// The cache API only stores GET requests, and the USAspending search endpoint
// is a POST, so cache entries key on a synthetic GET URL that encodes the
// query. TTLs are long because both datasets update daily at most.
async function cachedJson(cacheUrl, doFetch, ctx, ttl) {
  const cache = caches.default;
  const key = new Request(cacheUrl, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit.json();

  const res = await doFetch();
  if (!res.ok) throw new GovError(`upstream returned ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_UPSTREAM_BYTES) throw new GovError("upstream response too large");
  ctx?.waitUntil?.(
    cache.put(
      key,
      new Response(text, {
        headers: { "cache-control": `public, max-age=${ttl}`, "content-type": "application/json" },
      }),
    ),
  );
  return JSON.parse(text);
}

export async function toolGovernmentContracts(args, ctx) {
  const name = String(args.company || "").trim();
  if (name.length < 2 || name.length > 100) {
    throw new GovError("company must be a recipient name, 2-100 characters, e.g. Lockheed Martin");
  }
  const limit = clampInt(args.limit, 1, 25, 10);
  const days = clampInt(args.days, 30, 1825, 365);

  const end = new Date();
  const start = new Date(end.getTime() - days * 86400 * 1000);
  const day = (d) => d.toISOString().slice(0, 10);

  const body = {
    filters: {
      recipient_search_text: [name],
      award_type_codes: ["A", "B", "C", "D"],
      time_period: [{ start_date: day(start), end_date: day(end) }],
    },
    fields: [
      "Award ID",
      "Recipient Name",
      "Award Amount",
      "Start Date",
      "End Date",
      "Awarding Agency",
      "Awarding Sub Agency",
      "Description",
    ],
    sort: "Award Amount",
    order: "desc",
    page: 1,
    limit,
  };

  const cacheUrl =
    "https://signalnodus.ai/__cache/usaspending?" +
    new URLSearchParams({ name: name.toLowerCase(), days: String(days), limit: String(limit) });
  const data = await cachedJson(
    cacheUrl,
    () =>
      fetch("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": UA },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      }),
    ctx,
    3600,
  );

  const awards = (data?.results || []).map((r) => ({
    awardId: r["Award ID"] ?? null,
    recipient: r["Recipient Name"] ?? null,
    amountUsd: typeof r["Award Amount"] === "number" ? r["Award Amount"] : null,
    start: r["Start Date"] ?? null,
    end: r["End Date"] ?? null,
    agency: r["Awarding Agency"] ?? null,
    subAgency: r["Awarding Sub Agency"] ?? null,
    description: String(r["Description"] || "").slice(0, 300) || null,
  }));

  return {
    query: name,
    windowDays: days,
    returned: awards.length,
    awards,
    note:
      "US federal prime contract awards (types A-D) from USAspending.gov, largest first. The window " +
      "selects awards with obligation activity in it, so a long-running contract can predate the " +
      "window; start/end are the award's own period. Recipient matching is by name text and can " +
      "catch similarly named entities; check the recipient field.",
  };
}

export async function toolLobbying(args, ctx) {
  const name = String(args.company || "").trim();
  if (name.length < 2 || name.length > 100) {
    throw new GovError("company must be a client name, 2-100 characters, e.g. Apple");
  }
  const limit = clampInt(args.limit, 1, 25, 10);
  const year = args.year ? clampInt(args.year, 1999, 2100, null) : null;

  let url =
    `https://lda.senate.gov/api/v1/filings/?client_name=${encodeURIComponent(name)}` +
    `&page_size=${limit}&ordering=-dt_posted`;
  if (year) url += `&filing_year=${year}`;

  const data = await cachedJson(
    url,
    () => fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(20_000) }),
    ctx,
    3600,
  );

  const filings = (data?.results || []).slice(0, limit).map((f) => ({
    type: f?.filing_type_display ?? null,
    year: f?.filing_year ?? null,
    period: f?.filing_period_display ?? null,
    registrant: f?.registrant?.name ?? null,
    client: f?.client?.name ?? null,
    incomeUsd: f?.income != null ? Number(f.income) : null,
    expensesUsd: f?.expenses != null ? Number(f.expenses) : null,
    issues: (f?.lobbying_activities || []).slice(0, 5).map((a) => a?.general_issue_code_display).filter(Boolean),
    posted: f?.dt_posted ?? null,
    documentUrl: f?.filing_document_url ?? null,
  }));

  return {
    query: name,
    year: year || "all",
    totalFilings: data?.count ?? null,
    returned: filings.length,
    filings,
    note:
      "US Senate LDA lobbying disclosures matched by client name, newest first. income is what the " +
      "registrant billed the client; expenses is in-house spending reported by the client itself.",
  };
}
