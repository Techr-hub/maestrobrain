// Two-way calendar sync (Ryan, 2026-11-06): "all calendars need to be editable in Maestro, and update the original
// calendars". Google Calendar and Outlook / Microsoft 365 are read and written through their own APIs after you sign
// in once on the calendar's card:
// - Google: "Sign in with Google" opens Google's consent page; Google sends you back to Maestro on this computer
//   (a loopback redirect, so no server is needed). Uses the Google Calendar API.
// - Microsoft: "Sign in with Microsoft" shows a short code to type at microsoft.com/devicelogin. Uses Microsoft Graph.
// Each needs an OAuth app (a client ID) made once by whoever ships the kit; see docs/CALENDAR-SYNC.md.
// Sign-in tokens are stored in data/config.json on this computer only, and never sent to the browser.
const crypto = require('crypto');
const config = require('./config');

const PROVIDER = { gcal: 'google', outlook: 'microsoft' };
const SOURCE = { google: 'gcal', microsoft: 'outlook' };
const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/calendar';
const MS_SCOPE = 'offline_access User.Read Calendars.ReadWrite';
const MS_TENANT = 'common';

// ---------------------------------------------------------------- app settings (client IDs)
function appOf(provider, cfg = config.load()) {
  const o = (cfg.oauth && cfg.oauth[provider]) || {};
  const env = provider === 'google' ? { clientId: process.env.MAESTRO_GOOGLE_CLIENT_ID, clientSecret: process.env.MAESTRO_GOOGLE_CLIENT_SECRET } : { clientId: process.env.MAESTRO_MS_CLIENT_ID };
  return { clientId: o.clientId || env.clientId || '', clientSecret: o.clientSecret || env.clientSecret || '' };
}
function setApp(provider, { clientId, clientSecret } = {}) {
  if (!clientId && !clientSecret) return;
  config.update((c) => {
    c.oauth = c.oauth || {};
    const cur = c.oauth[provider] || {};
    c.oauth[provider] = { ...cur, ...(clientId ? { clientId: String(clientId).trim() } : {}), ...(clientSecret && !String(clientSecret).startsWith('••') ? { clientSecret: String(clientSecret).trim() } : {}) };
  });
}

function connOf(profile, source, cfg = config.load()) { return ((cfg.connections || {})[profile] || {})[source] || null; }
function signedIn(conn) { return !!(conn && conn.oauth && conn.oauth.refresh); }
function saveTokens(profile, source, tok) {
  config.update((c) => {
    c.connections[profile] = c.connections[profile] || {};
    const prev = c.connections[profile][source] || {};
    c.connections[profile][source] = { ...prev, mode: 'live', connectedAt: prev.connectedAt || Date.now(), fields: prev.fields || {}, oauth: { ...(prev.oauth || {}), ...tok }, message: `Signed in${tok.email ? ' as ' + tok.email : ''}: two-way sync on` };
    delete c.connections[profile][source].lastError;
  });
}
function signOut(profile, source) {
  config.update((c) => { const k = (c.connections[profile] || {})[source]; if (k) { delete k.oauth; if (!(k.fields && k.fields.icsUrls && k.fields.icsUrls.length)) delete c.connections[profile][source]; } });
  forget();
}

async function post(url, form) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, j };
}
const jwtEmail = (t) => { try { const p = JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString()); return p.email || p.preferred_username || ''; } catch { return ''; } };

