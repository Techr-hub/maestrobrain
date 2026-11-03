// Agents and skills are Markdown files in the vault, so people can read and edit them in Obsidian.
//   Agents/<Name>.md  -> frontmatter (handle, color, provider, model, baseUrl) + body = system prompt
//   Skills/<Name>.md  -> frontmatter (description, triggers, agent) + body = step-by-step instructions
const path = require('path');
const vault = require('./vault');

function asList(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

// Index notes ("Skills Library", tagged index) describe a folder; they aren't a skill or agent themselves.
const isIndex = (n) => (n.tags || []).map(String).map((t) => t.toLowerCase()).includes('index');
function agents() {
  const list = vault.loadNotes().filter((n) => n.folder === 'Agents' && !isIndex(n)).map((n) => {
    const fm = n.frontmatter;
    return {
      path: n.path,
      name: fm.name || n.title,
      handle: (fm.handle || n.title.split(' ')[0]).replace(/^@/, ''),
      role: fm.role || '',
      description: fm.description || '',
      color: fm.color || '#00e5ff',
      icon: fm.icon || 'bot',
      provider: fm.provider || 'default',
      model: fm.model || '',
      baseUrl: fm.baseUrl || '',
      apiKeyEnv: fm.apiKeyEnv || '',
      pack: fm.pack || '',
      order: Number(fm.order || 50),
      skills: asList(fm.skills),
      prompt: n.body.trim(),
    };
  });
  // Vaults from before the rename still have Agents/Jarvis.md: show it as Maestro.
  // If the vault also has the new Agents/Maestro.md, the old file is a duplicate "Chief of staff" (Ryan, 2026-11-03):
  // it's moved out of Agents/ into .maestro/old/ (kept, not deleted) and left out of the list.
  const hasNew = list.some((a) => /^maestro$/i.test(a.handle) && !/jarvis/i.test(a.path));
  for (const a of list.filter((x) => /^jarvis$/i.test(x.handle) && hasNew)) retire(a.path);
  let out = list.filter((a) => !(hasNew && /^jarvis$/i.test(a.handle)));
  for (const a of out) if (/^jarvis$/i.test(a.handle)) Object.assign(a, { name: 'Maestro', handle: 'Maestro', prompt: a.prompt.replace(/\bJarvis\b/g, 'Maestro') });
  // One agent per handle: a copy left by an older seed or import never shows twice.
  const seen = new Set();
  out = out.filter((a) => { const k = a.handle.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return out;
}

function retire(rel) {
  try {
    const fs = require('fs'), root = vault.vaultRoot();
    const from = vault.safeJoin(root, rel), to = vault.safeJoin(root, '.maestro/old/' + path.basename(rel));
    if (!fs.existsSync(from)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    vault.invalidate();
  } catch { /* read-only vault: it's still left out of the list */ }
}

function findAgent(handle) {
  if (!handle) return null;
  const h = handle.replace(/^@/, '').toLowerCase();
  return agents().find((a) => a.handle.toLowerCase() === h || a.name.toLowerCase() === h) || null;
}

function skills() {
  return vault.loadNotes().filter((n) => n.folder === 'Skills' && !isIndex(n)).map((n) => ({
    path: n.path,
    name: n.frontmatter.name || n.title,
    slug: path.basename(n.path, '.md').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    description: n.frontmatter.description || '',
    triggers: asList(n.frontmatter.triggers),
    agent: n.frontmatter.agent || '',
    pack: n.frontmatter.pack || '',
    instructions: n.body.trim(),
  }));
}

function matchSkill(message) {
  const m = message.toLowerCase();
  let best = null;
  for (const s of skills()) {
    const hits = s.triggers.filter((t) => m.includes(t.toLowerCase())).length;
    if (hits && (!best || hits > best.hits)) best = { skill: s, hits };
  }
  return best ? best.skill : null;
}

function createAgent({ name, handle, role, description, color, provider, model, baseUrl, prompt }) {
  const fm = [
    '---',
    `name: ${name}`,
    `handle: ${(handle || name.split(' ')[0]).replace(/^@/, '')}`,
    role ? `role: ${JSON.stringify(role)}` : null,
    description ? `description: ${JSON.stringify(description)}` : null,
    `color: "${color || '#00e5ff'}"`,
    `provider: ${provider || 'default'}`,
    model ? `model: ${model}` : null,
    baseUrl ? `baseUrl: ${baseUrl}` : null,
    'order: 60',
    'tags: [agent]',
    '---',
  ].filter(Boolean).join('\n');
  const body = prompt || `You are ${name}, a specialist agent inside the user's Maestro second brain. ${description || ''}\n\nAlways ground answers in the user's notes, memory and feed. Link notes with [[wikilinks]].`;
  const rel = `Agents/${name.replace(/[\\/:*?"<>|]/g, '')}.md`;
  vault.writeNote(rel, fm + '\n\n' + body + '\n\n[[Maestro Home]]');
  return rel;
}

function createSkill({ name, description, triggers, agent, instructions }) {
  const fm = ['---', `name: ${name}`, description ? `description: ${JSON.stringify(description)}` : null,
    triggers ? `triggers: [${asList(triggers).join(', ')}]` : null, agent ? `agent: ${agent}` : null, 'tags: [skill]', '---'].filter(Boolean).join('\n');
  const rel = `Skills/${name.replace(/[\\/:*?"<>|]/g, '')}.md`;
  vault.writeNote(rel, `${fm}\n\n# ${name}\n\n${instructions || ''}\n\nPart of [[Skills Library]]`);
  return rel;
}

// Import an agent or skill someone shared as a Markdown file (or a Claude SKILL.md).
function importMarkdown(filename, text) {
  const { data, body } = vault.parseFrontmatter(text);
  const base = (data.name || path.basename(filename || 'Imported', '.md')).replace(/[\\/:*?"<>|]/g, '').trim() || 'Imported';
  const isAgent = data.handle || /agent/i.test(String(data.tags || '')) || /^agent/i.test(data.type || '');
  const folder = isAgent ? 'Agents' : 'Skills';
  let content = text;
  if (!data.name && !Object.keys(data).length) content = `---\nname: ${base}\ntags: [${isAgent ? 'agent' : 'skill'}]\n---\n\n${body}`;
  const rel = vault.writeNote(`${folder}/${base}.md`, content);
  return { path: rel, kind: isAgent ? 'agent' : 'skill' };
}

// Turn vault skills and agents into Claude Skills (folders with SKILL.md) that can be uploaded to
// Claude Desktop / claude.ai (Settings → Capabilities → Skills) or copied into ~/.claude/skills.
// Each one tells Claude to use the Maestro MCP tools, so every skill reads the same knowledge base.
function claudeSkillFiles() {
  const files = [];
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const kb = '\n\n## Knowledge base\nThis skill is part of the Maestro second brain. Before answering, use the Maestro MCP tools: `get_memory` for who the user is, `search_brain` and `read_note` for notes, `get_feed`, `get_calendar` and `list_tasks` for live context. Save useful outputs with `write_note`, facts with `remember`, and decisions with `log_decision`. Cite notes as [[Title]].\n';
  for (const s of skills()) {
    const desc = (s.description || `Maestro skill: ${s.name}`).replace(/\n/g, ' ') + (s.triggers.length ? ` Use when the user asks to ${s.triggers.slice(0, 4).join(', ')}.` : '');
    files.push({ path: `maestro-${slug(s.name)}/SKILL.md`, content: `---\nname: maestro-${slug(s.name)}\ndescription: ${JSON.stringify(desc.slice(0, 1000))}\n---\n\n${/^#\s/.test(s.instructions) ? '' : `# ${s.name}\n\n`}${s.instructions}${kb}` });
  }
  for (const a of agents()) {
    const desc = `Act as @${a.handle}, the ${a.role || a.name} agent from the user's Maestro second brain. Use when the user mentions @${a.handle} or asks for ${a.role || a.name} help.`;
    files.push({ path: `maestro-agent-${slug(a.handle)}/SKILL.md`, content: `---\nname: maestro-agent-${slug(a.handle)}\ndescription: ${JSON.stringify(desc)}\n---\n\n# @${a.handle} — ${a.name}\n\n${a.prompt}${kb}` });
  }
  return files;
}

module.exports = { agents, findAgent, skills, matchSkill, createAgent, createSkill, importMarkdown, claudeSkillFiles };
