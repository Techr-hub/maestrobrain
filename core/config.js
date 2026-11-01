// Maestro configuration: one JSON file in ./data that every part of the brain shares
// (dashboard server, Claude Desktop MCP server, CLI).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.MAESTRO_DATA || path.join(ROOT, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const FOUNDATION = ['gmail', 'outlook', 'email', 'icalendar', 'gcal', 'calendly', 'slack', 'twilio_sms', 'whatsapp', 'twilio_calls', 'google_meet', 'teams', 'zoom'];

function defaultConfig() {
  // Everything starts connected in demo mode so the brain works the moment it is installed.
  const demo = (ids) => Object.fromEntries(ids.map((id) => [id, { mode: 'demo', connectedAt: Date.now() }]));
  return {
    version: 1,
    user: { name: 'Ryan', role: 'Product Manager', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    assistantName: 'Maestro',
    profile: 'business',
    vaultPath: path.join(ROOT, 'vault'),
    llm: {
      provider: 'demo', // demo | anthropic | openai | gemini | compatible
      anthropic: { apiKey: '', model: 'claude-opus-5-5' },
      openai: { apiKey: '', model: 'gpt-5' },
      gemini: { apiKey: '', model: 'gemini-2.5-flash' },
      // Any OpenAI-compatible endpoint: Ollama (Hermes 3/4), LM Studio, OpenRouter, Nous Portal...
      compatible: { baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'hermes3', label: 'Hermes (Ollama)' },
    },
    voice: { speakReplies: true, handsFree: false, voiceName: '', rate: 1.05, lang: 'en-US' },
    connections: {
      business: demo(['outlook', 'email', 'gcal', 'slack', 'twilio_calls', 'icalendar']),
      personal: demo(['gmail', 'icalendar', 'twilio_sms', 'twilio_calls']),
    },
    packs: [],
    workflows: {
      morning_brief: { enabled: true, time: '08:00' },
      meeting_prep: { enabled: true, minutesBefore: 15 },
      inbox_triage: { enabled: true, everyMinutes: 60 },
      end_of_day: { enabled: false, time: '17:30' },
    },
    demo: { liveFeed: true, intervalSeconds: 35 },
    port: 4141,
    onboarded: false,
    // 'demo' fills the brain with sample data; 'real' starts empty and only shows what the user connects.
    dataMode: 'demo',
    // Where the brain's knowledge lives. connected stays false until the user picks a source on first run.
    knowledge: { type: 'obsidian', connected: false },
  };
}

function deepMerge(base, extra) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return extra === undefined ? base : extra;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDataDir();
  let saved = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try { saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { saved = {}; }
  }
  const cfg = deepMerge(defaultConfig(), saved);
  // connections are replaced wholesale, not merged, so disconnecting sticks
  if (saved.connections) cfg.connections = { business: {}, personal: {}, ...saved.connections };
  // The assistant used to be called Jarvis; older installs move to Maestro.
  if (!cfg.assistantName || /^jarvis$/i.test(cfg.assistantName)) cfg.assistantName = 'Maestro';
  if (!path.isAbsolute(cfg.vaultPath)) cfg.vaultPath = path.resolve(ROOT, cfg.vaultPath);
  return cfg;
}

function save(cfg) {
  ensureDataDir();
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, CONFIG_FILE);
  return cfg;
}

function update(mutator) {
  const cfg = load();
  mutator(cfg);
  return save(cfg);
}

// Never send API keys to the browser; show only whether one is set.
function publicView(cfg) {
  const copy = JSON.parse(JSON.stringify(cfg));
  for (const p of ['anthropic', 'openai', 'gemini', 'compatible']) {
    if (copy.llm[p]) copy.llm[p].apiKey = copy.llm[p].apiKey ? '••••' + copy.llm[p].apiKey.slice(-4) : '';
  }
  for (const prof of Object.values(copy.connections || {})) {
    for (const c of Object.values(prof)) {
      if (c.fields) for (const k of Object.keys(c.fields)) if (/token|secret|password|key/i.test(k) && c.fields[k]) c.fields[k] = '••••';
    }
  }
  return copy;
}

module.exports = { ROOT, DATA_DIR, CONFIG_FILE, FOUNDATION, load, save, update, publicView, defaultConfig };
