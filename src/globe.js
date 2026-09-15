// The Watch globe: an orthographic Earth drawn on a canvas from a small coastline set, with every
// sentinel from /watch/sentinels.json plotted at its source's location. No library: the site's
// content-security-policy is default-src 'self', and a globe is a few hundred lines, not a dependency.
// Served as /globe.js; the page gives it a <canvas id="globe"> and a <ul id="sentinel-list">.
export const GLOBE_JS = String.raw`
(function () {
  const canvas = document.getElementById("globe"); if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const list = document.getElementById("sentinel-list");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const COL = { sea: "#0b0e14", land: "#1a2130", line: "#2a3346", grid: "#151b27", live: "#4fd1a5", building: "#7aa2f7", planned: "#8a93a6", text: "#d7dce6" };
  let sentinels = [], coast = null, rot = -60, tilt = 18, dpr = Math.min(2, devicePixelRatio || 1), hover = null;
  function size() { const w = canvas.clientWidth, h = canvas.clientHeight; canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  const rad = d => d * Math.PI / 180;
  function project(lat, lon, R, cx, cy) {
    const la = rad(lat), lo = rad(lon + rot), t = rad(tilt);
    const x = Math.cos(la) * Math.sin(lo), y = Math.sin(la), z = Math.cos(la) * Math.cos(lo);
    const y2 = y * Math.cos(t) - z * Math.sin(t), z2 = y * Math.sin(t) + z * Math.cos(t);
    return { x: cx + R * x, y: cy - R * y2, front: z2 > 0, depth: z2 };
  }
  function draw() {
    const w = canvas.clientWidth, h = canvas.clientHeight, cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.42;
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = COL.sea; ctx.fill(); ctx.strokeStyle = COL.line; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 0.6;
    for (let lat = -60; lat <= 60; lat += 30) { ctx.beginPath(); let started = false; for (let lon = -180; lon <= 180; lon += 3) { const p = project(lat, lon, R, cx, cy); if (!p.front) { started = false; continue; } if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y); } ctx.stroke(); }
    for (let lon = -180; lon < 180; lon += 30) { ctx.beginPath(); let started = false; for (let lat = -90; lat <= 90; lat += 3) { const p = project(lat, lon, R, cx, cy); if (!p.front) { started = false; continue; } if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y); } ctx.stroke(); }
    if (coast) { ctx.fillStyle = COL.land; ctx.strokeStyle = COL.line; ctx.lineWidth = 0.8; for (const ring of coast) { ctx.beginPath(); let started = false, any = false; for (const [lon, lat] of ring) { const p = project(lat, lon, R, cx, cy); if (!p.front) { started = false; continue; } any = true; if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y); } if (any) { ctx.closePath(); ctx.fill(); ctx.stroke(); } } }
    const pts = sentinels.map(s => Object.assign({ s }, project(s.lat, s.lon, R, cx, cy))).filter(p => p.front).sort((a, b) => a.depth - b.depth);
    for (const p of pts) { const c = p.s.status === "live" ? COL.live : p.s.status === "building" ? COL.building : COL.planned; const r = hover === p.s.id ? 6 : 4;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2); ctx.fillStyle = c + "22"; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); p.r = r; }
    canvas._pts = pts;
    if (hover) { const p = pts.find(q => q.s.id === hover); if (p) { ctx.font = "13px ui-monospace, Consolas, monospace"; ctx.fillStyle = COL.text; ctx.fillText(p.s.name + " · " + p.s.city, Math.min(p.x + 10, w - 240), p.y - 10); } }
  }
  function tick() { if (!reduced && !hover) rot += 0.08; draw(); requestAnimationFrame(tick); }
  canvas.addEventListener("mousemove", e => { const b = canvas.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top; const hit = (canvas._pts || []).find(p => Math.hypot(p.x - x, p.y - y) < 10); hover = hit ? hit.s.id : null; canvas.style.cursor = hit ? "pointer" : "default"; });
  canvas.addEventListener("mouseleave", () => { hover = null; });
  function render(data) { sentinels = data.sentinels || []; if (list) { list.innerHTML = ""; for (const s of sentinels) { const li = document.createElement("li"); li.className = "sentinel " + s.status; li.innerHTML = '<span class="dot"></span><span class="name"></span> <span class="dim"></span>'; li.querySelector(".name").textContent = s.name; li.querySelector(".dim").textContent = s.city + " · " + s.status + " · " + s.cadence; li.addEventListener("mouseenter", () => { hover = s.id; }); li.addEventListener("mouseleave", () => { hover = null; }); list.appendChild(li); } } }
  fetch("/watch/sentinels.json").then(r => r.json()).then(render).catch(() => {});
  fetch("/watch/coast.json").then(r => r.json()).then(c => { coast = c; }).catch(() => {});
  size(); addEventListener("resize", () => { size(); draw(); }); if (reduced) draw(); else tick();
})();
`;
