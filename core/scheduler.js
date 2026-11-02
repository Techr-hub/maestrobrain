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
  if (/\b(add|create|make|new)\s+(a\s+|an\s+)?(new\s+)?(task|to-?do|note|memory)\b/.test(m)) return false; // "add a task to call John"
  if (/^(what|when|which|how many|do i|did|show|list|tell me about)\b/.test(m) && !/\b(create|add|schedule|book|make|set up)\b/.test(m)) return false; // "what meetings do I have?"
  return /\b(create|schedule|book|set ?up|add|make|put|arrange|plan|organi[sz]e|new|start|insert|block( off| out)?|pencil( in)?)\b[\s\S]{0,40}\b(meeting|event|call|appointment|1:1|one[- ]on[- ]one|catch ?up|sync|lunch|dinner|breakfast|coffee|demo|interview|review|session|standup|calendar (item|entry|event|invite)|item|entry|invite|booking|reservation|block|time)\b/.test(m)
    || /\b(put|add|create|make|schedule|book|pencil)\b[\s\S]{0,60}\b(on|in|to|into) (my|the|our) (\w+ )?(calendar|cal|schedule|diary)\b/.test(m)
    || /\bnew (calendar )?(meeting|event|item|entry|appointment)\b/.test(m)
    || /^(schedule|book|calendar) /.test(m);
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
  return m[1].split(/\s*(?:,|\band\b|&)\s*/i).map((s) => s.trim()).filter((s) => s && !/^(me|us|my team|the team|the whole team|our team|everyone|everybody|the group)$/i.test(s)).map((s) => (s === s.toLowerCase() ? cap(s) : s)).slice(0, 8);
}

function parseTitle(text) {
  const m = text.match(new RegExp(`\\b(?:about|re|regarding|to discuss|called|titled|named|for the|on the)\\s+(.+?)${STOP}`, 'i'));
  if (!m) return '';
  const t = m[1].trim().replace(/^(the|a|an|our|my)\s+/i, '');
  if (parseDate(t.toLowerCase()) || /^(meeting|call|event)$/i.test(t)) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// "at Starbucks on King St", "in the Boardroom", "location is 100 Queen St", "on Zoom"
const VENUE = '(?:restaurant|cafe|café|coffee|bar|pub|bistro|grill|hotel|office|offices|room|park|gym|clinic|hall|centre|center|building|studio|church|school|library|club|arena|stadium|mall|plaza|tower|campus|hq)';
function parseLocation(text) {
  let m = text.match(/\b(?:location|address|venue|place)(?:\s+is|\s+will be|\s*:|\s*-)?\s+(?!is\b)(.+?)(?=,|[.!?](?:\s|$)|$)/i);
  if (m) return m[1].trim();
  m = text.match(/\b(?:at|in)\s+(\d+[A-Za-z]?\s+[A-Z][\w'.-]*(?:\s+(?:[A-Z][\w'.-]*|St|Ave|Rd|Blvd|Dr))*(?:,?\s+(?:Suite|Unit|Floor)\s+\w+)?)/);
  if (m) return m[1].trim(); // "at 100 Queen Street"
  m = text.match(/\b(?:in|at)\s+(the\s+|my\s+|our\s+)?(boardroom|board room|conference room|meeting room|office|lobby|cafeteria|kitchen|break room|my place|your place|home|gym|studio)\b/i);
  if (m) return ((m[1] || '').trim() + ' ' + m[2]).trim().replace(/^\w/, (c) => c.toUpperCase());
  m = text.match(/\bon (zoom|teams|google meet|meet|a call|the phone|facetime)\b/i);
  if (m) return { zoom: 'Zoom', teams: 'Microsoft Teams', 'google meet': 'Google Meet', meet: 'Google Meet', 'a call': 'Phone call', 'the phone': 'Phone call', facetime: 'FaceTime' }[m[1].toLowerCase()];
  m = text.match(new RegExp(`\\b(?:at|in)\\s+((?:the\\s+)?[A-Z][\\w'&.-]*(?:\\s+(?:[A-Z][\\w'&.-]*|on|of|and|&|St|Ave|Rd)){0,6}(?:\\s+${VENUE}\\b)?)`));
  if (m && !/^(Google|Outlook|Apple|iCloud|Mac|Maestro)\b/.test(m[1]) && !/^(the )?(morning|afternoon|evening|night|noon|midnight|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(m[1])) return m[1].trim();
  return '';
}

function kindOf(m) { if (/\b(calendar )?(item|entry|invite|booking)\b/.test(m) && !/\b(call|lunch|dinner|breakfast|coffee|demo|interview|review|sync|standup|appointment)\b/.test(m)) return 'event'; const x = m.match(/\b(call|lunch|dinner|breakfast|coffee|demo|interview|review|sync|1:1|one[- ]on[- ]one|catch ?up|standup|appointment|party)\b/) || m.match(/\b(event|meeting)\b/); return x ? x[1].replace(/one[- ]on[- ]one/, '1:1').replace(/catch ?up/, 'catch-up') : 'meeting'; }

