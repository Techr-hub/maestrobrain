// Calendar knowledge source: demo events, plus real events from any ICS link
// (iCloud, Google Calendar secret address, Outlook published calendar).
const config = require('./config');
const demo = require('./demo');
const connectors = require('./connectors');
const created = require('./events');

const CAL_SOURCES = ['gcal', 'icalendar', 'outlook', 'gmail'];
const icsCache = new Map(); // url -> { at, events, error }

async function liveEvents(url) {
  const hit = icsCache.get(url);
  if (hit && Date.now() - hit.at < 10 * 60000) return hit.events;
  try {
    const events = await connectors.fetchIcs(url);
    icsCache.set(url, { at: Date.now(), events });
    return events;
  } catch (e) {
    icsCache.set(url, { at: Date.now(), events: [], error: e.message });
    return [];
  }
}

async function list({ profile, days = 7 } = {}) {
  const cfg = config.load();
  const prof = profile || cfg.profile;
  const conns = cfg.connections[prof] || {};
  const now = new Date();
  const from = new Date(now); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + days * 86400000);
  let events = [];
  const demoSources = CAL_SOURCES.filter((s) => conns[s] && conns[s].mode === 'demo');
  events.push(...demo.calendarEvents(prof, now).filter((e) => demoSources.includes(e.source)));
  for (const s of CAL_SOURCES) {
    const c = conns[s];
    const urls = c && c.mode === 'live' ? connectors.calendarUrls(c.fields) : [];
    if (urls.length) {
      for (const u of urls) {
        const ev = await liveEvents(u);
        events.push(...ev.map((e) => ({ ...e, source: s, live: true, calendar: u })));
      }
      // remember failures so the brain map and feed can show them
      const err = errorForConn(c) || undefined;
      if (err !== c.lastError) config.update((x) => { const k = x.connections[prof][s]; if (k) { if (err) k.lastError = err; else delete k.lastError; } });
    }
  }
  // Calendly bookings (fetched by the calendar watcher)
  if (conns.calendly && conns.calendly.mode === 'live') {
    const seen = new Set(events.map((e) => `${e.title}|${e.start}`));
    for (const e of require('./calwatch').calendlyUpcoming(prof)) if (!seen.has(`${e.title}|${new Date(e.start).toISOString()}`)) events.push({ ...e, start: new Date(e.start).toISOString(), end: new Date(e.end).toISOString(), source: 'calendly', live: true });
  }
  // events Maestro created (skip ones already coming back through a live calendar link)
  const liveUids = new Set(events.filter((e) => e.uid).map((e) => e.uid));
  for (const e of created.list({ profile: prof })) if (!liveUids.has(e.uid)) events.push({ ...e, source: 'maestro', created: true });
  events = events.filter((e) => new Date(e.end) >= from && new Date(e.start) <= to);
  events.sort((a, b) => new Date(a.start) - new Date(b.start));
  return events;
}

function errorFor(url) { const hit = icsCache.get(url); return hit && hit.error ? hit.error : null; }

// First failing link of a connection, labelled when there are several.
function errorForConn(conn) {
  const urls = conn ? connectors.calendarUrls(conn.fields) : [];
  for (const [i, u] of urls.entries()) { const e = errorFor(u); if (e) return (urls.length > 1 ? `Calendar ${i + 1}: ` : '') + e; }
  return null;
}

// Forget cached results so a newly saved link is fetched straight away.
function forget(urls = []) { for (const u of urls) icsCache.delete(u); }

module.exports = { list, errorFor, errorForConn, forget, CAL_SOURCES };
