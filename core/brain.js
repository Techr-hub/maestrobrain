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
  const items = feed.list({ profile, limit: 25 });
  const events = await calendar.list({ profile, days: 7 });
  const openTasks = tasks.list({ profile }).slice(0, 15);
  return { notes, mem, items, events, openTasks };
}

function contextText(ctx, cfg, profile) {
  const parts = [];
  parts.push(`# MEMORY (who the user is, preferences, standing facts)\n` + ctx.mem.map((m) => `## [[${m.title}]]\n${m.body}`).join('\n\n'));
  parts.push(`# RELEVANT NOTES FROM THE OBSIDIAN VAULT\n` + (ctx.notes.length ? ctx.notes.map((n) => `## [[${n.title}]] (${n.path})\n${n.body}`).join('\n\n') : '(no matching notes)'));
  parts.push(`# INTELLIGENCE FEED (newest first)\n` + ctx.items.map((i) => `- [${i.category}] ${i.sourceName} · ${ago(i.ts)} · ${i.title}${i.quote ? ' — ' + i.quote : ''}${i.summary ? ' (' + i.summary + ')' : ''}${i.priority ? ' · priority ' + i.priority : ''}${i.deadline ? ' · ' + i.deadline : ''}`).join('\n'));
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
    'Use short Markdown: a one-line answer first, then bullets. Offer to save outputs to the vault.',
    voice ? 'The user is talking by voice. Answer in 2 to 4 short spoken sentences with no Markdown, tables or lists.' : '',
    skill ? `\n# ACTIVE SKILL: ${skill.name}\nFollow these instructions:\n${skill.instructions}` : '',
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------- demo brain (no API key needed)
function bullets(arr) { return arr.map((s) => `- ${s}`).join('\n'); }

function demoAnswer(message, ctx, cfg, profile, agent) {
  const m = message.toLowerCase();
  const name = cfg.user.name;
  const items = ctx.items;
  const today = ctx.events.filter((e) => sameDay(e.start, Date.now()));
  const highs = items.filter((i) => i.priority === 'High');

  // PM challenge: sprint, blockers, stakeholder update
  if (/sprint|blocker|stakeholder/.test(m)) {
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
  if (/pull request|\bprs?\b|issues|technical status|release|ci\b|build/.test(m)) {
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

  // Daily brief
  if (/brief|today|morning|what's on|whats on|my day|catch me up|what did i miss|priorit/.test(m)) {
    const due = ctx.openTasks.filter((t) => t.priority === 'High' || (t.due && t.due <= isoDate())).slice(0, 4);
    const insight = items.find((i) => i.category === 'INSIGHT');
    return [
      `**Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${name}. You have ${today.length} events today, ${highs.length} high-priority items and ${due.length} urgent tasks.**`,
      '',
      '**Schedule**', bullets(today.map((e) => `${timeOf(e.start)} · ${e.title}`)) || '- Nothing scheduled',
      '', '**Needs you first**', bullets(highs.slice(0, 4).map((i) => `${i.title} (${i.sourceName}${i.deadline ? ', ' + i.deadline : ''})`)) || '- Nothing urgent',
      '', '**Top tasks**', bullets(due.map((t) => `${t.text}${t.due ? ' · due ' + t.due : ''}`)) || '- Inbox zero',
      insight ? `\n**Insight:** ${insight.quote}. ${insight.summary}` : '',
    ].join('\n');
  }

  // Inbox / messages triage
  if (/email|inbox|message|slack|text|sms|call|voicemail|unread/.test(m)) {
    const groups = {};
    for (const i of items.filter((x) => ['EMAIL', 'CONVERSATION', 'SMS', 'CALL'].includes(x.category))) (groups[i.category] = groups[i.category] || []).push(i);
    const label = { EMAIL: 'Email', CONVERSATION: 'Conversations', SMS: 'Texts', CALL: 'Calls' };
    const count = Object.values(groups).reduce((a, g) => a + g.length, 0);
    return [`**${count} messages across your connected sources. ${highs.filter((h) => groups[h.category]).length} need a reply today.**`, '',
      ...Object.entries(groups).map(([k, g]) => `**${label[k]}**\n` + bullets(g.slice(0, 4).map((i) => `${i.priority === 'High' ? '🔴 ' : ''}${i.title}${i.quote ? ' — ' + i.quote : ''}`))),
    ].join('\n\n');
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
    return [`**You have ${ctx.events.length} events in the next 7 days, ${today.length} today.**`, '',
      ...Object.entries(byDay).slice(0, 4).map(([d, ev]) => `**${d}**\n` + bullets(ev.map((e) => `${timeOf(e.start)} · ${e.title}`)))].join('\n\n');
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

  // Fallback: search the vault
  if (ctx.notes.length) {
    return [`Here is what your brain knows about that${agent ? ` (as @${agent.handle})` : ''}:`, '',
      ...ctx.notes.slice(0, 3).map((n) => `**[[${n.title}]]**\n${n.excerpt}`),
      '', '_You are on the offline demo brain. Connect Claude in Settings (or ask in Claude Desktop) for full reasoning over these notes._'].join('\n\n');
  }
  return `I couldn't find anything about that in your vault or feed yet. Try "brief me", "review my sprint", or "remember that …" to teach me. To get full reasoning, connect Claude in Settings or ask me through Claude Desktop.`;
}

// ---------------------------------------------------------------- main entry
async function chat({ message, agentHandle, conversationId, voice = false }) {
  const cfg = config.load();
  const profile = cfg.profile;
  let text = String(message || '').trim();
  if (!text) throw new Error('Empty message');

  // @mentions pick an agent
  let agent = null;
  const mention = text.match(/^@(\w[\w-]*)\s*/);
  if (mention) { agent = agentsMod.findAgent(mention[1]); if (agent) text = text.slice(mention[0].length) || 'Give me your update.'; }
  if (!agent && agentHandle) agent = agentsMod.findAgent(agentHandle);
  if (agent && agent.handle.toLowerCase() === cfg.assistantName.toLowerCase()) agent = null;

  const convs = loadConversations();
  let conv = convs.find((c) => c.id === conversationId);
  if (!conv) {
    conv = { id: Date.now().toString(36), title: text.slice(0, 60), created: Date.now(), profile, messages: [] };
    convs.unshift(conv);
  }

  let reply, sources = [], providerUsed = cfg.llm.provider, actions = [];

  // Built-in memory protocol commands work with every model.
  const rememberMatch = text.match(/^(?:please\s+)?(?:remember(?: that)?|note that|don'?t forget(?: that)?)\s+(.+)/i);
  const taskMatch = text.match(/^(?:please\s+)?(?:add (?:a )?task(?: to)?|remind me to|todo:?)\s+(.+)/i);
  if (rememberMatch) {
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
    if (provider === 'demo') {
      reply = demoAnswer(text, ctx, cfg, profile, agent);
    } else {
      const system = systemPrompt(cfg, profile, agent, skill, voice) + '\n\n' + contextText(ctx, cfg, profile);
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
