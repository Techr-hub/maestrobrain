// Maestro Control Centre: shell, brain dashboard, chat + voice, and the live intelligence feed.
import { icon, CATEGORY } from './icons.js';
import { renderMarkdown, stripMarkdown, esc } from './md.js';
import { BrainMap, avatar as makeAvatar, GROUP_COLORS } from './brainmap.js';
import { Voice, voiceSupported } from './voice.js';
import { S, api, refreshState, toast, timeAgo, modal, modalHead, openNote, wireWikilinks, closeDrawer } from './core.js';
import { PAGES, onboarding, knowledgeModal } from './pages.js';

const $ = (s, r = document) => r.querySelector(s);

const NAV = [
  ['dashboard', 'Dashboard', 'layout-grid'],
  ['agents', 'Agents', 'users-round'],
  ['connections', 'MCP Connections', 'plug'],
  ['tasks', 'Tasks', 'clipboard-check'],
  ['calendar', 'Calendar', 'calendar-days'],
  ['vault', 'Knowledge', 'folder'],
  ['skills', 'Skills & Packs', 'box'],
  ['conversations', 'Conversations', 'message-circle'],
  ['workflows', 'Workflows', 'workflow'],
  ['settings', 'Settings', 'settings'],
];

const SHORT = { gmail: 'GM', outlook: 'OL', email: '@', icalendar: 'iC', gcal: 'GC', slack: '#', twilio_sms: 'TX', twilio_calls: 'CL', linear: 'LN', jira: 'JR', notion: 'N', figma: 'FG', gdrive: 'GD', github: 'GH', docs: 'DC' };

let brain, av, voice, dashboardEl;

// ---------------------------------------------------------------- boot
async function boot() {
  await refreshState();
  S.livePaused = !(S.state.config.demo && S.state.config.demo.liveFeed);
  renderShell();
  buildDashboard();
  const initial = (location.hash || '#dashboard').slice(1);
  navigate(PAGES[initial] || initial === 'dashboard' ? initial : 'dashboard');
  await loadFeed();
  connectStream();
  clock();
  setInterval(clock, 1000);
  setInterval(() => renderFeed(false), 60000); // refresh "x min ago"
  if (!S.state.config.onboarded) onboarding({ after: afterChange });
  else if (!S.state.knowledge.connected) knowledgeModal(() => afterChange({}), { first: true });
}

export async function afterChange({ graph = true, feed = true } = {}) {
  await refreshState();
  renderShell();
  renderMentions();
  updateBrainSources();
  if (graph) loadGraph();
  if (feed) await loadFeed();
  updateStats();
}

function renderShell() {
  const st = S.state, cfg = st.config;
  $('#nav').innerHTML = NAV.map(([id, label, ic]) => `<button class="nav-item ${S.route === id ? 'active' : ''}" data-route="${id}" title="${label}">${icon(ic)}<span class="label">${label}</span>${id === 'connections' ? `<span class="badge">${Object.keys(cfg.connections[cfg.profile] || {}).length}</span>` : ''}</button>`).join('');
  $('#nav').querySelectorAll('.nav-item').forEach((b) => b.onclick = () => navigate(b.dataset.route));
  const ps = $('#profile-switch');
  ps.querySelector('[data-profile=business]').innerHTML = `${icon('briefcase')} Business`;
  ps.querySelector('[data-profile=personal]').innerHTML = `${icon('home')} Personal`;
  ps.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.profile === cfg.profile);
    b.onclick = () => switchProfile(b.dataset.profile);
  });
  $('#bell-icon').innerHTML = icon('bell');
  $('#bell-dot').hidden = !st.unread;
  $('#prefs').innerHTML = icon('settings');
  $('#feed-toggle').innerHTML = icon('panel-right');
  $('#op-dot').innerHTML = icon('circle-dot');
  $('#op-name').textContent = cfg.user.name;
  $('#op-avatar').textContent = (cfg.user.name || '?')[0].toUpperCase();
  $('#arrow').innerHTML = icon('arrow-right');
  $('#live-toggle').innerHTML = `${icon('circle-dot')} ${S.livePaused ? 'PAUSED' : 'LIVE'}`;
  $('#live-toggle').classList.toggle('paused', S.livePaused);
  greet();
}

