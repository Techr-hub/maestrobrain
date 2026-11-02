// The intelligence feed: every notification from every connected source, normalised into one shape:
// { id, ts, source, profile, category, title, quote, summary, priority, deadline, progress, actions, unread }
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const config = require('./config');
const demo = require('./demo');
const connectors = require('./connectors');

const FEED_FILE = path.join(config.DATA_DIR, 'feed.json');
const MAX_ITEMS = 400;
const bus = new EventEmitter();
bus.setMaxListeners(50);

let idCounter = 0;
const newId = () => Date.now().toString(36) + '-' + (idCounter++).toString(36) + Math.random().toString(36).slice(2, 6);

function readAll() {
  if (!fs.existsSync(FEED_FILE)) return seed();
  try { return JSON.parse(fs.readFileSync(FEED_FILE, 'utf8')); } catch { return seed(); }
}

function writeAll(items) {
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  const tmp = FEED_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(items.slice(0, MAX_ITEMS), null, 1));
  fs.renameSync(tmp, FEED_FILE);
}

function seed() {
  const now = Date.now();
  const items = demo.SEED.map((s) => normalize({ ...s, ts: now - s.minutesAgo * 60000, demo: true }));
  items.sort((a, b) => b.ts - a.ts);
  writeAll(items);
  return items;
}

function normalize(raw) {
  const c = connectors.get(raw.source);
  const { minutesAgo, ...rest } = raw;
  return {
    id: raw.id || newId(),
    ts: raw.ts || Date.now(),
    sourceName: c ? c.name : raw.source === 'system' ? 'Maestro' : raw.source,
    unread: raw.unread !== undefined ? raw.unread : true,
    priority: raw.priority || '',
    deadline: raw.deadline || '',
    actions: raw.actions || [],
    ...rest,
  };
}

// Which items does the user see right now? Only sources connected in the active profile,
// system items, and pack items for installed packs.
function visible(items, cfg, profile) {
  const conns = (cfg.connections && cfg.connections[profile]) || {};
  return items.filter((i) => {
    if (i.profile !== profile && i.profile !== 'both') return false;
    if (cfg.dataMode === 'real' && i.demo) return false; // real setup: no sample items at all
    if (i.pack && !cfg.packs.includes(i.pack)) return false;
    if (i.source === 'system') return true;
    const conn = conns[i.source];
    if (!conn) return false;
    if (i.demo && conn.mode !== 'demo') return false; // live and Claude-connected sources hide their demo data
    return true;
  });
}

function list({ profile, source, category, limit = 60 } = {}) {
  const cfg = config.load();
  const prof = profile || cfg.profile;
  let items = visible(readAll(), cfg, prof);
  if (source && source !== 'all') items = items.filter((i) => i.source === source);
  if (category && category !== 'all') items = items.filter((i) => i.category === category);
  items.sort((a, b) => b.ts - a.ts);
  return items.slice(0, limit);
}

function add(raw, { emit = true } = {}) {
  const items = readAll();
  if (raw.externalId && items.some((i) => i.externalId === raw.externalId)) return null;
  const item = normalize(raw);
  items.unshift(item);
  writeAll(items);
  if (emit) bus.emit('item', item);
  return item;
}

// Grey out cards about a calendar event that was removed (by Maestro or in the calendar itself).
// match(item) decides which cards; each changed card is re-sent to open dashboards.
function markRemoved(match) {
  const items = readAll();
  const hit = items.filter((i) => !i.removed && !/^Cancelled: /.test(i.title || '') && match(i));
  hit.forEach((i) => { i.removed = true; i.removedAt = Date.now(); i.unread = false; });
  if (hit.length) { writeAll(items); hit.forEach((i) => bus.emit('update', i)); }
  return hit.length;
}
// Cards that belong to one event: agenda, new/moved notices and "New:" cards Maestro posted when creating it.
function eventMatcher(e, { series = false } = {}) {
  const key = e.uid || e.title;
  const start = new Date(e.start).toISOString();
  const srcs = e.source === 'maestro' ? ['maestro', 'system'] : [e.source];
  return (i) => {
    if (i.eventKey) return i.eventKey === key && (series || !i.eventStart || new Date(i.eventStart).toISOString() === start);
    const x = i.externalId || '';
    return ['up', 'new', 'moved'].some((k) => srcs.some((src) => x.startsWith(`cal:${k}:${src}:${key}:`) && (series || x.endsWith(':' + start) || x.endsWith(':' + e.start))));
  };
}

function markRead(id) {
  const items = readAll();
  const it = items.find((i) => i.id === id);
  if (it) { it.unread = false; writeAll(items); }
  return it;
}

