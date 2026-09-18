// First-party analytics that count people, not requests.
//
// A visit counts only when all of these hold:
//   - the page's script ran (so no plain crawlers), navigator.webdriver is not set, and the visitor
//     spent 5 seconds with the page visible and touched it (scroll, pointer, key), or 15 seconds visible;
//   - the beacon came from our own origin, from a browser user agent;
//   - the request did not come from a datacenter network (Cloudflare Workers, AWS, Google Cloud, Azure,
//     Hetzner and the like), which is where headless browsers and our own box live;
//   - the browser does not carry the owner cookie (set when Kameron signs into the dashboard, or by
//     visiting /nocount on any device) and the IP is not in OWNER_IPS.
// Filtered beacons are counted by reason so the number of rejected hits is visible too. No IP address is
// stored: a visitor is a daily-salted hash of IP and user agent, so the same person is one visitor per day
// and cannot be followed across days.

const BOT_UA = /bot|crawl|spider|slurp|preview|fetch|monitor|probe|curl|wget|python|node|go-http|java\/|okhttp|axios|headless|phantom|puppeteer|playwright|selenium|lighthouse|gptbot|claude|anthropic|openai|perplexity|bytespider|facebookexternalhit|twitterbot|linkedinbot|discordbot|slackbot|telegrambot|whatsapp/i;

// Hosting and cloud networks. Real readers sit on consumer and mobile networks.
export const DATACENTER_ASNS = new Set([
  13335, 209242, // Cloudflare (Workers egress; WARP users share it and are excluded too)
  16509, 14618, 8987, // Amazon
  15169, 396982, 19527, // Google, Google Cloud
  8075, 8068, // Microsoft, Azure
  24940, 213230, // Hetzner (our box)
  16276, // OVH
  14061, // DigitalOcean
  63949, // Linode / Akamai
  20473, // Vultr
  31898, // Oracle Cloud
  45102, 37963, // Alibaba
  132203, 45090, // Tencent
  51167, // Contabo
  12876, // Scaleway
  9009, // M247
  60068, // Datacamp / CDN77
  212238, // Datacamp
]);

export const OWNER_COOKIE = "sn_owner";