function greet() {
  const h = new Date().getHours();
  const cfg = S.state.config;
  $('#greet').textContent = `Good ${h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}, ${cfg.user.name}`;
  const n = S.feed.filter((i) => i.priority === 'High').length;
  $('#greet-sub').textContent = cfg.profile === 'personal' ? 'Personal mode: work stays at work.' : n ? `${n} things need you today. Let's make it extraordinary.` : "Let's make today extraordinary.";
}

function clock() {
  const d = new Date();
  $('#clock-date').textContent = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#clock-time').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export function navigate(route) {
  S.route = route;
  history.replaceState(null, '', '#' + route);
  closeDrawer();
  $('#nav').querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.route === route));
  const main = $('#main');
  if (route === 'dashboard') {
    main.replaceChildren(dashboardEl);
    requestAnimationFrame(() => brain && brain.resize());
    $('#chat-input') && $('#chat-input').focus();
  } else {
    const page = document.createElement('div');
    page.className = 'page';
    main.replaceChildren(page);
    PAGES[route](page, { navigate, afterChange, ask, newConversation });
  }
}

async function switchProfile(profile) {
  if (profile === S.state.config.profile) return;
  await api('/profile', { profile });
  toast(profile === 'personal' ? 'Personal mode: only personal sources and notes' : 'Business mode: work sources and notes');
  await afterChange();
  if (S.route !== 'dashboard') navigate(S.route);
}

// ---------------------------------------------------------------- dashboard
function buildDashboard() {
  dashboardEl = document.createElement('div');
  dashboardEl.className = 'brain';
  dashboardEl.innerHTML = `
    <canvas class="brain-canvas" id="brain-canvas"></canvas>
    <div class="brain-tooltip" id="brain-tip"></div>
    <div class="brain-hud" id="brain-hud"></div>
    <div class="brain-stats" id="brain-stats"></div>
    <div class="subtitle" id="subtitle">Brain online</div>
    <div class="chat-panel" id="chat-panel">
      <div class="chat-bar" id="chat-bar" hidden><span>${icon('message-circle')} Conversation</span><button id="chat-toggle" title="Hide or show the conversation">${icon('chevron-down')} Hide</button><button id="chat-new" title="Start a new conversation">${icon('plus')} New</button></div>
      <div class="chat-log" id="chat-log" aria-live="polite"></div>
      <div class="composer">
        <div class="suggestions" id="suggestions"></div>
        <div class="composer-row">
          <div class="input-wrap">
            <input id="chat-input" autocomplete="off" placeholder="Message ${esc(S.state.config.assistantName)} or an agent..." aria-label="Message">
            <button class="ghost" id="attach" title="Import a Markdown file (agent, skill or note)">${icon('paperclip')}</button>
            <input type="file" id="file" accept=".md,.markdown,.txt" hidden>
          </div>
          <button class="mic-btn" id="mic" title="Talk to your brain (Alt+V)">${icon('mic')}</button>
          <button class="send-btn" id="send" title="Send">${icon('send')}</button>
        </div>
        <div class="mentions" id="mentions"></div>
      </div>
    </div>`;

  brain = new BrainMap(dashboardEl.querySelector('#brain-canvas'), {
    tooltip: dashboardEl.querySelector('#brain-tip'),
    onNodeClick: (n) => (n.kind === 'note' ? openNote(n.id) : navigate('connections')),
    onLayout: (b) => { const st = dashboardEl.querySelector('#subtitle'); if (st) { st.style.top = b.subY + 'px'; st.style.left = b.subX + 'px'; } },
  });
  av = makeAvatar($('#avatar-canvas'));
  $('#brand-avatar').onclick = () => { navigate('dashboard'); toggleMic(); };

  const input = dashboardEl.querySelector('#chat-input');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFromInput(); } });
  dashboardEl.querySelector('#send').onclick = sendFromInput;
  dashboardEl.querySelector('#mic').onclick = toggleMic;
  dashboardEl.querySelector('#attach').onclick = () => dashboardEl.querySelector('#file').click();
  dashboardEl.querySelector('#file').onchange = importFile;

  dashboardEl.querySelector('#chat-toggle').onclick = () => {
    const panel = dashboardEl.querySelector('#chat-panel');
    panel.classList.toggle('collapsed');
    const c = panel.classList.contains('collapsed');
    dashboardEl.querySelector('#chat-toggle').innerHTML = `${icon(c ? 'chevron-up' : 'chevron-down')} ${c ? 'Show' : 'Hide'}`;
    brain.setCompact(!c);
  };
  dashboardEl.querySelector('#chat-new').onclick = () => { newConversation(); };
  renderHud();
  renderMentions();
  renderSuggestions();
  updateBrainSources();
  loadGraph();
  setupVoice();

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyV') { e.preventDefault(); navigate('dashboard'); toggleMic(); }
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); navigate('dashboard'); input.focus(); }
  });
}

