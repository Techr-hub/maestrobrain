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
    liveFields: [{ key: 'icsUrl', label: 'Published calendar ICS link (optional)', placeholder: 'https://outlook.office365.com/owa/calendar/…/calendar.ics', help: 'Outlook → Settings → Calendar → Shared calendars → Publish a calendar → copy the ICS link.' }],
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
    liveFields: [{ key: 'icsUrl', label: 'Calendar ICS / webcal link', placeholder: 'webcal://p01-caldav.icloud.com/published/2/…', help: 'Apple Calendar → right-click a calendar → Share → Public Calendar → copy link.' }],
  },
  {
    id: 'gcal', name: 'Google Calendar', icon: 'calendar-days', color: '#3d7bff', group: 'foundation', category: 'MEETING',
    description: 'Meetings, events and reminders from Google Calendar.',
    live: 'dashboard+claude',
    liveFields: [{ key: 'icsUrl', label: 'Secret address in iCal format', placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics', help: 'Google Calendar → Settings → your calendar → Integrate calendar → Secret address in iCal format.' }],
    claudeSetup: 'In Claude Desktop open Settings → Connectors and connect Google Calendar so Claude can also create events.',
  },
  {
    id: 'slack', name: 'Slack', icon: 'hash', color: '#c42cff', group: 'foundation', category: 'CONVERSATION',
    description: 'Mentions, DMs and channel activity.',
    live: 'dashboard+claude',
    liveFields: [
      { key: 'token', label: 'Bot token (xoxb-…)', placeholder: 'xoxb-…', secret: true, help: 'api.slack.com/apps → Create app → OAuth & Permissions → add channels:history, channels:read, users:read → install → copy Bot User OAuth Token. Invite the bot to the channels.' },
      { key: 'channels', label: 'Channel IDs (comma separated)', placeholder: 'C0123ABCD, C0456EFGH' },
    ],
    claudeSetup: 'In Claude Desktop open Settings → Connectors and connect Slack so Claude can search and post.',
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

function parseIcsDate(v) {
  if (!v) return null;
  const val = v.split(':').pop();
  const m = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = m;
  if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  return new Date(+y, +mo - 1, +d, +h, +mi, +s);
}

function parseIcs(text) {
  const events = [];
  const body = unfoldIcs(text);
  const blocks = body.split('BEGIN:VEVENT').slice(1);
  for (const b of blocks) {
    const get = (key) => {
      const m = b.match(new RegExp('^' + key + '(;[^:\\r\\n]*)?:(.*)$', 'm'));
      return m ? (m[1] || '') + ':' + m[2].trim() : null;
    };
    const val = (key) => { const g = get(key); return g ? g.slice(g.indexOf(':') + 1).replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';') : ''; };
    const start = parseIcsDate(get('DTSTART'));
    if (!start) continue;
    const end = parseIcsDate(get('DTEND')) || new Date(start.getTime() + 30 * 60000);
    events.push({ title: val('SUMMARY') || '(no title)', start: start.toISOString(), end: end.toISOString(), location: val('LOCATION'), description: val('DESCRIPTION').slice(0, 400), allDay: !/T/.test(get('DTSTART')) });
  }
  return events;
}

async function fetchIcs(url) {
  const u = url.replace(/^webcal:/i, 'https:');
  let res;
  try { res = await fetch(u, { headers: { 'User-Agent': 'Maestro-Brain' } }); } catch (e) { let host = 'the calendar server'; try { host = new URL(u).host; } catch { /* bad link */ } throw friendly(e, host); }
  if (!res.ok) throw new Error('Calendar link returned HTTP ' + res.status);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('That link did not return an iCalendar file');
  return parseIcs(text);
}

async function slackHistory({ token, channels }) {
  const ids = String(channels || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!token) throw new Error('Slack bot token is missing');
  const auth = await (await fetch('https://slack.com/api/auth.test', { headers: { Authorization: 'Bearer ' + token } })).json();
  if (!auth.ok) throw new Error('Slack: ' + auth.error);
  const out = [];
  for (const ch of ids.slice(0, 5)) {
    const r = await (await fetch(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(ch)}&limit=8`, { headers: { Authorization: 'Bearer ' + token } })).json();
    if (!r.ok) throw new Error(`Slack channel ${ch}: ${r.error}`);
    for (const m of r.messages || []) {
      if (!m.text) continue;
      out.push({ externalId: `slack:${ch}:${m.ts}`, ts: Math.round(parseFloat(m.ts) * 1000), channel: ch, user: m.user || m.username || 'someone', text: m.text });
    }
  }
  return { team: auth.team, messages: out };
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
  const host = { slack: 'slack.com', twilio_sms: 'api.twilio.com', twilio_calls: 'api.twilio.com', whatsapp: 'api.twilio.com' }[id] || (() => { try { return new URL(String(fields.icsUrl || '').replace(/^webcal:/i, 'https:')).host; } catch { return 'the calendar server'; } })();
  try { return await testLiveRaw(id, fields); } catch (e) { throw friendly(e, host); }
}

async function testLiveRaw(id, fields) {
  if (['icalendar', 'gcal', 'outlook'].includes(id)) {
    if (!fields.icsUrl) throw new Error('Paste the calendar link first');
    if (!/^(https?|webcal):\/\//i.test(fields.icsUrl.trim())) throw new Error('The calendar link should start with https:// or webcal://');
    const ev = await fetchIcs(fields.icsUrl);
    return `Calendar connected: ${ev.length} events found`;
  }
  if (id === 'slack') {
    const r = await slackHistory(fields);
    return `Slack workspace "${r.team}" connected: ${r.messages.length} recent messages`;
  }
  if (id === 'twilio_sms') { const r = await twilioList(fields, 'messages'); return `Twilio connected: ${r.length} recent messages`; }
  if (id === 'whatsapp') { const r = (await twilioList(fields, 'messages')).filter((m) => /^whatsapp:/.test(m.from || m.to || '')); return `WhatsApp connected: ${r.length} recent messages`; }
  if (id === 'twilio_calls') { const r = await twilioList(fields, 'calls'); return `Twilio connected: ${r.length} recent calls`; }
  throw new Error('This connector goes live inside Claude Desktop. Use demo mode here.');
}

module.exports = { list, get, fetchIcs, parseIcs, slackHistory, twilioList, testLive };
