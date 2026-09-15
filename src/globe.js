// The Watch globe: an orthographic Earth on a canvas from a small coastline set. It shows the places
// the sentinels watch (each sentinel's coverage), not where their feeds are hosted; the source is a
// faint ring. It spins on its own, follows a drag or a swipe, and resumes its spin after a pause.
// No library: the site's content-security-policy is default-src 'self'. Served as /globe.js.
export const GLOBE_JS = String.raw`
function mountGlobe(canvas) {
  const ctx = canvas.getContext("2d");
  const scope = canvas.closest("section, main, body") || document;
  const list = scope.querySelector("[data-sentinel-list]") || document.getElementById("sentinel-list");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const COL = { sea: "#0b0e14", land: "#1a2130", line: "#2a3346", grid: "#151b27", live: "#4fd1a5", building: "#7aa2f7", planned: "#8a93a6", text: "#d7dce6", dim: "#8a93a6" };
  let sentinels = [], coast = null, rot = -40, tilt = 16, dpr = Math.min(2, devicePixelRatio || 1);
  let hover = null, focus = null, dragging = false, last = null, idleAt = 0, spin = !reduced, vel = 0;
  const IDLE_MS = 3000, SPIN = 0.06;
  function size() { const r = canvas.getBoundingClientRect(); const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height)); if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; } ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return w > 2 && h > 2; }
  const rad = d => d * Math.PI / 180;
  function project(lat, lon, R, cx, cy) {
    const la = rad(lat), lo = rad(lon + rot), t = rad(tilt);
    const x = Math.cos(la) * Math.sin(lo), y = Math.sin(la), z = Math.cos(la) * Math.cos(lo);
    const y2 = y * Math.cos(t) - z * Math.sin(t), z2 = y * Math.sin(t) + z * Math.cos(t);
    return { x: cx + R * x, y: cy - R * y2, front: z2 > 0, depth: z2 };
  }
  function pathLatLon(pts, R, cx, cy) { let started = false, any = false; for (const [lat, lon] of pts) { const p = project(lat, lon, R, cx, cy); if (!p.front) { started = false; continue; } any = true; if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y); } return any; }
  function draw() {
    const w = canvas.width / dpr, h = canvas.height / dpr, cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.44;
    if (w < 3 || h < 3) return;
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = COL.sea; ctx.fill(); ctx.strokeStyle = COL.line; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 0.6;
    for (let lat = -60; lat <= 60; lat += 30) { ctx.beginPath(); const pts = []; for (let lon = -180; lon <= 180; lon += 3) pts.push([lat, lon]); pathLatLon(pts, R, cx, cy); ctx.stroke(); }
    for (let lon = -180; lon < 180; lon += 30) { ctx.beginPath(); const pts = []; for (let lat = -90; lat <= 90; lat += 3) pts.push([lat, lon]); pathLatLon(pts, R, cx, cy); ctx.stroke(); }
    if (coast) { ctx.fillStyle = COL.land; ctx.strokeStyle = COL.line; ctx.lineWidth = 0.8; for (const ring of coast) { ctx.beginPath(); if (pathLatLon(ring.map(([lon, lat]) => [lat, lon]), R, cx, cy)) { ctx.closePath(); ctx.fill(); ctx.stroke(); } } }
    // watched places: the coverage. Many sentinels share a city; the dot grows with how many watch it.
    const cover = new Map();
    for (const s of sentinels) for (const wp of (s.watches || [])) { const k = wp.lat + "," + wp.lon; const e = cover.get(k) || { lat: wp.lat, lon: wp.lon, place: wp.place, by: [] }; e.by.push(s); cover.set(k, e); }
    const pts = [...cover.values()].map(e => Object.assign({ e }, project(e.lat, e.lon, R, cx, cy))).filter(p => p.front).sort((a, b) => a.depth - b.depth);
    for (const p of pts) {
      const inFocus = focus ? p.e.by.some(s => s.id === focus) : false;
      const best = p.e.by.some(s => s.status === "live") ? "live" : p.e.by.some(s => s.status === "building") ? "building" : "planned";
      const c = COL[best]; const r = Math.min(7, 2.5 + p.e.by.length * 0.6) + (inFocus ? 2 : 0);
      ctx.globalAlpha = focus && !inFocus ? 0.25 : 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2); ctx.fillStyle = c + "22"; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); p.r = r;
      ctx.globalAlpha = 1;
    }
    // sources: a faint ring where each feed lives, so the plumbing is visible but not the point.
    for (const s of sentinels) { const p = project(s.lat, s.lon, R, cx, cy); if (!p.front) continue; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.strokeStyle = COL.dim; ctx.lineWidth = 1; ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1; }
    canvas._pts = pts;
    if (hover) { const p = pts.find(q => q.e.place === hover); if (p) { const names = p.e.by.map(s => s.name).slice(0, 3).join(", ") + (p.e.by.length > 3 ? " +" + (p.e.by.length - 3) : ""); ctx.font = "13px ui-monospace, Consolas, monospace"; ctx.fillStyle = COL.text; ctx.fillText(p.e.place + " · watched by " + names, Math.min(p.x + 10, w - 320), p.y - 10); } }
  }
  function tick(now) {
    if (!dragging) { if (Math.abs(vel) > 0.005) { rot += vel; vel *= 0.94; } else if (spin && now - idleAt > IDLE_MS && !hover) rot += SPIN; }
    draw(); requestAnimationFrame(tick);
  }
  function pointerPos(e) { const b = canvas.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: t.clientX - b.left, y: t.clientY - b.top }; }
  function down(e) { dragging = true; last = pointerPos(e); vel = 0; idleAt = performance.now(); if (!e.touches && e.cancelable) e.preventDefault(); }
  function move(e) { const p = pointerPos(e); if (dragging && last) { const dx = p.x - last.x, dy = p.y - last.y;
    if (e.touches && Math.abs(dy) > Math.abs(dx) * 1.2) { last = p; return; } // a vertical thumb is a page scroll, not a spin
    rot += dx * 0.35; vel = dx * 0.35; if (!e.touches) tilt = Math.max(-60, Math.min(60, tilt + dy * 0.25)); last = p; idleAt = performance.now(); if (!e.touches && e.cancelable) e.preventDefault(); return; }
    const hit = (canvas._pts || []).find(q => Math.hypot(q.x - p.x, q.y - p.y) < 10); hover = hit ? hit.e.place : null; canvas.style.cursor = hit ? "pointer" : "grab"; }
  function up() { dragging = false; last = null; idleAt = performance.now(); }
  canvas.addEventListener("mousedown", down); addEventListener("mousemove", move); addEventListener("mouseup", up);
  canvas.addEventListener("touchstart", down, { passive: false }); canvas.addEventListener("touchmove", move, { passive: false }); canvas.addEventListener("touchend", up);
    canvas.style.cursor = "grab"; canvas.style.touchAction = "pan-y";
  // Auto-rotating content needs a user control: a pause/play button, and the spin stops while the
  // canvas is hovered or focused, and under reduced motion.
  const btn = scope.querySelector("[data-globe-pause]");
  function setSpin(on) { spin = on && !reduced; idleAt = spin ? performance.now() - IDLE_MS : performance.now(); if (btn) { btn.setAttribute("aria-pressed", String(!spin)); btn.textContent = spin ? "Pause" : "Play"; } }
  if (btn) { btn.addEventListener("click", () => setSpin(!spin)); setSpin(!reduced); }
  canvas.tabIndex = 0; canvas.addEventListener("focus", () => { idleAt = performance.now() + 1e9; }); canvas.addEventListener("blur", () => { idleAt = performance.now(); });
  canvas.addEventListener("mouseenter", () => { idleAt = performance.now() + 1e9; }); canvas.addEventListener("mouseleave", () => { hover = null; idleAt = performance.now(); });
  canvas.addEventListener("keydown", e => { const step = 8; if (e.key === "ArrowLeft") { rot -= step; e.preventDefault(); } if (e.key === "ArrowRight") { rot += step; e.preventDefault(); } if (e.key === "ArrowUp") { tilt = Math.min(60, tilt + 5); e.preventDefault(); } if (e.key === "ArrowDown") { tilt = Math.max(-60, tilt - 5); e.preventDefault(); } if (e.key === " ") { setSpin(!spin); e.preventDefault(); } });
  function render(data) { sentinels = data.sentinels || []; if (!list) return; list.innerHTML = "";
    for (const s of sentinels) { const li = document.createElement("li"); li.className = "sentinel " + s.status; li.tabIndex = 0;
      li.innerHTML = '<span class="dot"></span><span class="name"></span> <span class="dim"></span>';
      li.querySelector(".name").textContent = s.name; li.querySelector(".dim").textContent = (s.watches || []).length + " places · " + s.status + " · " + s.cadence;
      const on = () => { focus = s.id; }, off = () => { focus = null; };
      li.addEventListener("mouseenter", on); li.addEventListener("mouseleave", off); li.addEventListener("focus", on); li.addEventListener("blur", off);
      list.appendChild(li); } }
  fetch("/watch/sentinels.json").then(r => r.json()).then(render).catch(() => {});
  fetch("/watch/coast.json").then(r => r.json()).then(c => { coast = c; }).catch(() => {});
  size(); addEventListener("resize", () => { size(); draw(); });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => { size(); draw(); }).observe(canvas);
  requestAnimationFrame(tick);
}
document.querySelectorAll("canvas[data-globe]").forEach(mountGlobe);
`;
