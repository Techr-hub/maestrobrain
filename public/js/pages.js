// All non-dashboard pages: Agents, MCP Connections, Tasks, Calendar, Knowledge, Skills & Packs,
// Conversations, Workflows, Settings, plus the first-run onboarding.
import { icon, CATEGORY } from './icons.js';
import { renderMarkdown, esc } from './md.js';
import { S, api, refreshState, toast, timeAgo, modal, modalHead, openNote, wireWikilinks, obsidianUrl } from './core.js';
import { voiceSupported } from './voice.js';

const head = (title, sub, actions = '') => `<div class="page-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div style="display:flex;gap:8px;flex-wrap:wrap">${actions}</div></div>`;
const cfg = () => S.state.config;
const profileName = () => (cfg().profile === 'personal' ? 'Personal' : 'Business');

// ================================================================ AGENTS
async function agentsPage(el, { navigate, afterChange, ask }) {
  await refreshState();
  const st = S.state;
  const full = await Promise.all(st.agents.map(async (a) => ({ ...a, note: await api('/vault/note?path=' + encodeURIComponent(a.path)).catch(() => null) })));
  el.innerHTML = head('Agents', 'Specialists that live in your brain. Each agent is a Markdown file in <code>Agents/</code> with its own instructions and model, and every agent reads the same knowledge base, memory and feed. @mention one in chat, or load it in Claude Desktop from the <b>+</b> menu.',
    `<button class="btn ghost" id="imp">${icon('upload')} Import .md</button><button class="btn primary" id="new">${icon('plus')} New agent</button><input type="file" id="impf" accept=".md" hidden>`) +
    `<div class="grid">${full.map((a) => `
      <div class="card accent" style="--c:${esc(a.color)};border-top-color:${esc(a.color)}">
        <h4><span class="agent-icon" style="--c:${esc(a.color)};width:34px;height:34px;font-size:18px">${icon(a.icon === 'search' ? 'search' : a.icon === 'heart' ? 'heart' : a.icon === 'sparkles' ? 'sparkles' : 'bot')}</span><div>@${esc(a.handle)}<div class="meta">${esc(a.role || a.name)}</div></div></h4>
        <p>${esc(a.description || '')}</p>
        <div class="row">${a.skills.slice(0, 4).map((s) => `<span class="tag">${esc(s)}</span>`).join('')}${a.skills.length > 4 ? `<span class="tag">+${a.skills.length - 4}</span>` : ''}</div>
        <div class="meta">${icon('cpu')} ${a.provider === 'default' ? 'Uses the brain’s AI engine' : esc(a.provider + (a.model ? ' · ' + a.model : ''))}${a.pack ? ' · from ' + esc(a.pack) + ' pack' : ''}</div>
        <div class="row"><button class="btn small" data-chat="${esc(a.handle)}">${icon('message-circle')} Chat</button><button class="btn small ghost" data-open="${esc(a.path)}">${icon('file-text')} Instructions</button><a class="btn small ghost" href="${obsidianUrl(a.path)}">${icon('external-link')}</a></div>
      </div>`).join('')}</div>
    <div class="section-title">Third-party agents</div>
    <div class="callout">${'<span class="big-icon">' + icon('link') + '</span>'}<div><h4>Bring in Hermes, ChatGPT, Gemini or any agent server</h4>
      <p>Create an agent and set its engine. For <b>Hermes</b> run it locally with Ollama (<code>ollama run hermes3</code>) or point at any OpenAI-compatible endpoint (OpenRouter, Nous Portal, LM Studio, a Hermes agent server). The agent still gets your memory, notes and feed as context.</p></div></div>`;
  el.querySelector('#new').onclick = () => agentForm(afterChange, () => agentsPage(el, { navigate, afterChange, ask }));
  el.querySelector('#imp').onclick = () => el.querySelector('#impf').click();
  el.querySelector('#impf').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = await api('/import', { filename: f.name, content: await f.text() });
    toast(`Imported ${r.kind}: ${r.path}`); await afterChange({ feed: false }); agentsPage(el, { navigate, afterChange, ask });
  };
  el.querySelectorAll('[data-chat]').forEach((b) => b.onclick = () => { S.agent = b.dataset.chat; navigate('dashboard'); afterChange({ graph: false, feed: false }); });
  el.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => openNote(b.dataset.open));
}

function agentForm(afterChange, done) {
  modal(`${modalHead('New agent', 'Saved as a Markdown file in Agents/. Edit it any time in Obsidian.')}
    <div class="two-col"><div class="field"><label>Name</label><input class="input" id="a-name" placeholder="Marketing"></div>
    <div class="field"><label>Handle</label><input class="input" id="a-handle" placeholder="Marketing"></div></div>
    <div class="two-col"><div class="field"><label>Role</label><input class="input" id="a-role" placeholder="Growth marketer"></div>
    <div class="field"><label>Colour</label><input class="input" id="a-color" type="color" value="#ff7a45" style="height:40px;padding:4px"></div></div>
    <div class="field"><label>When to use it</label><input class="input" id="a-desc" placeholder="Campaign plans, launch copy, channel analytics"></div>
    <div class="two-col"><div class="field"><label>AI engine</label><select class="input" id="a-prov">
      <option value="default">Brain default</option><option value="anthropic">Claude</option><option value="openai">ChatGPT</option><option value="gemini">Gemini</option><option value="compatible">Third-party / Hermes (OpenAI-compatible)</option></select></div>
    <div class="field"><label>Model (optional)</label><input class="input" id="a-model" placeholder="e.g. hermes3, gpt-5, claude-opus-5-5"></div></div>
    <div class="field" id="a-base-wrap" hidden><label>Endpoint base URL</label><input class="input" id="a-base" placeholder="http://localhost:11434/v1"><span class="help">Ollama, LM Studio, OpenRouter (https://openrouter.ai/api/v1) or your Hermes agent server.</span></div>
    <div class="field"><label>Instructions</label><textarea class="input" id="a-prompt" placeholder="You are Marketing, a growth specialist in my second brain. Focus on…"></textarea></div>
    <div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="a-save">${icon('save')} Create agent</button></div>`, {
    onMount: (m, close) => {
      m.querySelector('#a-prov').onchange = (e) => { m.querySelector('#a-base-wrap').hidden = e.target.value !== 'compatible'; };
      m.querySelector('#a-save').onclick = async () => {
        const v = (id) => m.querySelector(id).value.trim();
        if (!v('#a-name')) return toast('Give the agent a name', 'error');
        const r = await api('/agents', { name: v('#a-name'), handle: v('#a-handle') || v('#a-name').split(' ')[0], role: v('#a-role'), description: v('#a-desc'), color: v('#a-color'), provider: v('#a-prov'), model: v('#a-model'), baseUrl: v('#a-base'), prompt: v('#a-prompt') });
        toast('Agent created: ' + r.path); close(); await afterChange({ feed: false }); done();
      };
    },
  });
}

