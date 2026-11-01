// The knowledge layer: an Obsidian vault of plain Markdown files.
// Maestro reads it, searches it, maps its [[wikilinks]] into the brain map, and writes memory back into it.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);

function vaultRoot() {
  return config.load().vaultPath;
}

function safeJoin(root, rel) {
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('Path is outside the vault');
  return full;
}

function walk(dir, root, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.isDirectory()) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, root, out);
    else if (e.name.toLowerCase().endsWith('.md')) out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: text };
  const data = {};
  let lastKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && lastKey) {
      if (!Array.isArray(data[lastKey])) data[lastKey] = [];
      data[lastKey].push(unquote(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_\-]+):\s*(.*)$/);
    if (!kv) continue;
    lastKey = kv[1];
    let v = kv[2].trim();
    if (v === '') { data[lastKey] = ''; continue; }
    if (v.startsWith('[') && v.endsWith(']')) data[lastKey] = v.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
    else if (v === 'true' || v === 'false') data[lastKey] = v === 'true';
    else data[lastKey] = unquote(v);
  }
  return { data, body: text.slice(m[0].length) };
}

function unquote(s) {
  return s.replace(/^["']|["']$/g, '');
}

function linksIn(body) {
  const out = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(body))) out.push(m[1].trim());
  return out;
}

function tagsIn(body, fm) {
  const tags = new Set(Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : []);
  const re = /(^|\s)#([A-Za-z][\w\-/]*)/g;
  let m;
  while ((m = re.exec(body))) tags.add(m[2]);
  return [...tags];
}

function noteProfile(rel, fm) {
  if (fm.profile) return String(fm.profile).toLowerCase();
  if (/^Personal\//i.test(rel)) return 'personal';
  if (/^(Memory|Skills|Agents|Templates|Daily|Knowledge)\//i.test(rel)) return 'both';
  return 'business';
}

let cache = { at: 0, root: '', notes: [] };

function loadNotes(force = false) {
  const root = vaultRoot();
  if (!force && cache.root === root && Date.now() - cache.at < 2000) return cache.notes;
  const notes = walk(root, root).map((rel) => {
    const full = path.join(root, rel);
    const text = fs.readFileSync(full, 'utf8');
    const { data, body } = parseFrontmatter(text);
    const stat = fs.statSync(full);
    const title = data.title || path.basename(rel, '.md');
    return {
      path: rel,
      title,
      folder: rel.includes('/') ? rel.split('/')[0] : '(root)',
      frontmatter: data,
      body,
      links: linksIn(body),
      tags: tagsIn(body, data),
      profile: noteProfile(rel, data),
      modified: stat.mtimeMs,
      size: stat.size,
    };
  });
  cache = { at: Date.now(), root, notes };
  return notes;
}

function invalidate() { cache.at = 0; }

function readNote(rel) {
  const root = vaultRoot();
  const full = safeJoin(root, rel);
  const text = fs.readFileSync(full, 'utf8');
  const { data, body } = parseFrontmatter(text);
  return { path: rel, title: data.title || path.basename(rel, '.md'), frontmatter: data, body, raw: text };
}

function findByTitle(title) {
  const t = title.toLowerCase().replace(/\.md$/, '');
  return loadNotes().find((n) => n.title.toLowerCase() === t || path.basename(n.path, '.md').toLowerCase() === t || n.path.toLowerCase() === t + '.md' || n.path.toLowerCase() === t);
}

function writeNote(rel, content, { append = false } = {}) {
  const root = vaultRoot();
  if (!rel.toLowerCase().endsWith('.md')) rel += '.md';
  const full = safeJoin(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (append && fs.existsSync(full)) {
    const prev = fs.readFileSync(full, 'utf8');
    fs.writeFileSync(full, prev.replace(/\s*$/, '') + '\n' + content + '\n');
  } else {
    fs.writeFileSync(full, content.endsWith('\n') ? content : content + '\n');
  }
  invalidate();
  return rel;
}

function deleteNote(rel) {
  const full = safeJoin(vaultRoot(), rel);
  if (fs.existsSync(full)) fs.unlinkSync(full);
  invalidate();
}

const STOP = new Set('a an and are as at be but by can do for from has have how i in is it its me my of on or our so that the their them this to was we what when where which who why will with you your about into than then there these those just also any all get got need please tell show give'.split(' '));

function tokenize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
}

function search(query, { limit = 6, profile } = {}) {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const notes = loadNotes().filter((n) => !profile || n.profile === 'both' || n.profile === profile);
  const scored = notes.map((n) => {
    const title = n.title.toLowerCase();
    const hay = (n.body + ' ' + n.tags.join(' ')).toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 6;
      if (n.tags.some((g) => g.toLowerCase().includes(t))) score += 3;
      const hits = hay.split(t).length - 1;
      score += Math.min(hits, 8);
    }
    if (n.folder === 'Memory') score += 0.5;
    return { note: n, score };
  }).filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ note, score }) => ({
    path: note.path,
    title: note.title,
    folder: note.folder,
    score,
    excerpt: excerpt(note.body, terms),
  }));
}

function excerpt(body, terms) {
  const clean = body.replace(/\s+/g, ' ').trim();
  const lower = clean.toLowerCase();
  let idx = -1;
  for (const t of terms) { idx = lower.indexOf(t); if (idx >= 0) break; }
  const start = Math.max(0, idx - 80);
  return (start > 0 ? '…' : '') + clean.slice(start, start + 260) + (clean.length > start + 260 ? '…' : '');
}

function tree() {
  return loadNotes().map((n) => ({ path: n.path, title: n.title, folder: n.folder, modified: n.modified, profile: n.profile, tags: n.tags }));
}

// Brain map graph: notes + their wikilinks.
function graph(profile) {
  const notes = loadNotes().filter((n) => !profile || n.profile === 'both' || n.profile === profile);
  const byName = new Map();
  for (const n of notes) {
    byName.set(n.title.toLowerCase(), n.path);
    byName.set(path.basename(n.path, '.md').toLowerCase(), n.path);
  }
  const nodes = notes.map((n) => ({ id: n.path, label: n.title, group: n.folder, tags: n.tags }));
  const edges = [];
  const seen = new Set();
  for (const n of notes) {
    for (const l of n.links) {
      const target = byName.get(l.toLowerCase());
      if (!target || target === n.path) continue;
      const key = [n.path, target].sort().join('→');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: n.path, target });
    }
  }
  return { nodes, edges };
}

module.exports = { vaultRoot, loadNotes, readNote, writeNote, deleteNote, findByTitle, search, tree, graph, parseFrontmatter, invalidate, tokenize, safeJoin };
