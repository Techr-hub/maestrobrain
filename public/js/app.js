// Maestro Control Centre: shell, brain dashboard, chat + voice, and the live intelligence feed.
import { icon, CATEGORY } from './icons.js';
import { renderMarkdown, stripMarkdown, esc } from './md.js';
import { BrainMap, avatar as makeAvatar, GROUP_COLORS } from './brainmap.js';
import { Voice, voiceSupported } from './voice.js';
import { S, api, refreshState, toast, timeAgo, modal, modalHead, openNote, wireWikilinks, closeDrawer } from './core.js';
import { PAGES, onboarding, knowledgeModal, connectModal } from './pages.js';

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

const SHORT = { gmail: 'GM', outlook: 'OL', email: '@', icalendar: 'iC', gcal: 'GC', calendly: 'CY', slack: '#', twilio_sms: 'TX', whatsapp: 'WA', twilio_calls: 'PH', google_meet: 'MT', teams: 'TM', zoom: 'ZM', linear: 'LN', jira: 'JR', notion: 'N', figma: 'FG', gdrive: 'GD', github: 'GH', docs: 'DC' };

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

// Collapsible sidebar: icons only when collapsed (the default), remembered per browser.
function applySidebar() {
  let collapsed = true;
  try { collapsed = localStorage.getItem('maestro.sidebar') !== 'open'; } catch { /* storage blocked */ }
  document.querySelector('.workspace').classList.toggle('collapsed', collapsed);
  const t = $('#sidebar-toggle');
  t.title = collapsed ? 'Expand menu' : 'Collapse menu';
  t.querySelector('.toggle-icon').innerHTML = icon(collapsed ? 'panel-left-open' : 'panel-left');
  if (brain) setTimeout(() => brain.resize(), 220);
}
$('#sidebar-toggle').onclick = () => {
  const collapsed = document.querySelector('.workspace').classList.contains('collapsed');
  try { localStorage.setItem('maestro.sidebar', collapsed ? 'open' : 'closed'); } catch { /* storage blocked */ }
  applySidebar();
};

// Top-bar Man / Woman switch: picks the most natural voice of that kind and says hello in it.
async function setVoiceGender(gender) {
  if (S.state.config.voice.gender === gender && !S.state.config.voice.voiceName) return;
  // A specific voice chosen in Settings would override the switch, so clear it.
  S.state.config.voice = { ...S.state.config.voice, gender, voiceName: '' };
  renderShell();
  try { await api('/settings', { voice: { gender, voiceName: '' } }); } catch { /* the next save retries */ }
  const v = voice.bestVoice(gender);
  toast(v ? `Maestro now speaks as ${v.name.replace(/^Microsoft |^Google /, '').replace(/ Online \(Natural\)| - English.*$/, '')}` : 'Voice saved');
  voice.speak("Hi, it's Maestro. How do I sound?", { gender, rate: S.state.config.voice.rate, pause: S.state.config.voice.pause });
}

