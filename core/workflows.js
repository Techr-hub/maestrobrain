// Proactive brain: routines that run on their own and push results into the feed and the vault.
// This is the difference between a reactive brain (waits for questions) and a proactive one.
const config = require('./config');
const vault = require('./vault');
const feed = require('./feed');
const calendar = require('./calendar');
const brain = require('./brain');
const llm = require('./llm');

const DEFS = [
  { id: 'morning_brief', name: 'Morning brief', icon: 'sunrise', description: 'Every morning: schedule, what needs you first, top tasks and one insight. Saved to today’s Daily note.', prompt: 'Brief me on my day: schedule, priorities, top tasks and one insight.', schedule: 'time' },
  { id: 'meeting_prep', name: 'Meeting prep', icon: 'calendar-days', description: 'Before each meeting: attendees, what you know about them, related messages and talking points.', prompt: 'Prep me for my next meeting.', schedule: 'before' },
  { id: 'inbox_triage', name: 'Inbox triage', icon: 'inbox', description: 'Every hour: group new email, Slack, texts and calls, and flag what needs a reply.', prompt: 'Triage my inbox and messages. What needs a reply?', schedule: 'every' },
  { id: 'end_of_day', name: 'End-of-day wrap-up', icon: 'moon', description: 'Each evening: what got done, what slipped, and tomorrow’s first task.', prompt: 'Wrap up my day: what got done, what is still open, and what I should start with tomorrow.', schedule: 'time' },
];

async function generate(prompt) {
  const cfg = config.load();
  const ctx = await brain.gatherContext(prompt, cfg.profile);
  if (cfg.llm.provider === 'demo') return brain.demoAnswer(prompt, ctx, cfg, cfg.profile, null);
  const system = `You are ${cfg.assistantName}, ${cfg.user.name}'s proactive second brain. Write a concise Markdown briefing grounded only in this context. Link notes as [[Title]].\n\n` + brain.contextText(ctx, cfg, cfg.profile);
  try {
    return await llm.complete(cfg.llm.provider, system, [{ role: 'user', content: prompt }]);
  } catch (e) {
    return brain.demoAnswer(prompt, ctx, cfg, cfg.profile, null);
  }
}

const lastRun = {};

async function run(id) {
  const def = DEFS.find((d) => d.id === id);
  if (!def) throw new Error('Unknown workflow');
  const content = await generate(def.prompt);
  const daily = brain.ensureDaily();
  vault.writeNote(daily, `\n## ${def.name} (${brain.timeOf(Date.now())})\n\n${content}\n`, { append: true });
  const firstLine = content.split('\n').find((l) => l.trim()) || def.name;
  // Inbox triage still saves to the daily note but posts no feed card (Ryan, 2026-11-03).
  const item = id === 'inbox_triage' ? null : feed.add({ source: 'system', profile: config.load().profile, category: 'BRIEF', title: `${def.name} ready`, quote: firstLine.replace(/\*\*/g, '').slice(0, 160), summary: `Saved to ${daily.replace('.md', '')}`, workflow: id, notePath: daily });
  lastRun[id] = Date.now();
  return { id, content, notePath: daily, item };
}

function list() {
  const cfg = config.load();
  return DEFS.map((d) => ({ ...d, ...(cfg.workflows[d.id] || {}), lastRun: lastRun[d.id] || null }));
}

// Called once a minute by the dashboard server.
async function tick() {
  const cfg = config.load();
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  for (const d of DEFS) {
    const w = cfg.workflows[d.id];
    if (!w || !w.enabled) continue;
    const since = Date.now() - (lastRun[d.id] || 0);
    try {
      if (d.schedule === 'time' && w.time === hhmm && since > 120000) await run(d.id);
      if (d.schedule === 'every' && since > (w.everyMinutes || 60) * 60000 && lastRun[d.id]) await run(d.id);
      if (d.schedule === 'every' && !lastRun[d.id]) lastRun[d.id] = Date.now(); // first run after one interval
      if (d.schedule === 'before') {
        const events = await calendar.list({ days: 1 });
        const soon = events.find((e) => { const mins = (new Date(e.start) - now) / 60000; return mins > 0 && mins <= (w.minutesBefore || 15); });
        if (soon && lastRun['prep:' + soon.title + soon.start] === undefined) {
          lastRun['prep:' + soon.title + soon.start] = Date.now();
          await run(d.id);
        }
      }
    } catch (e) { console.error('[workflow]', d.id, e.message); }
  }
}

module.exports = { list, run, tick, DEFS };