function renderHud() {
  const groups = ['Memory', 'Projects', 'People', 'Agents', 'Skills', S.state.config.profile === 'personal' ? 'Personal' : 'Meetings'];
  $('#brain-hud', dashboardEl).innerHTML = `<div class="hud-chip">${icon('brain')} Knowledge map · ${esc(S.state.vaultName)}</div>` + groups.map((g) => `<div class="hud-chip"><i style="background:${GROUP_COLORS[g]}"></i>${g}</div>`).join('');
}

async function loadGraph() {
  const g = await api('/graph');
  brain.setGraph(g);
  brain._noteCount = g.nodes.length;
  renderHud();
  updateStats();
}

function updateBrainSources() {
  const cfg = S.state.config;
  const conns = cfg.connections[cfg.profile] || {};
  brain && brain.setSources(S.state.connectors.filter((c) => conns[c.id]).map((c) => ({ id: c.id, name: c.name, color: c.color, short: SHORT[c.id] })));
  updateStats();
}

function updateStats() {
  if (!dashboardEl) return;
  const cfg = S.state.config;
  const sources = Object.keys(cfg.connections[cfg.profile] || {}).length;
  $('#brain-stats', dashboardEl).innerHTML = [
    [brain._noteCount || 0, 'Notes'], [sources, 'Sources'], [S.state.agents.length, 'Agents'], [S.state.skills.length, 'Skills'],
  ].map(([v, l]) => `<div class="stat"><b>${v}</b><small>${l}</small></div>`).join('');
}

function renderMentions() {
  const el = dashboardEl && $('#mentions', dashboardEl);
  if (!el) return;
  const agents = S.state.agents;
  el.innerHTML = agents.slice(0, 6).map((a) => `<button class="mention ${S.agent === a.handle ? 'on' : ''}" data-h="${esc(a.handle)}" style="--agent:${esc(a.color)}" title="${esc(a.description || a.role)}">@${esc(a.handle)}</button>`).join('') +
    `<button class="mention" id="more-agents" title="All agents">•••</button><span class="hint">${voiceSupported.stt ? 'Alt+V to talk · / to type' : 'Voice needs Chrome or Edge'}</span>`;
  el.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => {
    S.agent = S.agent === b.dataset.h ? null : b.dataset.h;
    if (S.agent && S.agent.toLowerCase() === S.state.config.assistantName.toLowerCase()) S.agent = null;
    renderMentions();
    const input = $('#chat-input', dashboardEl);
    input.placeholder = S.agent ? `Message @${S.agent}...` : `Message ${S.state.config.assistantName} or an agent...`;
    input.focus();
  });
  $('#more-agents', el).onclick = () => navigate('agents');
}

