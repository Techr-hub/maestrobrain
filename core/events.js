// Creating calendar events.
//
// Every new event is saved to Maestro's own calendar (data/events.json): it shows on the Calendar page, the brain
// map and in answers straight away, and apps on this computer can subscribe to it at /calendar.ics.
// When a calendar connector also has CalDAV sign-in details (iCloud with an app-specific password, Fastmail,
// Nextcloud…), the event is written into that real calendar too.
// Google Calendar and Outlook only allow writing through OAuth, so those go through Claude Desktop's connectors.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const FILE = path.join(config.DATA_DIR, 'events.json');

function readAll() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } }
function writeAll(list) { fs.mkdirSync(config.DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(list, null, 1)); }

function list({ profile } = {}) {
  const prof = profile || config.load().profile;
  return readAll().filter((e) => e.profile === prof);
}

// ---------------------------------------------------------------- ICS
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function fold(line) { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); } out.push(s); return out.join('\r\n'); }

function veventLines(e) {
  return ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp(e.created || Date.now())}`, `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`,
    `SUMMARY:${esc(e.title)}`, e.location ? `LOCATION:${esc(e.location)}` : '',
    `DESCRIPTION:${esc([e.attendees && e.attendees.length ? 'With ' + e.attendees.join(', ') : '', e.notes || '', 'Created by Maestro'].filter(Boolean).join('\n'))}`,
    'END:VEVENT'].filter(Boolean).map(fold);
}
function toIcs(events, name = 'Maestro') {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Maestro//Second Brain//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(name)}`,
    ...events.flatMap(veventLines), 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- CalDAV
const CALDAV_DEFAULT = { icalendar: 'https://caldav.icloud.com/' };
const CAL_CONNECTORS = { icalendar: 'iCloud', gcal: 'Google Calendar', outlook: 'Outlook' };
// How each calendar is named when Maestro asks "which calendar?"
const CAL_LABEL = { icalendar: 'Mac / iCloud Calendar', gcal: 'Google Calendar', outlook: 'Outlook Calendar' };

function caldavCreds(id, conn) {
  const f = (conn && conn.fields) || {};
  if (!f.caldavUser || !f.caldavPassword) return null;
  const url = (f.caldavUrl || CALDAV_DEFAULT[id] || '').trim();
  if (!url) return null;
  return { url, auth: 'Basic ' + Buffer.from(`${f.caldavUser}:${f.caldavPassword}`).toString('base64') };
}

async function dav(url, auth, method, body, depth) {
  const res = await fetch(url, { method, headers: { Authorization: auth, 'Content-Type': 'application/xml; charset=utf-8', ...(depth != null ? { Depth: String(depth) } : {}) }, body, redirect: 'follow' });
  if (res.status === 401 || res.status === 403) throw new Error('The calendar rejected the sign-in. For iCloud use your Apple ID email and an app-specific password (appleid.apple.com → Sign-In and Security → App-Specific Passwords).');
  if (!res.ok && res.status !== 207) throw new Error(`Calendar server returned HTTP ${res.status}`);
  return { text: await res.text(), url: res.url || url };
}

// Pull every <response> out of a multistatus reply, whatever namespace prefixes the server uses.
function responses(xml) {
  return [...xml.matchAll(/<(?:\w+:)?response\b[\s\S]*?<\/(?:\w+:)?response>/gi)].map((m) => m[0]);
}
const tag = (xml, name) => { const m = xml.match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i')); return m ? m[1] : ''; };
const hrefIn = (xml, name) => { const inner = tag(xml, name); const m = inner.match(/<(?:\w+:)?href[^>]*>([^<]+)</i); return m ? m[1].trim() : ''; };

const discoverCache = new Map(); // url+user -> { at, calendars }

async function discover(creds) {
  const key = creds.url + creds.auth;
  const hit = discoverCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60000) return hit.calendars;
  const P = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">';
  // 1. who am I
  let r = await dav(creds.url, creds.auth, 'PROPFIND', `${P}<d:prop><d:current-user-principal/></d:prop></d:propfind>`, 0);
  let principal = hrefIn(r.text, 'current-user-principal');
  if (!principal) throw new Error('This server did not answer like a CalDAV calendar. Check the server address.');
  principal = new URL(principal, r.url).href;
  // 2. where my calendars live
  r = await dav(principal, creds.auth, 'PROPFIND', `${P}<d:prop><c:calendar-home-set/></d:prop></d:propfind>`, 0);
  const home = new URL(hrefIn(r.text, 'calendar-home-set') || principal, r.url).href;
  // 3. list calendars that hold events
  r = await dav(home, creds.auth, 'PROPFIND', `${P}<d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop></d:propfind>`, 1);
  const calendars = [];
  for (const resp of responses(r.text)) {
    const type = tag(resp, 'resourcetype');
    if (!/<(?:\w+:)?calendar\b/i.test(type)) continue;
    const comps = tag(resp, 'supported-calendar-component-set');
    if (comps && !/VEVENT/i.test(comps)) continue; // reminders-only lists
    const priv = tag(resp, 'current-user-privilege-set');
    if (priv && !/<(?:\w+:)?(write|write-content|all)\b/i.test(priv)) continue; // read-only (subscribed, holidays)
    const href = (resp.match(/<(?:\w+:)?href[^>]*>([^<]+)</i) || [])[1];
    if (!href) continue;
    const name = tag(resp, 'displayname').replace(/<!\[CDATA\[|\]\]>/g, '').trim() || 'Calendar';
    calendars.push({ href: new URL(href.trim(), r.url).href, name });
  }
  if (!calendars.length) throw new Error('Signed in, but found no calendars that accept new events.');
  discoverCache.set(key, { at: Date.now(), calendars });
  return calendars;
}

