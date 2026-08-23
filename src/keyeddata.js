// Federal datasets that need a free API key: EIA (energy), USDA NASS (crops)
// and Census (international trade). Keys are Worker secrets, registered to
// this service and never echoed back: an upstream failure is reported by
// status, never by repeating the URL we called.
//
// Each tool exposes a named allowlist rather than a caller-supplied path.
// These upstreams have large route spaces, and an open path parameter would
// let a caller aim our key at anything on the host.

export class KeyedError extends Error {}

const UA = "SignalNodus/0.3 (hgenix@agentmail.to)";
const MAX_UPSTREAM_BYTES = 4_000_000;

// A caller mistake and an upstream failure need different HTTP statuses: a bad
// HS chapter can never succeed on retry, so answering 5xx would have a buying
// agent retry forever. Flagged errors become 400 on the REST rail.
function badRequest(message) {
  const err = new KeyedError(message);
  err.invalidParams = true;
  return err;
}

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function requireKey(env, name, service) {
  const key = env?.[name];
  if (!key) {
    throw new KeyedError(
      `${service} is not configured on this deployment (missing ${name}); the operator must set it`,
    );
  }
  return key;
}

// The cache key must not contain the API key, or the secret would sit in the
// edge cache index. Callers pass a sanitised key URL alongside the real one.
async function cachedJson(realUrl, cacheKeyUrl, ctx, ttl) {
  const cache = caches.default;
  const key = new Request(cacheKeyUrl, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit.json();

  const res = await fetch(realUrl, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new KeyedError(`upstream returned ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_UPSTREAM_BYTES) throw new KeyedError("upstream response too large");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new KeyedError("upstream returned a non-JSON body");
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

// ------------------------------------------------------------- EIA energy

const EIA_SERIES = {
  electricity_price: {
    path: "electricity/retail-sales",
    facet: "price",
    frequency: "monthly",
    label: "Average retail electricity price in cents per kWh, by state and sector",
    filters: (a) => {
      const state = String(a.state || "").trim().toUpperCase();
      const sector = String(a.sector || "RES").trim().toUpperCase();
      if (state && !/^[A-Z]{2}$/.test(state)) throw badRequest("state must be a two-letter code, e.g. CA");
      if (!["RES", "COM", "IND", "TRA", "ALL"].includes(sector)) {
        throw badRequest("sector must be RES, COM, IND, TRA or ALL");
      }
      const out = [`facets%5Bsectorid%5D%5B%5D=${sector}`];
      if (state) out.push(`facets%5Bstateid%5D%5B%5D=${state}`);
      return out;
    },
  },
  fuel_price: {
    path: "petroleum/pri/gnd",
    facet: "value",
    frequency: "weekly",
    label: "Retail gasoline and diesel prices in dollars per gallon, by region",
    filters: () => [],
  },
  grid_demand: {
    path: "electricity/rto/region-data",
    facet: "value",
    frequency: "hourly",
    label: "Hourly electricity demand and day-ahead forecast by balancing authority",
    filters: (a) => {
      const region = String(a.region || "").trim().toUpperCase();
      if (region && !/^[A-Z0-9]{2,8}$/.test(region)) {
        throw badRequest("region must be a balancing-authority code, e.g. CISO, ERCO, PJM");
      }
      return region ? [`facets%5Brespondent%5D%5B%5D=${region}`] : [];
    },
  },
};

export async function toolEnergyData(args, ctx, env) {
  const key = requireKey(env, "EIA_API_KEY", "EIA energy data");
  const id = String(args.series || "").trim().toLowerCase();
  const s = EIA_SERIES[id];
  if (!s) {
    throw badRequest(
      `unknown series "${args.series || ""}". Supported: ${Object.keys(EIA_SERIES).join(", ")}`,
    );
  }
  const limit = clampInt(args.limit, 1, 100, 10);
  const filters = s.filters(args).map((p) => `&${p}`).join("");

  // EIA uses bracketed query parameters and rejects them unencoded.
  const tail =
    `&frequency=${s.frequency}&data%5B0%5D=${s.facet}` +
    `&sort%5B0%5D%5Bcolumn%5D=period&sort%5B0%5D%5Bdirection%5D=desc` +
    `&length=${limit}${filters}`;
  const base = `https://api.eia.gov/v2/${s.path}/data/?`;

  const body = await cachedJson(
    `${base}api_key=${encodeURIComponent(key)}${tail}`,
    `${base}cache=sn${tail}`,
    ctx,
    3600,
  );
  const rows = body?.response?.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw badRequest(`EIA returned no rows for series ${id} with those filters`);
  }

  return {
    series: id,
    description: s.label,
    frequency: s.frequency,
    returned: rows.length,
    totalAvailable: num(body?.response?.total),
    latestPeriod: rows[0]?.period || null,
    rows,
    source: "US Energy Information Administration open data API",
    note:
      "Values are as published by EIA, newest period first, with no adjustment or interpolation. Units travel in each row's own units field.",
  };
}

// --------------------------------------------------------- USDA NASS crops

const NASS_STATS = ["YIELD", "PRODUCTION", "AREA HARVESTED", "AREA PLANTED", "STOCKS", "PRICE RECEIVED"];

export async function toolCropData(args, ctx, env) {
  const key = requireKey(env, "NASS_API_KEY", "USDA NASS crop data");

  const commodity = String(args.commodity || "").trim().toUpperCase();
  if (!/^[A-Z ,&-]{2,40}$/.test(commodity)) {
    throw badRequest("commodity must be a NASS commodity name, e.g. CORN, SOYBEANS, WHEAT, CATTLE");
  }
  const stat = String(args.statistic || "YIELD").trim().toUpperCase();
  if (!NASS_STATS.includes(stat)) {
    throw badRequest(`statistic must be one of: ${NASS_STATS.join(", ")}`);
  }
  const year = String(args.year || "").trim();
  if (year && !/^(19|20)\d{2}$/.test(year)) throw badRequest("year must be a four-digit year");
  const state = String(args.state || "").trim().toUpperCase();
  if (state && !/^[A-Z]{2}$/.test(state)) throw badRequest("state must be a two-letter code, e.g. IA");

  const filters =
    `commodity_desc=${encodeURIComponent(commodity)}` +
    `&statisticcat_desc=${encodeURIComponent(stat)}` +
    `&agg_level_desc=${state ? "STATE" : "NATIONAL"}` +
    (year ? `&year=${year}` : "") +
    (state ? `&state_alpha=${state}` : "");
  const auth = `key=${encodeURIComponent(key)}&`;
  const counts = "https://quickstats.nass.usda.gov/api/get_counts/?";
  const data = "https://quickstats.nass.usda.gov/api/api_GET/?";

  // NASS refuses any query returning over 50,000 records, so ask the count
  // first and turn a too-broad query into advice rather than an upstream error.
  const countBody = await cachedJson(`${counts}${auth}${filters}`, `${counts}cache=sn&${filters}`, ctx, 21_600);
  const count = num(countBody?.count);
  if (count === 0) {
    throw badRequest(
      `NASS has no ${stat} records for ${commodity}${state ? ` in ${state}` : ""}${year ? ` in ${year}` : ""}`,
    );
  }
  if (count !== null && count > 50_000) {
    throw badRequest(
      `that query matches ${count} records and NASS caps a request at 50,000; narrow it with year or state`,
    );
  }

  const body = await cachedJson(
    `${data}${auth}${filters}&format=JSON`,
    `${data}cache=sn&${filters}&format=JSON`,
    ctx,
    21_600,
  );
  const all = Array.isArray(body?.data) ? body.data : [];
  const limit = clampInt(args.limit, 1, 100, 20);

  const rows = all.slice(0, limit).map((r) => ({
    commodity: r.commodity_desc,
    statistic: r.statisticcat_desc,
    description: r.short_desc,
    year: r.year,
    period: r.reference_period_desc,
    state: r.state_alpha || null,
    stateName: r.state_name || null,
    county: r.county_name || null,
    value: r.Value,
    unit: r.unit_desc,
    cvPercent: r["CV (%)"] || null,
  }));

  return {
    commodity,
    statistic: stat,
    year: year || "all available",
    state: state || "national",
    matchedRecords: count,
    returned: rows.length,
    rows,
    source: "USDA National Agricultural Statistics Service, Quick Stats",
    note:
      "Official NASS estimates exactly as published, including the suppression markers NASS uses when a value is withheld. cvPercent is NASS's own coefficient of variation where it publishes one.",
  };
}

// ------------------------------------------------------- Census trade flows

export async function toolTradeFlows(args, ctx, env) {
  const key = requireKey(env, "CENSUS_API_KEY", "Census trade data");

  const direction = String(args.direction || "exports").trim().toLowerCase();
  if (!["exports", "imports"].includes(direction)) {
    throw badRequest("direction must be exports or imports");
  }
  const hs = String(args.hs_code || "").trim();
  if (!/^\d{2}$/.test(hs)) {
    throw badRequest("hs_code must be a two-digit HS chapter, e.g. 87 for vehicles or 10 for cereals");
  }
  const year = String(args.year || "").trim();
  if (!/^(19|20)\d{2}$/.test(year)) throw badRequest("year must be a four-digit year, e.g. 2026");
  const month = String(args.month || "").trim().padStart(2, "0");
  if (!/^(0[1-9]|1[0-2])$/.test(month)) throw badRequest("month must be 01 through 12");

  // Field names differ by direction: exports use E_COMMODITY and total value,
  // imports use I_COMMODITY and general imports.
  const isExport = direction === "exports";
  const commField = isExport ? "E_COMMODITY" : "I_COMMODITY";
  const descField = isExport ? "E_COMMODITY_LDESC" : "I_COMMODITY_LDESC";
  const valueField = isExport ? "ALL_VAL_MO" : "GEN_VAL_MO";

  const base =
    `https://api.census.gov/data/timeseries/intltrade/${direction}/hs` +
    `?get=CTY_NAME,${valueField},${commField},${descField}` +
    `&YEAR=${year}&MONTH=${month}&COMM_LVL=HS2&${commField}=${hs}`;

  const table = await cachedJson(`${base}&key=${encodeURIComponent(key)}`, `${base}&cache=sn`, ctx, 21_600);
  if (!Array.isArray(table) || table.length < 2) {
    throw badRequest(`Census has no ${direction} data for HS chapter ${hs} in ${year}-${month}`);
  }

  const header = table[0];
  const at = (name) => header.indexOf(name);
  const rows = table.slice(1).map((r) => ({
    country: r[at("CTY_NAME")],
    valueUsd: num(r[at(valueField)]),
    hsChapter: r[at(commField)],
    hsDescription: r[at(descField)],
  }));

  return {
    direction,
    hsChapter: hs,
    hsDescription: rows[0]?.hsDescription || null,
    period: `${year}-${month}`,
    returned: rows.length,
    rows,
    source: "US Census Bureau international trade series",
    note:
      "Monthly customs-reported trade value in US dollars as published by Census. Exports are total value, imports are general imports. The row named TOTAL FOR ALL COUNTRIES is the aggregate rather than a country, so exclude it before ranking trading partners.",
  };
}