function cookie(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export function ownerCookieHeader() {
  return `${OWNER_COOKIE}=1; Path=/; Max-Age=34560000; Secure; SameSite=Lax`;
}

// Why a beacon does not count, or null when it does. Pure, so it is testable.
export function rejectReason({ ua, asn, origin, fetchSite, ownerCookie, ip, ownerIps, verifiedBot, botScore }) {
  if (ownerCookie === "1") return "owner";
  if (ip && ownerIps && ownerIps.includes(ip)) return "owner";
  const ours = origin ? /^https:\/\/(www\.)?signalnodus\.ai$/.test(origin) : fetchSite === "same-origin";
  if (!ours) return "origin";
  if (!ua || BOT_UA.test(ua) || !/Mozilla\//.test(ua)) return "bot_ua";
  if (verifiedBot) return "verified_bot";
  if (typeof botScore === "number" && botScore < 30) return "bot_score";
  if (asn && DATACENTER_ASNS.has(Number(asn))) return "datacenter";
  return null;
}

let ready = false;
async function ensureTables(env) {
  if (ready) return;
  await env.BILLING.batch([
    env.BILLING.prepare("CREATE TABLE IF NOT EXISTS visits (pv TEXT PRIMARY KEY, ts TEXT NOT NULL, day TEXT NOT NULL, vid TEXT NOT NULL, path TEXT NOT NULL, ref TEXT, utm_source TEXT, utm_campaign TEXT, country TEXT, mobile INTEGER, dwell_ms INTEGER)"),
    env.BILLING.prepare("CREATE TABLE IF NOT EXISTS visits_filtered (day TEXT NOT NULL, reason TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, reason))"),
  ]);
  ready = true;
}

async function sha(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, n);

function refHost(ref) {
  try { const h = new URL(ref).hostname.replace(/^www\./, ""); return h === "signalnodus.ai" ? null : h; } catch { return null; }
}

// POST /api/hit. Always answers 204 so the filter cannot be probed from outside.
export async function handleHit(request, env, ctx) {
  const done = new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  if (request.method !== "POST" || !env?.BILLING) return done;
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 2048) return done;
  let body;
  try { body = JSON.parse((await request.text()).slice(0, 2048)); } catch { return done; }
  if (!body || typeof body.pv !== "string" || !/^[a-z0-9-]{8,40}$/i.test(body.pv)) return done;
  const cf = request.cf || {};
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const work = (async () => {
    await ensureTables(env);
    if (typeof body.dwell === "number") {
      // The page is closing: record how long it was read. Only updates a visit that already counted.
      await env.BILLING.prepare("UPDATE visits SET dwell_ms = ? WHERE pv = ?").bind(Math.min(Math.round(body.dwell), 86400000), body.pv).run();
      return;
    }
    const ip = request.headers.get("cf-connecting-ip") || "";
    const reason = rejectReason({
      ua: request.headers.get("user-agent") || "",
      asn: cf.asn,
      origin: request.headers.get("origin"),
      fetchSite: request.headers.get("sec-fetch-site"),
      ownerCookie: cookie(request, OWNER_COOKIE),
      ip,
      ownerIps: (env.OWNER_IPS || "").split(",").map((s) => s.trim()).filter(Boolean),
      verifiedBot: cf.botManagement?.verifiedBot,
      botScore: cf.botManagement?.score,
    });
    if (reason) {
      await env.BILLING.prepare("INSERT INTO visits_filtered (day, reason, n) VALUES (?, ?, 1) ON CONFLICT(day, reason) DO UPDATE SET n = n + 1").bind(day, reason).run();
      return;
    }
    const vid = await sha(`${day}|${env.ANALYTICS_SALT || "signalnodus"}|${ip}|${request.headers.get("user-agent") || ""}`);
    await env.BILLING.prepare("INSERT OR IGNORE INTO visits (pv, ts, day, vid, path, ref, utm_source, utm_campaign, country, mobile, dwell_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)")
      .bind(body.pv, now.toISOString(), day, vid, clip(body.path, 80) || "/", refHost(body.ref), clip(body.utm_source, 40) || null, clip(body.utm_campaign, 60) || null, clip(cf.country, 4) || null, body.mobile ? 1 : 0)
      .run();
  })().catch(() => {});
  if (ctx?.waitUntil) ctx.waitUntil(work); else await work;
  return done;
}

// The numbers, for the dashboard and for the mind's box. Last `days` days.
export async function trafficSummary(env, days = 30) {
  await ensureTables(env);
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const q = (sql) => env.BILLING.prepare(sql).bind(since).all().then((r) => r.results || []);
  const [byDay, byPath, byRef, byUtm, byCountry, filtered, dwell] = await Promise.all([
    q("SELECT day, COUNT(DISTINCT vid) AS visitors, COUNT(*) AS views FROM visits WHERE day >= ? GROUP BY day ORDER BY day"),
    q("SELECT path, COUNT(DISTINCT vid) AS visitors, COUNT(*) AS views FROM visits WHERE day >= ? GROUP BY path ORDER BY visitors DESC LIMIT 20"),
    q("SELECT COALESCE(ref, '(direct)') AS ref, COUNT(DISTINCT vid) AS visitors FROM visits WHERE day >= ? GROUP BY ref ORDER BY visitors DESC LIMIT 20"),
    q("SELECT utm_source, utm_campaign, COUNT(DISTINCT vid) AS visitors FROM visits WHERE day >= ? AND utm_source IS NOT NULL GROUP BY utm_source, utm_campaign ORDER BY visitors DESC LIMIT 20"),
    q("SELECT COALESCE(country, '?') AS country, COUNT(DISTINCT vid) AS visitors FROM visits WHERE day >= ? GROUP BY country ORDER BY visitors DESC LIMIT 20"),
    q("SELECT reason, SUM(n) AS n FROM visits_filtered WHERE day >= ? GROUP BY reason ORDER BY n DESC"),
    q("SELECT dwell_ms FROM visits WHERE day >= ? AND dwell_ms IS NOT NULL ORDER BY dwell_ms"),
  ]);
  const visitors = await env.BILLING.prepare("SELECT COUNT(DISTINCT day || vid) AS v, COUNT(*) AS p FROM visits WHERE day >= ?").bind(since).first();
  const med = dwell.length ? dwell[Math.floor(dwell.length / 2)].dwell_ms : null;
  return {
    since, days,
    definition: "A visitor is one person per day: the page script ran, they spent 5s with it visible and interacted (or 15s visible), from a non-datacenter network, not the owner, not a bot user agent.",
    visitor_days: visitors?.v || 0, qualified_views: visitors?.p || 0, median_read_seconds: med == null ? null : Math.round(med / 1000),
    by_day: byDay, by_path: byPath, by_referrer: byRef, by_campaign: byUtm, by_country: byCountry, filtered,
  };
}

// GET /nocount: marks this browser as the owner's, so it never counts. Harmless if anyone else uses it.
export function noCountResponse() {
  return new Response("<!doctype html><meta charset=utf-8><meta name=robots content=noindex><title>Not counted</title><p>This browser is now excluded from Signal Nodus analytics. <a href=\"/\">Back to the site</a>.</p>", {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "set-cookie": ownerCookieHeader() },
  });
}

// Served as /a.js on every page in the second shell.
export const ANALYTICS_JS = String.raw`
(function () {
  try {
    if (navigator.webdriver || /(?:^|; )sn_owner=1/.test(document.cookie)) return;
    const pv = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^a-z0-9-]/gi, "").slice(0, 40);
    const q = new URLSearchParams(location.search);
    let shown = 0, since = document.visibilityState === "visible" ? performance.now() : null, touched = false, sent = false;
    const mark = () => { touched = true; };
    ["scroll", "pointerdown", "pointermove", "keydown", "touchstart", "wheel"].forEach(e => addEventListener(e, mark, { passive: true, once: true }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") since = performance.now();
      else if (since != null) { shown += performance.now() - since; since = null; }
    });
    const visible = () => shown + (since != null ? performance.now() - since : 0);
    const timer = setInterval(() => {
      const v = visible();
      if (sent || !((v >= 5000 && touched) || v >= 15000)) return;
      sent = true; clearInterval(timer);
      fetch("/api/hit", { method: "POST", keepalive: true, headers: { "content-type": "application/json" },
        body: JSON.stringify({ pv, path: location.pathname, ref: document.referrer, utm_source: q.get("utm_source"), utm_campaign: q.get("utm_campaign"), mobile: matchMedia("(pointer: coarse)").matches }) }).catch(() => {});
    }, 1000);
    addEventListener("pagehide", () => { if (sent) navigator.sendBeacon("/api/hit", new Blob([JSON.stringify({ pv, dwell: visible() })], { type: "application/json" })); });
  } catch (e) {}
})();
`;
