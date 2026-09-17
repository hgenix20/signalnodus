#!/usr/bin/env node
// Agent Gate: a deterministic door in front of an AI coding agent's shell.
//
// A Claude Code hook (PreToolUse and PostToolUse on the Bash tool). Before a command runs, it is
// matched against a fixed list of destructive operations. A match is not run on the agent's own
// say: the hook answers "ask", so a person sees the command and the reason and decides, or "deny"
// when AGENT_GATE_MODE=deny. Every match is written to a local record, and the PostToolUse pass
// writes whether the command then ran. No model is consulted, nothing leaves the machine, and
// there are no dependencies.
//
// Contract
//   stdin   one JSON object from Claude Code (hook_event_name, tool_name, tool_input.command,
//           cwd, session_id, permission_mode, tool_use_id).
//   stdout  PreToolUse on a match: {"hookSpecificOutput":{"hookEventName":"PreToolUse",
//           "permissionDecision":"ask"|"deny","permissionDecisionReason":"..."}}. Otherwise nothing.
//   exit    always 0. An exit of 0 with no output means "no decision", and Claude Code's normal
//           permission flow applies. Anything this script cannot parse is passed through the same
//           way: a broken gate must not become a broken shell.
//   record  one JSON line per match in $AGENT_GATE_RECORD or ~/.agent-gate/record.jsonl.
//
// Limits, stated plainly. This is a pattern list over the command text. It does not sandbox
// anything. An agent that writes the same operation into a script file and runs the script is
// not caught, nor is a destructive call made through an SDK. Least-privilege credentials and
// backups remain the real defence; the gate covers the step where an agent reaches for a flag
// whose name says it destroys data.

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";

export const MODE_ASK = "ask";
export const MODE_DENY = "deny";
// Commands are clipped in the record so a pasted secret or a huge heredoc does not live there.
export const RECORD_COMMAND_MAX = 400;

