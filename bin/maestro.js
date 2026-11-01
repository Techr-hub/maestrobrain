#!/usr/bin/env node
// Maestro command line: start | setup | connect-claude | reset
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 18 || (major === 18 && minor < 17)) {
  console.error(`\nMaestro needs Node.js 18.17 or newer (you have ${process.versions.node}).\nDownload the LTS version from https://nodejs.org and run this again.\n`);
  process.exit(1);
}

const config = require('../core/config');
const claudeDesktop = require('../core/claude-desktop');

const C = { cyan: (s) => `\x1b[36m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m` };

function banner() {
  console.log(C.cyan(`
   ███╗   ███╗ █████╗ ███████╗███████╗████████╗██████╗  ██████╗
   ████╗ ████║██╔══██╗██╔════╝██╔════╝╚══██╔══╝██╔══██╗██╔═══██╗
   ██╔████╔██║███████║█████╗  ███████╗   ██║   ██████╔╝██║   ██║
   ██║╚██╔╝██║██╔══██║██╔══╝  ╚════██║   ██║   ██╔══██╗██║   ██║
   ██║ ╚═╝ ██║██║  ██║███████╗███████║   ██║   ██║  ██║╚██████╔╝
   ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝`));
  console.log(C.dim('   Your personal second brain · Claude + Obsidian + MCP\n'));
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { const c = spawn(cmd, args, { stdio: 'ignore', detached: true }); c.on('error', () => {}); c.unref(); } catch { /* user can click the link */ }
}

function ask(rl, q, def) {
  return new Promise((resolve) => rl.question(`${q}${def ? C.dim(` (${def})`) : ''}: `, (a) => resolve(a.trim() || def || '')));
}

async function start() {
  banner();
  const { start: startServer } = require('../server');
  let port = Number(process.env.PORT) || config.load().port || 4141;
  let started;
  for (let i = 0; i < 10 && !started; i++) {
    try { started = await startServer(port + i); } catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
  }
  if (!started) throw new Error('Could not find a free port near ' + port);
  const url = `http://localhost:${started.port}`;
  const cfg = config.load();
  const cd = claudeDesktop.status();
  console.log(`   ${C.green('●')} Dashboard   ${C.bold(url)}`);
  console.log(`   ${C.green('●')} Vault       ${cfg.vaultPath}`);
  console.log(`   ${cd.registered ? C.green('●') : C.yellow('○')} Claude      ${cd.registered ? 'Maestro is connected to Claude Desktop' : 'Not connected yet. Run: npm run connect-claude'}`);
  console.log(C.dim('\n   Keep this window open while you use Maestro. Press Ctrl+C to stop.\n'));
  if (!process.env.MAESTRO_NO_BROWSER) openBrowser(url);
}

async function setup() {
  banner();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const cfg = config.load();
  console.log(C.bold('Let’s set up your brain. Press Enter to accept the default.\n'));
  cfg.user.name = await ask(rl, 'Your first name', cfg.user.name);
  cfg.user.role = await ask(rl, 'What do you do (Product Manager, Designer, Founder…)', cfg.user.role);
  cfg.assistantName = await ask(rl, 'Name your assistant', cfg.assistantName);
  const vaultPath = await ask(rl, 'Obsidian vault folder', cfg.vaultPath);
  cfg.vaultPath = path.resolve(vaultPath.replace(/^~(?=$|[\\/])/, require('os').homedir()));
  config.save(cfg);
  const connect = (await ask(rl, 'Connect Maestro to Claude Desktop now? (y/n)', 'y')).toLowerCase().startsWith('y');
  rl.close();
  if (connect) connectClaude();
  console.log(C.green('\nSetup saved. Start the dashboard with: npm start\n'));
}

function connectClaude() {
  const st = claudeDesktop.status();
  if (!st.installed) console.log(C.yellow('Claude Desktop does not look installed yet (get it at https://claude.ai/download). Writing the config anyway.'));
  const r = claudeDesktop.register();
  console.log(C.green('\n✓ Maestro added to Claude Desktop:'));
  r.written.forEach((f) => console.log('  ' + f));
  console.log(`\n${C.bold('Next:')} fully quit Claude Desktop (Cmd+Q / right-click tray icon → Quit) and reopen it.`);
  console.log('Then click the tools/connectors icon in a new chat: you should see "maestro" with its tools.');
  console.log(C.dim('Try asking Claude: "Use Maestro to brief me on my day."\n'));
}

function reset() {
  require('../core/feed').reset();
  console.log(C.green('Demo feed reset.'));
}

const cmd = process.argv[2] || 'start';
const actions = { start, setup, 'connect-claude': connectClaude, reset };
if (!actions[cmd]) { console.log('Usage: node bin/maestro.js [start|setup|connect-claude|reset]'); process.exit(1); }
Promise.resolve(actions[cmd]()).catch((e) => { console.error('\n' + e.message); process.exit(1); });
