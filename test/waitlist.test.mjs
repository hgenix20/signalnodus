import test from "node:test";
import assert from "node:assert/strict";
import { signupProblem, resolveWhat, messageFor } from "../src/waitlist.js";

const O = "https://signalnodus.ai";
test("a real sign-up passes", () => assert.equal(signupProblem({ email: "ana@acme.io", elapsed: 9000 }, O), null));
test("guards", () => {
  assert.equal(signupProblem({ email: "ana@acme.io", elapsed: 9000, website: "x" }, O), "honeypot");
  assert.equal(signupProblem({ email: "ana@acme.io", elapsed: 500 }, O), "too_fast");
  assert.equal(signupProblem({ email: "not-an-email", elapsed: 9000 }, O), "email");
  assert.equal(signupProblem({ email: "ana@acme.io", elapsed: 9000 }, "https://evil.example"), "origin");
  assert.equal(signupProblem({ email: "ana@acme.io", elapsed: 9000 }, null, "same-origin"), null);
});
test("two waitlists share the table, told apart by what", () => {
  assert.equal(resolveWhat("genix-mind"), "genix-mind");
  assert.equal(resolveWhat("canary-kit"), "canary-kit");
  assert.equal(resolveWhat("something-else"), "canary-kit");
  assert.equal(resolveWhat(undefined), "canary-kit");
  assert.match(messageFor("genix-mind"), /not a purchase/);
  assert.match(messageFor("canary-kit"), /canary kit/);
});
