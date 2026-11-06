// Editing and deleting a calendar event from its feed card (Ryan, 2026-11-06): the ⋮ menu on event cards.
//
// Where an edit goes:
// - Events Maestro created: changed in Maestro, and rewritten in iCloud/CalDAV when Maestro put it there.
// - iCloud / CalDAV calendars with sign-in details on the card: changed on the server (single events; one occurrence
//   of a repeating event is changed in Maestro).
// - Everything else (Google, Outlook, read-only iCal links, demo data): changed in Maestro, kept across refreshes.
//   The real calendar still has the old details until you change it there.
// Deleting uses the same path as "Hey Maestro, cancel my meeting…" (core/remove.js).
const fs = require('fs');
const path = require('path');
const config = require('./config');
const calendar = require('./calendar');
const events = require('./events');

const FILE = path.join(config.DATA_DIR, 'event-edits.json');
const FIELDS = ['title', 'start', 'end', 'location', 'description'];
function readAll() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } }
function writeAll(list) { fs.mkdirSync(config.DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(list, null, 1)); }

const sameTime = (a, b) => a && b && Math.abs(new Date(a) - new Date(b)) < 60000;
const keyOf = (e) => e.uid || e.title;

// Your edits laid over what the calendars say (called by calendar.list).
function apply(list, edits = readAll()) {
  if (!edits.length) return list;
  return list.map((e) => {
    const ed = edits.find((x) => x.source === e.source && x.key === keyOf(e) && (!x.start || sameTime(x.start, e.start)));
    return ed ? { ...e, ...ed.fields, edited: true, originalStart: e.start } : e;
  });
}

// The event a feed card is about: by its key and start time, or its title when the card has no key.
async function find({ source, key, start, title }, profile) {
  const from = new Date(Date.now() - 30 * 86400000);
  const list = await calendar.list({ profile, from: from.toISOString(), to: new Date(Date.now() + 184 * 86400000).toISOString() });
  const mine = list.filter((e) => !source || e.source === source || (source === 'system' && e.created));
  let hits = key ? mine.filter((e) => keyOf(e) === key || e.uid === key) : [];
  if (!hits.length && title) {
    const t = String(title).replace(/^(New( recurring event)?|Updated|Moved|Time changed|Reminder|In [^:]+|Starting now|Happening now): /, '').replace(/ (moved to|starts in|at) .*$/i, '').trim().toLowerCase();
    hits = mine.filter((e) => e.title.toLowerCase() === t);
    if (!hits.length && t.length > 3) hits = mine.filter((e) => e.title.toLowerCase().includes(t) || t.includes(e.title.toLowerCase()));
  }
  if (!hits.length) return null;
  return hits.find((e) => sameTime(e.start, start) || sameTime(e.originalStart, start)) || hits.find((e) => new Date(e.end) > Date.now()) || hits[0];
}

// What the edit form and the menu need to know about where the change lands.
function whereText(e, conn) {
  if (e.created) return e.target && e.target.startsWith('caldav:') ? 'Saved in Maestro and in your iCloud calendar.' : 'Saved in your Maestro calendar.';
  if (conn && conn.mode === 'demo') return 'Demo event: changed in Maestro.';
  if (e.live && events.caldavCreds(e.source, conn) && !e.recurring) return 'Saved in Maestro and in your calendar.';
  return `Changed in Maestro. ${e.recurring ? 'This is one date of a repeating event; ' : ''}Your ${events.CAL_LABEL[e.source] || 'calendar'} keeps the old details until you change it there too.`;
}

function setIcsField(ics, name, value) {
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const block = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/);
  if (!block) throw new Error('The calendar returned an event Maestro could not read.');
  let b = block[0];
  const re = new RegExp(`^${name}(;[^:\\r\\n]*)?:.*$`, 'm');
  const line = name === 'DTSTART' || name === 'DTEND' ? `${name}:${new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}` : `${name}:${esc(value)}`;
  if (re.test(b)) b = value === '' && !/^DT/.test(name) ? b.replace(new RegExp(`^${name}(;[^:\\r\\n]*)?:.*\\r?\\n`, 'm'), '') : b.replace(re, line);
  else if (value !== '') b = b.replace(/END:VEVENT$/, `${line}\r\nEND:VEVENT`);
  return unfolded.replace(block[0], b);
}

