import { canaryHtml } from "./swarms.js";
// The revamped shell. Tokens, type, the chapter rail, motion rules. Every page renders through it.
// Fonts are self-hosted at /fonts.css (see fonts.js) and this shell's CSS at /site2.css: the Worker's
// policy is style-src 'self', which refuses an inline <style> block and inline style attributes alike.
export const SHELL_CSS = String.raw`
:root { --ground:#F8FAFC; --panel:#FFFFFF; --muted:#E9EEF5; --line:#CBD5E1; --text:#0F172A; --dim:#475569; --signal:#0E8F6B; --signal-ink:#0B6B50; --warn:#B45309; --band:#0B1120; --band-text:#E2E8F0; --band-dim:#94A3B8; --band-line:#1E293B;
  --display:"Instrument Serif", Georgia, "Times New Roman", serif; --body:"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif; --mono:"IBM Plex Mono", ui-monospace, "Cascadia Code", Consolas, monospace; }
* { box-sizing: border-box; } html { scroll-behavior: smooth; } @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
html, body { margin: 0; background: var(--ground); color: var(--text); }
body { font: 400 17px/1.6 var(--body); padding-inline: 16px; -webkit-font-smoothing: antialiased; }
a { color: var(--text); text-decoration: underline; text-decoration-color: var(--dim); text-underline-offset: 3px; } a:hover { text-decoration-color: var(--signal); }
:focus-visible { outline: 2px solid var(--signal); outline-offset: 3px; border-radius: 2px; }
.wrap { max-width: 1120px; margin: 0 auto; }
header.site { position: sticky; top: 0; z-index: 10; background: color-mix(in srgb, var(--ground) 90%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); margin-inline: -16px; padding-inline: 16px; }
header.site .wrap { display: flex; align-items: center; justify-content: space-between; height: 60px; gap: 16px; }
.mark { font: 400 20px var(--mono); letter-spacing: .14em; color: var(--text); text-decoration: none; padding: 8px 0; } .mark .dot { color: var(--signal); }
nav.top { display: flex; gap: 6px; } nav.top a { font: 500 14px var(--body); color: var(--dim); text-decoration: none; padding: 10px 12px; min-height: 44px; display: inline-flex; align-items: center; border-radius: 4px; } nav.top a[aria-current="page"] { color: var(--text); background: var(--muted); } nav.top a:hover { color: var(--text); }
.menu-btn { display: none; font: 500 14px var(--body); color: var(--text); background: transparent; border: 1px solid var(--line); border-radius: 4px; padding: 0 14px; min-height: 44px; cursor: pointer; }
@media (max-width: 720px) { .menu-btn { display: inline-flex; align-items: center; gap: 8px; } nav.top { display: none; position: absolute; left: 0; right: 0; top: 60px; flex-direction: column; gap: 0; background: var(--panel); border-bottom: 1px solid var(--line); padding: 8px 16px 12px; box-shadow: 0 12px 30px rgba(15,23,42,.08); } nav.top[data-open="true"] { display: flex; } nav.top a { min-height: 48px; font-size: 16px; padding: 10px 8px; border-radius: 4px; } }
.eyebrow { font: 400 12px var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--dim); }
h1, h2 { font: 400 clamp(32px, 5.6vw, 80px)/1.04 var(--display); font-style: italic; letter-spacing: -.01em; margin: 0; text-wrap: balance; max-width: 18ch; }
h2 { font-size: clamp(28px, 3.6vw, 48px); } h3 { font: 500 21px/1.3 var(--body); margin: 0; }
p { max-width: 62ch; margin: 0; } .lede { font-size: 22px; line-height: 1.45; color: var(--text); } .dim { color: var(--dim); }
.stack { display: grid; gap: 18px; } .stack-l { display: grid; gap: 28px; }
section.chapter { padding-block: 104px; border-top: 1px solid var(--line); scroll-margin-top: 64px; } @media (max-width: 720px) { section.chapter { padding-block: 56px; } h3 { font-size: 19px; } .lede { font-size: 19px; } body { font-size: 16px; } }
section.chapter .wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 48px; align-items: start; } @media (max-width: 860px) { section.chapter .wrap { grid-template-columns: 1fr; gap: 28px; } }
.hero { position: relative; background: var(--band); color: var(--band-text); margin-inline: -16px; padding: 28px 16px 36px; } .hero .eyebrow { color: var(--band-dim); } .hero .dim { color: var(--band-dim); } .hero a { color: var(--band-text); }
.hero .wrap { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 32px; align-items: center; } .hero .globe-stage { position: relative; height: clamp(420px, 68vh, 720px); }
@media (max-width: 860px) { .hero .wrap { grid-template-columns: 1fr; gap: 8px; } .hero .globe-stage { height: clamp(260px, 44vh, 400px); } }
@media (max-height: 480px) and (orientation: landscape) { .hero .globe-stage { height: clamp(200px, 70vh, 320px); } .hero .wrap { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; } .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.globe-controls { display: flex; gap: 10px; align-items: center; margin-top: 8px; } .globe-controls button { font: 500 13px var(--body); color: var(--band-text); background: transparent; border: 1px solid var(--band-line); border-radius: 4px; padding: 10px 14px; min-height: 44px; min-width: 44px; cursor: pointer; transition: background 150ms, border-color 150ms; } .globe-controls button:hover { border-color: var(--band-dim); background: rgba(255,255,255,.04); } .globe-controls button[aria-pressed="true"] { background: rgba(255,255,255,.08); }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 18px; } @media (max-width: 480px) { .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; } }
.stat { border: 1px solid var(--band-line); border-radius: 4px; padding: 12px 14px; } .stat b { display: block; font: 400 clamp(26px, 3vw, 36px)/1 var(--display); font-style: italic; color: var(--band-text); font-variant-numeric: tabular-nums; } .stat span { display: block; margin-top: 6px; font: 400 11px var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--band-dim); }
canvas[data-globe] { display: block; width: 100%; height: 100%; max-width: 100%; touch-action: pan-y; }
.hero .globe-stage { width: 100%; }
.hero .thesis { display: grid; gap: 16px; padding-block: 12px; } .hero .thesis h1 { max-width: 15ch; }
.legend { display: flex; gap: 18px; flex-wrap: wrap; font: 400 12px var(--mono); letter-spacing: .06em; color: var(--band-dim); margin-top: 10px; }
.legend span::before, .sentinel .dot { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; vertical-align: middle; background: var(--dim); }
.legend .live::before, .sentinel.live .dot { background: #4FD1A5; } .legend .building::before, .sentinel.building .dot { background: #7AA2F7; } .legend span::before { background: #8B94A7; }
pre.record { font: 400 14px/1.7 var(--mono); background: var(--band); color: var(--band-text); border: 1px solid var(--band-line); border-radius: 4px; padding: 18px 20px; overflow-x: auto; margin: 0; font-variant-numeric: tabular-nums; }
pre.record b { color: #4FD1A5; font-weight: 400; }
ul.controls { list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; } ul.controls li { display: grid; grid-template-columns: 28px 1fr; gap: 12px; } ul.controls li::before { content: counter(ctl, decimal-leading-zero); counter-increment: ctl; font: 400 12px var(--mono); color: var(--dim); padding-top: 5px; } ul.controls { counter-reset: ctl; }
#sentinel-list { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 6px 20px; }
.sentinel { padding: 10px 12px; min-height: 44px; border: 1px solid var(--line); background: var(--panel); border-radius: 4px; font-size: 14px; cursor: default; } .sentinel:focus-visible, .sentinel:hover { border-color: var(--signal); } .sentinel .dim { display: block; margin-left: 16px; font: 400 12px var(--mono); letter-spacing: .04em; }
.rail { position: fixed; left: 14px; top: 50%; transform: translateY(-50%); z-index: 9; display: grid; gap: 10px; } @media (max-width: 1240px) { .rail { display: none; } }
.rail a { font: 400 11px var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--dim); text-decoration: none; padding: 6px 8px; border-left: 1px solid var(--line); } .rail a[aria-current="true"] { color: var(--text); border-left-color: var(--signal); }
.cta { display: inline-flex; align-items: center; font: 500 15px var(--body); color: #fff; background: var(--signal-ink); padding: 0 20px; border-radius: 4px; text-decoration: none; min-height: 48px; transition: background 150ms; cursor: pointer; } .cta:hover { background: var(--signal); } .cta.ghost { color: var(--text); background: transparent; border: 1px solid var(--line); } .cta.ghost:hover { background: var(--muted); } .hero .cta.ghost { color: var(--band-text); border-color: var(--band-line); } .hero .cta.ghost:hover { background: rgba(255,255,255,.06); } .cta:hover { filter: brightness(1.06); }
footer { border-top: 1px solid var(--line); margin-top: 104px; padding: 28px 0 56px; color: var(--dim); font: 400 13px var(--mono); letter-spacing: .04em; } footer a { color: var(--dim); }
.proof { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; } .proof .item { background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 20px; } .proof .item h3 { font-size: 17px; } .proof .item p { font-size: 15px; margin-top: 8px; }
.reveal { --d: 0ms; } @media (prefers-reduced-motion: no-preference) { .reveal { animation: reveal 700ms var(--d) both cubic-bezier(.2,.7,.2,1); } @keyframes reveal { from { transform: translateY(8px); } to { transform: none; } } }

/* Long-form pages (privacy, terms, the gate): section heads, a record table, and code. */
.stack-l h2 { font: 400 clamp(24px, 2.6vw, 32px) var(--display); font-style: italic; margin: 12px 0 -8px; }
.scroll { overflow-x: auto; }
table.rec { width: 100%; border-collapse: collapse; font-size: 15px; line-height: 1.5; }
table.rec th { text-align: left; font: 500 12px var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--dim); padding: 10px 12px 10px 0; border-bottom: 1px solid var(--line); }
table.rec td { vertical-align: top; padding: 12px 12px 12px 0; border-bottom: 1px solid var(--muted); color: var(--dim); min-width: 14ch; }
table.rec td:first-child { color: var(--text); }
code { font: 400 .92em var(--mono); background: var(--muted); padding: 1px 5px; border-radius: 3px; }
pre.code { font: 400 14px/1.6 var(--mono); background: var(--band); color: var(--band-text); padding: 16px 18px; border-radius: 6px; overflow-x: auto; white-space: pre; }

/* Utilities. The Worker's policy is style-src 'self', so nothing may be styled inline. */
.mw48{max-width:48ch}.mw44{max-width:44ch}.row{display:flex;gap:10px;flex-wrap:wrap}.mt14{margin-top:14px}.bt0{border-top:0}.fs14{font-size:14px}
/* ---- Revamp 2026-09-18: design-system/signal-nodus/MASTER.md overrides (dark trust navy, Inter, one accent per product) ---- */
:root { --ground:#020617; --ground-2:#0B1426; --panel:#0F1B33; --panel-2:#0C1528; --muted:#111C33; --line:#1E2A44; --text:#E2E8F0; --fg:#F8FAFC; --dim:#A8B3C7; --signal:#FBBF24; --signal-ink:#FBBF24; --warn:#F87171; --band:#0B1426; --band-text:#F8FAFC; --band-dim:#A8B3C7; --band-line:#1E2A44;
  --canary:#FBBF24; --sentinel:#60A5FA; --tripwire:#F87171; --ink-on-canary:#0B1426;
  --display:"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; --body:"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
html, body { background: linear-gradient(160deg, var(--ground) 0%, var(--ground-2) 100%) fixed; color: var(--text); }
body { font: 400 17px/1.6 var(--body); }
a { color: var(--fg); text-decoration-color: #3B4A66; } a:hover { text-decoration-color: var(--canary); }
:focus-visible { outline: 2px solid var(--canary); }
header.site { background: color-mix(in srgb, var(--ground) 82%, transparent); border-bottom-color: var(--line); }
.mark { color: var(--fg); } .mark .dot { color: var(--canary); }
nav.top a { color: var(--dim); } nav.top a:hover { color: var(--fg); } nav.top a[aria-current="page"] { color: var(--fg); background: var(--muted); }
.menu-btn { color: var(--fg); border-color: var(--line); }
@media (max-width: 720px) { nav.top { background: var(--panel); border-color: var(--line); } }
h1, h2 { font: 800 clamp(34px, 5.2vw, 64px)/1.06 var(--display); font-style: normal; letter-spacing: -.025em; color: var(--fg); }
h2 { font-weight: 700; font-size: clamp(26px, 3.2vw, 40px); letter-spacing: -.015em; }
h3 { font: 600 20px/1.35 var(--body); color: var(--fg); }
.eyebrow { font: 600 12px var(--body); letter-spacing: .16em; color: var(--dim); }
.lede { color: var(--text); } .dim { color: var(--dim); }
section.chapter { border-top-color: var(--line); }
.hero { background: transparent; }
.cta { font: 600 15px var(--body); color: var(--ink-on-canary); background: var(--canary); border-radius: 10px; padding: 0 22px; box-shadow: 0 6px 20px rgba(251,191,36,.18); transition: transform 180ms ease, box-shadow 180ms ease; }
.cta:hover { background: #FCD34D; transform: translateY(-1px); box-shadow: 0 10px 26px rgba(251,191,36,.26); }
.cta.ghost { color: var(--fg); background: transparent; border: 1px solid var(--line); box-shadow: none; } .cta.ghost:hover { border-color: var(--dim); background: var(--muted); }
@media (prefers-reduced-motion: reduce) { .cta, .cta:hover { transition: none; transform: none; } }
.stat, .sentinel, pre.record { background: var(--panel); border-color: var(--line); border-radius: 12px; }
footer { border-top-color: var(--line); color: var(--dim); font: 400 13px var(--body); } footer a { color: var(--dim); }
/* Home revamp */
.hx { padding-block: 72px 56px; } .hx .wrap { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 56px; align-items: center; }
@media (max-width: 900px) { .hx { padding-block: 40px 32px; } .hx .wrap { grid-template-columns: 1fr; gap: 32px; } }
.hx h1 { max-width: 13ch; } .hx .lede { max-width: 40ch; color: var(--dim); margin-top: 18px; }
.hx .row { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 28px; }
.proofpill { display: inline-flex; align-items: center; gap: 10px; margin-top: 28px; padding: 10px 16px; border: 1px solid var(--line); border-radius: 999px; background: var(--muted); font: 600 14px var(--body); color: var(--fg); text-decoration: none; }
.proofpill::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--tripwire); box-shadow: 0 0 0 4px rgba(248,113,113,.18); }
.products { display: grid; gap: 16px; }
.product { position: relative; display: grid; grid-template-columns: 56px 1fr; gap: 18px; align-items: start; padding: 22px 22px 22px 26px; border: 1px solid var(--line); border-radius: 18px; background: linear-gradient(90deg, var(--panel), var(--panel-2)); text-decoration: none; color: inherit; transition: border-color 180ms ease, transform 180ms ease; }
.product::before { content: ""; position: absolute; left: 0; top: 18px; bottom: 18px; width: 4px; border-radius: 2px; background: var(--accent); }
.product:hover { border-color: var(--accent); transform: translateY(-2px); } @media (prefers-reduced-motion: reduce) { .product, .product:hover { transition: none; transform: none; } }
.product .ic { width: 56px; height: 56px; border-radius: 14px; display: grid; place-items: center; background: color-mix(in srgb, var(--accent) 12%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); }
.product .ic svg { width: 28px; height: 28px; stroke: var(--accent); fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.product h3 { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.product .tag { font: 600 11px var(--body); letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
.product p { color: var(--dim); margin-top: 6px; font-size: 16px; }
.product.canary { --accent: var(--canary); } .product.sentinel { --accent: var(--sentinel); } .product.tripwire { --accent: var(--tripwire); }
.steps { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; counter-reset: st; }
@media (max-width: 860px) { .steps { grid-template-columns: 1fr; } }
.steps li { counter-increment: st; border: 1px solid var(--line); border-radius: 16px; padding: 22px; background: var(--panel); }
.steps li::before { content: counter(st); display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--muted); color: var(--canary); font: 700 15px var(--body); margin-bottom: 12px; }
.proof .item { border-color: var(--line); background: var(--panel); border-radius: 14px; }
/* Waitlist form (/mind), shared look with the rest of the shell. */
.waitlist-form { margin-top: 18px; }
.waitlist-form label { display: block; font-size: .9em; color: var(--dim); margin-bottom: 8px; }
.waitlist-form input[type=email] { flex: 1 1 220px; min-width: 0; min-height: 44px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); font: 400 16px var(--body); }
.waitlist-form input[type=email]:focus-visible { outline: 2px solid var(--canary); outline-offset: 2px; }
.waitlist-form .hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.waitlist-msg { margin-top: 10px; }
`;
export function shell2(title, inner, opts = {}) {
  const { canonical = "https://signalnodus.ai/", description = "", current = "/", index = true, rail = null } = opts;
  // The service leads; the review, the gate and swarms keep their URLs and live in the footer.
  const nav = [["/", "Home"], ["/service", "The service"], ["/qualify", "Check fit"], ["/canary", "Free canary"], ["/watch", "The Watch"], ["/trust", "Trust"]]
    .map(([h, l]) => `<a href="${h}"${h === current ? ' aria-current="page"' : ""}>${l}</a>`).join("");
  const railHtml = rail ? `<nav class="rail" aria-label="Chapters">${rail.map(([id, l], i) => `<a href="#${id}" data-chapter="${id}" accesskey="${i + 1}">${String(i + 1).padStart(2, "0")} ${l}</a>`).join("")}</nav>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="canonical" href="${canonical}">${index ? "" : '<meta name="robots" content="noindex, nofollow">'}
<meta name="description" content="${description}">
<meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:type" content="website"><meta property="og:site_name" content="Signal Nodus"><meta property="og:url" content="${canonical}"><meta property="og:image" content="https://signalnodus.ai/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="675"><meta property="og:image:alt" content="Signal Nodus: canaries, sentinels and tripwires that catch AI agents working your site"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="https://signalnodus.ai/og.png">
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", name: "Signal Nodus", url: "https://signalnodus.ai/", email: "hgenix@agentmail.to", description })}</script>
<link rel="stylesheet" href="/fonts.css">
<link rel="stylesheet" href="/site2.css">
</head>
<body>
<header class="site"><div class="wrap"><a class="mark" href="/">SIGNAL<span class="dot">·</span>NODUS</a><button type="button" class="menu-btn" aria-expanded="false" aria-controls="site-nav">Menu</button><nav class="top" id="site-nav" aria-label="Site">${nav}</nav></div></header>
${railHtml}
${inner}
<footer><div class="wrap">Signal Nodus · human-owned · <a href="/review">review</a> · <a href="/watch">the watch</a> · <a href="/gate">the gate</a> · <a href="/trust">trust</a> · <a href="/swarms">swarm watch</a> · <a href="/status">status</a> · <a href="/privacy">privacy</a> · <a href="/terms">terms</a></div>${canaryHtml(current)}</footer>
<script src="/site2.js" defer></script>
<script src="/a.js" defer></script>
</body>
</html>`;
}
export const SITE2_JS = String.raw`
(function () {
  const mb = document.querySelector(".menu-btn"), nav = document.getElementById("site-nav");
  if (mb && nav) { mb.addEventListener("click", () => { const open = nav.getAttribute("data-open") === "true"; nav.setAttribute("data-open", String(!open)); mb.setAttribute("aria-expanded", String(!open)); mb.textContent = open ? "Menu" : "Close"; }); nav.addEventListener("click", e => { if (e.target.closest("a")) { nav.setAttribute("data-open", "false"); mb.setAttribute("aria-expanded", "false"); mb.textContent = "Menu"; } }); addEventListener("keydown", e => { if (e.key === "Escape" && nav.getAttribute("data-open") === "true") { nav.setAttribute("data-open", "false"); mb.setAttribute("aria-expanded", "false"); mb.textContent = "Menu"; mb.focus(); } }); }
  const rail = document.querySelector(".rail"); if (!rail) return;
  const links = [...rail.querySelectorAll("a")]; const ids = links.map(a => a.dataset.chapter);
  const secs = ids.map(id => document.getElementById(id)).filter(Boolean);
  function mark(id) { links.forEach(a => a.setAttribute("aria-current", String(a.dataset.chapter === id))); }
  const io = new IntersectionObserver(es => { es.forEach(e => { if (e.isIntersecting) mark(e.target.id); }); }, { rootMargin: "-40% 0px -50% 0px" });
  secs.forEach(s => io.observe(s));
  addEventListener("keydown", e => { if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    const cur = Math.max(0, ids.indexOf(links.find(a => a.getAttribute("aria-current") === "true")?.dataset.chapter));
    let n = null; if (e.key === "ArrowDown" || e.key === "j") n = Math.min(ids.length - 1, cur + 1); if (e.key === "ArrowUp" || e.key === "k") n = Math.max(0, cur - 1); if (/^[1-9]$/.test(e.key)) n = Math.min(ids.length - 1, +e.key - 1);
    if (n !== null && secs[n]) { e.preventDefault(); secs[n].scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); secs[n].focus({ preventScroll: true }); } });
})();
`;
