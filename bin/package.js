#!/usr/bin/env node
// Build a clean, shareable ZIP of the kit: `npm run package` → dist/maestro-brain-<version>.zip
// Excludes personal data (data/, Daily and Inbox notes) so you can share it with workshop participants.
const fs = require('fs');
const path = require('path');
const { createZip } = require('../core/zip');

const ROOT = path.join(__dirname, '..');
const version = require('../package.json').version;
const SKIP = [/^\.git(\/|$)/, /^node_modules(\/|$)/, /^data(\/|$)/, /^dist(\/|$)/, /^vault\/Daily\/.+\.md$/, /^vault\/Inbox\/.+\.md$/, /\.DS_Store$/, /^vault\/\.obsidian\/workspace/];
const EXEC = new Set(['Start Maestro.command', 'install.sh', 'bin/maestro.js', 'mcp/server.js']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (SKIP.some((r) => r.test(rel))) continue;
    if (e.isDirectory()) walk(full, out); else out.push(rel);
  }
  return out;
}

const files = walk(ROOT);
const entries = files.map((rel) => ({ path: `maestro-brain/${rel}`, data: fs.readFileSync(path.join(ROOT, rel)), mode: EXEC.has(rel) ? 0o755 : 0o644 }));
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', `maestro-brain-${version}.zip`);
fs.writeFileSync(out, createZip(entries));
console.log(`Packaged ${files.length} files → ${path.relative(ROOT, out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
