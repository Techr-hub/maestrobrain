// The brain map: a living 3D world of the five pillars.
// Centre = reasoning core. Inner cloud = knowledge (vault notes linked by [[wikilinks]]), one lobe per folder.
// Outer orbit = connected sources (MCP integrations). Particles = notifications flowing in.
// Drag to orbit, right-drag or Shift-drag to pan, scroll or pinch to zoom, double-click to reset.
import { icon } from './icons.js';

export const GROUP_COLORS = {
  Memory: '#00e5ff', Projects: '#00f2af', People: '#c42cff', Agents: '#ffb020', Skills: '#3d7bff',
  Personal: '#ff4d8d', Meetings: '#7a6bff', Decisions: '#ffe14d', Tasks: '#00b8d9', Knowledge: '#9db2d7',
  Daily: '#4a7fa8', Inbox: '#6c7fa8', '(root)': '#ffffff',
};

const TAU = Math.PI * 2;
const WR = 220;          // world radius of the knowledge cloud
const ORBIT = 310;       // world radius of the source orbit
const CAM_D = 1300;      // camera distance (perspective strength)
const VIEW0 = { yaw: -0.5, pitch: 0.32, zoom: 1.12, panX: 0, panY: 0 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Evenly spread directions on a sphere (Fibonacci), one per folder lobe.
function sphereDirs(n) {
  const out = [], g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), a = g * i;
    out.push([Math.cos(a) * r, y * 0.75, Math.sin(a) * r]);
  }
  return out;
}

export class BrainMap {
  constructor(canvas, { onNodeClick, tooltip, onLayout } = {}) {
    this.onLayout = onLayout;
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.onNodeClick = onNodeClick;
    this.tooltip = tooltip;
    this.nodes = [];
    this.edges = [];
    this.sources = [];
    this.particles = [];
    this.highlight = new Map(); // id -> until
    this.state = 'idle'; // idle | listening | thinking | speaking
    this.level = 0;
    this.t = 0;
    this.alpha = 1;
    this.hover = null;
    this.flash = 0;
    this.view = { ...VIEW0 };
    this.goal = { ...VIEW0 };
    this.touched = false;
    this.autoRotate = true;
    this.lastInteract = -1e9;
    this.pointers = new Map();
    this.stars = Array.from({ length: 260 }, () => {
      const u = Math.random() * 2 - 1, a = Math.random() * TAU, r = 900 + Math.random() * 900, s = Math.sqrt(1 - u * u);
      return { x: Math.cos(a) * s * r, y: u * r, z: Math.sin(a) * s * r, b: 0.25 + Math.random() * 0.6 };
    });
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.bindInput();
    this.buildControls();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    const r = this.c.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width; this.h = r.height;
    this.c.width = r.width * dpr; this.c.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cx = this.w / 2;
    if (this.compact) {
      this.cy = Math.max(105, this.h * 0.2);
      this.R = Math.max(70, Math.min(this.w * 0.3, this.h * 0.16));
    } else {
      this.cy = Math.max(150, this.h * 0.4);
      this.R = Math.max(110, Math.min(this.w * 0.36, this.h * 0.36));
    }
    this.base = this.R / WR; // screen pixels per world unit at zoom 1
    // Default zoom that keeps the whole source orbit on screen.
    this.fitZoom = clamp(Math.min((this.w / 2 - 55) / (ORBIT * this.base * 1.22), (this.h * (this.compact ? 0.3 : 0.55)) / (ORBIT * this.base * 0.62)), 0.35, 1.12);
    if (this.view && !this.touched) { this.view.zoom = this.goal.zoom = this.fitZoom; this.view.panX = this.goal.panX = 0; this.view.panY = this.goal.panY = 0; }
  }

  // When the conversation is open, the brain moves up and shrinks so the core stays visible.
  setCompact(on) {
    if (this.compact === on) return;
    this.compact = on;
    this.c.parentElement.classList.toggle('compact-view', on);
    this.resize();
    if (on) { this.goal.panX = 0; this.goal.panY = 0; }
  }

