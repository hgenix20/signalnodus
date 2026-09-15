// OAuth 2.1 authorization server that wraps a Signal Nodus API key.
//
// Why this exists: Claude's hosted clients (claude.ai, Desktop, mobile, Claude
// Code) connect a per-user credential to a remote MCP server only through
// OAuth. There is no "paste an API key" option for a directory listing. So the
// keyed MCP endpoint (/keyed on this host) challenges with a 401 that points
// here, the user pastes their Signal Nodus key on the consent page, and the
// key itself is handed back as the bearer token. From then on every request
// carries `Authorization: Bearer <key>`, which the billing layer already
// understands. Nothing new is stored: the flow is stateless.
//
// Contract:
//   GET  /.well-known/oauth-protected-resource[/keyed]  RFC 9728 document
//   GET  /.well-known/oauth-authorization-server         RFC 8414 document
//   POST /oauth/register                                 RFC 7591 (DCR), public clients only
//   GET  /oauth/authorize                                consent page (paste key)
//   POST /oauth/authorize                                verifies the key, redirects with a code
//   POST /oauth/token                                    authorization_code + PKCE S256 -> the key
//
// Security properties:
//   - Redirect URIs are allow-listed (Claude's hosted callback, and loopback
//     for native clients, port ignored per RFC 8252 7.3). A client_id never
//     widens that list.
//   - Authorization codes are AES-GCM ciphertext of {key, challenge,
//     redirect_uri, client_id, exp} under a Worker secret, valid 5 minutes.
//     Redeeming one requires the PKCE verifier, so a leaked code alone is
//     worthless. Codes are not single-use (stateless); a replay with the
//     verifier yields the same token to the same client, which is harmless.
//   - The token is the API key. It carries no expiry because keys have none.
//   - Only public clients (token_endpoint_auth_method "none") are supported.
//     There is no client secret anywhere in this flow.

import { hashKey } from "./billing.js";

export const ISSUER = "https://mcp.signalnodus.ai";
export const KEYED_PATH = "/keyed";
export const KEYED_RESOURCE = `${ISSUER}${KEYED_PATH}`;
export const SCOPE = "tools";

const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const CODE_TTL_MS = 5 * 60 * 1000;
const CIMD_FETCH_TIMEOUT_MS = 5000;
const MAX_FORM_BYTES = 16 * 1024;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization, mcp-protocol-version",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "x-content-type-options": "nosniff",
};

// ------------------------------------------------------------------ Metadata

export function protectedResourceMetadata() {
  return {
    resource: KEYED_RESOURCE,
    authorization_servers: [ISSUER],
    bearer_methods_supported: ["header"],
    scopes_supported: [SCOPE],
    resource_name: "Signal Nodus",
    resource_documentation: "https://signalnodus.ai/recipes",
  };
}

export function authorizationServerMetadata() {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    registration_endpoint: `${ISSUER}/oauth/register`,
    scopes_supported: [SCOPE],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    service_documentation: "https://signalnodus.ai/recipes",
  };
}

// ----------------------------------------------------------------- Redirects

// Loopback redirects are compared with the port ignored: native clients bind
// an ephemeral port at runtime (RFC 8252 section 7.3). Claude Code declares
// http://localhost/callback as well as 127.0.0.1, so both are accepted.
export function redirectUriAllowed(uri) {
  let u;
  try {
    u = new URL(String(uri));
  } catch {
    return false;
  }
  if (u.username || u.password || u.hash) return false;
  if (u.origin + u.pathname === CLAUDE_CALLBACK && !u.search) return true;
  const loopback = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  return u.protocol === "http:" && loopback;
}

// Same comparison a CIMD document needs: an exact match, except that loopback
// hosts match with any port.
function redirectMatches(registered, requested) {
  let a;
  let b;
  try {
    a = new URL(String(registered));
    b = new URL(String(requested));
  } catch {
    return false;
  }
  if (a.protocol !== b.protocol || a.hostname !== b.hostname || a.pathname !== b.pathname) return false;
  const loopback = b.hostname === "localhost" || b.hostname === "127.0.0.1" || b.hostname === "[::1]";
  return loopback ? true : a.port === b.port;
}

