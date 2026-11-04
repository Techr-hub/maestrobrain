// All non-dashboard pages: Agents, MCP Connections, Tasks, Calendar, Knowledge, Skills & Packs,
// Conversations, Workflows, Settings, plus the first-run onboarding.
import { icon, CATEGORY } from './icons.js';
import { renderMarkdown, esc } from './md.js';
import { S, api, refreshState, toast, timeAgo, modal, modalHead, openNote, wireWikilinks, obsidianUrl } from './core.js';
import { voiceSupported, Voice, rankVoices, voiceScore, voiceGender } from './voice.js';
import { weekCalendar } from './calendar-ui.js';

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
    const tag = s ? (s.mode === 'live' ? `<span class="tag live">● Live</span>` : s.mode === 'claude' ? `<span class="tag live">● Live in Claude</span>` : `<span class="tag demo">● Demo data</span>`) : `<span class="tag off">Not connected</span>`;
    const canLive = c.live && c.live.includes('dashboard');
    return `<div class="card accent" style="--c:${c.color};border-top-color:${s ? c.color : 'var(--line)'}">
      <h4><span class="agent-icon" style="--c:${c.color};width:34px;height:34px;font-size:18px">${icon(c.icon)}</span><div>${esc(c.name)}<div class="meta">${esc(CATEGORY[c.category] ? c.category : '')}</div></div></h4>
      <p>${esc(c.description)}</p>
      <div class="row">${tag}${canLive ? '<span class="tag">Live-capable</span>' : '<span class="tag">Live via Claude</span>'}</div>
      ${s && s.message ? `<div class="meta">${esc(s.message)}</div>` : ''}
      <div class="row">${connectButton(!!s, `data-cfg="${c.id}"`)}</div>
    </div>`;
  };
  const kb = st.knowledge;
  const kbName = kb.type === 'custom' && kb.custom ? kb.custom.name : kb.type === 'markdown' ? 'Markdown folder' : 'Obsidian vault';
  const kbCard = `<div class="card accent kb-card" style="--c:#a882ff;border-top-color:${kb.connected ? '#a882ff' : 'var(--line)'}">
      <h4><span class="agent-icon" style="--c:#a882ff;width:34px;height:34px;font-size:18px">${icon('brain')}</span><div>Knowledge base<div class="meta">${esc(kbName)}</div></div></h4>
      <p>${kb.connected ? `Your brain reads and writes <b>${kb.notes}</b> notes in <code>${esc(kb.path)}</code>${kb.isStarter ? ' (the Maestro starter vault)' : ''}.` : 'Choose where your notes live: an Obsidian vault, any folder of Markdown files, or a third-party source like Notion or Google Drive.'}</p>
      <div class="row">${kb.connected ? (kb.isObsidian ? '<span class="tag live">● Obsidian</span>' : '<span class="tag live">● Markdown</span>') : '<span class="tag off">Not connected</span>'}${kb.custom ? `<span class="tag">+ ${esc(kb.custom.name)} via Claude</span>` : ''}</div>
      <div class="row">${connectButton(kb.connected, 'id="kb-btn"')}${kb.connected && kb.isObsidian ? `<a class="btn small ghost" href="obsidian://open?path=${encodeURIComponent(kb.path)}">${icon('external-link')} Open in Obsidian</a>` : ''}</div>
    </div>`;
  const foundation = st.connectors.filter((c) => c.group === 'foundation');
  const packIds = new Set(st.packs.filter((p) => p.installed).flatMap((p) => p.connectors || []));
  const packConns = st.connectors.filter((c) => c.group === 'pack');
  el.innerHTML = head('MCP Connections', `Connect the sources your brain listens to. Connected sources stream structured notifications into the Intelligence Feed and become context for every answer. You are editing the <b>${profileName()}</b> profile: switch profiles at the top to connect personal accounts separately.`) +
    `<div class="callout ${cd.registered ? 'ok' : ''}"><span class="big-icon">${icon(cd.registered ? 'check' : 'sparkles')}</span><div style="flex:1">
      <h4>${cd.registered ? 'Maestro is connected to Claude Desktop' : 'Connect your brain to Claude Desktop'}</h4>
      <p>${cd.registered ? 'Claude can search your vault, read the feed, check your calendar, manage tasks, remember facts and run your skills. Restart Claude Desktop after changes.' : 'This adds Maestro as an MCP server in Claude Desktop so Claude becomes the reasoning engine for your brain. Your email, calendar and Slack connectors in Claude Desktop then work alongside it.'}</p>
      <p class="meta" style="margin-top:6px">Config: <code>${esc(cd.configPath)}</code></p></div>
      <button class="btn ${cd.registered ? 'ghost' : 'primary'}" id="cd-reg">${icon('plug')} ${cd.registered ? 'Re-connect' : 'Connect to Claude Desktop'}</button></div>
    <div class="section-title">Knowledge base</div><div class="grid">${kbCard}</div>
    <div class="section-title">Foundation · every brain</div><div class="grid">${foundation.map(card).join('')}</div>
    <div class="section-title">Role pack tools</div>
    ${packConns.some((c) => packIds.has(c.id) || c.status[prof]) ? `<div class="grid">${packConns.filter((c) => packIds.has(c.id) || c.status[prof]).map(card).join('')}</div>` : `<p style="color:var(--muted)">Install a role pack on the <a href="#skills" id="to-skills">Skills & Packs</a> page to add Linear, Jira, Notion, Figma, Google Drive, GitHub and docs.</p>`}
    <div class="section-title">How it flows</div>
    <div class="md" style="color:var(--muted)"><p><b>Source</b> (Gmail, Slack, Twilio…) → <b>MCP connector</b> → Maestro normalises it into a feed card (category, priority, deadline, action items) → the brain map lights up → Claude and your agents can reason over it.</p></div>`;

  el.querySelector('#cd-reg').onclick = () => registerClaude(() => connectionsPage(el, ctx));
  const ts = el.querySelector('#to-skills'); if (ts) ts.onclick = (e) => { e.preventDefault(); ctx.navigate('skills'); };
  el.querySelectorAll('[data-cfg]').forEach((b) => b.onclick = () => connectModal(st.connectors.find((c) => c.id === b.dataset.cfg), prof, async () => { await ctx.afterChange({ graph: false }); connectionsPage(el, ctx); }));
  el.querySelector('#kb-btn').onclick = () => knowledgeModal(async () => { await ctx.afterChange({}); connectionsPage(el, ctx); });
}

// Blue "Connect" when there's no connection; green "● Connected" (opens settings, where Disconnect lives) when there is.
function connectButton(connected, attrs) {
  return connected
    ? `<button class="btn small connected" ${attrs} title="Manage this connection"><span class="dot"></span> Connected</button>`
    : `<button class="btn small connect" ${attrs}>${icon('plug')} Connect</button>`;
}

