// Maestro dashboard server: serves the browser UI and a small JSON API over the brain.
// Zero dependencies (Node built-ins only), binds to localhost.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const config = require('./core/config');
const vault = require('./core/vault');
const knowledge = require('./core/knowledge');
const feed = require('./core/feed');
const eventtypes = require('./core/eventtypes');
const projects = require('./core/projects');
const calwatch = require('./core/calwatch');
const calendar = require('./core/calendar');
const tasks = require('./core/tasks');
const reminders = require('./core/reminders');
const agents = require('./core/agents');
const packs = require('./core/packs');
const brain = require('./core/brain');
const workflows = require('./core/workflows');
const connectors = require('./core/connectors');
const claudeDesktop = require('./core/claude-desktop');
const llm = require('./core/llm');
const { createZip } = require('./core/zip');

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

// ---------------------------------------------------------------- SSE
const clients = new Set();
function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
const seenIds = new Set(feed.readAll().map((i) => i.id));
feed.bus.on('item', (item) => { seenIds.add(item.id); broadcast('feed', feed.withType(item)); });
feed.bus.on('update', (item) => broadcast('feed-update', feed.withType(item)));
feed.bus.on('remove', (item) => broadcast('feed-remove', { id: item.id }));

// Every repeating job goes through every(), so an update-restart can stop them all (see watchForUpdates).
const timers = [];
let stopping = false;
const every = (fn, ms) => { const t = setInterval(() => { if (!stopping) fn(); }, ms); timers.push(t); return t; };

// The code this process is running, so the dashboard can tell when Maestro was updated on disk.
const CODE_DIRS = [__dirname, path.join(__dirname, 'core'), path.join(__dirname, 'mcp'), path.join(__dirname, 'bin')];
function codeStamp() {
  let max = 0;
  for (const d of CODE_DIRS) { try { for (const f of fs.readdirSync(d)) if (f.endsWith('.js')) max = Math.max(max, fs.statSync(path.join(d, f)).mtimeMs); } catch { /* missing folder */ } }
  try { max = Math.max(max, fs.statSync(path.join(__dirname, 'package.json')).mtimeMs); } catch { /* none */ }
  return Math.round(max);
}
const BUILD = String(codeStamp());

// Items written by another process (Claude Desktop via the MCP server) show up live too.
let feedMtime = 0;
let lastRemovedScan = Date.now();
every(() => {
  try {
    const st = fs.statSync(path.join(config.DATA_DIR, 'feed.json'));
    if (st.mtimeMs === feedMtime) return;
    feedMtime = st.mtimeMs;
    const all = feed.readAll();
    for (const it of all.slice(0, 20)) if (!seenIds.has(it.id)) { seenIds.add(it.id); broadcast('feed', it); }
    for (const it of all) if (it.removedAt && it.removedAt > lastRemovedScan) broadcast('feed-update', feed.withType(it)); // greyed out from Claude Desktop
    lastRemovedScan = Date.now();
  } catch { /* no feed yet */ }
}, 2000);

// ---------------------------------------------------------------- helpers
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { 'content-type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(isBuf ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5e6) reject(new Error('Body too large')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('Invalid JSON')); } });
  });
}
// Saved field values go back to the settings window so people can see what they connected.
// Secrets come back masked; calendar links come back as a list.
function savedFields(def, conn) {
  if (!conn || !conn.fields) return {};
  const out = {};
  for (const f of (conn.mode === 'claude' ? def.claudeFields : def.liveFields) || []) {
    if (f.type === 'list') out[f.key] = f.key === 'icsUrls' ? connectors.calendarUrls(conn.fields) : (conn.fields[f.key] || []);
    else if (conn.fields[f.key]) out[f.key] = f.secret ? '••••••••' : conn.fields[f.key];
  }
  return out;
}
function connectorView(cfg) {
  const st = (c, prof) => { const k = cfg.connections[prof][c.id]; return k ? { mode: k.mode, connectedAt: k.connectedAt, message: k.message || '', fields: savedFields(c, k), error: k.lastError || '' } : null; };
  return connectors.list().map((c) => ({ ...c, status: { business: st(c, 'business'), personal: st(c, 'personal') } }));
}