// A client_id that is an https URL is a Client ID Metadata Document. The
// document must be self-referential and list the redirect_uri. If it cannot be
// fetched the allow-list above still applies, so a bad document can never
// widen where a code may be sent.
async function cimdAllowsRedirect(clientId, redirectUri) {
  let doc;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CIMD_FETCH_TIMEOUT_MS);
    const res = await fetch(clientId, { headers: { accept: "application/json" }, signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, reason: `client metadata returned ${res.status}` };
    doc = await res.json();
  } catch {
    return { ok: false, reason: "client metadata unreachable" };
  }
  if (!doc || doc.client_id !== clientId) return { ok: false, reason: "client metadata is not self-referential" };
  const uris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris : [];
  if (!uris.some((r) => redirectMatches(r, redirectUri))) {
    return { ok: false, reason: "redirect_uri is not registered in the client metadata" };
  }
  return { ok: true, name: typeof doc.client_name === "string" ? doc.client_name.slice(0, 80) : null };
}

function isCimdClientId(clientId) {
  try {
    const u = new URL(clientId);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

// -------------------------------------------------------------------- PKCE

const enc = new TextEncoder();

export function base64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(str) {
  const b64 = String(str).replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(verifier));
  return base64url(new Uint8Array(digest));
}

export async function pkceVerify(verifier, challenge) {
  if (typeof verifier !== "string" || verifier.length < 43 || verifier.length > 128) return false;
  if (!/^[A-Za-z0-9\-._~]+$/.test(verifier)) return false;
  return (await pkceChallenge(verifier)) === challenge;
}

// ------------------------------------------------------- Authorization codes

async function codeKey(secret) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function sealCode(secret, payload, now = Date.now()) {
  const key = await codeKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = enc.encode(JSON.stringify({ ...payload, exp: now + CODE_TTL_MS }));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, body));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return base64url(out);
}

