// Stripe credit purchases.
//
// Card rails cannot charge $0.10 per call: Stripe's per-transaction fee alone
// is larger than the sale. So money moves in packs, and the packs buy credits
// that the metering layer spends per call. That keeps per-use pricing for the
// buyer while staying economic on cards.
//
// The API key is minted when checkout starts, and only its hash is stored, so
// no plaintext key is ever written to the database. The webhook credits the
// hash after Stripe confirms payment.

import { hashKey, dollars, priceOf } from "./billing.js";

// Bonus credit on the larger packs is the volume discount. Compare against an
// incumbent charging $239/mo before you may extract a section at all.
export const PACKS = {
  // Sized under the stock x402 client's default per-payment safety cap of
  // 0.1 USDC, discovered when the client refused the $9 pack before signing.
  // A default-configured agent can buy this one without touching a setting;
  // every larger pack requires the buyer to raise its own cap.
  taste: { cents: 9, units: 100, label: "Taste" },
  starter: { cents: 900, units: 10_000, label: "Starter" },
  builder: { cents: 3900, units: 45_000, label: "Builder" },
  scale: { cents: 14_900, units: 190_000, label: "Scale" },
};

export function packSummary() {
  return Object.entries(PACKS).map(([id, p]) => ({
    id,
    label: p.label,
    price: `$${(p.cents / 100).toFixed(2)}`,
    credits: dollars(p.units),
    // Derived from the live price table, so a price change can never leave
    // the packs advertising counts the credit cannot buy. The hardcoded 250
    // here dated from an early draft price and overstated every pack by 2x.
    diffs: Math.floor(p.units / priceOf("compare_filings")),
    sections: Math.floor(p.units / priceOf("filing_section")),
  }));
}

// Mints a key and credits it in one step. Used by the machine-payment route so
// an agent can buy access without a human ever touching a checkout page.
export async function mintKey(env, units, label) {
  const apiKey = newApiKey();
  const keyHash = await hashKey(apiKey);
  await env.BILLING.prepare(
    "INSERT INTO api_keys (key_hash, label, credits, active, created_at) VALUES (?, ?, ?, 1, ?)",
  )
    .bind(keyHash, label, units, new Date().toISOString())
    .run();
  return apiKey;
}

function newApiKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const body = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sn_live_${body}`;
}

async function stripe(env, path, params) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`stripe: ${msg}`);
  }
  return data;
}

export async function createCheckout(request, env) {
  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: "payments_not_configured", detail: "STRIPE_SECRET_KEY is not set" }, 503);
  }

  let packId;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json({ error: "body too large" }, 413);
    ({ pack: packId } = JSON.parse(raw || "{}"));
  } catch {
    return json({ error: "bad request" }, 400);
  }

  const pack = PACKS[String(packId || "starter")];
  if (!pack) return json({ error: "unknown pack", packs: Object.keys(PACKS) }, 400);

  // Mint the key now and store only its hash. If payment never completes the
  // row simply stays at zero credits and is worthless.
  const apiKey = newApiKey();
  const keyHash = await hashKey(apiKey);

  const session = await stripe(env, "checkout/sessions", {
    mode: "payment",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(pack.cents),
    "line_items[0][price_data][product_data][name]": `Signal Nodus ${pack.label} credits`,
    "line_items[0][price_data][product_data][description]":
      `${dollars(pack.units)} of API credit. No subscription, no expiry.`,
    "line_items[0][quantity]": "1",
    success_url: `https://signalnodus.ai/key?k=${apiKey}`,
    cancel_url: "https://signalnodus.ai/pricing",
    "metadata[key_hash]": keyHash,
    "metadata[units]": String(pack.units),
    "metadata[pack]": String(packId),
  });

  try {
    await env.BILLING.prepare(
      "INSERT OR IGNORE INTO api_keys (key_hash, label, credits, active, created_at) VALUES (?, ?, 0, 1, ?)",
    )
      .bind(keyHash, `pending:${pack.label}`, new Date().toISOString())
      .run();
  } catch (err) {
    console.error("could not pre-register key", err);
    return json({ error: "could not start checkout" }, 503);
  }

  return json({ checkout_url: session.url, pack: pack.label, price: `$${(pack.cents / 100).toFixed(2)}` });
}