async function caldavPut(creds, calHref, ev) {
  const url = calHref.replace(/\/?$/, '/') + encodeURIComponent(ev.uid) + '.ics';
  const res = await fetch(url, { method: 'PUT', headers: { Authorization: creds.auth, 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' }, body: toIcs([ev]) });
  if (res.status === 401 || res.status === 403) throw new Error('The calendar rejected the sign-in.');
  if (!res.ok) throw new Error(`Calendar server returned HTTP ${res.status}`);
  return url;
}

// ---------------------------------------------------------------- targets + create
// Where can a new event go? Every calendar you connected, then Maestro's own calendar.
// - iCloud / CalDAV with sign-in details: each writable calendar, written directly.
// - Any other connected calendar (Google, Outlook, iCal links without sign-in): the event is filed under that
//   calendar in Maestro right away, and Claude Desktop copies it in with its calendar connector
//   ("Sync my calendar changes into my calendars" prompt). These show as "via Claude Desktop".
async function targets(profile) {
  const cfg = config.load();
  const prof = profile || cfg.profile;
  const conns = cfg.connections[prof] || {};
  const out = [];
  const notes = [];
  for (const id of Object.keys(CAL_CONNECTORS)) {
    const c = conns[id];
    if (!c) continue;
    const creds = c.mode === 'live' ? caldavCreds(id, c) : null;
    let direct = false;
    if (creds) {
      try {
        for (const cal of await discover(creds)) out.push({ id: `caldav:${id}:${cal.href}`, name: cal.name, via: CAL_CONNECTORS[id], connector: id, href: cal.href });
        direct = true;
      } catch (e) { notes.push(`${CAL_CONNECTORS[id]}: ${e.message}`); }
    }
    if (!direct) out.push({ id: `pending:${id}`, name: CAL_LABEL[id], via: c.mode === 'demo' ? 'demo' : 'via Claude Desktop', connector: id, pending: true });
  }
  out.push({ id: 'maestro', name: 'Maestro', via: 'Maestro calendar' });
  return { targets: out, notes };
}

async function create(input, { profile, target = 'maestro' } = {}) {
  const prof = profile || config.load().profile;
  const ev = {
    uid: `${crypto.randomUUID()}@maestro`,
    title: String(input.title || 'Meeting').slice(0, 200),
    start: new Date(input.start).toISOString(),
    end: new Date(input.end || new Date(new Date(input.start).getTime() + (input.minutes || 30) * 60000)).toISOString(),
    attendees: input.attendees || [],
    location: input.location || '',
    notes: input.notes || '',
    profile: prof,
    created: Date.now(),
    target: 'maestro',
  };
  if (isNaN(new Date(ev.start))) throw new Error('That start time is not a valid date.');
  let where = 'your Maestro calendar', warning = '';
  if (target && target.startsWith('pending:')) {
    const id = target.slice(8);
    ev.target = target; ev.calendarFor = id; ev.synced = false;
    const conn = (config.load().connections[prof] || {})[id] || {};
    where = `your ${CAL_LABEL[id] || id}`;
    if (conn.mode !== 'demo') warning = `It's on your ${CAL_LABEL[id]} in Maestro now. To copy it into ${CAL_CONNECTORS[id]} itself, run "Sync my calendar changes into my calendars" in Claude Desktop (+ → Maestro).${id === 'icalendar' ? ' Or add your Apple ID and an app-specific password to the iCalendar card, and Maestro will write it there directly.' : ''}`;
  } else if (target && target.startsWith('caldav:')) {
    const [, id, ...rest] = target.split(':');
    const href = rest.join(':');
    const cfg = config.load();
    const creds = caldavCreds(id, (cfg.connections[prof] || {})[id]);
    try {
      if (!creds) throw new Error('sign-in details are missing');
      await caldavPut(creds, href, ev);
      ev.target = target; ev.href = href;
      const cal = ((discoverCache.get(creds.url + creds.auth) || {}).calendars || []).find((c) => c.href === href);
      where = `your ${cal ? `"${cal.name}" ` : ''}${CAL_CONNECTORS[id]} calendar`;
    } catch (e) {
      warning = `I couldn't write it to ${CAL_CONNECTORS[id]} (${e.message}), so it's in your Maestro calendar for now.`;
    }
  }
  const all = readAll(); all.push(ev); writeAll(all);
  return { event: ev, where, warning };
}

function removeCreated(uid) { const all = readAll(); const i = all.findIndex((e) => e.uid === uid); if (i < 0) return null; const [e] = all.splice(i, 1); writeAll(all); return e; }

async function caldavDelete(creds, url, etag) {
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: creds.auth, ...(etag ? { 'If-Match': etag } : {}) } });
  if (res.status === 401 || res.status === 403) throw new Error('The calendar rejected the sign-in.');
  if (!res.ok && res.status !== 404) throw new Error(`Calendar server returned HTTP ${res.status}`);
}

