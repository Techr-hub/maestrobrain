// Calendar watcher: notices new, moved and cancelled events in every live calendar
// (iCloud / any ICS link, Google Calendar, Outlook, Calendly) and posts them to the Intelligence Feed.
//
// The first look at a calendar only takes a snapshot, so connecting doesn't flood the feed with old events.
// After that, every check compares against the snapshot. Calendly bookings that land in a connected
// calendar are labelled "Booked through Calendly".
const fs = require('fs');
const path = require('path');
const config = require('./config');
const connectors = require('./connectors');
const feed = require('./feed');

const FILE = path.join(config.DATA_DIR, 'calendar-seen.json');
const ICS_SOURCES = ['icalendar', 'gcal', 'outlook'];
const HORIZON = 60 * 86400000; // watch the next 60 days
const calendlyCache = new Map(); // profile -> upcoming Calendly events (for the Calendar page)

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } }
function save(s) { fs.mkdirSync(config.DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(s)); }

const when = (iso, allDay) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return allDay ? `${day} · all day` : `${day} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
};
const viaCalendly = (e) => /calendly/i.test(`${e.description || ''} ${e.location || ''} ${e.organizer || ''}`);
const soon = (iso) => new Date(iso) - Date.now() < 24 * 3600000;

// One snapshot entry per series (recurring) or per single event.
function snapshot(events) {
  const now = Date.now(), out = {};
  for (const e of events) {
    if (new Date(e.end) < now || new Date(e.start) - now > HORIZON) continue;
    const key = e.uid || `${e.title}|${e.start}`;
    if (out[key] && out[key].start <= e.start) continue; // keep the next occurrence of a series
    out[key] = { title: e.title, start: e.start, end: e.end, allDay: !!e.allDay, recurring: !!e.recurring, location: e.location || '', calendly: viaCalendly(e) };
  }
  return out;
}

function post(profile, source, kind, key, e, extra = {}) {
  const name = (connectors.get(source) || {}).name || 'Calendar';
  const title = { new: e.recurring ? `New recurring event: ${e.title}` : `New: ${e.title}`, moved: `Moved: ${e.title}`, cancelled: `Cancelled: ${e.title}` }[kind];
  feed.add({
    externalId: `cal:${kind}:${source}:${key}:${kind === 'cancelled' ? '' : e.start}`,
    ts: Date.now(), source, profile, category: 'MEETING', title,
    quote: kind === 'moved' ? `Now ${when(e.start, e.allDay)} (was ${when(extra.was, e.allDay)})` : `${when(e.start, e.allDay)}${extra.with ? ' · with ' + extra.with.join(', ') : ''}${e.location && !/^https?:/.test(e.location) ? ' · ' + e.location : ''}`,
    summary: e.calendly || source === 'calendly' ? 'Booked through Calendly' : kind === 'cancelled' ? `Removed from ${name}` : `${kind === 'new' ? 'Added to' : 'Updated in'} ${name}`,
    priority: kind !== 'cancelled' && soon(e.start) ? 'Medium' : '',
    deadline: kind === 'cancelled' ? '' : `Starts ${when(e.start, e.allDay)}`,
    actions: kind === 'cancelled' ? [] : ['Prep me for this'],
  });
}

// Compare a fresh snapshot with the stored one and post what changed. Returns the number of feed items.
function diff(state, stateKey, profile, source, fresh) {
  const prev = state[stateKey];
  state[stateKey] = { at: Date.now(), events: fresh };
  if (!prev) return 0; // first look: snapshot only
  let n = 0;
  for (const [key, e] of Object.entries(fresh)) {
    if (/@maestro$/.test(key)) continue; // created by Maestro: already in the feed
    const old = prev.events[key];
    if (!old) { post(profile, source, 'new', key, e); n++; } else if (!e.recurring && old.start !== e.start) { post(profile, source, 'moved', key, e, { was: old.start }); n++; }
  }
  for (const [key, e] of Object.entries(prev.events)) {
    if (!fresh[key] && new Date(e.end) > Date.now() && !e.recurring) { post(profile, source, 'cancelled', key, e); n++; }
  }
  return n;
}

let running = false;
async function check() {
  if (running) return 0;
  running = true;
  let posted = 0;
  try {
    const cfg = config.load();
    const state = load();
    for (const profile of Object.keys(cfg.connections)) {
      for (const [id, conn] of Object.entries(cfg.connections[profile] || {})) {
        if (conn.mode !== 'live' || !conn.fields) continue;
        try {
          if (ICS_SOURCES.includes(id)) {
            for (const url of connectors.calendarUrls(conn.fields)) {
              const events = await connectors.fetchIcs(url);
              posted += diff(state, `${profile}|${id}|${url}`, profile, id, snapshot(events));
            }
          } else if (id === 'calendly') {
            const me = await connectors.calendlyMe(conn.fields.token);
            const events = await connectors.calendlyEvents(conn.fields.token, me.uri);
            calendlyCache.set(profile, events);
            const key = `${profile}|calendly`;
            const fresh = snapshot(events);
            const prev = state[key];
            // look up who booked, only for new bookings
            if (prev) for (const k of Object.keys(fresh)) if (!prev.events[k]) fresh[k].with = await connectors.calendlyInvitees(conn.fields.token, k);
            state[key] = { at: Date.now(), events: fresh };
            if (prev) {
              for (const [k, e] of Object.entries(fresh)) if (!prev.events[k]) { post(profile, 'calendly', 'new', k, { ...e, calendly: true }, { with: e.with }); posted++; } else if (prev.events[k].start !== e.start) { post(profile, 'calendly', 'moved', k, e, { was: prev.events[k].start }); posted++; }
              for (const [k, e] of Object.entries(prev.events)) if (!fresh[k] && new Date(e.end) > Date.now()) { post(profile, 'calendly', 'cancelled', k, e); posted++; }
            }
          }
          if (id === 'calendly' && conn.lastError) config.update((c) => { const k = c.connections[profile][id]; if (k) delete k.lastError; });
        } catch (e) {
          if (id === 'calendly') config.update((c) => { const k = c.connections[profile][id]; if (k) k.lastError = e.message; });
        }
      }
    }
    save(state);
  } finally { running = false; }
  return posted;
}

function calendlyUpcoming(profile) { return calendlyCache.get(profile) || []; }

module.exports = { check, diff, snapshot, calendlyUpcoming };
