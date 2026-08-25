// Shared plumbing for the eval scripts: SEC-polite fetching with a local
// cache, so re-runs cost EDGAR nothing and the harness stays fast.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export const UA = "SignalNodus-eval/1.0 (+https://signalnodus.ai; hgenix@agentmail.to)";

const CACHE_DIR = new URL("./.cache/", import.meta.url);
let throttle = Promise.resolve();

// SEC fair access asks for no more than 10 req/s; one every 150ms stays
// comfortably under it even with retries.
function politeSlot() {
  const prev = throttle;
  let release;
  throttle = new Promise((r) => (release = r));
  return prev.then(() => new Promise((r) => setTimeout(() => r(release), 150)));
}

export async function fetchCached(url) {
  await mkdir(CACHE_DIR, { recursive: true });
  const key = createHash("sha256").update(url).digest("hex").slice(0, 32);
  const file = new URL(`./${key}`, CACHE_DIR);
  try {
    return await readFile(file, "utf8");
  } catch {
    // not cached
  }
  const release = await politeSlot();
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" } });
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    const body = await res.text();
    await writeFile(file, body);
    return body;
  } finally {
    release();
  }
}

// Deterministic RNG so perturbation trials reproduce exactly.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
