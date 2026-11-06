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
const HORIZON = 184 * 86400000; // watch the next 6 months (Ryan, 2026-11-04)
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
    eventTitle: e.title, eventEnd: kind === 'cancelled' ? '' : new Date(e.end).toISOString(), eventLocation: e.location || '',
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
    if (!old) { post(profile, source, 'new', key, e); n++; } // a changed event isn't a new notification: syncCards relabels its card "Updated: …" (Ryan, 2026-11-04)
  }
  for (const [key, e] of Object.entries(prev.events)) {
    if (!fresh[key] && new Date(e.end) > Date.now() && !e.recurring) { post(profile, source, 'cancelled', key, e); n++; }
  }
  return n;
}

// Every event in the coming week gets its own feed card, so filtering the feed by a calendar shows that calendar.
// Cards are keyed by event + start time, so each one is posted once. Soonest events sort to the top.
// Ryan (2026-11-04): every event in the next 6 months gets a card (was one week).
const WEEK = 184 * 86400000;
function upcoming(profile, source, events, skip = new Set()) {
  const now = Date.now();
  const list = events.filter((e) => new Date(e.end) >= now && new Date(e.start) - now <= WEEK && !/@maestro$/.test(e.uid || '') && !skip.has(e.uid))
    .sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, 200);
  let n = 0;
  list.forEach((e) => {
    const start = new Date(e.start);
    const startsIn = start - now;
    const item = feed.add({
      externalId: `cal:up:${source}:${e.uid || e.title}:${start.toISOString()}`,
      ts: now - 1000 - Math.max(0, startsIn) / 100, // just under brand-new notifications; sooner events sort higher, across all calendars
      source, profile, category: 'MEETING', eventKey: e.uid || e.title, eventStart: start.toISOString(),
      title: e.title,
      quote: `${when(e.start, e.allDay)}${e.allDay ? '' : ' – ' + new Date(e.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${e.location && !/^https?:/.test(e.location) ? ' · ' + e.location : ''}`,
      summary: viaCalendly(e) ? 'Booked through Calendly' : '', // no "Coming up on your … calendar" line (Ryan, 2026-11-04)
      calendarName: e.calendarName || '', eventType: eventtypes.typeFor(e, source),
      eventTitle: e.title, eventEnd: new Date(e.end).toISOString(), eventLocation: e.location || '',
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
    if (!x.startsWith('cal:up:') && !x.startsWith('cal:new:')) return f;
    // Ryan (2026-11-04): a changed event gets no new notification; its card is relabelled "Updated: <event>".
    // Fields only count as changed when the card recorded them, so older cards aren't all flagged on the first read.
    const base = String(i.eventTitle || i.title || '').replace(/^(New( recurring event)?|Updated|Moved|Time changed): /, '');
    const changed = (i.eventStart && new Date(i.eventStart).toISOString() !== start.toISOString())
      || (i.eventEnd && i.eventEnd !== new Date(e.end).toISOString())
      || base !== e.title
      || (i.eventLocation != null && i.eventLocation !== (e.location || ''))
      || (i.description != null && e.description !== 'calendly' && i.description !== feed.eventText(e));
    const updated = i.updated || changed;
    Object.assign(f, {
      title: updated ? `Updated: ${e.title}` : x.startsWith('cal:new:') ? `${/^New recurring/.test(i.title) ? 'New recurring event' : 'New'}: ${e.title}` : e.title,
      eventTitle: e.title, eventStart: start.toISOString(), eventEnd: new Date(e.end).toISOString(), eventLocation: e.location || '',
      quote: `${when(e.start, e.allDay)}${until(e)}${place(e)}`,
    });
    if (changed) Object.assign(f, { updated: true, updatedAt: Date.now(), unread: true });
    if (x.startsWith('cal:up:')) {
      Object.assign(f, {
        ts: Date.now() - 1000 - Math.max(0, start - Date.now()) / 100,
        externalId: `cal:up:${source}:${e.uid || e.title}:${start.toISOString()}`,
        deadline: e.allDay ? '' : `Starts ${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
      });
      if (!viaCalendly(e)) f.summary = '';
    } else {
      f.deadline = `Starts ${when(e.start, e.allDay)}`;
    }
    return f;
  });
}

// One check at a time. A refresh that lands while the minute check is still running waits for it and then reads the
// calendars again, so the refresh button always gets the latest (it used to return straight away with nothing).
// The alerts set on calendar events (Ryan, 2026-11-04): each one posts a feed notification at the same moment the
// calendar would alert you ("In 15 minutes: …"). One card per alert per occurrence; an alert is only posted within
// 30 minutes of its time and before the event ends, so an alert missed while Maestro was closed isn't posted late.
const LATE = 30 * 60000;
const inWords = (ms) => {
  const m = Math.round(ms / 60000);
  if (m <= 0) return 'Now';
  if (m < 60) return `In ${m} minute${m === 1 ? '' : 's'}`;
  const h = m / 60;
  if (h < 24) return `In ${Number.isInteger(h) ? h : h.toFixed(1)} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return d === 1 ? 'Tomorrow' : `In ${d} days`;
};
function alertTime(e, a) {
  if (a.at) return Date.parse(a.at);
  if (a.beforeEnd != null) return Date.parse(e.end) - a.beforeEnd;
  return Date.parse(e.start) - (a.before || 0);
}
function alerts(profile, source, events, now = Date.now()) {
  let n = 0;
  for (const e of events) {
    if (!e.alarms || !e.alarms.length || /@maestro$/.test(e.uid || '')) continue;
    const start = Date.parse(e.start), end = Date.parse(e.end);
    if (now > end) continue;
    // the latest alert that is due (if two are due at once, only the nearer one is posted)
    const due = e.alarms.map((a) => ({ a, t: alertTime(e, a) })).filter((x) => x.t <= now && now - x.t < LATE).sort((x, y) => y.t - x.t)[0];
    if (!due) continue;
    const key = e.uid || e.title;
    const tag = due.a.at ? 'at' + due.a.at : due.a.beforeEnd != null ? 'end' + due.a.beforeEnd : String(due.a.before || 0);
    const lead = start - now;
    const item = feed.add({
      externalId: `cal:alert:${source}:${key}:${new Date(start).toISOString()}:${tag}`,
      ts: now, source, profile, category: 'MEETING', alert: true,
      title: `${lead > 60000 ? inWords(lead) : start > now - 60000 ? 'Starting now' : 'Happening now'}: ${e.title}`,
      eventKey: key, eventStart: new Date(start).toISOString(), eventType: eventtypes.typeFor(e, source), calendarName: e.calendarName || '',
      quote: `${when(e.start, e.allDay)}${until(e)}${place(e)}`,
      summary: `Calendar alert${e.calendarName ? ` from your "${e.calendarName}" calendar` : ''}`,
      description: feed.eventText(e),
      priority: lead <= 15 * 60000 ? 'High' : lead <= 2 * 3600000 ? 'Medium' : '',
      deadline: e.allDay ? '' : `Starts ${new Date(start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
      actions: ['Add Task'],
    });
    if (item) n++;
  }
  return n;
}

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
          if ((id === 'gcal' || id === 'outlook') && conn.oauth && conn.oauth.refresh) {
            // signed in for two-way sync (Ryan, 2026-11-06): the same checks on what the API returns
            const events = await require('./cloudcal').events(profile, id);
            syncCards(id, events);
            const key = `${profile}|${id}|cloud`;
            const before = state[key] ? new Set(Object.keys(state[key].events)) : null;
            posted += diff(state, key, profile, id, snapshot(events));
            const fresh = before ? new Set(Object.keys(state[key].events).filter((k) => !before.has(k))) : new Set();
            posted += upcoming(profile, id, events, fresh);
            posted += alerts(profile, id, events);
          } else if (ICS_SOURCES.includes(id)) {
            for (const url of connectors.calendarUrls(conn.fields)) {
              const events = await connectors.fetchIcs(url);
              syncCards(id, events);
              const key = `${profile}|${id}|${url}`;
              const before = state[key] ? new Set(Object.keys(state[key].events)) : null;
              posted += diff(state, key, profile, id, snapshot(events));
              // brand-new events already got a "New:" card; everything else in the coming week gets an agenda card
              const fresh = before ? new Set(Object.keys(state[key].events).filter((k) => !before.has(k))) : new Set();
              posted += upcoming(profile, id, events, fresh);
              posted += alerts(profile, id, events);
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
              for (const [k, e] of Object.entries(fresh)) if (!prev.events[k]) { post(profile, 'calendly', 'new', k, { ...e, calendly: true }, { with: e.with }); posted++; }
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

module.exports = { alerts, check, diff, snapshot, upcoming, syncCards, calendlyUpcoming, forgetCalendly };