// ================================================================ KNOWLEDGE BASE
// Shared form used by the Knowledge base card, first-run prompt and onboarding.
function kbFormHtml(k) {
  const cur = k.connected ? k.type : 'obsidian';
  const det = (k.detected || []).filter((v) => v.path !== k.starter);
  // Which vault option starts selected: a detected vault, the starter vault, or "Another vault" with the current path.
  const sel = det.some((v) => v.path === k.path) ? k.path : (k.isStarter || !k.connected || k.type !== 'obsidian') ? '__starter' : '__path';
  return `
    <div class="kb-types">
      <button class="choice ${cur === 'obsidian' ? 'on' : ''}" data-kb="obsidian">${icon('brain')}<div><b>Obsidian vault</b><span>Recommended. Maestro and Obsidian share the same notes, links and graph.</span></div></button>
      <button class="choice ${cur === 'markdown' ? 'on' : ''}" data-kb="markdown">${icon('file-text')}<div><b>Markdown folder</b><span>Any folder of .md files: Logseq, iA Writer, VS Code, Dropbox or a git repo.</span></div></button>
      <button class="choice ${cur === 'custom' ? 'on' : ''}" data-kb="custom">${icon('link')}<div><b>Custom third party</b><span>Notion, Google Drive, Confluence or another MCP server, reached through Claude.</span></div></button>
    </div>
    <div data-pane="obsidian" ${cur === 'obsidian' ? '' : 'hidden'}>
      ${det.length ? `<div class="field"><label>Vaults found on this computer</label>${det.map((v) => `<label class="kb-vault"><input type="radio" name="kb-det" value="${esc(v.path)}" ${sel === v.path ? 'checked' : ''}> <b>${esc(v.name)}</b> <small>${esc(v.path)}</small></label>`).join('')}</div>` : ''}
      <label class="kb-vault"><input type="radio" name="kb-det" value="__starter" ${sel === '__starter' ? 'checked' : ''}> <b>Maestro starter vault</b> <small>${esc(k.starter)}. Open it in Obsidian with <i>Open folder as vault</i>.</small></label>
      <label class="kb-vault"><input type="radio" name="kb-det" value="__path" ${sel === '__path' ? 'checked' : ''}> <b>Another vault</b></label>
      <input class="input" id="kb-opath" value="${sel === '__path' ? esc(k.path) : ''}" placeholder="${navigator.platform.startsWith('Win') ? 'C:\\Users\\you\\Documents\\My Vault' : '~/Documents/My Vault'}" hidden>
    </div>
    <div data-pane="markdown" ${cur === 'markdown' ? '' : 'hidden'}>
      <div class="field"><label>Folder path</label><input class="input" id="kb-mpath" value="${k.type === 'markdown' ? esc(k.path) : ''}" placeholder="${navigator.platform.startsWith('Win') ? 'C:\\Users\\you\\Notes' : '~/Notes'}">
      <span class="help">Mac: right-click the folder, hold Option, choose <b>Copy as Pathname</b>. Windows: Shift + right-click, <b>Copy as path</b>.</span></div>
      <label class="kb-check"><input type="checkbox" id="kb-create"> <span>Create the folder if it doesn't exist</span></label>
    </div>
    <div data-pane="custom" ${cur === 'custom' ? '' : 'hidden'}>
      <div class="field"><label>Source</label><select class="input" id="kb-ckind">${Object.entries(k.custom_defs || {}).map(([id, d]) => `<option value="${id}" ${k.custom && k.custom.kind === id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>
      <div class="two-col"><div class="field"><label>Name (optional)</label><input class="input" id="kb-cname" value="${esc((k.custom && k.custom.name) || '')}" placeholder="Team wiki"></div>
      <div class="field"><label>Link or MCP URL (optional)</label><input class="input" id="kb-curl" value="${esc((k.custom && k.custom.url) || '')}" placeholder="https://…"></div></div>
      <p class="help" id="kb-chow"></p>
      <p class="help">Claude reads this source through its connector. Maestro keeps your memory, agents and skills in the starter vault so every answer can use both.</p>
    </div>
    <label class="kb-check" id="kb-seed-row"><input type="checkbox" id="kb-seed" checked> <span>Add Maestro's <b>Memory</b>, <b>Agents</b>, <b>Skills</b> and <b>Templates</b> folders (nothing is overwritten)</span></label>`;
}

function kbWire(box, k) {
  let type = k.connected ? k.type : 'obsidian';
  const show = () => {
    box.querySelectorAll('[data-kb]').forEach((b) => b.classList.toggle('on', b.dataset.kb === type));
    box.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== type; });
    const det = box.querySelector('input[name="kb-det"]:checked');
    box.querySelector('#kb-opath').hidden = !(det && det.value === '__path');
    box.querySelector('#kb-seed-row').hidden = type === 'custom' || (type === 'obsidian' && det && det.value === '__starter');
    const kind = box.querySelector('#kb-ckind'); const how = box.querySelector('#kb-chow');
    if (kind && how) how.textContent = 'How to connect it: ' + ((k.custom_defs[kind.value] || {}).how || '');
  };
  box.querySelectorAll('[data-kb]').forEach((b) => b.onclick = () => { type = b.dataset.kb; show(); });
  box.querySelectorAll('input[name="kb-det"], #kb-ckind').forEach((i) => i.onchange = show);
  show();
  return () => {
    const seed = box.querySelector('#kb-seed').checked;
    if (type === 'obsidian') {
      const det = box.querySelector('input[name="kb-det"]:checked');
      if (!det || det.value === '__starter') return { type: 'starter' };
      return { type: 'obsidian', path: det.value === '__path' ? box.querySelector('#kb-opath').value : det.value, seed };
    }
    if (type === 'markdown') return { type: 'markdown', path: box.querySelector('#kb-mpath').value, seed, create: box.querySelector('#kb-create').checked };
    return { type: 'custom', customKind: box.querySelector('#kb-ckind').value, customName: box.querySelector('#kb-cname').value.trim(), customUrl: box.querySelector('#kb-curl').value.trim() };
  };
}

async function loadKb() {
  const k = await api('/knowledge');
  k.custom_defs = k.custom; k.custom = k.type === 'custom' ? S.state.knowledge.custom : null;
  return k;
}

async function connectKb(spec) {
  const r = await api('/knowledge/connect', spec);
  toast(r.restored ? `Welcome back. Your connections and settings were restored from this knowledge base.` : `Knowledge base connected: ${r.notes} notes${r.copied && r.copied.length ? ` · added ${r.copied.length} Maestro files` : ''}`);
  await refreshState();
  return r;
}