// When a source is connected, surface its demo items as brand new so people see them arrive.
function surfaceSource(sourceId, profile) {
  const items = readAll();
  const now = Date.now();
  let mine = items.filter((i) => i.source === sourceId && i.profile === profile && i.demo);
  if (!mine.length) {
    mine = demo.SEED.filter((t) => t.source === sourceId && (t.profile === profile || t.profile === 'both')).map((t) => normalize({ ...t, demo: true }));
    items.push(...mine);
  }
  mine.forEach((it, idx) => { it.ts = now - idx * 45000; it.unread = true; });
  items.sort((a, b) => b.ts - a.ts);
  writeAll(items);
  for (const it of mine.slice().reverse()) bus.emit('item', it);
  return mine.length;
}

function surfacePack(packId) {
  const items = readAll();
  const now = Date.now();
  const mine = items.filter((i) => i.pack === packId);
  mine.forEach((it, idx) => { it.ts = now - idx * 30000; it.unread = true; });
  items.sort((a, b) => b.ts - a.ts);
  writeAll(items);
  for (const it of mine.slice().reverse()) bus.emit('item', it);
}

function reset() {
  if (fs.existsSync(FEED_FILE)) fs.unlinkSync(FEED_FILE);
  return seed();
}

// ---------------- Demo stream ----------------
let streamIdx = 0;
function nextDemoItem() {
  const cfg = config.load();
  const pool = demo.STREAM.filter((s) => {
    if (s.pack && !cfg.packs.includes(s.pack)) return false;
    const conns = cfg.connections[s.profile] || {};
    return s.source === 'system' || (conns[s.source] && conns[s.source].mode === 'demo');
  });
  if (!pool.length) return null;
  const tpl = pool[streamIdx++ % pool.length];
  return add({ ...tpl, ts: Date.now(), demo: true, streamed: true });
}

// ---------------- Live polling ----------------
async function pollLive() {
  const cfg = config.load();
  const results = [];
  for (const profile of Object.keys(cfg.connections)) {
    for (const [id, conn] of Object.entries(cfg.connections[profile])) {
      if (conn.mode !== 'live' || !conn.fields) continue;
      try {
        if (id === 'slack') {
          const { messages } = await connectors.slackHistory(conn.fields);
          const fresh = Date.now() - 6 * 3600000;
          for (const m of messages) {
            if (m.mine) continue;
            add({ externalId: m.externalId, ts: m.ts, source: 'slack', profile, category: 'CONVERSATION', title: `${m.user} in #${m.channelName}`, quote: '"' + m.text.slice(0, 220) + '"',
              summary: m.mentionsMe ? 'You were mentioned' : m.text.includes('?') ? 'Question in the channel' : '', priority: m.mentionsMe ? 'Medium' : '', unread: m.ts > fresh, actions: m.mentionsMe ? ['Draft a reply'] : [] });
          }
        } else if (id === 'twilio_sms') {
          const msgs = await connectors.twilioList(conn.fields, 'messages');
          for (const m of msgs) if (m.direction === 'inbound' && !/^whatsapp:/.test(m.from || '')) add({ externalId: 'sms:' + m.sid, ts: Date.parse(m.date_sent || m.date_created), source: 'twilio_sms', profile, category: 'SMS', title: `Text from ${m.from}`, quote: '"' + (m.body || '').slice(0, 220) + '"' });
        } else if (id === 'whatsapp') {
          const msgs = await connectors.twilioList(conn.fields, 'messages');
          for (const m of msgs) if (m.direction === 'inbound' && /^whatsapp:/.test(m.from || '')) add({ externalId: 'wa:' + m.sid, ts: Date.parse(m.date_sent || m.date_created), source: 'whatsapp', profile, category: 'SMS', title: `WhatsApp from ${m.from.replace('whatsapp:', '')}`, quote: '"' + (m.body || '').slice(0, 220) + '"' });
        } else if (id === 'twilio_calls') {
          const calls = await connectors.twilioList(conn.fields, 'calls');
          for (const c of calls) if (c.direction === 'inbound') add({ externalId: 'call:' + c.sid, ts: Date.parse(c.start_time || c.date_created), source: 'twilio_calls', profile, category: 'CALL', title: `${c.status === 'completed' ? 'Call' : 'Missed call'} from ${c.from}`, quote: `Duration ${c.duration || 0}s`, priority: c.status === 'completed' ? '' : 'Medium' });
        }
        results.push({ id, profile, ok: true });
        if (conn.lastError) config.update((c) => { if (c.connections[profile][id]) delete c.connections[profile][id].lastError; });
      } catch (e) {
        results.push({ id, profile, ok: false, error: e.message });
        config.update((c) => { if (c.connections[profile][id]) c.connections[profile][id].lastError = e.message; });
      }
    }
  }
  return results;
}

module.exports = { list, add, markRead, markRemoved, eventMatcher, surfaceSource, surfacePack, reset, nextDemoItem, pollLive, bus, readAll };
