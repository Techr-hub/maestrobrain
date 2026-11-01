#!/usr/bin/env node
// Maestro MCP server for Claude Desktop (stdio transport, zero dependencies).
// Claude is the reasoning engine; this server gives it the brain: vault knowledge, memory,
// the intelligence feed, calendar, tasks and skills. Register it with `npm run connect-claude`.
const path = require('path');
const readline = require('readline');

const core = path.join(__dirname, '..', 'core');
const config = require(path.join(core, 'config'));
const vault = require(path.join(core, 'vault'));
const feed = require(path.join(core, 'feed'));
const calendar = require(path.join(core, 'calendar'));
const tasks = require(path.join(core, 'tasks'));
const agents = require(path.join(core, 'agents'));
const brain = require(path.join(core, 'brain'));
const connectors = require(path.join(core, 'connectors'));

const VERSION = require('../package.json').version;
const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const log = (...a) => process.stderr.write('[maestro-mcp] ' + a.join(' ') + '\n');

const fmtTime = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

const TOOLS = [
  {
    name: 'maestro_brief',
    description: "Get everything needed for a briefing on the user's day: today's calendar, high-priority feed items, open tasks and memory. Use this first when the user asks what's going on, to brief them, or what to focus on.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      const cfg = config.load();
      const ctx = await brain.gatherContext('brief today priorities', cfg.profile);
      return `User: ${cfg.user.name} (${cfg.user.role}). Profile: ${cfg.profile}. Now: ${new Date().toLocaleString()}\n\n` + brain.contextText(ctx, cfg, cfg.profile);
    },
  },
  {
    name: 'search_brain',
    description: "Search the user's Obsidian vault (notes, projects, people, meetings, decisions, memory) by keywords. Returns matching notes with excerpts and paths.",
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', description: 'Max results (default 6)' } }, required: ['query'], additionalProperties: false },
    run: async ({ query, limit }) => {
      const hits = vault.search(query, { limit: limit || 6 });
      if (!hits.length) return `No notes match "${query}".`;
      return hits.map((h) => `## ${h.title}\npath: ${h.path}\n${h.excerpt}`).join('\n\n');
    },
  },
  {
    name: 'read_note',
    description: 'Read a full note from the vault by path (e.g. "Projects/Sprint 24.md") or by title.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, title: { type: 'string' } }, additionalProperties: false },
    run: async ({ path: p, title }) => {
      let rel = p;
      if (!rel && title) { const n = vault.findByTitle(title); if (!n) throw new Error(`No note titled "${title}"`); rel = n.path; }
      if (!rel) throw new Error('Give a path or a title');
      return vault.readNote(rel).raw;
    },
  },
  {
    name: 'write_note',
    description: 'Create, append to, or overwrite a Markdown note in the vault. Use [[wikilinks]] to connect it to related notes. Prefer folders: Inbox/, Projects/, Meetings/, People/, Decisions/, Personal/.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Relative path, e.g. "Meetings/2026-11-03 Sprint Review.md"' }, content: { type: 'string' }, mode: { type: 'string', enum: ['create', 'append', 'overwrite'], description: 'Default create (fails if the note exists)' } }, required: ['path', 'content'], additionalProperties: false },
    run: async ({ path: p, content, mode = 'create' }) => {
      const exists = vault.loadNotes(true).some((n) => n.path === p || n.path === p + '.md');
      if (mode === 'create' && exists) throw new Error('That note already exists. Use mode "append" or "overwrite".');
      const rel = vault.writeNote(p, content, { append: mode === 'append' });
      feed.add({ source: 'system', profile: config.load().profile, category: 'PROJECT', title: `Claude ${mode === 'append' ? 'updated' : 'saved'} a note`, quote: rel, summary: 'Written from Claude Desktop', notePath: rel });
      return `Saved ${rel}`;
    },
  },
  {
    name: 'remember',
    description: "Save a lasting fact about the user (a preference, decision, person, or context) to the brain's memory log so it is used in every future answer.",
    inputSchema: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'], additionalProperties: false },
    run: async ({ fact }) => `Remembered in ${brain.remember(fact, 'Claude Desktop')}`,
  },
  {
    name: 'get_memory',
    description: "Read the user's memory notes: profile, preferences, working style and the memory log.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => vault.loadNotes().filter((n) => n.folder === 'Memory').map((n) => `# ${n.title}\n${n.body}`).join('\n\n---\n\n'),
  },
  {
    name: 'get_feed',
    description: 'Get the intelligence feed: normalised notifications from email, Gmail, Outlook, calendars, Slack, texts, calls and role-pack tools (Linear, Jira, Figma, GitHub…).',
    inputSchema: { type: 'object', properties: { source: { type: 'string', description: 'Connector id, e.g. slack, gmail, outlook, gcal, twilio_sms, linear, github' }, category: { type: 'string', enum: ['EMAIL', 'CONVERSATION', 'SMS', 'CALL', 'MEETING', 'TASK', 'PROJECT', 'INSIGHT'] }, limit: { type: 'number' } }, additionalProperties: false },
    run: async ({ source, category, limit }) => {
      const items = feed.list({ source, category, limit: limit || 25 });
      if (!items.length) return 'No feed items match.';
      return items.map((i) => `- [${i.category}] ${i.sourceName} · ${brain.ago(i.ts)} · ${i.title}${i.quote ? ' — ' + i.quote : ''}${i.summary ? ' (' + i.summary + ')' : ''}${i.priority ? ' · ' + i.priority : ''}${i.deadline ? ' · ' + i.deadline : ''}`).join('\n');
    },
  },
  {
    name: 'get_calendar',
    description: "Get the user's calendar events for the next N days (default 7).",
    inputSchema: { type: 'object', properties: { days: { type: 'number' } }, additionalProperties: false },
    run: async ({ days }) => {
      const ev = await calendar.list({ days: days || 7 });
      return ev.map((e) => `- ${fmtTime(e.start)}–${new Date(e.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${e.title}${e.attendees ? ' · with ' + e.attendees.join(', ') : ''}${e.location ? ' · ' + e.location : ''}`).join('\n') || 'No events.';
    },
  },
  {
    name: 'create_event',
    description: "Create a calendar event for the user. Saves it to Maestro's calendar and, when the user's iCloud/CalDAV calendar has sign-in details in Maestro, writes it there too. Ask the user for any missing detail (day, time, length, title) before calling. For Google Calendar or Outlook, prefer those Claude connectors if they are available.",
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, start: { type: 'string', description: 'ISO 8601 start, e.g. 2026-11-02T14:00:00 (local time if no offset)' }, duration_minutes: { type: 'number' }, attendees: { type: 'array', items: { type: 'string' } }, location: { type: 'string' }, calendar: { type: 'string', description: 'Calendar name from list_calendars; defaults to the first writable calendar' } }, required: ['title', 'start'], additionalProperties: false },
    run: async ({ title, start, duration_minutes, attendees, location, calendar: calName }) => {
      const ev = require('../core/events');
      const { targets } = await ev.targets();
      const t = (calName && targets.find((x) => x.name.toLowerCase() === String(calName).toLowerCase())) || targets[0];
      const r = await ev.create({ title, start, minutes: duration_minutes || 30, attendees: attendees || [], location }, { target: t.id });
      return `Created "${r.event.title}" ${new Date(r.event.start).toLocaleString()} – ${new Date(r.event.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} in ${t.id === 'maestro' ? 'the Maestro calendar' : `${t.name} (${t.via})`}.${r.warning ? ' ' + r.warning : ''}`;
    },
  },
  {
    name: 'list_calendars',
    description: 'List the calendars Maestro can create events in.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => { const { targets, notes } = await require('../core/events').targets(); return targets.map((t) => `- ${t.name} (${t.via})`).join('\n') + (notes.length ? '\n\n' + notes.join('\n') : ''); },
  },
  {
    name: 'list_tasks',
    description: 'List open tasks from the vault (Obsidian checkboxes), highest priority first.',
    inputSchema: { type: 'object', properties: { include_done: { type: 'boolean' } }, additionalProperties: false },
    run: async ({ include_done }) => tasks.list({ includeDone: !!include_done }).map((t) => `- [${t.done ? 'x' : ' '}] ${t.text}${t.priority ? ' · ' + t.priority : ''}${t.due ? ' · due ' + t.due : ''} (path: ${t.path}, line: ${t.line})`).join('\n') || 'No open tasks.',
  },
  {
    name: 'add_task',
    description: 'Add a task to the vault inbox (Tasks/Inbox.md).',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, due: { type: 'string', description: 'YYYY-MM-DD' }, priority: { type: 'string', enum: ['High', 'Medium', 'Low'] } }, required: ['text'], additionalProperties: false },
    run: async ({ text, due, priority }) => `Added: ${tasks.add(text, { due, priority })}`,
  },
  {
    name: 'complete_task',
    description: 'Toggle a task done/undone using the path and line from list_tasks.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, line: { type: 'number' } }, required: ['path', 'line'], additionalProperties: false },
    run: async ({ path: p, line }) => (tasks.toggle(p, line) ? 'Marked done' : 'Reopened'),
  },
  {
    name: 'log_decision',
    description: 'Record a decision in the vault (Decisions/) with context, options considered and rationale, so the brain can recall why something was decided.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, decision: { type: 'string' }, rationale: { type: 'string' }, stakeholders: { type: 'string' }, project: { type: 'string' } }, required: ['title', 'decision'], additionalProperties: false },
    run: async ({ title, decision, rationale, stakeholders, project }) => {
      const rel = `Decisions/${brain.isoDate()} ${title.replace(/[\\/:*?"<>|]/g, '')}.md`;
      vault.writeNote(rel, `---\ntags: [decision]\ndate: ${brain.isoDate()}\n---\n# ${title}\n\n**Decision:** ${decision}\n\n**Why:** ${rationale || ''}\n\n**Stakeholders:** ${stakeholders || ''}\n\n${project ? `Project: [[${project}]]\n\n` : ''}Back to [[Decision Log]]`);
      return `Logged ${rel}`;
    },
  },
  {
    name: 'list_skills',
    description: "List the brain's skills (reusable playbooks like sprint briefing, design critique, release summary).",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => agents.skills().map((s) => `- ${s.name}: ${s.description}`).join('\n') || 'No skills installed.',
  },
  {
    name: 'get_skill',
    description: 'Get the step-by-step instructions for a skill by name. Follow them to complete the task.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
    run: async ({ name }) => {
      const s = agents.skills().find((x) => x.name.toLowerCase() === name.toLowerCase() || x.slug === name.toLowerCase());
      if (!s) throw new Error('No skill named ' + name);
      return `# ${s.name}\n${s.instructions}`;
    },
  },
  {
    name: 'list_agents',
    description: "List the specialist agents loaded into the brain (e.g. @Product, @Design, @Dev). Each agent is a persona with its own instructions that shares the same knowledge base.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => agents.agents().map((a) => `- @${a.handle} (${a.name})${a.role ? ': ' + a.role : ''}${a.description ? ' — ' + a.description : ''}${a.skills.length ? ' · skills: ' + a.skills.join(', ') : ''}`).join('\n') || 'No agents loaded.',
  },
  {
    name: 'get_agent',
    description: 'Load an agent persona by handle (e.g. "Product"). Adopt its instructions for the rest of the task and use the Maestro tools for knowledge.',
    inputSchema: { type: 'object', properties: { handle: { type: 'string' } }, required: ['handle'], additionalProperties: false },
    run: async ({ handle }) => {
      const a = agents.findAgent(handle);
      if (!a) throw new Error('No agent @' + handle);
      const sk = agents.skills().filter((s) => a.skills.map((x) => x.toLowerCase()).includes(s.name.toLowerCase()));
      return `# @${a.handle} — ${a.name}\n${a.prompt}${sk.length ? '\n\n## Skills this agent uses\n' + sk.map((s) => `### ${s.name}\n${s.instructions}`).join('\n\n') : ''}`;
    },
  },
  {
    name: 'create_skill',
    description: 'Teach the brain a new reusable skill (a playbook). Saved to Skills/ in the vault so every agent, the dashboard and Claude can use it.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, triggers: { type: 'string', description: 'Comma-separated phrases that should trigger it' }, instructions: { type: 'string', description: 'Markdown steps' } }, required: ['name', 'instructions'], additionalProperties: false },
    run: async (args) => `Saved ${agents.createSkill(args)}`,
  },
  {
    name: 'create_agent',
    description: 'Create a new specialist agent in the brain (saved to Agents/ in the vault). It shares the same knowledge base and can be @mentioned in the dashboard.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, handle: { type: 'string' }, role: { type: 'string' }, description: { type: 'string' }, prompt: { type: 'string', description: 'System instructions for the agent' } }, required: ['name'], additionalProperties: false },
    run: async (args) => `Saved ${agents.createAgent(args)}`,
  },
  {
    name: 'list_connections',
    description: 'Show which sources are connected to the brain in each profile (demo or live).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      const cfg = config.load();
      return Object.entries(cfg.connections).map(([prof, c]) => `${prof}: ` + (Object.entries(c).map(([id, v]) => `${(connectors.get(id) || { name: id }).name} (${v.mode})`).join(', ') || 'none')).join('\n') + `\nActive profile: ${cfg.profile}`;
    },
  },
  {
    name: 'switch_profile',
    description: 'Switch the brain between the Business and Personal profile.',
    inputSchema: { type: 'object', properties: { profile: { type: 'string', enum: ['business', 'personal'] } }, required: ['profile'], additionalProperties: false },
    run: async ({ profile }) => { config.update((c) => { c.profile = profile; }); return `Profile is now ${profile}`; },
  },
];

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(msg) {
  const { id, method, params = {} } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    switch (method) {
      case 'initialize': {
        const v = SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED[0];
        const cfg = config.load();
        return reply(id, {
          protocolVersion: v,
          capabilities: { tools: {}, prompts: {}, resources: {} },
          serverInfo: { name: 'maestro', title: 'Maestro Second Brain', version: VERSION },
          instructions: `Maestro is ${cfg.user.name}'s second brain (Obsidian vault + memory + intelligence feed). Call maestro_brief or get_memory early for context, search_brain before answering questions about their work or life, and use remember / write_note / log_decision to keep the brain up to date. Cite notes as [[Title]].`,
        });
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return;
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case 'tools/call': {
        const tool = TOOLS.find((t) => t.name === params.name);
        if (!tool) return fail(id, -32602, 'Unknown tool ' + params.name);
        try {
          const text = await tool.run(params.arguments || {});
          return reply(id, { content: [{ type: 'text', text: String(text) }] });
        } catch (e) {
          return reply(id, { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true });
        }
      }
      case 'prompts/list': {
        const arg = [{ name: 'focus', description: 'Optional extra focus or details', required: false }];
        return reply(id, { prompts: [
          ...agents.skills().map((s) => ({ name: 'skill-' + s.slug, title: 'Skill: ' + s.name, description: s.description || s.name, arguments: arg })),
          ...agents.agents().map((a) => ({ name: 'agent-' + a.handle.toLowerCase(), title: `Agent: @${a.handle}`, description: a.description || a.role || a.name, arguments: arg })),
        ] });
      }
      case 'prompts/get': {
        const name = String(params.name || '');
        const focus = params.arguments && params.arguments.focus ? `\n\nFocus: ${params.arguments.focus}` : '';
        if (name.startsWith('agent-')) {
          const a = agents.findAgent(name.slice(6));
          if (!a) return fail(id, -32602, 'Unknown prompt');
          return reply(id, { description: a.description, messages: [{ role: 'user', content: { type: 'text', text: `For this conversation, act as my Maestro agent @${a.handle}. Use the Maestro tools (get_memory, search_brain, get_feed, get_calendar, list_tasks) for knowledge before answering.\n\n${a.prompt}${focus}` } }] });
        }
        const s = agents.skills().find((x) => 'skill-' + x.slug === name || x.slug === name);
        if (!s) return fail(id, -32602, 'Unknown prompt');
        return reply(id, { description: s.description, messages: [{ role: 'user', content: { type: 'text', text: `Run my "${s.name}" skill using the Maestro tools.\n\n${s.instructions}${focus}` } }] });
      }
      case 'resources/list':
        return reply(id, { resources: vault.loadNotes().filter((n) => ['Memory', '(root)'].includes(n.folder)).map((n) => ({ uri: 'maestro://vault/' + encodeURI(n.path), name: n.title, mimeType: 'text/markdown' })) });
      case 'resources/read': {
        const rel = decodeURI(String(params.uri || '').replace('maestro://vault/', ''));
        return reply(id, { contents: [{ uri: params.uri, mimeType: 'text/markdown', text: vault.readNote(rel).raw }] });
      }
      default:
        if (isRequest) return fail(id, -32601, 'Method not found: ' + method);
    }
  } catch (e) {
    log('error', e.stack || e.message);
    if (isRequest) fail(id, -32603, e.message);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'Parse error'); }
  if (Array.isArray(msg)) msg.forEach(handle); else handle(msg);
});
rl.on('close', () => process.exit(0));
log(`ready (vault: ${config.load().vaultPath})`);