export async function knowledgeModal(done, { first = false } = {}) {
  const k = await loadKb();
  modal(`${modalHead(first ? 'Connect your knowledge base' : 'Knowledge base', first ? 'Your brain needs somewhere to read and write notes. Pick one to start; you can change it any time on MCP Connections.' : 'Where your brain reads and writes notes.')}
    <div id="kb-form">${kbFormHtml(k)}</div>
    <div class="modal-foot">${k.connected ? '<button class="btn small danger" id="kb-off" style="margin-right:auto">Disconnect</button>' : ''}<button class="btn ghost" data-close>${first ? 'Later' : 'Cancel'}</button><button class="btn connect" id="kb-go">${icon('plug')} Connect</button></div>`, {
    wide: true,
    onMount: (m, close) => {
      const get = kbWire(m, k);
      m.querySelector('#kb-go').onclick = async (e) => {
        e.target.disabled = true;
        try { await connectKb(get()); close(); done && done(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
      };
      const off = m.querySelector('#kb-off');
      if (off) off.onclick = async () => { await api('/knowledge/disconnect', {}); await refreshState(); toast('Knowledge base disconnected. Your notes were not touched.'); close(); done && done(); };
    },
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

// One input per value; a "list" field (calendar links) gets a row per link plus "Add another".
function liveFieldHtml(f, saved) {
  if (f.type === 'channels') {
    const picked = Array.isArray(saved[f.key]) ? saved[f.key].filter((c) => c && c.id) : [];
    return `<div class="field"><label>${esc(f.label)}</label>
      <div class="chan-bar"><button type="button" class="btn small" data-load-channels="${f.key}">${icon('hash')} ${picked.length ? 'Change channels' : 'Load my channels'}</button>
        <input class="input chan-search" type="search" placeholder="Filter channels" aria-label="Filter channels" hidden><span class="chan-count"></span></div>
      <div class="chan-list" data-channels="${f.key}">${picked.map((c) => chanRowHtml(c, true)).join('')}</div>${f.help ? `<span class="help">${esc(f.help)}</span>` : ''}</div>`;
  }
  if (f.type === 'list') {
    const vals = (saved[f.key] && saved[f.key].length ? saved[f.key] : ['']);
    return `<div class="field"><label>${esc(f.label)}</label><div class="list-rows" data-list="${f.key}" data-ph="${esc(f.placeholder || '')}">${vals.map((v) => listRowHtml(v, f.placeholder)).join('')}</div>
      <button type="button" class="btn small ghost add-row" data-add="${f.key}">${icon('plus')} ${esc(f.addLabel || 'Add another')}</button>${f.help ? `<span class="help">${esc(f.help)}</span>` : ''}</div>`;
  }
  return `<div class="field"><label>${esc(f.label)}</label><input class="input" data-f="${f.key}" type="${f.secret ? 'password' : 'text'}" placeholder="${esc(f.placeholder || '')}" value="${esc(saved[f.key] || '')}">${f.help ? `<span class="help">${esc(f.help)}</span>` : ''}</div>`;
}
function chanRowHtml(c, on) {
  return `<label class="chan-row"><input type="checkbox" ${on ? 'checked' : ''} data-id="${esc(c.id)}" data-name="${esc(c.name)}"><span>${c.private ? icon('key') : '#'} ${esc(c.name)}</span>${c.members ? `<small>${c.members} members${c.member === false ? ' · not joined' : ''}</small>` : ''}</label>`;
}
// Slack: fetch every channel the token can see and let the user tick the ones to follow.
function wireChannelPickers(m, c, prof) {
  m.querySelectorAll('[data-load-channels]').forEach((btn) => {
    const key = btn.dataset.loadChannels;
    const box = m.querySelector(`[data-channels="${key}"]`);
    const search = btn.parentElement.querySelector('.chan-search');
    const count = btn.parentElement.querySelector('.chan-count');
    const upd = () => { count.textContent = `${box.querySelectorAll('input:checked').length} selected`; };
    box.addEventListener('change', upd); upd();
    btn.onclick = async () => {
      const tok = m.querySelector('[data-f="token"]');
      btn.disabled = true; btn.textContent = 'Loading…';
      try {
        const r = await api('/slack/channels', { token: tok ? tok.value.trim() : '', profile: prof });
        const on = new Set([...box.querySelectorAll('input:checked')].map((i) => i.dataset.id));
        box.innerHTML = r.channels.map((ch) => chanRowHtml(ch, on.has(ch.id))).join('') || '<span class="help">This token cannot see any channels yet.</span>';
        search.hidden = r.channels.length < 8;
        btn.innerHTML = `${icon('refresh')} Reload`;
        toast(`${r.channels.length} channels in ${r.team}${r.bot ? '. A bot token joins public channels on its own; invite it to private ones' : ''}`);
        upd();
      } catch (e) { toast(e.message, 'error'); btn.innerHTML = `${icon('hash')} Load my channels`; }
      btn.disabled = false;
    };
    search.oninput = () => { const q = search.value.toLowerCase(); box.querySelectorAll('.chan-row').forEach((r) => { r.hidden = !r.querySelector('input').dataset.name.toLowerCase().includes(q); }); };
  });
}
function listRowHtml(v, ph) {
  return `<div class="list-row"><input class="input" type="text" placeholder="${esc(ph || '')}" value="${esc(v || '')}" aria-label="Entry"><button type="button" class="icon-btn small" data-remove title="Remove" aria-label="Remove">${icon('x')}</button></div>`;
}
function wireListFields(m) {
  const sync = (box) => { const rows = box.querySelectorAll('.list-row'); rows.forEach((r) => { r.querySelector('[data-remove]').hidden = rows.length < 2 && !r.querySelector('input').value; }); };
  m.querySelectorAll('[data-list]').forEach((box) => {
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove]'); if (!b) return;
      const rows = box.querySelectorAll('.list-row');
      if (rows.length > 1) b.closest('.list-row').remove(); else rows[0].querySelector('input').value = '';
      sync(box);
    });
    box.addEventListener('input', () => sync(box));
    sync(box);
  });
  m.querySelectorAll('[data-add]').forEach((btn) => btn.onclick = () => {
    const box = m.querySelector(`[data-list="${btn.dataset.add}"]`);
    box.insertAdjacentHTML('beforeend', listRowHtml('', box.dataset.ph));
    sync(box); box.lastElementChild.querySelector('input').focus();
  });
}

export function connectModal(c, prof, done, { noDemo = cfg().dataMode === 'real' } = {}) {
  const s = c.status[prof];
  const canLive = c.live && c.live.includes('dashboard');
  const viaClaude = c.live && c.live.includes('claude');
  const first = s ? s.mode : noDemo ? (canLive ? 'live' : 'claude') : 'demo';
  modal(`${modalHead(`Connect ${esc(c.name)}`, `${profileName()} profile`)}
    ${noDemo && first !== 'demo' ? '' : `<button class="choice ${first === 'demo' ? 'on' : ''}" data-mode="demo">${icon('zap')}<div><b>Use demo data</b><span>Instantly see how ${esc(c.name)} notifications look in the feed and how the brain uses them. Perfect for the workshop.</span></div></button>`}
    ${canLive ? `<button class="choice ${first === 'live' ? 'on' : ''}" data-mode="live">${icon('plug')}<div><b>Connect live</b><span>Stream your real ${esc(c.name)} data into Maestro.</span></div></button>
      <div id="live-fields" ${first === 'live' ? '' : 'hidden'} style="margin:4px 0 10px">${(c.liveFields || []).map((f) => liveFieldHtml(f, (s && s.mode === 'live' && s.fields) || {})).join('')}</div>` : ''}
    ${viaClaude ? `<button class="choice ${first === 'claude' ? 'on' : ''}" data-mode="claude">${icon('sparkles')}<div><b>I connected it in Claude Desktop</b><span>${esc(c.claudeSetup || '')}</span></div></button>
      ${(c.claudeFields || []).length ? `<div id="claude-fields" ${first === 'claude' ? '' : 'hidden'} style="margin:4px 0 10px">${c.claudeFields.map((f) => liveFieldHtml(f, (s && s.mode === 'claude' && s.fields) || {})).join('')}</div>` : ''}` : ''}
    <div class="modal-foot">${s ? '<button class="btn small danger" id="off" style="margin-right:auto">Disconnect</button>' : ''}<button class="btn ghost" data-close>Cancel</button><button class="btn connect" id="go">${icon('plug')} ${s ? 'Save' : 'Connect'}</button></div>`, {
    onMount: (m, close) => {
      let mode = first;
      m.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => {
        mode = b.dataset.mode;
        m.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
        const lf = m.querySelector('#live-fields'); if (lf) lf.hidden = mode !== 'live';
        const cf = m.querySelector('#claude-fields'); if (cf) cf.hidden = mode !== 'claude';
      });
      const off = m.querySelector('#off');
      if (off) off.onclick = async () => { await api('/connections/disconnect', { id: c.id, profile: prof }); toast(`${c.name} disconnected`); close(); done(); };
      wireListFields(m);
      wireChannelPickers(m, c, prof);
      m.querySelector('#go').onclick = async (e) => {
        const fields = {};
        const scope = m.querySelector(mode === 'claude' ? '#claude-fields' : '#live-fields') || m;
        scope.querySelectorAll('[data-f]').forEach((i) => { if (i.value.trim()) fields[i.dataset.f] = i.value.trim(); });
        scope.querySelectorAll('[data-list]').forEach((box) => { fields[box.dataset.list] = [...box.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean); });
        scope.querySelectorAll('[data-channels]').forEach((box) => { fields[box.dataset.channels] = [...box.querySelectorAll('input:checked')].map((i) => ({ id: i.dataset.id, name: i.dataset.name })); });
        e.target.disabled = true; e.target.textContent = 'Connecting…';
        try {
          const r = await api('/connections', { id: c.id, profile: prof, mode, fields });
          toast(r.message + (r.surfaced ? ` · ${r.surfaced} new items in your feed` : ''));
          close(); done();
        } catch (err) { toast(err.message, 'error'); e.target.disabled = false; e.target.innerHTML = `${icon('plug')} ${s ? 'Save' : 'Connect'}`; }
      };
    },
  });
}

// ================================================================ TASKS
// Due date, due time and reminders for a new task (Ryan, 2026-11-02). Reminders post an Insight card in the feed
// (and a desktop notification when allowed) that long before the deadline. Used by the Tasks page and Create Task.
export const REMINDERS = [['1w', '1 week'], ['2d', '2 days'], ['1d', '1 day'], ['12h', '12 hours'], ['8h', '8 hours'], ['3h', '3 hours'], ['2h', '2 hours'], ['1h', '1 hour'], ['30m', '30 minutes']];
export function dueFields(p, { label = true } = {}) {
  return `<div class="due-fields">
    <div class="field"><label for="${p}-due">${label ? 'Due date' : ''}</label><input class="input" type="date" id="${p}-due"></div>
    <div class="field"><label for="${p}-time">Due time</label><input class="input" type="time" id="${p}-time" step="900"></div>
    <div class="field rem-field"><label>Remind me before</label><div class="rem-chips" role="group" aria-label="Reminders">${REMINDERS.map(([k, v]) => `<button type="button" class="rem-chip" data-rem="${k}" aria-pressed="false">${icon('bell')}${v}</button>`).join('')}</div></div>
  </div>`;
}
export function wireDueFields(root, p) {
  const due = root.querySelector(`#${p}-due`);
  root.querySelectorAll('[data-rem]').forEach((b) => (b.onclick = () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on);
    if (on && !due.value) { const d = new Date(); d.setDate(d.getDate() + 1); due.value = d.toISOString().slice(0, 10); } // a reminder needs a date: tomorrow until you pick one
    if (on && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  }));
  return () => ({ due: due.value || '', dueTime: due.value ? root.querySelector(`#${p}-time`).value || '' : '', alerts: [...root.querySelectorAll('[data-rem][aria-pressed=true]')].map((b) => b.dataset.rem) });
}
const fmtDue = (t) => {
  if (!t.due) return '';
  const d = new Date(`${t.due}T${t.dueTime || '12:00'}`);
  return 'due ' + d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + (t.dueTime ? ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
};
const fmtAlerts = (t) => (t.alerts && t.alerts.length ? `<span class="t-rem">${icon('bell')}${t.alerts.map((a) => (REMINDERS.find((r) => r[0] === a) || [a, a])[1]).join(', ')} before</span>` : '');

// Tabs for each section of the brain (Ryan, 2026-11-02). Tasks added from a feed card, an event's "Create Task",
// a project note or chat all land here, tagged with their section.
const TASK_TABS = [
  { id: 'all', name: 'All', icon: 'layout-grid', c: '#e9e7ff' },
  { id: 'calendar', name: 'Calendar', icon: 'calendar-days', c: '#00e5ff' },
  { id: 'email', name: 'Email', icon: 'mail', c: '#ffb020' },
  { id: 'messages', name: 'Messages', icon: 'message-square', c: '#c42cff' },
  { id: 'calls', name: 'Calls', icon: 'phone', c: '#ff7a45' },
  { id: 'projects', name: 'Projects', icon: 'folder', c: '#00f2af' },
  { id: 'other', name: 'Other', icon: 'clipboard-check', c: '#9db2d7' },
];
async function tasksPage(el, ctx) {
  const list = await api('/tasks?done=1');
  const tab = TASK_TABS.some((t) => t.id === S.taskTab) ? S.taskTab : 'all';
  const inTab = (t) => tab === 'all' || (t.section || 'other') === tab;
  const open = list.filter((t) => !t.done && inTab(t)), done = list.filter((t) => t.done && inTab(t));
  const count = (id) => list.filter((t) => !t.done && (id === 'all' || (t.section || 'other') === id)).length;
  const sec = (id) => TASK_TABS.find((x) => x.id === id) || TASK_TABS[6];
  const row = (t) => { const x = sec(t.section || 'other'); return `<div class="task ${t.done ? 'done' : ''}"><input type="checkbox" ${t.done ? 'checked' : ''} data-p="${esc(t.path)}" data-l="${t.line}" aria-label="Done">
    <div class="t-text"><span>${esc(t.text)}</span><small>${tab === 'all' ? `<span class="t-sec" style="--c:${x.c}">${icon(x.icon)}${x.name}</span> · ` : ''}${[t.priority && t.priority + ' priority', fmtDue(t), fmtAlerts(t)].filter(Boolean).map((v) => v + ' · ').join('')}<a href="#" data-n="${esc(t.path)}">${esc(t.note)}</a></small></div>
    ${t.priority === 'High' ? '<span class="tag" style="color:#ff6b81;border-color:#5a1020">High</span>' : ''}<button class="t-edit" data-edit="${list.indexOf(t)}" title="Edit task" aria-label="Edit task: ${esc(t.text)}">${icon('pencil')}</button></div>`; };
  const cur = sec(tab);
  el.innerHTML = head('Tasks', `Tasks are Obsidian checkboxes anywhere in your vault (${profileName()} profile). Tick them here, in Obsidian, or ask the brain: “add a task to…”.`) +
    `<div class="task-tabs" role="tablist">${TASK_TABS.map((t) => `<button role="tab" class="task-tab ${t.id === tab ? 'on' : ''}" aria-selected="${t.id === tab}" data-tab="${t.id}" style="--c:${t.c}">${icon(t.icon)}<span>${t.name}</span><b>${count(t.id)}</b></button>`).join('')}</div>
     <div class="task-new"><div class="composer-row"><div class="input-wrap" style="height:44px"><input id="t-new" placeholder="Add a task${tab !== 'all' && tab !== 'other' ? ` to ${cur.name}` : ''}… (add #high for high priority)"></div><button class="btn primary" id="t-add" style="height:44px">${icon('plus')} Add</button></div>${dueFields('t')}</div>
     <div class="section-title">Open · ${open.length}</div>${open.map(row).join('') || `<p style="color:var(--muted)">${tab === 'all' ? 'Inbox zero.' : `No open ${cur.name} tasks.`}</p>`}
     <div class="section-title">Done · ${done.length}</div>${done.slice(0, 20).map(row).join('')}`;
  el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { S.taskTab = b.dataset.tab; tasksPage(el, ctx); }));
  const readDue = wireDueFields(el, 't');
  const add = async () => {
    const v = el.querySelector('#t-new').value.trim(); if (!v) return;
    const pri = /#high/i.test(v) ? 'High' : undefined;
    await api('/tasks', { text: v.replace(/#high/i, '').trim(), priority: pri, section: tab !== 'all' && tab !== 'other' ? tab : undefined, ...readDue() });
    toast('Task added'); tasksPage(el, ctx);
  };
  el.querySelector('#t-add').onclick = add;
  el.querySelector('#t-new').onkeydown = (e) => { if (e.key === 'Enter') add(); };
  el.querySelectorAll('input[type=checkbox]').forEach((c) => c.onchange = async () => { await api('/tasks/toggle', { path: c.dataset.p, line: Number(c.dataset.l) }); tasksPage(el, ctx); });
  el.querySelectorAll('[data-n]').forEach((a) => a.onclick = (e) => { e.preventDefault(); openNote(a.dataset.n); });
  el.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => editTask(list[Number(b.dataset.edit)], () => tasksPage(el, ctx))));
}

