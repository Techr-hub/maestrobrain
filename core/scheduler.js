// "Hey Maestro, create a new meeting for tomorrow at 2pm with John."
// Understands the request, asks only for what is missing (one short question at a time),
// then says where it is creating the event and creates it. Works with every AI engine,
// because it runs before the model is asked.
const events = require('./events');
const calendar = require('./calendar');

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, 'forty five': 45, 'forty-five': 45, ninety: 90 };

const STOP = '(?=\\s+(?:at|on|for|about|to|tomorrow|today|tonight|next|this|from|in|re|regarding|called|titled|around|by)\\b|[,.?!]|$)';

function wantsEvent(text) {
  const m = text.toLowerCase();
  return /\b(create|schedule|book|set ?up|add|make|put|arrange|plan|organi[sz]e|new)\b[\s\S]{0,40}\b(meeting|event|call|appointment|1:1|one[- ]on[- ]one|catch ?up|sync|lunch|coffee|demo|interview|review|session|standup)\b/.test(m)
    || /\b(put|add) (it |something |that )?(on|in|to) my calendar\b/.test(m)
    || /^(schedule|book) /.test(m);
}

function parseDate(m, now = new Date()) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  if (/\bday after tomorrow\b/.test(m)) { d.setDate(d.getDate() + 2); return d; }
  if (/\btomorrow\b/.test(m)) { d.setDate(d.getDate() + 1); return d; }
  if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(m)) return d;
  let x = m.match(/\bin (\d+|a|one|two|three) (day|days|week|weeks)\b/);
  if (x) { const n = x[1] === 'a' ? 1 : NUM[x[1]] || Number(x[1]); d.setDate(d.getDate() + n * (/week/.test(x[2]) ? 7 : 1)); return d; }
  x = m.match(/\b(next|this|on|coming)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (x) {
    const want = WEEKDAYS.indexOf(x[2]);
    let add = (want - d.getDay() + 7) % 7;
    if (add === 0) add = 7;
    d.setDate(d.getDate() + add); return d;
  }
  x = m.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?\b/) || m.match(/\b(\d{1,2})(?:st|nd|rd|th)? (?:of )?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/);
  if (x) {
    const [mon, day] = /\d/.test(x[1]) ? [x[2], x[1]] : [x[1], x[2]];
    d.setMonth(MONTHS.indexOf(mon.slice(0, 3)), Number(day));
    if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  x = m.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (x) return new Date(+x[1], +x[2] - 1, +x[3]);
  x = m.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (x) { d.setMonth(+x[1] - 1, +x[2]); if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d.setFullYear(d.getFullYear() + 1); return d; }
  return null;
}

