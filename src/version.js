// One version for the whole service. The API descriptor, the MCP handshake,
// the registry manifest, and the site all read this constant, so they cannot
// disagree about what is deployed.
export const SERVICE_VERSION = "1.6.0";

// "preview" until the published section/diff evaluation at
// https://signalnodus.ai/eval has held its pass thresholds for two
// consecutive weeks; then "beta". The stage is a claim about measured
// reliability, not about ambition.
export const SERVICE_STAGE = "preview";
