// The integration layer. Each connector describes a source the brain can listen to.
// Every connector works in DEMO mode out of the box. Some can also run LIVE from the dashboard
// (iCal/Google Calendar via ICS link, Slack via bot token, Twilio via API keys). The rest go live
// inside Claude Desktop through its connectors or an MCP server, which is where the reasoning happens.

const CONNECTORS = [
  // ---------- Foundation: every brain gets these ----------
  {
    id: 'gmail', name: 'Gmail', icon: 'mail', color: '#ff5a4e', group: 'foundation', category: 'EMAIL',
    description: 'Personal and work email from Google.',
    live: 'claude',
    claudeSetup: 'In Claude Desktop open Settings → Connectors and connect Gmail. Claude can then search and draft email while Maestro supplies your context.',
  },
  {
    id: 'outlook', name: 'Outlook / Microsoft 365', icon: 'mail', color: '#2f8cff', group: 'foundation', category: 'EMAIL',
    description: 'Outlook mail and calendar for work.',
    live: 'dashboard+claude',
    liveFields: [{ key: 'icsUrls', type: 'list', addLabel: 'Add another calendar', label: 'Published calendar ICS links', placeholder: 'https://outlook.office365.com/owa/calendar/…/calendar.ics', help: 'Outlook → Settings → Calendar → Shared calendars → Publish a calendar → copy the ICS link.' }],
    claudeSetup: 'In Claude Desktop open Settings → Connectors and connect Microsoft 365 for mail. Paste a published ICS link here to stream your Outlook calendar into the feed.',
  },
  {
    id: 'email', name: 'Email (IMAP / other)', icon: 'at-sign', color: '#ffb020', group: 'foundation', category: 'EMAIL',
    description: 'Any other mailbox: iCloud, Fastmail, company mail.',
    live: 'claude',
    claudeSetup: 'Add an IMAP email MCP server to Claude Desktop (see docs/CONNECTORS.md). Maestro shows demo email until then.',
  },
  {
    id: 'icalendar', name: 'iCalendar', icon: 'calendar-days', color: '#00e5ff', group: 'foundation', category: 'MEETING',
    description: 'Apple iCloud calendar or any .ics feed.',
    live: 'dashboard',
    liveFields: [{ key: 'icsUrls', type: 'list', addLabel: 'Add another calendar', label: 'Calendar ICS / webcal links', placeholder: 'webcal://p01-caldav.icloud.com/published/2/…', help: 'Apple Calendar → right-click a calendar → Share → Public Calendar → copy link.' },
      { key: 'caldavUser', label: 'Create events: Apple ID email (optional)', placeholder: 'you@icloud.com', help: 'To let Maestro add events to your iCloud calendars, also enter your Apple ID and an app-specific password (appleid.apple.com → Sign-In and Security → App-Specific Passwords). Leave blank for read-only.' },
      { key: 'caldavPassword', label: 'App-specific password', placeholder: 'xxxx-xxxx-xxxx-xxxx', secret: true },
      { key: 'caldavUrl', label: 'CalDAV server (only if not iCloud)', placeholder: 'https://caldav.fastmail.com/  ·  https://cloud.example.com/remote.php/dav/', advanced: true }],
  },
  {
    id: 'calendly', name: 'Calendly', icon: 'calendar-days', color: '#4d9bff', group: 'foundation', category: 'MEETING',
    description: 'New bookings the moment someone schedules time with you.',
    live: 'dashboard',
    liveFields: [{ key: 'token', label: 'Personal access token', placeholder: 'eyJraWQiOi…', secret: true, help: 'calendly.com → Integrations & apps → API and webhooks → Personal access tokens → Generate new token.' }],
  },
  {
    id: 'gcal', name: 'Google Calendar', icon: 'calendar-days', color: '#3d7bff', group: 'foundation', category: 'MEETING',
    description: 'Meetings, events and reminders from Google Calendar.',
    live: 'dashboard+claude',
    liveFields: [{ key: 'icsUrls', type: 'list', addLabel: 'Add another calendar', label: 'Secret addresses in iCal format', placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics', help: 'Google Calendar → Settings → your calendar → Integrate calendar → Secret address in iCal format.' }],
    claudeSetup: 'In Claude Desktop open Settings → Connectors and connect Google Calendar so Claude can also create events.',
  },
  {
    id: 'slack', name: 'Slack', icon: 'hash', color: '#c42cff', group: 'foundation', category: 'CONVERSATION',
    description: 'Mentions, DMs and channel activity.',
    live: 'dashboard+claude',
    liveFields: [
      { key: 'token', label: 'Slack token (xoxp-… or xoxb-…)', placeholder: 'xoxp-… or xoxb-…', secret: true, help: 'api.slack.com/apps → Create New App → OAuth & Permissions → add the scopes channels:read, channels:history, groups:read, groups:history, users:read (bot tokens also need channels:join) → Install to Workspace → copy the User OAuth Token (sees every channel you are in) or the Bot User OAuth Token.' },
      { key: 'channels', type: 'channels', label: 'Channels to show notifications from', help: 'Load your channels, then tick the ones Maestro should bring into the feed.' },
    ],
    claudeFields: [
      { key: 'channels', type: 'list', label: 'Channels to follow (optional)', placeholder: '#general', addLabel: 'Add another channel', help: 'Leave empty to follow your mentions and DMs only. Claude reads these through its Slack connector when you run "Sync my Claude connectors" in Claude Desktop.' },
    ],
    claudeSetup: 'Claude Desktop → Settings → Connectors → Slack. Then, in Claude Desktop, run the "Sync my Claude connectors into Maestro" prompt (+ menu → Maestro) to bring messages into the feed.',
  },
  {
    id: 'twilio_sms', name: 'Text messages (Twilio)', short: 'Text', icon: 'message-square', color: '#ff4d8d', group: 'foundation', category: 'SMS',
    description: 'SMS sent to your Twilio number.',
    live: 'dashboard',
    liveFields: [
      { key: 'accountSid', label: 'Account SID', placeholder: 'AC…' },
      { key: 'authToken', label: 'Auth token', placeholder: '', secret: true },
      { key: 'number', label: 'Your Twilio number', placeholder: '+15551234567' },
    ],
  },
  {
    id: 'twilio_calls', name: 'Phone calls (Twilio)', short: 'Phone', icon: 'phone', color: '#ff7a45', group: 'foundation', category: 'CALL',
    description: 'Incoming and missed phone calls with voicemail transcripts.',
    live: 'dashboard',
    liveFields: [
      { key: 'accountSid', label: 'Account SID', placeholder: 'AC…' },
      { key: 'authToken', label: 'Auth token', placeholder: '', secret: true },
      { key: 'number', label: 'Your Twilio number', placeholder: '+15551234567' },
    ],
  },
  {
    id: 'whatsapp', name: 'WhatsApp', short: 'WhatsApp', icon: 'message-circle', color: '#25d366', group: 'foundation', category: 'SMS',
    description: 'WhatsApp messages sent to your WhatsApp Business number.',
    live: 'dashboard',
    liveFields: [
      { key: 'accountSid', label: 'Twilio Account SID', placeholder: 'AC…', help: 'WhatsApp goes live through Twilio: Console → Messaging → Try WhatsApp (sandbox) or register a WhatsApp sender.' },
      { key: 'authToken', label: 'Auth token', placeholder: '', secret: true },
      { key: 'number', label: 'Your WhatsApp number', placeholder: 'whatsapp:+14155238886' },
    ],
  },
  {
    id: 'google_meet', name: 'Google Meet', short: 'Meet', icon: 'video', color: '#00ac47', group: 'foundation', category: 'CALL',
    description: 'Meet calls, recordings and transcripts from Google Workspace.',
    live: 'claude',
    claudeSetup: 'In Claude Desktop open Settings → Connectors and connect Google Calendar and Google Drive: Meet links live on your events and recordings and transcripts are saved to Drive.',
  },
  {
    id: 'teams', name: 'Microsoft Teams', short: 'Teams', icon: 'video', color: '#6264a7', group: 'foundation', category: 'CALL',
    description: 'Teams calls and meeting recaps.',
    live: 'claude',
    claudeSetup: 'In Claude Desktop open Settings → Connectors and connect Microsoft 365 (your admin may need to allow it).',
  },
  {
    id: 'zoom', name: 'Zoom', short: 'Zoom', icon: 'video', color: '#2d8cff', group: 'foundation', category: 'CALL',
    description: 'Zoom meetings, recordings and AI summaries.',
    live: 'claude',
    claudeSetup: 'Add the Zoom connector in Claude Desktop (Settings → Connectors), or a Zoom MCP server in claude_desktop_config.json.',
  },

  // ---------- Role pack connectors ----------
  { id: 'linear', name: 'Linear', icon: 'git-branch', color: '#7a6bff', group: 'pack', category: 'TASK', description: 'Issues, cycles and project progress.', live: 'claude', claudeSetup: 'Claude Desktop → Settings → Connectors → Linear (or add the Linear MCP server: https://mcp.linear.app/mcp).' },
  { id: 'jira', name: 'Jira', icon: 'clipboard-check', color: '#2684ff', group: 'pack', category: 'TASK', description: 'Sprints, epics and tickets.', live: 'claude', claudeSetup: 'Claude Desktop → Settings → Connectors → Atlassian (Jira + Confluence).' },
  { id: 'notion', name: 'Notion', icon: 'file-text', color: '#e9e7ff', group: 'pack', category: 'PROJECT', description: 'Docs, PRDs and wikis.', live: 'claude', claudeSetup: 'Claude Desktop → Settings → Connectors → Notion.' },
  { id: 'figma', name: 'Figma', icon: 'pen-tool', color: '#a259ff', group: 'pack', category: 'CONVERSATION', description: 'Design files, comments and handoff.', live: 'claude', claudeSetup: 'Claude Desktop → Settings → Connectors → Figma (Dev Mode MCP).' },
  { id: 'gdrive', name: 'Google Drive', icon: 'folder', color: '#00c389', group: 'pack', category: 'PROJECT', description: 'Research docs, decks and sheets.', live: 'claude', claudeSetup: 'Claude Desktop → Settings → Connectors → Google Drive.' },
  { id: 'github', name: 'GitHub', icon: 'github', color: '#e9e7ff', group: 'pack', category: 'TASK', description: 'Pull requests, issues and CI.', live: 'claude', claudeSetup: 'Claude Desktop → Settings → Connectors → GitHub (or the GitHub MCP server).' },
  { id: 'docs', name: 'Docs (Confluence / Mintlify)', icon: 'book-open', color: '#00e5ff', group: 'pack', category: 'PROJECT', description: 'Technical documentation sources.', live: 'claude', claudeSetup: 'Add your docs platform connector in Claude Desktop.' },
];

const byId = Object.fromEntries(CONNECTORS.map((c) => [c.id, c]));

function list() { return CONNECTORS; }
function get(id) { return byId[id]; }

// ---------------- Live fetchers (no dependencies, plain fetch) ----------------

function unfoldIcs(text) {
  return text.replace(/\r?\n[ \t]/g, '');
}

// Every calendar connector can hold several ICS links (one per calendar). Older configs had one `icsUrl`.
function calendarUrls(fields = {}) {
  const list = Array.isArray(fields.icsUrls) ? fields.icsUrls : String(fields.icsUrls || '').split(/[\n,]+/);
  if (fields.icsUrl) list.unshift(fields.icsUrl);
  return [...new Set(list.map((u) => String(u || '').trim()).filter(Boolean))];
}

// Outlook writes Windows zone names; map the common ones to IANA.
const WIN_TZ = {
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles', 'Atlantic Standard Time': 'America/Halifax', 'Newfoundland Standard Time': 'America/St_Johns',
  'Alaskan Standard Time': 'America/Anchorage', 'Hawaiian Standard Time': 'Pacific/Honolulu', 'US Mountain Standard Time': 'America/Phoenix',
  'GMT Standard Time': 'Europe/London', 'W. Europe Standard Time': 'Europe/Berlin', 'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest', 'E. Europe Standard Time': 'Europe/Bucharest', 'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai', 'Tokyo Standard Time': 'Asia/Tokyo', 'AUS Eastern Standard Time': 'Australia/Sydney', 'UTC': 'UTC',
};

// Minutes a time zone is ahead of UTC at a given instant.
function tzOffset(zone, at) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at).map((x) => [x.type, x.value]));
    return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - at.getTime()) / 60000;
  } catch { return null; }
}

