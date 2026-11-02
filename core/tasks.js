// Tasks live in the vault as Obsidian checkboxes ("- [ ] Do the thing 📅 2026-11-04 #high").
// Any note can hold tasks; new tasks go to Tasks/Inbox.md.
const fs = require('fs');
const path = require('path');
const vault = require('./vault');

function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const TASK_RE = /^(\s*)[-*] \[( |x|X)\] (.+)$/;

function parseLine(text) {
  const due = (text.match(/(?:📅|due:)\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
  const priority = /#(high|urgent|p1)\b|⏫|🔺/i.test(text) ? 'High' : /#(low|p3)\b|🔽/i.test(text) ? 'Low' : /#(medium|p2)\b|🔼/i.test(text) ? 'Medium' : '';
  const created = (text.match(/➕\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
  const clean = text.replace(/➕\s*\d{4}-\d{2}-\d{2}/g, '').replace(/(?:📅|due:)\s*\d{4}-\d{2}-\d{2}/g, '').replace(/[⏫🔺🔼🔽]/g, '').replace(/#(high|urgent|p1|p2|p3|low|medium)\b/gi, '').trim();
  return { text: clean, due, priority, created };
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

function add(text, { due, priority, file, indent = '' } = {}) {
  if (!file) file = require('./config').load().profile === 'personal' ? 'Personal/Personal Tasks.md' : 'Tasks/Inbox.md';
  let line = `${indent}- [ ] ${text.trim().replace(/\s*\n\s*/g, ' ')}`;
  if (priority) line += ` #${priority.toLowerCase()}`;
  if (due) line += ` 📅 ${due}`;
  line += ` ➕ ${iso(new Date())}`; // created date: marks tasks you made (Maestro's reminders skip the demo vault's own tasks)
  const root = vault.vaultRoot();
  const full = vault.safeJoin(root, file);
  if (!fs.existsSync(full)) {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `# ${path.basename(file, '.md')}\n\nTasks captured by Maestro. Move them into projects when you triage.\n\n`);
  }
  vault.writeNote(file, line, { append: true });
  return line;
}

// "Create Task" on an event card (Ryan, 2026-11-02): a note about the event plus its action items and deadlines.
// The note becomes the main task ("Brain Builder Workshop: book the room") and each action item a sub-task under it.
// A deadline picked in the form wins; otherwise one said in the text ("by Friday", "due Nov 5") is used,
// and an action item that names its own date keeps it.
const DUE_WORDS = /\b(by|due|before|until|deadline|no later than|on)\b[^.;\n]*?\b(today|tonight|tomorrow|day after tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|in (\d+|a|one|two|three) (days?|weeks?)|(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}|\d{1,2}(st|nd|rd|th)? (of )?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})\b/i;
function dueIn(text, now = new Date()) {
  const m = String(text || '').toLowerCase().match(DUE_WORDS);
  if (!m) return { due: '', text };
  const d = require('./scheduler').parseDate(m[0], now);
  if (!d) return { due: '', text };
  return { due: iso(d), text: String(text).replace(new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').replace(/\s+([,.;!?])/g, '$1').replace(/\s{2,}/g, ' ').replace(/[\s,;:-]+$/, '').trim() };
}
// "call Sam; send slides by Friday" / one per line / "- book the room" → ['call Sam', 'send slides by Friday', 'book the room']
function splitItems(text) {
  return String(text || '').split(/\n|;|(?:^|\s)(?:\d+[.)]|[-*•])\s+|,?\s*\b(?:and then|then also|also)\b\s*/i)
    .map((x) => (x || '').replace(/^\s*([-*•]|\d+[.)])\s+/, '').replace(/^\s*(action items?|to ?dos?|tasks?)\s*:?\s*/i, '').trim()).filter((x) => x && x.length > 1);
}
function addForEvent({ event = '', note = '', items = '', due = '', priority = '' } = {}, now = new Date()) {
  const title = String(event).replace(/^(New( recurring event)?|Moved|Cancelled): /, '').trim() || 'Event';
  const n = dueIn(note, now);
  const list = (Array.isArray(items) ? items : splitItems(items)).map((x) => dueIn(x, now));
  const main = due || n.due || ''; // items without their own date share this one
  const first = [main, ...list.map((x) => x.due)].filter(Boolean).sort()[0] || ''; // the main task is due with its earliest item
  const lines = [add(`${title}: ${n.text || (list.length ? 'action items' : 'follow up')}`, { due: first, priority })];
  // Each action item names its event, since the task list sorts by priority and date, not by event.
  for (const x of list) lines.push(add(`${x.text} (${title})`, { due: x.due || main, priority, indent: '  ' }));
  return { lines, due: first, count: lines.length };
}

module.exports = { list, toggle, add, addForEvent, splitItems, dueIn, parseLine };
