// Tasks live in the vault as Obsidian checkboxes ("- [ ] Do the thing 📅 2026-11-04 #high").
// Any note can hold tasks; new tasks go to Tasks/Inbox.md.
const fs = require('fs');
const path = require('path');
const vault = require('./vault');

function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const TASK_RE = /^(\s*)[-*] \[( |x|X)\] (.+)$/;

// Brain sections a task belongs to (Ryan, 2026-11-02), stored as a tag on the task line: #calendar #email #messages
// #calls #projects. Tasks without a tag are placed by their note's folder and wording; the rest are "other".
const SECTIONS = ['calendar', 'email', 'messages', 'calls', 'projects'];
const SECTION_TAG = /\s#(calendar|email|messages|calls|projects)\b/i;
function guessSection(text, folder = '') {
  if (/^projects?$/i.test(folder)) return 'projects';
  if (/^meetings?$/i.test(folder)) return 'calendar';
  if (/^(call|phone|ring)\b|\bcall (back|him|her|them)\b|\bvoicemail\b/i.test(text)) return 'calls';
  if (/\be-?mails?\b|\binbox\b|\bnewsletter\b/i.test(text)) return 'email';
  if (/\b(slack|whatsapp|sms|text (him|her|them|back)|dm|message)\b/i.test(text)) return 'messages';
  if (/\b(meeting|1:1|agenda|invite|event|workshop|webinar|conference|appointment)\b/i.test(text)) return 'calendar';
  if (/\b(project|prd|sprint|roadmap|spec|milestones?|launch|release|designs?|handoff|pr)\b/i.test(text)) return 'projects';
  return 'other';
}

// Due time and reminders (Ryan, 2026-11-02), kept on the task line so Obsidian shows them too:
// "📅 2026-11-06 ⏰ 14:30 🔔 1d,12h,2h". Reminder codes: 1w, 2d, 1d, 12h, 8h, 3h, 2h, 1h, 30m (1w, 2d and 8h: Ryan, 2026-11-04).
const ALERTS = { '1w': 10080, '2d': 2880, '1d': 1440, '12h': 720, '8h': 480, '3h': 180, '2h': 120, '1h': 60, '30m': 30 };
const ALERT_NAMES = { '1w': '1 week', '2d': '2 days', '1d': '1 day', '12h': '12 hours', '8h': '8 hours', '3h': '3 hours', '2h': '2 hours', '1h': '1 hour', '30m': '30 minutes' };
const normTime = (t) => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? `${String(Math.min(23, +m[1])).padStart(2, '0')}:${m[2]}` : ''; };
const normAlerts = (a) => [...new Set((Array.isArray(a) ? a : String(a || '').split(/[\s,]+/)).map((x) => String(x).toLowerCase().trim()).filter((x) => ALERTS[x]))].sort((x, y) => ALERTS[y] - ALERTS[x]);

