import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchRule, decide, rmTargets, dangerousRmTarget } from "../gate/agent-gate.mjs";

const CWD = "/home/dev/project";

// The three commands from the public incident reports the gate was written against.
test("the reported incident commands are gated", () => {
  assert.equal(matchRule("npx drizzle-kit push --force", CWD)?.id, "drizzle-force");
  assert.equal(matchRule("npx prisma db push --accept-data-loss", CWD)?.id, "prisma-data-loss");
  assert.equal(matchRule("cd infra && terraform destroy -auto-approve", CWD)?.id, "terraform-destroy");
});

test("destructive variants are gated", () => {
  const gated = [
    "psql $DATABASE_URL -c 'DROP TABLE users;'",
    'mysql -e "truncate table orders"',
    'psql -c "DELETE FROM accounts;"',
    "kubectl delete namespace prod",
    "kubectl delete pods --all -n prod",
    "aws s3 rm s3://backups --recursive",
    "docker compose down -v",
    "git push origin main --force",
    "git push -f",
    "git reset --hard HEAD~3",
    "git clean -fdx",
    "rm -rf /",
    "rm -rf ~",
    "rm -rf ../other-repo",
    "rm -rf .git",
    "rm -rf $TARGET_DIR",
    "sudo rm -fr /var/lib/postgresql",
    "dd if=/dev/zero of=/dev/sda",
    "supabase db reset",
    "prisma migrate reset --force",
  ];
  for (const c of gated) assert.notEqual(matchRule(c, CWD), null, c);
});

test("ordinary work passes with no decision", () => {
  const fine = [
    "npm test",
    "rm -rf node_modules",
    "rm -rf ./dist build/cache",
    "rm notes.txt",
    "git push origin feature/x",
    "git push --force-with-lease origin feature/x",
    "npx prisma db push",
    "npx drizzle-kit push",
    "terraform plan",
    "kubectl get pods -n prod",
    'psql -c "DELETE FROM sessions WHERE expires < now()"',
    "aws s3 ls s3://backups",
    "docker compose down",
    "",
  ];
  for (const c of fine) assert.equal(matchRule(c, CWD), null, c);
});

test("rm target parsing", () => {
  assert.deepEqual(rmTargets("cd x && rm -rf a b; rm c"), ["a", "b"]);
  assert.equal(dangerousRmTarget("build", CWD), false);
  assert.equal(dangerousRmTarget("/home/dev/project/build", CWD), false);
  assert.equal(dangerousRmTarget("/home/dev", CWD), true);
  assert.equal(dangerousRmTarget(".", CWD), true);
});

test("decide: ask by default, deny on request, nothing for other tools", () => {
  const input = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "terraform destroy" }, cwd: CWD, session_id: "s1", tool_use_id: "t1" };
  const ask = decide(input, {}, new Date("2026-09-17T00:00:00Z"));
  assert.equal(ask.output.hookSpecificOutput.permissionDecision, "ask");
  assert.equal(ask.output.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(ask.entry.event, "gated");
  assert.equal(ask.entry.rule, "terraform-destroy");
  const deny = decide(input, { AGENT_GATE_MODE: "deny" });
  assert.equal(deny.output.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(decide({ ...input, tool_name: "Read" }).output, null);
  assert.equal(decide({ ...input, tool_input: { command: "npm test" } }).entry, null);
  const ran = decide({ ...input, hook_event_name: "PostToolUse" });
  assert.equal(ran.output, null);
  assert.equal(ran.entry.event, "ran");
});

test("the record clips long commands", () => {
  const long = `psql -c "DROP TABLE x" ${"#".repeat(2000)}`;
  const d = decide({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: long }, cwd: CWD });
  assert.equal(d.entry.command.length, 400);
});

test("as a process: prints the decision, writes the record, exits 0, survives garbage", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-gate-"));
  const record = join(dir, "record.jsonl");
  const run = (stdin) => spawnSync(process.execPath, ["gate/agent-gate.mjs"], { input: stdin, encoding: "utf8", env: { ...process.env, AGENT_GATE_RECORD: record } });
  const hit = run(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npx prisma db push --accept-data-loss" }, cwd: dir, session_id: "s" }));
  assert.equal(hit.status, 0);
  assert.equal(JSON.parse(hit.stdout).hookSpecificOutput.permissionDecision, "ask");
  const lines = readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].rule, "prisma-data-loss");
  const miss = run(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" }, cwd: dir }));
  assert.equal(miss.status, 0);
  assert.equal(miss.stdout, "");
  const junk = run("not json at all");
  assert.equal(junk.status, 0);
  assert.equal(junk.stdout, "");
  assert.equal(existsSync(record), true);
});
