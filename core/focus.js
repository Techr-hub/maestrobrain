// Focus (Ryan, 2026-11-04): Maestro looks up your projects, ranks what matters most to get done, and points out
// what else is pressing that could stop you hitting your goals (overdue work, milestones coming up with open tasks,
// projects behind pace, a packed calendar before a deadline, urgent messages). Works offline, and the same summary
// is handed to Claude/ChatGPT/Gemini so every model answers from the same facts.
const tasks = require('./tasks');
const projects = require('./projects');
const feed = require('./feed');

const DAY = 86400000;
const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const daysUntil = (iso, now = new Date()) => Math.round((midnight(iso + 'T12:00') - midnight(now)) / DAY);
const dayText = (n) => (n < -1 ? `${-n} days overdue` : n === -1 ? 'overdue since yesterday' : n === 0 ? 'due today' : n === 1 ? 'due tomorrow' : `due in ${n} days`);
const whenText = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 7 ? `in ${n} days` : `on ${new Date(Date.now() + n * DAY).toLocaleDateString([], { month: 'short', day: 'numeric' })}`);
const DONE = /^(done|complete|completed|closed|cancelled|canceled|archived)$/i;

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }

// Schedule pace: how much of the start → completion window has gone, against how much of the work is done.
function pace(p, now = new Date()) {
  if (!p.start || !p.completion || p.progress == null) return null;
  const a = new Date(p.start + 'T00:00'), b = new Date(p.completion + 'T23:59');
  if (b <= a) return null;
  const elapsed = Math.max(0, Math.min(100, Math.round(((now - a) / (b - a)) * 100)));
  return { elapsed, progress: p.progress, behind: elapsed - p.progress };
}

function projectState({ profile, now = new Date() } = {}) {
  const list = safe(() => projects.list(), []).filter((p) => !DONE.test(p.status || ''));
  return list.map((p) => {
    const next = p.milestones.filter((m) => m.date && daysUntil(m.date, now) >= 0).sort((x, y) => x.date.localeCompare(y.date))[0] || null;
    return { ...p, next, nextIn: next ? daysUntil(next.date, now) : null, completionIn: p.completion ? daysUntil(p.completion, now) : null, pace: pace(p, now) };
  });
}

// Every open task, scored: how soon it's due, its priority, and whether its project has a deadline close by.
function ranked({ profile, now = new Date(), projectList } = {}) {
  const ps = projectList || projectState({ profile, now });
  const byPath = new Map(ps.map((p) => [p.path, p]));
  const open = safe(() => tasks.list({ profile }), []).filter((t) => !t.done);
  return open.map((t) => {
    let score = 0; const why = [];
    const n = t.due ? daysUntil(t.due, now) : null;
    if (n != null) {
      if (n < 0) { score += 100 + Math.min(30, -n * 5); why.push(dayText(n)); }
      else if (n === 0) { score += 80; why.push('due today'); }
      else if (n === 1) { score += 60; why.push('due tomorrow'); }
      else if (n <= 3) { score += 40; why.push(dayText(n)); }
      else if (n <= 7) { score += 20; why.push(dayText(n)); }
      else score += 5;
    }
    if (t.priority === 'High') { score += 30; why.push('high priority'); } else if (t.priority === 'Medium') score += 10; else if (t.priority === 'Low') score -= 10;
    const p = byPath.get(t.path);
    if (p) {
      score += 10;
      const soon = [p.nextIn, p.completionIn].filter((x) => x != null && x >= 0);
      const near = soon.length ? Math.min(...soon) : null;
      if (near != null && near <= 7) { score += 25 - near * 2; why.push(near === p.nextIn && p.next ? `${p.next.name} is ${whenText(near)}` : `${p.name} wraps up ${whenText(near)}`); }
      if (p.pace && p.pace.behind >= 25) { score += 15; why.push(`${p.name} is behind schedule`); }
    }
    return { ...t, score, why, project: p ? p.name : '', daysLeft: n };
  }).sort((a, b) => b.score - a.score || (a.due || '9999').localeCompare(b.due || '9999'));
}

