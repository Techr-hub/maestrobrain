// Tasks live in the vault as Obsidian checkboxes ("- [ ] Do the thing 📅 2026-11-04 #high").
// Any note can hold tasks; new tasks go to Tasks/Inbox.md.
const fs = require('fs');
const path = require('path');
const vault = require('./vault');

const TASK_RE = /^(\s*)[-*] \[( |x|X)\] (.+)$/;

function parseLine(text) {
  const due = (text.match(/(?:📅|due:)\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
  const priority = /#(high|urgent|p1)\b|⏫|🔺/i.test(text) ? 'High' : /#(low|p3)\b|🔽/i.test(text) ? 'Low' : /#(medium|p2)\b|🔼/i.test(text) ? 'Medium' : '';
  const clean = text.replace(/(?:📅|due:)\s*\d{4}-\d{2}-\d{2}/g, '').replace(/[⏫🔺🔼🔽]/g, '').replace(/#(high|urgent|p1|p2|p3|low|medium)\b/gi, '').trim();
  return { text: clean, due, priority };
}

function list({ profile, includeDone = false } = {}) {
  const out = [];
  for (const n of vault.loadNotes()) {
    if (profile && n.profile !== 'both' && n.profile !== profile) continue;
    if (n.folder === 'Templates' || n.folder === 'Skills' || n.folder === 'Agents') continue;
    const full = vault.safeJoin(vault.vaultRoot(), n.path);
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const m = line.match(TASK_RE);
      if (!m) return;
      const done = m[2].toLowerCase() === 'x';
      if (done && !includeDone) return;
      out.push({ path: n.path, note: n.title, line: i, done, ...parseLine(m[3]) });
    });
  }
  const rank = { High: 0, Medium: 1, '': 2, Low: 3 };
  out.sort((a, b) => (a.done - b.done) || (rank[a.priority] - rank[b.priority]) || (a.due || '9999').localeCompare(b.due || '9999'));
  return out;
}

function toggle(relPath, line) {
  const full = vault.safeJoin(vault.vaultRoot(), relPath);
  const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
  const m = lines[line] && lines[line].match(TASK_RE);
  if (!m) throw new Error('No task on that line');
  const done = m[2].toLowerCase() === 'x';
  lines[line] = lines[line].replace(/\[( |x|X)\]/, done ? '[ ]' : '[x]');
  if (!done && !/✅/.test(lines[line])) lines[line] += ' ✅ ' + new Date().toISOString().slice(0, 10);
  if (done) lines[line] = lines[line].replace(/\s*✅ \d{4}-\d{2}-\d{2}/, '');
  fs.writeFileSync(full, lines.join('\n'));
  vault.invalidate();
  return !done;
}

function add(text, { due, priority, file } = {}) {
  if (!file) file = require('./config').load().profile === 'personal' ? 'Personal/Personal Tasks.md' : 'Tasks/Inbox.md';
  let line = `- [ ] ${text.trim()}`;
  if (priority) line += ` #${priority.toLowerCase()}`;
  if (due) line += ` 📅 ${due}`;
  const root = vault.vaultRoot();
  const full = vault.safeJoin(root, file);
  if (!fs.existsSync(full)) {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `# ${path.basename(file, '.md')}\n\nTasks captured by Maestro. Move them into projects when you triage.\n\n`);
  }
  vault.writeNote(file, line, { append: true });
  return line;
}

module.exports = { list, toggle, add };