// Returns the payload, or null for anything that is not a live code we
// issued: wrong secret, tampered bytes, malformed, or expired.
export async function openCode(secret, code, now = Date.now()) {
  try {
    const bytes = fromBase64url(code);
    if (bytes.length < 13) return null;
    const key = await codeKey(secret);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    const payload = JSON.parse(new TextDecoder().decode(pt));
    if (!payload || typeof payload.exp !== "number" || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Requests

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function oauthError(error, description, status = 400) {
  return json({ error, error_description: description }, status);
}

async function readForm(request) {
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  const text = await request.text();
  if (text.length > MAX_FORM_BYTES) return null;
  if (ct.includes("application/x-www-form-urlencoded")) return new URLSearchParams(text);
  if (ct.includes("application/json")) {
    try {
      const obj = JSON.parse(text);
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(obj || {})) if (typeof v === "string") p.set(k, v);
      return p;
    } catch {
      return null;
    }
  }
  return null;
}

// Validates the parameters an authorization request must carry. Returns
// either { ok: true, params } or { ok: false, status, error, description,
// redirectable } where redirectable says whether the error may be sent back
// to the client's redirect_uri (only once that URI itself has been vetted).
export function checkAuthorizeParams(p) {
  const get = (k) => (typeof p.get === "function" ? p.get(k) : p[k]) ?? null;
  const redirect_uri = get("redirect_uri");
  const client_id = get("client_id");
  if (!client_id || client_id.length > 512) {
    return { ok: false, status: 400, error: "invalid_request", description: "client_id is required", redirectable: false };
  }
  if (!redirect_uri || !redirectUriAllowed(redirect_uri)) {
    return { ok: false, status: 400, error: "invalid_request", description: "redirect_uri is not allowed", redirectable: false };
  }
  const response_type = get("response_type");
  if (response_type !== "code") {
    return { ok: false, status: 400, error: "unsupported_response_type", description: "response_type must be code", redirectable: true };
  }
  const code_challenge = get("code_challenge");
  const method = get("code_challenge_method") || "plain";
  if (!code_challenge || method !== "S256" || !/^[A-Za-z0-9\-_]{43}$/.test(code_challenge)) {
    return { ok: false, status: 400, error: "invalid_request", description: "PKCE S256 code_challenge is required", redirectable: true };
  }
  const state = get("state");
  return {
    ok: true,
    params: {
      client_id,
      redirect_uri,
      code_challenge,
      state: state && state.length <= 1024 ? state : null,
      scope: get("scope") || SCOPE,
      resource: get("resource") || null,
    },
  };
}

function redirectWith(redirectUri, params) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) u.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { location: u.toString(), "cache-control": "no-store" } });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function consentPage(params, { relyingParty, error = null }) {
  const hidden = ["client_id", "redirect_uri", "code_challenge", "state", "scope", "resource"]
    .filter((k) => params[k])
    .map((k) => `<input type="hidden" name="${k}" value="${escapeHtml(params[k])}">`)
    .join("\n");
  const cancel = new URL(params.redirect_uri);
  cancel.searchParams.set("error", "access_denied");
  if (params.state) cancel.searchParams.set("state", params.state);
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Connect Signal Nodus</title>
<link rel="stylesheet" href="https://signalnodus.ai/site.css">
<style>
  form.connect { max-width: 34rem; }
  form.connect input[type=password] { width: 100%; font: inherit; padding: .6rem .7rem; border: 1px solid #555; border-radius: 6px; background: transparent; color: inherit; }
  form.connect button { font: inherit; padding: .6rem 1.1rem; border-radius: 6px; border: 1px solid #888; background: transparent; color: inherit; cursor: pointer; margin-top: .8rem; }
  .err { border-left: 3px solid #c33; padding-left: .8rem; }
</style>
</head>
<body>
<header class="site"><div class="wrap"><span class="mark">SIGNAL<span class="dot">·</span>NODUS</span></div></header>
<main class="wrap">
  <section class="hero">
    <h1>Connect Signal Nodus</h1>
    <p class="lede"><strong>${escapeHtml(relyingParty)}</strong> is asking to call Signal Nodus tools with your API key. Paste the key below. It is used as the credential for this connection and is never shown again.</p>
  </section>
  <section>
    ${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
    <form class="connect" method="post" action="/oauth/authorize" autocomplete="off">
      ${hidden}
      <label for="api_key">Signal Nodus API key</label>
      <input id="api_key" name="api_key" type="password" required minlength="16" maxlength="256" placeholder="sn_…" autofocus>
      <div>
        <button type="submit">Connect</button>
        <a class="dim" href="${escapeHtml(cancel.toString())}" style="margin-left:1rem">Cancel</a>
      </div>
    </form>
    <p class="sub mt">No key yet? Get a free $5 test key at <a href="https://signalnodus.ai/trial" target="_blank" rel="noopener">signalnodus.ai/trial</a> (no card, no signup) or buy credit at <a href="https://signalnodus.ai/pricing" target="_blank" rel="noopener">signalnodus.ai/pricing</a>. Priced tools are charged to the key you connect; lookup_company stays free.</p>
    <p class="dim">What this grants: calls to Signal Nodus tools, billed to this key's balance. Nothing else. Disconnect from your client at any time; the key itself is unaffected. <a href="https://signalnodus.ai/privacy">Privacy</a>.</p>
  </section>
</main>
<footer><div class="wrap">Signal Nodus · human-owned · <a href="https://signalnodus.ai/status">status</a> · <a href="https://signalnodus.ai/privacy">privacy</a></div></footer>
</body>
</html>`;
  return new Response(body, {
    status: error ? 400 : 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'self' 'unsafe-inline' https://signalnodus.ai; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

async function relyingPartyName(params) {
  if (isCimdClientId(params.client_id)) {
    // Display the host of the client_id URL, never a self-asserted name.
    return new URL(params.client_id).host;
  }
  return new URL(params.redirect_uri).host;
}

async function vetClient(params) {
  if (isCimdClientId(params.client_id)) {
    const cimd = await cimdAllowsRedirect(params.client_id, params.redirect_uri);
    if (!cimd.ok) return cimd;
  }
  return { ok: true };
}

async function keyIsLive(env, apiKey) {
  if (!env?.BILLING) return { ok: false, reason: "billing database unavailable, try again shortly" };
  const keyHash = await hashKey(apiKey);
  const row = await env.BILLING.prepare("SELECT active FROM api_keys WHERE key_hash = ?").bind(keyHash).first();
  if (!row) return { ok: false, reason: "That key is not recognised. Check for a missing character, or get a free test key at signalnodus.ai/trial." };
  if (!row.active) return { ok: false, reason: "That key is disabled. Email hgenix@agentmail.to if you think that is wrong." };
  return { ok: true };
}

// ------------------------------------------------------------------ Router

export async function handleOAuth(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });

  if (path === "/.well-known/oauth-protected-resource" || path === `/.well-known/oauth-protected-resource${KEYED_PATH}`) {
    if (method !== "GET") return oauthError("invalid_request", "GET only", 405);
    return json(protectedResourceMetadata(), 200, { "cache-control": "public, max-age=300" });
  }
  if (path === "/.well-known/oauth-authorization-server") {
    if (method !== "GET") return oauthError("invalid_request", "GET only", 405);
    return json(authorizationServerMetadata(), 200, { "cache-control": "public, max-age=300" });
  }

  const secret = env?.OAUTH_CODE_SECRET;
  if (!secret && (path === "/oauth/authorize" || path === "/oauth/token")) {
    return oauthError("temporarily_unavailable", "keyed connections are not configured on this deployment", 503);
  }

  if (path === "/oauth/register") {
    if (method !== "POST") return oauthError("invalid_request", "POST only", 405);
    let body;
    try {
      body = await request.json();
    } catch {
      return oauthError("invalid_client_metadata", "body must be JSON");
    }
    const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
    if (!uris.length || !uris.every(redirectUriAllowed)) {
      return oauthError(
        "invalid_redirect_uri",
        "redirect_uris must be https://claude.ai/api/mcp/auth_callback or a loopback http URL",
      );
    }
    const auth = body.token_endpoint_auth_method || "none";
    if (auth !== "none") return oauthError("invalid_client_metadata", "only public clients (token_endpoint_auth_method none) are supported");
    const id = `dcr-${base64url(crypto.getRandomValues(new Uint8Array(16)))}`;
    return json(
      {
        client_id: id,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        client_name: typeof body.client_name === "string" ? body.client_name.slice(0, 80) : undefined,
      },
      201,
    );
  }

  if (path === "/oauth/authorize") {
    if (method !== "GET" && method !== "POST") return oauthError("invalid_request", "GET or POST", 405);
    const source = method === "GET" ? url.searchParams : await readForm(request);
    if (!source) return oauthError("invalid_request", "unreadable form body");
    const check = checkAuthorizeParams(source);
    if (!check.ok) {
      if (check.redirectable) {
        return redirectWith(source.get("redirect_uri"), { error: check.error, error_description: check.description, state: source.get("state") });
      }
      return oauthError(check.error, check.description, check.status);
    }
    const { params } = check;
    const vet = await vetClient(params);
    if (!vet.ok) return redirectWith(params.redirect_uri, { error: "invalid_client", error_description: vet.reason, state: params.state });
    const relyingParty = await relyingPartyName(params);

    if (method === "GET") return consentPage(params, { relyingParty });

    const apiKey = (source.get("api_key") || "").trim();
    if (apiKey.length < 16 || apiKey.length > 256) {
      return consentPage(params, { relyingParty, error: "Paste the whole key." });
    }
    let live;
    try {
      live = await keyIsLive(env, apiKey);
    } catch (err) {
      console.error("oauth key check failed", err);
      live = { ok: false, reason: "Could not check that key right now. Try again in a minute." };
    }
    if (!live.ok) return consentPage(params, { relyingParty, error: live.reason });

    const code = await sealCode(secret, {
      k: apiKey,
      cc: params.code_challenge,
      r: params.redirect_uri,
      c: params.client_id,
    });
    return redirectWith(params.redirect_uri, { code, state: params.state });
  }

  if (path === "/oauth/token") {
    if (method !== "POST") return oauthError("invalid_request", "POST only", 405);
    const form = await readForm(request);
    if (!form) return oauthError("invalid_request", "expected application/x-www-form-urlencoded");
    if (form.get("grant_type") !== "authorization_code") {
      return oauthError("unsupported_grant_type", "only authorization_code is supported");
    }
    const payload = await openCode(secret, form.get("code") || "");
    if (!payload) return oauthError("invalid_grant", "authorization code is invalid or expired");
    const redirect = form.get("redirect_uri");
    if (redirect && redirect !== payload.r) return oauthError("invalid_grant", "redirect_uri does not match");
    const clientId = form.get("client_id");
    if (clientId && clientId !== payload.c) return oauthError("invalid_grant", "client_id does not match");
    if (!(await pkceVerify(form.get("code_verifier") || "", payload.cc))) {
      return oauthError("invalid_grant", "PKCE verification failed");
    }
    return json({ access_token: payload.k, token_type: "Bearer", scope: SCOPE });
  }

  return oauthError("not_found", "no such endpoint", 404);
}