// What could stop you hitting your goals, most serious first.
function risks({ profile, now = new Date(), events = [], items = null, projectList, rankedList } = {}) {
  const ps = projectList || projectState({ profile, now });
  const all = rankedList || ranked({ profile, now, projectList: ps });
  const out = [];
  const overdue = all.filter((t) => t.daysLeft != null && t.daysLeft < 0);
  if (overdue.length) out.push({ level: 3, kind: 'overdue', text: `${overdue.length} overdue task${overdue.length === 1 ? '' : 's'}, starting with "${overdue[0].text}" (${dayText(overdue[0].daysLeft)})` });
  for (const p of ps) {
    if (p.completionIn != null && p.completionIn < 0) out.push({ level: 3, kind: 'late', project: p.name, text: `${p.name} passed its completion date (${p.completion}) with ${p.tasks.open} open task${p.tasks.open === 1 ? '' : 's'}` });
    if (p.next && p.nextIn <= 7 && p.tasks.open) out.push({ level: p.nextIn <= 2 ? 3 : 2, kind: 'milestone', project: p.name, text: `${p.next.name} for ${p.name} is ${whenText(p.nextIn)} and ${p.tasks.open} task${p.tasks.open === 1 ? ' is' : 's are'} still open` });
    if (p.pace && p.pace.behind >= 25 && !(p.completionIn != null && p.completionIn < 0)) out.push({ level: 2, kind: 'behind', project: p.name, text: `${p.name} is ${p.pace.progress}% done but ${p.pace.elapsed}% of its time has gone` });
  }
  // A packed calendar before the next deadline leaves little time to do the work.
  const deadlines = ps.flatMap((p) => [p.next && { at: p.next.date, name: `${p.next.name} (${p.name})` }, p.completion && p.completionIn >= 0 && { at: p.completion, name: `${p.name}'s completion` }]).filter(Boolean).sort((a, b) => a.at.localeCompare(b.at));
  const first = deadlines.find((d) => daysUntil(d.at, now) <= 7);
  if (first && events.length) {
    const end = new Date(first.at + 'T23:59');
    const hours = events.filter((e) => new Date(e.start) >= now && new Date(e.start) <= end && !e.allDay).reduce((h, e) => h + Math.max(0, (new Date(e.end) - new Date(e.start)) / 3600000), 0);
    if (hours >= 6) out.push({ level: 2, kind: 'calendar', text: `${Math.round(hours)} hours of meetings before ${first.name}` });
  }
  // Urgent messages and blockers from the last three days that haven't been dealt with.
  const recent = (items || safe(() => feed.list({ profile, limit: 300 }), [])).filter((i) => !i.completed && !i.reminder && now - i.ts < 3 * DAY &&
    (i.priority === 'High' || /\b(blocker|blocking|blocked|urgent|asap|escalat\w*|at risk|overdue)\b/i.test(`${i.title} ${i.quote || ''} ${i.summary || ''}`)));
  if (recent.length) out.push({ level: 2, kind: 'messages', text: `${recent.length} urgent message${recent.length === 1 ? '' : 's'} waiting, like "${String(recent[0].title).slice(0, 80)}"` });
  return out.sort((a, b) => b.level - a.level);
}

function summary(opts = {}) {
  const projectList = projectState(opts);
  const rankedList = ranked({ ...opts, projectList });
  return { projects: projectList, top: rankedList.slice(0, 8), risks: risks({ ...opts, projectList, rankedList }), openCount: rankedList.length };
}