// Find an event by UID in any of the user's CalDAV calendars. Returns { url, etag, ics, calendar } or null.
async function caldavFind(creds, uid) {
  const q = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:prop-filter name="UID"><c:text-match collation="i;octet">${uid.replace(/[<&]/g, '')}</c:text-match></c:prop-filter></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  for (const cal of await discover(creds)) {
    let r;
    try { r = await dav(cal.href, creds.auth, 'REPORT', q, 1); } catch { continue; }
    for (const resp of responses(r.text)) {
      const href = (resp.match(/<(?:\w+:)?href[^>]*>([^<]+)</i) || [])[1];
      const ics = tag(resp, 'calendar-data').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&#13;/g, '\r').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      if (href && ics.includes(uid)) return { url: new URL(href.trim(), r.url).href, etag: tag(resp, 'getetag').replace(/&quot;/g, '"').trim(), ics, calendar: cal.name };
    }
  }
  return null;
}

// One occurrence of a repeating event: add an EXDATE to the series instead of deleting it.
function withExdate(ics, startIso) {
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  const blocks = unfolded.split(/(?=BEGIN:VEVENT)/);
  const i = blocks.findIndex((b) => b.startsWith('BEGIN:VEVENT') && !/^RECURRENCE-ID/m.test(b.split('END:VEVENT')[0]));
  if (i < 0) throw new Error('Could not find the repeating event');
  const dt = blocks[i].match(/^DTSTART(;[^:\r\n]*)?:(\S+)/m);
  if (!dt) throw new Error('The repeating event has no start time');
  const params = dt[1] || '';
  const d = new Date(startIso);
  let val;
  if (/VALUE=DATE(?!-)/.test(params)) val = d.toISOString().slice(0, 10).replace(/-/g, '');
  else if (/TZID=/.test(params)) {
    const tz = params.match(/TZID=("?)([^;:"]+)\1/)[2];
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
    val = `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
  } else val = d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  blocks[i] = blocks[i].replace(/^(DTSTART[^\r\n]*\r?\n)/m, `$1EXDATE${params.replace(/;?VALUE=DATE-TIME/, '')}:${val}\r\n`);
  return blocks.join('');
}

async function caldavPutIf(creds, url, ics, etag) {
  const res = await fetch(url, { method: 'PUT', headers: { Authorization: creds.auth, 'Content-Type': 'text/calendar; charset=utf-8', ...(etag ? { 'If-Match': etag } : {}) }, body: ics });
  if (res.status === 412) throw new Error('The event changed on the server. Try again in a minute.');
  if (!res.ok) throw new Error(`Calendar server returned HTTP ${res.status}`);
}

// Events Claude Desktop still needs to copy into Google / Outlook / iCloud, and marking them done.
function pendingSync() { return readAll().filter((e) => e.calendarFor && !e.synced); }
function markSynced(uid) { const all = readAll(); const e = all.find((x) => x.uid === uid); if (!e) return false; e.synced = true; e.syncedAt = Date.now(); writeAll(all); return true; }

module.exports = { readAll, writeAll, list, create, targets, toIcs, discover, caldavCreds, caldavFind, caldavDelete, caldavPutIf, withExdate, removeCreated, pendingSync, markSynced, CAL_CONNECTORS, CAL_LABEL };
