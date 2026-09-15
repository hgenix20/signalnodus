// Unit tests for the stateless OAuth layer. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  redirectUriAllowed,
  pkceChallenge,
  pkceVerify,
  sealCode,
  openCode,
  checkAuthorizeParams,
  authorizationServerMetadata,
  protectedResourceMetadata,
  KEYED_RESOURCE,
} from "../src/oauth.js";

const SECRET = "test-secret-not-for-production";

test("redirect allow-list: Claude callback and loopback only", () => {
  assert.equal(redirectUriAllowed("https://claude.ai/api/mcp/auth_callback"), true);
  assert.equal(redirectUriAllowed("http://localhost:3118/callback"), true);
  assert.equal(redirectUriAllowed("http://127.0.0.1:52011/callback"), true);
  assert.equal(redirectUriAllowed("http://[::1]:9/cb"), true);
  assert.equal(redirectUriAllowed("https://claude.ai/api/mcp/auth_callback?x=1"), false);
  assert.equal(redirectUriAllowed("https://claude.ai.evil.example/api/mcp/auth_callback"), false);
  assert.equal(redirectUriAllowed("https://evil.example/callback"), false);
  assert.equal(redirectUriAllowed("http://localhost.evil.example/callback"), false);
  assert.equal(redirectUriAllowed("https://localhost/callback"), false);
  assert.equal(redirectUriAllowed("not a url"), false);
  assert.equal(redirectUriAllowed(""), false);
});

test("PKCE S256 verifies the matching verifier and nothing else", async () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = await pkceChallenge(verifier);
  assert.equal(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.equal(await pkceVerify(verifier, challenge), true);
  assert.equal(await pkceVerify(verifier + "x", challenge), false);
  assert.equal(await pkceVerify("short", challenge), false);
  assert.equal(await pkceVerify("", challenge), false);
});

test("authorization code round-trips, expires, and rejects tampering", async () => {
  const payload = { k: "sn_test_key_1234567890", cc: "c".repeat(43), r: "https://claude.ai/api/mcp/auth_callback", c: "dcr-abc" };
  const code = await sealCode(SECRET, payload, 1_000_000);
  const opened = await openCode(SECRET, code, 1_000_000 + 60_000);
  assert.deepEqual({ k: opened.k, cc: opened.cc, r: opened.r, c: opened.c }, payload);

  assert.equal(await openCode(SECRET, code, 1_000_000 + 6 * 60_000), null, "expired");
  assert.equal(await openCode("other-secret", code, 1_000_000), null, "wrong secret");
  const tampered = code.slice(0, -2) + (code.endsWith("AA") ? "BB" : "AA");
  assert.equal(await openCode(SECRET, tampered, 1_000_000), null, "tampered");
  assert.equal(await openCode(SECRET, "", 1_000_000), null, "empty");
  assert.equal(await openCode(SECRET, "!!!not-base64!!!", 1_000_000), null, "garbage");
});

test("two codes for the same payload differ (fresh IV each time)", async () => {
  const payload = { k: "sn_x", cc: "c".repeat(43), r: "http://localhost/callback", c: "x" };
  assert.notEqual(await sealCode(SECRET, payload), await sealCode(SECRET, payload));
});

test("authorize params: PKCE S256 and an allowed redirect are mandatory", () => {
  const good = new URLSearchParams({
    response_type: "code",
    client_id: "dcr-abc",
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    state: "xyz",
  });
  const ok = checkAuthorizeParams(good);
  assert.equal(ok.ok, true);
  assert.equal(ok.params.state, "xyz");
  assert.equal(ok.params.scope, "tools");

  const noPkce = new URLSearchParams(good);
  noPkce.delete("code_challenge");
  const r1 = checkAuthorizeParams(noPkce);
  assert.equal(r1.ok, false);
  assert.equal(r1.redirectable, true, "a vetted redirect may receive the error");

  const plain = new URLSearchParams(good);
  plain.set("code_challenge_method", "plain");
  assert.equal(checkAuthorizeParams(plain).ok, false);

  const badRedirect = new URLSearchParams(good);
  badRedirect.set("redirect_uri", "https://evil.example/cb");
  const r2 = checkAuthorizeParams(badRedirect);
  assert.equal(r2.ok, false);
  assert.equal(r2.redirectable, false, "never redirect an error to an unvetted URI");

  const token = new URLSearchParams(good);
  token.set("response_type", "token");
  assert.equal(checkAuthorizeParams(token).error, "unsupported_response_type");
});

test("discovery documents advertise what Claude needs to pick CIMD or DCR", () => {
  const as = authorizationServerMetadata();
  assert.equal(as.client_id_metadata_document_supported, true);
  assert.ok(as.token_endpoint_auth_methods_supported.includes("none"));
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  assert.ok(as.registration_endpoint.startsWith(as.issuer));
  const prm = protectedResourceMetadata();
  assert.equal(prm.resource, KEYED_RESOURCE);
  assert.deepEqual(prm.authorization_servers, [as.issuer]);
});
