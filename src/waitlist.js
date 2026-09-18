// Early access for the canary kit: an email box on /swarms.
//
// The site's CSP has form-action 'none', so the form posts with fetch from /swarm-map.js. Guards: same
// origin, a honeypot field people never see, at least three seconds between page load and submit, a
// plain email check, and five sign-ups per visitor per day (a daily-salted hash, no IP stored). Answers
// the same way whether a sign-up was kept or dropped, so the guards cannot be probed.
// The mind's box reads new sign-ups from /dashboard/waitlist.json with the dashboard token.

const EMAIL = /^[^\s@<>"',;]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i;
const PER_DAY = 5;
const USES = new Set(["evidence", "control", "injection", "security", "curious", "other"]);

let ready = false;
async function ensureTable(env) {
  if (ready) return;
  await env.BILLING.prepare("CREATE TABLE IF NOT EXISTS waitlist (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, day TEXT NOT NULL, email TEXT NOT NULL, what TEXT, source TEXT, vid TEXT, use TEXT, UNIQUE(email, what))").run();
  // Tables made before the use-case question have no column for it; adding it twice is an error we ignore.
  await env.BILLING.prepare("ALTER TABLE waitlist ADD COLUMN use TEXT").run().catch(() => {});
  ready = true;
}

async function sha(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

// Pure check, testable without D1. Returns null when the sign-up should be kept.
export function signupProblem(body, origin, fetchSite) {
  const ours = origin ? /^https:\/\/(www\.)?signalnodus\.ai$/.test(origin) : fetchSite === "same-origin";
  if (!ours) return "origin";
  if (!body || typeof body !== "object") return "body";
  if (body.website) return "honeypot";
  if (!(Number(body.elapsed) >= 3000)) return "too_fast";
  if (!EMAIL.test(String(body.email || "").trim())) return "email";
  return null;
}

export async function handleEarlyAccess(request, env, ctx) {
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  let body = null;
  try { body = JSON.parse((await request.text()).slice(0, 2048)); } catch {}
  const problem = signupProblem(body, request.headers.get("origin"), request.headers.get("sec-fetch-site"));
  if (problem === "email") return Response.json({ ok: false, error: "That doesn't look like an email address." }, { status: 400 });
  const ok = Response.json({ ok: true, message: "You're on the list. We'll write when the canary kit is ready for your site." });
  if (problem || !env?.BILLING) return ok;
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const vid = await sha(`${day}|${env.ANALYTICS_SALT || "signalnodus"}|${request.headers.get("cf-connecting-ip") || ""}|${request.headers.get("user-agent") || ""}`);
  const work = (async () => {
    await ensureTable(env);
    const n = await env.BILLING.prepare("SELECT COUNT(*) AS n FROM waitlist WHERE day = ? AND vid = ?").bind(day, vid).first();
    if ((n?.n || 0) >= PER_DAY) return;
    await env.BILLING.prepare("INSERT OR IGNORE INTO waitlist (ts, day, email, what, source, vid, use) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(now.toISOString(), day, clip(body.email, 254).toLowerCase(), "canary-kit", clip(body.source, 80) || null, vid, USES.has(body.use) ? body.use : null).run();
  })().catch(() => {});
  if (ctx?.waitUntil) ctx.waitUntil(work); else await work;
  return ok;
}

export async function waitlistRows(env, since) {
  await ensureTable(env);
  const r = await env.BILLING.prepare("SELECT id, ts, email, what, source, use FROM waitlist WHERE ts > ? ORDER BY id").bind(since || "1970").all();
  return r.results || [];
}