// "description: discuss the deal", "notes: bring the projector", "the description is weekly planning",
// "… to review the contract". Returns { notes, rest } where rest is the text without the notes.
function parseNotes(text) {
  let m = text.match(/(?:,\s*|\.\s*|\s)(?:and\s+)?(?:the\s+|with\s+(?:the\s+|a\s+)?)?(?:description|notes?|details|agenda)(?:\s+(?:is|are|says?|should say|will be)|\s*:|\s*-)?\s+(?!(?:is|are)\b)(.+?)(?=,\s*(?:in|on|to|at|location|address|for)\s|[.!?](?:\s|$)|$)/i);
  if (m) return { notes: m[1].trim().replace(/^(to |that )/i, '').replace(/^\w/, (c) => c.toUpperCase()).replace(/[.!?]+$/, ''), rest: text.replace(m[0], ' ') };
  m = text.match(/\bto (discuss|review|celebrate|talk about|talk through|go over|go through|plan|catch up on|prepare for|prep for|sign|finali[sz]e|brainstorm|kick off|present)\s+(.+?)(?=,\s*(?:in|on|at|location|for)\s|[.!?](?:\s|$)|$)/i);
  if (m) return { notes: `${m[1]} ${m[2]}`.trim().replace(/^\w/, (c) => c.toUpperCase()), rest: text.replace(m[0], ' '), purpose: true };
  return { notes: '', rest: text };
}
// "book a dentist appointment" -> "Dentist appointment"
function titleFromNoun(m) {
  const x = m.match(/\b(?:a|an|my|our)\s+((?!new\b|quick\b|short\b|calendar\b|the\b|recurring\b)[a-z]+(?:\s(?!new\b)[a-z]+)?)\s+(appointment|session|party|review|lesson|class|checkup|check-up|consultation|sync|standup|meeting|call|lunch|dinner|breakfast|coffee|interview|demo|workshop)\b/);
  return x ? `${x[1]} ${x[2]}`.replace(/^\w/, (c) => c.toUpperCase()) : '';
}

// Pull every slot we can from one message.
function extract(text, now) {
  const n = parseNotes(text);
  const out = {};
  if (n.notes) out.notes = n.notes;
  text = n.rest; // the description can't also be read as a place, guests or a title
  const m = text.toLowerCase();
  const date = parseDate(m, now); if (date) out.date = date.getTime();
  const time = parseTime(m); if (time != null) out.time = time;
  // only read a length when the sentence states one ("for 45 minutes", "an hour", "half an hour")
  const lengthy = m.replace(/\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)/g, ' ').replace(/\b(at|around|by)\s+\d{1,2}(:\d{2})?\b/g, ' ');
  if (/\b\d+(\.\d+)?\s*(minutes?|mins?|hours?|hrs?)\b|\b(half an hour|half hour|an hour|one hour|hour and a half|quarter of an hour)\b/.test(lengthy)) { const dur = parseDuration(lengthy); if (dur) out.minutes = dur; }
  const who = parseAttendees(text); if (who.length) out.attendees = who;
  const title = parseTitle(text) || titleFromNoun(m); if (title) out.title = title;
  const place = parseLocation(text); if (place) out.location = place;
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
  if (s.title == null) return { slot: 'title', q: `What should I call it? Say "skip" and I'll call it "${defaultTitle(s)}".` };
  if (s.location == null) return { slot: 'location', q: 'Where is it? An address, a room or a video link, or say "skip".' };
  if (s.notes == null) return { slot: 'notes', q: 'Any description or notes to add? Or say "skip".' };
  if (!s.target && targets.length > 1) return { slot: 'target', q: `Which calendar should I add it to: ${targets.map((t, i) => `${i + 1}) ${t.pending || t.id === 'maestro' ? t.name : `${t.name} (${t.via})`}`).join(', ')}?` };
  return null;
}

