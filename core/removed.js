// Events the user removed in Maestro (data/removed-events.json).
// Removed events disappear from Maestro straight away. For calendars Maestro can't write to
// (Google, Outlook, iCal links without sign-in) the entry also waits for Claude Desktop to delete it there.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const FILE = path.join(config.DATA_DIR, 'removed-events.json');
function readAll() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } }
function writeAll(list) { fs.mkdirSync(config.DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(list.slice(-500), null, 1)); }

const keyOf = (e) => e.uid || `${e.title}|${e.source}`;

// series: hides every occurrence of the event; otherwise only the one starting at e.start
function add(e, { series = false, needsSync = null, profile } = {}) {
  const all = readAll();
  all.push({ key: keyOf(e), uid: e.uid || '', start: new Date(e.start).toISOString(), end: new Date(e.end).toISOString(), series, source: e.source, title: e.title, calendarName: e.calendarName || '', profile, at: Date.now(), needsSync, synced: !needsSync });
  writeAll(all);
}

function isRemoved(e, list = readAll()) {
  const k = keyOf(e);
  const start = new Date(e.start).toISOString();
  return list.some((r) => r.key === k && (r.series || r.start === start));
}

function pendingSync() { return readAll().filter((r) => r.needsSync && !r.synced); }
function markSynced(uid, start) {
  const all = readAll();
  const hit = all.filter((r) => r.uid === uid && (!start || r.start === new Date(start).toISOString()) && !r.synced);
  hit.forEach((r) => { r.synced = true; r.syncedAt = Date.now(); });
  if (hit.length) writeAll(all);
  return hit.length;
}

module.exports = { add, isRemoved, readAll, pendingSync, markSynced };