// ================================================================ CONNECTIONS
async function connectionsPage(el, ctx) {
  await refreshState();
  const st = S.state, prof = cfg().profile;
  const cd = st.claudeDesktop;
  const card = (c) => {
    const s = c.status[prof];
    const tag = s ? (s.mode === 'live' ? `<span class="tag live">● Live</span>` : `<span class="tag demo">● Demo data</span>`) : `<span class="tag off">Not connected</span>`;
    const canLive = c.live && c.live.includes('dashboard');
    return `<div class="card accent" style="--c:${c.color};border-top-color:${s ? c.color : 'var(--line)'}">
      <h4><span class="agent-icon" style="--c:${c.color};width:34px;height:34px;font-size:18px">${icon(c.icon)}</span><div>${esc(c.name)}<div class="meta">${esc(CATEGORY[c.category] ? c.category : '')}</div></div></h4>
      <p>${esc(c.description)}</p>
      <div class="row">${tag}${canLive ? '<span class="tag">Live-capable</span>' : '<span class="tag">Live via Claude</span>'}</div>
      ${s && s.message ? `<div class="meta">${esc(s.message)}</div>` : ''}
      <div class="row">${s ? `<button class="btn small ghost" data-cfg="${c.id}">${icon('settings')} Configure</button><button class="btn small danger" data-off="${c.id}">Disconnect</button>` : `<button class="btn small primary" data-cfg="${c.id}">${icon('plug')} Connect</button>`}</div>
    </div>`;
  };
  const foundation = st.connectors.filter((c) => c.group === 'foundation');
  const packIds = new Set(st.packs.filter((p) => p.installed).flatMap((p) => p.connectors || []));
  const packConns = st.connectors.filter((c) => c.group === 'pack');
  el.innerHTML = head('MCP Connections', `Connect the sources your brain listens to. Connected sources stream structured notifications into the Intelligence Feed and become context for every answer. You are editing the <b>${profileName()}</b> profile: switch profiles at the top to connect personal accounts separately.`) +
    `<div class="callout ${cd.registered ? 'ok' : ''}"><span class="big-icon">${icon(cd.registered ? 'check' : 'sparkles')}</span><div style="flex:1">
      <h4>${cd.registered ? 'Maestro is connected to Claude Desktop' : 'Connect your brain to Claude Desktop'}</h4>
      <p>${cd.registered ? 'Claude can search your vault, read the feed, check your calendar, manage tasks, remember facts and run your skills. Restart Claude Desktop after changes.' : 'This adds Maestro as an MCP server in Claude Desktop so Claude becomes the reasoning engine for your brain. Your email, calendar and Slack connectors in Claude Desktop then work alongside it.'}</p>
      <p class="meta" style="margin-top:6px">Config: <code>${esc(cd.configPath)}</code></p></div>
      <button class="btn ${cd.registered ? 'ghost' : 'primary'}" id="cd-reg">${icon('plug')} ${cd.registered ? 'Re-connect' : 'Connect to Claude Desktop'}</button></div>
    <div class="section-title">Foundation · every brain</div><div class="grid">${foundation.map(card).join('')}</div>
    <div class="section-title">Role pack tools</div>
    ${packConns.some((c) => packIds.has(c.id) || c.status[prof]) ? `<div class="grid">${packConns.filter((c) => packIds.has(c.id) || c.status[prof]).map(card).join('')}</div>` : `<p style="color:var(--muted)">Install a role pack on the <a href="#skills" id="to-skills">Skills & Packs</a> page to add Linear, Jira, Notion, Figma, Google Drive, GitHub and docs.</p>`}
    <div class="section-title">How it flows</div>
    <div class="md" style="color:var(--muted)"><p><b>Source</b> (Gmail, Slack, Twilio…) → <b>MCP connector</b> → Maestro normalises it into a feed card (category, priority, deadline, action items) → the brain map lights up → Claude and your agents can reason over it.</p></div>`;

  el.querySelector('#cd-reg').onclick = () => registerClaude(() => connectionsPage(el, ctx));
  const ts = el.querySelector('#to-skills'); if (ts) ts.onclick = (e) => { e.preventDefault(); ctx.navigate('skills'); };
  el.querySelectorAll('[data-cfg]').forEach((b) => b.onclick = () => connectModal(st.connectors.find((c) => c.id === b.dataset.cfg), prof, async () => { await ctx.afterChange({ graph: false }); connectionsPage(el, ctx); }));
  el.querySelectorAll('[data-off]').forEach((b) => b.onclick = async () => {
    await api('/connections/disconnect', { id: b.dataset.off, profile: prof });
    toast('Disconnected'); await ctx.afterChange({ graph: false }); connectionsPage(el, ctx);
  });
}

export async function registerClaude(done) {
  try {
    const r = await api('/claude-desktop/register', {});
    modal(`${modalHead('Maestro added to Claude Desktop', 'One last step: restart Claude.')}
      <ol class="steps"><li><b>Fully quit</b> Claude Desktop (Mac: Cmd+Q · Windows: right-click the tray icon → Quit).</li><li>Open Claude Desktop again.</li><li>In a new chat, open the tools / connectors menu: <b>maestro</b> should be listed with its tools.</li><li>Ask: <i>“Use Maestro to brief me on my day.”</i></li><li>Your agents and skills appear under the <b>+</b> menu as prompts.</li></ol>
      <p class="meta" style="margin-top:12px">Written to:<br>${r.written.map((w) => `<code>${esc(w)}</code>`).join('<br>')}<br>A backup of your previous config was saved next to it.</p>
      <div class="modal-foot"><button class="btn primary" data-close>Got it</button></div>`);
    done && done();
  } catch (e) { toast(e.message, 'error'); }
}