function renderShell() {
  applySidebar();
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
  const vs = $('#voice-switch');
  const gender = (cfg.voice && cfg.voice.gender) || 'male';
  vs.querySelector('[data-gender=male]').innerHTML = `${icon('user-round')} Man`;
  vs.querySelector('[data-gender=female]').innerHTML = `${icon('user-round')} Woman`;
  vs.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.gender === gender;
    b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
    b.onclick = () => setVoiceGender(b.dataset.gender);
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
    <div class="subtitle online" id="subtitle"><i class="dot"></i>Maestro Online</div>
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
          <button class="mic-btn ${voice && voice.active ? 'listening' : ''}" id="mic" aria-pressed="${!!(voice && voice.active)}" title="Talk to your brain. Click once to keep the mic on, again to turn it off (Alt+V)">${icon('mic')}</button>
          <button class="send-btn" id="send" title="Send">${icon('send')}</button>
        </div>
        <div class="mentions" id="mentions"></div>
      </div>
    </div>`;

  brain = new BrainMap(dashboardEl.querySelector('#brain-canvas'), {
    tooltip: dashboardEl.querySelector('#brain-tip'),
    onNodeClick: (n) => (n.kind === 'note' ? openNote(n.id) : showSource(n.id)), // hubs use 'hub:<id>'
    onLayout: (b) => { const st = dashboardEl.querySelector('#subtitle'); if (st) { st.style.top = b.subY + 'px'; st.style.left = b.subX + 'px'; } },
  });
  window.maestroBrain = brain;
  api('/hubs').then((h) => { S.hubs = h; updateBrainSources(); }).catch(() => {}); // handy for debugging in the browser console
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

// Shades of a hub's colour for its sub-categories: lighter to darker around the base hue.
function shade(hexColor, i, n) {
  const v = parseInt(hexColor.slice(1), 16);
  let r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, sat = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = Math.min(0.85, Math.max(0.3, l + (n > 1 ? 0.22 - (0.44 * i) / (n - 1) : 0.12)));
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return '#' + [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

function updateBrainSources() {
  const cfg = S.state.config;
  const conns = cfg.connections[cfg.profile] || {};
  // Five default hubs always sit on the orbit. Each source joins the map, next to its hub, only once it's connected.
  const hubs = S.hubs || [];
  const list = hubs.map((h) => ({ id: 'hub:' + h.id, name: h.name, color: h.color, short: h.short, hub: true, members: h.members,
    connected: h.projects || h.members.some((m) => conns[m]), error: h.members.some((m) => conns[m] && conns[m].lastError) }));
  for (const h of hubs) {
    // Sub-categories: the hub's "always" ones (e.g. Calls → Meet, Phone, Teams, Zoom) plus anything connected.
    const subs = h.members.filter((m) => conns[m] || (h.always || []).includes(m));
    subs.forEach((m, i) => {
      const c = S.state.connectors.find((x) => x.id === m);
      if (!c) return;
      list.push({ id: m, name: c.short || c.name, color: shade(h.color, i, subs.length), short: SHORT[m], parent: 'hub:' + h.id, connected: !!conns[m], error: !!(conns[m] && conns[m].lastError) });
    });
  }
  brain && brain.setSources(list);
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

function setSubtitle(text, speaking = false, online = false) {
  const el = $('#subtitle', dashboardEl);
  el.textContent = text;
  if (online) el.insertAdjacentHTML('afterbegin', '<i class="dot"></i>');
  el.classList.toggle('speaking', speaking);
  el.classList.toggle('online', online);
}

function setBrainState(state) {
  brain.setState(state);
  // The sidebar logo stays still; only the brain core in the map reacts to voice.
  const label = { idle: 'Maestro Online', listening: 'Listening…', thinking: 'Thinking…', speaking: '' }[state];
  if (label !== '') setSubtitle(label, false, state === 'idle');
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
  if (res.actions.some((a) => a.type === 'event')) brain.pulseSource('hub:calendar', '#00e5ff');

  // "Talking back": the logo spins while the answer is written out and/or spoken.
  setBrainState('speaking');
  const spoken = stripMarkdown(res.reply);
  setSubtitle(spoken.split(/(?<=[.!?])\s/)[0].slice(0, 140), true);
  const speakIt = viaVoice && S.state.config.voice.speakReplies && voiceSupported.tts;
  if (speakIt) {
    voice.speak(spoken, { voiceName: S.state.config.voice.voiceName, gender: S.state.config.voice.gender, rate: S.state.config.voice.rate, pause: S.state.config.voice.pause, onStart: () => setBrainState('speaking'), onEnd: () => setBrainState(voice.active ? 'listening' : 'idle') });
  }
  await typeOut(body, res.reply);
  if (!speakIt) setTimeout(() => { if (brain.state === 'speaking') setBrainState('idle'); }, 600);

  const tools = document.createElement('div');
  tools.className = 'tools';
  tools.innerHTML = res.sources.slice(0, 5).map((p) => `<button data-src="${esc(p)}">${icon('file-text')} ${esc(p.split('/').pop().replace('.md', ''))}</button>`).join('') +
    `<button data-act="speak">${icon('volume-2')} Speak</button><button data-act="save">${icon('save')} Save to vault</button><button data-act="copy">${icon('copy')} Copy</button>`;
  // Overview replies end with "Which do you want to hear more about: a, b or c?" Offer those as one-tap follow-ups.
  const follow = res.reply.match(/hear more about: ([^?\n]+)\?/i);
  if (follow) {
    const opts = follow[1].split(/,\s*|\s+or\s+/).map((s) => s.trim()).filter(Boolean);
    const row = document.createElement('div');
    row.className = 'suggestions followups';
    row.innerHTML = opts.map((o) => `<button class="suggestion" data-q="${esc(o)}">${esc(o[0].toUpperCase() + o.slice(1))}</button>`).join('') + '<button class="suggestion" data-q="everything">Everything</button>';
    row.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { row.remove(); ask(b.dataset.q, { voice: viaVoice }); });
    pending.appendChild(row);
  }
  pending.appendChild(tools);
  tools.querySelectorAll('[data-src]').forEach((b) => b.onclick = () => openNote(b.dataset.src));
  tools.querySelector('[data-act=speak]').onclick = () => {
    setBrainState('speaking');
    voice.speak(spoken, { voiceName: S.state.config.voice.voiceName, gender: S.state.config.voice.gender, rate: S.state.config.voice.rate, pause: S.state.config.voice.pause, onEnd: () => setBrainState('idle') });
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
    onFinal: (t) => { $('#chat-input', dashboardEl).value = ''; ask(t, { voice: true }); }, // the mic stays on until you switch it off
    onInterrupt: () => { setBrainState('listening'); setSubtitle('Listening…', true); },
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
  const mic = $('#mic', dashboardEl);
  // The mic button is an on/off switch: on, you can talk to Maestro at any point, even while it's speaking.
  if (voice.active || voice.listening) {
    voice.stop(); voice.stopSpeaking(); setBrainState('idle');
    if (mic) { mic.classList.remove('listening'); mic.title = 'Talk to your brain (Alt+V)'; mic.setAttribute('aria-pressed', 'false'); }
    toast('Mic off');
    return;
  }
  try {
    voice.wakeName = S.state.config.assistantName.toLowerCase();
    const wake = !!S.state.config.voice.handsFree;
    voice.start({ wakeWord: wake });
    if (mic) { mic.title = 'Mic is on: talk any time. Click to turn it off (Alt+V)'; mic.setAttribute('aria-pressed', 'true'); }
    toast(wake ? `Mic on. Start with "Hey ${S.state.config.assistantName}…". Click the mic again to turn it off.` : 'Mic on. Talk any time, or talk over me to interrupt. Click the mic again to turn it off.');
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------------- intelligence feed
async function loadFeed() {
  S.feed = await api('/feed?limit=80');
  fillSourceFilter();
  renderFeed(false);
  greet();
}

// Add items to the feed without duplicates, newest first.
function mergeFeed(items) {
  const ids = new Set(items.map((i) => i.id));
  S.feed = [...items, ...S.feed.filter((x) => !ids.has(x.id))].sort((a, b) => b.ts - a.ts);
}

function fillSourceFilter() {
  const cfg = S.state.config;
  const conns = cfg.connections[cfg.profile] || {};
  const sel = $('#source-filter');
  const opts = [['all', 'All Sources'], ...S.state.connectors.filter((c) => conns[c.id]).map((c) => [c.id, c.name.replace(/ \(.*\)/, '')]), ['system', 'Maestro']];
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}" ${S.source === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
  sel.onchange = async () => {
    S.sourceView = null; S.source = sel.value;
    if (S.source !== 'all') { // pull that source's own history, so older cards aren't hidden behind the 80-item window
      try { mergeFeed(await api(`/feed?source=${encodeURIComponent(S.source)}&limit=80`)); } catch {}
    }
    renderFeed(false);
  };
}

// Small marks for each calendar so cards from different calendars are easy to tell apart.
const CAL_MARK = {
  gcal: (d) => `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="14" height="14" rx="3" fill="#fff"/><path d="M1 4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v1H1z" fill="#4285f4"/><path d="M15 12v1a2 2 0 0 1-2 2h-2l4-4z" fill="#34a853"/><path d="M1 12v1a2 2 0 0 0 2 2h2l-4-4z" fill="#fbbc04"/><text x="8" y="12.4" text-anchor="middle" font-size="7" font-weight="700" font-family="Arial,sans-serif" fill="#4285f4">${d}</text></svg>`,
  icalendar: (d) => `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="14" height="14" rx="3" fill="#fff"/><path d="M1 4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v1.5H1z" fill="#ff3b30"/><text x="8" y="13" text-anchor="middle" font-size="7.5" font-weight="700" font-family="Arial,sans-serif" fill="#1c1c1e">${d}</text></svg>`,
  outlook: () => `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="14" height="14" rx="3" fill="#0f6cbd"/><circle cx="8" cy="8" r="3.6" fill="none" stroke="#fff" stroke-width="1.8"/></svg>`,
  calendly: () => `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="#006bff"/><path d="M10.6 5.6A3.4 3.4 0 1 0 10.6 10.4" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  maestro: () => `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="14" height="14" rx="3" fill="#00f2af"/><text x="8" y="11.6" text-anchor="middle" font-size="8" font-weight="700" font-family="Arial,sans-serif" fill="#01121c">M</text></svg>`,
};
function sourceChip(i) {
  const c = S.state && S.state.connectors.find((x) => x.id === i.source);
  const color = i.source === 'maestro' ? '#00f2af' : (c && c.color) || '#00e5ff';
  const mark = CAL_MARK[i.source] ? CAL_MARK[i.source](new Date().getDate()) : icon((c && c.icon) || (i.source === 'system' ? 'brain' : 'plug'));
  const name = (i.sourceName || '').replace(/ \(.*\)/, '').replace(' / Microsoft 365', '');
  return `<span class="src-chip ${CAL_MARK[i.source] ? 'cal' : ''}" style="--sc:${color}">${mark}<b>${esc(name)}</b>${i.calendarName ? `<i>${esc(i.calendarName)}</i>` : ''}</span>`;
}

