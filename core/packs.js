// Role packs extend the foundation brain for a job: extra connectors, agents, skills and notes.
// A pack is a folder in /packs with pack.json and a vault/ folder whose files are copied into the user's vault.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const vault = require('./vault');
const feed = require('./feed');

const PACKS_DIR = path.join(config.ROOT, 'packs');

function listFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function list() {
  if (!fs.existsSync(PACKS_DIR)) return [];
  const cfg = config.load();
  return fs.readdirSync(PACKS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const meta = JSON.parse(fs.readFileSync(path.join(PACKS_DIR, d.name, 'pack.json'), 'utf8'));
    const files = listFiles(path.join(PACKS_DIR, d.name, 'vault'));
    return { ...meta, id: d.name, installed: cfg.packs.includes(d.name), files };
  }).sort((a, b) => (a.order || 9) - (b.order || 9));
}

function install(id) {
  const pack = list().find((p) => p.id === id);
  if (!pack) throw new Error('Unknown pack ' + id);
  const root = vault.vaultRoot();
  const copied = [];
  for (const rel of pack.files) {
    const dest = vault.safeJoin(root, rel);
    if (fs.existsSync(dest)) continue; // never overwrite the user's edits
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(PACKS_DIR, id, 'vault', rel), dest);
    copied.push(rel);
  }
  config.update((cfg) => {
    if (!cfg.packs.includes(id)) cfg.packs.push(id);
    cfg.packFiles = cfg.packFiles || {};
    cfg.packFiles[id] = [...new Set([...(cfg.packFiles[id] || []), ...copied])];
    for (const c of pack.connectors || []) {
      if (!cfg.connections.business[c]) cfg.connections.business[c] = { mode: 'demo', connectedAt: Date.now(), pack: id };
    }
  });
  vault.invalidate();
  feed.surfacePack(id);
  return { pack: id, copied };
}

function uninstall(id) {
  const cfg = config.load();
  const files = (cfg.packFiles && cfg.packFiles[id]) || [];
  for (const rel of files) { try { vault.deleteNote(rel); } catch { /* already gone */ } }
  config.update((c) => {
    c.packs = c.packs.filter((p) => p !== id);
    if (c.packFiles) delete c.packFiles[id];
    for (const prof of Object.values(c.connections)) for (const [k, v] of Object.entries(prof)) if (v.pack === id) delete prof[k];
  });
  vault.invalidate();
  return { pack: id, removed: files.length };
}

module.exports = { list, install, uninstall };
