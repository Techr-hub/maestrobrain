#!/usr/bin/env node
// Self-test: `npm test`. Runs the brain against a temporary copy of the starter vault and checks
// the dashboard API, the demo brain, packs, workflows and the Claude Desktop MCP server.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-test-'));
const vaultCopy = path.join(tmp, 'vault');
fs.cpSync(path.join(ROOT, 'vault'), vaultCopy, { recursive: true });
process.env.MAESTRO_DATA = path.join(tmp, 'data');
process.env.MAESTRO_HOME = path.join(tmp, 'home');
fs.mkdirSync(process.env.MAESTRO_DATA, { recursive: true });
fs.writeFileSync(path.join(process.env.MAESTRO_DATA, 'config.json'), JSON.stringify({ vaultPath: vaultCopy }));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); } else { fail++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m ' + extra); } };

async function main() {
  const { start } = require('../server');
  const { server, port } = await start(0);
  const base = `http://127.0.0.1:${port}/api`;
  const get = async (p) => (await fetch(base + p)).json();
  const post = async (p, b) => (await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();

  console.log('\nDashboard API');
  const st = await get('/state');
  ok('state loads', st.config && st.connectors.length >= 15);
  ok('starter agents present', st.agents.length >= 3);
  ok('foundation skills present', st.skills.length >= 5);
  {
    const { parseIcs, calendarUrls } = require('../core/connectors');
    const ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:r1\nDTSTART:20260105T140000Z\nDTEND:20260105T141500Z\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE\nEXDATE:20261104T140000Z\nSUMMARY:Standup\nEND:VEVENT\nEND:VCALENDAR';
    const ev = parseIcs(ics, { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-10T00:00:00Z') });
    ok('calendar: recurring events expand, EXDATE skipped', ev.map((e) => e.start.slice(0, 10)).join(',') === '2026-11-02,2026-11-09');
    ok('calendar: several ICS links per connector', calendarUrls({ icsUrl: 'https://a/x.ics', icsUrls: ['webcal://b/y.ics', ''] }).length === 2);
  }
  const feed = await get('/feed');
  ok('feed has demo items', feed.length >= 5);
  const g = await get('/graph');
  ok('brain map graph built', g.nodes.length > 20 && g.edges.length > 20);

  console.log('\nDemo brain');
  const sprint = await post('/chat', { message: 'Review my current sprint, identify blockers, and prepare an update for stakeholders.' });
  ok('PM challenge answered', /Sprint 24/.test(sprint.reply) && /stakeholder/i.test(sprint.reply));
  const design = await post('/chat', { message: 'Review the latest design feedback and identify changes needed before developer handoff.' });
  ok('Design challenge answered', /handoff/i.test(design.reply));
  const dev = await post('/chat', { message: 'Review open pull requests and issues, then prepare a technical status report.' });
  ok('Builder challenge answered', /#412/.test(dev.reply));
  {
    const m1 = await post('/chat', { message: 'Hey Maestro, create a new meeting for tomorrow at 2pm with John.' });
    const m2 = await post('/chat', { message: '45 minutes', conversationId: m1.conversationId });
    const m3 = await post('/chat', { message: 'Pricing follow-up', conversationId: m1.conversationId });
    const m4 = await post('/chat', { message: 'on Zoom', conversationId: m1.conversationId });
    const m5 = await post('/chat', { message: 'skip', conversationId: m1.conversationId });
    const m6 = /Which calendar/.test(m5.reply) ? await post('/chat', { message: 'Maestro', conversationId: m1.conversationId }) : m5;
    ok('create meeting: asks which calendar when several are connected', /Which calendar should I add it to: 1\) .*Google Calendar.*Maestro\?/.test(m5.reply));
    ok('create meeting: asks what is missing, then creates it', /How long/.test(m1.reply) && /call it/.test(m2.reply) && /Where is it/.test(m3.reply) && /description/.test(m4.reply) && /^Creating "Pricing follow-up" for tomorrow .*2:00 PM to 2:45 PM, with John, at Zoom/.test(m6.reply));
    const tk = await post('/tasks/event', { event: 'New: Brain Builder Workshop', note: 'Share the recording with attendees', items: 'Send the slides by Friday\n- Book the room for December', priority: 'High' });
    const tl = await (await fetch(base + '/tasks')).json();
    ok('Create Task on an event: note and action items join the task list, with spoken deadlines', tk.count === 3 && tl.some((t) => t.text === 'Brain Builder Workshop: Share the recording with attendees' && t.priority === 'High') && tl.some((t) => t.text === 'Send the slides (Brain Builder Workshop)' && /^\d{4}-\d{2}-\d{2}$/.test(t.due)) && tl.some((t) => t.text === 'Book the room for December (Brain Builder Workshop)' && !t.due));
    await post('/tasks', { text: 'Reply to the venue', section: 'email' });
    const ts = await (await fetch(base + '/tasks')).json();
    ok('Tasks page: tasks carry their brain section (tagged or worked out)', ts.some((t) => t.text === 'Reply to the venue' && t.section === 'email') && ts.some((t) => t.text === 'Brain Builder Workshop: Share the recording with attendees' && t.section === 'calendar') && ts.some((t) => /^Call /.test(t.text) && t.section === 'calls'));
    const before = (await (await fetch(base + '/feed?limit=400')).json());
    const victim = (before.items || before).find((i) => i.source !== 'system');
    await post('/feed/dismiss', { id: victim.id });
    const { add: feedAdd } = require('../core/feed');
    const back = feedAdd({ ...victim, id: undefined });
    const after2 = (await (await fetch(base + '/feed?limit=400')).json());
    ok('feed: the X clears a card and it never comes back', !(after2.items || after2).some((i) => i.title === victim.title && i.source === victim.source) && back === null);
    {
      const soon = new Date(Date.now() + 90 * 60000); // due in 1.5 hours, with a "2 hours before" reminder
      const d = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
      const tm = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;
      await post('/tasks', { text: 'Print the workshop handouts', due: d, dueTime: tm, alerts: ['1d', '2h'] });
      const tl2 = await (await fetch(base + '/tasks')).json();
      const pt = tl2.find((t) => t.text === 'Print the workshop handouts');
      const fr = await (await fetch(base + '/feed?limit=400')).json();
      ok('task reminders: due time and chosen reminders are saved, and the nearest one fires', pt && pt.dueTime === tm && pt.alerts.join() === '1d,2h' && (fr.items || fr).some((i) => i.title === 'Due in 2 hours: Print the workshop handouts') && !(fr.items || fr).some((i) => i.title === 'Due in 1 day: Print the workshop handouts'));
    }
    const fd0 = await (await fetch(base + '/feed?limit=400')).json();
    ok('Insight cards: none from demo data', !(fd0.items || fd0).some((i) => i.category === 'INSIGHT' && !i.reminder));
    const tmr = new Date(Date.now() + 86400000); const tmrIso = `${tmr.getFullYear()}-${String(tmr.getMonth() + 1).padStart(2, '0')}-${String(tmr.getDate()).padStart(2, '0')}`;
    await post('/tasks', { text: 'Send the workshop recap', due: tmrIso });
    const fd1 = await (await fetch(base + '/feed?limit=400')).json();
    const rem = (fd1.items || fd1).filter((i) => i.category === 'INSIGHT');
    ok('Insight cards: a reminder when a task you created is due tomorrow (and not for demo tasks)', rem.some((i) => i.title === 'Due tomorrow: Send the workshop recap') && !rem.some((i) => /Write PRD/.test(i.title)));
    {
      // Editing a task, then ticking it off: its reminder card is marked Completed (Ryan, 2026-11-02).
      const t1 = (await (await fetch(base + '/tasks')).json()).find((t) => t.text === 'Send the workshop recap');
      await post('/tasks/update', { path: t1.path, line: t1.line, expect: t1.text, text: 'Send the workshop recap and slides', due: t1.due, dueTime: '15:00', alerts: [], priority: 'High', section: 'email' });
      const t2 = (await (await fetch(base + '/tasks')).json()).find((t) => t.text === 'Send the workshop recap and slides');
      const feA = await (await fetch(base + '/feed?limit=400')).json();
      ok('edit a task: text, time, priority and section change; its old reminder card is replaced', t2 && t2.dueTime === '15:00' && t2.priority === 'High' && t2.section === 'email' && t2.created && !feA.some((i) => i.title === 'Due tomorrow: Send the workshop recap') && feA.some((i) => i.title === 'Due tomorrow: Send the workshop recap and slides' && !i.completed));
      await post('/tasks/toggle', { path: t2.path, line: t2.line });
      const fd = await (await fetch(base + '/feed?limit=400')).json();
      const card = fd.find((i) => i.title === 'Due tomorrow: Send the workshop recap and slides');
      await post('/tasks/toggle', { path: t2.path, line: t2.line });
      const card2 = (await (await fetch(base + '/feed?limit=400')).json()).find((i) => i.title === card.title);
      ok('ticking a task off marks its reminder card Completed (and unticking undoes it)', card && card.completed === true && card2 && !card2.completed);
    }
    {
      // The counts above the brain map match the vault right now (Ryan, 2026-11-03).
      const s1 = await (await fetch(base + '/stats')).json();
      const ag = require('../core/agents');
      fs.writeFileSync(path.join(require('../core/vault').vaultRoot(), 'Knowledge', 'Stats check.md'), '# Stats check\n');
      const s2 = await (await fetch(base + '/stats')).json();
      ok('brain stats: notes leave out agents, skills and templates, skills leave out the index note, and new notes count at once',
        s1.skills === ag.skills().length && !ag.skills().some((k) => k.name === 'Skills Library') && s1.agents === ag.agents().length && s2.notes === s1.notes + 1 && s1.sources >= 0);
    }
    {
      // An older vault's Agents/Jarvis.md beside the new Maestro.md was a duplicate "Chief of staff" (Ryan, 2026-11-03).
      const root = require('../core/vault').vaultRoot();
      fs.writeFileSync(path.join(root, 'Agents', 'Jarvis.md'), '---\nname: Jarvis\nhandle: Jarvis\nrole: Chief of staff\n---\nYou are Jarvis.\n');
      require('../core/vault').invalidate();
      const list = require('../core/agents').agents();
      ok('agents: no duplicate Chief of staff from an old Jarvis file (moved to .maestro/old)', list.filter((a) => /chief of staff/i.test(a.role)).length === 1 && !fs.existsSync(path.join(root, 'Agents', 'Jarvis.md')) && fs.existsSync(path.join(root, '.maestro', 'old', 'Jarvis.md')));
    }
    {
      // "Set up my real connections", then the starter vault (which remembers demo settings): the choice holds.
      const kbm = require('../core/knowledge'), cfgm = require('../core/config');
      const keep = JSON.parse(JSON.stringify(cfgm.load()));
      await post('/data-mode', { mode: 'real' });
      kbm.connect({ type: 'markdown', path: require('../core/vault').vaultRoot() });
      const after = cfgm.load();
      ok('setup: the real-connections choice survives connecting a vault that remembers demo settings', after.dataMode === 'real' && !Object.values(after.connections.business || {}).some((x) => x.mode === 'demo'));
      await post('/data-mode', { mode: 'demo' });
      cfgm.update((c) => { c.connections = keep.connections; c.dataMode = keep.dataMode; c.demo = keep.demo; c.knowledge = keep.knowledge; c.vaultPath = keep.vaultPath; });
    }
    const rf = await post('/feed/refresh', {});
    ok('feed refresh button: pulls every source now and reports what came in', rf.ok === true && typeof rf.added === 'number' && typeof rf.errors === 'number');
    const hi = await post('/chat', { message: 'Hey Maestro' });
    ok('"Hey Maestro" opens with an upbeat greeting by name', /Ryan|there/.test(hi.reply) && /[!?]/.test(hi.reply) && hi.provider === 'greeting');
    const wy = await post('/chat', { message: 'Hey Maestro, what are you?' });
    ok('"What are you?" says the exact sentence Ryan gave, then one upbeat line', wy.reply.startsWith(require('../core/brain').WHAT_I_AM + ' ') && (wy.reply.match(/[.!?](\s|$)/g) || []).length === 2);
    const f1 = await post('/chat', { message: 'When is the design critique?' });
    const f2 = await post('/chat', { message: 'Tell me about this event', conversationId: f1.conversationId });
    ok('event details: "this event" means the one just discussed', /Design critique/i.test(f2.reply));
    const r1 = await post('/chat', { message: 'Hey Maestro, cancel the design critique' });
    const r2 = await post('/chat', { message: 'yes', conversationId: r1.conversationId });
    const after = await (await fetch(base + '/calendar?days=7')).json();
    ok('remove event: confirms first, then removes it', /^Remove "Design critique.*Say yes to confirm/.test(r1.reply) && /^Removed "Design critique/.test(r2.reply) && !after.some((e) => /Design critique/.test(e.title)));
    const fd = await (await fetch(base + '/feed?limit=200')).json();
    await post('/settings', { voice: { gender: 'female' } }).catch(() => null);
    const vcfg = (await (await fetch(base + '/state')).json()).config.voice;
    ok('voice: Man / Woman choice is saved', vcfg.gender === 'female' && vcfg.pause === 750);
    await post('/settings', { voice: { pause: 1200 } }).catch(() => null);
    const pcfg = (await (await fetch(base + '/state')).json()).config.voice;
    ok('voice: a pause chosen in Settings sticks', pcfg.pause === 1200);
    await post('/settings', { voice: { pause: 750 } }).catch(() => null);
    const fl = fd.items || fd;
    ok('remove event: no separate "Cancelled" card in the feed', !fl.some((i) => /^Cancelled: Design critique/.test(i.title)));
    const last = fl[fl.length - 1];
    await post('/feed/pin', { id: last.id, pinned: true });
    const pinned = await (await fetch(base + '/feed?limit=5')).json();
    ok('feed: a pinned card moves to the top', pinned[0].id === last.id && pinned[0].pinned === true);
    ok('feed: pins are backed up so they survive a reload or new download', (JSON.parse(fs.readFileSync(path.join(process.env.MAESTRO_HOME, 'pins.json'), 'utf8')).pins || []).some((p) => p.id === last.id));
    await post('/feed/pin', { id: last.id, pinned: false });
    const full = await post('/chat', { message: 'Hey Maestro, book a dentist appointment on Friday at 3:15pm at Smile Dental for 45 minutes, description: cleaning and checkup, in my Maestro calendar' });
    ok('create event: everything said up front creates it without more questions', /^Creating "Dentist appointment" for .*3:15 PM to 4:00 PM, at Smile Dental, in your Maestro calendar/.test(full.reply));
    const full2 = await post('/chat', { message: 'Schedule a lunch with Sarah on Thursday at 12:30 at The Keg, description: discuss the partnership deal' });
    ok('create event: full request only asks which calendar', /^Which calendar/.test(full2.reply));
    const wkFrom = new Date(); wkFrom.setDate(wkFrom.getDate() - 10); const wkTo = new Date(); wkTo.setDate(wkTo.getDate() + 20);
    const ranged = await (await fetch(`${base}/calendar?from=${wkFrom.toISOString()}&to=${wkTo.toISOString()}`)).json();
    ok('calendar API returns any date range (month and week views)', Array.isArray(ranged) && ranged.length > 0 && ranged.every((e) => new Date(e.end) >= wkFrom && new Date(e.start) <= wkTo));
    await post('/chat', { message: 'Add an event on Friday at 6pm called Brain Builder workshop at 100 Queen Street, description: tickets at https://lu.ma/brainbuilder, in my Maestro calendar' });
    const tix = await post('/chat', { message: 'Where can I get tickets to the Brain Builder workshop?' });
    ok('tickets: points to the ticket link in the event description', /^\*\*Get your ticket to the event from the \[Luma event page\]\(https:\/\/lu\.ma\/brainbuilder\)\.\*\* Click the link in the description\.$/.test(tix.reply));
    const about = await post('/chat', { message: 'What is the Sprint 24 Review about?' });
    ok('event "about" question: summary from its description, at most 2 sentences', /^\*\*Sprint 24 Review\*\*.*It covers demo/i.test(about.reply) && /What would you like to know specifically\?$/.test(about.reply) && (about.reply.replace(/\*\*[^*]+\*\*,[^:]+:/, '').replace(/\s*What would you like to know specifically\?$/, '').match(/[.!?](\s|$)/g) || []).length <= 2);
    const vague = await post('/chat', { message: 'Create a new calendar item' });
    ok('create event: "new calendar item" starts the questions instead of listing events', /What day/.test(vague.reply));
    const cal = await (await fetch(base + '/calendar?days=3')).json();
    ok('create meeting: event shows on the calendar', cal.some((e) => e.title === 'Pricing follow-up' && e.created));
    {
      // Ryan (2026-11-06): the ⋮ menu on event cards edits or deletes the event.
      const pf = cal.find((e) => e.title === 'Pricing follow-up');
      const card = (await (await fetch(base + '/feed?limit=400')).json()).find((i) => i.eventKey === pf.uid);
      const ref = { source: card ? card.source : pf.source, key: pf.uid, start: pf.start, cardId: card && card.id };
      const ns = new Date(+new Date(pf.start) + 3600e3).toISOString(), ne = new Date(+new Date(pf.end) + 3600e3).toISOString();
      const up = await post('/events/update', { ...ref, fields: { title: 'Pricing deep-dive', start: ns, end: ne, location: 'Room 4', description: 'Bring the numbers' } });
      const cal2 = await (await fetch(base + '/calendar?days=3')).json();
      const moved = cal2.find((e) => e.uid === pf.uid);
      const card2 = (await (await fetch(base + '/feed?limit=400')).json()).find((i) => card && i.id === card.id);
      ok('edit event: title, time, place and description change in the calendar, and its card says Updated', up.event && moved && moved.title === 'Pricing deep-dive' && moved.start === ns && moved.location === 'Room 4' && moved.notes === 'Bring the numbers' && (!card || (card2 && card2.title === 'Updated: Pricing deep-dive' && card2.eventStart === ns)));
      const bad = await post('/events/update', { ...ref, start: ns, fields: { start: ne, end: ns } });
      ok('edit event: an end before the start is refused', /end after it starts/.test(bad.error || ''));
      const del = await post('/events/delete', { ...ref, start: ns });
      const cal3 = await (await fetch(base + '/calendar?days=3')).json();
      ok('delete event: gone from the calendar, its card greyed', /Removed "Pricing deep-dive"/.test(del.done || '') && !cal3.some((e) => e.uid === pf.uid) && (!card || (await (await fetch(base + '/feed?limit=400')).json()).some((i) => i.id === card.id && i.removed)));
    }
    const w = require('../core/calwatch');
    {
      const far = new Date(Date.now() + 170 * 86400000), z = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, '');
      const got = require('../core/connectors').parseIcs(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:far1\nDTSTART:${z(far)}\nDTEND:${z(new Date(+far + 3600e3))}\nSUMMARY:Spring summit\nEND:VEVENT\nEND:VCALENDAR`);
      ok('calendars: events up to 6 months out are read', got.some((e) => e.uid === 'far1'));
    }
    const st = {}, ev = (uid, h, title) => ({ uid, title, start: new Date(Date.now() + h * 3600e3).toISOString(), end: new Date(Date.now() + (h + 1) * 3600e3).toISOString() });
    w.diff(st, 'k', 'business', 'system', w.snapshot([ev('a', 5, 'A')]));
    const n = w.diff(st, 'k', 'business', 'system', w.snapshot([ev('a', 7, 'A'), ev('b', 9, 'B')]));
    ok('calendar watcher: posts new events, but no new notification for a changed one', n === 1);
    const et = require('../core/feed').eventText({ description: 'Bring a laptop\\nTickets: <a href="https://lu.ma/x">https://lu.ma/x</a> Q&amp;A' });
    ok('event cards: description kept as plain text with line breaks', et === 'Bring a laptop\nTickets: https://lu.ma/x Q&A');
    const lk = require('../core/lookup');
    {
      const t0 = Date.now() + 3 * 86400000;
      const bb = { uid: 'bb', title: 'Brain Builder Workshop', start: new Date(t0).toISOString(), end: new Date(t0 + 7200000).toISOString(), attendees: [],
        description: 'Build your own second brain in one evening.\\nYou leave with a working assistant.\\n\\nSpeakers:\\n- Ryan W\\n- Dana Li\\n\\nBring a laptop.\\nTickets: https://lu.ma/bb' };
      const fc = { items: [], events: [bb], focus: bb };
      ok('event details: "tell me about this event" gives when, where and tickets, then offers an overview', /^\*\*The Brain Builder Workshop is being held on \w+day, \w+ \d+ from .+ to .+\.\*\* You can get tickets to it from the \[Luma event page\]\(https:\/\/lu\.ma\/bb\)\.\n\nWould you like me to give you an overview on topics, speakers and any other details\?$/.test(lk.answer('tell me about this event', fc)));
      ok('event details: "yes" gives the overview with speakers', /\*\*Speakers:\*\* Ryan W and Dana Li/.test(lk.answer('yes', { ...fc, offered: true })));
      {
        const bm = { ...bb, description: bb.description.replace('Bring a laptop.', 'Bring a laptop.\\nDoors open at 5:30.\\nSeating is limited.\\nSlides are shared after.\\nStay for demos.\\nThe venue is accessible.') };
        const fm = { items: [], events: [bm], focus: bm };
        ok('event details: "tell me more" gives the overview, then each next part of the description, then says it is done',
          /\*\*Speakers:\*\*/.test(lk.answer('tell me more', fm)) && /Doors open at 5:30\..*Want me to keep going\?$/s.test(lk.answer('tell me more', { ...fm, moreStep: 1 }))
          && /venue is accessible\..*covers everything/s.test(lk.answer('what else?', { ...fm, moreStep: 2 })) && /That's everything/.test(lk.answer('keep going', { ...fm, moreStep: 3 }))
          && !/More on/.test(lk.answer('and who is speaking?', { ...fm, moreStep: 1 })));
      }
      ok('event details: follow-ups come from the description', /Ryan W and Dana Li/.test(lk.answer('who is speaking?', fc)) && /Bring a laptop/.test(lk.answer('what should I bring to it?', fc)) && lk.answer('prepare an update for stakeholders', fc) === null);
    }
    const evs = [ev('x1', 20, 'Board prep'), ev('x2', 30, 'Dinner with Sam'), ev('x3', 200, 'Kids soccer practice')];
    ok('event questions: "when is <event>" answers "The <event> is happening <day> at <start> to <end>…" then asks what else', /^\*\*The Board prep is happening (today|tomorrow|on \w+).* at .+ to .+\.\*\* What else would you like to know about the event\?$/.test(lk.answer('When is board prep?', { items: [], events: evs })) && /^\*\*The Kids soccer practice is happening/.test(lk.answer('what time is kids soccer', { items: [], events: evs })));
    const up = [ev('c', 3, 'C'), ev('m', 24 * 150, 'Five months out'), ev('d', 24 * 200, 'Far away')];
    ok('calendar watcher: events in the next 6 months become feed cards once', w.upcoming('business', 'system', up) === 2 && w.upcoming('business', 'system', up) === 0);
    {
      // Ryan (2026-11-04): the alerts set on calendar events post feed notifications at the same time.
      const cn = require('../core/connectors');
      const t0 = new Date(Date.now() + 10 * 60000); const z = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, '');
      const ics = `BEGIN:VCALENDAR\nX-WR-CALNAME:Work\nBEGIN:VEVENT\nUID:al1\nDTSTART:${z(t0)}\nDTEND:${z(new Date(+t0 + 3600e3))}\nSUMMARY:Alert test workshop\nDESCRIPTION:The real description\nBEGIN:VALARM\nACTION:DISPLAY\nDESCRIPTION:Reminder\nTRIGGER:-PT15M\nEND:VALARM\nBEGIN:VALARM\nTRIGGER;RELATED=START:-P1D\nEND:VALARM\nEND:VEVENT\nEND:VCALENDAR`;
      const [ae] = cn.parseIcs(ics);
      ok('calendar alerts: read from the event (15 min and 1 day before), event description kept', ae && ae.alarms.length === 2 && ae.alarms[0].before === 900e3 && ae.alarms[1].before === 86400e3 && ae.description === 'The real description');
      const first = w.alerts('business', 'icalendar', [ae]), again = w.alerts('business', 'icalendar', [ae]);
      const card = require('../core/feed').readAll().find((i) => i.alert && i.eventKey === 'al1');
      const early = w.alerts('business', 'icalendar', [{ ...ae, uid: 'al2', alarms: [{ before: 5 * 60000 }] }]);
      ok('calendar alerts: one feed notification when the alert is due, none before', first === 1 && again === 0 && early === 0 && card && /^In (9|10) minutes: Alert test workshop$/.test(card.title) && card.calendarName === 'Work' && card.eventType === 'workshop');
    }
    {
      // Ryan (2026-11-04): a changed time must show on refresh, and new-event cards carry the calendar's name.
      const fd = require('../core/feed');
      const e1 = { ...ev('rw', 10, 'Workshop rehearsal'), calendarName: 'Work' };
      const st2 = {};
      w.diff(st2, 'k2', 'business', 'icalendar', w.snapshot([]));
      w.diff(st2, 'k2', 'business', 'icalendar', w.snapshot([e1]));
      w.upcoming('business', 'icalendar', [e1], new Set(['rw']));
      const newCard = fd.readAll().find((i) => i.source === 'icalendar' && i.eventKey === 'rw' && /^New: /.test(i.title));
      const moved = { ...e1, start: new Date(Date.parse(e1.start) + 1800e3).toISOString(), end: new Date(Date.parse(e1.end) + 3600e3).toISOString() };
      w.upcoming('business', 'icalendar', [e1]);
      w.syncCards('icalendar', [moved]);
      w.upcoming('business', 'icalendar', [moved]);
      const cards = fd.readAll().filter((i) => i.source === 'icalendar' && i.eventKey === 'rw' && !i.removed);
      const hm = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      ok('calendar refresh: new-event cards are labelled with their calendar, and cards follow a changed time', newCard && newCard.calendarName === 'Work'
        && cards.length === 2 && cards.every((c) => c.eventStart === moved.start && c.quote.includes(hm(moved.start)) && c.quote.includes(hm(moved.end))));
      ok('calendar refresh: a changed event is relabelled "Updated: <event>" instead of a new card', cards.every((c) => c.title === 'Updated: Workshop rehearsal' && c.updated)
        && !fd.readAll().some((i) => i.eventKey === 'rw' && /^(Moved|Time changed): /.test(i.title)));
      const same = { ...ev('rs', 12, 'Steady sync'), calendarName: 'Work' };
      w.upcoming('business', 'icalendar', [same]); w.syncCards('icalendar', [same]); w.syncCards('icalendar', [same]);
      const sc = fd.readAll().find((i) => i.eventKey === 'rs');
      ok('calendar refresh: an unchanged event keeps its card as it was', sc && sc.title === 'Steady sync' && !sc.updated);
    }
  }
  {
    // Ryan (2026-11-04): calendar cards are labelled Meeting / Event / Conference / Workshop / Call from their words,
    // can be switched from the label, and the list of categories can be edited.
    const et = require('../core/eventtypes');
    ok('event categories: read from the title and description', et.classify({ title: 'AI Brain Builder Workshop' }) === 'workshop' && et.classify({ title: 'Acme renewal call' }) === 'call'
      && et.classify({ title: 'Disrupt', description: 'The startup conference of the year' }) === 'conference' && et.classify({ title: 'Sprint review' }) === 'meeting' && et.classify({ title: 'Halloween party' }) === 'event');
    const feedNow = await (await fetch(base + '/feed?limit=200')).json();
    const items = feedNow.items || feedNow;
    const mtg = items.find((i) => i.category === 'MEETING');
    const types = await (await fetch(base + '/event-types')).json();
    const other = types.find((t) => t.id !== (mtg && mtg.eventType));
    const sw = mtg && other ? await post('/feed/event-type', { id: mtg.id, type: other.id }) : null;
    const after = (await (await fetch(base + '/feed?limit=200')).json());
    const again = (after.items || after).find((i) => i.id === (mtg && mtg.id));
    ok('event categories: calendar cards carry one, and the dropdown choice sticks', !!(mtg && mtg.eventType && sw && sw.ok && again && again.eventType === other.id));
    const saved = await post('/event-types', { types: [...types.map((t) => (t.id === 'call' ? { ...t, name: 'Phone call' } : t)), { name: 'Webinar', color: '#123456', words: 'webinar, livestream' }].filter((t) => t.id !== 'conference') });
    ok('event categories: rename, add and remove', saved.some((t) => t.name === 'Phone call' && t.id === 'call') && saved.some((t) => t.id === 'webinar' && t.words.includes('livestream')) && !saved.some((t) => t.id === 'conference'));
    await post('/event-types', { types: et.DEFAULTS });
  }
  {
    // Ryan (2026-11-04): Projects page: create a project with its details, add tasks to it, and the card shows both.
    const made = await post('/projects', { name: 'Selftest Rebuild', client: 'Acme Corp', description: 'A [[test]] project.', start: '2026-11-10', completion: '2027-02-28', milestones: [{ name: 'Beta', date: '2027-01-20' }, { name: 'Design sign-off', date: '2026-12-05' }], tasks: ['Kickoff call'] });
    await post('/projects/task', { path: made.path, text: 'Send the SOW', due: '2026-11-12', priority: 'High' });
    const all = await (await fetch(base + '/projects')).json();
    const pr = all.find((x) => x.path === made.path);
    ok('projects: created with client, dates and milestones in date order', pr && pr.client === 'Acme Corp' && pr.start === '2026-11-10' && pr.completion === '2027-02-28' && pr.milestones.map((m) => m.name).join() === 'Design sign-off,Beta' && pr.made && pr.description === 'A test project.');
    ok('projects: tasks attach to the project and show on its card', pr && pr.taskList.length === 2 && pr.taskList.some((t) => t.text === 'Send the SOW' && t.due === '2026-11-12' && t.section === 'projects'));
    const ed = await post('/projects/update', { ...pr, client: 'Acme Inc' });
    ok('projects: editing keeps the tasks', ed.client === 'Acme Inc' && ed.taskList.length === 2);
    const st = await (await fetch(base + '/state')).json();
    const pcard = (await (await fetch(base + '/feed?limit=400')).json()).find((i) => i.externalId === 'project:' + made.path);
    ok('projects: a new project gets a card in the Intelligence Feed, kept current', pcard && pcard.category === 'PROJECT' && pcard.title === 'New project: Selftest Rebuild' && /Client: Acme Inc/.test(pcard.quote) && /2 open tasks/.test(pcard.summary));
    ok('projects: new projects are listed for the brain map', st.projects.some((x) => x.path === made.path && x.made));
  }
  {
    // Ryan (2026-11-04): Maestro looks up projects, ranks what matters most, flags what's in the way of your goals,
    // and reminds you of tasks and milestones at the times you pick in Settings → Reminders.
    const dd = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const lp = await post('/projects', { name: 'Selftest Launchpad', client: 'Globex', start: dd(-20), completion: dd(10), milestones: [{ name: 'Selftest Gate', date: dd(2) }], tasks: ['Draft the launch plan'] });
    await post('/projects/task', { path: lp.path, text: 'Fix the payment bug', due: dd(-1), priority: 'High' });
    const set = await post('/settings', { reminders: { tasks: ['8h', 'bogus'], milestones: ['1w'] } });
    const rs = (await (await fetch(base + '/state')).json()).config.reminders;
    ok('reminder times: saved from Settings (unknown ones dropped)', set.ok && rs.tasks.join() === '8h' && rs.milestones.join() === '1w');
    const fdm = await (await fetch(base + '/feed?limit=400')).json();
    ok('milestone reminder: a card when a milestone is inside your reminder time, said in real days', fdm.some((i) => i.title === 'Milestone in 2 days: Selftest Gate' && i.reminder && /Selftest Launchpad/.test(i.quote)));
    const first = await post('/chat', { message: 'What should I work on first?' });
    ok('focus: the most important task first, with why', /^Start with \*\*Fix the payment bug\*\* \(overdue since yesterday, high priority/.test(first.reply));
    const risk = await post('/chat', { message: "What's pressing that could stop me hitting my goals?" });
    ok('focus: what could get in the way of your goals', /could get in the way of your goals/.test(risk.reply) && /Selftest Gate for Selftest Launchpad is in 2 days/.test(risk.reply) && /Best place to start/.test(risk.reply));
    const look = await post('/chat', { message: 'How is the Launchpad project going?' });
    ok('focus: look up a project by name', /\*\*Selftest Launchpad\*\* for Globex/.test(look.reply) && /Next milestone: Selftest Gate, in 2 days/.test(look.reply) && /Fix the payment bug/.test(look.reply));
    await post('/settings', { reminders: { tasks: [], milestones: ['1w', '1d'] } });
    // Ryan (2026-11-04): mark a project complete (and reopen it); its feed card follows.
    const fin = await post('/projects/complete', { path: lp.path, done: true });
    const fcard = (await (await fetch(base + '/feed?limit=400')).json()).find((i) => i.externalId === 'project:' + lp.path);
    const listed = await post('/chat', { message: 'What projects do I have?' });
    ok('projects: mark complete sets the status, updates its card and drops it from active projects', fin.completed && fin.status === 'complete' && fcard && fcard.completed && fcard.actions.includes('Reopen project') && !/Selftest Launchpad/.test(listed.reply));
    const re = await post('/projects/complete', { path: lp.path, done: false });
    ok('projects: reopen', !re.completed && re.status === 'active' && re.taskList.length === 2);
  }
  {
    // Ryan (2026-11-06): signed in to Google or Microsoft, edits/deletes/new events go to the real calendar.
    // Google Calendar and Microsoft Graph are stood in for by small fakes here.
    const realFetch = global.fetch;
    const at = new Date(Date.now() + 2 * 86400000); at.setHours(10, 0, 0, 0);
    const g = { e1: { id: 'e1', summary: 'Design review', start: { dateTime: at.toISOString() }, end: { dateTime: new Date(+at + 3600e3).toISOString() }, location: 'HQ' } };
    const ms = { m1: { id: 'm1', subject: 'Budget sync', start: { dateTime: new Date(+at + 7200e3).toISOString().replace('Z', '') }, end: { dateTime: new Date(+at + 9000e3).toISOString().replace('Z', '') }, location: { displayName: '' }, body: { content: '' }, type: 'singleInstance' } };
    const calls = [];
    const json = (o, status = 200) => new Response(o == null ? null : JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (!/googleapis\.com|graph\.microsoft\.com|login\.microsoftonline/.test(u)) return realFetch(url, opts);
      const m = opts.method || 'GET', body = opts.body ? JSON.parse(opts.body) : null;
      calls.push(`${m} ${u.split('?')[0]}`);
      if (/calendarList/.test(u)) return json({ items: [{ id: 'primary@x', summary: 'Ryan', accessRole: 'owner', primary: true }] });
      let mm = u.match(/calendars\/[^/]+\/events\/([^?]+)/);
      if (mm && m === 'PATCH') { Object.assign(g[mm[1]], body); return json(g[mm[1]]); }
      if (mm && m === 'DELETE') { delete g[mm[1]]; return new Response(null, { status: 204 }); }
      if (/calendars\/[^/]+\/events/.test(u) && m === 'POST') { const id = 'new' + Object.keys(g).length; g[id] = { id, ...body }; return json(g[id]); }
      if (/calendars\/[^/]+\/events/.test(u)) return json({ items: Object.values(g) });
      if (/me\/calendars\?/.test(u)) return json({ value: [{ id: 'cal1', name: 'Calendar', canEdit: true, isDefaultCalendar: true }] });
      if (/calendarView/.test(u)) return json({ value: Object.values(ms) });
      mm = u.match(/me\/events\/([^?]+)/);
      if (mm && m === 'PATCH') { Object.assign(ms[mm[1]], body); return json(ms[mm[1]]); }
      return json({ error: { message: 'not faked: ' + u } }, 400);
    };
    let saved = {};
    try {
      const cfgm = require('../core/config');
      const prof = cfgm.load().profile;
      saved = JSON.parse(JSON.stringify({ gcal: cfgm.load().connections[prof].gcal, outlook: cfgm.load().connections[prof].outlook }));
      cfgm.update((c) => { for (const [id, prov] of [['gcal', 'google'], ['outlook', 'microsoft']]) c.connections[prof][id] = { mode: 'live', fields: {}, oauth: { provider: prov, refresh: 'r', access: 'a', expires: Date.now() + 3600e3, email: 'ryan@example.com' } }; });
      require('../core/cloudcal').forget();
      const st = await (await fetch(base + '/state')).json();
      const pub = st.config.connections[prof].gcal.oauth;
      ok('two-way sync: sign-in tokens never reach the browser', pub && pub.signedIn && pub.email === 'ryan@example.com' && !pub.refresh && !pub.access);
      const cal = await (await fetch(base + '/calendar?days=5')).json();
      const ge = cal.find((e) => e.uid === 'e1'), me = cal.find((e) => e.uid === 'm1');
      ok('two-way sync: Google and Outlook events are read through their APIs', ge && ge.source === 'gcal' && ge.provider === 'google' && me && me.source === 'outlook' && me.title === 'Budget sync');
      const ns = new Date(+at + 3600e3).toISOString(), ne = new Date(+at + 7200e3).toISOString();
      const up = await post('/events/update', { source: 'gcal', key: 'e1', start: ge.start, fields: { title: 'Design review v2', start: ns, end: ne, location: 'Room 9', description: 'Agenda' } });
      ok('two-way sync: an edit updates Google Calendar itself', g.e1 && g.e1.summary === 'Design review v2' && g.e1.start.dateTime === ns && g.e1.location === 'Room 9' && /Google Calendar/.test(up.note || '') && calls.some((c) => /^PATCH .*events\/e1$/.test(c)));
      await post('/events/update', { source: 'outlook', key: 'm1', start: me.start, fields: { title: 'Budget sync (moved)' } });
      ok('two-way sync: an edit updates Outlook itself', ms.m1.subject === 'Budget sync (moved)' && calls.some((c) => /^PATCH .*me\/events\/m1$/.test(c)));
      const tg = await require('../core/events').targets(prof);
      const made = await require('../core/events').create({ title: 'Kickoff', start: new Date(+at + 86400e3).toISOString(), minutes: 30 }, { profile: prof, target: tg.targets.find((t) => t.id.startsWith('cloud:gcal:')).id });
      ok('two-way sync: new events go straight into Google Calendar', made.event.cloud && Object.values(g).some((x) => x.summary === 'Kickoff') && /Google Calendar/.test(made.where));
      const del = await post('/events/delete', { source: 'gcal', key: 'e1', start: ns });
      ok('two-way sync: delete removes it from Google Calendar', !g.e1 && /Removed "Design review v2"/.test(del.done || ''));
    } finally {
      global.fetch = realFetch;
      const cfgm = require('../core/config');
      cfgm.update((c) => { const p = c.connections[c.profile]; for (const k of ['gcal', 'outlook']) { if (saved[k]) p[k] = saved[k]; else delete p[k]; } });
      require('../core/cloudcal').forget();
    }
  }
  const brief = await post('/chat', { message: 'Brief me on my day' });
  ok('daily brief: overview with counts, then a question', /You've got \d+ meetings?/.test(brief.reply) && brief.reply.split('\n')[0].split(/[.!?] /).length <= 2 && /hear more about/.test(brief.reply));
  const more = await post('/chat', { message: 'tell me about the calls' });
  ok('daily brief follow-up: calls', /\d+ calls?\b/.test(more.reply) && /Alex Chen/.test(more.reply));
  const call = await post('/chat', { message: 'When did Alex call me?' });
  ok('direct question: when did Alex call', /Alex Chen called you today at/.test(call.reply));
  const meet = await post('/chat', { message: 'When is my meeting with Sarah?' });
  ok('direct question: next meeting with a person', /next meeting with Sarah/.test(meet.reply));
  const time = await post('/chat', { message: 'What time is it?' });
  ok('everyday question: what time is it', /^It's \d/.test(time.reply));
  const huh = await post('/chat', { message: 'what is the airspeed of a penguin' });
  const hey = await post('/chat', { message: 'Hey Maestro, what time is it?' });
  ok('"Hey Maestro" is ignored', /^It's \d/.test(hey.reply));
  const gm = await post('/chat', { message: 'Good morning Maestro' });
  ok('greeting has personality', /Ryan|good morning/i.test(gm.reply) && !/understand/.test(gm.reply));
  const stress = await post('/chat', { message: 'I am stressed out' });
  ok('conversation: "I am stressed out" gets empathy, not a status report', /carry/.test(stress.reply) && !/v2\.4|Pull requests/.test(stress.reply));
  const hi = await post('/chat', { message: 'Hey Maestro, I am at my Brain Builder event, say hi to everyone' });
  const bye = await post('/chat', { message: 'say goodbye to everyone', conversationId: hi.conversationId });
  ok('conversation: greets the room and remembers the event', /^Hi everyone, and welcome to Brain Builder!/.test(hi.reply) && /Brain Builder/.test(bye.reply));
  const about = await post('/chat', { message: 'Hey Maestro, tell everyone a bit about yourself' });
  ok('conversation: "tell everyone about yourself" is 2 sentences', /second brain/.test(about.reply) && about.reply.split(/(?<=[.!?])\s+(?=[A-Z])/).length <= 2);
  const joke = await post('/chat', { message: 'tell me a joke' });
  const crisis = await post('/chat', { message: "I don't want to live anymore" });
  ok('conversation: jokes, and crisis messages point to help', !/lost me/.test(joke.reply) && /988/.test(crisis.reply));
  ok('unknown question gets a short reply', huh.reply === "I didn't quite catch that, there's still a few things I need to be trained on." && huh.reply.length < 160);
  const none = await post('/chat', { message: 'When did Bob call me?' });
  ok('direct question: says when nothing matches', /No calls from Bob/.test(none.reply));
  const mem = await post('/chat', { message: 'Remember that the workshop is on Thursday' });
  ok('memory protocol writes to Memory Log', fs.readFileSync(path.join(vaultCopy, 'Memory', 'Memory Log.md'), 'utf8').includes('workshop is on Thursday'));
  await post('/chat', { message: 'Add a task to send the survey' });
  ok('task added to vault', fs.readFileSync(path.join(vaultCopy, 'Tasks', 'Inbox.md'), 'utf8').includes('send the survey'));

  console.log('\nPacks, connections, workflows');
  const inst = await post('/packs/install', { id: 'product-manager' });
  ok('PM pack installs', inst.copied && inst.copied.length > 3);
  ok('@Product agent added', (await get('/state')).agents.some((a) => a.handle === 'Product'));
  const con = await post('/connections', { id: 'gmail', profile: 'business', mode: 'demo' });
  ok('connect demo source', con.ok);
  await post('/profile', { profile: 'personal' });
  const pfeed = await get('/feed');
  ok('personal profile feed is personal only', pfeed.length > 0 && pfeed.every((i) => i.profile === 'personal'));
  await post('/profile', { profile: 'business' });
  const wf = await post('/workflows/run', { id: 'morning_brief' });
  ok('morning brief workflow writes Daily note', wf.notePath && fs.existsSync(path.join(vaultCopy, wf.notePath)));
  const tri = await post('/workflows/run', { id: 'inbox_triage' });
  require('../core/feed').add({ source: 'system', category: 'BRIEF', title: 'Inbox triage ready', workflow: 'inbox_triage', externalId: 'old-triage' });
  const fdT = await (await fetch(base + '/feed?limit=400')).json();
  ok('Inbox triage posts no feed card, and old ones are gone', tri.notePath && !tri.item && !fdT.some((i) => /inbox triage/i.test(i.title)));
  const zip = await fetch(base + '/claude-skills/download');
  const buf = Buffer.from(await zip.arrayBuffer());
  ok('Claude Skills export is a zip', buf.slice(0, 2).toString() === 'PK' && buf.length > 500);
  const kb0 = await get('/knowledge');
  ok('knowledge base starts unconnected so first run asks', kb0.connected === false && kb0.notes > 10);
  const otherVault = path.join(tmp, 'Other Vault');
  const bad = await post('/knowledge/connect', { type: 'markdown', path: otherVault });
  ok('knowledge base rejects a missing folder', /does not exist/.test(bad.error || ''));
  const kb1 = await post('/knowledge/connect', { type: 'markdown', path: otherVault, create: true, seed: true });
  ok('connect a Markdown folder and seed Maestro folders', kb1.connected && fs.existsSync(path.join(otherVault, 'Memory', 'About Me.md')));
  const kb2 = await post('/knowledge/connect', { type: 'obsidian', path: vaultCopy, seed: false });
  ok('switch back to the Obsidian vault', kb2.connected && kb2.path === vaultCopy && kb2.isObsidian);
  const un = await post('/packs/uninstall', { id: 'product-manager' });
  ok('PM pack uninstalls', un.removed > 3);
  server.close();

  console.log('\nClaude Desktop MCP server');
  await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'mcp', 'server.js')], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    const replies = {};
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) { const m = JSON.parse(line); replies[m.id] = m; } }
    });
    const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'selftest', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_brain', arguments: { query: 'payment sdk' } } });
    send({ jsonrpc: '2.0', id: 4, method: 'prompts/list' });
    send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'maestro_brief', arguments: {} } });
    send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_agent', arguments: { handle: 'Maestro' } } });
    send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'add_feed_items', arguments: { source: 'slack', items: [{ id: 'st-1', title: 'Alex Chen in #launch', text: 'Can you approve the copy?' }] } } });
    send({ jsonrpc: '2.0', id: 8, method: 'prompts/get', params: { name: 'sync-claude-sources' } });
    setTimeout(() => {
      ok('initialize handshake', replies[1] && replies[1].result && replies[1].result.serverInfo.name === 'maestro');
      ok('tools listed', replies[2] && replies[2].result.tools.length >= 15);
      ok('search_brain finds notes', replies[3] && /Sprint 24/.test(replies[3].result.content[0].text));
      ok('skills + agents exposed as prompts', replies[4] && replies[4].result.prompts.some((p) => p.name.startsWith('skill-')) && replies[4].result.prompts.some((p) => p.name.startsWith('agent-')));
      ok('maestro_brief returns context', replies[5] && /CALENDAR/.test(replies[5].result.content[0].text));
      ok('get_agent loads an agent', replies[6] && /chief of staff/i.test(replies[6].result.content[0].text));
      ok('add_feed_items puts Claude connector activity in the feed', replies[7] && /Added 1 new item/.test(replies[7].result.content[0].text));
      ok('sync prompt for Claude-connected sources', replies[8] && /add_feed_items|No sources/.test(replies[8].result.messages[0].content.text));
      child.kill();
      resolve();
    }, 2500);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
