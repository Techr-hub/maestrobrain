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
  const brief = await post('/chat', { message: 'Brief me on my day' });
  ok('daily brief', /events today/.test(brief.reply));
  const call = await post('/chat', { message: 'When did Alex call me?' });
  ok('direct question: when did Alex call', /Alex Chen called you today at/.test(call.reply));
  const meet = await post('/chat', { message: 'When is my meeting with Sarah?' });
  ok('direct question: next meeting with a person', /next meeting with Sarah/.test(meet.reply));
  const time = await post('/chat', { message: 'What time is it?' });
  ok('everyday question: what time is it', /^It's \d/.test(time.reply));
  const huh = await post('/chat', { message: 'tell me a joke about penguins' });
  ok('unknown question gets a short reply', /didn't understand/.test(huh.reply) && huh.reply.length < 160);
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
    send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_agent', arguments: { handle: 'Jarvis' } } });
    setTimeout(() => {
      ok('initialize handshake', replies[1] && replies[1].result && replies[1].result.serverInfo.name === 'maestro');
      ok('tools listed', replies[2] && replies[2].result.tools.length >= 15);
      ok('search_brain finds notes', replies[3] && /Sprint 24/.test(replies[3].result.content[0].text));
      ok('skills + agents exposed as prompts', replies[4] && replies[4].result.prompts.some((p) => p.name.startsWith('skill-')) && replies[4].result.prompts.some((p) => p.name.startsWith('agent-')));
      ok('maestro_brief returns context', replies[5] && /CALENDAR/.test(replies[5].result.content[0].text));
      ok('get_agent loads an agent', replies[6] && /chief of staff/i.test(replies[6].result.content[0].text));
      child.kill();
      resolve();
    }, 2500);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