  // ---------- camera ----------
  project(x, y, z) {
    const v = this.view;
    const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw), cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
    const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
    const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
    const d = CAM_D + z2 / v.zoom;
    if (d < 40) return null;
    const f = CAM_D / d, s = this.base * v.zoom * f;
    return { x: this.cx + v.panX + x1 * s, y: this.cy + v.panY + y2 * s, z: z2, k: v.zoom * f, f };
  }

  resetView() { Object.assign(this.goal, VIEW0, { zoom: this.fitZoom || VIEW0.zoom }); this.touched = false; this.lastInteract = performance.now(); }
  zoomBy(m, mx = this.cx, my = this.cy) {
    const g = this.goal, nz = clamp(g.zoom * m, 0.35, 5), r = nz / g.zoom;
    // keep the point under the cursor where it is
    g.panX = (g.panX + this.cx - mx) * r - (this.cx - mx);
    g.panY = (g.panY + this.cy - my) * r - (this.cy - my);
    g.zoom = nz;
    this.touched = true;
    this.lastInteract = performance.now();
  }

  bindInput() {
    const c = this.c;
    c.style.touchAction = 'none';
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.drag = { x: e.clientX, y: e.clientY, moved: 0, pan: e.button === 2 || e.button === 1 || e.shiftKey || e.metaKey };
      this.lastInteract = performance.now();
    });
    c.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev || !this.drag) { this.onMove(e); return; }
      const g = this.goal;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const before = Math.hypot(a.x - b.x, a.y - b.y);
        prev.x = e.clientX; prev.y = e.clientY;
        const [a2, b2] = [...this.pointers.values()];
        const after = Math.hypot(a2.x - b2.x, a2.y - b2.y);
        const r = c.getBoundingClientRect();
        if (before > 0) this.zoomBy(after / before, (a2.x + b2.x) / 2 - r.left, (a2.y + b2.y) / 2 - r.top);
        this.drag.moved = 99;
        return;
      }
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      prev.x = e.clientX; prev.y = e.clientY;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      if (this.drag.moved < 4) return;
      this.touched = true;
      if (this.drag.pan) { g.panX += dx; g.panY += dy; }
      else { g.yaw += dx * 0.006; g.pitch = clamp(g.pitch + dy * 0.006, -1.35, 1.35); }
      this.lastInteract = performance.now();
      c.style.cursor = this.drag.pan ? 'move' : 'grabbing';
      if (this.tooltip) this.tooltip.style.display = 'none';
    });
    const end = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.drag && this.drag.moved < 4 && this.pointers.size === 0) { this.onMove(e); if (this.hover) { if (this.hover.kind !== 'note') this.selectedSource = this.hover.id; if (this.onNodeClick) this.onNodeClick(this.hover); } }
      if (this.pointers.size === 0) { this.drag = null; c.style.cursor = this.hover ? 'pointer' : 'grab'; }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = null; if (this.tooltip) this.tooltip.style.display = 'none'; } });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      if (e.shiftKey) { this.goal.panX -= e.deltaX || e.deltaY; this.goal.panY -= e.deltaX ? e.deltaY : 0; this.lastInteract = performance.now(); return; }
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      this.zoomBy(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    c.addEventListener('dblclick', () => this.resetView());
    c.style.cursor = 'grab';
  }

  buildControls() {
    const el = document.createElement('div');
    el.className = 'brain-controls';
    el.innerHTML = `
      <button data-z="in" title="Zoom in">${icon('plus')}</button>
      <button data-z="out" title="Zoom out">${icon('minus')}</button>
      <button data-z="spin" class="on" title="Auto-rotate on/off">${icon('orbit')}</button>
      <button data-z="reset" title="Reset view (double-click the map)">${icon('crosshair')}</button>
      <span class="brain-help">Drag to orbit · Right-drag or Shift to pan · Scroll to zoom</span>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const z = b.dataset.z;
      if (z === 'in') this.zoomBy(1.3);
      if (z === 'out') this.zoomBy(1 / 1.3);
      if (z === 'reset') this.resetView();
      if (z === 'spin') { this.autoRotate = !this.autoRotate; b.classList.toggle('on', this.autoRotate); this.lastInteract = -1e9; }
    });
    this.c.parentElement.appendChild(el);
    this.controls = el;
  }

  // ---------- data ----------
  setGraph({ nodes, edges }) {
    const old = new Map(this.nodes.map((n) => [n.id, n]));
    const deg = {};
    edges.forEach((e) => { deg[e.source] = (deg[e.source] || 0) + 1; deg[e.target] = (deg[e.target] || 0) + 1; });
    const groups = [...new Set(nodes.map((n) => n.group))].filter((g) => g !== 'Templates').sort();
    const dirs = sphereDirs(groups.length);
    const lobe = Object.fromEntries(groups.map((g, i) => [g, dirs[i]]));
    this.nodes = nodes.filter((n) => n.group !== 'Templates').map((n) => {
      const prev = old.get(n.id), a = lobe[n.group] || [1, 0, 0], rr = WR * (0.55 + Math.random() * 0.35);
      const j = () => (Math.random() - 0.5) * 0.7;
      return {
        ...n, anchor: a,
        x: prev ? prev.x : (a[0] + j()) * rr, y: prev ? prev.y : (a[1] + j()) * rr, z: prev ? prev.z : (a[2] + j()) * rr,
        vx: 0, vy: 0, vz: 0, deg: deg[n.id] || 0, color: GROUP_COLORS[n.group] || '#9db2d7',
      };
    });
    const idx = new Map(this.nodes.map((n) => [n.id, n]));
    this.edges = edges.map((e) => ({ a: idx.get(e.source), b: idx.get(e.target) })).filter((e) => e.a && e.b);
    this.alpha = 1;
  }

  // list: hubs ({ id, name, color, short, hub: true, connected }) sit on the orbit; connected sources
  // ({ id, ..., parent: hubId }) circle their hub as satellites.
  setSources(list) {
    const old = new Map(this.sources.map((s) => [s.id + '|' + (s.parent || ''), s]));
    const hubs = list.filter((s) => !s.parent);
    this.sources = list.map((s) => {
      const prev = old.get(s.id + '|' + (s.parent || ''));
      const sibs = s.parent ? list.filter((x) => x.parent === s.parent) : hubs;
      const i = sibs.indexOf(s);
      return { ...s, angle: (i / Math.max(1, sibs.length)) * TAU, pulse: prev ? prev.pulse : 0 };
    });
    this.hubIndex = new Map(this.sources.filter((s) => !s.parent).map((s) => [s.id, s]));
  }

  sourceWorld(s) {
    if (s.parent) {
      const h = this.hubIndex && this.hubIndex.get(s.parent);
      const c = h ? this.sourceWorld(h) : { x: 0, y: 0, z: 0 };
      const a = s.angle + this.t * 0.0003;
      return { x: c.x + Math.cos(a) * 74, y: c.y - 40 + Math.sin(a) * 18, z: c.z + Math.sin(a) * 74 };
    }
    const a = s.angle + this.t * 0.00005;
    return { x: Math.cos(a) * ORBIT, y: Math.sin(a * 2 + s.angle) * 38, z: Math.sin(a) * ORBIT };
  }

  pulseSource(id, color) {
    const s = this.sources.find((x) => x.id === id && x.parent) || this.sources.find((x) => x.id === id) || this.sources.find((x) => x.members && x.members.includes(id));
    if (s && s.parent && this.hubIndex.get(s.parent)) this.hubIndex.get(s.parent).pulse = 1;
    const from = s ? this.sourceWorld(s) : { x: (Math.random() - 0.5) * 900, y: -500, z: (Math.random() - 0.5) * 900 };
    if (s) s.pulse = 1;
    for (let k = 0; k < 3; k++) this.particles.push({ from, p: -k * 0.08, color: color || '#00e5ff' });
  }

  highlightNotes(paths, ms = 9000) {
    const until = performance.now() + ms;
    for (const p of paths) {
      this.highlight.set(p, until);
      const n = this.nodes.find((x) => x.id === p);
      if (n) this.particles.push({ from: { x: n.x, y: n.y, z: n.z }, p: 0, color: n.color, slow: true });
    }
  }

  setState(s) { this.state = s; }
  setLevel(v) { this.level = v; }
  flashCore() { this.flash = 1; }

  onMove(e) {
    const r = this.c.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bz = Infinity;
    const consider = (item, sx, sy, rad, z) => {
      const dx = sx - mx, dy = sy - my;
      if (dx * dx + dy * dy < rad * rad && z < bz) { bz = z; best = item; }
    };
    for (const n of this.nodes) if (n.sp) consider({ ...n, kind: 'note' }, n.sp.x, n.sp.y, Math.max(9, n.sr + 5), n.sp.z);
    for (const s of this.sources) if (s.sp) consider({ ...s, kind: s.hub ? 'hub' : 'source', label: s.name }, s.sp.x, s.sp.y, Math.max(s.parent ? 10 : 14, (s.parent ? 11 : 17) * s.sp.k), s.sp.z - (s.parent ? 1100 : 1000));
    this.hover = best;
    this.c.style.cursor = best ? 'pointer' : 'grab';
    if (this.tooltip) {
      if (best) { this.tooltip.style.display = 'block'; this.tooltip.style.left = mx + 'px'; this.tooltip.style.top = my + 'px'; this.tooltip.textContent = best.kind === 'note' ? `${best.label} · ${best.group}` : `${best.label} · ${best.connected === false ? 'nothing connected yet · click to connect' : best.error ? 'connection error' : 'click to open'}`; }
      else this.tooltip.style.display = 'none';
    }
  }

  // ---------- physics (3D force layout) ----------
  step() {
    if (this.alpha < 0.02) return;
    const N = this.nodes, rCore = 70, al = this.alpha;
    for (let i = 0; i < N.length; i++) {
      const a = N[i];
      for (let j = i + 1; j < N.length; j++) {
        const b = N[j];
        let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z, d2 = dx * dx + dy * dy + dz * dz || 0.01;
        if (d2 > 220 * 220) continue;
        const d = Math.sqrt(d2), f = (1500 / d2) * al;
        dx /= d; dy /= d; dz /= d;
        a.vx += dx * f; a.vy += dy * f; a.vz += dz * f; b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f;
      }
    }
    for (const e of this.edges) {
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, dz = e.b.z - e.a.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const f = ((d - 80) / d) * 0.007 * al;
      e.a.vx += dx * f; e.a.vy += dy * f; e.a.vz += dz * f; e.b.vx -= dx * f; e.b.vy -= dy * f; e.b.vz -= dz * f;
    }
    const target = WR * 0.72, lim = WR * 1.08;
    for (const n of N) {
      const d = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z) || 1;
      const f = ((d - target) / d) * 0.012 * al;
      n.vx -= n.x * f; n.vy -= n.y * f; n.vz -= n.z * f;
      const [ax, ay, az] = n.anchor;
      n.vx += (ax * target - n.x) * 0.006 * al; n.vy += (ay * target - n.y) * 0.006 * al; n.vz += (az * target - n.z) * 0.006 * al;
      if (d < rCore + 30) { n.vx += (n.x / d) * 1.2; n.vy += (n.y / d) * 1.2; n.vz += (n.z / d) * 1.2; }
      n.vx *= 0.82; n.vy *= 0.82; n.vz *= 0.82;
      n.x += n.vx; n.y += n.vy; n.z += n.vz;
      if (d > lim) { const k = lim / d; n.x *= k; n.y *= k; n.z *= k; }
    }
    this.alpha *= 0.994;
  }

  // ---------- render ----------
  ring(ctx, radius, y, dash, style) {
    ctx.strokeStyle = style; ctx.setLineDash(dash || []);
    ctx.beginPath();
    let first = true;
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * TAU, p = this.project(Math.cos(a) * radius, y, Math.sin(a) * radius);
      if (!p) { first = true; continue; }
      if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }

  loop(now) {
    const dt = Math.min(50, now - (this.t || now));
    this.t = now;
    // camera easing + idle auto-rotate
    if (this.autoRotate && !this.drag && now - this.lastInteract > 6000) this.goal.yaw += dt * 0.00005;
    for (const k of ['yaw', 'pitch', 'zoom', 'panX', 'panY']) this.view[k] += (this.goal[k] - this.view[k]) * 0.2;
    this.step();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    const hl = (id) => (this.highlight.get(id) || 0) > now;

    // star field
    for (const s of this.stars) {
      const p = this.project(s.x, s.y, s.z); if (!p) continue;
      ctx.fillStyle = `rgba(157,178,215,${s.b * Math.min(1, p.f)})`;
      ctx.fillRect(p.x, p.y, 1.2, 1.2);
    }
    // floor grid + equator rings
    ctx.lineWidth = 1;
    for (const r of [180, 340, 500, 660]) this.ring(ctx, r, 300, null, 'rgba(0,49,75,.28)');
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU, p1 = this.project(Math.cos(a) * 180, 300, Math.sin(a) * 180), p2 = this.project(Math.cos(a) * 660, 300, Math.sin(a) * 660);
      if (p1 && p2) { ctx.strokeStyle = 'rgba(0,49,75,.22)'; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); }
    }
    for (const r of [110, 200, 280]) this.ring(ctx, r, 0, null, 'rgba(0,49,75,.55)');
    this.ring(ctx, ORBIT, 0, [2, 6], 'rgba(0,124,170,.35)');

    const core = this.project(0, 0, 0) || { x: this.cx, y: this.cy, z: 0, k: 1 };

    // project everything once
    for (const n of this.nodes) { n.sp = this.project(n.x, n.y, n.z); n.on = hl(n.id); if (n.sp) n.sr = (2.5 + Math.min(n.deg, 10) * 0.45 + (n.on ? 2 : 0)) * clamp(Math.sqrt(n.sp.k), 0.55, 2.2); }
    for (const s of this.sources) { const w = this.sourceWorld(s); s.sp = this.project(w.x, w.y, w.z); }

    // edges (fade with depth)
    for (const e of this.edges) {
      const a = e.a.sp, b = e.b.sp; if (!a || !b) continue;
      const on = e.a.on || e.b.on, depth = clamp(0.55 - (a.z + b.z) / 1400, 0.25, 1);
      ctx.strokeStyle = on ? 'rgba(0,229,255,.6)' : `rgba(0,124,170,${0.22 * depth})`;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // depth-sorted scene: far things, then the core, then near things
    const items = [];
    for (const n of this.nodes) if (n.sp) items.push({ z: n.sp.z, draw: () => this.drawNode(n) });
    for (const s of this.sources) if (s.sp) items.push({ z: s.sp.z, draw: () => this.drawSource(s, core) });
    items.push({ z: 0, core: true, draw: () => this.drawCore(now, core) });
    items.sort((a, b) => b.z - a.z);
    for (const it of items) it.draw();

    // particles
    this.particles = this.particles.filter((p) => p.p < 1);
    for (const p of this.particles) {
      p.p += p.slow ? 0.012 : 0.018;
      if (p.p < 0) continue;
      const at = (q) => { const e = 1 - easeInOut(q); return this.project(p.from.x * e, p.from.y * e, p.from.z * e); };
      const h = at(p.p), t = at(Math.max(0, p.p - 0.08)); if (!h || !t) continue;
      ctx.fillStyle = hex(p.color, 1 - p.p * 0.5);
      ctx.beginPath(); ctx.arc(h.x, h.y, 3 * Math.max(0.6, h.k), 0, TAU); ctx.fill();
      ctx.strokeStyle = hex(p.color, 0.35); ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(h.x, h.y); ctx.stroke();
      if (p.p >= 0.97) this.flash = Math.max(this.flash, 0.6);
    }

    // keep the subtitle tucked under the core wherever the camera goes
    const subY = Math.round(clamp(core.y + (this.compact ? 92 : 108) * core.k, 40, this.h - 60));
    const subX = Math.round(clamp(core.x, 140, this.w - 140));
    if (subY !== this.subY || subX !== this.subX) { this.subY = subY; this.subX = subX; if (this.onLayout) this.onLayout(this); }
    requestAnimationFrame(this.loop);
  }

  drawNode(n) {
    const ctx = this.ctx, p = n.sp, r = n.sr, fog = clamp(0.95 - p.z / 900, 0.35, 1);
    if (n.on) {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.5);
      g.addColorStop(0, hex(n.color, 0.45)); g.addColorStop(1, hex(n.color, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.5, 0, TAU); ctx.fill();
      const c = this.project(0, 0, 0);
      if (c) { ctx.strokeStyle = hex(n.color, 0.5); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(c.x, c.y); ctx.stroke(); }
    }
    ctx.fillStyle = hex(n.color, n.on ? 1 : 0.85 * fog);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    const hov = this.hover && this.hover.id === n.id;
    if (hov || (n.on && (!this.compact || p.z < 0)) || (!this.compact && n.deg >= 6 && p.z < 120) || (p.k > 1.7 && p.z < 60)) {
      ctx.fillStyle = n.on || hov ? '#e9e7ff' : `rgba(183,190,224,${0.75 * fog})`;
      ctx.font = `${n.on ? 600 : 400} ${Math.round(clamp(11 * Math.sqrt(p.k), 10, 15))}px Roboto, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(n.label, p.x, p.y - r - 6);
    }
  }

  drawSource(s, core) {
    const sat = !!s.parent, ctx = this.ctx, p = s.sp, k = clamp(Math.sqrt(p.k), 0.6, 2) * (sat ? 0.62 : 1), off = s.connected === false;
    const fog = clamp(1 - p.z / 1200, 0.45, 1) * (off && !sat ? 0.5 : 1);
    const anchor = sat ? (this.hubIndex.get(s.parent) || {}).sp || core : core;
    if (!off || sat) { ctx.strokeStyle = sat ? hex(s.color, 0.5 * fog) : `rgba(0,124,170,${(0.12 + s.pulse * 0.6) * fog})`; ctx.setLineDash(sat ? [] : [3, 5]); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(anchor.x, anchor.y); ctx.stroke(); ctx.setLineDash([]); }
    const selected = this.selectedSource === s.id;
    if (selected || s.error) { ctx.strokeStyle = s.error ? 'rgba(255,77,109,.9)' : hex(s.color, 0.9); ctx.lineWidth = 1.5; ctx.setLineDash(s.error ? [3, 3] : []); ctx.beginPath(); ctx.arc(p.x, p.y, 22 * k, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1; }
    const r = (15 + s.pulse * 6) * k;
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, r * 2.2);
    g.addColorStop(0, hex(s.color, (0.45 + s.pulse * 0.4) * fog)); g.addColorStop(1, hex(s.color, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.2, 0, TAU); ctx.fill();
    ctx.globalAlpha = fog;
    ctx.fillStyle = '#01060e'; ctx.strokeStyle = s.color; ctx.lineWidth = 1.5;
    if (off && !sat) ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.arc(p.x, p.y, 15 * k, 0, TAU); ctx.fill(); ctx.stroke(); ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.fillStyle = s.color; ctx.font = `600 ${Math.round(11 * k)}px Rajdhani, Roboto, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s.short || s.name.slice(0, 2).toUpperCase(), p.x, p.y + 1);
    ctx.fillStyle = sat ? 'rgba(157,178,215,.7)' : 'rgba(198,210,235,.9)';
    ctx.font = `${sat ? 400 : 600} ${Math.round(clamp((sat ? 10 : 12) * Math.sqrt(p.k), 9, 16))}px ${sat ? 'Roboto' : 'Rajdhani, Roboto'}, sans-serif`;
    ctx.fillText(s.name.replace(/ \(.*\)/, '').replace(' / Microsoft 365', ''), p.x, p.y + (sat ? 20 : 28) * k);
    ctx.globalAlpha = 1;
    s.pulse *= 0.96;
  }

  drawCore(now, c) {
    const ctx = this.ctx, cx = c.x, cy = c.y, K = clamp(c.k, 0.35, 4) * (this.compact ? 0.72 : 1);
    // The core only moves while the brain is listening, thinking or talking. Idle, it holds still.
    const speed = this.state === 'thinking' ? 4 : this.state === 'listening' ? 2 : this.state === 'speaking' ? 2.5 : 0;
    const dt = this.coreLast ? Math.min(50, now - this.coreLast) : 16; this.coreLast = now;
    this.spin = (this.spin || 0) + dt * 0.001 * speed;
    const t = this.spin, active = speed > 0;
    const lvl = this.state === 'listening' ? this.level : this.state === 'speaking' ? 0.3 + 0.3 * Math.sin(now * 0.02) : 0;
    const base = (52 + lvl * 14 + this.flash * 8) * K;
    const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, base * 2.4);
    const col = this.state === 'listening' ? '255,59,92' : '0,229,255';
    glow.addColorStop(0, `rgba(${col},${0.55 + this.flash * 0.3})`);
    glow.addColorStop(0.35, `rgba(${col},.14)`);
    glow.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, base * 2.4, 0, TAU); ctx.fill();

    ctx.lineCap = 'round';
    const rings = [[base, 2, 0.9, 1], [base + 12 * K, 1.5, -0.6, 3], [base + 24 * K, 1, 0.35, 5], [base - 14 * K, 3, -1.4, 2]];
    rings.forEach(([r, w, sp, segs], i) => {
      ctx.lineWidth = w * Math.sqrt(K);
      ctx.strokeStyle = `rgba(${col},${0.85 - i * 0.15})`;
      for (let s = 0; s < segs; s++) {
        const a0 = t * sp + (s / segs) * TAU;
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, r), a0, a0 + (TAU / segs) * 0.62); ctx.stroke();
      }
    });
    ctx.strokeStyle = `rgba(${col},.35)`; ctx.lineWidth = 1;
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU + t * 0.1, r1 = base + 32 * K, r2 = r1 + (i % 5 === 0 ? 7 : 3) * K;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
    }
    const ig = ctx.createRadialGradient(cx - 6 * K, cy - 6 * K, 2, cx, cy, 26 * K);
    ig.addColorStop(0, '#ffffff'); ig.addColorStop(0.3, `rgba(${col},.95)`); ig.addColorStop(1, `rgba(${col},.05)`);
    ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(cx, cy, (24 + lvl * 8 + (active ? Math.sin(now * 0.003) * 1.5 : 0)) * K, 0, TAU); ctx.fill();
    ctx.lineCap = 'butt';
    this.flash *= 0.94;
  }
}

function easeInOut(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }
function hex(h, a) {
  const n = parseInt(h.replace('#', '').padEnd(6, '0'), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}


// Small animated "Jarvis" avatar for the sidebar brand.
export function avatar(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = () => { const r = canvas.getBoundingClientRect(); canvas.width = r.width * dpr; canvas.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return r.width; };
  let S = size();
  new ResizeObserver(() => { S = size(); }).observe(canvas);
  // idle: slow drift · listening: pulses with the user's voice level · thinking: fast spin · speaking: spins + beats while replying
  let state = 'idle', level = 0, spin = 0, last = 0, pulse = 0;
  const draw = (now) => {
    const dt = last ? Math.min(50, now - last) : 16; last = now;
    const speed = state === 'speaking' ? 5 : state === 'thinking' ? 3.5 : state === 'listening' ? 1.4 : 0;
    spin += dt * 0.001 * speed;
    const target = state === 'listening' ? 0.15 + level * 0.9 : state === 'speaking' ? 0.25 + 0.2 * Math.abs(Math.sin(now * 0.012)) : 0;
    pulse += (target - pulse) * 0.25;
    const t = spin;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    const scale = 1 + pulse * 0.12;
    ctx.translate(S / 2, S / 2); ctx.scale(scale, scale); ctx.translate(-S / 2, -S / 2);
    const c = S / 2;
    const col = state === 'listening' ? '255,59,92' : '0,229,255';
    const g = ctx.createRadialGradient(c, c, 2, c, c, c);
    g.addColorStop(0, `rgba(${col},.5)`); g.addColorStop(0.5, `rgba(${col},.08)`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, c, 0, TAU); ctx.fill();
    ctx.lineCap = 'round';
    [[0.86, 1, 0.5, 6], [0.72, 2, -0.8, 3], [0.58, 1.5, 1.2, 2], [0.42, 3, -1.6, 4]].forEach(([k, w, sp, n], i) => {
      ctx.lineWidth = w * (S / 150); ctx.strokeStyle = `rgba(${col},${0.9 - i * 0.12})`;
      for (let s = 0; s < n; s++) { const a = t * sp + (s / n) * TAU; ctx.beginPath(); ctx.arc(c, c, c * k, a, a + (TAU / n) * 0.6); ctx.stroke(); }
    });
    const ig = ctx.createRadialGradient(c - 3, c - 3, 1, c, c, c * 0.28);
    ig.addColorStop(0, '#fff'); ig.addColorStop(0.35, `rgba(${col},1)`); ig.addColorStop(1, `rgba(${col},.05)`);
    ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(c, c, c * (0.26 + pulse * 0.08) + (state === 'idle' ? 0 : Math.sin(now * 0.003) * 1.5), 0, TAU); ctx.fill();
    if (pulse > 0.05) { // expanding ripple
      ctx.strokeStyle = `rgba(${col},${0.5 * pulse})`; ctx.lineWidth = 2;
      const rr = c * (0.3 + ((now * 0.0012) % 1) * 0.65);
      ctx.beginPath(); ctx.arc(c, c, rr, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  return { setState: (s) => { state = s; }, setLevel: (v) => { level = v; } };
}