function parseLine(text) {
  const dueTime = normTime((text.match(/⏰\s*(\d{1,2}:\d{2})/) || [])[1]);
  const alerts = normAlerts((text.match(/🔔\s*([\w,]+)/) || [])[1]);
  text = text.replace(/⏰\s*\d{1,2}:\d{2}/g, '').replace(/🔔\s*[\w,]+/g, '');
  const tagged = (text.match(SECTION_TAG) || [])[1];
  text = text.replace(SECTION_TAG, '');
  const due = (text.match(/(?:📅|due:)\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
  const priority = /#(high|urgent|p1)\b|⏫|🔺/i.test(text) ? 'High' : /#(low|p3)\b|🔽/i.test(text) ? 'Low' : /#(medium|p2)\b|🔼/i.test(text) ? 'Medium' : '';
  const created = (text.match(/➕\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
  const doneOn = (text.match(/✅\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
  text = text.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/g, '');
  const clean = text.replace(/➕\s*\d{4}-\d{2}-\d{2}/g, '').replace(/(?:📅|due:)\s*\d{4}-\d{2}-\d{2}/g, '').replace(/[⏫🔺🔼🔽]/g, '').replace(/#(high|urgent|p1|p2|p3|low|medium)\b/gi, '').trim();
  return { text: clean, due, dueTime: due ? dueTime : '', alerts, priority, created, doneOn, section: tagged ? tagged.toLowerCase() : '' };
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
      const t = parseLine(m[3]);
      out.push({ path: n.path, note: n.title, line: i, done, ...t, section: t.section || guessSection(t.text, n.folder) });
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
  const task = parseLine(m[3]);
  lines[line] = lines[line].replace(/\[( |x|X)\]/, done ? '[ ]' : '[x]');
  if (!done && !/✅/.test(lines[line])) lines[line] += ' ✅ ' + new Date().toISOString().slice(0, 10);
  if (done) lines[line] = lines[line].replace(/\s*✅ \d{4}-\d{2}-\d{2}/, '');
  fs.writeFileSync(full, lines.join('\n'));
  vault.invalidate();
  try { require('./feed').markTaskDone(relPath, task.text, !done); } catch { /* the feed is best-effort */ }
  return !done;
}

// Editing a task after it was made (Ryan, 2026-11-02): rewrites its line in place, keeping its indent, tick, created
// and done dates. expect is the task's text as listed, so an edit made in Obsidian meanwhile is found (or refused).
function lineOf(lines, line, expect) {
  const at = (i) => { const m = lines[i] && lines[i].match(TASK_RE); return m && (!expect || parseLine(m[3]).text === expect) ? m : null; };
  if (at(line)) return line;
  const i = lines.findIndex((_, k) => at(k));
  if (i < 0) throw new Error('That task changed in your vault. Reload the Tasks page and try again.');
  return i;
}
function update(relPath, line, expect, { text, due = '', dueTime = '', alerts = [], priority = '', section = '' } = {}) {
  const clean = String(text || '').trim().replace(/\s*\n\s*/g, ' ');
  if (!clean) throw new Error('A task needs some text');
  const full = vault.safeJoin(vault.vaultRoot(), relPath);
  const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
  const i = lineOf(lines, Number(line), expect);
  const [, indent, mark, rest] = lines[i].match(TASK_RE);
  const old = parseLine(rest);
  let out = `${indent}- [${mark}] ${clean}`;
  if (priority) out += ` #${String(priority).toLowerCase()}`;
  if (SECTIONS.includes(String(section).toLowerCase())) out += ` #${String(section).toLowerCase()}`;
  if (due) out += ` 📅 ${due}`;
  if (due && normTime(dueTime)) out += ` ⏰ ${normTime(dueTime)}`;
  if (due && normAlerts(alerts).length) out += ` 🔔 ${normAlerts(alerts).join(',')}`;
  if (old.created) out += ` ➕ ${old.created}`;
  if (old.doneOn) out += ` ✅ ${old.doneOn}`;
  lines[i] = out;
  fs.writeFileSync(full, lines.join('\n'));
  vault.invalidate();
  // Its old reminder cards no longer fit (new text or date); fresh ones follow if it's still coming due.
  try { require('./feed').dropTaskReminders(relPath, old.text); } catch { /* best-effort */ }
  return { line: out, index: i };
}

function add(text, { due, dueTime, alerts, priority, file, indent = '', section = '' } = {}) {
  if (!file) file = require('./config').load().profile === 'personal' ? 'Personal/Personal Tasks.md' : 'Tasks/Inbox.md';
  let line = `${indent}- [ ] ${text.trim().replace(/\s*\n\s*/g, ' ')}`;
  if (priority) line += ` #${priority.toLowerCase()}`;
  if (SECTIONS.includes(String(section).toLowerCase())) line += ` #${String(section).toLowerCase()}`;
  if (due) line += ` 📅 ${due}`;
  if (due && normTime(dueTime)) line += ` ⏰ ${normTime(dueTime)}`;
  if (due && normAlerts(alerts).length) line += ` 🔔 ${normAlerts(alerts).join(',')}`;
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
function addForEvent({ event = '', note = '', items = '', due = '', dueTime = '', alerts = [], priority = '', section = 'calendar' } = {}, now = new Date()) {
  const title = String(event).replace(/^(New( recurring event)?|Moved|Cancelled): /, '').trim() || 'Event';
  const n = dueIn(note, now);
  const list = (Array.isArray(items) ? items : splitItems(items)).map((x) => dueIn(x, now));
  const main = due || n.due || ''; // items without their own date share this one
  const first = [main, ...list.map((x) => x.due)].filter(Boolean).sort()[0] || ''; // the main task is due with its earliest item
  const lines = [add(`${title}: ${n.text || (list.length ? 'action items' : 'follow up')}`, { due: first, dueTime: first === main ? dueTime : '', alerts, priority, section })];
  // Each action item names its event, since the task list sorts by priority and date, not by event.
  for (const x of list) lines.push(add(`${x.text} (${title})`, { due: x.due || main, dueTime: x.due ? '' : dueTime, alerts, priority, section, indent: '  ' }));
  return { lines, due: first, count: lines.length };
}

module.exports = { ALERTS, ALERT_NAMES, normAlerts, list, toggle, update, add, addForEvent, splitItems, dueIn, parseLine, guessSection, SECTIONS };