// ---------------------------------------------------------------- routes
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, pattern, fn });

route('GET', '/api/state', async () => {
  const cfg = config.load();
  return {
    config: config.publicView(cfg),
    eventTypes: eventtypes.list(cfg),
    projects: (() => { try { return projects.list().map(({ path, name, client, made }) => ({ path, name, client, made })); } catch { return []; } })(),
    providers: llm.PROVIDERS,
    connectors: connectorView(cfg),
    agents: agents.agents().map(({ prompt, ...a }) => a),
    skills: agents.skills().map(({ instructions, ...s }) => s),
    packs: packs.list(),
    workflows: workflows.list(),
    claudeDesktop: claudeDesktop.status(),
    vaultPath: cfg.vaultPath,
    vaultName: path.basename(cfg.vaultPath),
    knowledge: knowledge.status(),
    unread: feed.list({ limit: 200 }).filter((i) => i.unread).length,
  };
});

route('POST', '/api/profile', async (_q, body) => {
  if (!['business', 'personal'].includes(body.profile)) throw new Error('Unknown profile');
  config.update((c) => { c.profile = body.profile; });
  broadcast('profile', { profile: body.profile });
  return { ok: true };
});

route('GET', '/api/feed', async (q) => feed.list({ source: q.get('source'), category: q.get('category'), limit: Number(q.get('limit') || 60) }));
route('POST', '/api/feed/read', async (_q, body) => feed.markRead(body.id));
route('GET', '/api/version', async () => ({ app: 'maestro', build: BUILD, root: __dirname, pid: process.pid }));
// A newer Maestro starting on this port asks the running one to step aside (localhost only).
route('POST', '/api/shutdown', async (_q, body) => { if (!body || body.reason !== 'update') return { error: 'Not allowed' }; setTimeout(() => process.exit(0), 150); return { ok: true }; });
route('POST', '/api/feed/dismiss', async (_q, body) => feed.dismiss(body.id) || { error: 'Card not found' });
route('POST', '/api/feed/pin', async (_q, body) => feed.setPinned(body.id, body.pinned !== false) || { error: 'Card not found' });
// The refresh button on the Intelligence Feed (Ryan, 2026-11-03): pull everything into Maestro now instead of waiting
// for the timers: every live calendar and Calendly (new, moved, cancelled events), Slack, texts, WhatsApp and calls,
// the vault (notes edited in Obsidian), and task reminders. The dashboard then reloads the feed, map and counts.
route('POST', '/api/feed/refresh', async () => {
  const cfg = config.load();
  const before = new Set(feed.readAll().map((i) => i.id));
  const live = [], viaClaude = [];
  for (const conns of Object.values(cfg.connections || {})) for (const [id, c] of Object.entries(conns || {})) {
    if (c.mode === 'live') live.push(id); else if (c.mode === 'claude') viaClaude.push(id);
    try { calendar.forget(connectors.calendarUrls(c.fields || {})); } catch { /* not a calendar */ }
  }
  vault.invalidate();
  await Promise.allSettled([feed.pollLive(), calwatch.check()]);
  try { reminders.check(); } catch { /* best-effort */ }
  const added = feed.readAll().filter((i) => !before.has(i.id)).length;
  const now = config.load();
  const errors = Object.values(now.connections[now.profile] || {}).filter((c) => c.lastError).length;
  return { ok: true, at: Date.now(), added, live: [...new Set(live)].length, viaClaude: [...new Set(viaClaude)], errors };
});
// Event types (Ryan, 2026-11-04): edit the list, or switch one card's event to another type.
route('GET', '/api/event-types', async () => eventtypes.list());
route('GET', '/api/event-types/defaults', async () => eventtypes.DEFAULTS);
route('POST', '/api/event-types', async (_q, body) => {
  const types = eventtypes.clean(body.types);
  if (!types.length) throw Object.assign(new Error('Keep at least one category.'), { status: 400 });
  config.update((c) => {
    c.eventTypes = types;
    const ids = new Set(types.map((t) => t.id));
    for (const [k, v] of Object.entries(c.eventTypeOverrides || {})) if (!ids.has(v)) delete c.eventTypeOverrides[k];
  });
  // every calendar card is labelled again with the new list
  const cfg = config.load();
  feed.updateCards((i) => i.category === 'MEETING', (i) => ({ eventType: eventtypes.typeFor({ title: String(i.title || '').replace(/^(New( recurring event)?|Updated|Moved|Time changed|Cancelled): /, ''), description: `${i.description || ''} ${i.quote || ''}`, eventKey: i.eventKey || i.id }, i.source, cfg) }));
  return eventtypes.list();
});
route('POST', '/api/feed/event-type', async (_q, body) => {
  const card = feed.readAll().find((i) => i.id === body.id);
  if (!card) throw Object.assign(new Error('That card is gone.'), { status: 404 });
  if (!eventtypes.list().some((t) => t.id === body.type)) throw Object.assign(new Error('Unknown category.'), { status: 400 });
  const key = eventtypes.keyOf(card.source, card.eventKey || card.id);
  config.update((c) => { c.eventTypeOverrides = { ...(c.eventTypeOverrides || {}), [key]: body.type }; });
  const n = feed.updateCards((i) => i.source === card.source && (card.eventKey ? i.eventKey === card.eventKey : i.id === card.id), () => ({ eventType: body.type }));
  return { ok: true, updated: n };
});
route('POST', '/api/feed/read-all', async () => { for (const i of feed.list({ limit: 300 })) if (i.unread) feed.markRead(i.id); return { ok: true }; });

