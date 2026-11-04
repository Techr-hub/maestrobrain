// Removing calendar events: "Hey Maestro, cancel my meeting with John tomorrow", "delete board prep".
//
// Maestro finds the event, asks which one when several match, asks "just this one or the whole series?" for
// repeating events, and always confirms before removing anything.
//
// Where it is removed:
// - Events Maestro created: from Maestro, and from iCloud/CalDAV if it was written there.
// - iCloud / CalDAV calendars with sign-in details on the card: deleted on the server (one occurrence of a
//   repeating event is skipped with an EXDATE, the rest of the series stays).
// - Calendly: the booking is cancelled through Calendly, which emails the invitee.
// - Google, Outlook and read-only iCal links: removed from Maestro now, and Claude Desktop deletes it in the
//   real calendar with its connector ("Sync my calendar changes into my calendars").
const config = require('./config');
const calendar = require('./calendar');
const events = require('./events');
const removed = require('./removed');
const connectors = require('./connectors');
const lookup = require('./lookup');
const { parseDate, parseTime } = require('./scheduler');

const LABEL = { icalendar: 'Mac / iCloud Calendar', gcal: 'Google Calendar', outlook: 'Outlook Calendar', calendly: 'Calendly', maestro: 'Maestro calendar' };
const fmt = (iso, allDay) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  return allDay ? day : `${day} at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
};
const calName = (e) => `${LABEL[e.source] || e.source}${e.calendarName ? ` ("${e.calendarName}")` : ''}`;

const VERB = /\b(cancel|cancell?ed|delete|remove|clear|drop|scrap|axe|kill|get rid of|take (it )?off|unschedule|call off)\b/;
function wantsRemove(text) {
  const m = text.toLowerCase();
  if (!VERB.test(m)) return false;
  if (/\b(task|to-?do|note|memory|reminder|connection|connector|skill|agent)\b/.test(m)) return false;
  if (/^(cancel|never ?mind|stop|forget it|scratch that)\.?$/.test(m.trim())) return false; // cancelling a question, not an event
  return /\b(meeting|event|appointment|call|booking|session|lunch|dinner|breakfast|coffee|sync|review|standup|1:1|interview|demo|calendar|catch ?up|invite)\b/.test(m)
    || /\b(cancel|delete|remove)\b\s+(my|the|our|tomorrow'?s|today'?s)\b/.test(m);
}

// Find upcoming events that match what was said: words in the title/attendees, plus a day and time if given.
async function candidates(text, profile) {
  const now = new Date();
  const list = (await calendar.list({ profile, days: 184 })).filter((e) => new Date(e.end) > now);
  const m = text.toLowerCase().replace(/[’]/g, "'");
  const day = parseDate(m, now);
  const time = parseTime(m);
  let pool = list;
  if (day) pool = pool.filter((e) => new Date(e.start).toDateString() === day.toDateString());
  if (time != null) pool = pool.filter((e) => { const d = new Date(e.start); return d.getHours() * 60 + d.getMinutes() === time; });
  const words = m.replace(VERB, ' ').replace(/\b(from|off|my|the|calendar|please|can you|could you|for|at|on|in|tomorrow|today|tonight|next|this|am|pm|\d{1,2}(:\d{2})?)\b/g, ' ');
  const hit = lookup.matchEvents(words, pool);
  const out = hit ? hit.events : day || time != null ? pool : [];
  // a repeating event counts once: its next occurrence (unless a day was named)
  const seen = new Set();
  return out.filter((e) => { const k = e.uid ? `${e.source}|${e.uid}` : `${e.source}|${e.title}|${e.start}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// Actually remove it. Returns a sentence saying what happened.
async function perform(e, opts = {}) {
  const r = await removeIt(e, opts);
  const series = !!opts.series;
  // Grey out this event's cards in the Intelligence Feed. No extra "Cancelled" card (Ryan, 2026-11-02):
  // Maestro's reply already says it's gone.
  try { const feed = require('./feed'); feed.markRemoved(feed.eventMatcher(e, { series })); } catch { /* best-effort */ }
  return r;
}

async function removeIt(e, { profile, series = false } = {}) {
  const cfg = config.load();
  const prof = profile || cfg.profile;
  const conns = cfg.connections[prof] || {};
  const conn = conns[e.source] || {};
  const label = calName(e);
  let done = '';
  let note = '';

  // Created by Maestro
  if (e.created || /@maestro$/.test(e.uid || '')) {
    const rec = events.removeCreated(e.uid) || {};
    if (rec.target && rec.target.startsWith('caldav:')) {
      const id = rec.target.split(':')[1];
      const creds = events.caldavCreds(id, conns[id]);
      if (creds) { try { await events.caldavDelete(creds, rec.href.replace(/\/?$/, '/') + encodeURIComponent(rec.uid) + '.ics'); } catch (err) { note = `I couldn't reach iCloud (${err.message}), so it may still show there.`; } }
    } else if (rec.calendarFor && rec.synced) {
      removed.add(e, { needsSync: rec.calendarFor, profile: prof });
      note = `Claude Desktop will remove it from ${LABEL[rec.calendarFor]} the next time you run "Sync my calendar changes into my calendars".`;
    }
    if (!e.live) { calendar.forget(); return { done: `Removed "${e.title}" (${fmt(e.start, e.allDay)}) from your ${LABEL[rec.calendarFor] || label}.`, note }; }
  }

  if (e.source === 'calendly') {
    await connectors.calendlyCancel(conn.fields && conn.fields.token, e.uid);
    require('./calwatch').forgetCalendly(prof, e.uid);
    removed.add(e, { profile: prof });
    done = `Cancelled "${e.title}" (${fmt(e.start)}) in Calendly. Calendly lets the invitee know.`;
  } else if (!e.live || conn.mode === 'demo') {
    removed.add(e, { series, profile: prof });
    done = `Removed "${e.title}" (${fmt(e.start, e.allDay)})${series ? ' and the rest of the series' : ''} from your ${label}.`;
    if (conn.mode === 'demo') note = "It's demo data, so only Maestro changes.";
  } else {
    const creds = events.caldavCreds(e.source, conn);
    let direct = false;
    if (creds && e.uid) {
      const found = await events.caldavFind(creds, e.uid);
      if (found) {
        if (series || !e.recurring) await events.caldavDelete(creds, found.url, found.etag);
        else await events.caldavPutIf(creds, found.url, events.withExdate(found.ics, e.start), found.etag);
        direct = true;
      }
    }
    removed.add(e, { series, profile: prof, needsSync: direct ? null : e.source });
    calendar.forget([e.calendar]);
    done = `Removed "${e.title}" (${fmt(e.start, e.allDay)})${series ? ' and the rest of the series' : ''} from your ${label}.`;
    if (!direct) note = e.source === 'icalendar'
      ? `It's gone from Maestro. To delete it in Apple Calendar too, add your Apple ID and an app-specific password to the iCalendar card, or run "Sync my calendar changes into my calendars" in Claude Desktop.`
      : `It's gone from Maestro. Claude Desktop deletes it in ${LABEL[e.source]} itself when you run "Sync my calendar changes into my calendars" (+ → Maestro).`;
  }
  return { done, note };
}