// ------------------------------------------------------------------ answers in chat
const PRIORITY_Q = /\b(most important|prioriti[sz]e|priorities|what should i (do|work on|focus on|tackle|start)|what do i (need|have) to (do|get done)|focus on today|top (tasks|things|items|priorities)|what('?s| is) (the )?most (important|urgent)|what('?s| is) important|where should i start)\b/;
const RISK_Q = /\b(blockers?|blocking|at risk|risks?|falling behind|behind on|anything pressing|what('?s| is) pressing|in my way|in the way|prevent(ing)? me|stop(ping)? me|hit(ting)? my (goals?|deadlines?|milestones?)|my goals?|on track)\b/;
const LIST_Q = /\b(my projects|what projects|which projects|projects? (do i have|am i (on|working on)|are (open|active|running))|list (my |all )?projects|all (my )?projects|project (list|status|update)s?|how are my projects)\b/;
const MILESTONE_Q = /\b(milestones?|upcoming deadlines?|deadlines? (coming|this week|soon)|what('?s| is) due)\b/;

const tokens = (s) => String(s).toLowerCase().match(/[a-z0-9]+/g) || [];
const COMMON = new Set(['the', 'a', 'an', 'project', 'and', 'of', 'for', 'new', 'app', 'v2', 'v3']);
function projectNamed(m, list) {
  const words = new Set(tokens(m));
  let best = null, bestScore = 0;
  for (const p of list) {
    const name = String(p.name).toLowerCase();
    if (m.includes(name)) return p;
    const toks = tokens(name).filter((t) => t.length > 2 && !COMMON.has(t));
    if (!toks.length) continue;
    const hit = toks.filter((t) => words.has(t)).length;
    const score = hit / toks.length;
    // one distinctive word is enough when no other project shares it ("the Acme project")
    const unique = toks.some((t) => words.has(t) && !list.some((o) => o !== p && tokens(o.name).includes(t)));
    if (hit && score > bestScore && (score >= 0.5 || hit >= 2 || unique)) { best = p; bestScore = score; }
  }
  return best;
}

const join = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
function projectAnswer(p) {
  const bits = [];
  bits.push(`**${p.name}**${p.client ? ` for ${p.client}` : ''} is ${p.progress != null ? `${p.progress}% done` : 'under way'}, with ${p.tasks.open} open task${p.tasks.open === 1 ? '' : 's'}${p.tasks.done ? ` and ${p.tasks.done} finished` : ''}.`);
  if (p.next) bits.push(`Next milestone: ${p.next.name}, ${whenText(p.nextIn)} (${p.next.date}).`);
  if (p.completion) bits.push(p.completionIn < 0 ? `It was due to finish on ${p.completion}.` : `It wraps up ${whenText(p.completionIn)} (${p.completion}).`);
  if (p.pace && p.pace.behind >= 25) bits.push(`Heads up: ${p.pace.elapsed}% of the time has gone but only ${p.pace.progress}% of the work is done.`);
  const open = (p.taskList || []).filter((t) => !t.done).slice(0, 4);
  return [bits.join(' '), open.length ? '\n' + open.map((t) => `- ${t.priority === 'High' ? '🔴 ' : ''}${t.text}${t.due ? ` · ${dayText(daysUntil(t.due))}` : ''}`).join('\n') : ''].filter(Boolean).join('\n');
}

function answer(message, { profile, events = [], items = null, now = new Date() } = {}) {
  const m = String(message || '').toLowerCase();
  const want = { priority: PRIORITY_Q.test(m), risk: RISK_Q.test(m), list: LIST_Q.test(m), milestone: MILESTONE_Q.test(m) };
  const s = summary({ profile, events, items, now });
  const named = /\bprojects?\b|\b(status|progress|going|doing|update|milestones?|tell me about|how('?s| is))\b/.test(m) ? projectNamed(m, s.projects) : null;
  if (named && !want.priority && !want.risk) return projectAnswer(named);
  if (want.list && !want.risk && !want.priority) {
    if (!s.projects.length) return "You don't have any active projects yet. Create one on the Projects page and I'll keep an eye on it.";
    return [`You have ${s.projects.length} active project${s.projects.length === 1 ? '' : 's'}:`, '',
      ...s.projects.slice(0, 10).map((p) => `- **${p.name}**${p.client ? ` (${p.client})` : ''}: ${p.progress != null ? p.progress + '% done, ' : ''}${p.tasks.open} open task${p.tasks.open === 1 ? '' : 's'}${p.next ? `, next up ${p.next.name} ${whenText(p.nextIn)}` : ''}`),
      '', 'Ask me about any of them by name.'].join('\n');
  }
  if (want.milestone && !want.priority && !want.risk) {
    const ms = s.projects.flatMap((p) => p.milestones.filter((x) => x.date && daysUntil(x.date, now) >= 0).map((x) => ({ ...x, project: p.name, n: daysUntil(x.date, now) })))
      .concat(s.projects.filter((p) => p.completion && p.completionIn >= 0).map((p) => ({ name: 'Completion', date: p.completion, project: p.name, n: p.completionIn })))
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
    if (!ms.length) return 'No milestones coming up. Add dates to a project on the Projects page and I\'ll remind you as they get close.';
    return [`Your next milestone is ${ms[0].name} for ${ms[0].project}, ${whenText(ms[0].n)}.`, '', ...ms.map((x) => `- ${x.date} · ${x.name} (${x.project})`)].join('\n');
  }
  if (!want.priority && !want.risk) return null;
  const parts = [];
  if (want.risk && !want.priority) {
    // "What's pressing / what could stop me hitting my goals?": the risks first, then where to start.
    parts.push(s.risks.length ? `${s.risks.length === 1 ? 'One thing' : `${s.risks.length} things`} could get in the way of your goals:\n` + s.risks.slice(0, 6).map((r) => `- ${r.text}`).join('\n') : 'Nothing is putting your goals at risk right now. Your projects are on pace.');
    if (s.top.length) parts.push(`Best place to start: **${s.top[0].text}**${s.top[0].why.length ? ` (${join(s.top[0].why)})` : ''}.`);
    return parts.join('\n\n');
  }
  if (want.priority || !want.risk) {
    if (!s.top.length) parts.push("Your task list is clear. Nothing open right now.");
    else {
      const t = s.top[0];
      parts.push(`Start with **${t.text}**${t.why.length ? ` (${join(t.why)})` : ''}.`);
      if (s.top.length > 1) parts.push('Then:\n' + s.top.slice(1, 5).map((x) => `- ${x.text}${x.why.length ? ` · ${join(x.why)}` : ''}`).join('\n'));
    }
  }
  if (want.risk || s.risks.some((r) => r.level >= 3)) {
    parts.push(s.risks.length ? `${want.risk ? 'What could get in the way of your goals' : 'Also watch out for'}:\n` + s.risks.slice(0, want.risk ? 6 : 3).map((r) => `- ${r.text}`).join('\n') : 'Nothing is putting your goals at risk right now. Your projects are on pace.');
  }
  return parts.join('\n\n');
}

// For Claude/ChatGPT/Gemini: the same facts in one compact block.
function contextBlock(opts = {}) {
  const s = summary(opts);
  const lines = ['# PROJECTS'];
  if (!s.projects.length) lines.push('(no active projects)');
  for (const p of s.projects.slice(0, 12)) lines.push(`- ${p.name}${p.client ? ' · client ' + p.client : ''}${p.start ? ' · start ' + p.start : ''}${p.completion ? ' · completion ' + p.completion : ''} · ${p.progress != null ? p.progress + '% done' : 'no progress yet'} · ${p.tasks.open} open tasks${p.next ? ` · next milestone ${p.next.name} on ${p.next.date}` : ''}${p.pace && p.pace.behind >= 25 ? ' · BEHIND SCHEDULE' : ''}`);
  lines.push('', '# MOST IMPORTANT TASKS (ranked by Maestro: due dates, priority, project deadlines)');
  lines.push(...(s.top.length ? s.top.map((t, i) => `${i + 1}. ${t.text}${t.project ? ' [' + t.project + ']' : ''}${t.why.length ? ' · ' + t.why.join(', ') : ''}`) : ['(no open tasks)']));
  lines.push('', '# RISKS TO THE USER\'S GOALS');
  lines.push(...(s.risks.length ? s.risks.map((r) => `- ${r.text}`) : ['(nothing flagged)']));
  lines.push('When asked what matters most, what to work on, or what is at risk, answer from these lists: lead with the single most important item and why, then the next few, then the risks.');
  return lines.join('\n');
}

module.exports = { ranked, risks, summary, answer, contextBlock, projectNamed, pace };