route('GET', '/api/graph', async () => vault.graph(config.load().profile));
// The counts above the brain map (Ryan, 2026-11-03): read fresh each time, so they match the vault and connections now.
// Notes are your knowledge notes for this profile; agents, skills and note templates are counted on their own or left out.
route('GET', '/api/stats', async () => {
  const cfg = config.load();
  vault.invalidate();
  const notes = vault.loadNotes().filter((n) => (n.profile === 'both' || n.profile === cfg.profile) && !['Agents', 'Skills', 'Templates'].includes(n.folder)).length;
  return { notes, sources: Object.keys(cfg.connections[cfg.profile] || {}).length, agents: agents.agents().length, skills: agents.skills().length };
});
route('GET', '/api/vault/tree', async () => vault.tree());
route('GET', '/api/vault/note', async (q) => vault.readNote(q.get('path')));
route('POST', '/api/vault/note', async (_q, body) => ({ path: vault.writeNote(body.path, body.content, { append: !!body.append }) }));
route('GET', '/api/search', async (q) => vault.search(q.get('q') || '', { limit: 12 }));

route('POST', '/api/chat', async (_q, body) => brain.chat({ message: body.message, agentHandle: body.agent, conversationId: body.conversationId, voice: !!body.voice }));
route('POST', '/api/chat/save', async (_q, body) => ({ path: brain.saveAnswer(body.title || 'Brain answer', body.content || '') }));
route('GET', '/api/conversations', async () => brain.loadConversations());