const list = (evs) => evs.slice(0, 6).map((e, i) => `${i + 1}) ${e.title}, ${fmt(e.start, e.allDay)} (${LABEL[e.source] || e.source})`).join('\n');
function confirmText(e, series) {
  return `Remove "${e.title}" on ${fmt(e.start, e.allDay)}${series ? ' and every other occurrence' : ''} from your ${calName(e)}?${e.source === 'calendly' ? ' Calendly will tell the invitee it\'s cancelled.' : ''} Say yes to confirm.`;
}
const YES = /^(yes|yeah|yep|yup|sure|ok(ay)?|confirm(ed)?|do it|go ahead|please do|delete it|remove it|cancel it|correct|that'?s (it|right|the one))\b/;
const NO = /^(no|nope|nah|stop|don'?t|never ?mind|keep it|leave it|abort|wait)\b/;

// Called for every chat message. Returns null when this isn't about removing an event.
async function handle(text, conv, { profile, name }) {
  const m = text.toLowerCase().replace(/[.!?]+$/, '').trim();
  let s = conv.pending && conv.pending.type === 'remove' ? conv.pending : null;
  if (s && Date.now() - (s.askedAt || 0) > 15 * 60000) { conv.pending = null; s = null; }
  if (!s) {
    const explicit = wantsRemove(text);
    // "delete board prep": a remove verb plus the name of an event on the calendar also counts
    if (!explicit && !(VERB.test(text.toLowerCase()) && !/\b(task|to-?do|note|memory|reminder|connection|connector|skill|agent|file|message|email)\b/i.test(text))) return null;
    const found = await candidates(text, profile);
    if (!explicit && !found.length) return null;
    if (!found.length) return { reply: `I can't find that on your calendar in the next 6 months, ${name}. Tell me the event's name or when it is.` };
    s = { type: 'remove', options: found.slice(0, 6), askedAt: Date.now() };
    if (found.length > 1) { s.step = 'pick'; conv.pending = s; return { reply: `I found ${found.length} that match. Which one?\n${list(found)}`, pending: true }; }
    s.event = found[0];
  } else if (s.step === 'pick') {
    const n = Number((m.match(/\b(\d)\b/) || [])[1] || { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, last: s.options.length }[(m.match(/\b(first|second|third|fourth|fifth|sixth|last)\b/) || [])[1]] || 0);
    const byWord = !n && lookup.matchEvents(m, s.options);
    s.event = n ? s.options[n - 1] : byWord && byWord.events.length === 1 ? byWord.events[0] : null;
    if (NO.test(m)) { conv.pending = null; return { reply: 'Okay, nothing removed.' }; }
    if (!s.event) { s.askedAt = Date.now(); conv.pending = s; return { reply: `Sorry, which one? Say a number.\n${list(s.options)}`, pending: true }; }
  } else if (s.step === 'scope') {
    if (NO.test(m) && !/\b(one|just)\b/.test(m)) { conv.pending = null; return { reply: 'Okay, nothing removed.' }; }
    s.series = /\b(all|every|whole|entire|series|each|recurring|always|future)\b/.test(m);
    if (!s.series && !/\b(this|one|just|only|single|that)\b/.test(m)) { s.askedAt = Date.now(); conv.pending = s; return { reply: 'Just this one, or the whole series?', pending: true }; }
    s.scoped = true;
  } else if (s.step === 'confirm') {
    conv.pending = null;
    if (!YES.test(m)) return { reply: `Okay, I left "${s.event.title}" where it is.` };
    try {
      const r = await perform(s.event, { profile, series: !!s.series });
      return { reply: `${r.done}${r.note ? `\n\n_${r.note}_` : ''}`, removed: s.event };
    } catch (err) { return { reply: `I couldn't remove it: ${err.message}` }; }
  }
  if (s.event.recurring && !s.scoped && s.event.source !== 'calendly') {
    s.step = 'scope'; s.askedAt = Date.now(); conv.pending = s;
    return { reply: `"${s.event.title}" repeats. Remove just ${fmt(s.event.start, s.event.allDay)}, or the whole series?`, pending: true };
  }
  s.step = 'confirm'; s.askedAt = Date.now(); conv.pending = s;
  return { reply: confirmText(s.event, s.series), pending: true };
}

module.exports = { handle, perform, candidates, wantsRemove };