// Edit a task after it was made (Ryan, 2026-11-02): its text, due date and time, reminders, priority and section.
function editTask(t, done) {
  modal(`${modalHead('Edit task', esc(t.note))}
    <div class="field"><label for="te-text">Task</label><textarea class="input" id="te-text" rows="2">${esc(t.text)}</textarea></div>
    ${dueFields('te')}
    <div class="due-fields">
      <div class="field"><label for="te-pri">Priority</label><select class="input" id="te-pri">${['', 'High', 'Medium', 'Low'].map((p) => `<option value="${p}" ${p === t.priority ? 'selected' : ''}>${p || 'None'}</option>`).join('')}</select></div>
      <div class="field"><label for="te-sec">Section</label><select class="input" id="te-sec">${TASK_TABS.filter((x) => x.id !== 'all').map((x) => `<option value="${x.id === 'other' ? '' : x.id}" ${(t.section || '') === (x.id === 'other' ? '' : x.id) ? 'selected' : ''}>${x.name}</option>`).join('')}</select></div>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="te-save">${icon('save')} Save changes</button></div>`, {
    onMount: (el, close) => {
      el.querySelector('#te-due').value = t.due || '';
      el.querySelector('#te-time').value = t.dueTime || '';
      el.querySelectorAll('[data-rem]').forEach((b) => { const on = (t.alerts || []).includes(b.dataset.rem); b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); });
      const readDue = wireDueFields(el, 'te');
      const text = el.querySelector('#te-text');
      setTimeout(() => { text.focus(); text.setSelectionRange(text.value.length, text.value.length); }, 50);
      text.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.querySelector('#te-save').click(); } };
      el.querySelector('#te-save').onclick = async () => {
        if (!text.value.trim()) { text.focus(); return toast('A task needs some text', 'error'); }
        try {
          await api('/tasks/update', { path: t.path, line: t.line, expect: t.text, text: text.value, priority: el.querySelector('#te-pri').value, section: el.querySelector('#te-sec').value, ...readDue() });
          toast('Task updated'); close(); done();
        } catch (e) { toast(e.message || 'Could not save the task', 'error'); }
      };
    },
  });
}