function renderSuggestions() {
  const el = $('#suggestions', dashboardEl);
  if ($('#chat-log', dashboardEl).children.length) { el.innerHTML = ''; return; }
  const personal = S.state.config.profile === 'personal';
  const list = personal
    ? ['Brief me on my day', 'Any texts I need to answer?', 'What’s on this weekend?', 'Remember that Sam prefers Sunday tennis']
    : ['Brief me on my day', 'Review my current sprint, identify blockers, and prepare an update for stakeholders', 'What needs a reply?', 'Prep me for my next meeting', 'Review the latest design feedback before developer handoff'];
  el.innerHTML = list.map((s) => `<button class="suggestion">${esc(s)}</button>`).join('');
  el.querySelectorAll('button').forEach((b) => b.onclick = () => ask(b.textContent));
}

function setSubtitle(text, speaking = false) {
  const el = $('#subtitle', dashboardEl);
  el.textContent = text;
  el.classList.toggle('speaking', speaking);
}

function setBrainState(state) {
  brain.setState(state);
  // The sidebar logo stays still; only the brain core in the map reacts to voice.
  const label = { idle: 'Brain online', listening: 'Listening…', thinking: 'Thinking…', speaking: '' }[state];
  if (label !== '') setSubtitle(label);
}

// ---------------------------------------------------------------- chat
function sendFromInput() {
  const input = $('#chat-input', dashboardEl);
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  ask(text);
}

export function newConversation() {
  S.conversationId = null;
  $('#chat-log', dashboardEl).innerHTML = '';
  $('#chat-bar', dashboardEl).hidden = true;
  $('#chat-panel', dashboardEl).classList.remove('collapsed');
  brain.setCompact(false);
  renderSuggestions();
}

function addMessage(role, html, extra = {}) {
  const log = $('#chat-log', dashboardEl);
  $('#chat-bar', dashboardEl).hidden = false;
  if (!$('#chat-panel', dashboardEl).classList.contains('collapsed')) brain.setCompact(true);
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
  if (extra.color) div.style.setProperty('--agent', extra.color);
  div.innerHTML = html;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  renderSuggestions();
  return div;
}

export async function ask(text, { voice: viaVoice = false } = {}) {
  if (S.route !== 'dashboard') navigate('dashboard');
  const handle = S.agent && !/^@/.test(text) ? S.agent : null;
  addMessage('user', esc(handle ? `@${handle} ${text}` : text));
  const pending = addMessage('bot', `<div class="who">${esc(handle || S.state.config.assistantName)}</div><span class="typing"><i></i><i></i><i></i></span>`);
  setBrainState('thinking');
  let res;
  try {
    res = await api('/chat', { message: text, agent: handle, conversationId: S.conversationId, voice: viaVoice });
  } catch (e) {
    pending.innerHTML = `<div class="who">Error</div>${esc(e.message)}`;
    setBrainState('idle');
    return;
  }
  S.conversationId = res.conversationId;
  const agent = res.agent || { name: S.state.config.assistantName, handle: S.state.config.assistantName, color: '#00e5ff' };
  pending.style.setProperty('--agent', agent.color);
  const providerLabel = { demo: 'demo brain', memory: 'memory', tasks: 'tasks', anthropic: 'Claude', openai: 'ChatGPT', gemini: 'Gemini', compatible: S.state.config.llm.compatible.label || 'custom model' }[res.provider] || res.provider;
  const head = `<div class="who">${esc(agent.name)} <small>${esc(providerLabel)}</small></div>`;
  const body = document.createElement('div');
  body.className = 'md';
  pending.innerHTML = head;
  pending.appendChild(body);
  if (res.sources.length) brain.highlightNotes(res.sources);
  brain.flashCore();
  if (res.actions.some((a) => a.type === 'memory' || a.type === 'task')) loadGraph();

  // "Talking back": the logo spins while the answer is written out and/or spoken.
  setBrainState('speaking');
  const spoken = stripMarkdown(res.reply);
  setSubtitle(spoken.split(/(?<=[.!?])\s/)[0].slice(0, 140), true);
  const speakIt = viaVoice && S.state.config.voice.speakReplies && voiceSupported.tts;
  if (speakIt) {
    voice.speak(spoken, { voiceName: S.state.config.voice.voiceName, rate: S.state.config.voice.rate, onStart: () => setBrainState('speaking'), onEnd: () => { setBrainState('idle'); if (voice.handsFree && !voice.listening) voice.start({ handsFree: true }); } });
  }
  await typeOut(body, res.reply);
  if (!speakIt) setTimeout(() => { if (brain.state === 'speaking') setBrainState('idle'); }, 600);

  const tools = document.createElement('div');
  tools.className = 'tools';
  tools.innerHTML = res.sources.slice(0, 5).map((p) => `<button data-src="${esc(p)}">${icon('file-text')} ${esc(p.split('/').pop().replace('.md', ''))}</button>`).join('') +
    `<button data-act="speak">${icon('volume-2')} Speak</button><button data-act="save">${icon('save')} Save to vault</button><button data-act="copy">${icon('copy')} Copy</button>`;
  pending.appendChild(tools);
  tools.querySelectorAll('[data-src]').forEach((b) => b.onclick = () => openNote(b.dataset.src));
  tools.querySelector('[data-act=speak]').onclick = () => {
    setBrainState('speaking');
    voice.speak(spoken, { voiceName: S.state.config.voice.voiceName, rate: S.state.config.voice.rate, onEnd: () => setBrainState('idle') });
  };
  tools.querySelector('[data-act=save]').onclick = async () => {
    const r = await api('/chat/save', { title: text.slice(0, 60), content: res.reply });
    toast('Saved to ' + r.path); loadGraph();
  };
  tools.querySelector('[data-act=copy]').onclick = () => { navigator.clipboard.writeText(res.reply); toast('Copied'); };
  wireWikilinks(pending);
  $('#chat-log', dashboardEl).scrollTop = 1e9;
}

