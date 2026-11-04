// The intelligence feed: every notification from every connected source, normalised into one shape:
// { id, ts, source, profile, category, title, quote, summary, priority, deadline, progress, actions, unread }
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const config = require('./config');
const eventtypes = require('./eventtypes');
const demo = require('./demo');
const connectors = require('./connectors');

const FEED_FILE = path.join(config.DATA_DIR, 'feed.json');
const MAX_ITEMS = 400;
const bus = new EventEmitter();
bus.setMaxListeners(50);

let idCounter = 0;
const newId = () => Date.now().toString(36) + '-' + (idCounter++).toString(36) + Math.random().toString(36).slice(2, 6);

// Ryan (2026-11-02): Insight cards are only reminders for tasks you created that are coming due. Older demo
// Insight cards are dropped, and workflow results show as Brief cards.
// Inbox triage cards are gone from the feed (Ryan, 2026-11-03), including ones already stored.
const isTriage = (i) => i.workflow === 'inbox_triage' || /^inbox triage\b/i.test(i.title || '');
function tidy(items) {
  return items.filter((i) => (i.category !== 'INSIGHT' || i.reminder || i.workflow) && !isTriage(i)).map((i) => {
    if (i.category === 'INSIGHT' && i.workflow) i = { ...i, category: 'BRIEF' };
    // "Prep me for this" became "Add Task" (Ryan, 2026-11-02)
    if (i.actions && i.actions.includes('Prep me for this')) i = { ...i, actions: i.actions.map((a) => (a === 'Prep me for this' ? 'Add Task' : a)) };
    return i;
  });
}
function readAll() {
  if (!fs.existsSync(FEED_FILE)) return seed();
  try { return tidy(JSON.parse(fs.readFileSync(FEED_FILE, 'utf8'))).filter((i) => !isDismissed(i)); } catch { return seed(); }
}

function writeAll(items) {
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  const tmp = FEED_FILE + '.tmp';
  // Pinned cards are never trimmed, however many new ones stream in.
  const room = MAX_ITEMS - items.filter((i) => i.pinned).length;
  let n = 0;
  fs.writeFileSync(tmp, JSON.stringify(items.filter((i) => i.pinned || n++ < room), null, 1));
  fs.renameSync(tmp, FEED_FILE);
}

function seed() {
  const now = Date.now();
  const items = demo.SEED.map((s) => normalize({ ...s, ts: now - s.minutesAgo * 60000, demo: true })).filter((i) => !isDismissed(i));
  items.sort((a, b) => b.ts - a.ts);
  restorePins(items);
  writeAll(items);
  return items;
}

// Pins are also kept next to your settings (<vault>/.maestro/pins.json and ~/.maestro/pins.json), so they
// come back after a fresh download or a reset, like your connections do.
function pinFiles() {
  const cfg = config.load();
  return [cfg.vaultPath && fs.existsSync(cfg.vaultPath) ? path.join(cfg.vaultPath, '.maestro', 'pins.json') : null, path.join(config.HOME_DIR, 'pins.json')].filter(Boolean);
}
function savePins(items) {
  const body = JSON.stringify({ savedAt: Date.now(), pins: items.filter((i) => i.pinned) }, null, 1);
  for (const f of pinFiles()) { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); } catch { /* read-only: data/ still has them */ } }
}
function savedPins() {
  const all = pinFiles().map((f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }).filter(Boolean);
  return (all.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0] || { pins: [] }).pins || [];
}
const sameCard = (a, b) => a.id === b.id || (a.externalId && a.externalId === b.externalId) || (a.source === b.source && a.title === b.title && a.profile === b.profile);
function restorePins(items) {
  for (const p of savedPins().filter((x) => !isDismissed(x))) {
    const hit = items.find((i) => sameCard(i, p));
    if (hit) Object.assign(hit, { pinned: true, pinnedAt: p.pinnedAt || Date.now() });
    else items.push({ ...p, pinned: true });
  }
}

// Cleared cards (Ryan, 2026-11-02): the X on a card removes it for good. Its key is remembered (data/dismissed.json,
// plus <vault>/.maestro and ~/.maestro like pins) so calendar re-reads, demo streams and resets never bring it back.
const DISMISSED_FILE = path.join(config.DATA_DIR, 'dismissed.json');
const cardKey = (i) => i.externalId || `${i.source}|${i.profile || ''}|${i.title}`;
let dismissedCache = null;
function dismissedFiles() { return [DISMISSED_FILE, ...pinFiles().map((f) => f.replace(/pins\.json$/, 'dismissed.json'))]; }
function dismissed() {
  if (dismissedCache) return dismissedCache;
  dismissedCache = new Set();
  for (const f of dismissedFiles()) { try { JSON.parse(fs.readFileSync(f, 'utf8')).keys.forEach((k) => dismissedCache.add(k)); } catch { /* none yet */ } }
  return dismissedCache;
}
function isDismissed(i) { return dismissed().has(cardKey(i)); }
function dismiss(id) {
  const items = readAll();
  const it = items.find((i) => i.id === id);
  if (!it) return null;
  const set = dismissed();
  set.add(cardKey(it));
  const body = JSON.stringify({ savedAt: Date.now(), keys: [...set].slice(-5000) });
  for (const f of dismissedFiles()) { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); } catch { /* read-only copy */ } }
  writeAll(items.filter((i) => i !== it));
  if (it.pinned) savePins(items.filter((i) => i !== it));
  bus.emit('remove', it);
  return { id: it.id, dismissed: true };
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
  items.sort(byPinThenTime);
  const types = eventtypes.list(cfg);
  return items.slice(0, limit).map((i) => withType(i, cfg, types));
}
// Calendar cards carry an event type (Meeting, Workshop, Call…) for their label (Ryan, 2026-11-04). Every card sent to
// the dashboard goes through this, including live updates, so the label and its dropdown are always there.
function withType(i, cfg = config.load(), types = eventtypes.list(cfg)) {
  if (!i || i.category !== 'MEETING' || (i.eventType && types.some((t) => t.id === i.eventType))) return i;
  return { ...i, eventType: eventtypes.typeFor({ title: String(i.title || '').replace(/^(New( recurring event)?|Moved|Time changed|Cancelled|Reminder|In [^:]+|Starting now|Happening now): /, ''), description: `${i.description || ''} ${i.quote || ''}`, eventKey: i.eventKey || i.id }, i.source, cfg) };
}