// ================================================================ CALENDAR
async function calendarPage(el, ctx) {
  const feedUrl = `${location.origin}/calendar.ics`;
  el.innerHTML = head('Calendar', `All your connected calendars by day, week or month (${profileName()}). Click an event for its details. Say “Hey Maestro, create a meeting tomorrow at 2pm with John” to add one. Events Maestro creates go to iCloud when its card has sign-in details, otherwise to your Maestro calendar (<code>${esc(feedUrl)}</code>).`,
    `<button class="btn" id="new-ev">${icon('plus')} New event</button><button class="btn" id="prep">${icon('sparkles')} Prep my next meeting</button>`) + '<div id="cal-week"></div>';
  weekCalendar(el.querySelector('#cal-week'), { ask: (t) => ctx.ask(t), createTask: ctx.createTask });
  el.querySelector('#prep').onclick = () => ctx.ask('Prep me for my next meeting');
  el.querySelector('#new-ev').onclick = () => ctx.ask('Create a new meeting');
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
  const voices = voiceSupported.tts ? rankVoices(speechSynthesis.getVoices()) : []; // most natural first
  el.innerHTML = head('Settings', 'Make the brain yours. Keys are stored only on this computer in <code>data/config.json</code>.') +
    `<div class="tabs" id="tabs">${['You', 'AI engine', 'Voice', 'Vault', 'Claude Desktop', 'Demo', 'Reminders'].map((t, i) => `<button data-tab="${i}" class="${i === 0 ? 'on' : ''}">${t}</button>`).join('')}</div>
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
      <div class="field" style="flex-direction:row;align-items:center;gap:12px"><label class="toggle"><input type="checkbox" id="v-hands" ${c.voice.handsFree ? 'checked' : ''}><span></span></label><div>Only respond when I start with “Hey ${esc(c.assistantName)}…” (handy in a busy room)</div></div>
      <div class="two-col"><div class="field"><label>Voice</label><select class="input" id="v-voice"><option value="">Automatic: most natural ${c.voice.gender === 'female' ? 'woman' : 'man'}'s voice (${esc((voices.find((v) => voiceGender(v) === (c.voice.gender || 'male')) || voices[0] || { name: 'browser default' }).name)})</option>${voices.map((v) => `<option value="${esc(v.name)}" ${v.name === c.voice.voiceName ? 'selected' : ''}>${esc(v.name)}${voiceScore(v) >= 60 ? ' ★ natural' : ''}</option>`).join('')}</select>
        <span class="help">Switch between a man's and a woman's voice with the man / woman icons at the top of the screen. For the most human voice use Edge ("Online (Natural)" voices), or on a Mac download a Premium or Enhanced voice: System Settings → Accessibility → Spoken Content → System voice → Manage Voices.</span></div>
      <div class="field"><label>Speed</label><input class="input" type="range" min="0.7" max="1.4" step="0.02" id="v-rate" value="${c.voice.rate}"></div></div>
      <div class="field"><label>Pause between sentences</label><input class="input" type="range" min="0" max="4000" step="50" id="v-pause" value="${c.voice.pause != null ? c.voice.pause : 750}"></div>
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
    </div>
    <div data-pane="6" hidden>
      <p style="color:var(--muted);margin-top:0">Pick how far ahead Maestro reminds you. Each reminder lands as a card in the Intelligence Feed, with a desktop notification when allowed.</p>
      <div class="field"><label>Tasks</label><div class="rem-chips" role="group" aria-label="Task reminders">${REMINDERS.map(([k, v]) => `<button type="button" class="rem-chip${(c.reminders && c.reminders.tasks || []).includes(k) ? ' on' : ''}" data-set-rem="tasks" data-rem-key="${k}" aria-pressed="${(c.reminders && c.reminders.tasks || []).includes(k)}">${icon('bell')}${v}</button>`).join('')}</div><span class="help">Used for tasks that don't have their own reminders. Pick none to be reminded the day before and on the day.</span></div>
      <div class="field"><label>Project milestones and completion dates</label><div class="rem-chips" role="group" aria-label="Milestone reminders">${REMINDERS.map(([k, v]) => `<button type="button" class="rem-chip${(c.reminders && c.reminders.milestones || ['1w', '1d']).includes(k) ? ' on' : ''}" data-set-rem="milestones" data-rem-key="${k}" aria-pressed="${(c.reminders && c.reminders.milestones || ['1w', '1d']).includes(k)}">${icon('bell')}${v}</button>`).join('')}</div><span class="help">Counted from 9 AM on the milestone's day. You also get a card on the day itself.</span></div>
      <button class="btn primary" id="save-rem">${icon('save')} Save</button>
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
  el.querySelector('#save-you').onclick = async () => { await api('/settings', { user: { name: el.querySelector('#s-name').value.trim(), role: el.querySelector('#s-role').value.trim() }, assistantName: el.querySelector('#s-asst').value.trim() || 'Maestro' }); toast('Saved'); ctx.afterChange({ graph: false, feed: false }); };
  el.querySelector('#save-voice').onclick = async () => { await api('/settings', { voice: { speakReplies: el.querySelector('#v-speak').checked, handsFree: el.querySelector('#v-hands').checked, voiceName: el.querySelector('#v-voice').value, rate: Number(el.querySelector('#v-rate').value), pause: Number(el.querySelector('#v-pause').value) } }); await refreshState(); toast('Voice saved'); };
  el.querySelector('#test-voice').onclick = () => { new Voice({}).speak(`Hello ${String(c.user.name).split(' ')[0]}. Your second brain is online. Let's get to work.`, { voiceName: el.querySelector('#v-voice').value, gender: c.voice.gender, rate: Number(el.querySelector('#v-rate').value), pause: Number(el.querySelector('#v-pause').value) }); };
  el.querySelector('#save-vault').onclick = async () => { try { await api('/settings', { vaultPath: el.querySelector('#vault-path').value.trim() }); toast('Vault updated'); ctx.afterChange(); } catch (e) { toast(e.message, 'error'); } };
  el.querySelector('#cd').onclick = () => registerClaude(() => settingsPage(el, ctx));
  el.querySelector('#save-demo').onclick = async () => { await api('/settings', { demo: { liveFeed: el.querySelector('#d-live').checked, intervalSeconds: Number(el.querySelector('#d-int').value) } }); S.livePaused = !el.querySelector('#d-live').checked; toast('Saved'); ctx.afterChange({ graph: false, feed: false }); };
  el.querySelector('#reset-demo').onclick = async () => { await api('/reset-demo', {}); toast('Demo feed reset'); ctx.afterChange({ graph: false }); };
  el.querySelector('#rerun-onb').onclick = () => onboarding(ctx);
  el.querySelectorAll('[data-set-rem]').forEach((b) => (b.onclick = () => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); }));
  el.querySelector('#save-rem').onclick = async () => {
    const pick = (k) => [...el.querySelectorAll(`[data-set-rem="${k}"][aria-pressed="true"]`)].map((b) => b.dataset.remKey);
    await api('/settings', { reminders: { tasks: pick('tasks'), milestones: pick('milestones') } });
    await refreshState(); toast('Reminder times saved'); ctx.afterChange({ graph: false });
  };
}