function typeOut(el, text) {
  return new Promise((resolve) => {
    const total = text.length;
    const step = Math.max(6, Math.round(total / 70));
    let i = 0;
    const log = $('#chat-log', dashboardEl);
    const tick = () => {
      i = Math.min(total, i + step);
      el.innerHTML = renderMarkdown(text.slice(0, i));
      log.scrollTop = log.scrollHeight;
      if (i < total) setTimeout(tick, 16); else resolve();
    };
    tick();
  });
}

async function importFile(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const content = await f.text();
  const isDef = /^---[\s\S]*?(name|handle|triggers):/m.test(content);
  if (isDef) {
    const r = await api('/import', { filename: f.name, content });
    toast(`Imported ${r.kind}: ${r.path}`);
    await afterChange({ feed: false });
  } else {
    const r = await api('/vault/note', { path: 'Inbox/' + f.name.replace(/\.(txt|markdown)$/i, '.md'), content });
    toast('Added to your vault: ' + r.path);
    $('#chat-input', dashboardEl).value = `Summarise [[${f.name.replace(/\.(md|txt|markdown)$/i, '')}]] and tell me what matters`;
    loadGraph();
  }
}

// ---------------------------------------------------------------- voice
function setupVoice() {
  voice = new Voice({
    lang: S.state.config.voice.lang || 'en-US',
    onInterim: (t) => { setSubtitle(t, true); $('#chat-input', dashboardEl).value = t; },
    onFinal: (t) => { $('#chat-input', dashboardEl).value = ''; if (!voice.handsFree) voice.stop(); ask(t, { voice: true }); },
    onLevel: (v) => { brain.setLevel(v); },
    onState: (s, err) => {
      $('#mic', dashboardEl).classList.toggle('listening', s === 'listening');
      if (s === 'error') { toast('Microphone: ' + err, 'error'); setBrainState('idle'); }
      else if (s === 'listening') setBrainState('listening');
      else if (brain.state === 'listening') setBrainState('idle');
    },
  });
  voice.wakeName = S.state.config.assistantName.toLowerCase();
}