function connectModal(c, prof, done) {
  const s = c.status[prof];
  const canLive = c.live && c.live.includes('dashboard');
  const viaClaude = c.live && c.live.includes('claude');
  modal(`${modalHead(`Connect ${esc(c.name)}`, `${profileName()} profile`)}
    <button class="choice ${!s || s.mode === 'demo' ? 'on' : ''}" data-mode="demo">${icon('zap')}<div><b>Use demo data</b><span>Instantly see how ${esc(c.name)} notifications look in the feed and how the brain uses them. Perfect for the workshop.</span></div></button>
    ${canLive ? `<button class="choice ${s && s.mode === 'live' ? 'on' : ''}" data-mode="live">${icon('plug')}<div><b>Connect live</b><span>Stream your real ${esc(c.name)} data into Maestro.</span></div></button>
      <div id="live-fields" ${s && s.mode === 'live' ? '' : 'hidden'} style="margin:4px 0 10px">${(c.liveFields || []).map((f) => `<div class="field"><label>${esc(f.label)}</label><input class="input" data-f="${f.key}" type="${f.secret ? 'password' : 'text'}" placeholder="${esc(f.placeholder || '')}">${f.help ? `<span class="help">${esc(f.help)}</span>` : ''}</div>`).join('')}</div>` : ''}
    ${viaClaude ? `<div class="callout" style="margin-top:6px"><span class="big-icon">${icon('sparkles')}</span><div><h4>Live in Claude Desktop</h4><p>${esc(c.claudeSetup || '')}</p></div></div>` : ''}
    <div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="go">${icon('plug')} Connect</button></div>`, {
    onMount: (m, close) => {
      let mode = s ? s.mode : 'demo';
      m.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => {
        mode = b.dataset.mode;
        m.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
        const lf = m.querySelector('#live-fields'); if (lf) lf.hidden = mode !== 'live';
      });
      m.querySelector('#go').onclick = async (e) => {
        const fields = {};
        m.querySelectorAll('[data-f]').forEach((i) => { if (i.value.trim()) fields[i.dataset.f] = i.value.trim(); });
        e.target.disabled = true; e.target.textContent = 'Connecting…';
        try {
          const r = await api('/connections', { id: c.id, profile: prof, mode, fields });
          toast(r.message + (r.surfaced ? ` · ${r.surfaced} new items in your feed` : ''));
          close(); done();
        } catch (err) { toast(err.message, 'error'); e.target.disabled = false; e.target.innerHTML = `${icon('plug')} Connect`; }
      };
    },
  });
}