// ================================================================ ONBOARDING
// Sources offered in the "connect your real accounts" step, grouped like the hubs on the brain map.
const SETUP_GROUPS = [
  ['Calendar', ['icalendar', 'gcal', 'outlook', 'calendly']],
  ['Email', ['gmail', 'outlook', 'email']],
  ['Messages', ['slack', 'twilio_sms', 'whatsapp']],
  ['Calls', ['twilio_calls', 'google_meet', 'teams', 'zoom']],
];

export async function onboarding({ after, afterChange }) {
  const done = after || afterChange;
  const c = cfg();
  let i = 0, pack = null, getKb = null;
  let path = c.dataMode === 'real' && c.onboarded ? 'real' : null; // chosen on the first screen
  const kb = await loadKb();
  const prof = () => cfg().profile;
  const STEP = {
    welcome: () => `${modalHead('Welcome to Maestro', 'Your personal second brain: Claude + Obsidian + MCP.')}
      <div class="md"><p>How do you want to start?</p></div>
      <button class="choice ${path === 'demo' ? 'on' : ''}" data-path="demo">${icon('zap')}<div><b>Load demo data</b><span>Fill the brain with a realistic sample week: meetings, emails, calls, messages and projects. Best for exploring and for the workshop. You can connect real accounts any time.</span></div></button>
      <button class="choice ${path === 'real' ? 'on' : ''}" data-path="real">${icon('plug')}<div><b>Set up my real connections</b><span>Start empty and connect your own calendars, email, messages and calls now. Only what you connect shows up.</span></div></button>`,
    kb: () => `${modalHead('Connect your knowledge base', 'Where your brain reads and writes notes. Obsidian is recommended.')}<div id="o-kb">${kbFormHtml(kb)}</div>`,
    who: () => `${modalHead('Who are you?', 'This goes into your memory so every answer is about you.')}
      <div class="two-col"><div class="field"><label>Your name</label><input class="input" id="o-name" value="${esc(cfg().user.name)}"></div><div class="field"><label>What you do</label><input class="input" id="o-role" value="${esc(cfg().user.role)}"></div></div>
      <div class="field"><label>Name your assistant</label><input class="input" id="o-asst" value="${esc(cfg().assistantName)}"><span class="help">You'll say “Hey ${esc(cfg().assistantName)}” to talk to it.</span></div>`,
    sources: () => {
      const byId = Object.fromEntries(S.state.connectors.map((x) => [x.id, x]));
      const row = (id) => { const x = byId[id]; if (!x) return ''; const st = x.status[prof()]; return `<div class="setup-row"><span class="setup-name">${icon(x.icon)} ${esc(x.name)}</span>${connectButton(!!st, `data-cfg="${x.id}"`)}</div>`; };
      const connected = Object.keys(cfg().connections[prof()] || {}).length;
      return `${modalHead('Connect your accounts', `${profileName()} profile. Connect as many as you like; you can add more later from MCP Connections.`)}
        <div class="setup-groups">${SETUP_GROUPS.map(([g, ids]) => `<div class="setup-group"><h4>${g}</h4>${ids.map(row).join('')}</div>`).join('')}</div>
        <p class="meta" style="margin-top:10px">${connected ? `${connected} connected so far.` : 'Nothing connected yet. Calendars connect right here with a link; Gmail, Teams and Zoom connect through Claude Desktop.'}</p>`;
    },
    pack: () => `${modalHead('Pick your role pack', path === 'real' ? 'Packs add the agent and skills for your job. You can add more later.' : 'Packs add the connectors, agent and skills for your job. You can add more later.')}
      ${S.state.packs.map((p) => `<button class="choice ${pack === p.id || p.installed ? 'on' : ''}" data-p="${p.id}">${icon(p.icon)}<div><b>${esc(p.name)}</b><span>${esc(p.description)}</span></div></button>`).join('')}
      <button class="choice ${pack === 'none' ? 'on' : ''}" data-p="none">${icon('brain')}<div><b>Just the foundation</b><span>Email, calendars, messages and calls.</span></div></button>`,
    claude: () => `${modalHead('Connect Claude Desktop', 'Claude becomes the reasoning engine and can read and write your brain.')}
      <div class="md"><p>Install Claude Desktop from <a href="https://claude.ai/download" target="_blank" rel="noopener">claude.ai/download</a> and sign in, then click below. You can also do this later from MCP Connections.</p></div>
      <button class="btn primary" id="o-cd">${icon('plug')} Connect to Claude Desktop</button>`,
  };
  const order = () => path === 'real' ? ['welcome', 'kb', 'who', 'sources', 'pack', 'claude'] : ['welcome', 'kb', 'who', 'pack', 'claude'];
  const m = modal('<div id="onb"></div>', {});
  const render = () => {
    const steps = order(), id = steps[i];
    const box = m.el.querySelector('#onb');
    const dots = `<span class="onb-steps">${path ? `Step ${i + 1} of ${steps.length}` : ''}</span>`;
    box.innerHTML = STEP[id]() + `<div class="modal-foot">${dots}${i ? '<button class="btn ghost" id="o-back">Back</button>' : '<button class="btn ghost" id="o-skip">Skip</button>'}<button class="btn primary" id="o-next" ${id === 'welcome' && !path ? 'disabled' : ''}>${i === steps.length - 1 ? 'Finish' : 'Next'} ${icon('arrow-right')}</button></div>`;
    box.querySelectorAll('[data-close]').forEach((b) => b.onclick = finish);
    box.querySelectorAll('[data-path]').forEach((b) => b.onclick = () => { path = b.dataset.path; render(); });
    box.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { pack = b.dataset.p; box.querySelectorAll('[data-p]').forEach((x) => x.classList.toggle('on', x === b)); });
    box.querySelectorAll('[data-cfg]').forEach((b) => b.onclick = () => connectModal(S.state.connectors.find((x) => x.id === b.dataset.cfg), prof(), async () => { await refreshState(); render(); }, { noDemo: true }));
    const cd = box.querySelector('#o-cd'); if (cd) cd.onclick = () => registerClaude();
    const kbBox = box.querySelector('#o-kb'); if (kbBox) getKb = kbWire(kbBox, kb);
    const back = box.querySelector('#o-back'); if (back) back.onclick = () => { i--; render(); };
    const skip = box.querySelector('#o-skip'); if (skip) skip.onclick = finish;
    box.querySelector('#o-next').onclick = async () => {
      if (id === 'welcome') {
        await api('/data-mode', { mode: path });
        await refreshState();
        toast(path === 'demo' ? 'Demo data loaded' : 'Starting fresh: only what you connect will show');
      }
      if (id === 'kb') {
        try { await connectKb(getKb()); } catch (err) { return toast(err.message, 'error'); }
      }
      if (id === 'who') {
        await api('/settings', { user: { name: box.querySelector('#o-name').value.trim() || cfg().user.name, role: box.querySelector('#o-role').value.trim() }, assistantName: box.querySelector('#o-asst').value.trim() || 'Maestro' });
        await refreshState();
      }
      if (id === 'pack' && pack && pack !== 'none' && !S.state.packs.find((p) => p.id === pack).installed) {
        await api('/packs/install', { id: pack });
        toast('Pack installed');
      }
      if (i === steps.length - 1) return finish();
      i++; render();
    };
  };
  const finish = async () => { await api('/settings', { onboarded: true }); m.close(); done && done(); };
  render();
}