function toggleMic() {
  if (!voiceSupported.stt) return toast('Voice input needs Chrome or Edge. You can still type.', 'error');
  if (voice.listening) { voice.stop(); setBrainState('idle'); return; }
  try {
    voice.wakeName = S.state.config.assistantName.toLowerCase();
    voice.start({ handsFree: !!S.state.config.voice.handsFree });
    if (S.state.config.voice.handsFree) toast(`Hands-free: say "Hey ${S.state.config.assistantName}, …"`);
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------------- intelligence feed
async function loadFeed() {
  S.feed = await api('/feed?limit=80');
  fillSourceFilter();
  renderFeed(false);
  greet();
}

function fillSourceFilter() {
  const cfg = S.state.config;
  const conns = cfg.connections[cfg.profile] || {};
  const sel = $('#source-filter');
  const opts = [['all', 'All Sources'], ...S.state.connectors.filter((c) => conns[c.id]).map((c) => [c.id, c.name.replace(/ \(.*\)/, '')]), ['system', 'Maestro']];
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}" ${S.source === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
  sel.onchange = () => { S.source = sel.value; renderFeed(false); };
}

function feedItemHtml(i, isNew) {
  const cat = CATEGORY[i.category] || CATEGORY.INSIGHT;
  const meta = [i.priority ? `<span class="pri-${i.priority}">${esc(i.priority)} Priority</span>` : '', i.deadline ? `<span class="dead">${esc(i.deadline)}</span>` : ''].filter(Boolean).join(' · ');
  return `<div class="activity ${isNew ? 'new' : ''}" data-id="${i.id}" style="--c:${cat.c}">
    <div class="agent-icon">${icon(cat.icon)}</div>
    <div class="activity-details">
      <span class="a-time">${timeAgo(i.ts)} · ${esc(i.sourceName)}</span>
      <div class="a-title">${esc(i.title)}</div>
      <div class="a-cat"><span class="pill" style="--pill:${cat.pill};--pill-text:${cat.text}">${esc(i.category)}</span>${i.unread ? '<span class="unread-dot"></span>' : ''}</div>
      ${i.quote ? `<div class="a-quote">${esc(i.quote)}</div>` : ''}
      ${i.summary ? `<div class="a-summary">${esc(i.summary)}</div>` : ''}
      ${meta ? `<div class="a-meta">${meta}</div>` : ''}
      ${typeof i.progress === 'number' ? `<div class="progress"><div class="track"><div class="bar" style="width:${i.progress}%"></div></div><span>${i.progress}%</span></div>` : ''}
      ${i.actions && i.actions.length ? `<div class="a-actions">${i.actions.map((a) => `<button data-action="${esc(a)}">${esc(a)}</button>`).join('')}</div>` : ''}
    </div></div>`;
}

function renderFeed(animateFirst) {
  const list = $('#feed-list');
  const items = S.feed.filter((i) => (S.source === 'all' || i.source === S.source) && (S.category === 'all' || i.category === S.category));
  if (!items.length) {
    list.innerHTML = `<div class="feed-empty">${icon('plug')}<br>No activity yet.<br>Connect sources on the <a href="#connections" data-go>MCP Connections</a> page and notifications will stream in here.</div>`;
    const go = list.querySelector('[data-go]'); if (go) go.onclick = (e) => { e.preventDefault(); navigate('connections'); };
    return;
  }
  list.innerHTML = items.map((i, k) => feedItemHtml(i, animateFirst && k === 0)).join('');
  list.querySelectorAll('.activity').forEach((el) => {
    const item = S.feed.find((x) => x.id === el.dataset.id);
    el.onclick = (e) => {
      if (e.target.closest('[data-action]')) return;
      openFeedItem(item);
    };
    el.querySelectorAll('[data-action]').forEach((b) => b.onclick = async () => {
      await api('/tasks', { text: `${b.dataset.action}: ${item.title}`, priority: item.priority || undefined });
      toast(`Task added: ${b.dataset.action}`);
      markRead(item);
    });
  });
  const unread = S.feed.some((i) => i.unread);
  $('#bell-dot').hidden = !unread;
}

async function markRead(item) {
  if (!item.unread) return;
  item.unread = false;
  api('/feed/read', { id: item.id }).catch(() => {});
  renderFeed(false);
}

function openFeedItem(item) {
  markRead(item);
  const cat = CATEGORY[item.category] || CATEGORY.INSIGHT;
  modal(`${modalHead(esc(item.title), `${esc(item.sourceName)} · ${timeAgo(item.ts)} · ${esc(item.category)}`)}
    ${item.quote ? `<blockquote class="md" style="border-left:3px solid ${cat.c};padding:8px 12px;background:rgba(0,45,76,.35);margin:0 0 10px">${esc(item.quote)}</blockquote>` : ''}
    ${item.summary ? `<p>${esc(item.summary)}</p>` : ''}
    <p class="meta" style="color:var(--muted)">${[item.priority && item.priority + ' priority', item.deadline].filter(Boolean).map(esc).join(' · ')}</p>
    ${item.notePath ? `<p><a href="#" data-note>Open ${esc(item.notePath)}</a></p>` : ''}
    <div class="modal-foot">
      <button class="btn ghost" data-task>${icon('plus')} Make it a task</button>
      <button class="btn primary" data-ask>${icon('sparkles')} Ask ${esc(S.state.config.assistantName)} about this</button>
    </div>`, {
    onMount: (el, close) => {
      el.querySelector('[data-ask]').onclick = () => { close(); ask(`Help me with this ${item.category.toLowerCase()} from ${item.sourceName}: "${item.title}". ${item.quote || ''} What should I do?`); };
      el.querySelector('[data-task]').onclick = async () => { await api('/tasks', { text: item.title, priority: item.priority || undefined }); toast('Task added'); close(); };
      const n = el.querySelector('[data-note]'); if (n) n.onclick = (e) => { e.preventDefault(); close(); openNote(item.notePath); };
    },
  });
}

function visibleNow(item) {
  const cfg = S.state.config;
  if (item.profile !== cfg.profile && item.profile !== 'both') return false;
  if (item.pack && !cfg.packs.includes(item.pack)) return false;
  if (item.source === 'system') return true;
  return !!(cfg.connections[cfg.profile] || {})[item.source];
}

function connectStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('feed', (e) => {
    const item = JSON.parse(e.data);
    if (!visibleNow(item)) return;
    S.feed = [item, ...S.feed.filter((x) => x.id !== item.id)];
    renderFeed(true);
    const cat = CATEGORY[item.category] || CATEGORY.INSIGHT;
    if (brain) brain.pulseSource(item.source, cat.c);
    if (item.notePath) loadGraph();
  });
  es.addEventListener('profile', () => afterChange());
}

