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

function check(now = new Date()) {
  const demo = demoTasks();
  let posted = 0;
  for (const profile of ['business', 'personal']) {
    let list = [];
    try { list = tasks.list({ profile }); } catch { continue; }
    for (const t of list) {
      if (t.done || !t.due || (!t.created && demo.has(t.text))) continue;
      const st = stageOf(t.due, now);
      if (!st) continue;
      const event = (t.text.match(/^(.+?): /) || t.text.match(/\(([^)]+)\)$/) || [])[1] || '';
      const item = feed.add({
        externalId: `remind:${profile}:${t.path}:${hash(t.text)}:${t.due}:${st.key}`,
        source: 'system', profile, category: 'INSIGHT', reminder: true, taskPath: t.path,
        title: `${st.label}: ${t.text}`,
        quote: event ? `For ${event}` : `In ${t.note}`,
        summary: st.key === 'overdue' ? `Was due ${new Date(t.due + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}` : 'From your task list',
        priority: t.priority || (st.key === 'tomorrow' ? '' : 'Medium'),
        deadline: `Due ${new Date(t.due + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`,
        notePath: t.path,
        actions: [],
      });
      if (item) posted++;
    }
  }
  return posted;
}

module.exports = { check, stageOf };
