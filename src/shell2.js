// The revamped shell. Tokens, type, the chapter rail, motion rules. Every page renders through it.
// Fonts are self-hosted at /fonts.css (see fonts.js), inside the Worker's default-src 'self' policy.
export const SHELL_CSS = String.raw`
:root { --ground:#0A0D14; --panel:#10141E; --line:#1D2433; --text:#E6E9F0; --dim:#8B94A7; --signal:#4FD1A5; --warn:#F7B955;
  --display:"Instrument Serif", Georgia, "Times New Roman", serif; --body:"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif; --mono:"IBM Plex Mono", ui-monospace, "Cascadia Code", Consolas, monospace; }
* { box-sizing: border-box; } html { scroll-behavior: smooth; } @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
html, body { margin: 0; background: var(--ground); color: var(--text); }
body { font: 400 17px/1.6 var(--body); padding-inline: 16px; -webkit-font-smoothing: antialiased; }
a { color: var(--text); text-decoration: underline; text-decoration-color: var(--dim); text-underline-offset: 3px; } a:hover { text-decoration-color: var(--signal); }
:focus-visible { outline: 2px solid var(--signal); outline-offset: 3px; border-radius: 2px; }
.wrap { max-width: 1120px; margin: 0 auto; }
header.site { position: sticky; top: 0; z-index: 10; background: color-mix(in srgb, var(--ground) 82%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
header.site .wrap { display: flex; align-items: center; justify-content: space-between; height: 56px; gap: 16px; }
.mark { font: 400 20px var(--mono); letter-spacing: .14em; color: var(--text); text-decoration: none; } .mark .dot { color: var(--signal); }
nav.top { display: flex; gap: 22px; } nav.top a { font: 400 12px var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--dim); text-decoration: none; } nav.top a[aria-current="page"], nav.top a:hover { color: var(--text); }
.eyebrow { font: 400 12px var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--dim); }
h1, h2 { font: 400 clamp(30px, 4.6vw, 64px)/1.05 var(--display); font-style: italic; letter-spacing: -.01em; margin: 0; text-wrap: balance; max-width: 18ch; }
h2 { font-size: clamp(26px, 3.4vw, 44px); } h3 { font: 500 22px/1.3 var(--body); margin: 0; }
p { max-width: 62ch; margin: 0; } .lede { font-size: 22px; line-height: 1.45; color: var(--text); } .dim { color: var(--dim); }
.stack { display: grid; gap: 18px; } .stack-l { display: grid; gap: 28px; }
section.chapter { padding-block: 96px; border-top: 1px solid var(--line); scroll-margin-top: 64px; } @media (max-width: 720px) { section.chapter { padding-block: 64px; } }
section.chapter .wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 48px; align-items: start; } @media (max-width: 860px) { section.chapter .wrap { grid-template-columns: 1fr; gap: 28px; } }
.hero { position: relative; padding-block: 40px 0; }
.hero .globe-stage { position: relative; height: 70vh; min-height: 420px; max-height: 760px; } @media (max-width: 720px) { .hero .globe-stage { height: 55vh; min-height: 340px; } }
#globe { display: block; width: 100%; height: 100%; }
.hero .thesis { position: absolute; left: 0; right: 0; bottom: 32px; pointer-events: none; } .hero .thesis .wrap { display: grid; gap: 14px; }
.hero .thesis h1 { max-width: 16ch; text-shadow: 0 2px 24px var(--ground); }
.hero .thesis a, .hero .thesis .eyebrow { pointer-events: auto; }
.legend { display: flex; gap: 18px; flex-wrap: wrap; font: 400 12px var(--mono); letter-spacing: .06em; color: var(--dim); }
.legend span::before, .sentinel .dot { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; vertical-align: middle; background: var(--dim); }
.legend .live::before, .sentinel.live .dot { background: var(--signal); } .legend .building::before, .sentinel.building .dot { background: var(--text); }
pre.record { font: 400 14px/1.7 var(--mono); background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 18px 20px; overflow-x: auto; margin: 0; color: var(--text); font-variant-numeric: tabular-nums; }
pre.record b { color: var(--signal); font-weight: 400; }
ul.controls { list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; } ul.controls li { display: grid; grid-template-columns: 28px 1fr; gap: 12px; } ul.controls li::before { content: counter(ctl, decimal-leading-zero); counter-increment: ctl; font: 400 12px var(--mono); color: var(--dim); padding-top: 5px; } ul.controls { counter-reset: ctl; }
#sentinel-list { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 6px 20px; }
.sentinel { padding: 8px 10px; border: 1px solid var(--line); border-radius: 4px; font-size: 14px; cursor: default; } .sentinel:focus-visible, .sentinel:hover { border-color: var(--signal); } .sentinel .dim { display: block; margin-left: 16px; font: 400 12px var(--mono); letter-spacing: .04em; }
.rail { position: fixed; left: 14px; top: 50%; transform: translateY(-50%); z-index: 9; display: grid; gap: 10px; } @media (max-width: 1240px) { .rail { display: none; } }
.rail a { font: 400 11px var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--dim); text-decoration: none; padding: 6px 8px; border-left: 1px solid var(--line); } .rail a[aria-current="true"] { color: var(--text); border-left-color: var(--signal); }
.cta { display: inline-block; font: 500 15px var(--body); color: var(--ground); background: var(--signal); padding: 12px 18px; border-radius: 4px; text-decoration: none; } .cta:hover { filter: brightness(1.06); }
footer { border-top: 1px solid var(--line); margin-top: 96px; padding: 28px 0 56px; color: var(--dim); font: 400 13px var(--mono); letter-spacing: .04em; } footer a { color: var(--dim); }
.reveal { --d: 0ms; } @media (prefers-reduced-motion: no-preference) { .reveal { animation: reveal 700ms var(--d) both cubic-bezier(.2,.7,.2,1); } @keyframes reveal { from { transform: translateY(8px); } to { transform: none; } } }
`;
export function shell2(title, inner, opts = {}) {
  const { canonical = "https://signalnodus.ai/", description = "", current = "/", index = true, rail = null } = opts;
  const nav = [["/", "Home"], ["/review", "Review"], ["/watch", "The Watch"], ["/trust", "Trust"]]
    .map(([h, l]) => `<a href="${h}"${h === current ? ' aria-current="page"' : ""}>${l}</a>`).join("");
  const railHtml = rail ? `<nav class="rail" aria-label="Chapters">${rail.map(([id, l], i) => `<a href="#${id}" data-chapter="${id}" accesskey="${i + 1}">${String(i + 1).padStart(2, "0")} ${l}</a>`).join("")}</nav>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="canonical" href="${canonical}">${index ? "" : '<meta name="robots" content="noindex, nofollow">'}
<meta name="description" content="${description}">
<meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:type" content="website"><meta property="og:site_name" content="Signal Nodus"><meta property="og:url" content="${canonical}">
<link rel="stylesheet" href="/fonts.css">
<style>${SHELL_CSS}</style>
</head>
<body>
<header class="site"><div class="wrap"><a class="mark" href="/">SIGNAL<span class="dot">·</span>NODUS</a><nav class="top" aria-label="Site">${nav}</nav></div></header>
${railHtml}
${inner}
<footer><div class="wrap">Signal Nodus · human-owned · <a href="/review">review</a> · <a href="/watch">the watch</a> · <a href="/trust">trust</a> · <a href="/status">status</a></div></footer>
<script src="/site2.js" defer></script>
</body>
</html>`;
}
export const SITE2_JS = String.raw`
(function () {
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