async function update(ref, input, { profile } = {}) {
  const cfg = config.load();
  const prof = profile || cfg.profile;
  const e = await find(ref, prof);
  if (!e) throw Object.assign(new Error("I couldn't find that event in your calendars any more."), { status: 404 });
  const next = {
    title: String(input.title || '').trim().slice(0, 200) || e.title,
    start: new Date(input.start || e.start).toISOString(),
    end: new Date(input.end || e.end).toISOString(),
    location: String(input.location == null ? e.location || '' : input.location).trim(),
    description: String(input.description == null ? e.description || (/^[\w -]+\/[\w .'&-]+$/.test(e.notes || '') ? '' : e.notes || '') : input.description).trim(),
  };
  if (isNaN(new Date(next.start)) || isNaN(new Date(next.end))) throw Object.assign(new Error('That date or time is not valid.'), { status: 400 });
  if (new Date(next.end) <= new Date(next.start)) throw Object.assign(new Error('The event has to end after it starts.'), { status: 400 });
  const conn = (cfg.connections[prof] || {})[e.source] || {};
  let note = '';

  if (e.created) {
    const all = events.readAll ? events.readAll() : [];
    const rec = all.find((x) => x.uid === e.uid);
    if (rec) {
      Object.assign(rec, { title: next.title, start: next.start, end: next.end, location: next.location, notes: next.description });
      events.writeAll(all);
      if (rec.target && rec.target.startsWith('caldav:') && rec.href) {
        const id = rec.target.split(':')[1];
        const creds = events.caldavCreds(id, (cfg.connections[prof] || {})[id]);
        if (creds) { try { await events.caldavPutIf(creds, rec.href.replace(/\/?$/, '/') + encodeURIComponent(rec.uid) + '.ics', events.toIcs([rec])); } catch (err) { note = `Saved in Maestro, but iCloud said: ${err.message}`; } }
      } else if (rec.calendarFor && rec.synced) note = `Saved in Maestro. Change it in ${events.CAL_LABEL[rec.calendarFor]} too, since it was already copied there.`;
    }
  } else {
    const creds = e.live && !e.recurring ? events.caldavCreds(e.source, conn) : null;
    let direct = false;
    if (creds && e.uid) {
      try {
        const found = await events.caldavFind(creds, e.uid);
        if (found) {
          let ics = found.ics;
          ics = setIcsField(ics, 'SUMMARY', next.title); ics = setIcsField(ics, 'DTSTART', next.start); ics = setIcsField(ics, 'DTEND', next.end);
          ics = setIcsField(ics, 'LOCATION', next.location); ics = setIcsField(ics, 'DESCRIPTION', next.description);
          await events.caldavPutIf(creds, found.url, ics, found.etag);
          direct = true;
          calendar.forget([e.calendar]);
        }
      } catch (err) { note = `Your calendar didn't take the change (${err.message}), so it's changed in Maestro only.`; }
    }
    // Remember the edit in Maestro either way, so the feed and calendar show it right away.
    const edits = readAll().filter((x) => !(x.source === e.source && x.key === keyOf(e) && sameTime(x.start, e.originalStart || e.start)));
    edits.push({ source: e.source, key: keyOf(e), start: e.originalStart || e.start, profile: prof, at: Date.now(), fields: next, direct });
    writeAll(edits);
    if (!direct && !note) note = whereText(e, conn);
  }
  const after = { ...e, ...next };
  syncCard(e, after, ref.cardId);
  return { event: after, note: note || whereText(e, conn) };
}

// The event's feed cards show the new details, labelled "Updated: <title>".
function syncCard(before, after, cardId) {
  const feed = require('./feed');
  const when = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const quote = `${when(after.start)} – ${new Date(after.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${after.location && !/^https?:/.test(after.location) ? ' · ' + after.location : ''}`;
  const key = keyOf(before);
  const mine = (i) => i.category === 'MEETING' && !i.removed && (i.source === before.source || (before.created && i.source === 'system')) && !!i.eventKey && (i.eventKey === key || (before.uid && i.eventKey === before.uid)) && (!i.eventStart || sameTime(i.eventStart, before.start) || sameTime(i.eventStart, before.originalStart));
  feed.updateCards((i) => i.id === cardId || mine(i),
    () => ({ title: `Updated: ${after.title}`, eventTitle: after.title, eventStart: after.start, eventEnd: after.end, eventLocation: after.location || '', quote, description: after.description || '', updated: true, unread: true, ts: Date.now() }));
}

async function remove(ref, { profile, series = false } = {}) {
  const prof = profile || config.load().profile;
  const e = await find(ref, prof);
  if (!e) throw Object.assign(new Error("I couldn't find that event in your calendars any more."), { status: 404 });
  const r = await require('./remove').perform(e, { profile: prof, series });
  if (ref.cardId) { try { require('./feed').markRemoved((i) => i.id === ref.cardId); } catch { /* best-effort */ } } // the card you used turns grey too
  writeAll(readAll().filter((x) => !(x.source === e.source && x.key === keyOf(e))));
  return { ...r, event: e };
}

async function describe(ref, { profile } = {}) {
  const cfg = config.load();
  const prof = profile || cfg.profile;
  const e = await find(ref, prof);
  if (!e) return null;
  const notes = /^[\w -]+\/[\w .'&-]+$/.test(e.notes || '') ? '' : e.notes || ''; // a linked vault note isn't a description
  return { ...e, description: e.description || notes, where: whereText(e, (cfg.connections[prof] || {})[e.source] || {}) };
}

module.exports = { apply, find, update, remove, describe, setIcsField, readAll };