function add(raw, { emit = true } = {}) {
  if (isDismissed(raw)) return null; // cleared with the card's X
  const items = readAll();
  if (raw.externalId) {
    const had = items.find((i) => i.externalId === raw.externalId);
    if (had) {
      // Cards posted before descriptions were kept pick theirs up the next time the calendar is read.
      if (raw.description && had.description !== raw.description) { had.description = raw.description; writeAll(items); if (emit) bus.emit('update', had); }
      return null;
    }
  }
  const item = normalize(raw);
  items.unshift(item);
  writeAll(items);
  if (emit) bus.emit('item', item);
  return item;
}

// An event's description as plain text for its feed card (Ryan, 2026-11-02): calendar escapes and HTML removed,
// line breaks kept, Maestro's own "Created by Maestro" tag and bare vault-note paths left out.
function eventText(e) {
  let t = String((e && (e.description || (e.notes && !/^[\w -]+\/[\w .'&-]+$/.test(e.notes) ? e.notes : ''))) || '');
  t = t.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, (m, h, x) => (x && x !== h ? `${x} ${h}` : h)).replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/^\s*Created by Maestro\.?\s*$/gim, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t.slice(0, 2000);
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
// Bring an event's existing cards up to date with what the calendar says now (Ryan, 2026-11-04: a changed time didn't
// show after a refresh). match(item) picks the cards; fields(item) returns what to change. Re-sent to open dashboards.
function updateCards(match, fields) {
  let items = readAll();
  const hit = [], drop = new Set();
  for (const i of items) {
    if (i.removed || !match(i)) continue;
    const f = fields(i) || {};
    // a card for the event's new time is already there (an older refresh posted it): this stale copy goes
    if (f.externalId && f.externalId !== i.externalId && items.some((o) => o !== i && o.externalId === f.externalId)) { drop.add(i.id); continue; }
    const changed = Object.keys(f).filter((k) => f[k] !== undefined && i[k] !== f[k]);
    if (!changed.length) continue;
    changed.forEach((k) => { i[k] = f[k]; });
    hit.push(i);
  }
  if (drop.size) { items = items.filter((i) => !drop.has(i.id)); drop.forEach((id) => bus.emit('remove', { id })); }
  if (hit.length || drop.size) { writeAll(items); hit.forEach((i) => bus.emit('update', i)); }
  return hit.length + drop.size;
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

// A task's reminder cards (core/reminders.js): externalId "remind:<profile>:<path>:<hash of text>:<due>:<stage>".
const taskHash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
const isTaskReminder = (relPath, text) => { const mid = `:${relPath}:${taskHash(text)}:`; return (i) => i.reminder && String(i.externalId || '').startsWith('remind:') && String(i.externalId).includes(mid); };
// Ticking a task off marks its reminder cards Completed (Ryan, 2026-11-02); unticking brings them back.
function markTaskDone(relPath, text, done = true) {
  const items = readAll();
  const hit = items.filter((i) => isTaskReminder(relPath, text)(i) && !!i.completed !== !!done);
  hit.forEach((i) => { i.completed = !!done; i.completedAt = done ? Date.now() : 0; if (done) i.unread = false; });
  if (hit.length) { writeAll(items); hit.forEach((i) => bus.emit('update', i)); }
  return hit.length;
}
// An edited task's old reminder cards are taken out of the feed.
function dropTaskReminders(relPath, text) {
  const items = readAll();
  const gone = items.filter(isTaskReminder(relPath, text));
  if (gone.length) { writeAll(items.filter((i) => !gone.includes(i))); gone.forEach((i) => bus.emit('remove', i)); }
  return gone.length;
}

// Pinned cards stay at the top of the feed until unpinned.
function setPinned(id, pinned) {
  const items = readAll();
  const it = items.find((i) => i.id === id);
  if (!it) return null;
  it.pinned = !!pinned; it.pinnedAt = pinned ? Date.now() : 0;
  writeAll(items);
  savePins(items);
  bus.emit('update', it);
  return it;
}
const byPinThenTime = (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.pinned ? (b.pinnedAt || 0) - (a.pinnedAt || 0) : 0) || b.ts - a.ts;

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

module.exports = { withType, updateCards, markTaskDone, dropTaskReminders, list, add, dismiss, eventText, markRead, setPinned, byPinThenTime, markRemoved, eventMatcher, surfaceSource, surfacePack, reset, nextDemoItem, pollLive, bus, readAll };