// Minutes after midnight, or null.
function parseTime(m) {
  if (/\bnoon\b|\bmidday\b/.test(m)) return 12 * 60;
  if (/\bmidnight\b/.test(m)) return 0;
  let x = m.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=\W|$)/);
  if (x) { let h = Number(x[1]) % 12; if (/p/.test(x[3])) h += 12; return h * 60 + Number(x[2] || 0); }
  x = m.match(/\b(\d{1,2}):(\d{2})\b/);
  if (x) { let h = Number(x[1]); if (h < 8) h += 12; return h * 60 + Number(x[2]); }
  x = m.match(/\b(?:at|around|by|for)\s+(\d{1,2})(?:\s*o'?clock)?(?!\s*(?:min|minutes|hours?|hrs?|days?|people|of))\b/);
  if (x) { let h = Number(x[1]); if (h >= 1 && h <= 7) h += 12; return h * 60; }
  x = m.match(/\b(?:at|around)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/);
  if (x) { let h = NUM[x[1]]; if (h <= 7) h += 12; return h * 60; }
  if (/\bhalf past (\d{1,2})\b/.test(m)) { let h = Number(m.match(/\bhalf past (\d{1,2})\b/)[1]); if (h <= 7) h += 12; return h * 60 + 30; }
  return null;
}

function parseDuration(m) {
  let x = m.match(/\b(\d+(?:\.\d+)?)\s*(minutes?|mins?|m)\b/);
  if (x) return Math.round(Number(x[1]));
  x = m.match(/\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b/);
  if (x) return Math.round(Number(x[1]) * 60);
  if (/\b(half an hour|half hour|30)\b/.test(m)) return 30;
  if (/\b(an hour and a half|hour and a half|90)\b/.test(m)) return 90;
  if (/\b(quarter of an hour|quarter hour|15)\b/.test(m)) return 15;
  if (/\b(an|one) hour\b|\bhour\b/.test(m)) return 60;
  if (/\b(two|2) hours\b/.test(m)) return 120;
  x = m.match(/\b(fifteen|twenty|thirty|forty five|forty-five|ninety)\b/);
  if (x) return NUM[x[1]];
  return null;
}

function cap(s) { return s.replace(/\b\w/g, (c) => c.toUpperCase()); }

function parseAttendees(text) {
  const m = text.match(new RegExp(`\\bwith\\s+(.+?)${STOP}`, 'i'));
  if (!m) return [];
  return m[1].split(/\s*(?:,|\band\b|&)\s*/i).map((s) => s.trim()).filter((s) => s && !/^(me|my team|the team|everyone)$/i.test(s)).map((s) => (s === s.toLowerCase() ? cap(s) : s)).slice(0, 8);
}

function parseTitle(text) {
  const m = text.match(new RegExp(`\\b(?:about|re|regarding|to discuss|called|titled|named|for the|on the)\\s+(.+?)${STOP}`, 'i'));
  if (!m) return '';
  const t = m[1].trim().replace(/^(the|a|an|our|my)\s+/i, '');
  if (parseDate(t.toLowerCase()) || /^(meeting|call|event)$/i.test(t)) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function kindOf(m) { const x = m.match(/\b(call|lunch|coffee|demo|interview|review|sync|1:1|one[- ]on[- ]one|catch ?up|standup|appointment|event|meeting)\b/); return x ? x[1].replace(/one[- ]on[- ]one/, '1:1').replace(/catch ?up/, 'catch-up') : 'meeting'; }

// Pull every slot we can from one message.
function extract(text, now) {
  const m = text.toLowerCase();
  const out = {};
  const date = parseDate(m, now); if (date) out.date = date.getTime();
  const time = parseTime(m); if (time != null) out.time = time;
  // only read a length when the sentence states one ("for 45 minutes", "an hour", "half an hour")
  const lengthy = m.replace(/\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)/g, ' ').replace(/\b(at|around|by)\s+\d{1,2}(:\d{2})?\b/g, ' ');
  if (/\b\d+(\.\d+)?\s*(minutes?|mins?|hours?|hrs?)\b|\b(half an hour|half hour|an hour|one hour|hour and a half|quarter of an hour)\b/.test(lengthy)) { const dur = parseDuration(lengthy); if (dur) out.minutes = dur; }
  const who = parseAttendees(text); if (who.length) out.attendees = who;
  const title = parseTitle(text); if (title) out.title = title;
  out.kind = kindOf(m);
  return out;
}

const fmtDay = (ts) => { const d = new Date(ts), t = new Date(); t.setHours(0, 0, 0, 0); const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - t) / 86400000); const label = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }); return diff === 0 ? `today (${label})` : diff === 1 ? `tomorrow (${label})` : label; };
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const defaultTitle = (s) => { const k = s.kind && s.kind !== 'meeting' && s.kind !== 'event' ? s.kind.replace(/^\w/, (c) => c.toUpperCase()) : 'Meeting'; return s.attendees && s.attendees.length ? `${k} with ${s.attendees.join(' & ')}` : k; };

// What to ask next, in order. Returns null when we have everything.
function nextQuestion(s, targets, name) {
  if (!s.date) return { slot: 'date', q: 'What day should I put it on?' };
  if (s.time == null) { const day = fmtDay(s.date).replace(/ \(.*\)/, ''); return { slot: 'time', q: `What time ${/^(today|tomorrow)$/.test(day) ? day : 'on ' + day.split(',')[0]}?` }; }
  if (!s.minutes) return { slot: 'minutes', q: 'How long should it be? 30 minutes?' };
  if (s.title == null && /^(meeting|event)$/.test(s.kind || 'meeting')) return { slot: 'title', q: `What's it about? Say "skip" and I'll call it "${defaultTitle(s)}".` };
  if (!s.target && targets.length > 1) return { slot: 'target', q: `Which calendar: ${targets.map((t, i) => `${i + 1}) ${t.name}${t.via && t.id !== 'maestro' ? ` (${t.via})` : ''}`).join(', ')}?` };
  return null;
}