// ================================================================ TASKS
async function tasksPage(el, ctx) {
  const list = await api('/tasks?done=1');
  const open = list.filter((t) => !t.done), done = list.filter((t) => t.done);
  const row = (t) => `<div class="task ${t.done ? 'done' : ''}"><input type="checkbox" ${t.done ? 'checked' : ''} data-p="${esc(t.path)}" data-l="${t.line}" aria-label="Done">
    <div class="t-text"><span>${esc(t.text)}</span><small>${[t.priority && t.priority + ' priority', t.due && 'due ' + t.due].filter(Boolean).join(' · ')} · <a href="#" data-n="${esc(t.path)}">${esc(t.note)}</a></small></div>
    ${t.priority === 'High' ? '<span class="tag" style="color:#ff6b81;border-color:#5a1020">High</span>' : ''}</div>`;
  el.innerHTML = head('Tasks', `Tasks are Obsidian checkboxes anywhere in your vault (${profileName()} profile). Tick them here, in Obsidian, or ask the brain: “add a task to…”.`) +
    `<div class="composer-row" style="margin-bottom:16px"><div class="input-wrap" style="height:44px"><input id="t-new" placeholder="Add a task… (add #high or a due date like 📅 2026-11-05)"></div><button class="btn primary" id="t-add" style="height:44px">${icon('plus')} Add</button></div>
     <div class="section-title">Open · ${open.length}</div>${open.map(row).join('') || '<p style="color:var(--muted)">Inbox zero.</p>'}
     <div class="section-title">Done · ${done.length}</div>${done.slice(0, 20).map(row).join('')}`;
  const add = async () => {
    const v = el.querySelector('#t-new').value.trim(); if (!v) return;
    const pri = /#high/i.test(v) ? 'High' : undefined;
    await api('/tasks', { text: v.replace(/#high/i, '').trim(), priority: pri });
    toast('Task added'); tasksPage(el, ctx);
  };
  el.querySelector('#t-add').onclick = add;
  el.querySelector('#t-new').onkeydown = (e) => { if (e.key === 'Enter') add(); };
  el.querySelectorAll('input[type=checkbox]').forEach((c) => c.onchange = async () => { await api('/tasks/toggle', { path: c.dataset.p, line: Number(c.dataset.l) }); tasksPage(el, ctx); });
  el.querySelectorAll('[data-n]').forEach((a) => a.onclick = (e) => { e.preventDefault(); openNote(a.dataset.n); });
}

// ================================================================ CALENDAR
const SRC_COLOR = { gcal: '#3d7bff', icalendar: '#00e5ff', outlook: '#2f8cff', gmail: '#ff5a4e' };
async function calendarPage(el, ctx) {
  const events = await api('/calendar?days=7');
  const days = [];
  const start = new Date(); start.setHours(0, 0, 0, 0);
  for (let i = 0; i < 7; i++) { const d = new Date(start.getTime() + i * 86400000); days.push({ d, ev: events.filter((e) => new Date(e.start).toDateString() === d.toDateString()) }); }
  const t = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  el.innerHTML = head('Calendar', `Next 7 days from your connected calendars (${profileName()}). Connect Google Calendar, iCloud or Outlook with an ICS link on the MCP Connections page to see real events.`,
    `<button class="btn" id="prep">${icon('sparkles')} Prep my next meeting</button>`) +
    `<div class="week">${days.map(({ d, ev }, i) => `<div class="day ${i === 0 ? 'today' : ''}"><h4>${i === 0 ? 'Today' : d.toLocaleDateString([], { weekday: 'short' })}<small>${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}</small></h4>
      ${ev.map((e) => `<div class="event" style="--c:${SRC_COLOR[e.source] || '#00e5ff'}"><b>${esc(e.title)}</b><span>${e.allDay ? 'All day' : t(e.start) + ' – ' + t(e.end)}${e.location ? ' · ' + esc(e.location) : ''}</span>${e.attendees ? `<br><span>${esc(e.attendees.join(', '))}</span>` : ''}${e.live ? '<br><span class="tag live" style="font-size:10px">live</span>' : ''}</div>`).join('') || '<span style="color:var(--dim);font-size:12px">Free</span>'}</div>`).join('')}</div>`;
  el.querySelector('#prep').onclick = () => ctx.ask('Prep me for my next meeting');
}

// ================================================================ KNOWLEDGE (VAULT)
async function vaultPage(el, ctx, selected) {
  const tree = await api('/vault/tree');
  const byFolder = {};
  for (const n of tree) (byFolder[n.folder] = byFolder[n.folder] || []).push(n);
  const order = ['(root)', 'Memory', 'Projects', 'People', 'Meetings', 'Decisions', 'Tasks', 'Daily', 'Inbox', 'Knowledge', 'Agents', 'Skills', 'Personal', 'Templates'];
  const folders = Object.keys(byFolder).sort((a, b) => (order.indexOf(a) + 99) % 199 - (order.indexOf(b) + 99) % 199);
  el.style.display = 'flex'; el.style.flexDirection = 'column';
  el.innerHTML = head('Knowledge', `Your Obsidian vault: <code>${esc(S.state.vaultPath)}</code>. Everything is plain Markdown that you own. Edit here or in Obsidian; the brain picks up changes instantly.`,
    `<div class="input-wrap" style="height:36px;width:240px">${icon('search')}<input id="v-search" placeholder="Search the brain…"></div><button class="btn ghost" id="v-new">${icon('plus')} New note</button><a class="btn primary" href="obsidian://open?path=${encodeURIComponent(S.state.vaultPath)}">${icon('external-link')} Open vault in Obsidian</a>`) +
    `<div class="vault" style="flex:1;min-height:420px"><div class="vault-tree" id="v-tree">${folders.map((f) => `<div class="folder">${icon('folder')} ${esc(f === '(root)' ? 'Home' : f)} <span style="margin-left:auto;color:var(--dim)">${byFolder[f].length}</span></div>${byFolder[f].map((n) => `<button data-p="${esc(n.path)}" class="${selected === n.path ? 'on' : ''}">${esc(n.title)}</button>`).join('')}`).join('')}</div>
     <div class="note-view" id="v-note"><div class="md" style="color:var(--muted)">Select a note. Start with <a class="wikilink" data-note="Maestro Home">Maestro Home</a> or <a class="wikilink" data-note="About Me">About Me</a>.</div></div></div>`;
  wireWikilinks(el);
  const show = async (p) => {
    el.querySelectorAll('#v-tree button').forEach((b) => b.classList.toggle('on', b.dataset.p === p));
    const n = await api('/vault/note?path=' + encodeURIComponent(p));
    const view = el.querySelector('#v-note');
    view.innerHTML = `<div class="note-toolbar"><span class="path">${esc(p)}</span><div style="display:flex;gap:6px"><button class="btn small ghost" id="v-edit">${icon('edit')} Edit</button><a class="btn small ghost" href="${obsidianUrl(p)}">${icon('external-link')} Obsidian</a></div></div><div class="md">${renderMarkdown(n.raw)}</div>`;
    wireWikilinks(view);
    view.querySelectorAll('a.wikilink').forEach((a) => a.addEventListener('click', (e) => { e.stopImmediatePropagation(); const hit = tree.find((t) => t.title.toLowerCase() === a.dataset.note.toLowerCase()); if (hit) show(hit.path); }, true));
    view.querySelector('#v-edit').onclick = () => {
      view.innerHTML = `<div class="note-toolbar"><span class="path">${esc(p)}</span><div style="display:flex;gap:6px"><button class="btn small ghost" id="v-cancel">Cancel</button><button class="btn small primary" id="v-save">${icon('save')} Save</button></div></div><textarea class="input" id="v-text" style="min-height:60vh">${esc(n.raw)}</textarea>`;
      view.querySelector('#v-cancel').onclick = () => show(p);
      view.querySelector('#v-save').onclick = async () => { await api('/vault/note', { path: p, content: view.querySelector('#v-text').value }); toast('Saved'); show(p); ctx.afterChange({ feed: false }); };
    };
  };
  el.querySelectorAll('#v-tree button').forEach((b) => b.onclick = () => show(b.dataset.p));
  if (selected) show(selected);
  el.querySelector('#v-new').onclick = () => modal(`${modalHead('New note')}<div class="field"><label>Path</label><input class="input" id="n-path" value="Inbox/New note.md"></div><div class="field"><label>Content</label><textarea class="input" id="n-body"># New note\n\nLink related notes with [[Maestro Home]].</textarea></div><div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="n-save">Create</button></div>`, {
    onMount: (m, close) => m.querySelector('#n-save').onclick = async () => { const r = await api('/vault/note', { path: m.querySelector('#n-path').value, content: m.querySelector('#n-body').value }); close(); toast('Created ' + r.path); vaultPage(el, ctx, r.path); ctx.afterChange({ feed: false }); },
  });
  const search = el.querySelector('#v-search');
  search.onkeydown = async (e) => {
    if (e.key !== 'Enter') return;
    const hits = await api('/search?q=' + encodeURIComponent(search.value));
    const view = el.querySelector('#v-note');
    view.innerHTML = `<h3 style="margin-top:0">Results for “${esc(search.value)}”</h3>` + (hits.map((h) => `<div class="task" style="cursor:pointer" data-p="${esc(h.path)}"><div class="t-text"><span>${esc(h.title)}</span><small>${esc(h.path)}</small><div style="color:var(--muted);font-size:13px;margin-top:4px">${esc(h.excerpt)}</div></div></div>`).join('') || '<p style="color:var(--muted)">Nothing found.</p>');
    view.querySelectorAll('[data-p]').forEach((d) => d.onclick = () => show(d.dataset.p));
  };
}

// ================================================================ SKILLS & PACKS
async function skillsPage(el, ctx) {
  await refreshState();
  const st = S.state;
  el.innerHTML = head('Skills & Packs', 'Start from the foundation brain, then add a role pack for what you do. Packs add connectors, a specialist agent, skills and playbook notes. Every skill is a Markdown note in <code>Skills/</code> that all agents and Claude can use.') +
    `<div class="section-title">Role packs</div><div class="grid">${st.packs.map((p) => `
      <div class="card accent" style="--c:${p.color};border-top-color:${p.color}">
        <h4><span class="agent-icon" style="--c:${p.color};width:34px;height:34px;font-size:18px">${icon(p.icon)}</span>${esc(p.name)} ${p.installed ? '<span class="tag live">Installed</span>' : ''}</h4>
        <p>${esc(p.description)}</p>
        <div class="meta"><b>Adds:</b> ${(p.connectors || []).map((c) => esc((st.connectors.find((x) => x.id === c) || { name: c }).name)).join(', ')} · agent @${esc((p.agents || [])[0] || '')} · ${(p.skills || []).length} skills</div>
        <div class="meta" style="font-style:italic">Challenge: “${esc(p.challenge)}”</div>
        <div class="row">${p.installed ? `<button class="btn small primary" data-try="${esc(p.challenge)}" data-agent="${esc((p.agents || [])[0] || '')}">${icon('play')} Try the challenge</button><button class="btn small danger" data-un="${p.id}">Remove</button>` : `<button class="btn small primary" data-in="${p.id}">${icon('download')} Install pack</button>`}</div>
      </div>`).join('')}</div>
    <div class="section-title">Load skills & agents into Claude</div>
    <div class="callout"><span class="big-icon">${icon('sparkles')}</span><div style="flex:1"><h4>Two ways Claude gets your skills</h4>
      <p><b>1. Automatically through MCP:</b> with Maestro connected to Claude Desktop, every skill and agent shows up in the <b>+</b> menu as a prompt, and Claude can call <code>get_skill</code> / <code>get_agent</code>.<br>
      <b>2. As Claude Skills:</b> download them below and upload in Claude (Settings → Capabilities → Skills), or unzip into <code>~/.claude/skills</code> for Claude Code. Each one tells Claude to read your Maestro knowledge base.</p></div>
      <a class="btn primary" href="/api/claude-skills/download">${icon('download')} Download all (.zip)</a></div>
    <div class="section-title">Skills · ${st.skills.length}</div>
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap"><button class="btn primary" id="s-new">${icon('plus')} New skill</button><button class="btn ghost" id="s-imp">${icon('upload')} Import .md</button><input type="file" id="s-file" accept=".md" hidden></div>
    <div class="grid">${st.skills.map((s) => `<div class="card"><h4>${icon('zap')} ${esc(s.name)}</h4><p>${esc(s.description)}</p>
      <div class="row">${s.triggers.slice(0, 3).map((t) => `<span class="tag">“${esc(t)}”</span>`).join('')}</div>
      <div class="row"><button class="btn small" data-run="${esc(s.triggers[0] || s.name)}">${icon('play')} Run</button><button class="btn small ghost" data-open="${esc(s.path)}">${icon('file-text')} View</button><a class="btn small ghost" href="/api/claude-skills/download?folder=maestro-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}" title="Download as a Claude Skill">${icon('download')} Claude</a></div></div>`).join('')}</div>`;

  el.querySelectorAll('[data-in]').forEach((b) => b.onclick = async () => {
    b.disabled = true; b.textContent = 'Installing…';
    const r = await api('/packs/install', { id: b.dataset.in });
    toast(`Pack installed: ${r.copied.length} files added to your vault, new sources connected`);
    await ctx.afterChange(); skillsPage(el, ctx);
  });
  el.querySelectorAll('[data-un]').forEach((b) => b.onclick = async () => { await api('/packs/uninstall', { id: b.dataset.un }); toast('Pack removed'); await ctx.afterChange(); skillsPage(el, ctx); });
  el.querySelectorAll('[data-try]').forEach((b) => b.onclick = () => { S.agent = b.dataset.agent || null; ctx.ask(b.dataset.try); });
  el.querySelectorAll('[data-run]').forEach((b) => b.onclick = () => ctx.ask(b.dataset.run.charAt(0).toUpperCase() + b.dataset.run.slice(1)));
  el.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => openNote(b.dataset.open));
  el.querySelector('#s-imp').onclick = () => el.querySelector('#s-file').click();
  el.querySelector('#s-file').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const r = await api('/import', { filename: f.name, content: await f.text() }); toast(`Imported ${r.kind}: ${r.path}`); await ctx.afterChange({ feed: false }); skillsPage(el, ctx); };
  el.querySelector('#s-new').onclick = () => modal(`${modalHead('New skill', 'A reusable playbook. Saved to Skills/ and available to every agent and to Claude.')}
    <div class="field"><label>Name</label><input class="input" id="k-name" placeholder="Customer Call Summary"></div>
    <div class="field"><label>Description</label><input class="input" id="k-desc" placeholder="Summarise a customer call into pains, requests and follow-ups"></div>
    <div class="field"><label>Trigger phrases (comma separated)</label><input class="input" id="k-trig" placeholder="call summary, summarize the call"></div>
    <div class="field"><label>Steps</label><textarea class="input" id="k-body">1. Search the vault and feed for the call and the customer.\n2. Extract pains, feature requests, objections and next steps.\n3. Output a 5-bullet summary and draft a follow-up email.\n4. Save to Meetings/ and add follow-up tasks.</textarea></div>
    <div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="k-save">${icon('save')} Create skill</button></div>`, {
    onMount: (m, close) => m.querySelector('#k-save').onclick = async () => {
      const v = (id) => m.querySelector(id).value.trim();
      if (!v('#k-name')) return toast('Name the skill', 'error');
      await api('/skills', { name: v('#k-name'), description: v('#k-desc'), triggers: v('#k-trig'), instructions: v('#k-body') });
      close(); toast('Skill created'); await ctx.afterChange({ feed: false }); skillsPage(el, ctx);
    },
  });
}

// ================================================================ CONVERSATIONS
async function conversationsPage(el, ctx) {
  const convs = await api('/conversations');
  el.innerHTML = head('Conversations', 'Everything you have asked your brain. Each question is also logged in today’s Daily note in your vault.', `<button class="btn primary" id="c-new">${icon('plus')} New conversation</button>`) +
    (convs.map((c) => `<div class="task" style="cursor:pointer" data-id="${c.id}"><div class="t-text"><span>${esc(c.title)}</span><small>${timeAgo(c.created)} · ${c.messages.length / 2} exchanges · ${esc(c.profile || '')}</small></div>${icon('arrow-right')}</div>`).join('') || '<p style="color:var(--muted)">No conversations yet. Ask something on the dashboard.</p>');
  el.querySelector('#c-new').onclick = () => { ctx.navigate('dashboard'); ctx.newConversation(); };
  el.querySelectorAll('[data-id]').forEach((d) => d.onclick = () => {
    const c = convs.find((x) => x.id === d.dataset.id);
    modal(`${modalHead(esc(c.title), timeAgo(c.created))}${c.messages.map((m) => `<div class="msg ${m.role === 'user' ? 'user' : 'bot'}" style="margin-bottom:10px;max-width:100%">${m.role === 'user' ? esc(m.content) : `<div class="who">${esc(m.agent || '')}</div><div class="md">${renderMarkdown(m.content)}</div>`}</div>`).join('')}
      <div class="modal-foot"><button class="btn primary" id="cont">${icon('message-circle')} Continue this conversation</button></div>`, {
      wide: true,
      onMount: (m, close) => { wireWikilinks(m); m.querySelector('#cont').onclick = () => { S.conversationId = c.id; close(); ctx.navigate('dashboard'); toast('Continuing: ' + c.title); }; },
    });
  });
}

// ================================================================ WORKFLOWS
async function workflowsPage(el, ctx) {
  const list = await api('/workflows');
  el.innerHTML = head('Workflows', 'Your proactive brain. Workflows run on their own, write results into today’s Daily note and push a card into the Intelligence Feed. This is the difference between a reactive and a proactive second brain.') +
    `<div class="grid">${list.map((w) => `<div class="card">
      <h4>${icon(w.icon)} ${esc(w.name)} <label class="toggle" style="margin-left:auto"><input type="checkbox" data-t="${w.id}" ${w.enabled ? 'checked' : ''}><span></span></label></h4>
      <p>${esc(w.description)}</p>
      <div class="row">${w.schedule === 'time' ? `<span class="meta">Runs daily at</span><input class="input" type="time" data-time="${w.id}" value="${w.time || '08:00'}" style="width:120px">` : w.schedule === 'every' ? `<span class="meta">Every</span><input class="input" type="number" min="15" step="15" data-every="${w.id}" value="${w.everyMinutes || 60}" style="width:80px"><span class="meta">minutes</span>` : `<span class="meta">Runs</span><input class="input" type="number" min="5" step="5" data-before="${w.id}" value="${w.minutesBefore || 15}" style="width:80px"><span class="meta">min before each meeting</span>`}</div>
      <div class="row"><button class="btn small primary" data-run="${w.id}">${icon('play')} Run now</button><span class="meta">${w.lastRun ? 'Last run ' + timeAgo(w.lastRun) : 'Not run yet this session'}</span></div></div>`).join('')}</div>`;
  const save = (id, settings) => api('/workflows/update', { id, settings }).then(() => toast('Saved'));
  el.querySelectorAll('[data-t]').forEach((i) => i.onchange = () => save(i.dataset.t, { enabled: i.checked }));
  el.querySelectorAll('[data-time]').forEach((i) => i.onchange = () => save(i.dataset.time, { time: i.value }));
  el.querySelectorAll('[data-every]').forEach((i) => i.onchange = () => save(i.dataset.every, { everyMinutes: Number(i.value) }));
  el.querySelectorAll('[data-before]').forEach((i) => i.onchange = () => save(i.dataset.before, { minutesBefore: Number(i.value) }));
  el.querySelectorAll('[data-run]').forEach((b) => b.onclick = async () => {
    b.disabled = true; b.textContent = 'Running…';
    try {
      const r = await api('/workflows/run', { id: b.dataset.run });
      modal(`${modalHead('Workflow complete', 'Saved to ' + esc(r.notePath))}<div class="md">${renderMarkdown(r.content)}</div><div class="modal-foot"><button class="btn ghost" data-open>${icon('file-text')} Open Daily note</button><button class="btn primary" data-close>Done</button></div>`, {
        wide: true, onMount: (m, close) => { wireWikilinks(m); m.querySelector('[data-open]').onclick = () => { close(); openNote(r.notePath); }; },
      });
    } catch (e) { toast(e.message, 'error'); }
    workflowsPage(el, ctx);
  });
}

// ================================================================ SETTINGS
async function settingsPage(el, ctx) {
  await refreshState();
  const st = S.state, c = cfg();
  const prov = c.llm.provider;
  const voices = voiceSupported.tts ? speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)) : [];
  el.innerHTML = head('Settings', 'Make the brain yours. Keys are stored only on this computer in <code>data/config.json</code>.') +
    `<div class="tabs" id="tabs">${['You', 'AI engine', 'Voice', 'Vault', 'Claude Desktop', 'Demo'].map((t, i) => `<button data-tab="${i}" class="${i === 0 ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div data-pane="0">
      <div class="two-col"><div class="field"><label>Your name</label><input class="input" id="s-name" value="${esc(c.user.name)}"></div><div class="field"><label>What you do</label><input class="input" id="s-role" value="${esc(c.user.role)}"></div></div>
      <div class="field"><label>Assistant name (wake word)</label><input class="input" id="s-asst" value="${esc(c.assistantName)}"><span class="help">Used in greetings and for hands-free voice (“Hey ${esc(c.assistantName)}…”).</span></div>
      <button class="btn primary" id="save-you">${icon('save')} Save</button>
      <p class="help" style="margin-top:14px;color:var(--muted)">Tip: also edit <a class="wikilink" data-note="About Me">About Me</a> in your vault. It is the most important note for good answers.</p>
    </div>
    <div data-pane="1" hidden>
      <p style="color:var(--muted);margin-top:0">Pick who does the thinking in the dashboard. In Claude Desktop, Claude is always the engine. Agents can override this per agent.</p>
      ${Object.entries(st.providers).map(([id, p]) => `<button class="choice ${prov === id ? 'on' : ''}" data-prov="${id}">${icon(id === 'demo' ? 'zap' : id === 'anthropic' ? 'sparkles' : id === 'compatible' ? 'link' : 'cpu')}<div><b>${esc(p.label)}</b><span>${{ demo: 'Works offline with no key. Answers from your vault, feed and calendar with built-in playbooks. Great for the workshop.', anthropic: 'Claude via the Anthropic API. Best reasoning over your notes.', openai: 'OpenAI models through the API.', gemini: 'Google Gemini through the Gemini API.', compatible: 'Hermes or any open model via Ollama, LM Studio, OpenRouter or Nous Portal.' }[id]}</span></div></button>`).join('')}
      <div id="prov-fields"></div>
      <div style="display:flex;gap:8px"><button class="btn primary" id="save-ai">${icon('save')} Save</button><button class="btn ghost" id="test-ai">${icon('zap')} Test connection</button></div>
    </div>
    <div data-pane="2" hidden>
      ${voiceSupported.stt ? '' : '<div class="callout" style="margin-bottom:12px"><span class="big-icon">' + icon('mic') + '</span><div><h4>Voice input is not available in this browser</h4><p>Use Chrome or Edge for talking to the brain. Spoken replies still work.</p></div></div>'}
      <div class="field" style="flex-direction:row;align-items:center;gap:12px"><label class="toggle"><input type="checkbox" id="v-speak" ${c.voice.speakReplies ? 'checked' : ''}><span></span></label><div>Speak replies out loud when I ask by voice</div></div>
      <div class="field" style="flex-direction:row;align-items:center;gap:12px"><label class="toggle"><input type="checkbox" id="v-hands" ${c.voice.handsFree ? 'checked' : ''}><span></span></label><div>Hands-free: keep listening and respond to “Hey ${esc(c.assistantName)}…”</div></div>
      <div class="two-col"><div class="field"><label>Voice</label><select class="input" id="v-voice"><option value="">Automatic</option>${voices.map((v) => `<option ${v.name === c.voice.voiceName ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Speed</label><input class="input" type="range" min="0.7" max="1.4" step="0.05" id="v-rate" value="${c.voice.rate}"></div></div>
      <div style="display:flex;gap:8px"><button class="btn primary" id="save-voice">${icon('save')} Save</button><button class="btn ghost" id="test-voice">${icon('volume-2')} Test voice</button></div>
    </div>
    <div data-pane="3" hidden>
      <div class="field"><label>Obsidian vault folder</label><input class="input" id="vault-path" value="${esc(st.vaultPath)}"><span class="help">Point Maestro at your own existing Obsidian vault, or keep the starter vault. Folders like Memory/, Agents/ and Skills/ are created as needed.</span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="save-vault">${icon('save')} Save</button><a class="btn ghost" href="obsidian://open?path=${encodeURIComponent(st.vaultPath)}">${icon('external-link')} Open in Obsidian</a><a class="btn ghost" href="https://obsidian.md/download" target="_blank" rel="noopener">${icon('download')} Get Obsidian</a></div>
      <ol class="steps" style="margin-top:16px"><li>Install Obsidian (free).</li><li>Choose <b>Open folder as vault</b> and pick <code>${esc(st.vaultPath)}</code>.</li><li>Open the graph view (Ctrl/Cmd+G) to see the same brain map.</li></ol>
    </div>
    <div data-pane="4" hidden>
      <div class="callout ${st.claudeDesktop.registered ? 'ok' : ''}"><span class="big-icon">${icon(st.claudeDesktop.registered ? 'check' : 'plug')}</span><div style="flex:1"><h4>${st.claudeDesktop.registered ? 'Connected' : 'Not connected yet'}</h4><p>Config file: <code>${esc(st.claudeDesktop.configPath)}</code></p></div><button class="btn primary" id="cd">${icon('plug')} ${st.claudeDesktop.registered ? 'Re-connect' : 'Connect'}</button></div>
      <div class="section-title">Manual setup</div><p style="color:var(--muted)">Add this to <code>claude_desktop_config.json</code> under <code>mcpServers</code>:</p>
      <pre class="md" style="background:var(--bg-deep);border:1px solid var(--line);padding:12px;border-radius:8px;overflow:auto"><code>${esc(JSON.stringify({ maestro: st.claudeDesktop.entry }, null, 2))}</code></pre>
    </div>
    <div data-pane="5" hidden>
      <div class="field" style="flex-direction:row;align-items:center;gap:12px"><label class="toggle"><input type="checkbox" id="d-live" ${c.demo.liveFeed ? 'checked' : ''}><span></span></label><div>Stream new demo notifications into the feed</div></div>
      <div class="field"><label>Seconds between demo notifications</label><input class="input" type="number" min="10" id="d-int" value="${c.demo.intervalSeconds}" style="width:120px"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="save-demo">${icon('save')} Save</button><button class="btn ghost" id="reset-demo">${icon('refresh')} Reset demo feed</button><button class="btn ghost" id="rerun-onb">${icon('sparkles')} Run setup again</button></div>
    </div>`;
  wireWikilinks(el);
  el.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => {
    el.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
    el.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  });

  let chosen = prov;
  const provFields = () => {
    const f = el.querySelector('#prov-fields');
    const v = c.llm[chosen] || {};
    if (chosen === 'demo') { f.innerHTML = ''; return; }
    f.innerHTML = `<div class="two-col" style="margin-top:6px">${chosen === 'compatible' ? `<div class="field"><label>Base URL</label><input class="input" id="p-base" value="${esc(v.baseUrl || '')}"></div><div class="field"><label>Label</label><input class="input" id="p-label" value="${esc(v.label || '')}"></div>` : ''}
      <div class="field"><label>API key</label><input class="input" id="p-key" type="password" placeholder="${v.apiKey ? esc(v.apiKey) + ' (saved)' : chosen === 'compatible' ? 'Optional for Ollama' : 'Paste your key'}"></div>
      <div class="field"><label>Model</label><input class="input" id="p-model" value="${esc(v.model || '')}"></div></div>
      <p class="help" style="color:var(--dim)">${{ anthropic: 'Get a key at console.anthropic.com.', openai: 'Get a key at platform.openai.com.', gemini: 'Get a key at aistudio.google.com.', compatible: 'Ollama: install from ollama.com, run "ollama pull hermes3", base URL http://localhost:11434/v1. OpenRouter: base URL https://openrouter.ai/api/v1, model nousresearch/hermes-4-70b.' }[chosen]}</p>`;
  };
  provFields();
  el.querySelectorAll('[data-prov]').forEach((b) => b.onclick = () => { chosen = b.dataset.prov; el.querySelectorAll('[data-prov]').forEach((x) => x.classList.toggle('on', x === b)); provFields(); });

  const saveAi = async () => {
    const body = { llm: { provider: chosen } };
    if (chosen !== 'demo') {
      const g = (id) => { const i = el.querySelector(id); return i ? i.value.trim() : undefined; };
      body.llm[chosen] = { model: g('#p-model'), apiKey: g('#p-key') || undefined, baseUrl: g('#p-base'), label: g('#p-label') };
      Object.keys(body.llm[chosen]).forEach((k) => body.llm[chosen][k] === undefined && delete body.llm[chosen][k]);
    }
    await api('/settings', body); await refreshState(); toast('AI engine saved');
  };
  el.querySelector('#save-ai').onclick = saveAi;
  el.querySelector('#test-ai').onclick = async () => { await saveAi(); try { const r = await api('/llm/test', {}); toast('✓ ' + r.reply); } catch (e) { toast(e.message, 'error'); } };
  el.querySelector('#save-you').onclick = async () => { await api('/settings', { user: { name: el.querySelector('#s-name').value.trim(), role: el.querySelector('#s-role').value.trim() }, assistantName: el.querySelector('#s-asst').value.trim() || 'Jarvis' }); toast('Saved'); ctx.afterChange({ graph: false, feed: false }); };
  el.querySelector('#save-voice').onclick = async () => { await api('/settings', { voice: { speakReplies: el.querySelector('#v-speak').checked, handsFree: el.querySelector('#v-hands').checked, voiceName: el.querySelector('#v-voice').value, rate: Number(el.querySelector('#v-rate').value) } }); await refreshState(); toast('Voice saved'); };
  el.querySelector('#test-voice').onclick = () => { const u = new SpeechSynthesisUtterance(`Hello ${c.user.name}. Your second brain is online.`); const v = speechSynthesis.getVoices().find((x) => x.name === el.querySelector('#v-voice').value); if (v) u.voice = v; u.rate = Number(el.querySelector('#v-rate').value); speechSynthesis.speak(u); };
  el.querySelector('#save-vault').onclick = async () => { try { await api('/settings', { vaultPath: el.querySelector('#vault-path').value.trim() }); toast('Vault updated'); ctx.afterChange(); } catch (e) { toast(e.message, 'error'); } };
  el.querySelector('#cd').onclick = () => registerClaude(() => settingsPage(el, ctx));
  el.querySelector('#save-demo').onclick = async () => { await api('/settings', { demo: { liveFeed: el.querySelector('#d-live').checked, intervalSeconds: Number(el.querySelector('#d-int').value) } }); S.livePaused = !el.querySelector('#d-live').checked; toast('Saved'); ctx.afterChange({ graph: false, feed: false }); };
  el.querySelector('#reset-demo').onclick = async () => { await api('/reset-demo', {}); toast('Demo feed reset'); ctx.afterChange({ graph: false }); };
  el.querySelector('#rerun-onb').onclick = () => onboarding(ctx);
}