// "DTSTART;TZID=America/Toronto:20261101T090000" → Date (UTC instant). Floating times use the computer's zone.
function parseIcsDate(v) {
  if (!v) return null;
  const val = v.slice(v.lastIndexOf(':') + 1).trim();
  const m = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = m;
  if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  const tz = (v.match(/TZID=("?)([^;:"]+)\1/) || [])[2];
  const zone = tz && (WIN_TZ[tz] || tz.replace(/^\/[^/]+\/[^/]+\//, ''));
  if (zone && m[4]) {
    const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
    const off1 = tzOffset(zone, new Date(wall));
    if (off1 != null) {
      const off2 = tzOffset(zone, new Date(wall - off1 * 60000));
      return new Date(wall - (off2 != null ? off2 : off1) * 60000);
    }
  }
  return new Date(+y, +mo - 1, +d, +h, +mi, +s);
}

const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// Expand a recurring event (RRULE) into the occurrences that fall inside [from, to].
// Covers what real calendars use for meetings: DAILY / WEEKLY (BYDAY) / MONTHLY (BYMONTHDAY or BYDAY like 2TU, -1FR) / YEARLY,
// with INTERVAL, COUNT and UNTIL. EXDATEs are skipped.
function expandRule(start, rule, from, to, exdates) {
  const r = Object.fromEntries(rule.split(';').map((p) => p.split('=')));
  const freq = r.FREQ, interval = Math.max(1, Number(r.INTERVAL || 1));
  const until = r.UNTIL ? parseIcsDate(':' + r.UNTIL) : null;
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const byDay = r.BYDAY ? r.BYDAY.split(',') : null;
  const byMonthDay = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : null;
  const out = [];
  let n = 0;
  const keep = (d) => {
    if (d < start) return true;
    if (until && d > until) return false;
    if (++n > count) return false;
    if (d > to) return false;
    if (d >= from && !exdates.has(d.getTime())) out.push(d);
    return true;
  };
  const at = (base, days) => { const d = new Date(base); d.setDate(d.getDate() + days); return d; };
  const limit = 3000;
  if (freq === 'DAILY') {
    for (let i = 0; i < limit; i++) { if (!keep(at(start, i * interval))) break; }
  } else if (freq === 'WEEKLY') {
    const days = (byDay || [Object.keys(DAYS)[start.getDay()]]).map((x) => DAYS[x.slice(-2)]).sort();
    const weekStart = at(start, -start.getDay());
    outer: for (let w = 0; w < limit; w++) {
      for (const dow of days) { const d = at(weekStart, w * 7 * interval + dow); if (!keep(d)) break outer; }
    }
  } else if (freq === 'MONTHLY') {
    outer2: for (let i = 0; i < limit; i++) {
      const base = new Date(start); base.setDate(1); base.setMonth(start.getMonth() + i * interval);
      const cands = [];
      if (byDay) {
        for (const spec of byDay) {
          const mm = spec.match(/^(-?\d)?(\w\w)$/); if (!mm) continue;
          const dow = DAYS[mm[2]], nth = Number(mm[1] || 0);
          const days = []; const d = new Date(base);
          while (d.getMonth() === base.getMonth()) { if (d.getDay() === dow) days.push(new Date(d)); d.setDate(d.getDate() + 1); }
          if (nth > 0 && days[nth - 1]) cands.push(days[nth - 1]); else if (nth < 0 && days[days.length + nth]) cands.push(days[days.length + nth]); else if (!nth) cands.push(...days);
        }
      } else {
        for (const md of byMonthDay || [start.getDate()]) { const d = new Date(base); d.setDate(md); if (d.getMonth() === base.getMonth()) cands.push(d); }
      }
      cands.sort((a, b) => a - b);
      for (const d of cands) if (!keep(d)) break outer2;
    }
  } else if (freq === 'YEARLY') {
    for (let i = 0; i < 200; i++) { const d = new Date(start); d.setFullYear(start.getFullYear() + i * interval); if (!keep(d)) break; }
  }
  return out;
}

function parseIcs(text, { from = new Date(Date.now() - 30 * 86400000), to = new Date(Date.now() + 90 * 86400000) } = {}) {
  const events = [];
  const overrides = new Map(); // uid -> Set of replaced occurrence times
  const body = unfoldIcs(text);
  const blocks = body.split('BEGIN:VEVENT').slice(1).map((b) => b.split('END:VEVENT')[0]);
  const parsed = [];
  for (const b of blocks) {
    const get = (key) => {
      const m = b.match(new RegExp('^' + key + '(;[^:\\r\\n]*)?:(.*)$', 'm'));
      return m ? (m[1] || '') + ':' + m[2].trim() : null;
    };
    const all = (key) => [...b.matchAll(new RegExp('^' + key + '(;[^:\\r\\n]*)?:(.*)$', 'gm'))].map((m) => (m[1] || '') + ':' + m[2].trim());
    const val = (key) => { const g = get(key); return g ? g.slice(g.indexOf(':') + 1).replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\;/g, ';') : ''; };
    if (/^CANCELLED$/i.test(val('STATUS'))) { const rid = parseIcsDate(get('RECURRENCE-ID')); if (rid) { const uid = val('UID'); if (!overrides.has(uid)) overrides.set(uid, new Set()); overrides.get(uid).add(rid.getTime()); } continue; }
    const dtstart = get('DTSTART');
    const start = parseIcsDate(dtstart);
    if (!start) continue;
    const allDay = !/T\d{6}/.test(dtstart.slice(dtstart.lastIndexOf(':') + 1));
    const end = parseIcsDate(get('DTEND')) || new Date(start.getTime() + (allDay ? 86400000 : 30 * 60000));
    const rid = parseIcsDate(get('RECURRENCE-ID'));
    const uid = val('UID');
    if (rid) { if (!overrides.has(uid)) overrides.set(uid, new Set()); overrides.get(uid).add(rid.getTime()); }
    const exdates = new Set();
    for (const ex of all('EXDATE')) { const head = ex.slice(0, ex.lastIndexOf(':') + 1); for (const part of ex.slice(ex.lastIndexOf(':') + 1).split(',')) { const d = parseIcsDate(head + part); if (d) exdates.add(d.getTime()); } }
    parsed.push({ uid, start, end, allDay, rrule: val('RRULE'), exdates, rid, title: val('SUMMARY') || '(no title)', location: val('LOCATION'), description: val('DESCRIPTION').slice(0, 2000), url: val('URL'), organizer: val('ORGANIZER').replace(/^mailto:/i, '') });
  }
  for (const e of parsed) {
    const base = { uid: e.uid, title: e.title, location: e.location, description: e.description, url: e.url, organizer: e.organizer, allDay: e.allDay };
    const dur = e.end - e.start;
    if (e.rrule && !e.rid) {
      const skip = overrides.get(e.uid) || new Set();
      for (const d of expandRule(e.start, e.rrule, new Date(from.getTime() - dur), to, e.exdates)) {
        if (skip.has(d.getTime())) continue;
        events.push({ ...base, recurring: true, start: d.toISOString(), end: new Date(d.getTime() + dur).toISOString() });
      }
    } else {
      events.push({ ...base, start: e.start.toISOString(), end: e.end.toISOString() });
    }
  }
  events.sort((a, b) => new Date(a.start) - new Date(b.start));
  const cal = (body.match(/^X-WR-CALNAME:(.*)$/m) || [])[1];
  if (cal && cal.trim()) for (const e of events) e.calendarName = cal.trim().replace(/\\,/g, ',');
  return events;
}

