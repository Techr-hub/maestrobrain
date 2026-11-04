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
const eventtypes = require('./eventtypes');

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
const until = (e) => (e.allDay ? '' : ' – ' + new Date(e.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
const place = (e) => (e.location && !/^https?:/.test(e.location) ? ' · ' + e.location : '');
const viaCalendly = (e) => /calendly/i.test(`${e.description || ''} ${e.location || ''} ${e.organizer || ''}`);
const soon = (iso) => new Date(iso) - Date.now() < 24 * 3600000;

// One snapshot entry per series (recurring) or per single event.
function snapshot(events) {
  const now = Date.now(), out = {};
  for (const e of events) {
    if (new Date(e.end) < now || new Date(e.start) - now > HORIZON) continue;
    const key = e.uid || `${e.title}|${e.start}`;
    if (out[key] && out[key].start <= e.start) continue; // keep the next occurrence of a series
    out[key] = { title: e.title, start: e.start, end: e.end, allDay: !!e.allDay, recurring: !!e.recurring, location: e.location || '', description: String(e.description || '').slice(0, 600), calendarName: e.calendarName || '', calendly: viaCalendly(e) };
  }
  return out;
}

function post(profile, source, kind, key, e, extra = {}) {
  if (kind === 'cancelled') {
    // The event's cards turn grey instead of getting a separate "Cancelled" card. Only an event the feed never
    // showed (and that wasn't removed in Maestro) gets a card, so you still hear about it.
    const greyed = feed.markRemoved((i) => i.source === source && i.eventKey === key);
    const known = greyed || feed.readAll().some((i) => i.source === source && i.eventKey === key)
      || require('./removed').readAll().some((r) => r.source === source && (r.uid === key || r.key === key));
    if (known) return;
  }
  const name = (connectors.get(source) || {}).name || 'Calendar';
  const title = { new: e.recurring ? `New recurring event: ${e.title}` : `New: ${e.title}`, moved: `${extra.was === e.start ? 'Time changed' : 'Moved'}: ${e.title}`, cancelled: `Cancelled: ${e.title}` }[kind];
  feed.add({
    externalId: `cal:${kind}:${source}:${key}:${kind === 'cancelled' ? '' : e.start}${kind === 'moved' ? ':' + e.end : ''}`,
    ts: Date.now(), source, profile, category: 'MEETING', title, eventKey: key, eventStart: kind === 'cancelled' ? '' : e.start,
    quote: kind === 'moved' ? `Now ${when(e.start, e.allDay)}${until(e)} (was ${when(extra.was, e.allDay)}${extra.wasEnd ? until({ end: extra.wasEnd }) : ''})` : `${when(e.start, e.allDay)}${until(e)}${extra.with ? ' · with ' + extra.with.join(', ') : ''}${place(e)}`,
    calendarName: e.calendarName || '', eventType: eventtypes.typeFor(e, source),
    summary: e.calendly || source === 'calendly' ? 'Booked through Calendly' : kind === 'cancelled' ? `Removed from ${name}` : `${kind === 'new' ? 'Added to' : 'Updated in'} ${name}`,
    priority: kind !== 'cancelled' && soon(e.start) ? 'Medium' : '',
    deadline: kind === 'cancelled' ? '' : `Starts ${when(e.start, e.allDay)}`,
    actions: kind === 'cancelled' ? [] : ['Add Task'],
    description: feed.eventText(e),
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
    if (!old) { post(profile, source, 'new', key, e); n++; } else if (!e.recurring && (old.start !== e.start || (old.end && old.end !== e.end))) { post(profile, source, 'moved', key, e, { was: old.start, wasEnd: old.end }); n++; }
  }
  for (const [key, e] of Object.entries(prev.events)) {
    if (!fresh[key] && new Date(e.end) > Date.now() && !e.recurring) { post(profile, source, 'cancelled', key, e); n++; }
  }
  return n;
}

// Every event in the coming week gets its own feed card, so filtering the feed by a calendar shows that calendar.
// Cards are keyed by event + start time, so each one is posted once. Soonest events sort to the top.
const WEEK = 7 * 86400000;
function upcoming(profile, source, events, skip = new Set()) {
  const now = Date.now();
  const list = events.filter((e) => new Date(e.end) >= now && new Date(e.start) - now <= WEEK && !/@maestro$/.test(e.uid || '') && !skip.has(e.uid))
    .sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, 30);
  let n = 0;
  list.forEach((e) => {
    const start = new Date(e.start);
    const startsIn = start - now;
    const item = feed.add({
      externalId: `cal:up:${source}:${e.uid || e.title}:${start.toISOString()}`,
      ts: now - 1000 - Math.max(0, startsIn) / 10000, // just under brand-new notifications; sooner events sort higher, across all calendars
      source, profile, category: 'MEETING', eventKey: e.uid || e.title, eventStart: start.toISOString(),
      title: e.title,
      quote: `${when(e.start, e.allDay)}${e.allDay ? '' : ' – ' + new Date(e.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${e.location && !/^https?:/.test(e.location) ? ' · ' + e.location : ''}`,
      summary: viaCalendly(e) ? 'Booked through Calendly' : `Coming up${e.calendarName ? ` on your "${e.calendarName}" calendar` : ''}${e.recurring ? ' · repeats' : ''}`,
      calendarName: e.calendarName || '', eventType: eventtypes.typeFor(e, source),
      description: e.description === 'calendly' ? '' : feed.eventText(e), // 'calendly' only marks Calendly bookings
      priority: startsIn > 0 && startsIn < 2 * 3600000 ? 'Medium' : '',
      deadline: e.allDay ? '' : `Starts ${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
      unread: false,
      actions: ['Add Task'],
    });
    if (item) n++;
  });
  return n;
}

// Refresh every card already in the feed for these events, so a changed time, title, place, description or calendar
// shows straight away instead of the card keeping what the calendar said when it was first posted (Ryan, 2026-11-04).
// A one-off event's agenda card follows the event to its new time; a repeating event's cards match by occurrence.
function syncCards(source, events) {
  const byKey = new Map();
  for (const e of events) { const k = e.uid || e.title; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(e); }
  return feed.updateCards((i) => i.source === source && i.eventKey && byKey.has(i.eventKey) && !/^Cancelled: /.test(i.title || ''), (i) => {
    const list = byKey.get(i.eventKey);
    const e = list.length === 1 && !list[0].recurring ? list[0] : list.find((x) => new Date(x.start).toISOString() === new Date(i.eventStart || 0).toISOString());
    if (!e) return null;
    const start = new Date(e.start);
    const x = String(i.externalId || '');
    const f = { eventType: eventtypes.typeFor(e, source), calendarName: e.calendarName || i.calendarName || '', description: e.description === 'calendly' ? undefined : feed.eventText(e) || i.description };
    if (x.startsWith('cal:up:')) {
      Object.assign(f, {
        title: e.title, eventStart: start.toISOString(), ts: Date.now() - 1000 - Math.max(0, start - Date.now()) / 10000,
        externalId: `cal:up:${source}:${e.uid || e.title}:${start.toISOString()}`,
        quote: `${when(e.start, e.allDay)}${until(e)}${place(e)}`,
        deadline: e.allDay ? '' : `Starts ${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
      });
      if (!viaCalendly(e)) f.summary = `Coming up${e.calendarName ? ` on your "${e.calendarName}" calendar` : ''}${e.recurring ? ' · repeats' : ''}`;
    } else if (x.startsWith('cal:new:')) {
      Object.assign(f, { title: `${/^New recurring/.test(i.title) ? 'New recurring event' : 'New'}: ${e.title}`, eventStart: start.toISOString(), quote: `${when(e.start, e.allDay)}${until(e)}${place(e)}`, deadline: `Starts ${when(e.start, e.allDay)}` });
    }
    return f;
  });
}

// One check at a time. A refresh that lands while the minute check is still running waits for it and then reads the
// calendars again, so the refresh button always gets the latest (it used to return straight away with nothing).
let running = null;
async function check() {
  if (running) { await running.catch(() => {}); if (running) return running; }
  running = run().finally(() => { running = null; });
  return running;
}
async function run() {
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
              syncCards(id, events);
              const key = `${profile}|${id}|${url}`;
              const before = state[key] ? new Set(Object.keys(state[key].events)) : null;
              posted += diff(state, key, profile, id, snapshot(events));
              // brand-new events already got a "New:" card; everything else in the coming week gets an agenda card
              const fresh = before ? new Set(Object.keys(state[key].events).filter((k) => !before.has(k))) : new Set();
              posted += upcoming(profile, id, events, fresh);
            }
          } else if (id === 'calendly') {
            const me = await connectors.calendlyMe(conn.fields.token);
            const events = await connectors.calendlyEvents(conn.fields.token, me.uri);
            calendlyCache.set(profile, events);
            syncCards('calendly', events.map((e) => ({ ...e, description: 'calendly' })));
            const skipNew = state[`${profile}|calendly`] ? new Set(events.map((e) => e.uid).filter((u) => !state[`${profile}|calendly`].events[u])) : new Set();
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
            posted += upcoming(profile, 'calendly', events.map((e) => ({ ...e, description: 'calendly' })), skipNew);
          }
          if (id === 'calendly' && conn.lastError) config.update((c) => { const k = c.connections[profile][id]; if (k) delete k.lastError; });
        } catch (e) {
          if (id === 'calendly') config.update((c) => { const k = c.connections[profile][id]; if (k) k.lastError = e.message; });
        }
      }
    }
    save(state);
  } catch (e) { /* one bad calendar read must not stop the watcher */ }
  return posted;
}

function calendlyUpcoming(profile) { return calendlyCache.get(profile) || []; }
function forgetCalendly(profile, uri) { const list = calendlyCache.get(profile); if (list) calendlyCache.set(profile, list.filter((e) => e.uid !== uri)); }

module.exports = { check, diff, snapshot, upcoming, syncCards, calendlyUpcoming, forgetCalendly };