// ================================================================ PROJECTS (Ryan, 2026-11-04)
// Each project is a note in Projects/ (name, description, client, start, milestones, completion) with its tasks.
// Cards show the details and the attached tasks; tasks can be ticked and added right on the card.
// "75% complete" (Ryan, 2026-11-04): on the Projects page and the Projects hub's list in the feed.
export function projectStatus(p) { return p.completed ? 'Completed' : p.progress == null ? 'No tasks yet' : p.progress >= 100 ? 'Complete' : `${p.progress}% complete`; }
const fmtDay = (d) => (d ? new Date(d + 'T12:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '');
async function projectsPage(el, ctx) {
  const list = await api('/projects');
  const today = new Date().toISOString().slice(0, 10);
  const card = (p, k) => {
    const pct = p.progress == null ? null : p.progress;
    const open = p.taskList.filter((t) => !t.done), done = p.taskList.filter((t) => t.done);
    const late = p.completion && p.completion < today && open.length;
    return `<article class="card proj ${p.completed ? 'proj-done' : ''}" data-k="${k}">
      <header class="proj-head"><span class="proj-icon">${icon('folder')}</span><div class="proj-title"><h3>${esc(p.name)}</h3>${p.client ? `<span class="proj-client">${icon('briefcase')}${esc(p.client)}</span>` : ''}</div>
        <button class="t-edit" data-edit="${k}" title="Edit project" aria-label="Edit ${esc(p.name)}">${icon('pencil')}</button></header>
      ${p.description ? `<p class="proj-desc">${esc(p.description)}</p>` : ''}
      <dl class="proj-dates"><div><dt>Start</dt><dd>${fmtDay(p.start) || '—'}</dd></div><div><dt>Completion</dt><dd class="${late ? 'late' : ''}">${fmtDay(p.completion) || '—'}</dd></div><div><dt>Status</dt><dd class="proj-pct ${p.progress >= 100 ? 'done' : ''}">${esc(projectStatus(p))}</dd></div></dl>
      ${pct != null ? `<div class="progress"><div class="track"><div class="bar" style="width:${pct}%"></div></div><span>${pct}%</span></div>` : ''}
      ${p.milestones.length ? `<div class="proj-sub">Milestones</div><ol class="proj-ms">${p.milestones.map((m) => `<li class="${m.date && m.date < today ? 'past' : ''} ${p.nextMilestone && m === p.milestones.find((x) => x.date === p.nextMilestone.date && x.name === p.nextMilestone.name) ? 'next' : ''}"><i></i><b>${esc(m.name || 'Milestone')}</b><span>${fmtDay(m.date) || 'No date'}</span></li>`).join('')}</ol>` : ''}
      <div class="proj-sub">Tasks <span>${open.length} open${done.length ? ` · ${done.length} done` : ''}</span></div>
      <div class="proj-tasks">${p.taskList.length ? p.taskList.slice(0, 12).map((t) => `<label class="proj-task ${t.done ? 'done' : ''}"><input type="checkbox" ${t.done ? 'checked' : ''} data-p="${esc(t.path)}" data-l="${t.line}"><span>${esc(t.text)}</span>${t.due ? `<small class="${!t.done && t.due < today ? 'late' : ''}">${fmtDay(t.due)}</small>` : ''}${t.priority === 'High' ? '<em>High</em>' : ''}</label>`).join('') + (p.taskList.length > 12 ? `<a href="#" class="proj-more" data-note="${esc(p.path)}">+${p.taskList.length - 12} more in the note</a>` : '') : '<p class="proj-none">No tasks yet.</p>'}</div>
      <div class="proj-add"><input class="input" placeholder="Add a task…" data-add="${k}" aria-label="Add a task to ${esc(p.name)}"><input class="input" type="date" data-due="${k}" aria-label="Due date"><button class="btn small primary" data-addbtn="${k}">${icon('plus')}</button></div>
      <footer class="proj-foot"><button class="btn small ${p.completed ? 'ghost' : 'primary'}" data-pdone="${k}" data-v="${p.completed ? '0' : '1'}">${icon(p.completed ? 'refresh' : 'check')} ${p.completed ? 'Reopen project' : 'Mark project complete'}</button><a href="#" data-note="${esc(p.path)}">${icon('file-text')} Open note</a></footer>
    </article>`;
  };
  el.innerHTML = head('Projects', `Each project is a note in <code>Projects/</code> in your vault, with its milestones and tasks. New projects join the Projects hub on the brain map.`, `<button class="btn primary" id="p-new">${icon('plus')} New project</button>`)
    + (list.length ? `<div class="proj-grid">${list.map(card).join('')}</div>` : `<div class="feed-empty">${icon('folder')}<br>No projects yet. Create your first one.</div>`);
  const reload = () => projectsPage(el, ctx);
  el.querySelector('#p-new').onclick = () => projectForm(null, async (p) => { await afterProject(ctx, p); reload(); });
  el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => projectForm(list[Number(b.dataset.edit)], async () => { await ctx.afterChange({ feed: false }); reload(); }));
  el.querySelectorAll('[data-note]').forEach((a) => a.onclick = (e) => { e.preventDefault(); openNote(a.dataset.note); });
  // Finish or reopen a project (Ryan, 2026-11-04)
  el.querySelectorAll('[data-pdone]').forEach((b) => b.onclick = async () => {
    const p = list[Number(b.dataset.pdone)]; b.disabled = true;
    try { const r = await api('/projects/complete', { path: p.path, done: b.dataset.v === '1' }); toast(r.completed ? `${r.name} marked complete` : `${r.name} reopened`); } catch (err) { toast(err.message, 'error'); }
    reload();
  });
  el.querySelectorAll('.proj-task input').forEach((c) => c.onchange = async () => { await api('/tasks/toggle', { path: c.dataset.p, line: Number(c.dataset.l) }); reload(); });
  el.querySelectorAll('[data-addbtn]').forEach((b) => {
    const k = b.dataset.addbtn, inp = el.querySelector(`[data-add="${k}"]`), due = el.querySelector(`[data-due="${k}"]`);
    const go = async () => {
      const v = inp.value.trim(); if (!v) return inp.focus();
      try { await api('/projects/task', { path: list[Number(k)].path, text: v.replace(/#high/i, '').trim(), priority: /#high/i.test(v) ? 'High' : undefined, due: due.value || undefined }); toast('Task added'); S.pendingPulse = 'project:' + list[Number(k)].path; reload(); }
      catch (e) { toast(e.message, 'error'); }
    };
    b.onclick = go; inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  });
}
// A new project joins the brain map; its node lights up with the glow beam when you're back on the dashboard.
async function afterProject(ctx, p) {
  await ctx.afterChange({ feed: false });
  S.pendingPulse = 'project:' + p.path;
  toast(`Project created: ${p.name}`);
}
function projectForm(p, done) {
  const editing = !!p;
  p = p || { name: '', client: '', description: '', start: new Date().toISOString().slice(0, 10), completion: '', milestones: [] };
  let ms = p.milestones.map((m) => ({ ...m }));
  const msRow = (m, i) => `<div class="pf-ms" data-i="${i}"><input class="input pf-ms-name" value="${esc(m.name)}" placeholder="Milestone, e.g. Design sign-off" aria-label="Milestone name"><input class="input pf-ms-date" type="date" value="${esc(m.date)}" aria-label="Milestone date"><button class="icon-btn" data-delms="${i}" title="Remove milestone" aria-label="Remove milestone">${icon('trash')}</button></div>`;
  modal(`${modalHead(editing ? 'Edit project' : 'New project', editing ? esc(p.path) : 'Saved as a note in Projects/ in your vault.')}
    <div class="field"><label for="pf-name">Project name</label><input class="input" id="pf-name" value="${esc(p.name)}" placeholder="Acme website rebuild" maxlength="80"></div>
    <div class="field"><label for="pf-client">Client</label><input class="input" id="pf-client" value="${esc(p.client)}" placeholder="Acme Corp"></div>
    <div class="field"><label for="pf-desc">Description</label><textarea class="input" id="pf-desc" rows="3" placeholder="What the project is and what done looks like">${esc(p.description)}</textarea></div>
    <div class="due-fields"><div class="field"><label for="pf-start">Start date</label><input class="input" type="date" id="pf-start" value="${esc(p.start)}"></div><div class="field"><label for="pf-end">Completion date</label><input class="input" type="date" id="pf-end" value="${esc(p.completion)}"></div></div>
    <div class="field"><label>Milestones</label><div id="pf-ms"></div><button class="btn small ghost" id="pf-addms" type="button">${icon('plus')} Add milestone</button></div>
    ${editing ? '' : `<div class="field"><label for="pf-tasks">First tasks <span style="color:var(--dim)">(optional, one per line)</span></label><textarea class="input" id="pf-tasks" rows="3" placeholder="Kickoff call\nSend the SOW"></textarea></div>`}
    <div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="pf-save">${icon('save')} ${editing ? 'Save changes' : 'Create project'}</button></div>`, {
    wide: true,
    onMount: (el, close) => {
      const box = el.querySelector('#pf-ms');
      const read = () => { ms = [...box.querySelectorAll('.pf-ms')].map((r) => ({ name: r.querySelector('.pf-ms-name').value, date: r.querySelector('.pf-ms-date').value })); };
      const draw = () => { box.innerHTML = ms.map(msRow).join(''); box.querySelectorAll('[data-delms]').forEach((b) => b.onclick = () => { read(); ms.splice(Number(b.dataset.delms), 1); draw(); }); };
      draw();
      el.querySelector('#pf-addms').onclick = () => { read(); ms.push({ name: '', date: '' }); draw(); box.querySelector('.pf-ms:last-child .pf-ms-name').focus(); };
      setTimeout(() => el.querySelector('#pf-name').focus(), 50);
      el.querySelector('#pf-save').onclick = async () => {
        read();
        const body = { name: el.querySelector('#pf-name').value.trim(), client: el.querySelector('#pf-client').value.trim(), description: el.querySelector('#pf-desc').value.trim(),
          start: el.querySelector('#pf-start').value, completion: el.querySelector('#pf-end').value, milestones: ms.filter((m) => m.name.trim() || m.date), status: p.status };
        if (!body.name) { el.querySelector('#pf-name').focus(); return toast('Give the project a name', 'error'); }
        try {
          const r = editing ? await api('/projects/update', { ...body, path: p.path }) : await api('/projects', { ...body, tasks: el.querySelector('#pf-tasks').value.split('\n') });
          close(); done(r);
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

export const PAGES = {
  projects: projectsPage,
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
