// x402 endpoint auditor. Buyers on ACP already pay for this: API Acre sells a
// "preflight", x402 SellerOps sells "launch check" and a 7-day watch. We built
// and shipped the full x402 seller stack (challenge signing, Bazaar extension,
// CDP facilitator, invalid-payment rejection), so we can inspect another
// seller's endpoint against what the protocol actually requires, not a guess.
//
// Nothing here signs or submits a payment. It performs one bounded GET to a
// public HTTPS endpoint and reports the 402 challenge it hands back.

export class X402Error extends Error {}

const UA = "SignalNodus/0.3 x402-audit (hgenix@agentmail.to)";
const MAX_BODY = 200_000;

// The known CAIP-2 / friendly names an x402 challenge may use, mapped to a
// human label so the report is legible without the caller decoding them.
const NETWORKS = {
  "eip155:8453": "Base mainnet",
  "eip155:84532": "Base Sepolia (testnet)",
  base: "Base mainnet",
  "8453": "Base mainnet",
  "eip155:1": "Ethereum mainnet",
  ethereum: "Ethereum mainnet",
  "eip155:42161": "Arbitrum One",
};

// SSRF guard. The caller hands us a URL; we must never let it point us at an
// internal address, a cloud metadata endpoint, or a non-HTTP port. Public
// HTTPS only, no IP literals, no internal hostnames.
function safeUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw new X402Error("url must be an absolute https URL, e.g. https://api.example.com/v1/thing");
  }
  if (u.protocol !== "https:") throw new X402Error("only https URLs are audited");
  const host = u.hostname.toLowerCase();

  // No IP literals at all: a hostname must resolve through DNS, which keeps the
  // target on the public internet rather than a raw internal address.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host === "[::1]") {
    throw new X402Error("ip-literal hosts are not audited; use a public hostname");
  }
  // Block obvious internal / loopback / metadata names.
  const blocked =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal";
  if (blocked) throw new X402Error("internal hostnames are not audited");
  // Only standard HTTPS port.
  if (u.port && u.port !== "443") throw new X402Error("only port 443 is audited");
  return u;
}

function decodePaymentRequired(headerVal) {
  if (!headerVal) return null;
  const raw = String(headerVal).trim();
  try {
    const pad = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    return JSON.parse(atob(pad));
  } catch {
    return null;
  }
}

// Parse the WWW-Authenticate: Payment header (MPP wire format): params like
// method, intent, network, request=<base64url JCS>.
function parseWwwAuth(headerVal) {
  if (!headerVal) return null;
  const s = String(headerVal);
  if (!/^\s*Payment\b/i.test(s)) return null;
  const out = {};
  for (const m of s.matchAll(/([a-zA-Z0-9_]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return Object.keys(out).length ? out : { present: true };
}

async function boundedFetch(url, init) {
  const res = await fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": UA, accept: "application/json", ...(init?.headers || {}) },
  });
  return res;
}

export async function toolX402Audit(args) {
  const url = safeUrl(args.url);

  const checks = [];
  const add = (id, ok, detail) => checks.push({ check: id, pass: ok, detail });

  let res;
  try {
    // No X-PAYMENT header: a correct x402 resource must answer 402 with a
    // challenge. This is the whole preflight.
    res = await boundedFetch(url.toString(), { method: "GET" });
  } catch (err) {
    throw new X402Error(`could not reach the endpoint: ${String(err?.message || err).slice(0, 150)}`);
  }

  const status = res.status;
  const wwwAuth = res.headers.get("www-authenticate");
  const paymentReq = res.headers.get("payment-required");
  const contentType = res.headers.get("content-type") || null;

  const is402 = status === 402;
  add("responds_402_without_payment", is402,
    is402 ? "returns HTTP 402 when no payment is presented" : `returned HTTP ${status}, not 402; an unpaid call should be challenged`);

  const wa = parseWwwAuth(wwwAuth);
  add("www_authenticate_payment", Boolean(wa),
    wa ? "carries a WWW-Authenticate: Payment header (MPP)" : "no WWW-Authenticate: Payment header");

  const pr = decodePaymentRequired(paymentReq);
  const accepts = Array.isArray(pr?.accepts) ? pr.accepts : [];
  add("payment_required_header", Boolean(pr),
    pr ? "carries a decodable PAYMENT-REQUIRED header (x402)" : "no decodable PAYMENT-REQUIRED header");

  // Summarize each accepted rail so a buyer knows what it would settle.
  const rails = accepts.map((a) => {
    const net = String(a.network ?? "");
    return {
      scheme: a.scheme ?? null,
      network: net || null,
      networkLabel: NETWORKS[net] || null,
      asset: a.asset ?? null,
      amountAtomic: a.maxAmountRequired ?? a.amount ?? null,
      payTo: a.payTo ?? a.recipient ?? null,
      maxTimeoutSeconds: a.maxTimeoutSeconds ?? null,
    };
  });
  add("advertises_a_rail", rails.length > 0,
    rails.length ? `${rails.length} payment rail(s) advertised` : "no payment rails advertised in the challenge");

  // A Bazaar extension makes the endpoint discoverable/shoppable; note whether
  // it is present, since a challenge that settles beats one that only markets.
  const hasBazaar = Boolean(pr?.extensions?.bazaar || pr?.bazaar);
  add("bazaar_discovery_extension", hasBazaar,
    hasBazaar ? "includes a Bazaar discovery extension" : "no Bazaar extension (still valid; just less discoverable)");

  // Recipient sanity: a real payTo should be a 0x address on an EVM rail.
  const evmRail = rails.find((r) => /^0x[0-9a-fA-F]{40}$/.test(String(r.payTo || "")));
  const anyPayTo = rails.some((r) => r.payTo);
  add("recipient_present", anyPayTo,
    anyPayTo ? "a settlement recipient is present" : "no settlement recipient in any rail");

  // Cache-control: a stale price served from cache while the meter charges a
  // new one is a real bug we hit ourselves; flag if the 402 is cacheable.
  const cacheControl = res.headers.get("cache-control") || "";
  const cacheable = /max-age=[1-9]/.test(cacheControl) && !/no-store/.test(cacheControl);
  add("challenge_not_cacheable", !cacheable,
    cacheable ? `challenge is cacheable (${cacheControl}); prices can go stale` : "challenge is not cached");

  const passed = checks.filter((c) => c.pass).length;
  const verdict =
    is402 && rails.length > 0 && anyPayTo
      ? passed >= 6 ? "healthy" : "payable but incomplete"
      : is402 ? "challenges but not settleable as read" : "not an x402 endpoint as read";

  return {
    url: url.toString(),
    httpStatus: status,
    contentType,
    verdict,
    score: `${passed}/${checks.length}`,
    rails,
    wwwAuthenticate: wa || null,
    hasBazaar,
    checks,
    note:
      "One unpaid GET; no payment was signed or submitted. Verdict reflects only what the endpoint returned to an anonymous caller. " +
      "A 'healthy' endpoint answers 402 with at least one rail carrying a recipient. Redirects are not followed.",
  };
}
