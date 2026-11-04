// Projects (Ryan, 2026-11-04): a project is a note in the vault's Projects/ folder with its name, description, client,
// start date, milestones and completion date in the frontmatter, and its tasks as checkboxes under "## Tasks".
// Projects made in Obsidian show up too (any note in Projects/ that isn't an index).
const fs = require('fs');
const vault = require('./vault');
const tasks = require('./tasks');

const DIR = 'Projects';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const day = (v) => (ISO.test(String(v || '').trim()) ? String(v).trim() : '');
const q = (s) => `"${String(s || '').replace(/"/g, "'").replace(/\r?\n/g, ' ').trim()}"`; // the vault's YAML reader has no escapes
const fileName = (name) => String(name).replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

// "2026-12-01 | Beta launch" ⇄ { date, name }
const parseMilestone = (s) => { const m = String(s).match(/^\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.*)$/); return m ? { date: m[1], name: m[2].trim() } : { date: '', name: String(s).trim() }; };
function cleanMilestones(list) {
  return (Array.isArray(list) ? list : []).map((m) => ({ name: String((m && m.name) || '').trim().slice(0, 80), date: day(m && m.date) }))
    .filter((m) => m.name || m.date).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
}

function isProject(n) { return n.folder === DIR && !/index/i.test(n.title) && !(n.tags || []).includes('index'); }

function view(n, allTasks) {
  const fm = n.frontmatter || {};
  const mine = allTasks.filter((t) => t.path === n.path);
  const done = mine.filter((t) => t.done).length;
  const milestones = (Array.isArray(fm.milestones) ? fm.milestones : fm.milestones ? [fm.milestones] : []).map(parseMilestone);
  const today = new Date().toISOString().slice(0, 10);
  const firstPara = String(n.body || '').replace(/^#.*$/m, '').split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^(#|- |\*\*|Owner:)/.test(p)) || '';
  return {
    path: n.path, name: fm.title || n.title, client: fm.client || '', description: String(fm.description || firstPara.slice(0, 400)).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, a, b) => b || a).replace(/\*\*/g, ''),
    start: day(fm.start), completion: day(fm.completion || fm.due || fm.deadline), status: fm.status || '',
    milestones, nextMilestone: milestones.find((m) => m.date && m.date >= today) || null,
    tasks: { open: mine.length - done, done, total: mine.length },
    progress: mine.length ? Math.round((done / mine.length) * 100) : (fm.points_total ? Math.round((Number(fm.points_done) / Number(fm.points_total)) * 100) : null),
    made: fm.type === 'project', created: fm.created || '', modified: n.modified,
  };
}

function list() {
  const all = tasks.list({ includeDone: true });
  // each project carries its tasks, so the Projects page can show them on the card (Ryan, 2026-11-04)
  return vault.loadNotes().filter(isProject).map((n) => ({ ...view(n, all), taskList: all.filter((t) => t.path === n.path).sort((a, b) => a.done - b.done) }))
    .sort((a, b) => (b.made - a.made) || String(b.created).localeCompare(String(a.created)) || (b.modified || 0) - (a.modified || 0));
}

function get(relPath) {
  const n = vault.loadNotes().find((x) => x.path === relPath && isProject(x));
  if (!n) throw Object.assign(new Error('That project is gone.'), { status: 404 });
  const all = tasks.list({ includeDone: true });
  return { ...view(n, all), taskList: all.filter((t) => t.path === relPath) };
}

function frontmatter(p, created) {
  return ['---', 'type: project', 'tags: [project]', `title: ${q(p.name)}`, `client: ${q(p.client)}`, `description: ${q(p.description)}`,
    `start: ${day(p.start)}`, `completion: ${day(p.completion)}`, `status: ${q(p.status || 'active')}`, `created: ${created}`,
    'milestones:', ...cleanMilestones(p.milestones).map((m) => `  - ${q(`${m.date} | ${m.name}`)}`), '---'].join('\n');
}
function body(p) {
  const ms = cleanMilestones(p.milestones);
  return [`# ${p.name}`, '', [p.client && `**Client:** ${p.client}`, (p.start || p.completion) && `**Dates:** ${day(p.start) || '?'} → ${day(p.completion) || '?'}`].filter(Boolean).join(' · '), '',
    String(p.description || '').trim(), '', '## Milestones', ...(ms.length ? ms.map((m) => `- ${m.date || 'TBD'} · ${m.name}`) : ['- None yet']), ''].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

function validate(p) {
  const name = String(p.name || '').trim();
  if (!name) throw Object.assign(new Error('Give the project a name.'), { status: 400 });
  if (p.start && p.completion && day(p.start) && day(p.completion) && day(p.completion) < day(p.start)) throw Object.assign(new Error('The completion date is before the start date.'), { status: 400 });
  return { ...p, name };
}

function create(input) {
  const p = validate(input);
  const rel = `${DIR}/${fileName(p.name)}.md`;
  if (fs.existsSync(vault.safeJoin(vault.vaultRoot(), rel))) throw Object.assign(new Error(`There's already a project called "${p.name}".`), { status: 409 });
  vault.writeNote(rel, `${frontmatter(p, new Date().toISOString().slice(0, 10))}\n${body(p)}\n## Tasks\n`);
  for (const t of Array.isArray(input.tasks) ? input.tasks : []) if (String(t || '').trim()) addTask(rel, { text: t });
  return get(rel);
}

// Edit a project: the details above "## Tasks" are rewritten; the tasks (and anything after them) stay as they are.
function update(relPath, input) {
  const p = validate(input);
  const full = vault.safeJoin(vault.vaultRoot(), relPath);
  if (!fs.existsSync(full)) throw Object.assign(new Error('That project is gone.'), { status: 404 });
  const text = fs.readFileSync(full, 'utf8');
  const created = (text.match(/^created:\s*(\S+)/m) || [])[1] || new Date().toISOString().slice(0, 10);
  const at = text.search(/^## Tasks\s*$/m);
  const rest = at >= 0 ? text.slice(at) : `## Tasks\n${(text.match(/^\s*- \[[ xX]\] .*$/gm) || []).join('\n')}\n`;
  fs.writeFileSync(full, `${frontmatter(p, created)}\n${body(p)}\n${rest}`);
  vault.invalidate();
  return get(relPath);
}

function addTask(relPath, { text, due, dueTime, alerts, priority } = {}) {
  if (!String(text || '').trim()) throw Object.assign(new Error('A task needs some text.'), { status: 400 });
  get(relPath); // must be a project
  return tasks.add(String(text), { file: relPath, section: 'projects', due, dueTime, alerts, priority });
}

module.exports = { list, get, create, update, addTask, parseMilestone };