function feedItemHtml(i, isNew) {
  const cat = CATEGORY[i.category] || CATEGORY.INSIGHT;
  const meta = [i.priority ? `<span class="pri-${i.priority}">${esc(i.priority)} Priority</span>` : '', i.deadline ? `<span class="dead">${esc(i.deadline)}</span>` : ''].filter(Boolean).join(' · ');
  const calColor = CAL_MARK[i.source] && i.source !== 'maestro' ? ((S.state.connectors.find((x) => x.id === i.source) || {}).color || cat.c) : cat.c; // calendar cards take their calendar's colour
  return `<div class="activity ${isNew ? 'new' : ''} ${i.removed ? 'removed' : ''} ${i.pinned ? 'pinned' : ''}" data-id="${i.id}" style="--c:${calColor}">
    <div class="agent-icon">${icon(cat.icon)}</div>
    <div class="activity-details">
      <div class="a-head">${sourceChip(i)}<span class="a-time">${timeAgo(i.ts)}</span><button class="pin-btn ${i.pinned ? 'on' : ''}" data-pin title="${i.pinned ? 'Unpin' : 'Pin to the top of the feed'}" aria-label="${i.pinned ? 'Unpin card' : 'Pin card'}" aria-pressed="${!!i.pinned}">${icon('pin')}${i.pinned ? '<span>Pinned</span>' : ''}</button></div>
      <div class="a-title">${esc(i.title)}</div>
      <div class="a-cat"><span class="pill" style="--pill:${cat.pill};--pill-text:${cat.text}">${esc(i.category)}</span>${i.removed ? '<span class="pill removed-pill">Removed</span>' : ''}${i.unread && !i.removed ? '<span class="unread-dot"></span>' : ''}</div>
      ${i.quote ? `<div class="a-quote">${esc(i.quote)}</div>` : ''}
      ${i.summary ? `<div class="a-summary">${esc(i.summary)}</div>` : ''}
      ${meta ? `<div class="a-meta">${meta}</div>` : ''}
      ${typeof i.progress === 'number' ? `<div class="progress"><div class="track"><div class="bar" style="width:${i.progress}%"></div></div><span>${i.progress}%</span></div>` : ''}
      ${i.actions && i.actions.length && !i.removed ? `<div class="a-actions">${i.actions.map((a) => `<button data-action="${esc(a)}">${esc(a)}</button>`).join('')}</div>` : ''}
    </div></div>`;
}