// Projects page (Ryan, 2026-11-04)
route('GET', '/api/projects', async () => projects.list());
route('GET', '/api/projects/one', async (q) => projects.get(q.get('path')));
// A new project also gets a card in the Intelligence Feed (Ryan, 2026-11-04); editing the project keeps that card current.
const fmtDay = (d) => (d ? new Date(d + 'T12:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const projectCard = (p) => ({
  title: `New project: ${p.name}`,
  quote: [p.client && `Client: ${p.client}`, (p.start || p.completion) && `${fmtDay(p.start) || '?'} → ${fmtDay(p.completion) || '?'}`].filter(Boolean).join(' · '),
  description: p.description || '',
  summary: [p.nextMilestone && `Next milestone: ${p.nextMilestone.name}${p.nextMilestone.date ? ` (${fmtDay(p.nextMilestone.date)})` : ''}`, `${p.tasks.open} open task${p.tasks.open === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
  progress: p.tasks.total ? p.progress : undefined,
  deadline: p.completion ? `Due ${fmtDay(p.completion)}` : '',
});
route('POST', '/api/projects', async (_q, body) => {
  const p = projects.create(body || {});
  feed.add({ externalId: `project:${p.path}`, ts: Date.now(), source: 'system', profile: config.load().profile, category: 'PROJECT', projectPath: p.path, actions: ['Open project'], ...projectCard(p) });
  return p;
});
route('POST', '/api/projects/update', async (_q, body) => {
  const p = projects.update(body.path, body);
  feed.updateCards((i) => i.externalId === `project:${p.path}`, () => projectCard(p));
  return p;
});
route('POST', '/api/projects/task', async (_q, body) => {
  const line = projects.addTask(body.path, body); reminders.check();
  try { const p = projects.get(body.path); feed.updateCards((i) => i.externalId === `project:${p.path}`, () => projectCard(p)); } catch { /* card cleared */ }
  return { line };
});
route('GET', '/api/tasks', async (q) => tasks.list({ profile: config.load().profile, includeDone: q.get('done') === '1' }));
route('POST', '/api/tasks', async (_q, body) => { const line = tasks.add(body.text, body); reminders.check(); return { line }; });
route('POST', '/api/tasks/event', async (_q, body) => { const r = tasks.addForEvent(body || {}); reminders.check(); return r; });
route('POST', '/api/tasks/toggle', async (_q, body) => {
  const done = tasks.toggle(body.path, body.line);
  if (/^Projects\//.test(body.path || '')) try { const p = projects.get(body.path); feed.updateCards((i) => i.externalId === `project:${p.path}`, () => projectCard(p)); } catch { /* not a project */ }
  return { done };
});
route('POST', '/api/tasks/update', async (_q, body) => { const r = tasks.update(body.path, body.line, body.expect, body); reminders.check(); return r; });

route('GET', '/api/calendar', async (q) => calendar.list({ days: Number(q.get('days') || 7), from: q.get('from') || undefined, to: q.get('to') || undefined }));

// A hub (Email, Calendar, Messages, Calls, Projects) gathers every connected source of that kind.
async function hubView(hid) {
  const hub = require('./core/hubs').HUBS.find((h) => h.id === hid);
  if (!hub) throw new Error('Unknown hub');
  const cfg = config.load();
  const conns = cfg.connections[cfg.profile] || {};
  const members = hub.members.map((m) => { const d = connectors.get(m); const c = conns[m]; return d && { id: m, name: d.name, color: d.color, icon: d.icon, connected: !!c, mode: c ? c.mode : null, error: c ? c.lastError || null : null }; }).filter(Boolean);
  const out = { id: 'hub:' + hid, hub: true, name: hub.name, color: hub.color, kind: hub.calendar ? 'calendar' : hub.projects ? 'projects' : 'feed', categories: hub.categories, members, connected: members.some((m) => m.connected), events: [], notes: [] };
  if (hub.calendar && out.connected) {
    const live = members.filter((m) => m.connected).map((m) => m.id);
    out.events = (await calendar.list({ days: 7 })).filter((e) => live.includes(e.source));
    for (const m of members) { const c = conns[m.id]; if (c && c.mode === 'live') m.error = calendar.errorForConn(c) || m.error; }
  }
  if (hub.projects) {
    // Projects always has your vault's project notes, even before a project tool is connected.
    out.notes = vault.loadNotes().filter((n) => n.folder === 'Projects' && !/index/i.test(n.title))
      .map((n) => ({ path: n.path, title: n.title, status: n.frontmatter.status || '', due: n.frontmatter.due || n.frontmatter.deadline || '', progress: n.frontmatter.points_total ? Math.round((Number(n.frontmatter.points_done) / Number(n.frontmatter.points_total)) * 100) : (n.frontmatter.progress != null ? Number(n.frontmatter.progress) : null) }));
    out.connected = out.connected || out.notes.length > 0;
  }
  return out;
}

// Everything about one source for the feed panel: its schedule (calendars), recent items, and whether it's connected or failing.
route('GET', '/api/hubs', async () => require('./core/hubs').HUBS);
route('GET', '/api/source', async (q) => {
  const id = q.get('id');
  if (id && id.startsWith('hub:')) return hubView(id.slice(4));
  const def = connectors.get(id);
  if (!def) throw new Error('Unknown source');
  const cfg = config.load();
  const conn = (cfg.connections[cfg.profile] || {})[id];
  const isCal = ['icalendar', 'gcal', 'outlook'].includes(id);
  const out = { id, name: def.name, color: def.color, icon: def.icon, kind: isCal ? 'calendar' : 'feed', connected: !!conn, mode: conn ? conn.mode : null, error: null, events: [], items: [] };
  if (!conn) return out;
  out.error = conn.lastError || null;
  if (isCal || id === 'gmail') {
    out.events = (await calendar.list({ days: 7 })).filter((e) => e.source === id);
    if (conn.mode === 'live') out.error = calendar.errorForConn(conn) || out.error;
  }
  out.items = feed.list({ source: id, limit: 40 });
  return out;
});
route('POST', '/api/connections', async (_q, body) => {
  const { id, profile = config.load().profile, mode = 'demo', fields = {} } = body;
  const def = connectors.get(id);
  if (!def) throw new Error('Unknown connector');
  if (!['demo', 'live', 'claude'].includes(mode)) throw new Error('Unknown connection mode');
  let message = mode === 'demo' ? 'Connected with demo data' : mode === 'claude' ? 'Live in Claude Desktop' : '';
  if (mode === 'live') message = await connectors.testLive(id, fields);
  config.update((c) => {
    const prev = c.connections[profile][id];
    // keep previously saved secrets when the form sends a masked value
    const merged = { ...((prev && prev.fields) || {}) };
    for (const [k, v] of Object.entries(fields)) if (Array.isArray(v) || (v && !String(v).startsWith('••'))) merged[k] = v;
    if (Array.isArray(fields.icsUrls)) delete merged.icsUrl; // the list replaces the old single link
    const claudeKeys = (def.claudeFields || []).map((f) => f.key);
    const claudeFields = Object.fromEntries(claudeKeys.filter((k) => fields[k] !== undefined).map((k) => [k, fields[k]]));
    c.connections[profile][id] = { mode, connectedAt: Date.now(), fields: mode === 'live' ? merged : mode === 'claude' && claudeKeys.length ? claudeFields : undefined, message };
  });
  if (mode === 'live') calendar.forget(connectors.calendarUrls(fields));
  const surfaced = mode === 'demo' ? feed.surfaceSource(id, profile) : 0;
  if (mode === 'live') { feed.pollLive().catch(() => {}); calwatch.check().catch(() => {}); }
  return { ok: true, message, surfaced };
});
// Slack channel picker: uses the token typed in the form, or the one already saved.
route('POST', '/api/slack/channels', async (_q, body) => {
  const cfg = config.load();
  const saved = ((cfg.connections[body.profile || cfg.profile] || {}).slack || {}).fields || {};
  const token = body.token && !String(body.token).startsWith('••') ? body.token : saved.token;
  if (!token) throw new Error('Paste your Slack token first');
  return connectors.slackChannels(token);
});
route('POST', '/api/connections/disconnect', async (_q, body) => {
  config.update((c) => { delete c.connections[body.profile || c.profile][body.id]; });
  return { ok: true };
});

route('GET', '/api/knowledge', async () => ({ ...knowledge.status(), detected: knowledge.detectObsidianVaults(), starter: knowledge.STARTER, custom: knowledge.CUSTOM }));
route('POST', '/api/knowledge/connect', async (_q, body) => knowledge.connect(body));
route('POST', '/api/knowledge/disconnect', async () => knowledge.disconnect());

route('POST', '/api/packs/install', async (_q, body) => packs.install(body.id));
route('POST', '/api/packs/uninstall', async (_q, body) => packs.uninstall(body.id));

route('POST', '/api/agents', async (_q, body) => ({ path: agents.createAgent(body) }));
route('POST', '/api/skills', async (_q, body) => ({ path: agents.createSkill(body) }));
route('POST', '/api/import', async (_q, body) => agents.importMarkdown(body.filename, body.content));
route('GET', '/api/claude-skills', async () => agents.claudeSkillFiles().map((f) => ({ folder: f.path.split('/')[0] })));

route('GET', '/api/workflows', async () => workflows.list());
route('POST', '/api/workflows/run', async (_q, body) => workflows.run(body.id));
route('POST', '/api/workflows/update', async (_q, body) => {
  config.update((c) => { c.workflows[body.id] = { ...(c.workflows[body.id] || {}), ...body.settings }; });
  return workflows.list();
});

route('POST', '/api/settings', async (_q, body) => {
  config.update((c) => {
    if (body.user) c.user = { ...c.user, ...body.user };
    if (body.assistantName) c.assistantName = body.assistantName;
    if (body.voice) c.voice = { ...c.voice, ...body.voice };
    if (body.demo) c.demo = { ...c.demo, ...body.demo };
    if (body.vaultPath) {
      const p = path.resolve(body.vaultPath.replace(/^~(?=$|[\\/])/, require('os').homedir()));
      if (!fs.existsSync(p)) throw new Error('That folder does not exist: ' + p);
      c.vaultPath = p;
    }
    if (body.llm) {
      if (body.llm.provider) c.llm.provider = body.llm.provider;
      for (const p of ['anthropic', 'openai', 'gemini', 'compatible']) {
        if (!body.llm[p]) continue;
        const next = { ...body.llm[p] };
        if (!next.apiKey || String(next.apiKey).startsWith('••')) delete next.apiKey;
        c.llm[p] = { ...c.llm[p], ...next };
      }
    }
    if (body.onboarded !== undefined) c.onboarded = !!body.onboarded;
  });
  vault.invalidate();
  return { ok: true };
});

route('POST', '/api/llm/test', async () => {
  const cfg = config.load();
  if (cfg.llm.provider === 'demo') return { ok: true, reply: 'Demo brain is ready (no key needed).' };
  const reply = await llm.complete(cfg.llm.provider, 'You are a connection test. Reply with one short friendly sentence.', [{ role: 'user', content: 'Say hello to the workshop.' }]);
  return { ok: true, reply };
});

route('GET', '/api/claude-desktop', async () => claudeDesktop.status());
route('POST', '/api/claude-desktop/register', async () => claudeDesktop.register());
// First-run choice: sample data, or start empty and connect real sources.
route('POST', '/api/data-mode', async (_q, body) => {
  const mode = body.mode === 'real' ? 'real' : 'demo';
  const fresh = config.defaultConfig();
  config.update((c) => {
    c.dataMode = mode;
    for (const prof of ['business', 'personal']) {
      const conns = c.connections[prof] || (c.connections[prof] = {});
      if (mode === 'real') { for (const [id, k] of Object.entries(conns)) if (k.mode === 'demo') delete conns[id]; }
      else for (const [id, k] of Object.entries(fresh.connections[prof])) if (!conns[id]) conns[id] = k;
    }
    c.demo.liveFeed = mode === 'demo';
  });
  return { ok: true, mode };
});
route('POST', '/api/reset-demo', async () => { feed.reset(); for (const it of feed.readAll()) seenIds.add(it.id); return { ok: true }; });

// ---------------------------------------------------------------- server
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const full = path.resolve(PUBLIC, '.' + rel);
  if (!full.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(full, (err, data) => {
    if (err) {
      return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, html) => (e2 ? send(res, 404, { error: 'Not found' }) : (res.writeHead(200, { 'content-type': MIME['.html'] }), res.end(html))));
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (p === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      const ka = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ka); clients.delete(res); });
      return;
    }

    // Events Maestro created, as a feed Apple Calendar or Outlook on this computer can subscribe to.
    if (p === '/calendar.ics') {
      const prof = url.searchParams.get('profile') || config.load().profile;
      const ev = require('./core/events');
      return send(res, 200, ev.toIcs(ev.list({ profile: prof }), `Maestro (${prof})`), { 'content-type': 'text/calendar; charset=utf-8' });
    }

    if (p === '/api/claude-skills/download') {
      const all = agents.claudeSkillFiles();
      const folder = url.searchParams.get('folder');
      const files = folder ? all.filter((f) => f.path.startsWith(folder + '/')) : all;
      if (!files.length) return send(res, 404, { error: 'No such skill' });
      const zip = createZip(files.map((f) => ({ path: f.path, data: f.content })));
      return send(res, 200, zip, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${folder || 'maestro-claude-skills'}.zip"` });
    }

    if (p.startsWith('/api/')) {
      const r = routes.find((x) => x.method === req.method && x.pattern === p);
      if (!r) return send(res, 404, { error: 'No such endpoint' });
      try {
        const body = req.method === 'POST' ? await readBody(req) : {};
        const out = await r.fn(url.searchParams, body);
        return send(res, 200, out === undefined ? { ok: true } : out);
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
    }
    return serveStatic(req, res, p);
  });
}