async function fetchIcs(url) {
  const u = url.trim().replace(/^webcals?:/i, 'https:');
  const get = (x) => fetch(x, { headers: { 'User-Agent': 'Maestro-Brain', Accept: 'text/calendar, */*' }, redirect: 'follow' });
  let res;
  try { res = await get(u); } catch (e) {
    // a few webcal servers only speak plain http
    let host = 'the calendar server'; try { host = new URL(u).host; } catch { /* bad link */ }
    if (/^webcal:/i.test(url.trim())) { try { res = await get(u.replace(/^https:/, 'http:')); } catch { throw friendly(e, host); } } else throw friendly(e, host);
  }
  if (!res.ok) throw new Error('Calendar link returned HTTP ' + res.status);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('That link did not return an iCalendar file');
  return parseIcs(text);
}

// ---------------- Calendly (personal access token) ----------------
const CALENDLY_API = process.env.MAESTRO_CALENDLY_API || 'https://api.calendly.com';
async function calendlyGet(token, url) {
  if (!token) throw new Error('Paste your Calendly personal access token first');
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 401) throw new Error('Calendly rejected the token. Generate a new personal access token and paste it again.');
  if (!res.ok) throw new Error('Calendly returned HTTP ' + res.status);
  return res.json();
}
// Cancels the booking for everyone; Calendly emails the invitee.
async function calendlyCancel(token, eventUri, reason = 'Cancelled from Maestro') {
  if (!token) throw new Error('Calendly token is missing');
  const res = await fetch(eventUri.replace(/\/$/, '') + '/cancellation', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
  if (res.status === 401) throw new Error('Calendly rejected the token.');
  if (res.status === 403) throw new Error('Calendly only lets the event host cancel this booking.');
  if (!res.ok && res.status !== 201) throw new Error('Calendly returned HTTP ' + res.status);
  return true;
}
async function calendlyMe(token) { const r = await calendlyGet(token, `${CALENDLY_API}/users/me`); return { uri: r.resource.uri, name: r.resource.name }; }
async function calendlyEvents(token, userUri) {
  const q = new URLSearchParams({ user: userUri, min_start_time: new Date(Date.now() - 86400000).toISOString(), status: 'active', count: '50', sort: 'start_time:asc' });
  const r = await calendlyGet(token, CALENDLY_API + '/scheduled_events?' + q);
  return (r.collection || []).map((e) => ({ uid: e.uri, title: e.name, start: e.start_time, end: e.end_time, created: e.created_at, location: (e.location && (e.location.join_url || e.location.location || e.location.type)) || '' }));
}
async function calendlyInvitees(token, eventUri) {
  try { const r = await calendlyGet(token, eventUri + '/invitees?count=5'); return (r.collection || []).map((i) => i.name || i.email).filter(Boolean); } catch { return []; }
}

async function slackApi(token, method, params = {}) {
  if (!token) throw new Error('Slack token is missing');
  const res = await fetch(`${SLACK_API}/${method}?${new URLSearchParams(params)}`, { headers: { Authorization: 'Bearer ' + token } });
  const r = await res.json();
  if (!r.ok) {
    const hint = { invalid_auth: 'the token is not valid', not_authed: 'the token is missing', missing_scope: `the app needs the ${r.needed || 'right'} scope`, not_in_channel: 'the bot is not in that channel (type /invite @YourApp in it)', channel_not_found: 'that channel was not found or the token cannot see it', token_revoked: 'the token was revoked' }[r.error];
    throw new Error(`Slack: ${hint || r.error}`);
  }
  return r;
}
const SLACK_API = process.env.MAESTRO_SLACK_API || 'https://slack.com/api';

// Every channel the token can see, for the picker on the Slack card.
async function slackChannels(token) {
  const auth = await slackApi(token, 'auth.test');
  const out = [];
  let cursor = '';
  for (let page = 0; page < 10; page++) {
    let r;
    try { r = await slackApi(token, 'conversations.list', { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '200', ...(cursor ? { cursor } : {}) }); } catch (e) {
      if (/scope/.test(e.message) && page === 0) r = await slackApi(token, 'conversations.list', { types: 'public_channel', exclude_archived: 'true', limit: '200' }); else throw e;
    }
    for (const c of r.channels || []) out.push({ id: c.id, name: c.name, private: !!c.is_private, member: !!c.is_member, members: c.num_members || 0 });
    cursor = r.response_metadata && r.response_metadata.next_cursor;
    if (!cursor) break;
  }
  out.sort((a, b) => (b.member - a.member) || a.name.localeCompare(b.name));
  return { team: auth.team, user: auth.user, userId: auth.user_id, bot: /^xoxb-/.test(token), channels: out };
}

const slackUsers = new Map(); // user id -> display name
async function slackUserName(token, id) {
  if (!id) return 'someone';
  if (slackUsers.has(id)) return slackUsers.get(id);
  let name = id;
  try { const r = await slackApi(token, 'users.info', { user: id }); const u = r.user || {}; name = (u.profile && (u.profile.real_name || u.profile.display_name)) || u.real_name || u.name || id; } catch {}
  slackUsers.set(id, name);
  return name;
}
const slackChannelList = (channels) => (Array.isArray(channels) ? channels : String(channels || '').split(',')).map((c) => (typeof c === 'string' ? { id: c.trim(), name: c.trim() } : c)).filter((c) => c && c.id);

// Recent messages from the channels picked on the Slack card.
async function slackHistory({ token, channels }) {
  const auth = await slackApi(token, 'auth.test');
  const picked = slackChannelList(channels).slice(0, 25);
  const out = [];
  const errors = [];
  const oldest = String(Math.floor((Date.now() - 3 * 86400000) / 1000));
  for (const ch of picked) {
    try {
      let r;
      try { r = await slackApi(token, 'conversations.history', { channel: ch.id, limit: '15', oldest }); } catch (e) {
        if (!/not in that channel/.test(e.message)) throw e;
        await slackApi(token, 'conversations.join', { channel: ch.id }); // bot tokens: join public channels automatically
        r = await slackApi(token, 'conversations.history', { channel: ch.id, limit: '15', oldest });
      }
      for (const m of r.messages || []) {
        if (!m.text || (m.subtype && !['bot_message', 'thread_broadcast', 'file_share'].includes(m.subtype))) continue;
        let text = m.text;
        for (const [, uid] of text.matchAll(/<@([A-Z0-9]+)>/g)) text = text.replace(`<@${uid}>`, '@' + (await slackUserName(token, uid)));
        text = text.replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1').replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2').replace(/<(https?:[^>]+)>/g, '$1');
        out.push({ externalId: `slack:${ch.id}:${m.ts}`, ts: Math.round(parseFloat(m.ts) * 1000), channel: ch.id, channelName: ch.name, user: m.user ? await slackUserName(token, m.user) : (m.username || 'a bot'), mine: m.user === auth.user_id, mentionsMe: m.text.includes(`<@${auth.user_id}>`), text });
      }
    } catch (e) { errors.push(`#${ch.name}: ${e.message.replace(/^Slack: /, '')}`); }
  }
  return { team: auth.team, messages: out, errors, channels: picked.length };
}