function answer(slot, text, s, targets, now) {
  const m = text.toLowerCase().replace(/[.!?]+$/, '').trim();
  const more = extract(text, now); // people often answer with more than was asked
  for (const k of ['date', 'time', 'minutes', 'attendees']) if (more[k] != null && s[k] == null) s[k] = more[k];
  if (slot === 'date' && !s.date) { const d = parseDate(m, now); if (d) s.date = d.getTime(); }
  if (slot === 'time' && s.time == null) {
    let t = parseTime(m);
    if (t == null) { const x = m.match(/^(\d{1,2})(?::(\d{2}))?$/); if (x) { let h = Number(x[1]); if (h >= 1 && h <= 7) h += 12; t = h * 60 + Number(x[2] || 0); } }
    if (t != null) s.time = t;
  }
  if (slot === 'minutes' && !s.minutes) {
    const d = parseDuration(m) || (/^(yes|yeah|yep|sure|ok|okay|sounds good|that'?s fine|default|fine|perfect)\b/.test(m) ? 30 : null) || (/^\d+$/.test(m) ? Number(m) : null);
    if (d) s.minutes = d;
  }
  if (slot === 'title' && s.title == null) s.title = /^(skip|no|nope|nothing|none|no title|that'?s fine|fine|default|just that|keep it)\b/.test(m) ? '' : text.trim().replace(/^(it'?s |it is |about |re |regarding )/i, '').replace(/[.!?]+$/, '').replace(/^\w/, (c) => c.toUpperCase());
  if (slot === 'target' && !s.target) {
    const n = Number((m.match(/\b(\d)\b/) || [])[1] || { first: 1, second: 2, third: 3, fourth: 4 }[(m.match(/\b(first|second|third|fourth)\b/) || [])[1]] || 0);
    const hit = n ? targets[n - 1] : targets.find((t) => m.includes(t.name.toLowerCase()) || (t.via && m.includes(t.via.toLowerCase().split(' ')[0])));
    if (hit) s.target = hit.id;
  }
}

function startOf(s) { const d = new Date(s.date); d.setHours(0, 0, 0, 0); return new Date(d.getTime() + s.time * 60000); }

async function finish(s, targets, profile, name) {
  const start = startOf(s);
  const end = new Date(start.getTime() + s.minutes * 60000);
  const title = s.title || defaultTitle(s);
  const target = s.target || targets[0].id;
  const t = targets.find((x) => x.id === target) || targets[0];
  const r = await events.create({ title, start, end, attendees: s.attendees }, { profile, target });
  // heads-up on clashes
  let clash = '';
  try {
    const day = (await calendar.list({ profile, days: 14 })).filter((e) => e.uid !== r.event.uid && new Date(e.start) < end && new Date(e.end) > start);
    if (day.length) clash = ` Heads up, ${name}: it overlaps "${day[0].title}" at ${fmtTime(day[0].start)}.`;
  } catch { /* calendar read is best-effort */ }
  const where = r.warning ? 'your calendar' : t.id === 'maestro' ? 'your Maestro calendar' : `your "${t.name}" calendar (${t.via})`;
  const line = `Creating "${title}" for ${fmtDay(start)}, ${fmtTime(start)} to ${fmtTime(end)}${s.attendees && s.attendees.length ? `, with ${s.attendees.join(' and ')}` : ''}, in ${where}.`;
  return { reply: `${line} ${r.warning ? r.warning : "Done, it's on your calendar."}${clash}`, event: r.event };
}

// Called for every chat message. Returns null when this isn't about creating an event.
async function handle(text, conv, { profile, name }) {
  const now = new Date();
  const m = text.toLowerCase().trim();
  let s = conv.pending && conv.pending.type === 'event' ? conv.pending : null;
  if (s && /^(cancel|never ?mind|stop|forget it|no,? cancel|scratch that|don'?t)\b/.test(m)) { conv.pending = null; return { reply: `Cancelled. Your calendar survives another day, ${name}.` }; }
  if (!s && !wantsEvent(text)) return null;
  // A pending question that the user ignored for something unrelated: let the rest of the brain answer.
  if (s && Date.now() - (s.askedAt || 0) > 15 * 60000) { conv.pending = null; if (!wantsEvent(text)) return null; s = null; }
  const { targets, notes } = await events.targets(profile);
  if (!s) {
    s = { ...extract(text, now), type: 'event' };
    if (s.title === undefined) s.title = null;
    if (targets.length === 1) s.target = targets[0].id;
  } else {
    const before = JSON.stringify(s);
    answer(s.ask, text, s, targets, now);
    // they asked something else instead of answering: drop the draft and let the brain answer
    if (JSON.stringify(s) === before && /\?$|^(what|when|who|where|why|how|did|do|does|is|are|can|could|brief|summari[sz]e)\b/i.test(text.trim()) && s.ask !== 'title') { conv.pending = null; return null; }
  }
  const q = nextQuestion(s, targets, name);
  if (q) {
    const repeat = s.ask === q.slot && s.asked;
    s.ask = q.slot; s.asked = true; s.askedAt = Date.now();
    conv.pending = s;
    const hint = repeat ? "Sorry, I didn't catch that. " : '';
    return { reply: hint + q.q, pending: true };
  }
  conv.pending = null;
  const out = await finish(s, targets, profile, name);
  const tip = targets.length === 1 && notes.length ? `\n\n_${notes[0]}_` : '';
  return { reply: out.reply + tip, event: out.event };
}

module.exports = { handle, wantsEvent, extract, parseDate, parseTime, parseDuration, parseAttendees };
