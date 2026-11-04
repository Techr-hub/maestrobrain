// Insight cards (Ryan, 2026-11-02): only a heads-up when a task you created is coming due: due tomorrow, due today
// or overdue. That covers tasks from an event's "Create Task", project notes and anything added by chat or the
// Tasks page. Demo data never triggers them: the starter vault's own tasks are skipped (tasks Maestro creates are
// marked ➕ with their creation date); every other task with a due date counts, including your own Obsidian ones.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const tasks = require('./tasks');
const feed = require('./feed');

const DAY = 86400000;
const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };

function stageOf(due, now = new Date()) {
  const days = Math.round((midnight(due + 'T12:00') - midnight(now)) / DAY);
  if (days < 0) return { key: 'overdue', label: 'Overdue', days };
  if (days === 0) return { key: 'today', label: 'Due today', days };
  if (days === 1) return { key: 'tomorrow', label: 'Due tomorrow', days };
  return null;
}

// The starter vault's own tasks (no ➕ created date), wherever the vault was copied to. These are demo data.
let demoCache = null;
function demoTasks() {
  if (demoCache) return demoCache;
  demoCache = new Set();
  const walk = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) { if (!d.name.startsWith('.')) walk(p); continue; }
      if (!d.name.endsWith('.md')) continue;
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*[-*] \[( |x|X)\] (.+)$/);
        if (m && !/➕/.test(m[2])) demoCache.add(tasks.parseLine(m[2]).text);
      }
    }
  };
  try { walk(path.join(config.ROOT, 'vault')); } catch { /* no starter vault */ }
  return demoCache;
}

// Tasks with chosen reminders (Ryan, 2026-11-02: 1 day, 12 hours, 3 hours, 2 hours… before the deadline).
// The deadline is the due date at its due time, or 5 PM without one. Each reminder posts one Insight card when its
// moment arrives; if several have passed at once (a task added late), only the nearest one posts. Past the
// deadline, one "Overdue" card.
const LABEL = (a) => `Due in ${tasks.ALERT_NAMES[a]}`;
function deadlineOf(t) { return new Date(`${t.due}T${t.dueTime || '17:00'}:00`); }
function alertStage(t, now = new Date(), alerts = t.alerts) {
  const dl = deadlineOf(t);
  if (now >= dl) return { key: 'overdue', label: 'Overdue' };
  const fired = alerts.filter((a) => now >= new Date(dl - tasks.ALERTS[a] * 60000)).sort((a, b) => tasks.ALERTS[a] - tasks.ALERTS[b]);
  return fired.length ? { key: 'alert-' + fired[0], label: LABEL(fired[0]) } : null;
}
// Your reminder times from Settings → Reminders (Ryan, 2026-11-04: "1 hour out, 1 day out, 8 hours…").
function defaults(cfg = config.load()) {
  const r = cfg.reminders || {};
  return { tasks: tasks.normAlerts(r.tasks || []), milestones: tasks.normAlerts(r.milestones == null ? ['1w', '1d'] : r.milestones) };
}

// Project milestones and completion dates (Ryan, 2026-11-04): a heads-up at each reminder time you chose before the
// day (counted from 9 AM), then "Milestone today" on the day. Projects marked done are skipped.
const MS_HOUR = '09:00';
function milestoneStage(date, alerts, now = new Date()) {
  const at = new Date(`${date}T${MS_HOUR}:00`);
  const end = new Date(`${date}T23:59:59`);
  if (now > end) return null;
  if (now >= at) return { key: 'today', label: 'today' };
  const fired = alerts.filter((a) => now >= new Date(at - tasks.ALERTS[a] * 60000)).sort((a, b) => tasks.ALERTS[a] - tasks.ALERTS[b]);
  if (!fired.length) return null;
  // Said from the actual days left, so a "1 week" reminder for a milestone added 3 days out reads "in 3 days".
  const days = Math.round((new Date(`${date}T12:00`).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY);
  const left = at - now;
  const label = days === 0 ? 'today' : days === 1 ? 'tomorrow' : left < DAY ? `in ${Math.max(1, Math.round(left / 3600000))} hours` : `in ${days} days`;
  return { key: 'alert-' + fired[0], label };
}
function milestones(now = new Date(), alerts = defaults().milestones) {
  if (!alerts.length) return 0;
  let posted = 0, list = [];
  try { list = require('./projects').list(); } catch { return 0; }
  const fmt = (d) => new Date(d + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  for (const p of list) {
    if (/^(done|complete|completed|closed|cancelled|canceled|archived)$/i.test(p.status || '')) continue;
    const marks = [...p.milestones.filter((m) => m.date).map((m) => ({ ...m, kind: 'Milestone' }))];
    if (p.completion) marks.push({ date: p.completion, name: 'Project completion', kind: 'Completion' });
    for (const m of marks) {
      const st = milestoneStage(m.date, alerts, now);
      if (!st) continue;
      const open = p.tasks.open;
      const item = feed.add({
        externalId: `remind:ms:${p.path}:${hash(m.name)}:${m.date}:${st.key}`,
        source: 'system', profile: config.load().profile, category: 'INSIGHT', reminder: true, milestone: true,
        title: m.kind === 'Completion' ? `${p.name} wraps up ${st.label}` : `Milestone ${st.label}: ${m.name}`,
        alert: st.key, quote: m.kind === 'Completion' ? `Completion date for ${p.name}` : `For ${p.name}`,
        summary: open ? `${open} open task${open === 1 ? '' : 's'} in this project` : 'No open tasks in this project',
        priority: st.key === 'today' || open ? 'High' : 'Medium',
        deadline: `${m.kind === 'Completion' ? 'Due' : 'On'} ${fmt(m.date)}`,
        notePath: p.path, actions: ['Open project'],
      });
      if (item) posted++;
    }
  }
  return posted;
}

function check(now = new Date()) {
  const demo = demoTasks();
  const def = defaults();
  let posted = 0;
  for (const profile of ['business', 'personal']) {
    let list = [];
    try { list = tasks.list({ profile }); } catch { continue; }
    for (const t of list) {
      if (t.done || !t.due || (!t.created && demo.has(t.text))) continue;
      const st = t.alerts && t.alerts.length ? alertStage(t, now) : def.tasks.length ? alertStage(t, now, def.tasks) : stageOf(t.due, now);
      if (!st) continue;
      const event = (t.text.match(/^(.+?): /) || t.text.match(/\(([^)]+)\)$/) || [])[1] || '';
      const item = feed.add({
        externalId: `remind:${profile}:${t.path}:${hash(t.text)}:${t.due}:${st.key}`,
        source: 'system', profile, category: 'INSIGHT', reminder: true, taskPath: t.path,
        title: `${st.label}: ${t.text}`, alert: st.key,
        quote: event ? `For ${event}` : `In ${t.note}`,
        summary: st.key === 'overdue' ? `Was due ${new Date(t.due + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}` : 'From your task list',
        priority: t.priority || (st.key === 'tomorrow' ? '' : 'Medium'),
        deadline: `Due ${new Date(t.due + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}${t.dueTime ? ' at ' + new Date(`${t.due}T${t.dueTime}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}`,
        notePath: t.path,
        actions: [],
      });
      if (item) posted++;
    }
  }
  try { posted += milestones(now, def.milestones); } catch { /* best-effort */ }
  return posted;
}

module.exports = { check, stageOf, alertStage, deadlineOf, defaults, milestoneStage, milestones };
