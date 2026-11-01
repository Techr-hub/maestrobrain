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
const calendar = require('./core/calendar');
const tasks = require('./core/tasks');
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
feed.bus.on('item', (item) => { seenIds.add(item.id); broadcast('feed', item); });

// Items written by another process (Claude Desktop via the MCP server) show up live too.
let feedMtime = 0;
setInterval(() => {
  try {
    const st = fs.statSync(path.join(config.DATA_DIR, 'feed.json'));
    if (st.mtimeMs === feedMtime) return;
    feedMtime = st.mtimeMs;
    for (const it of feed.readAll().slice(0, 20)) if (!seenIds.has(it.id)) { seenIds.add(it.id); broadcast('feed', it); }
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
function connectorView(cfg) {
  return connectors.list().map((c) => ({
    ...c,
    status: {
      business: cfg.connections.business[c.id] ? { mode: cfg.connections.business[c.id].mode, connectedAt: cfg.connections.business[c.id].connectedAt, message: cfg.connections.business[c.id].message || '' } : null,
      personal: cfg.connections.personal[c.id] ? { mode: cfg.connections.personal[c.id].mode, connectedAt: cfg.connections.personal[c.id].connectedAt, message: cfg.connections.personal[c.id].message || '' } : null,
    },
  }));
}

// ---------------------------------------------------------------- routes
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, pattern, fn });

route('GET', '/api/state', async () => {
  const cfg = config.load();
  return {
    config: config.publicView(cfg),
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
route('POST', '/api/feed/read-all', async () => { for (const i of feed.list({ limit: 300 })) if (i.unread) feed.markRead(i.id); return { ok: true }; });

route('GET', '/api/graph', async () => vault.graph(config.load().profile));
route('GET', '/api/vault/tree', async () => vault.tree());
route('GET', '/api/vault/note', async (q) => vault.readNote(q.get('path')));
route('POST', '/api/vault/note', async (_q, body) => ({ path: vault.writeNote(body.path, body.content, { append: !!body.append }) }));
route('GET', '/api/search', async (q) => vault.search(q.get('q') || '', { limit: 12 }));

route('POST', '/api/chat', async (_q, body) => brain.chat({ message: body.message, agentHandle: body.agent, conversationId: body.conversationId, voice: !!body.voice }));
route('POST', '/api/chat/save', async (_q, body) => ({ path: brain.saveAnswer(body.title || 'Brain answer', body.content || '') }));
route('GET', '/api/conversations', async () => brain.loadConversations());

route('GET', '/api/tasks', async (q) => tasks.list({ profile: config.load().profile, includeDone: q.get('done') === '1' }));
route('POST', '/api/tasks', async (_q, body) => ({ line: tasks.add(body.text, body) }));
route('POST', '/api/tasks/toggle', async (_q, body) => ({ done: tasks.toggle(body.path, body.line) }));

route('GET', '/api/calendar', async (q) => calendar.list({ days: Number(q.get('days') || 7) }));

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
    for (const [k, v] of Object.entries(fields)) if (v && !String(v).startsWith('••')) merged[k] = v;
    c.connections[profile][id] = { mode, connectedAt: Date.now(), fields: mode === 'live' ? merged : undefined, message };
  });
  const surfaced = mode !== 'live' ? feed.surfaceSource(id, profile) : 0;
  if (mode === 'live') feed.pollLive().catch(() => {});
  return { ok: true, message, surfaced };
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
    setTimeout(tickDemo, ((c.demo && c.demo.intervalSeconds) || 35) * 1000 * (0.7 + Math.random() * 0.6));
  };
  setTimeout(tickDemo, 20000);
  setInterval(() => workflows.tick().catch(() => {}), 60000);
  setInterval(() => feed.pollLive().catch(() => {}), 120000);
  feed.pollLive().catch(() => {});

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

module.exports = { start, createServer };

if (require.main === module) {
  start().then(({ port }) => console.log(`Maestro is running at http://localhost:${port}`)).catch((e) => { console.error(e.message); process.exit(1); });
}