// ---------------------------------------------------------------- Google sign-in (loopback + PKCE)
const pending = new Map(); // state -> { profile, verifier, redirect, at }
function googleStart(profile, redirect) {
  const app = appOf('google');
  if (!app.clientId) throw new Error('Add the Google OAuth client ID first (see the setup steps on this card).');
  const state = crypto.randomBytes(16).toString('hex');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  pending.set(state, { profile, verifier, redirect, at: Date.now() });
  for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60000) pending.delete(k);
  const q = new URLSearchParams({ client_id: app.clientId, redirect_uri: redirect, response_type: 'code', scope: GOOGLE_SCOPE, access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}
async function googleCallback(params) {
  const st = pending.get(params.get('state'));
  if (!st) throw new Error('That sign-in link expired. Start again from the Google Calendar card.');
  pending.delete(params.get('state'));
  if (params.get('error')) throw new Error(`Google said: ${params.get('error')}`);
  const app = appOf('google');
  const r = await post('https://oauth2.googleapis.com/token', { code: params.get('code'), client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: st.redirect, grant_type: 'authorization_code', code_verifier: st.verifier });
  if (!r.ok) throw new Error(`Google sign-in failed: ${r.j.error_description || r.j.error || 'HTTP ' + r.status}`);
  const email = jwtEmail(r.j.id_token);
  saveTokens(st.profile, 'gcal', { provider: 'google', refresh: r.j.refresh_token, access: r.j.access_token, expires: Date.now() + (r.j.expires_in - 60) * 1000, email });
  forget();
  return { profile: st.profile, email };
}

// ---------------------------------------------------------------- Microsoft sign-in (device code)
const devices = new Map(); // profile -> { code, url, message, status, error, email }
async function microsoftStart(profile) {
  const app = appOf('microsoft');
  if (!app.clientId) throw new Error('Add the Microsoft application (client) ID first (see the setup steps on this card).');
  const r = await post(`https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/devicecode`, { client_id: app.clientId, scope: MS_SCOPE });
  if (!r.ok) throw new Error(`Microsoft sign-in failed: ${r.j.error_description || r.j.error || 'HTTP ' + r.status}`);
  const d = { code: r.j.user_code, url: r.j.verification_uri, status: 'waiting', expires: Date.now() + r.j.expires_in * 1000 };
  devices.set(profile, d);
  (async () => {
    let wait = (r.j.interval || 5) * 1000;
    while (Date.now() < d.expires && devices.get(profile) === d) {
      await new Promise((ok) => setTimeout(ok, wait));
      const t = await post(`https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: app.clientId, device_code: r.j.device_code }).catch((e) => ({ j: { error: e.message } }));
      if (t.ok) {
        const email = jwtEmail(t.j.id_token) || jwtEmail(t.j.access_token);
        saveTokens(profile, 'outlook', { provider: 'microsoft', refresh: t.j.refresh_token, access: t.j.access_token, expires: Date.now() + (t.j.expires_in - 60) * 1000, email });
        d.status = 'done'; d.email = email; forget(); return;
      }
      if (t.j.error === 'slow_down') wait += 5000;
      else if (t.j.error !== 'authorization_pending') { d.status = 'error'; d.error = t.j.error_description || t.j.error; return; }
    }
    if (d.status === 'waiting') { d.status = 'error'; d.error = 'The code expired. Start again.'; }
  })();
  return { code: d.code, url: d.url };
}
function status(profile, source) {
  const conn = connOf(profile, source);
  const d = source === 'outlook' ? devices.get(profile) : null;
  return { signedIn: signedIn(conn), email: conn && conn.oauth ? conn.oauth.email || '' : '', device: d ? { code: d.code, url: d.url, status: d.status, error: d.error } : null, hasApp: !!appOf(PROVIDER[source]).clientId };
}

// ---------------------------------------------------------------- tokens
async function accessToken(profile, source) {
  const conn = connOf(profile, source);
  if (!signedIn(conn)) throw new Error('Not signed in');
  const o = conn.oauth;
  if (o.access && o.expires > Date.now()) return o.access;
  const provider = PROVIDER[source];
  const app = appOf(provider);
  const r = provider === 'google'
    ? await post('https://oauth2.googleapis.com/token', { client_id: app.clientId, client_secret: app.clientSecret, refresh_token: o.refresh, grant_type: 'refresh_token' })
    : await post(`https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`, { client_id: app.clientId, refresh_token: o.refresh, grant_type: 'refresh_token', scope: MS_SCOPE });
  if (!r.ok) {
    const msg = `${provider === 'google' ? 'Google' : 'Microsoft'} sign-in expired. Sign in again on the card.`;
    config.update((c) => { const k = (c.connections[profile] || {})[source]; if (k) k.lastError = msg; });
    throw new Error(msg);
  }
  const tok = { access: r.j.access_token, expires: Date.now() + (r.j.expires_in - 60) * 1000, ...(r.j.refresh_token ? { refresh: r.j.refresh_token } : {}) };
  saveTokens(profile, source, tok);
  return tok.access;
}
async function api(profile, source, method, url, body) {
  const token = await accessToken(profile, source);
  const headers = { Authorization: `Bearer ${token}` };
  if (source === 'outlook') headers.Prefer = 'outlook.timezone="UTC", outlook.body-content-type="text"';
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204 || (method === 'DELETE' && (res.ok || res.status === 404 || res.status === 410))) return null;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j.error && (j.error.message || j.error)) || `HTTP ${res.status}`);
  return j;
}

// ---------------------------------------------------------------- reading
const cache = new Map(); // profile|source -> { at, events, calendars }
function forget() { cache.clear(); }
const iso = (d) => new Date(d).toISOString();

async function googleCalendars(profile) {
  const j = await api(profile, 'gcal', 'GET', 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=250');
  return (j.items || []).filter((c) => !c.hidden && c.selected !== false || c.primary).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, writable: ['owner', 'writer'].includes(c.accessRole), primary: !!c.primary }));
}
async function googleEvents(profile, from, to) {
  const out = [];
  const cals = await googleCalendars(profile);
  for (const cal of cals) {
    let page = '';
    do {
      const q = new URLSearchParams({ timeMin: iso(from), timeMax: iso(to), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', ...(page ? { pageToken: page } : {}) });
      const j = await api(profile, 'gcal', 'GET', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${q}`);
      for (const e of j.items || []) {
        if (e.status === 'cancelled') continue;
        const allDay = !!(e.start && e.start.date);
        out.push({
          uid: e.id, title: e.summary || '(No title)', allDay,
          start: allDay ? new Date(e.start.date + 'T00:00').toISOString() : iso(e.start.dateTime),
          end: allDay ? new Date(e.end.date + 'T00:00').toISOString() : iso(e.end.dateTime),
          location: e.location || '', description: e.description || '', url: e.htmlLink || '',
          attendees: (e.attendees || []).filter((a) => !a.self).map((a) => a.displayName || a.email),
          recurring: !!e.recurringEventId, seriesId: e.recurringEventId || '',
          calendarId: cal.id, calendarName: cal.name, writable: cal.writable, provider: 'google',
          alarms: ((e.reminders && e.reminders.overrides) || []).map((r) => ({ minutes: r.minutes })),
        });
      }
      page = j.nextPageToken || '';
    } while (page);
  }
  return { events: out, calendars: cals };
}
async function msCalendars(profile) {
  const j = await api(profile, 'outlook', 'GET', 'https://graph.microsoft.com/v1.0/me/calendars?$top=100&$select=id,name,canEdit,isDefaultCalendar');
  return (j.value || []).map((c) => ({ id: c.id, name: c.name, writable: !!c.canEdit, primary: !!c.isDefaultCalendar }));
}
async function msEvents(profile, from, to) {
  const out = [];
  const cals = await msCalendars(profile);
  const utc = (s) => (s ? new Date(/Z$|[+-]\d\d:\d\d$/.test(s) ? s : s + 'Z').toISOString() : '');
  for (const cal of cals) {
    let url = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(cal.id)}/calendarView?${new URLSearchParams({ startDateTime: iso(from), endDateTime: iso(to), $top: '500', $select: 'id,subject,start,end,isAllDay,location,body,attendees,type,seriesMasterId,webLink,isCancelled,reminderMinutesBeforeStart,isReminderOn' })}`;
    while (url) {
      const j = await api(profile, 'outlook', 'GET', url);
      for (const e of j.value || []) {
        if (e.isCancelled) continue;
        out.push({
          uid: e.id, title: e.subject || '(No title)', allDay: !!e.isAllDay, start: utc(e.start && e.start.dateTime), end: utc(e.end && e.end.dateTime),
          location: (e.location && e.location.displayName) || '', description: String((e.body && e.body.content) || '').trim(), url: e.webLink || '',
          attendees: (e.attendees || []).map((a) => (a.emailAddress && (a.emailAddress.name || a.emailAddress.address)) || '').filter(Boolean),
          recurring: e.type === 'occurrence' || e.type === 'exception', seriesId: e.seriesMasterId || '',
          calendarId: cal.id, calendarName: cal.name, writable: cal.writable, provider: 'microsoft',
          alarms: e.isReminderOn ? [{ minutes: e.reminderMinutesBeforeStart }] : [],
        });
      }
      url = j['@odata.nextLink'] || '';
    }
  }
  return { events: out, calendars: cals };
}

// Events from one signed-in calendar account, cached for a minute (the watcher and every page read share it).
async function events(profile, source, { force = false } = {}) {
  const key = `${profile}|${source}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < 60000) return hit.events;
  const from = new Date(Date.now() - 31 * 86400000), to = new Date(Date.now() + 185 * 86400000);
  try {
    const r = source === 'gcal' ? await googleEvents(profile, from, to) : await msEvents(profile, from, to);
    cache.set(key, { at: Date.now(), events: r.events, calendars: r.calendars });
    const conn = connOf(profile, source);
    if (conn && conn.lastError) config.update((c) => { const k = (c.connections[profile] || {})[source]; if (k) delete k.lastError; });
    return r.events;
  } catch (e) {
    config.update((c) => { const k = (c.connections[profile] || {})[source]; if (k) k.lastError = e.message; });
    if (hit) return hit.events;
    throw e;
  }
}
async function calendars(profile, source) {
  const key = `${profile}|${source}`;
  if (!cache.get(key)) await events(profile, source);
  return (cache.get(key) || {}).calendars || [];
}

// ---------------------------------------------------------------- writing
const gUrl = (cal, id) => `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events${id ? '/' + encodeURIComponent(id) : ''}`;
const day = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
function googleBody(f, allDay) {
  return { summary: f.title, location: f.location || '', description: f.description || '',
    start: allDay ? { date: day(f.start) } : { dateTime: iso(f.start) }, end: allDay ? { date: day(f.end) } : { dateTime: iso(f.end) } };
}
function msBody(f, allDay) {
  const t = (d) => (allDay ? `${day(d)}T00:00:00` : iso(d).replace(/Z$/, ''));
  return { subject: f.title, location: { displayName: f.location || '' }, body: { contentType: 'text', content: f.description || '' },
    isAllDay: !!allDay, start: { dateTime: t(f.start), timeZone: 'UTC' }, end: { dateTime: t(f.end), timeZone: 'UTC' } };
}

// Change an event in its own calendar. One date of a repeating event changes just that date.
async function update(profile, e, f) {
  if (e.writable === false) throw new Error(`You can only view "${e.calendarName}", so it can't be changed from Maestro.`);
  if (e.provider === 'google') await api(profile, 'gcal', 'PATCH', `${gUrl(e.calendarId, e.uid)}?sendUpdates=all`, googleBody(f, e.allDay));
  else await api(profile, 'outlook', 'PATCH', `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(e.uid)}`, msBody(f, e.allDay));
  forget();
}
async function remove(profile, e, { series = false } = {}) {
  if (e.writable === false) throw new Error(`You can only view "${e.calendarName}", so it can't be deleted from Maestro.`);
  const id = series && e.seriesId ? e.seriesId : e.uid;
  if (e.provider === 'google') await api(profile, 'gcal', 'DELETE', `${gUrl(e.calendarId, id)}?sendUpdates=all`);
  else await api(profile, 'outlook', 'DELETE', `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(id)}`);
  forget();
}
async function create(profile, source, calendarId, f) {
  let id = '';
  const body = { ...f, description: f.description || '' };
  if (source === 'gcal') {
    const g = googleBody(body, false);
    if (f.attendees && f.attendees.length) g.attendees = f.attendees.filter((a) => /@/.test(a)).map((email) => ({ email }));
    id = (await api(profile, 'gcal', 'POST', `${gUrl(calendarId)}?sendUpdates=all`, g)).id;
  } else {
    const m = msBody(body, false);
    if (f.attendees && f.attendees.length) m.attendees = f.attendees.filter((a) => /@/.test(a)).map((address) => ({ emailAddress: { address }, type: 'required' }));
    id = (await api(profile, 'outlook', 'POST', `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events`, m)).id;
  }
  forget();
  return id;
}

module.exports = { PROVIDER, SOURCE, appOf, setApp, signedIn, signOut, googleStart, googleCallback, microsoftStart, status, events, calendars, update, remove, create, forget, googleBody, msBody };