function start(port) {
  const cfg = config.load();
  if (port === undefined || port === null) port = Number(process.env.PORT) || cfg.port || 4141;
  const server = createServer();

  // Demo stream: a new notification every ~35s so the live feed feels alive in the workshop.
  const tickDemo = () => {
    const c = config.load();
    if (c.demo && c.demo.liveFeed && clients.size) feed.nextDemoItem();
    if (!stopping) setTimeout(tickDemo, ((c.demo && c.demo.intervalSeconds) || 35) * 1000 * (0.7 + Math.random() * 0.6));
  };
  setTimeout(tickDemo, 20000);
  every(() => workflows.tick().catch(() => {}), 60000);
  every(() => feed.pollLive().catch(() => {}), 120000);
  // calendars are checked every minute so new events reach the feed quickly
  every(() => calwatch.check().catch(() => {}), 60000);
  calwatch.check().catch(() => {});
  // task reminders (the only Insight cards): checked every minute, and right after a task is added
  every(() => { try { reminders.check(); } catch { /* best-effort */ } }, 60000); // every minute, so "2 hours before" lands on time
  try { reminders.check(); } catch { /* best-effort */ }
  feed.pollLive().catch(() => {});

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { watchForUpdates(server); resolve({ server, port: server.address().port }); });
  });
}