async function twilioList({ accountSid, authToken, number }, kind) {
  if (!accountSid || !authToken) throw new Error('Twilio Account SID and auth token are required');
  const auth = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const resource = kind === 'calls' ? 'Calls' : 'Messages';
  const param = number ? `&To=${encodeURIComponent(number)}` : '';
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/${resource}.json?PageSize=15${param}`, { headers: { Authorization: auth } });
  const json = await res.json();
  if (!res.ok) throw new Error('Twilio: ' + (json.message || res.status));
  return kind === 'calls' ? json.calls || [] : json.messages || [];
}

// Test a live connection when the user saves it. Returns a short human message.
// Turn low-level network errors ("fetch failed") into something a person can act on.
function friendly(e, host) {
  const code = (e && e.cause && (e.cause.code || e.cause.name)) || '';
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return new Error(`Couldn't find ${host}. Check the link and your internet connection.`);
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|AbortError/.test(code)) return new Error(`Couldn't reach ${host} (${code}). Check your internet connection or VPN, then try again.`);
  if (/CERT|SSL|TLS/.test(code)) return new Error(`Secure connection to ${host} failed (${code}). A company proxy may be blocking it.`);
  if (e && e.message === 'fetch failed') return new Error(`Couldn't connect to ${host}${code ? ' (' + code + ')' : ''}. Check the link and your internet connection.`);
  return e;
}

