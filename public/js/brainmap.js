// The brain map: a living visualization of the five pillars.
// Centre = reasoning core. Inner cloud = knowledge (vault notes linked by [[wikilinks]]).
// Outer orbit = connected sources (MCP integrations). Particles = notifications flowing in.

export const GROUP_COLORS = {
  Memory: '#00e5ff', Projects: '#00f2af', People: '#c42cff', Agents: '#ffb020', Skills: '#3d7bff',
  Personal: '#ff4d8d', Meetings: '#7a6bff', Decisions: '#ffe14d', Tasks: '#00b8d9', Knowledge: '#9db2d7',
  Daily: '#4a7fa8', Inbox: '#6c7fa8', '(root)': '#ffffff',
};

const TAU = Math.PI * 2;

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
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener('mousemove', (e) => this.onMove(e));
    canvas.addEventListener('mouseleave', () => { this.hover = null; if (this.tooltip) this.tooltip.style.display = 'none'; });
    canvas.addEventListener('click', () => { if (this.hover && this.onNodeClick) this.onNodeClick(this.hover); });
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
    this.alpha = Math.max(this.alpha || 0, 0.4);
    if (this.onLayout) this.onLayout(this);
  }

  // When the conversation is open, the brain moves up and shrinks so the core stays visible.
  setCompact(on) {
    if (this.compact === on) return;
    const oldR = this.R;
    this.compact = on;
    this.resize();
    const k = this.R / (oldR || this.R);
    for (const n of this.nodes) { n.x *= k; n.y *= k; }
  }

  setGraph({ nodes, edges }) {
    const old = new Map(this.nodes.map((n) => [n.id, n]));
    const deg = {};
    edges.forEach((e) => { deg[e.source] = (deg[e.source] || 0) + 1; deg[e.target] = (deg[e.target] || 0) + 1; });
    // Each folder gets its own "lobe" (angular sector) around the core.
    const groups = [...new Set(nodes.map((n) => n.group))].sort();
    const sector = Object.fromEntries(groups.map((g, i) => [g, (i / groups.length) * TAU - Math.PI / 2]));
    this.nodes = nodes.filter((n) => n.group !== 'Templates').map((n) => {
      const prev = old.get(n.id);
      const a = sector[n.group] + (Math.random() - 0.5) * 0.9;
      const rr = this.R * (0.5 + Math.random() * 0.45);
      return { ...n, anchor: sector[n.group], x: prev ? prev.x : Math.cos(a) * rr, y: prev ? prev.y : Math.sin(a) * rr * 0.8, vx: 0, vy: 0, deg: deg[n.id] || 0, color: GROUP_COLORS[n.group] || '#9db2d7' };
    });
    const idx = new Map(this.nodes.map((n) => [n.id, n]));
    this.edges = edges.map((e) => ({ a: idx.get(e.source), b: idx.get(e.target) })).filter((e) => e.a && e.b);
    this.alpha = 1;
  }

  setSources(list) {
    // list: [{ id, name, color, icon }]
    const old = new Map(this.sources.map((s) => [s.id, s]));
    this.sources = list.map((s, i) => ({ ...s, angle: (i / Math.max(1, list.length)) * TAU - Math.PI / 2, pulse: old.get(s.id) ? old.get(s.id).pulse : 0 }));
  }

  sourcePos(s) {
    const a = s.angle + this.t * 0.00006;
    const rx = Math.min(this.w * 0.46, this.R * (this.compact ? 2.1 : 1.55)), ry = Math.min(this.h * (this.compact ? 0.16 : 0.36), this.R * 1.15);
    return { x: this.cx + Math.cos(a) * rx, y: this.cy + Math.sin(a) * ry };
  }

  pulseSource(id, color) {
    const s = this.sources.find((x) => x.id === id);
    const from = s ? this.sourcePos(s) : { x: this.cx + (Math.random() - 0.5) * this.w, y: 0 };
    if (s) s.pulse = 1;
    for (let k = 0; k < 3; k++) this.particles.push({ x: from.x, y: from.y, tx: this.cx, ty: this.cy, p: -k * 0.08, color: color || '#00e5ff' });
  }

  highlightNotes(paths, ms = 9000) {
    const until = performance.now() + ms;
    for (const p of paths) this.highlight.set(p, until);
    for (const p of paths) {
      const n = this.nodes.find((x) => x.id === p);
      if (n) this.particles.push({ x: this.cx + n.x, y: this.cy + n.y, tx: this.cx, ty: this.cy, p: 0, color: n.color, slow: true });
    }
  }

  setState(s) { this.state = s; }
  setLevel(v) { this.level = v; }
  flashCore() { this.flash = 1; }

  onMove(e) {
    const r = this.c.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bd = 14 * 14;
    for (const n of this.nodes) {
      const dx = this.cx + n.x - mx, dy = this.cy + n.y - my, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = { ...n, kind: 'note' }; }
    }
    for (const s of this.sources) {
      const p = this.sourcePos(s); const dx = p.x - mx, dy = p.y - my, d = dx * dx + dy * dy;
      if (d < 22 * 22) { best = { ...s, kind: 'source', label: s.name }; }
    }
    this.hover = best;
    this.c.style.cursor = best ? 'pointer' : 'default';
    if (this.tooltip) {
      if (best) { this.tooltip.style.display = 'block'; this.tooltip.style.left = mx + 'px'; this.tooltip.style.top = my + 'px'; this.tooltip.textContent = best.kind === 'note' ? `${best.label} · ${best.group}` : `${best.label} · connected`; }
      else this.tooltip.style.display = 'none';
    }
  }

  step() {
    if (this.alpha < 0.02) return;
    const N = this.nodes, rCore = 62;
    for (let i = 0; i < N.length; i++) {
      const a = N[i];
      for (let j = i + 1; j < N.length; j++) {
        const b = N[j];
        let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy || 0.01;
        if (d2 > 200 * 200) continue;
        const f = (1100 / d2) * this.alpha;
        const d = Math.sqrt(d2);
        dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    for (const e of this.edges) {
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - 70) / d) * 0.008 * this.alpha;
      e.a.vx += dx * f; e.a.vy += dy * f; e.b.vx -= dx * f; e.b.vy -= dy * f;
    }
    for (const n of N) {
      const d = Math.sqrt(n.x * n.x + n.y * n.y) || 1;
      const target = this.R * 0.72;
      const f = ((d - target) / d) * 0.012 * this.alpha;
      n.vx -= n.x * f; n.vy -= n.y * f;
      if (n.anchor !== undefined) { // pull toward its lobe
        const ax = Math.cos(n.anchor) * target, ay = Math.sin(n.anchor) * target * 0.8;
        n.vx += (ax - n.x) * 0.006 * this.alpha; n.vy += (ay - n.y) * 0.006 * this.alpha;
      }
      if (d < rCore + 30) { n.vx += (n.x / d) * 1.2; n.vy += (n.y / d) * 1.2; }
      n.vx *= 0.82; n.vy *= 0.82;
      n.x += n.vx; n.y += n.vy;
      const lim = this.R * 1.05;
      if (d > lim) { n.x *= lim / d; n.y *= lim / d; }
    }
    this.alpha *= 0.994;
  }

  loop(now) {
    this.t = now;
    this.step();
    const ctx = this.ctx, cx = this.cx, cy = this.cy;
    ctx.clearRect(0, 0, this.w, this.h);

    // backdrop rings + dot grid
    ctx.save();
    ctx.strokeStyle = 'rgba(0,49,75,.55)';
    ctx.lineWidth = 1;
    for (const k of [0.45, 0.8, 1.15]) { ctx.beginPath(); ctx.ellipse(cx, cy, this.R * k * 1.35, this.R * k, 0, 0, TAU); ctx.stroke(); }
    ctx.setLineDash([2, 6]);
    ctx.beginPath(); ctx.ellipse(cx, cy, Math.min(this.w * 0.46, this.R * (this.compact ? 2.1 : 1.55)), Math.min(this.h * (this.compact ? 0.16 : 0.36), this.R * 1.15), 0, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    const hl = (id) => (this.highlight.get(id) || 0) > now;

    // edges
    ctx.lineWidth = 1;
    for (const e of this.edges) {
      const on = hl(e.a.id) || hl(e.b.id);
      ctx.strokeStyle = on ? 'rgba(0,229,255,.55)' : 'rgba(0,124,170,.18)';
      ctx.beginPath(); ctx.moveTo(cx + e.a.x, cy + e.a.y); ctx.lineTo(cx + e.b.x, cy + e.b.y); ctx.stroke();
    }

    // sources orbit + spokes
    for (const s of this.sources) {
      const p = this.sourcePos(s);
      ctx.strokeStyle = `rgba(0,124,170,${0.12 + s.pulse * 0.6})`;
      ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.setLineDash([]);
      const r = 15 + s.pulse * 6;
      const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, r * 2.2);
      g.addColorStop(0, hex(s.color, 0.45 + s.pulse * 0.4)); g.addColorStop(1, hex(s.color, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#01060e'; ctx.strokeStyle = s.color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, 15, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = s.color; ctx.font = '600 11px Rajdhani, Roboto, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(s.short || s.name.slice(0, 2).toUpperCase(), p.x, p.y + 1);
      ctx.fillStyle = 'rgba(157,178,215,.85)'; ctx.font = '11px Roboto, sans-serif';
      ctx.fillText(s.name.replace(/ \(.*\)/, '').replace(' / Microsoft 365', ''), p.x, p.y + 28);
      s.pulse *= 0.96;
    }

    // notes
    for (const n of this.nodes) {
      const x = cx + n.x, y = cy + n.y, on = hl(n.id), r = 2.5 + Math.min(n.deg, 10) * 0.45 + (on ? 2 : 0);
      if (on) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
        g.addColorStop(0, hex(n.color, 0.6)); g.addColorStop(1, hex(n.color, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 5, 0, TAU); ctx.fill();
        ctx.strokeStyle = hex(n.color, 0.5); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx, cy); ctx.stroke();
      }
      ctx.fillStyle = hex(n.color, on ? 1 : 0.85);
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      if (on || (this.hover && this.hover.id === n.id) || n.deg >= 6) {
        ctx.fillStyle = on ? '#e9e7ff' : 'rgba(183,190,224,.7)'; ctx.font = `${on ? 600 : 400} 11px Roboto, sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(n.label, x, y - r - 6);
      }
    }

    // particles
    this.particles = this.particles.filter((p) => p.p < 1);
    for (const p of this.particles) {
      p.p += p.slow ? 0.012 : 0.018;
      if (p.p < 0) continue;
      const e = easeInOut(p.p);
      const x = p.x + (p.tx - p.x) * e, y = p.y + (p.ty - p.y) * e;
      ctx.fillStyle = hex(p.color, 1 - p.p * 0.5);
      ctx.beginPath(); ctx.arc(x, y, 3, 0, TAU); ctx.fill();
      ctx.strokeStyle = hex(p.color, 0.35);
      const e2 = easeInOut(Math.max(0, p.p - 0.08));
      ctx.beginPath(); ctx.moveTo(p.x + (p.tx - p.x) * e2, p.y + (p.ty - p.y) * e2); ctx.lineTo(x, y); ctx.stroke();
      if (p.p >= 0.97) this.flash = Math.max(this.flash, 0.6);
    }

    this.drawCore(now);
    requestAnimationFrame(this.loop);
  }

  drawCore(now) {
    const ctx = this.ctx, cx = this.cx, cy = this.cy;
    const speed = this.state === 'thinking' ? 4 : this.state === 'listening' ? 2 : this.state === 'speaking' ? 2.5 : 1;
    const t = now * 0.001 * speed;
    const lvl = this.state === 'listening' ? this.level : this.state === 'speaking' ? 0.3 + 0.3 * Math.sin(now * 0.02) : 0;
    const base = 52 + lvl * 14 + this.flash * 8;
    const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, base * 2.4);
    const col = this.state === 'listening' ? '255,59,92' : '0,229,255';
    glow.addColorStop(0, `rgba(${col},${0.55 + this.flash * 0.3})`);
    glow.addColorStop(0.35, `rgba(${col},.14)`);
    glow.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, base * 2.4, 0, TAU); ctx.fill();

    ctx.lineCap = 'round';
    const rings = [[base, 2, 0.9, 1], [base + 12, 1.5, -0.6, 3], [base + 24, 1, 0.35, 5], [base - 14, 3, -1.4, 2]];
    rings.forEach(([r, w, sp, segs], k) => {
      ctx.lineWidth = w;
      ctx.strokeStyle = `rgba(${col},${0.85 - k * 0.15})`;
      for (let s = 0; s < segs; s++) {
        const a0 = t * sp + (s / segs) * TAU;
        ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + (TAU / segs) * 0.62); ctx.stroke();
      }
    });
    // tick marks
    ctx.strokeStyle = `rgba(${col},.35)`; ctx.lineWidth = 1;
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU + t * 0.1, r1 = base + 32, r2 = r1 + (i % 5 === 0 ? 7 : 3);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
    }
    // inner core
    const ig = ctx.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 26);
    ig.addColorStop(0, '#ffffff'); ig.addColorStop(0.3, `rgba(${col},.95)`); ig.addColorStop(1, `rgba(${col},.05)`);
    ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(cx, cy, 24 + lvl * 8 + Math.sin(now * 0.003) * 1.5, 0, TAU); ctx.fill();
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
    const speed = state === 'speaking' ? 5 : state === 'thinking' ? 3.5 : state === 'listening' ? 1.4 : 1;
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
    ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(c, c, c * (0.26 + pulse * 0.08) + Math.sin(now * 0.003) * 1.5, 0, TAU); ctx.fill();
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