// Each rule: id, what it is, and a test over the command text. Tests are written against a
// whitespace-normalised, lower-cased copy; `raw` is there for the rules that need paths.
export const RULES = [
  { id: "prisma-data-loss", why: "Prisma push or reset that accepts data loss", test: (c) => /\bprisma\s+db\s+push\b.*--accept-data-loss/.test(c) || /\bprisma\s+migrate\s+reset\b/.test(c) },
  { id: "drizzle-force", why: "drizzle-kit push with --force drops what it cannot reconcile", test: (c) => /\bdrizzle-kit\s+push\b.*--force\b/.test(c) },
  { id: "db-reset", why: "database reset", test: (c) => /\b(supabase\s+db\s+reset|rails\s+db:(drop|reset)|rake\s+db:(drop|reset)|dropdb\s)/.test(c) },
  { id: "sql-destroy", why: "SQL that drops or empties a table, schema or database", test: (c) => /\b(drop\s+(table|database|schema)|truncate\s+(table\s+)?[a-z_"`])/.test(c) || /\bdelete\s+from\s+[a-z_."`]+\s*(;|"|'|$)/.test(c) },
  { id: "terraform-destroy", why: "Terraform destroy", test: (c) => /\bterraform\s+(destroy|apply\b.*-destroy)\b/.test(c) || /\b(tofu|pulumi)\s+destroy\b/.test(c) },
  { id: "kubectl-delete", why: "Kubernetes delete of a namespace, volume claim, or everything", test: (c) => /\bkubectl\s+delete\b.*\b(namespace|ns|pvc|pv)\b/.test(c) || /\bkubectl\s+delete\b.*--all\b/.test(c) || /\bhelm\s+uninstall\b/.test(c) },
  { id: "cloud-delete", why: "cloud storage or resource-group removal", test: (c) => /\baws\s+s3\s+(rm\b.*--recursive|rb\b.*--force)/.test(c) || /\baz\s+group\s+delete\b/.test(c) || /\bgcloud\b.*\b(projects|sql\s+instances|storage\s+buckets)\s+delete\b/.test(c) || /\bgsutil\s+(-m\s+)?rm\s+-r/.test(c) },
  { id: "docker-prune", why: "Docker prune or volume removal", test: (c) => /\bdocker\s+(system|volume)\s+prune\b/.test(c) || /\bdocker\s+volume\s+rm\b/.test(c) || /\bdocker\s+compose\s+down\b.*(-v\b|--volumes)/.test(c) },
  { id: "git-force", why: "history rewrite or forced overwrite of a remote branch", test: (c) => /\bgit\s+push\b.*(\s--force(?!-with-lease)\b|\s-f\b)/.test(c) || /\bgit\s+push\b.*\s\+[\w/.-]+/.test(c) },
  { id: "git-discard", why: "discards uncommitted work", test: (c) => /\bgit\s+reset\s+--hard\b/.test(c) || /\bgit\s+clean\b.*-[a-z]*f/.test(c) || /\bgit\s+checkout\s+(--\s+)?\.\s*($|[;&|])/.test(c) },
  { id: "disk-write", why: "writes to a raw device or makes a filesystem", test: (c) => /\bdd\b.*\bof=\/dev\//.test(c) || /\bmkfs(\.\w+)?\s/.test(c) },
  { id: "rm-outside", why: "recursive delete outside the working directory, or of the repository itself", test: (c, raw, cwd) => rmTargets(raw).some((t) => dangerousRmTarget(t, cwd)) },
];

/** Targets of every `rm` with a recursive flag in the command, as written. */
export function rmTargets(raw) {
  const out = [];
  for (const part of String(raw).split(/&&|\|\||[;|\n]/)) {
    const words = part.trim().split(/\s+/);
    const at = words.findIndex((w) => w === "rm" || w.endsWith("/rm"));
    if (at < 0) continue;
    const rest = words.slice(at + 1);
    const flags = rest.filter((w) => w.startsWith("-"));
    const recursive = flags.some((f) => f === "--recursive" || (/^-[a-zA-Z]+$/.test(f) && /[rR]/.test(f)));
    if (!recursive) continue;
    out.push(...rest.filter((w) => !w.startsWith("-")).map((w) => w.replace(/^["']|["']$/g, "")));
  }
  return out;
}

/** True when a recursive delete of `target` reaches outside `cwd`, or takes the repo with it. */
export function dangerousRmTarget(target, cwd) {
  if (target === "" ) return false;
  if (/^(\/|~|\$home|\$\{home\}|\*|\.|\.\.|\/\*)$/i.test(target)) return true;
  if (/(^|\/)\.git\/?$/.test(target)) return true;
  if (target.startsWith("~") || /^\$\{?home\}?/i.test(target)) return true;
  // A variable the gate cannot resolve is treated as unknown territory, not as safe.
  if (/\$[{(a-zA-Z_]/.test(target)) return true;
  const base = cwd || process.cwd();
  const abs = isAbsolute(target) ? normalize(target) : resolve(base, target);
  const rel = relative(base, abs);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel);
}

/** First matching rule for a command, or null. Pure. */
export function matchRule(command, cwd) {
  const raw = String(command ?? "");
  const c = raw.replace(/\s+/g, " ").trim().toLowerCase();
  if (c === "") return null;
  for (const rule of RULES) {
    try {
      if (rule.test(c, raw, cwd)) return rule;
    } catch {
      // A rule that throws on odd input must not take the others down with it.
    }
  }
  return null;
}

export function recordPath(env = process.env) {
  return env.AGENT_GATE_RECORD || join(homedir(), ".agent-gate", "record.jsonl");
}

function writeRecord(entry, env) {
  try {
    const file = recordPath(env);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // The record is the point of the tool, but a read-only home must not block the shell.
  }
}

/**
 * Decide one hook event. Returns the JSON to print (or null) and the record line (or null).
 * Pure apart from the clock, so the tests can call it directly.
 */
export function decide(input, env = process.env, now = new Date()) {
  if (!input || input.tool_name !== "Bash") return { output: null, entry: null };
  const command = input.tool_input?.command;
  const rule = matchRule(command, input.cwd);
  if (rule === null) return { output: null, entry: null };
  const mode = env.AGENT_GATE_MODE === MODE_DENY ? MODE_DENY : MODE_ASK;
  const base = {
    ts: now.toISOString(),
    session: input.session_id ?? null,
    tool_use_id: input.tool_use_id ?? null,
    cwd: input.cwd ?? null,
    rule: rule.id,
    command: String(command).slice(0, RECORD_COMMAND_MAX),
  };
  if (input.hook_event_name === "PostToolUse") {
    // It ran, which means a person (or a permission rule a person wrote) let it through.
    return { output: null, entry: { ...base, event: "ran" } };
  }
  if (input.hook_event_name !== "PreToolUse") return { output: null, entry: null };
  const reason = `Agent Gate: ${rule.why} (${rule.id}). ${mode === MODE_DENY ? "Blocked; a person has to run this by hand." : "A person decides whether this runs."}`;
  return {
    output: { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: mode, permissionDecisionReason: reason } },
    entry: { ...base, event: "gated", decision: mode, permission_mode: input.permission_mode ?? null },
  };
}

async function main() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  let input = null;
  try {
    input = JSON.parse(text);
  } catch {
    return; // not JSON: no decision
  }
  const { output, entry } = decide(input);
  if (entry) writeRecord(entry, process.env);
  if (output) process.stdout.write(JSON.stringify(output));
}

// Run only when executed, so the tests can import the functions above.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  main().catch(() => {}).finally(() => process.exit(0));
}