// Stripe signs webhooks as: t=<unix>,v1=<hmac_sha256(t + "." + body)>.
// Verifying is what stops anyone from POSTing themselves free credit.
async function verifySignature(secret, payload, header) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;

  // Reject replays of an old signed payload.
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(expected, v1);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handleWebhook(request, env) {
  const payload = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!(await verifySignature(env.STRIPE_WEBHOOK_SECRET, payload, sig))) {
    return json({ error: "bad signature" }, 400);
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: "bad payload" }, 400);
  }

  if (event.type !== "checkout.session.completed") {
    return json({ received: true, ignored: event.type });
  }

  const md = event.data?.object?.metadata || {};
  const keyHash = String(md.key_hash || "");
  const units = Number(md.units || 0);
  if (!/^[a-f0-9]{64}$/.test(keyHash) || !Number.isFinite(units) || units <= 0) {
    return json({ error: "missing metadata" }, 400);
  }

  // Stripe delivers at-least-once. Without an event-id ledger every
  // redelivery of the same checkout re-runs the credit upsert below and the
  // buyer gets free credit for one payment. Record the id first; if it was
  // already recorded, this delivery is a duplicate and credits nothing.
  const eventId = String(event.id || "");
  if (eventId) {
    try {
      const seen = await env.BILLING.prepare(
        "INSERT INTO stripe_events (event_id, created_at) VALUES (?, ?) ON CONFLICT(event_id) DO NOTHING",
      )
        .bind(eventId, new Date().toISOString())
        .run();
      if ((seen.meta?.changes ?? 1) === 0) {
        return json({ received: true, duplicate: true });
      }
    } catch (err) {
      // If the ledger itself is unavailable, crediting anyway risks a double
      // credit on retry; 500 makes Stripe retry when the ledger is back.
      console.error("could not record webhook event id", err);
      return json({ error: "could not record event" }, 500);
    }
  }

  try {
    // Upsert rather than update. The pre-registered row can legitimately be
    // gone by now (pruned as an abandoned checkout, or never written because
    // the pre-register failed), and a payment that lands on a missing row must
    // still produce a working key. Anything else means someone paid for
    // nothing.
    await env.BILLING.prepare(
      `INSERT INTO api_keys (key_hash, label, credits, active, created_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(key_hash) DO UPDATE SET
         credits = credits + excluded.credits,
         label = excluded.label,
         active = 1`,
    )
      .bind(keyHash, `paid:${md.pack || "pack"}`, units, new Date().toISOString())
      .run();
  } catch (err) {
    // Return non-2xx so Stripe retries rather than dropping a paid order.
    // Release the event id first, or the retry would read as a duplicate
    // and the buyer would never be credited.
    console.error("could not credit key", err);
    if (eventId) {
      try {
        await env.BILLING.prepare("DELETE FROM stripe_events WHERE event_id = ?").bind(eventId).run();
      } catch (cleanupErr) {
        console.error("could not release webhook event id", cleanupErr);
      }
    }
    return json({ error: "could not credit" }, 500);
  }

  return json({ received: true, credited: units });
}

export async function keyBalance(request, env) {
  const auth = request.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  const key = m ? m[1].trim() : request.headers.get("x-api-key");
  if (!key) return json({ error: "provide your key as Authorization: Bearer <key>" }, 401);

  try {
    const row = await env.BILLING.prepare(
      "SELECT credits, active, created_at, last_used FROM api_keys WHERE key_hash = ?",
    )
      .bind(await hashKey(key))
      .first();
    if (!row) return json({ error: "unknown key" }, 404);
    return json({
      active: Boolean(row.active),
      balance: dollars(row.credits),
      balance_units: row.credits,
      diffs_remaining: Math.floor(row.credits / priceOf("compare_filings")),
      created_at: row.created_at,
      last_used: row.last_used,
    });
  } catch (err) {
    console.error("balance lookup failed", err);
    return json({ error: "unavailable" }, 503);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// Abandoned checkouts leave a zero-credit row behind. Most people who start a
// checkout do not finish one, so without pruning this table fills with dead
// keys that buy nothing.
//
// 72 hours is deliberately generous: a Stripe Checkout session expires after
// 24, and webhooks retry beyond that. Even so, deletion is safe rather than
// merely unlikely to hurt, because the webhook upserts, so a payment arriving
// after a prune still creates a working key.
export async function pruneAbandonedCheckouts(env) {
  if (!env?.BILLING) return { pruned: 0, skipped: "no database" };
  const cutoff = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
  try {
    const res = await env.BILLING.prepare(
      `DELETE FROM api_keys
       WHERE label LIKE 'pending:%' AND credits = 0 AND created_at < ?`,
    )
      .bind(cutoff)
      .run();
    const pruned = res.meta?.changes ?? 0;
    if (pruned) console.log(`pruned ${pruned} abandoned checkout rows older than ${cutoff}`);
    return { pruned, cutoff };
  } catch (err) {
    console.error("prune failed", err);
    return { pruned: 0, error: String(err?.message || err) };
  }
}