// ================================================================ ONBOARDING
export function onboarding({ after, afterChange }) {
  const done = after || afterChange;
  const c = cfg();
  let step = 0, pack = null;
  const steps = [
    () => `${modalHead('Welcome to Maestro', 'Your personal second brain: Claude + Obsidian + MCP.')}
      <div class="md"><p>In the next minute you will:</p><ol><li>Tell the brain who you are</li><li>Pick a role pack for what you do</li><li>Connect it to Claude Desktop</li></ol><p>Everything already works with demo data, so you can explore right away.</p></div>`,
    () => `${modalHead('Who are you?', 'This goes into your memory so every answer is about you.')}
      <div class="two-col"><div class="field"><label>Your name</label><input class="input" id="o-name" value="${esc(c.user.name)}"></div><div class="field"><label>What you do</label><input class="input" id="o-role" value="${esc(c.user.role)}"></div></div>
      <div class="field"><label>Name your assistant</label><input class="input" id="o-asst" value="${esc(c.assistantName)}"><span class="help">You'll say “Hey ${esc(c.assistantName)}” to talk to it.</span></div>`,
    () => `${modalHead('Pick your role pack', 'Packs add the connectors, agent and skills for your job. You can add more later.')}
      ${S.state.packs.map((p) => `<button class="choice ${pack === p.id || p.installed ? 'on' : ''}" data-p="${p.id}">${icon(p.icon)}<div><b>${esc(p.name)}</b><span>${esc(p.description)}</span></div></button>`).join('')}
      <button class="choice ${pack === 'none' ? 'on' : ''}" data-p="none">${icon('brain')}<div><b>Just the foundation</b><span>Email, calendars, Slack, texts and calls.</span></div></button>`,
    () => `${modalHead('Connect Claude Desktop', 'Claude becomes the reasoning engine and can read and write your brain.')}
      <div class="md"><p>Install Claude Desktop from <a href="https://claude.ai/download" target="_blank" rel="noopener">claude.ai/download</a> and sign in, then click below. You can also do this later from MCP Connections.</p></div>
      <button class="btn primary" id="o-cd">${icon('plug')} Connect to Claude Desktop</button>`,
  ];
  const m = modal('<div id="onb"></div>', {});
  const render = () => {
    const box = m.el.querySelector('#onb');
    box.innerHTML = steps[step]() + `<div class="modal-foot">${step ? '<button class="btn ghost" id="o-back">Back</button>' : '<button class="btn ghost" id="o-skip">Skip</button>'}<button class="btn primary" id="o-next">${step === steps.length - 1 ? 'Finish' : 'Next'} ${icon('arrow-right')}</button></div>`;
    box.querySelectorAll('[data-close]').forEach((b) => b.onclick = finish);
    box.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { pack = b.dataset.p; box.querySelectorAll('[data-p]').forEach((x) => x.classList.toggle('on', x === b)); });
    const cd = box.querySelector('#o-cd'); if (cd) cd.onclick = () => registerClaude();
    const back = box.querySelector('#o-back'); if (back) back.onclick = () => { step--; render(); };
    const skip = box.querySelector('#o-skip'); if (skip) skip.onclick = finish;
    box.querySelector('#o-next').onclick = async () => {
      if (step === 1) {
        await api('/settings', { user: { name: box.querySelector('#o-name').value.trim() || c.user.name, role: box.querySelector('#o-role').value.trim() }, assistantName: box.querySelector('#o-asst').value.trim() || 'Jarvis' });
        await refreshState();
      }
      if (step === 2 && pack && pack !== 'none' && !S.state.packs.find((p) => p.id === pack).installed) {
        await api('/packs/install', { id: pack });
        toast('Pack installed');
      }
      if (step === steps.length - 1) return finish();
      step++; render();
    };
  };
  const finish = async () => { await api('/settings', { onboarded: true }); m.close(); done && done(); };
  render();
}

export const PAGES = {
  agents: agentsPage,
  connections: connectionsPage,
  tasks: tasksPage,
  calendar: calendarPage,
  vault: vaultPage,
  skills: skillsPage,
  conversations: conversationsPage,
  workflows: workflowsPage,
  settings: settingsPage,
};