// Pinned cards first (most recently pinned on top), then newest first.
const pinFirst = (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.pinned ? (b.pinnedAt || 0) - (a.pinnedAt || 0) : 0) || b.ts - a.ts;

function renderFeed(animateFirst) {
  if (S.sourceView) return renderSourceView();
  const list = $('#feed-list');
  const items = S.feed.filter((i) => (S.source === 'all' || i.source === S.source) && (S.category === 'all' || i.category === S.category)).sort(pinFirst);
  const cfgNow = S.state.config, srcConn = S.source !== 'all' ? (cfgNow.connections[cfgNow.profile] || {})[S.source] : null;
  if (!items.length && srcConn && srcConn.mode === 'claude') { showSource(S.source); return; } // shows how to sync it from Claude
  if (!items.length && srcConn && srcConn.mode === 'live' && S.source === 'slack' && !(srcConn.fields && srcConn.fields.channels && srcConn.fields.channels.length)) {
    list.innerHTML = `<div class="feed-empty">${icon('hash')}<br>Slack is connected, but no channels are picked yet.<br>Open the Slack card on <a href="#connections" data-go>MCP Connections</a> and tick the channels to follow.</div>`;
    return;
  }
  if (!items.length) {
    list.innerHTML = `<div class="feed-empty">${icon('plug')}<br>No activity yet.<br>Connect sources on the <a href="#connections" data-go>MCP Connections</a> page and notifications will stream in here.</div>`;
    const go = list.querySelector('[data-go]'); if (go) go.onclick = (e) => { e.preventDefault(); navigate('connections'); };
    return;
  }
  list.innerHTML = items.map((i, k) => feedItemHtml(i, animateFirst && k === 0)).join('');
  list.querySelectorAll('.activity').forEach((el) => {
    const item = S.feed.find((x) => x.id === el.dataset.id);
    el.onclick = (e) => {
      if (e.target.closest('[data-action],[data-pin]')) return;
      openFeedItem(item);
    };
    el.querySelector('[data-pin]').onclick = async (e) => {
      e.stopPropagation();
      const pinned = !item.pinned;
      Object.assign(item, { pinned, pinnedAt: pinned ? Date.now() : 0 });
      renderFeed(false);
      try { await api('/feed/pin', { id: item.id, pinned }); } catch (err) { toast('Could not pin: ' + err.message, 'error'); }
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

// ---------------------------------------------------------------- source view (click a source on the brain map)
async function showSource(id) {
  S.sourceView = id;
  $('#feed').classList.add('open');
  $('#feed-list').innerHTML = '<div class="feed-empty">Loading…</div>';
  try { S.sourceData = await api('/source?id=' + encodeURIComponent(id)); } catch (e) { S.sourceData = { id, name: id, connected: false, error: e.message, events: [], items: [] }; }
  if (S.sourceView === id) { renderSourceView(); $('#feed-list').scrollTop = 0; }
}

function closeSource() { S.sourceView = null; S.sourceData = null; if (brain) brain.selectedSource = null; renderFeed(false); }

function dayLabel(d) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((x - t) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : new Date(d).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function renderSourceView() {
  const d = S.sourceData; if (!d) return;
  if (d.hub) return renderHubView(d);
  const list = $('#feed-list');
  const conn = S.state.connectors.find((c) => c.id === d.id) || { name: d.name, color: '#00e5ff', icon: 'plug' };
  const mode = !d.connected ? '<span class="tag off">Not connected</span>' : d.error ? '<span class="tag err">● Error</span>' : d.mode === 'live' ? '<span class="tag live">● Live</span>' : d.mode === 'claude' ? '<span class="tag live">● Live in Claude</span>' : '<span class="tag demo">● Demo data</span>';
  let html = `<div class="src-head" style="--c:${conn.color}"><button class="src-back" id="src-back" title="Back to all activity">${icon('arrow-right')}</button><span class="agent-icon">${icon(conn.icon)}</span><div><b>${esc(conn.name)}</b><div>${mode}</div></div></div>`;
  // Not connected or failing: show it as a notification with a button to fix it.
  if (!d.connected || d.error) {
    html += `<div class="activity notice ${d.error ? 'err' : ''}" style="--c:${d.error ? '#ff4d6d' : '#3d8bff'}">
      <div class="agent-icon">${icon('plug')}</div>
      <div class="activity-details">
        <span class="a-time">just now · Maestro</span>
        <div class="a-title">${d.error ? `${esc(conn.name)} connection failed` : `${esc(conn.name)} isn't connected`}</div>
        <div class="a-cat"><span class="pill" style="--pill:${d.error ? '#4a0f1c' : '#0d2a55'};--pill-text:${d.error ? '#ff8095' : '#8bb8ff'}">CONNECTION</span></div>
        <div class="a-quote">${d.error ? esc(d.error) : d.kind === 'calendar' ? `Connect ${esc(conn.name)} to see your schedule here.` : `Connect ${esc(conn.name)} to stream its notifications into your feed.`}</div>
        <div class="a-actions"><button class="btn small connect" id="src-connect">${icon('plug')} Make Connection</button></div>
      </div></div>`;
  }
  if (d.connected && d.kind === 'calendar') {
    const byDay = new Map();
    for (const e of d.events) { const k = dayLabel(e.start); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); }
    const now = Date.now();
    html += `<div class="section-title" style="margin:14px 4px 6px">Schedule · next 7 days</div>`;
    html += byDay.size ? [...byDay].map(([day, evs]) => `<div class="sched-day"><div class="sched-label">${esc(day)}</div>${evs.map((e) => {
      const st = new Date(e.start), en = new Date(e.end), past = en < now, nowOn = st <= now && en >= now;
      return `<div class="sched-ev ${past ? 'past' : ''} ${nowOn ? 'now' : ''}" style="--c:${conn.color}" ${e.notes ? `data-note="${esc(e.notes)}"` : ''}>
        <div class="sched-time">${st.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}<small>${Math.round((en - st) / 60000)} min</small></div>
        <div class="sched-body"><b>${esc(e.title)}</b>${nowOn ? ' <span class="tag live">Now</span>' : ''}
          ${e.attendees ? `<small>${icon('users-round')} ${esc(e.attendees.join(', '))}</small>` : ''}${e.location ? `<small>${icon('home')} ${esc(e.location)}</small>` : ''}${e.notes ? `<small class="lnk">${icon('file-text')} Prep notes</small>` : ''}</div></div>`;
    }).join('')}</div>`).join('') : `<div class="feed-empty" style="padding:18px">Nothing on this calendar in the next 7 days.</div>`;
  }
  const items = d.connected ? S.feed.filter((i) => i.source === d.id) : [];
  if (d.connected) {
    html += `<div class="section-title" style="margin:14px 4px 6px">Recent activity</div>`;
    if (!items.length && d.mode === 'claude') {
      const canLive = conn.live && conn.live.includes('dashboard');
      html += `<div class="activity notice" style="--c:#8b5cff">
        <div class="agent-icon">${icon('sparkles')}</div>
        <div class="activity-details">
          <span class="a-time">Maestro</span>
          <div class="a-title">Ask Claude to bring ${esc(conn.name)} in</div>
          <div class="a-quote">Claude Desktop's ${esc(conn.name)} connector only works inside Claude, so Maestro can't read it by itself. In Claude Desktop, click <b>+</b> → <b>Maestro</b> → <b>Sync my Claude connectors into Maestro</b>, or just type the request below. New items land here a few seconds later.${canLive ? ` To stream ${esc(conn.name)} automatically instead, connect it live with a token.` : ''}</div>
          <div class="a-actions"><button class="btn small" id="src-copy">${icon('copy')} Copy request for Claude</button>${canLive ? `<button class="btn small connect" id="src-connect">${icon('plug')} Connect live instead</button>` : ''}</div>
        </div></div>`;
    } else html += items.length ? items.map((i) => feedItemHtml(i, false)).join('') : `<div class="feed-empty" style="padding:18px">No recent activity from ${esc(conn.name)}.</div>`;
  }
  list.innerHTML = html;
  list.querySelector('#src-back').onclick = closeSource;
  const mk = list.querySelector('#src-connect');
  if (mk) mk.onclick = () => {
    const c = S.state.connectors.find((x) => x.id === d.id);
    connectModal(c, S.state.config.profile, async () => { await afterChange({ graph: false }); showSource(d.id); });
  };
  const cp = list.querySelector('#src-copy');
  if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(`Sync my ${conn.name} into Maestro: read my latest ${conn.name} activity with your connector and add it with the Maestro add_feed_items tool.`); toast('Copied. Paste it into Claude Desktop.'); } catch { toast('Copy failed. Use the Maestro prompt in Claude Desktop instead.', 'error'); } };
  list.querySelectorAll('[data-note]').forEach((el) => el.onclick = () => openNote(el.dataset.note));
  list.querySelectorAll('.activity[data-id]').forEach((el) => {
    const item = S.feed.find((x) => x.id === el.dataset.id);
    el.onclick = (e) => { if (!e.target.closest('[data-action]')) openFeedItem(item); };
    el.querySelectorAll('[data-action]').forEach((b) => b.onclick = async () => { await api('/tasks', { text: `${b.dataset.action}: ${item.title}`, priority: item.priority || undefined }); toast(`Task added: ${b.dataset.action}`); markRead(item); });
  });
}

function scheduleHtml(events, color) {
  const byDay = new Map();
  for (const e of events) { const k = dayLabel(e.start); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); }
  const now = Date.now();
  return byDay.size ? [...byDay].map(([day, evs]) => `<div class="sched-day"><div class="sched-label">${esc(day)}</div>${evs.map((e) => {
    const st = new Date(e.start), en = new Date(e.end), past = en < now, nowOn = st <= now && en >= now;
    const src = S.state.connectors.find((c) => c.id === e.source);
    return `<div class="sched-ev ${past ? 'past' : ''} ${nowOn ? 'now' : ''}" style="--c:${src ? src.color : color}" ${e.notes ? `data-note="${esc(e.notes)}"` : ''}>
      <div class="sched-time">${st.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}<small>${Math.round((en - st) / 60000)} min</small></div>
      <div class="sched-body"><b>${esc(e.title)}</b>${nowOn ? ' <span class="tag live">Now</span>' : ''}
        ${e.attendees ? `<small>${icon('users-round')} ${esc(e.attendees.join(', '))}</small>` : ''}${e.location ? `<small>${icon('home')} ${esc(e.location)}</small>` : ''}${src ? `<small>${icon('calendar-days')} ${esc(src.name.replace(/ \/.*$/, ''))}</small>` : ''}${e.notes ? `<small class="lnk">${icon('file-text')} Prep notes</small>` : ''}</div></div>`;
  }).join('')}</div>`).join('') : `<div class="feed-empty" style="padding:18px">Nothing scheduled in the next 7 days.</div>`;
}

// A hub (Email, Calendar, Messages, Calls, Projects): everything from its connected sources in one place.
function renderHubView(d) {
  const list = $('#feed-list');
  const on = d.members.filter((m) => m.connected), bad = d.members.filter((m) => m.error);
  let html = `<div class="src-head" style="--c:${d.color}"><button class="src-back" id="src-back" title="Back to all activity">${icon('arrow-right')}</button><span class="agent-icon">${icon({ calendar: 'calendar-days', projects: 'folder' }[d.kind] || { 'hub:email': 'mail', 'hub:messages': 'message-square', 'hub:calls': 'phone' }[d.id] || 'plug')}</span><div><b>${esc(d.name)}</b><div class="hub-chips">${d.members.map((m) => `<button class="hub-chip ${m.connected ? (m.error ? 'err' : 'on') : ''}" data-member="${m.id}" title="${m.connected ? 'Manage' : 'Connect'} ${esc(m.name)}">${m.connected ? '● ' : '+ '}${esc(m.name.replace(/ \(.*\)/, '').replace(' / Microsoft 365', ''))}</button>`).join('')}</div></div></div>`;
  const notice = (title, text, err, member) => `<div class="activity notice ${err ? 'err' : ''}" style="--c:${err ? '#ff4d6d' : '#3d8bff'}">
      <div class="agent-icon">${icon('plug')}</div><div class="activity-details">
      <span class="a-time">just now · Maestro</span><div class="a-title">${title}</div>
      <div class="a-cat"><span class="pill" style="--pill:${err ? '#4a0f1c' : '#0d2a55'};--pill-text:${err ? '#ff8095' : '#8bb8ff'}">CONNECTION</span></div>
      <div class="a-quote">${text}</div>
      <div class="a-actions"><button class="btn small connect" data-make="${member || ''}">${icon('plug')} Make Connection</button></div></div></div>`;
  if (!on.length && d.kind !== 'projects') html += notice(`No ${esc(d.name.toLowerCase())} connected yet`, `Connect ${d.members.map((m) => esc(m.name)).join(', ').replace(/, ([^,]*)$/, ' or $1')} to ${d.kind === 'calendar' ? 'see your schedule here' : 'stream it into your feed'}.`, false, '');
  for (const m of bad) html += notice(`${esc(m.name)} connection failed`, esc(m.error), true, m.id);
  if (d.kind === 'calendar' && on.length) html += `<div class="section-title" style="margin:14px 4px 6px">Schedule · next 7 days</div>` + scheduleHtml(d.events, d.color);
  if (d.kind === 'projects') {
    html += `<div class="section-title" style="margin:14px 4px 6px">Projects in your vault</div>` + (d.notes.length ? d.notes.map((n) => `<div class="sched-ev" style="--c:${d.color}" data-note="${esc(n.path)}"><div class="sched-body" style="flex:1"><b>${esc(n.title)}</b>${n.status ? `<small>${esc(n.status)}${n.due ? ' · due ' + esc(n.due) : ''}</small>` : ''}${typeof n.progress === 'number' && !isNaN(n.progress) ? `<div class="progress"><div class="track"><div class="bar" style="width:${n.progress}%"></div></div><span>${n.progress}%</span></div>` : ''}</div></div>`).join('') : '<div class="feed-empty" style="padding:18px">No project notes yet. Add notes to the Projects folder.</div>');
    if (!on.length) html += notice('Connect a project tool', 'Install a role pack, then connect Linear, Jira, Notion, GitHub or Figma to stream updates here.', false, '');
  }
  const ids = new Set(on.map((m) => m.id));
  const items = S.feed.filter((i) => d.categories.includes(i.category) && (ids.has(i.source) || (d.kind === 'projects' && i.source === 'system')));
  if (on.length || d.kind === 'projects') {
    html += `<div class="section-title" style="margin:14px 4px 6px">Recent activity</div>`;
    html += items.length ? items.map((i) => feedItemHtml(i, false)).join('') : `<div class="feed-empty" style="padding:18px">Nothing new.</div>`;
  }
  list.innerHTML = html;
  list.querySelector('#src-back').onclick = closeSource;
  const prof = S.state.config.profile;
  const openConnect = (mid) => {
    const c = S.state.connectors.find((x) => x.id === mid);
    connectModal(c, prof, async () => { await afterChange({ graph: false }); showSource(d.id); });
  };
  list.querySelectorAll('[data-member]').forEach((b) => b.onclick = () => openConnect(b.dataset.member));
  list.querySelectorAll('[data-make]').forEach((b) => b.onclick = () => b.dataset.make ? openConnect(b.dataset.make) : pickConnection(d, openConnect));
  list.querySelectorAll('[data-note]').forEach((el) => el.onclick = () => openNote(el.dataset.note));
  list.querySelectorAll('.activity[data-id]').forEach((el) => {
    const item = S.feed.find((x) => x.id === el.dataset.id);
    el.onclick = (e) => { if (!e.target.closest('[data-action]')) openFeedItem(item); };
    el.querySelectorAll('[data-action]').forEach((b) => b.onclick = async () => { await api('/tasks', { text: `${b.dataset.action}: ${item.title}`, priority: item.priority || undefined }); toast(`Task added: ${b.dataset.action}`); markRead(item); });
  });
}

// "Make Connection" on a hub: pick which service to connect.
function pickConnection(d, openConnect) {
  const m = modal(`${modalHead(`Connect ${esc(d.name.toLowerCase())}`, 'Choose a service. You can connect more than one.')}
    ${d.members.map((x) => { const c = S.state.connectors.find((y) => y.id === x.id); return `<button class="choice" data-pick="${x.id}"><span class="agent-icon" style="--c:${c.color};width:30px;height:30px;font-size:16px">${icon(c.icon)}</span><div><b>${esc(c.name)}</b><span>${esc(c.description)}</span></div>${x.connected ? '<span class="tag live" style="margin-left:auto">● Connected</span>' : ''}</button>`; }).join('')}`, {
    onMount: (el, close) => el.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => { close(); openConnect(b.dataset.pick); }),
  });
  return m;
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
    mergeFeed([item]);
    renderFeed(true);
    const cat = CATEGORY[item.category] || CATEGORY.INSIGHT;
    if (brain) brain.pulseSource(item.source, cat.c);
    if (item.notePath) loadGraph();
  });
  es.addEventListener('feed-update', (e) => { // e.g. a removed calendar event: its cards turn grey
    const item = JSON.parse(e.data);
    if (!S.feed.some((x) => x.id === item.id)) return;
    mergeFeed([item]);
    if (S.sourceView && S.sourceData) { S.sourceData.items = (S.sourceData.items || []).map((x) => (x.id === item.id ? item : x)); }
    renderFeed(false);
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
$('#feed-all').onclick = () => { S.sourceView = null; S.source = 'all'; S.category = 'all'; fillSourceFilter(); renderFeed(false); $('#feed-list').scrollTop = 0; };
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