// Ryan (2026-11-02) hit "No such endpoint" after unzipping a new Maestro over a running one: the browser loaded the
// new page but the old server was still answering. Now, when the code on disk changes, Maestro restarts itself on
// the same port (in the same window) and open dashboards reload.
function watchForUpdates(server) {
  if (process.env.MAESTRO_NO_RESTART) return;
  let seen = BUILD, stableFor = 0;
  every(() => {
    const now = String(codeStamp());
    if (now === BUILD) return;
    if (now !== seen) { seen = now; stableFor = 0; return; } // still unzipping: wait until the files settle
    if (++stableFor < 2) return;
    stopping = true;
    timers.forEach(clearInterval);
    const port = server.address().port;
    console.log('\n   Maestro was updated. Restarting with the new version…\n');
    for (const res of clients) { try { res.end(); } catch { /* gone */ } }
    server.close(() => {
      const { spawn } = require('child_process');
      const child = spawn(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, PORT: String(port), MAESTRO_NO_BROWSER: '1' } });
      child.on('exit', (code) => process.exit(code || 0));
      process.on('SIGINT', () => child.kill('SIGINT'));
    });
    if (server.closeAllConnections) server.closeAllConnections();
  }, 2000);
}

module.exports = { start, createServer, BUILD };

if (require.main === module) {
  start().then(({ port }) => console.log(`Maestro is running at http://localhost:${port}`)).catch((e) => { console.error(e.message); process.exit(1); });
}
