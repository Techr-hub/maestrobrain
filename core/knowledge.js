// The knowledge base: the folder of Markdown notes the brain reads and writes.
// Types: 'obsidian' (an Obsidian vault), 'markdown' (any folder of .md files), or 'custom'
// (a third-party source such as Notion or Google Drive that Claude reaches through its connector or an MCP server;
// a local vault still holds Maestro's memory, agents and skills).
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');
const vault = require('./vault');

const STARTER = path.join(config.ROOT, 'vault');
// Folders Maestro needs inside any vault. Copied in without overwriting anything.
const SEED = ['Memory', 'Agents', 'Skills', 'Templates', 'Maestro Home.md'];

const CUSTOM = {
  notion: { name: 'Notion', how: 'Claude Desktop → Settings → Connectors → Notion.' },
  gdrive: { name: 'Google Drive', how: 'Claude Desktop → Settings → Connectors → Google Drive.' },
  confluence: { name: 'Confluence', how: 'Claude Desktop → Settings → Connectors → Atlassian.' },
  onedrive: { name: 'OneDrive / SharePoint', how: 'Claude Desktop → Settings → Connectors → Microsoft 365.' },
  other: { name: 'Other (MCP server)', how: 'Add the MCP server to claude_desktop_config.json next to "maestro", then restart Claude Desktop.' },
};

function expand(p) { return path.resolve(String(p || '').trim().replace(/^["']|["']$/g, '').replace(/^~(?=$|[\\/])/, os.homedir())); }

// Obsidian keeps a list of every vault you've opened in obsidian.json.
function detectObsidianVaults() {
  const home = os.homedir();
  const files = process.platform === 'darwin' ? [path.join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json')]
    : process.platform === 'win32' ? [path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'obsidian', 'obsidian.json')]
      : [path.join(home, '.config', 'obsidian', 'obsidian.json'), path.join(home, '.var', 'app', 'md.obsidian.Obsidian', 'config', 'obsidian', 'obsidian.json')];
  const out = [];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const v of Object.values(j.vaults || {})) if (v.path && fs.existsSync(v.path)) out.push({ path: v.path, name: path.basename(v.path), open: !!v.open, ts: v.ts || 0 });
    } catch { /* Obsidian not installed or never opened */ }
  }
  return out.sort((a, b) => b.ts - a.ts);
}

function countNotes(dir) {
  let n = 0;
  const walk = (d, depth) => {
    if (depth > 6 || n > 5000) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      if (e.isDirectory()) walk(path.join(d, e.name), depth + 1); else if (e.name.endsWith('.md')) n++;
    }
  };
  walk(dir, 0);
  return n;
}

function status() {
  const cfg = config.load();
  const k = cfg.knowledge || {};
  const p = cfg.vaultPath;
  const exists = fs.existsSync(p);
  return {
    type: k.type || 'obsidian',
    connected: !!k.connected && exists,
    connectedAt: k.connectedAt || null,
    path: p,
    name: path.basename(p),
    exists,
    isObsidian: exists && fs.existsSync(path.join(p, '.obsidian')),
    isStarter: path.resolve(p) === path.resolve(STARTER),
    notes: exists ? countNotes(p) : 0,
    custom: k.type === 'custom' ? { kind: k.customKind, name: k.customName || (CUSTOM[k.customKind] || {}).name, url: k.customUrl || '', how: (CUSTOM[k.customKind] || CUSTOM.other).how } : null,
  };
}

function seedInto(dir) {
  const copied = [];
  for (const item of SEED) {
    const src = path.join(STARTER, item), dst = path.join(dir, item);
    if (!fs.existsSync(src)) continue;
    const copy = (s, d) => {
      if (fs.statSync(s).isDirectory()) { fs.mkdirSync(d, { recursive: true }); for (const f of fs.readdirSync(s)) copy(path.join(s, f), path.join(d, f)); }
      else if (!fs.existsSync(d)) { fs.copyFileSync(s, d); copied.push(path.relative(dir, d)); }
    };
    copy(src, dst);
  }
  return copied;
}

function connect({ type = 'obsidian', path: p, seed = true, create = false, customKind, customName, customUrl } = {}) {
  if (!['obsidian', 'markdown', 'custom', 'starter'].includes(type)) throw new Error('Unknown knowledge base type');
  const current = config.load().vaultPath;
  // A custom source lives in Claude; keep the local vault you already have for memory, agents and skills.
  let dir = type === 'starter' ? STARTER : type === 'custom' ? (fs.existsSync(current) ? current : STARTER) : expand(p);
  if (type !== 'starter' && type !== 'custom' && !String(p || '').trim()) throw new Error('Paste the path to your folder first');
  if (!fs.existsSync(dir)) {
    if (!create) throw new Error(`That folder does not exist: ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.statSync(dir).isDirectory()) throw new Error('That path is a file, not a folder');
  try { fs.accessSync(dir, fs.constants.W_OK); } catch { throw new Error('Maestro cannot write to that folder. Check its permissions.'); }
  const copied = seed && path.resolve(dir) !== path.resolve(STARTER) ? seedInto(dir) : [];
  // A knowledge base Maestro used before brings its settings and connections with it.
  const prior = config.readKbSettings(dir);
  config.update((c) => {
    const hasOwn = Object.values(c.connections || {}).some((p) => Object.values(p).some((x) => x.mode === 'live' || x.mode === 'claude'));
    if (prior && !hasOwn) for (const k of ['user', 'assistantName', 'profile', 'llm', 'voice', 'connections', 'packs', 'workflows', 'dataMode']) if (prior[k] !== undefined) c[k] = prior[k];
    c.vaultPath = dir;
    c.knowledge = {
      type: type === 'starter' ? 'obsidian' : type, connected: true, connectedAt: Date.now(),
      ...(type === 'custom' ? { customKind: customKind || 'other', customName: customName || '', customUrl: customUrl || '' } : {}),
    };
  });
  vault.invalidate();
  return { ...status(), copied, restored: !!prior };
}

function disconnect() {
  config.update((c) => { c.knowledge = { ...(c.knowledge || {}), connected: false }; });
  return status();
}

module.exports = { status, connect, disconnect, detectObsidianVaults, CUSTOM, STARTER };
