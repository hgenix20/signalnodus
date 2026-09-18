// What kind of network a request came from, and whether that hides where the agent really is.
// Heuristic from the ASN and its name: good enough to count, not proof about any one request.
import { DATACENTER_ASNS } from "./analytics.js";

// Networks known to carry commercial VPN exits (the provider's own ASN or the hosts they rent from).
const VPN_ASNS = new Set([9009 /* M247 */, 60068, 212238 /* Datacamp / CDN77 */, 39351, 31173 /* Mullvad hosts */, 62371, 209103 /* Proton */, 136787 /* TEFINCOM (NordVPN) */, 147049 /* PacketHub (NordVPN) */, 206092 /* SECURED SERVERS (IPVanish) */, 51852 /* Private Layer */]);
// iCloud Private Relay and similar relays egress through these.
const RELAY_ASNS = new Set([36183 /* Akamai Private Relay */, 54113 /* Fastly */]);
const VPN_WORDS = /\b(vpn|proxy|nord|express ?vpn|surfshark|mullvad|proton|private internet access|ipvanish|windscribe|tunnel|anonym)/i;

export function netKind({ asn, org, country }) {
  const a = Number(asn) || 0;
  if (country === "T1") return { kind: "tor", hidden: true, label: "Tor exit" };
  if (a === 13335 || a === 209242) return { kind: "cloudflare", hidden: true, label: "Cloudflare (WARP VPN or Workers)" };
  if (RELAY_ASNS.has(a)) return { kind: "relay", hidden: true, label: "Privacy relay (e.g. iCloud Private Relay)" };
  if (VPN_ASNS.has(a) || VPN_WORDS.test(org || "")) return { kind: "vpn", hidden: true, label: "VPN provider" };
  if (DATACENTER_ASNS.has(a)) return { kind: "hosting", hidden: true, label: "Cloud or hosting (likely a proxy or a server)" };
  return { kind: "direct", hidden: false, label: "Consumer or business network" };
}
