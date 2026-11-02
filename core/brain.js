// The brain: gathers context from the five pillars (knowledge, memory, feed, calendar, tasks),
// routes the question to an agent and a model, and writes what it learns back into the vault.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const vault = require('./vault');
const feed = require('./feed');
const calendar = require('./calendar');
const tasks = require('./tasks');
const agentsMod = require('./agents');
const llm = require('./llm');
const lookup = require('./lookup');
const { converse } = require('./converse');
const scheduler = require('./scheduler');

const CONV_FILE = path.join(config.DATA_DIR, 'conversations.json');

// ---------------------------------------------------------------- helpers
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeOf = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayName = (d) => new Date(d).toLocaleDateString([], { weekday: 'long' });
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
function sameDay(a, b) { const x = new Date(a), y = new Date(b); return x.toDateString() === y.toDateString(); }

function sectionBullets(noteTitle, heading) {
  const n = vault.findByTitle(noteTitle);
  if (!n) return [];
  const lines = n.body.split(/\r?\n/);
  const out = [];
  let inside = false;
  for (const l of lines) {
    if (/^#{1,6}\s/.test(l)) { inside = l.replace(/^#+\s*/, '').toLowerCase().startsWith(heading.toLowerCase()); continue; }
    if (inside && /^\s*[-*]\s+/.test(l)) out.push(l.replace(/^\s*[-*]\s+(\[.\]\s*)?/, '').trim());
  }
  return out;
}

function memoryNotes() {
  return vault.loadNotes().filter((n) => n.folder === 'Memory');
}

// ---------------------------------------------------------------- memory writes
function remember(text, source = 'chat') {
  const line = `- ${isoDate()} ${timeOf(Date.now())} · ${text.trim()} _(via ${source})_`;
  const rel = 'Memory/Memory Log.md';
  const full = vault.safeJoin(vault.vaultRoot(), rel);
  if (!fs.existsSync(full)) vault.writeNote(rel, '---\ntags: [memory]\n---\n# Memory Log\n\nFacts the brain has been asked to remember. Newest at the bottom.\n');
  vault.writeNote(rel, line, { append: true });
  return rel;
}

function ensureDaily(date = new Date()) {
  const rel = `Daily/${isoDate(date)}.md`;
  const full = vault.safeJoin(vault.vaultRoot(), rel);
  if (!fs.existsSync(full)) {
    vault.writeNote(rel, `---\ntags: [daily]\n---\n# ${date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}\n\nBack to [[Maestro Home]]\n\n## Focus\n\n## Brain log\n`);
  }
  return rel;
}

function logToDaily(line) {
  const rel = ensureDaily();
  vault.writeNote(rel, `- ${timeOf(Date.now())} · ${line}`, { append: true });
}

// ---------------------------------------------------------------- conversations
function loadConversations() {
  try { return JSON.parse(fs.readFileSync(CONV_FILE, 'utf8')); } catch { return []; }
}
function saveConversations(list) {
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  fs.writeFileSync(CONV_FILE, JSON.stringify(list.slice(0, 100), null, 1));
}

// ---------------------------------------------------------------- context
async function gatherContext(message, profile) {
  const hits = vault.search(message, { limit: 8, profile }).filter((h) => h.folder !== 'Daily').slice(0, 5);
  const notes = hits.map((h) => ({ ...h, body: vault.readNote(h.path).body.slice(0, 1800) }));
  const mem = memoryNotes().map((n) => ({ path: n.path, title: n.title, body: n.body.slice(0, 2500) }));
  const all = feed.list({ profile, limit: 300 });
  const items = all.slice(0, 25);
  const allEvents = await calendar.list({ profile, days: 90 }); // questions about a specific event look further ahead
  const weekEnd = new Date(); weekEnd.setHours(0, 0, 0, 0); weekEnd.setDate(weekEnd.getDate() + 7);
  const events = allEvents.filter((e) => new Date(e.start) <= weekEnd);
  const openTasks = tasks.list({ profile }).slice(0, 15);
  return { notes, mem, items, all, events, allEvents, openTasks };
}

function contextText(ctx, cfg, profile) {
  const parts = [];
  parts.push(`# MEMORY (who the user is, preferences, standing facts)\n` + ctx.mem.map((m) => `## [[${m.title}]]\n${m.body}`).join('\n\n'));
  parts.push(`# RELEVANT NOTES FROM THE OBSIDIAN VAULT\n` + (ctx.notes.length ? ctx.notes.map((n) => `## [[${n.title}]] (${n.path})\n${n.body}`).join('\n\n') : '(no matching notes)'));
  parts.push(`# INTELLIGENCE FEED (newest first)\n` + ctx.items.map((i) => `- [${i.category}] ${i.sourceName} · ${lookup.whenText(i.ts)} · ${i.title}${i.quote ? ' — ' + i.quote : ''}${i.summary ? ' (' + i.summary + ')' : ''}${i.priority ? ' · priority ' + i.priority : ''}${i.deadline ? ' · ' + i.deadline : ''}`).join('\n'));
  parts.push(`# CALENDAR (next 7 days)\n` + (ctx.events.map((e) => `- ${dayName(e.start)} ${timeOf(e.start)}–${timeOf(e.end)} · ${e.title}${e.attendees ? ' · with ' + e.attendees.join(', ') : ''}`).join('\n') || '(nothing scheduled)'));
  parts.push(`# OPEN TASKS\n` + (ctx.openTasks.map((t) => `- ${t.text}${t.priority ? ' · ' + t.priority : ''}${t.due ? ' · due ' + t.due : ''} (in [[${t.note}]])`).join('\n') || '(none)'));
  return parts.join('\n\n');
}

function systemPrompt(cfg, profile, agent, skill, voice) {
  const name = agent ? agent.name : cfg.assistantName;
  return [
    agent && agent.prompt ? agent.prompt : `You are ${cfg.assistantName}, the personal second brain of ${cfg.user.name}${cfg.user.role ? ' (' + cfg.user.role + ')' : ''}, running inside Maestro.`,
    `You are speaking as ${name}. Today is ${new Date().toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. Active profile: ${profile.toUpperCase()} (only use ${profile} context unless asked).`,
    'Ground every answer in the context below: memory, vault notes, the intelligence feed, the calendar and tasks. If something is not in the context, say so instead of inventing it.',
    'Be proactive: point out blockers, conflicts, deadlines and the next best action. Reference vault notes as [[Note Title]].',
    'Answer the question that was asked. For a direct question (when, who, what, did) give the specific fact with its day and time in the first sentence, then stop unless more helps.',
    'Use short Markdown: a one-line answer first, then bullets. Offer to save outputs to the vault.',
    `Personality: warm, personal and slightly sarcastic, like a sharp chief of staff who has worked with ${cfg.user.name} for years. Use their first name. Keep any wit to one short line and never let it get in the way of the facts. Example: "Good morning Maestro" gets "Hey ${String(cfg.user.name).split(' ')[0]}, good morning to you too. Let's crush it today!"`,
    'Conversation: when the user shares a feeling or makes small talk ("I am stressed out", "I\'m tired", "you\'re awesome", "tell me a joke"), think about what they need before answering. Reply like a thoughtful friend in 1 to 3 sentences, use their day only where it helps (for stress: how much is left today and when they are next free), and offer one concrete way to help. Do not answer with a status report they did not ask for. If they ask you to greet or speak to a room ("I\'m at my Brain Builder event, say hi to everyone"), talk directly to the audience in 2 or 3 warm, witty sentences: welcome them to the event they named and introduce yourself as their second brain. Remember where they said they are for the rest of the conversation. If asked to tell everyone about yourself, answer in at most 2 sentences: what you are (their second brain), how you work (notes, calendar, email, messages and calls in one place, with Claude reasoning over it, asked by typing or voice) and the benefit of a second brain. Drop the sarcasm for real distress; if they mention self-harm, point them to 988 (Canada/US) or local emergency services.',
    'Messages often start with "Hey Maestro"; that is how the user addresses you, not part of the question.',
    'When asked where to get tickets for an event or how to register, look for a ticket or registration link in the event\'s description, location or URL (Luma, Eventbrite, Meetup and similar) and recommend it, e.g. "Get your ticket to the event from the Luma event page" with the link. Ignore meeting links (Zoom, Teams, Meet).',
    'When asked what an event is about, summarize it from the event\'s description in at most 2 sentences (when it is, then what it covers). If it has no description, say so in one sentence.',
    'For broad requests that span several areas ("summarize my day", "brief me", "catch me up", "check my messages"), answer in 1 or 2 sentences only, with counts per area (for example: "You\'ve got 4 meetings, 3 calls and 5 priority items today."), no lists. Then ask "Which do you want to hear more about: a, b or c?" Go into detail only on the area they pick.',
    voice ? 'The user is talking by voice. Answer in 2 to 4 short spoken sentences with no Markdown, tables or lists.' : '',
    skill ? `\n# ACTIVE SKILL: ${skill.name}\nFollow these instructions:\n${skill.instructions}` : '',
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------- day overview
const MSG_CATS = ['EMAIL', 'CONVERSATION', 'SMS'];
function dayParts(ctx) {
  const items = ctx.items;
  const meetings = ctx.events.filter((e) => sameDay(e.start, Date.now()));
  const upcoming = meetings.find((e) => new Date(e.start) > new Date());
  const calls = items.filter((i) => i.category === 'CALL');
  const missed = calls.filter((i) => /missed|voicemail/i.test(i.title + ' ' + (i.quote || '')));
  const msgs = items.filter((i) => MSG_CATS.includes(i.category));
  const msgHigh = msgs.filter((i) => i.priority === 'High');
  const highs = items.filter((i) => i.priority === 'High');
  const urgent = ctx.openTasks.filter((t) => t.priority === 'High' || (t.due && t.due <= isoDate()));
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  return [
    { key: 'meetings', label: 'meetings', count: meetings.length, short: n(meetings.length, 'meeting', 'meetings'), line: n(meetings.length, 'meeting', 'meetings') + (upcoming ? `, next is ${upcoming.title} at ${timeOf(upcoming.start)}` : '') },
    { key: 'calls', label: 'calls', count: calls.length, short: n(calls.length, 'call', 'calls') + (missed.length ? ` (${missed.length} missed)` : ''), line: n(calls.length, 'call', 'calls') + (missed.length ? `, ${missed.length} missed` : '') },
    { key: 'messages', label: 'messages', count: msgs.length, short: n(msgs.length, 'message', 'messages'), line: n(msgs.length, 'message', 'messages') + (msgHigh.length ? `, ${msgHigh.length} need a reply` : '') },
    { key: 'priority', label: 'priority items', count: highs.length, short: n(highs.length, 'priority item', 'priority items'), line: n(highs.length, 'priority item', 'priority items') },
    { key: 'tasks', label: 'tasks', count: urgent.length, short: n(urgent.length, 'urgent task', 'urgent tasks'), line: n(urgent.length, 'urgent task', 'urgent tasks') },
  ];
}

function joinAnd(a) { return a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`; }
// The question the dashboard turns into one-tap buttons.
function followUp(options) { return `Which do you want to hear more about: ${options.length < 2 ? options.join('') : `${options.slice(0, -1).join(', ')} or ${options[options.length - 1]}`}?`; }

function fullBrief(ctx, name) {
  const today = ctx.events.filter((e) => sameDay(e.start, Date.now()));
  const highs = ctx.items.filter((i) => i.priority === 'High');
  const due = ctx.openTasks.filter((t) => t.priority === 'High' || (t.due && t.due <= isoDate())).slice(0, 4);
  const insight = ctx.items.find((i) => i.category === 'INSIGHT');
  return [
    `**Here's everything for today, ${name}.**`, '',
    '**Meetings**', bullets(today.map((e) => `${timeOf(e.start)} · ${e.title}`)) || '- Nothing scheduled',
    '', '**Needs you first**', bullets(highs.slice(0, 4).map((i) => `${i.title} (${i.sourceName}${i.deadline ? ', ' + i.deadline : ''})`)) || '- Nothing urgent',
    '', '**Top tasks**', bullets(due.map((t) => `${t.text}${t.due ? ' · due ' + t.due : ''}`)) || '- Inbox zero',
    insight ? `\n**Insight:** ${insight.quote}. ${insight.summary}` : '',
  ].join('\n');
}

// Follow-ups to the overview: "meetings", "tell me about the calls", "more on priority items", "everything".
function dayDetail(message, ctx, cfg) {
  const m = message.toLowerCase().replace(/[?!.]+$/, '').trim()
    .replace(/^(ok(ay)?|sure|yes|yeah|yep)[, ]+/, '')
    .replace(/^(let'?s (do|hear|go with)|tell me (more )?about|more (on|about)|go (deeper|into)|what about|what('s| is| are)|show me|give me|read( me)?|i want to (hear|know) (more )?about|just)\s+/, '')
    .replace(/^(the|my)\s+/, '').replace(/\s+(today|please|first|then)$/, '').trim();
  const items = ctx.items;
  const pick = (re) => re.test(m);
  if (pick(/^(everything|all( of (it|them))?|the lot|full brief|all of the above)$/)) return fullBrief(ctx, cfg.user.name);
  if (pick(/^(meetings?|schedule|calendar|events?|today)$/)) {
    const today = ctx.events.filter((e) => sameDay(e.start, Date.now()));
    if (!today.length) return 'No meetings today.';
    const next = today.find((e) => new Date(e.start) > new Date());
    return [`**${today.length} meetings today${next ? `. Next up is ${next.title} at ${timeOf(next.start)}` : ''}.**`, '',
      bullets(today.map((e) => `${timeOf(e.start)} · ${e.title}${e.attendees && e.attendees.length ? ` with ${e.attendees.slice(0, 3).join(', ')}` : ''}`))].join('\n');
  }
  if (pick(/^(calls?|phone calls?|missed calls?|voicemails?)$/)) {
    const calls = items.filter((i) => i.category === 'CALL');
    if (!calls.length) return 'No calls to go through.';
    return [`**${calls.length} calls.**`, '', bullets(calls.slice(0, 6).map((i) => `${i.priority === 'High' ? '🔴 ' : ''}${i.title} · ${ago(i.ts)}${i.quote ? ` — ${i.quote}` : ''}`))].join('\n');
  }
  const kind = { emails: 'EMAIL', email: 'EMAIL', texts: 'SMS', text: 'SMS', sms: 'SMS', conversations: 'CONVERSATION', conversation: 'CONVERSATION', slack: 'CONVERSATION' }[m];
  if (kind) {
    const list = items.filter((i) => i.category === kind);
    if (!list.length) return 'Nothing there right now.';
    return [`**${list.length} ${m.replace(/s?$/, 's')}.**`, '', bullets(list.slice(0, 6).map((i) => `${i.priority === 'High' ? '🔴 ' : ''}${i.title}${i.quote ? ' — ' + i.quote : ''}`))].join('\n');
  }
  if (pick(/^(tomorrow|tomorrow'?s (meetings|schedule|events))$/)) {
    const d = new Date(); d.setDate(d.getDate() + 1);
    const list = ctx.events.filter((e) => sameDay(e.start, d.getTime()));
    if (!list.length) return 'Nothing on the calendar tomorrow.';
    return [`**${list.length} ${list.length === 1 ? 'event' : 'events'} tomorrow.**`, '', bullets(list.map((e) => `${timeOf(e.start)} · ${e.title}`))].join('\n');
  }
  if (pick(/^((the )?rest of (the|this) week|this week|the week|week)$/)) {
    const byDay = {};
    for (const e of ctx.events.filter((x) => !sameDay(x.start, Date.now()))) (byDay[dayName(e.start)] = byDay[dayName(e.start)] || []).push(e);
    return Object.entries(byDay).map(([d, ev]) => `**${d}**\n` + bullets(ev.map((e) => `${timeOf(e.start)} · ${e.title}`))).join('\n\n') || 'Nothing else this week.';
  }
  if (pick(/^(messages?|inbox)$/)) {
    const msgs = items.filter((i) => MSG_CATS.includes(i.category));
    if (!msgs.length) return 'No messages waiting.';
    const need = msgs.filter((i) => i.priority === 'High').length;
    return [`**${msgs.length} messages${need ? `, ${need} need a reply` : ''}.**`, '', bullets(msgs.slice(0, 6).map((i) => `${i.priority === 'High' ? '🔴 ' : ''}${i.title}${i.title.includes(i.sourceName) ? '' : ` (${i.sourceName})`}`))].join('\n');
  }
  if (pick(/^(priority( items)?|priorities|high priority( items)?|urgent( items)?|what needs me( first)?)$/)) {
    const highs = items.filter((i) => i.priority === 'High');
    if (!highs.length) return 'Nothing is high priority right now.';
    return [`**${highs.length} priority items. Start with the first one.**`, '', bullets(highs.slice(0, 6).map((i) => `${i.title} (${i.sourceName}${i.deadline ? ', ' + i.deadline : ''})`))].join('\n');
  }
  if (pick(/^(tasks?|urgent tasks?|to-?dos?)$/)) {
    const urgent = ctx.openTasks.filter((t) => t.priority === 'High' || (t.due && t.due <= isoDate()));
    const list = urgent.length ? urgent : ctx.openTasks;
    if (!list.length) return 'No open tasks.';
    return [`**${urgent.length ? `${urgent.length} urgent tasks, ${ctx.openTasks.length} open in total` : list.length + ' open tasks'}.**`, '', bullets(list.slice(0, 6).map((t) => `${t.text}${t.due ? ' · due ' + t.due : ''}`))].join('\n');
  }
  return null;
}

// ---------------------------------------------------------------- demo brain (no API key needed)
function bullets(arr) { return arr.map((s) => `- ${s}`).join('\n'); }

// "Hey Maestro, …" is how people start; it is not part of the question.
const WAKE = '(?:maestro|maestros|mistro|maestra|my stro|mae stro)';
function stripWake(text, cfg) {
  const names = [WAKE, cfg.assistantName.toLowerCase().replace(/[^a-z0-9 ]/g, '')].filter(Boolean).join('|');
  return String(text)
    .replace(new RegExp(`^\\s*(?:(?:hey|hi|hello|ok|okay|yo)[\\s,]+)?(?:${names})\\b[\\s,.:!?-]*`, 'i'), '')
    .replace(new RegExp(`[\\s,]+(?:${names})\\s*([?!.]*)\\s*$`, 'i'), '$1')
    .trim();
}

function firstName(cfg) { return String(cfg.user.name || 'there').split(/\s+/)[0]; }
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

// Everyday questions that don't need the vault: time, date, greetings, thanks, help.
// Maestro is personal and a little sarcastic here, but facts stay first and short.
function smallTalk(message, cfg) {
  const m = message.toLowerCase().replace(/[?!.]+$/, '').trim();
  const me = firstName(cfg);
  const now = new Date();
  const h = now.getHours();
  const clock = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  if (/^(what('s| is)? ?(the )?(current )?time( is it)?( now| right now)?|what time is it( now)?|time|tell me the time|do you know (the|what) time it is)$/.test(m))
    return `It's ${clock}.`;
  if (/^(what('s| is)? ?(the |today'?s )?date( today)?|what day is (it|today)|what('s| is) today|which day is (it|today)|what('s| is) the day( today)?)$/.test(m))
    return `Today is ${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.`;
  const greet = m.match(/^(good )?(morning|afternoon|evening|night)( to you)?( there)?$/);
  if (greet) {
    const said = greet[2];
    if (said === 'night') return `Good night, ${me}. I'll keep an eye on things. Try not to check your email at 2 AM.`;
    if (said === part) return { morning: `Hey ${me}, good morning to you too. Let's crush it today!`, afternoon: `Good afternoon, ${me}. Half the day down, the good half to go.`, evening: `Good evening, ${me}. Wrapping up, or just getting dangerous?` }[part];
    if (said === 'morning' && part === 'afternoon') return `Hey ${me}, good morning to you too. Technically it's ${clock}, but let's crush it anyway!`;
    return `Good ${said}? It's ${clock}, ${me}. Bold choice. Let's crush what's left of the ${part} anyway.`;
  }
  if (/^(hi|hello|hey|yo|hiya|howdy|sup|what's up|whats up)( there)?$/.test(m) || m === '')
    return pick([`Hey ${me}. What are we tackling?`, `Hi ${me}. I'm all ears. Well, all microphone.`, `Hey ${me}. Ready when you are.`]);
  if (/^(how are you|how's it going|how are things|you good|how are you doing)( doing| today)?$/.test(m))
    return pick([`Running at 100% and quietly judging your inbox. How about you, ${me}?`, `Never better. I don't sleep, so I'm always ahead. What do you need, ${me}?`]);
  if (/^(thanks|thank you|thx|cheers|great|perfect|awesome|nice|cool|got it)( (so much|a lot|very much|maestro))?$/.test(m))
    return pick([`Anytime, ${me}.`, `You're welcome. I'll add it to my list of heroic deeds.`, `That's what I'm here for, ${me}.`]);
  if (/^(ok|okay|k|sure)$/.test(m)) return 'Okay.';
  if (/^(who are you|what are you|what is maestro|what's your name|what is your name)$/.test(m))
    return `I'm ${cfg.assistantName}, your second brain, ${me}. I remember your notes, calendar, messages and tasks so you don't have to.`;
  if (/^(help|what can you do|what can i ask( you)?|how do (i|you) use (this|you))$/.test(m))
    return ['Plenty. Try asking:', '- "Summarize my day"', '- "When did Alex call me?"', '- "When is my next meeting with Sarah?"', '- "What are my tasks?"', '- "Remember that…" or "Add a task to…"'].join('\n');
  return null;
}

function demoAnswer(message, ctx, cfg, profile, agent) {
  const quick = smallTalk(message, cfg);
  if (quick) return quick;
  const talk = converse(message, ctx, cfg); // "I'm stressed out", "tell me a joke", "I need a break"…
  if (talk) return talk;
  const deeper = dayDetail(message, ctx, cfg);
  if (deeper) return deeper;
  // Straight questions ("when did Alex call me?", "when is my meeting with Sarah?") get a straight answer first.
  const other = profile === 'business' ? 'personal' : 'business';
  const direct = lookup.answer(message, { items: ctx.all || ctx.items, events: ctx.allEvents || ctx.events }, { profile, otherProfileItems: feed.list({ profile: other, limit: 300 }) });
  if (direct) return direct;
  const m = message.toLowerCase();
  const name = cfg.user.name;
  const items = ctx.items;
  const today = ctx.events.filter((e) => sameDay(e.start, Date.now()));
  const highs = items.filter((i) => i.priority === 'High');

  // PM challenge: sprint, blockers, stakeholder update
  if (/\bsprint\b|\bblockers?\b|\bstakeholders?\b/.test(m)) {
    const sprint = vault.findByTitle('Sprint 24');
    const fm = (sprint && sprint.frontmatter) || {};
    const blockers = items.filter((i) => /block|failing|escalat/i.test(i.title + ' ' + i.quote + ' ' + i.summary));
    const risks = sectionBullets('Sprint 24', 'Risks');
    const done = Number(fm.points_done || 18), total = Number(fm.points_total || 26);
    const pct = Math.round((done / total) * 100);
    const hasPack = cfg.packs.includes('product-manager');
    return [
      `**Sprint ${fm.sprint || 24} is ${pct}% done (${done}/${total} points) with ${fm.days_left || 2} days left. ${blockers.length} blockers need attention.**`,
      '',
      '**Blockers**',
      bullets(blockers.slice(0, 4).map((b) => `**${b.title}** · ${b.sourceName}${b.quote ? ` — ${b.quote}` : ''}`)) || '- None found in the feed',
      risks.length ? '\n**Risks from your sprint note**\n' + bullets(risks.slice(0, 3)) : '',
      '',
      '**Recommended next steps**',
      bullets([
        'Make the scope call on the Payment SDK migration today: ship v2.4 without it, keep it in Sprint 25',
        'Pair Marcus with a second engineer on MOB-142 to protect the release date',
        'Reply to the Northwind escalation with the PLAT-88 export fix ETA',
      ]),
      '',
      '**Draft stakeholder update**',
      `> **Sprint ${fm.sprint || 24} update:** We are at ${pct}% of committed scope with ${fm.days_left || 2} days left. Goal: ${fm.goal || 'ship the Mobile App Redesign beta'}. ` +
        `Main risk is the Payment SDK v5 migration (MOB-142), which blocks two issues; I recommend moving it to Sprint 25 so the redesign ships on time. ` +
        `The bulk export fix (PLAT-88) is in QA and resolves the Northwind escalation. Decision needed from you: approve the scope change by end of day.`,
      '',
      hasPack ? '_Sources: Linear, Jira, Slack, [[Sprint 24]]. Say "save this" to file it in the vault._' : '_Tip: install the **Product Manager** pack on the Skills page to pull Linear and Jira into this answer._',
    ].filter((l) => l !== null).join('\n');
  }

  // Designer challenge: design feedback and handoff
  if (/design feedback|handoff|hand-off|design review|critique/.test(m)) {
    const fb = sectionBullets('Checkout v3', 'Open feedback');
    const designItems = items.filter((i) => ['figma', 'gdrive'].includes(i.source) || /design/i.test(i.quote + i.title));
    return [
      `**Checkout v3 needs ${fb.length || 4} changes before developer handoff.**`,
      '',
      '**Changes needed**',
      bullets(fb.length ? fb : ['Add loading and error states for the Pay button', 'Fix contrast on secondary buttons', 'Document the address autocomplete behaviour', 'Export redlines for the mobile breakpoint']),
      '',
      '**Latest feedback**',
      bullets(designItems.slice(0, 4).map((i) => `${i.title} (${i.sourceName}, ${ago(i.ts)})`)) || '- No new design feedback in the feed',
      '',
      '**Handoff checklist:** states complete, tokens mapped to the design system, specs annotated, open comments resolved.',
      cfg.packs.includes('designer') ? '_Sources: Figma, Google Drive, Slack, [[Checkout v3]]._' : '_Tip: install the **Designer** pack to pull Figma comments in live._',
    ].join('\n');
  }

  // Entrepreneur / builder challenge: PRs, issues, technical status
  if (/pull requests?|\bprs?\b|\bgithub issues\b|open issues|technical status|\brelease\b|\bci\b|\bbuild (status|is|failing|broken)|v2\.4/.test(m)) {
    const prs = sectionBullets('v2.4 Release', 'Open pull requests');
    const iss = sectionBullets('v2.4 Release', 'Open issues');
    const gh = items.filter((i) => i.source === 'github');
    return [
      `**v2.4 is not ready to ship: ${prs.length || 3} PRs open, CI is red on main, and ${iss.length || 2} P1 issues are open.**`,
      '',
      '**Pull requests**', bullets(prs.length ? prs : ['#412 Offline sync: 2 approvals, 1 change requested']),
      '', '**Issues**', bullets(iss.length ? iss : ['#530 Login loop on Android 15 (P1)']),
      gh.length ? '\n**Live from GitHub**\n' + bullets(gh.slice(0, 3).map((i) => `${i.title} · ${ago(i.ts)}`)) : '',
      '', '**Technical status report (draft)**',
      '> Release v2.4 is at risk by 1–2 days. CI on main has failed since commit a91f3c2 (3 checkout tests). PR #412 (Offline sync) needs one change before merge. ' +
        'P1 #530 (Android 15 login loop) needs an owner today. Recommendation: fix CI first, merge #412, then cut the release candidate.',
      cfg.packs.includes('entrepreneur') ? '_Sources: GitHub, [[v2.4 Release]]._' : '_Tip: install the **Entrepreneur** pack to pull GitHub in live._',
    ].join('\n');
  }

  // Daily brief: a high-level overview first, then ask which part to go deeper on.
  const topical = /email|inbox|slack|text|call|meeting|calendar|task|project|sprint|note/.test(m) && !/my day|today|morning|catch me up/.test(m);
  if (!topical && /brief|today|morning|what's on|whats on|my day|catch me up|what did i miss|priorit|summar|overview|rundown/.test(m)) {
    const parts = dayParts(ctx);
    const live = parts.filter((p) => p.count > 0);
    if (live.length <= 1 || /everything|full brief|all of it|in detail|detailed/.test(m)) return fullBrief(ctx, name);
    const hr = new Date().getHours();
    const load = live.reduce((a, p) => a + p.count, 0);
    const quip = load >= 15 ? ', so coffee first' : load >= 6 ? '' : '. Light day, enjoy it while it lasts';
    const list = live.map((p) => p.label);
    return `${hr < 12 ? 'Morning' : hr < 17 ? 'Afternoon' : 'Evening'}, ${firstName(cfg)}. You've got ${joinAnd(live.map((p) => p.short))} today${quip}.\n\n` + followUp(list);
  }

  // Inbox / messages triage
  if (/email|inbox|message|slack|text|sms|call|voicemail|unread/.test(m)) {
    const groups = {};
    for (const i of items.filter((x) => ['EMAIL', 'CONVERSATION', 'SMS', 'CALL'].includes(x.category))) (groups[i.category] = groups[i.category] || []).push(i);
    const label = { EMAIL: 'Emails', CONVERSATION: 'Conversations', SMS: 'Texts', CALL: 'Calls' };
    const count = Object.values(groups).reduce((a, g) => a + g.length, 0);
    if (!count) return 'Nothing waiting on you. Suspiciously quiet.';
    const need = highs.filter((h) => groups[h.category]).length;
    const kinds = Object.entries(groups).map(([k, g]) => `${g.length} ${label[k].toLowerCase()}`);
    return `You've got ${count} messages: ${joinAnd(kinds)}.${need ? ` ${need} need a reply today.` : ''}\n\n` + followUp(Object.keys(groups).map((k) => label[k].toLowerCase()));
  }

  // Calendar / meetings / prep
  if (/calendar|meeting|schedule|agenda|prep|week|tomorrow/.test(m)) {
    const prep = /prep/.test(m);
    const next = ctx.events.find((e) => new Date(e.end) > new Date()) || ctx.events[0];
    if (prep && next) {
      const people = (next.attendees || []).map((a) => vault.findByTitle(a)).filter(Boolean);
      return [`**Prep for ${next.title} at ${timeOf(next.start)} ${sameDay(next.start, Date.now()) ? 'today' : dayName(next.start)}.**`, '',
        next.attendees ? `**Attendees:** ${next.attendees.join(', ')}` : '',
        people.length ? '\n**What you know about them**\n' + bullets(people.map((p) => `[[${p.title}]]: ${p.body.replace(/[#>*\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140)}…`)) : '',
        next.notes ? `\n**Notes:** [[${path.basename(next.notes)}]]` : '',
        '\n**Related feed items**\n' + (bullets(items.filter((i) => next.title.split(' ').some((w) => w.length > 4 && (i.title + i.quote).includes(w))).slice(0, 3).map((i) => i.title)) || '- None'),
        '\n**Suggested talking points**\n' + bullets(['Decision on Payment SDK scope', 'Northwind escalation fix timeline', 'What is at risk for the release']),
      ].join('\n');
    }
    const byDay = {};
    for (const e of ctx.events) (byDay[dayName(e.start)] = byDay[dayName(e.start)] || []).push(e);
    if (!ctx.events.length) return 'Your next 7 days are empty. Enjoy it, or worry about it.';
    const upNext = ctx.events.find((e) => new Date(e.start) > new Date());
    return `You have ${ctx.events.length} events in the next 7 days, ${today.length} of them today.${upNext ? ` Next up is ${upNext.title}, ${sameDay(upNext.start, Date.now()) ? 'today' : dayName(upNext.start)} at ${timeOf(upNext.start)}.` : ''}\n\n` + followUp(['today', 'tomorrow', 'the rest of the week']);
  }

  // Tasks
  if (/task|to-?do|to do|what should i (do|work)/.test(m)) {
    return [`**${ctx.openTasks.length} open tasks. Start with the top one.**`, '', bullets(ctx.openTasks.slice(0, 8).map((t) => `${t.priority === 'High' ? '🔴 ' : ''}${t.text}${t.due ? ' · due ' + t.due : ''} _([[${t.note}]])_`))].join('\n');
  }

  // Who is / people
  const who = m.match(/who is ([a-z ]+)/);
  if (who) {
    const p = vault.search(who[1], { limit: 1 })[0];
    if (p) return `**[[${p.title}]]**\n\n${vault.readNote(p.path).body.trim().slice(0, 700)}`;
  }

  // Fallback: only answer from the vault when a note is clearly about the question; otherwise say so briefly.
  const words = vault.tokenize ? vault.tokenize(message) : message.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const titleWords = (n) => new Set(n.title.toLowerCase().split(/[^a-z0-9]+/));
  const strong = ctx.notes.filter((n) => words.some((w) => w.length > 3 && titleWords(n).has(w)));
  if (strong.length) {
    return [`Here's what I have on that${agent ? ` (as @${agent.handle})` : ''}:`, '',
      ...strong.slice(0, 2).map((n) => `**[[${n.title}]]**\n${n.excerpt}`)].join('\n\n');
  }
  return `You lost me there, ${firstName(cfg)}. Try "summarize my day" or ask about a meeting, message or project.`;
}

// ---------------------------------------------------------------- main entry
async function chat({ message, agentHandle, conversationId, voice = false }) {
  const cfg = config.load();
  const profile = cfg.profile;
  const raw = String(message || '').trim();
  if (!raw) throw new Error('Empty message');
  const stripped = stripWake(raw, cfg);
  let text = stripped || 'hey';

  // @mentions pick an agent
  let agent = null;
  const mention = text.match(/^@(\w[\w-]*)\s*/);
  if (mention) { agent = agentsMod.findAgent(mention[1]); if (agent) text = text.slice(mention[0].length) || 'Give me your update.'; }
  if (!agent && agentHandle) agent = agentsMod.findAgent(agentHandle);
  if (agent && agent.handle.toLowerCase() === cfg.assistantName.toLowerCase()) agent = null;

  const convs = loadConversations();
  let conv = convs.find((c) => c.id === conversationId);
  // Answering a question with "Maestro" (e.g. which calendar?) is an answer, not a wake word.
  if (conv && conv.pending) { const lead = raw.replace(/^[\s,]*(hey|ok|okay|hi)?[\s,]*/i, ''); if (!stripped || (/^(maestro|mistro|maestra)\b/i.test(lead) && /\b(calendar|one|please)\b/i.test(lead))) text = lead || raw; }
  if (!conv) {
    conv = { id: Date.now().toString(36), title: text.slice(0, 60), created: Date.now(), profile, messages: [] };
    convs.unshift(conv);
  }

  let reply, sources = [], providerUsed = cfg.llm.provider, actions = [];

  // Creating calendar events: asks for what's missing, then creates it (works with every model).
  // Removing events ("cancel my meeting with John tomorrow") is checked first, unless a new event is half-built.
  const rem = conv.pending && conv.pending.type === 'event' ? null : await require('./remove').handle(text, conv, { profile, name: firstName(cfg) });
  const sched = rem || await scheduler.handle(text, conv, { profile, name: firstName(cfg) });
  if (rem && rem.removed) actions.push({ type: 'event-removed', event: rem.removed });
  if (sched) {
    reply = sched.reply; providerUsed = 'calendar';
    if (sched.event) {
      actions.push({ type: 'event', event: sched.event });
      try { const ev = sched.event;
      const calSrc = ev.calendarFor || (ev.target && ev.target.startsWith('caldav:') ? ev.target.split(':')[1] : 'system');
      feed.add({ source: calSrc, category: 'MEETING', profile, description: feed.eventText(ev), eventKey: ev.uid, eventStart: ev.start, title: `New: ${ev.title}`, quote: `${new Date(ev.start).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${ev.attendees.length ? ' · with ' + ev.attendees.join(', ') : ''}${ev.location ? ' · ' + ev.location : ''}`, summary: 'Created by Maestro', priority: '' }); } catch { /* feed is best-effort */ }
    }
  }

  // Built-in memory protocol commands work with every model.
  const rememberMatch = text.match(/^(?:please\s+)?(?:remember(?: that)?|note that|don'?t forget(?: that)?)\s+(.+)/i);
  const taskMatch = text.match(/^(?:please\s+)?(?:add (?:a )?task(?: to)?|remind me to|todo:?)\s+(.+)/i);
  if (sched) {
    // handled above
  } else if (rememberMatch) {
    const rel = remember(rememberMatch[1], agent ? '@' + agent.handle : 'chat');
    reply = `Got it. I saved that to [[Memory Log]] and will use it from now on.`;
    sources = [rel]; providerUsed = 'memory'; actions.push({ type: 'memory', path: rel });
  } else if (taskMatch) {
    const line = tasks.add(taskMatch[1]);
    reply = `Added to [[Inbox]]: ${line.replace('- [ ] ', '')}`;
    sources = ['Tasks/Inbox.md']; providerUsed = 'tasks'; actions.push({ type: 'task' });
  } else {
    const ctx = await gatherContext(text, profile);
    sources = [...new Set([...ctx.notes.map((n) => n.path), ...ctx.mem.map((n) => n.path)])];
    const skill = agentsMod.matchSkill(text);
    const provider = agent && agent.provider && agent.provider !== 'default' ? agent.provider : cfg.llm.provider;
    providerUsed = provider;
    if (smallTalk(text, cfg) || converse(text, { ...ctx, history: conv.messages.slice(-12) }, cfg)) sources = []; // "good morning" or "I'm stressed" needs no notes
    ctx.history = conv.messages.slice(-12); // so "say hi to everyone" remembers "I'm at my Brain Builder event"
    if (provider === 'demo') {
      reply = demoAnswer(text, ctx, cfg, profile, agent);
    } else {
      const exact = lookup.contextBlock(text, { items: ctx.all, events: ctx.allEvents || ctx.events });
      const system = systemPrompt(cfg, profile, agent, skill, voice) + '\n\n' + (exact ? exact + '\n\n' : '') + contextText(ctx, cfg, profile);
      const history = conv.messages.slice(-8).map((x) => ({ role: x.role, content: x.content }));
      try {
        reply = await llm.complete(provider, system, [...history, { role: 'user', content: text }], agent || {});
      } catch (e) {
        reply = `⚠️ ${llm.PROVIDERS[provider] ? llm.PROVIDERS[provider].label : provider} error: ${e.message}\n\nHere is the offline answer instead:\n\n` + demoAnswer(text, ctx, cfg, profile, agent);
        providerUsed = 'demo';
      }
    }
    if (skill) actions.push({ type: 'skill', name: skill.name });
  }

  conv.messages.push({ role: 'user', content: text, ts: Date.now(), agent: agent ? agent.handle : null });
  conv.messages.push({ role: 'assistant', content: reply, ts: Date.now(), agent: agent ? agent.handle : cfg.assistantName, sources, provider: providerUsed });
  saveConversations(convs);
  try { logToDaily(`${agent ? '@' + agent.handle : cfg.assistantName} · ${text.slice(0, 120)}`); } catch { /* vault read-only */ }

  return { conversationId: conv.id, reply, sources, agent: agent ? { handle: agent.handle, name: agent.name, color: agent.color } : null, provider: providerUsed, actions };
}

// Save a chat answer into the vault as its own note.
function saveAnswer(title, content) {
  const safe = title.replace(/[\\/:*?"<>|#^[\]]/g, '').slice(0, 80).trim() || 'Brain answer';
  const rel = `Inbox/${isoDate()} ${safe}.md`;
  vault.writeNote(rel, `---\ntags: [brain-output]\ncreated: ${new Date().toISOString()}\n---\n# ${safe}\n\n${content}\n\nFrom [[Maestro Home]] · ${dayName(Date.now())}`);
  return rel;
}

module.exports = { chat, remember, gatherContext, contextText, demoAnswer, loadConversations, saveAnswer, ensureDaily, logToDaily, isoDate, timeOf, ago };