// header + feed controls
$('#bell').onclick = async () => {
  await api('/feed/read-all', {});
  S.feed.forEach((i) => { i.unread = false; });
  renderFeed(false);
  $('#feed').classList.add('open');
  toast('All caught up');
};
$('#prefs').onclick = () => navigate('settings');
$('#feed-toggle').onclick = () => $('#feed').classList.toggle('open');
$('#feed-all').onclick = () => { S.source = 'all'; S.category = 'all'; fillSourceFilter(); renderFeed(false); $('#feed-list').scrollTop = 0; };
$('#live-toggle').onclick = async () => {
  S.livePaused = !S.livePaused;
  await api('/settings', { demo: { liveFeed: !S.livePaused } });
  renderShell();
  toast(S.livePaused ? 'Live demo feed paused' : 'Live demo feed resumed');
};
$('#cat-filter').onclick = () => {
  const cats = ['all', ...Object.keys(CATEGORY)];
  modal(`${modalHead('Filter by category')}<div class="grid" style="grid-template-columns:repeat(2,1fr)">${cats.map((c) => `<button class="choice ${S.category === c ? 'on' : ''}" data-c="${c}">${icon(c === 'all' ? 'layout-grid' : CATEGORY[c].icon)}<div><b>${c === 'all' ? 'Everything' : c}</b></div></button>`).join('')}</div>`, {
    onMount: (el, close) => el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { S.category = b.dataset.c; renderFeed(false); close(); }),
  });
};

boot().catch((e) => { document.body.innerHTML = `<pre style="padding:40px;color:#ff6b81">Maestro failed to start: ${esc(e.message)}\n\nIs the server running? Start it with: npm start</pre>`; });
