// Cross-catalog utilities: products that appear in MULTIPLE top-seller
// catalogs (Otto, x402stock, agentutility), which is the closest thing this
// market has to validated demand. Same rule as onchain.js: every upstream is
// keyless, so nothing here can spend the operator's money.

const UA = "SignalNodus/0.3 (hgenix@agentmail.to)";

class MarketError extends Error {}

async function getJson(url, ctx, ttl = 60, headers = {}) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(url);
  let res = cache ? await cache.match(key) : null;
  if (!res) {
    res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": UA, ...headers },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!res.ok) throw new MarketError(`upstream returned ${res.status}`);
    res = new Response(await res.text(), {
      headers: { "cache-control": `public, max-age=${ttl}`, "content-type": "application/json" },
    });
    if (cache) ctx?.waitUntil?.(cache.put(key, res.clone()));
  }
  return res.json();
}

// -------------------------------------------------------------------- fx

const FX_CCY = /^[A-Z]{3}$/;

export async function toolFxRate(args, ctx) {
  const from = String(args.from || "USD").toUpperCase();
  const to = String(args.to || "EUR").toUpperCase();
  const codes = to.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10);
  if (!FX_CCY.test(from) || !codes.every((c) => FX_CCY.test(c))) {
    throw new MarketError("from and to must be ISO 4217 codes, e.g. USD, EUR; to accepts a comma list");
  }
  // ECB reference rates via Frankfurter: daily fix, cached for an hour
  // because the upstream itself only changes once per business day.
  const d = await getJson(
    `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${codes.join(",")}`,
    ctx,
    3600,
  );
  return {
    base: d.base,
    date: d.date,
    rates: d.rates,
    source: "ECB reference rates (Frankfurter)",
    note: "Daily reference fix, not a live tradable quote.",
  };
}

// ----------------------------------------------------------------- domain

const HOST_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)+$/i;

export async function toolDomainReport(args, ctx) {
  const domain = String(args.domain || "").trim().toLowerCase();
  if (!HOST_RE.test(domain) || domain.length > 253) throw new MarketError("domain must be a bare hostname like example.com");

  const doh = (type) =>
    getJson(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`, ctx, 300, {
      accept: "application/dns-json",
    }).catch(() => null);

  const rdapReq = getJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`, ctx, 3600).catch(() => null);

  const [a, aaaa, mx, txt, ns, rdap] = await Promise.all([doh("A"), doh("AAAA"), doh("MX"), doh("TXT"), doh("NS"), rdapReq]);
  const answers = (r) => (r?.Answer || []).map((x) => x.data);

  let registered = null;
  let expires = null;
  let registrar = null;
  let statuses = null;
  if (rdap) {
    for (const e of rdap.events || []) {
      if (e.eventAction === "registration") registered = e.eventDate;
      if (e.eventAction === "expiration") expires = e.eventDate;
    }
    statuses = rdap.status || null;
    for (const ent of rdap.entities || []) {
      if ((ent.roles || []).includes("registrar")) {
        const fn = (ent.vcardArray?.[1] || []).find((v) => v[0] === "fn");
        if (fn) registrar = fn[3];
      }
    }
  }

  const txtRecords = answers(txt);
  const ageDays = registered ? Math.floor((Date.now() - Date.parse(registered)) / 86400000) : null;

  return {
    domain,
    resolves: answers(a).length > 0 || answers(aaaa).length > 0,
    a: answers(a),
    aaaa: answers(aaaa),
    nameservers: answers(ns),
    mx: answers(mx),
    hasSpf: txtRecords.some((t) => t.includes("v=spf1")),
    hasDmarc: false,
    registered,
    ageDays,
    expires,
    registrar,
    rdapStatus: statuses,
    note: "DNS via Cloudflare DoH; registration facts via RDAP, the registry's own record. DMARC requires a _dmarc lookup; see dmarc field on /v1/domain/report?dmarc=1.",
  };
}

// ------------------------------------------------------------- prediction

export async function toolPredictionMarkets(args, ctx) {
  const q = String(args.q || "").trim().slice(0, 120);
  const limit = Math.min(Math.max(parseInt(args.limit, 10) || 10, 1), 25);
  const base = "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100&order=volumeNum&ascending=false";
  const rows = await getJson(base, ctx, 120);
  const list = Array.isArray(rows) ? rows : [];
  const ql = q.toLowerCase();
  const picked = (q ? list.filter((m) => String(m.question || "").toLowerCase().includes(ql)) : list).slice(0, limit);

  return {
    query: q || null,
    returned: picked.length,
    markets: picked.map((m) => ({
      question: m.question,
      slug: m.slug,
      endDate: m.endDate,
      outcomes: safeParse(m.outcomes),
      outcomePrices: (safeParse(m.outcomePrices) || []).map(Number),
      volumeUsd: m.volumeNum != null ? Number(m.volumeNum) : null,
      liquidityUsd: m.liquidityNum != null ? Number(m.liquidityNum) : null,
    })),
    source: "Polymarket gamma API, top-volume active markets, cached 120s",
    note: "Prices are market-implied probabilities from a prediction market, not forecasts by this service.",
  };
}

function safeParse(x) {
  if (Array.isArray(x)) return x;
  try {
    return JSON.parse(x);
  } catch {
    return null;
  }
}
