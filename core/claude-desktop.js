// Registers Maestro as an MCP server inside Claude Desktop, so Claude can read and write the brain.
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');

function candidateConfigPaths() {
  const home = os.homedir();
  const out = [];
  if (process.platform === 'darwin') {
    out.push(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'));
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    out.push(path.join(appData, 'Claude', 'claude_desktop_config.json'));
    // Microsoft Store installs keep config inside the package folder.
    const pkgs = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Packages');
    try {
      for (const d of fs.readdirSync(pkgs)) {
        if (/^(AnthropicPBC\.)?Claude/i.test(d)) out.push(path.join(pkgs, d, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'));
      }
    } catch { /* not a store install */ }
  } else {
    out.push(path.join(home, '.config', 'Claude', 'claude_desktop_config.json'));
  }
  return out;
}

function serverEntry() {
  return {
    command: process.execPath, // absolute path to node: Claude Desktop does not inherit the shell PATH
    args: [path.join(config.ROOT, 'mcp', 'server.js')],
    env: { MAESTRO_DATA: config.DATA_DIR },
  };
}

function status() {
  const paths = candidateConfigPaths();
  const found = paths.find((p) => fs.existsSync(p)) || null;
  let registered = false;
  if (found) {
    try { registered = !!(JSON.parse(fs.readFileSync(found, 'utf8')).mcpServers || {}).maestro; } catch { /* unreadable */ }
  }
  const claudeDir = path.dirname(paths[0]);
  return { configPath: found || paths[0], exists: !!found, installed: fs.existsSync(claudeDir) || !!found, registered, entry: serverEntry() };
}

function register() {
  const paths = candidateConfigPaths();
  const targets = paths.filter((p) => fs.existsSync(path.dirname(p)));
  if (!targets.length) targets.push(paths[0]);
  const written = [];
  for (const file of targets) {
    let json = {};
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      try { json = raw.trim() ? JSON.parse(raw) : {}; } catch { throw new Error(`Could not parse ${file}. Fix or delete it, then try again.`); }
      fs.writeFileSync(file + '.maestro-backup', raw);
    }
    json.mcpServers = json.mcpServers || {};
    json.mcpServers.maestro = serverEntry();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(json, null, 2));
    written.push(file);
  }
  return { written, entry: serverEntry() };
}

module.exports = { status, register, serverEntry, candidateConfigPaths };