async function testLive(id, fields) {
  const host = { slack: 'slack.com', twilio_sms: 'api.twilio.com', twilio_calls: 'api.twilio.com', whatsapp: 'api.twilio.com' }[id] || (() => { try { return new URL(String(calendarUrls(fields)[0] || '').replace(/^webcal:/i, 'https:')).host; } catch { return 'the calendar server'; } })();
  try { return await testLiveRaw(id, fields); } catch (e) { throw friendly(e, host); }
}

async function testLiveRaw(id, fields) {
  if (['icalendar', 'gcal', 'outlook'].includes(id)) {
    const urls = calendarUrls(fields);
    if (!urls.length) throw new Error('Paste a calendar link first');
    const label = (i) => (urls.length > 1 ? `Calendar ${i + 1}: ` : '');
    urls.forEach((u, i) => { if (!/^(https?|webcal):\/\//i.test(u)) throw new Error(`${label(i)}the link should start with https:// or webcal://`); });
    let total = 0, upcoming = 0;
    for (const [i, u] of urls.entries()) {
      let ev;
      try { ev = await fetchIcs(u); } catch (e) { let host = 'the calendar server'; try { host = new URL(u.replace(/^webcal:/i, 'https:')).host; } catch { /* bad link */ } const f = friendly(e, host); f.message = label(i) + f.message; throw f; }
      total += ev.length; upcoming += ev.filter((x) => new Date(x.end) >= new Date() && new Date(x.start) <= new Date(Date.now() + 7 * 86400000)).length;
    }
    let write = '';
    if (fields.caldavUser || fields.caldavPassword) {
      const ev = require('./events');
      const creds = ev.caldavCreds(id, { fields });
      if (!creds) throw new Error('To create events, fill in both the Apple ID and the app-specific password.');
      const cals = await ev.discover(creds);
      write = `. Maestro can create events in ${cals.length === 1 ? `"${cals[0].name}"` : `${cals.length} calendars (${cals.map((c) => c.name).join(', ')})`}`;
    }
    return `${urls.length === 1 ? 'Calendar' : urls.length + ' calendars'} connected: ${upcoming} events in the next 7 days${write}`;
  }
  if (id === 'calendly') {
    const me = await calendlyMe(fields.token);
    const ev = await calendlyEvents(fields.token, me.uri);
    return `Calendly connected for ${me.name}: ${ev.length} upcoming bookings`;
  }
  if (id === 'slack') {
    const r = await slackHistory(fields);
    if (!r.channels) return `Slack workspace "${r.team}" connected. Pick channels on the Slack card to see notifications`;
    if (r.errors.length === r.channels) throw new Error(`Slack connected to "${r.team}", but no channel could be read. ${r.errors[0]}`);
    return `Slack workspace "${r.team}" connected: ${r.messages.length} messages from the last 3 days in ${r.channels} channel${r.channels === 1 ? '' : 's'}${r.errors.length ? `. Skipped ${r.errors.join('; ')}` : ''}`;
  }
  if (id === 'twilio_sms') { const r = await twilioList(fields, 'messages'); return `Twilio connected: ${r.length} recent messages`; }
  if (id === 'whatsapp') { const r = (await twilioList(fields, 'messages')).filter((m) => /^whatsapp:/.test(m.from || m.to || '')); return `WhatsApp connected: ${r.length} recent messages`; }
  if (id === 'twilio_calls') { const r = await twilioList(fields, 'calls'); return `Twilio connected: ${r.length} recent calls`; }
  throw new Error('This connector goes live inside Claude Desktop. Use demo mode here.');
}

module.exports = { list, get, fetchIcs, parseIcs, calendarUrls, calendlyMe, calendlyEvents, calendlyInvitees, calendlyCancel, slackHistory, slackChannels, twilioList, testLive };