function answer(slot, text, s, targets, now) {
  const m = text.toLowerCase().replace(/[.!?]+$/, '').trim();
  const more = extract(text, now); // people often answer with more than was asked
  // free-text answers (a title, a place, notes) can still carry a date or time, but not a length or guests
  const keys = ['title', 'location', 'notes'].includes(slot) ? ['date', 'time'] : ['date', 'time', 'minutes', 'attendees'];
  for (const k of keys) if (more[k] != null && s[k] == null) s[k] = more[k];
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
  const skip = /^(skip|no|nope|nothing|none|n\/a|no thanks|not needed|nah|that'?s it|that'?s all|leave it( blank)?|blank|no location|no description|no notes)\b/.test(m);
  if (slot === 'location' && s.location == null) s.location = skip ? '' : parseLocation(text.replace(/^\s*(it'?s |it is )/i, '').replace(/^\s*(at|in)\s+(\w)/i, (x, p, c) => `${p} ${c.toUpperCase()}`)) || text.trim().replace(/^(it'?s |it is |at |in |on |the location is |location is )/i, '').replace(/^\w/, (c) => c.toUpperCase()).replace(/[.!?]+$/, '');
  if (slot === 'notes' && s.notes == null) s.notes = skip ? '' : text.trim().replace(/^(add |notes?:? |description:? |it'?s |say |that )/i, '').replace(/^\w/, (c) => c.toUpperCase());
  if (slot === 'title' && s.title == null) s.title = /^(skip|no|nope|nothing|none|no title|that'?s fine|fine|default|just that|keep it)\b/.test(m) ? '' : text.trim().replace(/^(it'?s |it is |about |re |regarding )/i, '').replace(/[.!?]+$/, '').replace(/^\w/, (c) => c.toUpperCase());
  if (slot === 'target' && !s.target) {
    const n = Number((m.match(/\b(\d)\b/) || [])[1] || { first: 1, second: 2, third: 3, fourth: 4 }[(m.match(/\b(first|second|third|fourth)\b/) || [])[1]] || 0);
    const ALIAS = { icalendar: /\b(mac|apple|icloud|ical|icalendar|iphone)\b/, gcal: /\b(google|gmail|gcal)\b/, outlook: /\b(outlook|microsoft|office|365|exchange)\b/ };
    const hit = n ? targets[n - 1] : targets.find((t) => m.includes(t.name.toLowerCase()) && !t.pending)
      || targets.find((t) => t.id === 'maestro' ? /\b(maestro|mistro|maestra|its own|your own|local)\b/.test(m) : t.connector && ALIAS[t.connector] && ALIAS[t.connector].test(m))
      || targets.find((t) => m.includes(t.name.toLowerCase()));
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
  const r = await events.create({ title, start, end, attendees: s.attendees, location: s.location || '', notes: s.notes || '' }, { profile, target });
  // heads-up on clashes
  let clash = '';
  try {
    const day = (await calendar.list({ profile, days: 14 })).filter((e) => e.uid !== r.event.uid && new Date(e.start) < end && new Date(e.end) > start);
    if (day.length) clash = ` Heads up, ${name}: it overlaps "${day[0].title}" at ${fmtTime(day[0].start)}.`;
  } catch { /* calendar read is best-effort */ }
  const failed = r.warning && !t.pending;
  const where = failed ? 'your calendar' : t.id === 'maestro' ? 'your Maestro calendar' : t.pending ? `your ${t.name}` : `your "${t.name}" calendar (${t.via})`;
  const line = `Creating "${title}" for ${fmtDay(start)}, ${fmtTime(start)} to ${fmtTime(end)}${s.attendees && s.attendees.length ? `, with ${s.attendees.join(' and ')}` : ''}${s.location ? `, at ${s.location}` : ''}, in ${where}.`;
  return { reply: `${line} ${failed ? r.warning : "Done, it's on your calendar."}${clash}${!failed && r.warning ? `\n\n_${r.warning}_` : ''}`, event: r.event };
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
    if (s.location === undefined) s.location = null;
    if (s.notes === undefined) s.notes = null;
    if (targets.length === 1) s.target = targets[0].id;
    const cal = text.match(/\b(google|gmail|outlook|microsoft|office 365|icloud|apple|mac|ical|maestro)\s+cal(?:endar)?\b/i);
    if (cal && !s.target) answer('target', cal[0], s, targets, now);
    // Everything said up front (day, time and a place, description or name): don't ask about the rest,
    // just use sensible defaults (Ryan, 2026-11-02). A bare "meeting tomorrow at 2" still gets the questions.
    if (s.date && s.time != null && (s.location || s.notes || s.title)) {
      s.minutes = s.minutes || 30;
      if (s.title == null) s.title = '';
      if (s.location == null) s.location = '';
      if (s.notes == null) s.notes = '';
    }
  } else {
    const before = JSON.stringify(s);
    answer(s.ask, text, s, targets, now);
    // they asked something else instead of answering: drop the draft and let the brain answer
    if (JSON.stringify(s) === before && /\?$|^(what|when|who|where|why|how|did|do|does|is|are|can|could|brief|summari[sz]e)\b/i.test(text.trim()) && !['title', 'location', 'notes'].includes(s.ask)) { conv.pending = null; return null; }
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

module.exports = { handle, wantsEvent, extract, parseLocation, parseDate, parseTime, parseDuration, parseAttendees };
