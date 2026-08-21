// Onchain cluster: EVM reads and token market data for trading agents.
//
// Why this exists: the x402 seller leaderboard is explicit about what buyers
// pay for. OneSource serves plain EVM RPC to 1,621 distinct buyers; the
// trading-intel sellers (SniperX, Deepnets, Otto) monetize token data. Both
// run on upstreams that are free public infrastructure, so the product is
// reliability, normalization, and a paywall an agent can actually settle.
//
// Every upstream here is keyless. Nothing in this module can spend the
// operator's money no matter how hard it is hammered.

const RPC = {
  base: "https://mainnet.base.org",
  ethereum: "https://ethereum-rpc.publicnode.com",
  arbitrum: "https://arbitrum-one-rpc.publicnode.com",
};

const GECKO = "https://api.geckoterminal.com/api/v2";
const UA = "SignalNodus/0.3 (hgenix@agentmail.to)";

class OnchainError extends Error {}

function chainOf(args) {
  const c = String(args.chain || "base").toLowerCase();
  if (!RPC[c]) throw new OnchainError(`unsupported chain "${c}"; use one of: ${Object.keys(RPC).join(", ")}`);
  return c;
}

function requireAddress(x, label) {
  const a = String(x || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new OnchainError(`${label} must be a 0x-prefixed 40-hex address`);
  return a.toLowerCase();
}

function requireHash(x) {
  const h = String(x || "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new OnchainError("tx must be a 0x-prefixed 64-hex transaction hash");
  return h.toLowerCase();
}

async function rpc(chain, method, params) {
  const res = await fetch(RPC[chain], {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new OnchainError(`upstream RPC returned ${res.status}`);
  const body = await res.json();
  if (body.error) throw new OnchainError(`RPC error: ${String(body.error.message || body.error.code).slice(0, 120)}`);
  return body.result;
}

const hexToDec = (h) => (h == null ? null : String(BigInt(h)));

// ------------------------------------------------------------------- tools

export async function toolEvmBalance(args) {
  const chain = chainOf(args);
  const address = requireAddress(args.address, "address");
  const [wei, block] = await Promise.all([
    rpc(chain, "eth_getBalance", [address, "latest"]),
    rpc(chain, "eth_blockNumber", []),
  ]);
  return {
    chain,
    address,
    balanceWei: hexToDec(wei),
    balanceEth: Number(BigInt(wei)) / 1e18,
    atBlock: hexToDec(block),
  };
}

export async function toolEvmGas(args) {
  const chain = chainOf(args);
  const [gasPrice, block] = await Promise.all([
    rpc(chain, "eth_gasPrice", []),
    rpc(chain, "eth_blockNumber", []),
  ]);
  return {
    chain,
    gasPriceWei: hexToDec(gasPrice),
    gasPriceGwei: Number(BigInt(gasPrice)) / 1e9,
    atBlock: hexToDec(block),
  };
}

export async function toolEvmReceipt(args) {
  const chain = chainOf(args);
  const hash = requireHash(args.tx);
  const r = await rpc(chain, "eth_getTransactionReceipt", [hash]);
  if (!r) return { chain, tx: hash, found: false, note: "no receipt; the transaction is unknown or still pending" };
  return {
    chain,
    tx: hash,
    found: true,
    status: r.status === "0x1" ? "success" : "reverted",
    blockNumber: hexToDec(r.blockNumber),
    from: r.from,
    to: r.to,
    gasUsed: hexToDec(r.gasUsed),
    effectiveGasPriceWei: hexToDec(r.effectiveGasPrice),
    logCount: (r.logs || []).length,
  };
}

export async function toolTokenPrice(args, ctx) {
  const chain = chainOf(args);
  const network = chain === "ethereum" ? "eth" : chain;
  const address = requireAddress(args.token, "token");

  // Market data moves fast but not per-request fast; a 60s cache keeps a
  // polling swarm from hammering a free upstream.
  const url = `${GECKO}/networks/${network}/tokens/${address}`;
  // caches exists in Workers; guard for any other runtime.
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(url);
  let res = cache ? await cache.match(key) : null;
  if (!res) {
    res = await fetch(url, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) throw new OnchainError("token not found on this network");
    if (!res.ok) throw new OnchainError(`market data upstream returned ${res.status}`);
    res = new Response(await res.text(), { headers: { "cache-control": "public, max-age=60", "content-type": "application/json" } });
    if (cache) ctx?.waitUntil?.(cache.put(key, res.clone()));
  }
  const a = (await res.json())?.data?.attributes || {};
  return {
    chain,
    token: address,
    name: a.name || null,
    symbol: a.symbol || null,
    decimals: a.decimals ?? null,
    priceUsd: a.price_usd != null ? Number(a.price_usd) : null,
    fdvUsd: a.fdv_usd != null ? Number(a.fdv_usd) : null,
    marketCapUsd: a.market_cap_usd != null ? Number(a.market_cap_usd) : null,
    volume24hUsd: a.volume_usd?.h24 != null ? Number(a.volume_usd.h24) : null,
    totalSupply: a.total_supply ?? null,
    note: "Price via GeckoTerminal aggregated DEX data, cached 60s. Not an oracle; do not settle contracts on it.",
  };
}


// ---------------------------------------------------- gas optimizer

const COINGECKO_SIMPLE = "https://api.coingecko.com/api/v3/simple/price";

// ETH price in USD, keyless, cached 60s. Used to turn a gas price into a
// dollar cost so a caller can compare chains on money, not gwei.
async function ethUsd(ctx) {
  const url = `${COINGECKO_SIMPLE}?ids=ethereum&vs_currencies=usd`;
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(url);
  let res = cache ? await cache.match(key) : null;
  if (!res) {
    res = await fetch(url, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    res = new Response(await res.text(), { headers: { "cache-control": "public, max-age=60", "content-type": "application/json" } });
    if (cache) ctx?.waitUntil?.(cache.put(key, res.clone()));
  }
  const v = (await res.json())?.ethereum?.usd;
  return typeof v === "number" ? v : null;
}

// A standard native transfer is 21,000 gas; use it as the yardstick so the
// USD estimate is comparable across chains regardless of what the caller sends.
const TRANSFER_GAS = 21000n;

export async function toolGasOptimizer(args, ctx) {
  // Default to the three chains we serve; a caller can narrow with `chains`.
  const requested = String(args.chains || "base,arbitrum,ethereum")
    .split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
  const chains = requested.filter((c) => RPC[c]);
  if (!chains.length) throw new OnchainError(`no supported chains in "${args.chains}"; use base, arbitrum, ethereum`);

  const eth = await ethUsd(ctx);

  const rows = await Promise.all(chains.map(async (chain) => {
    try {
      const gasPrice = await rpc(chain, "eth_gasPrice", []);
      const gwei = Number(BigInt(gasPrice)) / 1e9;
      const feeWei = BigInt(gasPrice) * TRANSFER_GAS;
      const feeEth = Number(feeWei) / 1e18;
      return {
        chain,
        gasPriceGwei: Math.round(gwei * 1e6) / 1e6,
        transferFeeEth: Math.round(feeEth * 1e9) / 1e9,
        transferFeeUsd: eth != null ? Math.round(feeEth * eth * 1e6) / 1e6 : null,
      };
    } catch (err) {
      return { chain, error: String(err?.message || err).slice(0, 120) };
    }
  }));

  const priced = rows.filter((r) => typeof r.transferFeeUsd === "number");
  const cheapest = priced.length
    ? priced.reduce((a, b) => (b.transferFeeUsd < a.transferFeeUsd ? b : a)).chain
    : (rows.find((r) => !r.error)?.chain || null);

  return {
    ethUsd: eth,
    referenceTx: "native transfer (21,000 gas)",
    chains: rows,
    cheapest,
    note:
      "Live base fee per chain via public RPC, turned into the USD cost of a standard native transfer so chains compare on money. " +
      "This is the network fee only, not a route or a swap quote, and it is data, not financial advice.",
  };
}

// ---------------------------------------------------- token report

// One-call token due-diligence data. ArmaBase sells a DexScreener pull at
// $0.10; this combines the token's market attributes with its deepest pool and
// adds factual risk flags (low liquidity, thin volume) that are observations,
// not recommendations.
export async function toolTokenReport(args, ctx) {
  const chain = chainOf(args);
  const network = chain === "ethereum" ? "eth" : chain;
  const address = requireAddress(args.token, "token");
  const cache = typeof caches !== "undefined" ? caches.default : null;

  const getJson = async (url, ttl) => {
    const key = new Request(url);
    let res = cache ? await cache.match(key) : null;
    if (!res) {
      res = await fetch(url, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(10_000) });
      if (res.status === 404) throw new OnchainError("token not found on this network");
      if (!res.ok) throw new OnchainError(`market data upstream returned ${res.status}`);
      res = new Response(await res.text(), { headers: { "cache-control": `public, max-age=${ttl}`, "content-type": "application/json" } });
      if (cache) ctx?.waitUntil?.(cache.put(key, res.clone()));
    }
    return res.json();
  };

  const [tokenRes, poolsRes] = await Promise.all([
    getJson(`${GECKO}/networks/${network}/tokens/${address}`, 60),
    getJson(`${GECKO}/networks/${network}/tokens/${address}/pools?page=1`, 60).catch(() => null),
  ]);

  const a = tokenRes?.data?.attributes || {};
  const pools = Array.isArray(poolsRes?.data) ? poolsRes.data : [];
  // Deepest pool by reserve, for the liquidity + 24h price move figures.
  const top = pools
    .map((p) => p.attributes || {})
    .sort((x, y) => Number(y.reserve_in_usd || 0) - Number(x.reserve_in_usd || 0))[0] || null;

  const liquidityUsd = top?.reserve_in_usd != null ? Number(top.reserve_in_usd) : null;
  const volume24hUsd = a.volume_usd?.h24 != null ? Number(a.volume_usd.h24) : null;
  const priceChange24hPct = top?.price_change_percentage?.h24 != null ? Number(top.price_change_percentage.h24) : null;

  // Factual flags, not advice: thresholds describe the data, the caller decides.
  const flags = [];
  if (liquidityUsd != null && liquidityUsd < 10_000) flags.push("low_liquidity_under_10k");
  if (volume24hUsd != null && volume24hUsd < 1_000) flags.push("thin_volume_under_1k_24h");
  if (pools.length === 0) flags.push("no_dex_pools_found");

  return {
    chain,
    token: address,
    name: a.name || null,
    symbol: a.symbol || null,
    decimals: a.decimals ?? null,
    priceUsd: a.price_usd != null ? Number(a.price_usd) : null,
    priceChange24hPct,
    fdvUsd: a.fdv_usd != null ? Number(a.fdv_usd) : null,
    marketCapUsd: a.market_cap_usd != null ? Number(a.market_cap_usd) : null,
    volume24hUsd,
    totalSupply: a.total_supply ?? null,
    poolCount: pools.length,
    topPool: top ? { name: top.name || null, liquidityUsd, dex: top.dex_id || null } : null,
    flags,
    note:
      "Token market data via GeckoTerminal aggregated DEX pools, cached 60s. Flags are factual thresholds on the data, not " +
      "recommendations; this is not an oracle and not financial advice. A missing field means the upstream did not report it.",
  };
}
