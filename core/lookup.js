// Direct answers to factual questions about your feed and calendar:
//   "When did Alex call me?"  "Did Priya email me?"  "What did Sam text?"  "Who called me?"
//   "When is my meeting with Sarah?"  "Anything from Acme?"
// Used by the offline demo brain, and to give Claude/ChatGPT/Gemini the exact matching items.
const vault = require('./vault');

const STOP = new Set(('when what whats who whom whose where which why how did does do doing has have had is are was were be been ' +
  'the a an to of on in at for from with about and or but me my mine i im you your our us we it its this that these those there ' +
  'last latest recent recently ever today yesterday tonight tomorrow week weekend month time ago any anything something everything ' +
  'tell show find get give please can could would will should maestro jarvis brain hey ok okay just still yet already new next ' +
  'up back out over again much many lot some all one first').split(' '));
const VERB_WORDS = new Set(('whatsapp whatsapped zoom teams meet call called calls calling phone phoned rang ring voicemail voicemails missed ' +
  'text texted texts texting sms message messaged messages msg dm dmed slack slacked ping pinged mention mentioned ' +
  'email emailed emails mail mailed inbox reach reached contact contacted write wrote reply replied respond ' +
  'say said says want wanted wants ask asked asks need needed send sent meet meeting meetings scheduled schedule ' +
  'happen happened talk talked speak spoke hear heard').split(' '));
const CAT_VERBS = [
  ['CALL', /\b(call(ed|s|ing)?|phon(e|ed)|rang|ring|voicemails?|missed)\b/],
  ['SMS', /\b(text(ed|s|ing)?|sms|whats ?app(ed)?)\b/],
  ['EMAIL', /\b(e-?mail(ed|s)?|mail(ed)?|inbox)\b/],
  ['CONVERSATION', /\b(slack(ed)?|dm(ed)?|ping(ed)?|mention(ed)?)\b/],
];
const NOT_NAMES = new Set(['missed', 'new', 'call', 'text', 'from', 'with', 'review', 'sprint', 'project', 'update', 'meeting', 'daily', 'the', 'q3', 'q4', 'pr', 'ci', 'api', 'prd', 'corp', 'inc', 'ltd', 'team', 'dev', 'leadership', 'office', 'dr', 'support', 'tasks', 'task']);

const pad = (n) => String(n).padStart(2, '0');
function tokens(s) { return String(s).toLowerCase().replace(/[’']s\b/g, '').match(/[a-z0-9][a-z0-9.+-]*/g) || []; }
const SYN = { doctor: ['dr', 'doctor'], doc: ['dr'], dentist: ['dentist', 'dental'], mom: ['mom', 'mother', 'mum'], mum: ['mom', 'mum'], dad: ['dad', 'father'], boss: ['manager'] };
function has(text, term) {
  return (SYN[term] || [term]).some((t) => new RegExp(`(^|[^a-z0-9])${t.replace(/[.+-]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(text));
}

function whenText(ts, now = Date.now()) {
  const d = new Date(ts), n = new Date(now);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((new Date(n.toDateString()) - new Date(d.toDateString())) / 86400000);
  const diff = Math.round((now - d.getTime()) / 60000);
  const ad = Math.abs(diff), span = ad < 60 ? `${ad} min` : `${Math.round(ad / 60)} h`;
  const rel = ad < 1 ? 'now' : diff > 0 ? `${span} ago` : `in ${span}`;
  if (days === 0) return `today at ${time} (${rel})`;
  if (days === 1) return `yesterday at ${time}`;
  if (days === -1) return `tomorrow at ${time}`;
  if (days < 0 && days > -7) return `${d.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })} at ${time}`;
}

// Words that name a person or company in your world: People notes, meeting attendees and feed senders.
function knownNames(items, events) {
  const names = new Set();
  const add = (str) => tokens(str).forEach((t) => { if (t.length > 1 && !NOT_NAMES.has(t)) names.add(t); });
  for (const n of vault.loadNotes()) if (n.folder === 'People' && !/index/i.test(n.title)) add(n.title);
  Object.keys(SYN).forEach((k) => names.add(k));
  for (const e of events) (e.attendees || []).forEach(add);
  for (const i of items) {
    const p = personIn(i); if (p) add(p);
    const org = (i.title || '').match(/\(([^)]+)\)/); if (org && !/\d|slack|twilio|min\b/i.test(org[1])) add(org[1]);
  }
  return names;
}

function parse(message) {
  const m = message.toLowerCase().trim();
  const cats = CAT_VERBS.filter(([, re]) => re.test(m)).map(([c]) => c);
  if (/\bmessag(e|ed|es)\b/.test(m) && !cats.length) cats.push('SMS', 'CONVERSATION', 'EMAIL');
  const terms = [...new Set(tokens(m).filter((t) => t.length > 1 && !STOP.has(t) && !VERB_WORDS.has(t)))];
  const question = /\?$/.test(m) || /^(when|who|what|whats|what's|did|does|has|have|was|were|is|are|any|anything|where|which|how|tell me|show me|find)\b/.test(m);
  const past = /\b(did|has|have|was|were|called|texted|emailed|messaged|said|wanted|asked|sent|missed|wrote|pinged|mentioned)\b/.test(m);
  const eventQ = !past && /\b(when('s| is| are| am| do)?|what time|next|upcoming)\b/.test(m) &&
    /\b(meeting|meet|call with|1:1|one on one|sync|review|standup|lunch|dinner|flight|appointment|event|critique|catch ?up)\b/.test(m);
  return { m, cats, terms, question, past, eventQ };
}

function itemText(i) { return `${i.title} ${i.quote || ''} ${i.summary || ''} ${i.sourceName || ''}`; }
function personIn(i) {
  const t = i.title || '';
  const m = t.match(/\b(?:from|with|by)\s+([^(:—\-–,]+?)(?:\s*\(|\s*:|\s*[—–-]|,|$)/i);
  if (m) return m[1].trim();
  const lead = t.match(/^([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s+(mentioned|replied|commented|shared|sent|asked|called|texted|emailed|messaged|flagged)/);
  return lead ? lead[1] : null;
}

// Find feed items and events that answer the question. Returns null when it isn't a lookup question.
function find(message, { items, events, otherItems = [] }) {
  const q = parse(message);
  if (!q.question || /^who (is|are)\b/.test(q.m)) return null;
  const names = knownNames([...items, ...otherItems], events);
  let subject = q.terms.filter((t) => names.has(t));
  // "When did Bob call me?": an unknown name is still the subject, so we can say there is nothing from Bob.
  if (!subject.length && q.cats.length) subject = q.terms.filter((t) => t.length > 2);
  if (!subject.length && !q.cats.length && !q.eventQ) return null;
  const inEvent = (e, t) => has(`${e.title} ${(e.attendees || []).join(' ')}`, t);
  const upcoming = events.filter((e) => new Date(e.end) > Date.now()).sort((a, b) => new Date(a.start) - new Date(b.start));
  const futureQ = !q.past && /\b(when('s| is| are| am| do)?|what time|next|upcoming)\b/.test(q.m);
  const evMatch = subject.length ? upcoming.filter((e) => subject.every((t) => inEvent(e, t))) : [];
  if (q.eventQ || (futureQ && evMatch.length)) {
    const want = subject.length ? subject : q.terms;
    const hit = want.length ? upcoming.filter((e) => want.some((t) => inEvent(e, t))) : [];
    return { kind: 'event', q, subject, events: hit.length || subject.length ? hit : upcoming };
  }
  let pool = items;
  if (q.cats.length) pool = pool.filter((i) => q.cats.includes(i.category));
  const scored = pool.map((i) => {
    const sender = (personIn(i) || '').toLowerCase();
    return { i, s: subject.filter((t) => has(itemText(i), t)).length + subject.filter((t) => has(sender, t)).length * 2 };
  }).filter((x) => !subject.length || x.s > 0)
    .sort((a, b) => b.s - a.s || new Date(b.i.ts) - new Date(a.i.ts));
  const related = subject.length ? upcoming.filter((e) => subject.some((t) => inEvent(e, t))) : [];
  return { kind: 'items', q, subject, items: scored.map((x) => x.i), related };
}

const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function answer(message, ctx, { otherProfileItems = [], profile = 'business' } = {}) {
  const r = find(message, { ...ctx, otherItems: otherProfileItems });
  if (!r) return null;
  const who = r.subject.length ? cap(r.subject.join(' ')) : '';
  const peopleNote = r.subject.length ? vault.loadNotes().find((n) => n.folder === 'People' && r.subject.every((t) => has(n.title, t))) : null;
  const link = peopleNote ? `\n\n_More about them: [[${peopleNote.title}]]_` : '';

  if (r.kind === 'event') {
    if (!r.events.length) return `**I don't see anything${who ? ` with ${who}` : ''} on your calendar in the next 7 days.**`;
    const [e, ...rest] = r.events;
    const mins = Math.round((new Date(e.end) - new Date(e.start)) / 60000);
    return [`**${who ? `Your next meeting with ${who} is` : 'Next up:'} ${e.title}, ${whenText(e.start)} · ${mins} min.**`,
      e.attendees ? `With ${e.attendees.join(', ')}.` : '', e.location ? `Location: ${e.location}.` : '', e.notes ? `Prep notes: [[${e.notes.split('/').pop()}]]` : '',
      rest.length ? '\n**After that**\n' + rest.slice(0, 3).map((x) => `- ${x.title} · ${whenText(x.start)}`).join('\n') : ''].filter(Boolean).join('\n') + link;
  }

  const kind = r.q.cats.length === 1 ? { CALL: 'calls', SMS: 'texts', EMAIL: 'emails', CONVERSATION: 'Slack messages' }[r.q.cats[0]] : 'messages';
  if (!r.items.length) {
    const elsewhere = otherProfileItems.filter((i) => (!r.q.cats.length || r.q.cats.includes(i.category)) && r.subject.every((t) => has(itemText(i), t)));
    const other = profile === 'business' ? 'Personal' : 'Business';
    return `**No ${kind}${who ? ` from ${who}` : ''} in your ${profile} feed.**` +
      (elsewhere.length ? ` There ${elsewhere.length === 1 ? 'is one' : `are ${elsewhere.length}`} in your **${other}** profile: ${elsewhere[0].title}, ${whenText(elsewhere[0].ts)}.` : '') +
      (r.related.length ? `\n\nYou do have **${r.related[0].title}** ${whenText(r.related[0].start)}.` : '') + link;
  }
  const top = r.items[0];
  const person = (peopleNote && has(personIn(top) || '', r.subject[0] || '') ? peopleNote.title : null) || personIn(top) || (peopleNote && peopleNote.title) || who || top.sourceName;
  const missed = /missed/i.test(top.title);
  const via = top.sourceName ? top.sourceName.replace(/ \(.*\)/, '').replace(' / Microsoft 365', '') : '';
  const did = { CALL: top.source === 'twilio_calls' ? 'called you' : `called you on ${via}`, SMS: top.source === 'whatsapp' ? 'messaged you on WhatsApp' : 'texted you', EMAIL: 'emailed you', CONVERSATION: `messaged you on ${via}` }[top.category];
  const lines = [did
    ? `**${person} ${did} ${whenText(top.ts)}${missed ? '. You missed it' : ''}.**`
    : `**${top.title}, ${whenText(top.ts)}.**`];
  if (top.quote) lines.push(`> ${top.quote.replace(/["“”]/g, '')}`);
  const meta = [top.summary, top.priority ? `${top.priority} priority` : '', top.deadline].filter(Boolean).join(' · ');
  if (meta) lines.push(meta);
  if (top.actions && top.actions.length) lines.push(`**Next step:** ${top.actions[0]}`);
  const more = r.items.slice(1, 4);
  if (more.length) lines.push('', `**${who ? `Also from ${who}` : 'Earlier'}**`, ...more.map((i) => `- ${i.title} · ${whenText(i.ts)}`));
  if (r.related.length) lines.push('', `**Coming up:** ${r.related[0].title}, ${whenText(r.related[0].start)}.`);
  return lines.join('\n') + link;
}

// Compact text block of matches for LLM prompts, with absolute times.
function contextBlock(message, ctx) {
  const r = find(message, ctx);
  if (!r) return '';
  const rows = r.kind === 'event'
    ? r.events.slice(0, 6).map((e) => `- EVENT ${e.title} · ${whenText(e.start)} · ${e.attendees ? 'with ' + e.attendees.join(', ') : ''}`)
    : r.items.slice(0, 8).map((i) => `- [${i.category}] ${i.sourceName} · ${whenText(i.ts)} · ${i.title}${i.quote ? ' — ' + i.quote : ''}`);
  return rows.length ? `# EXACT MATCHES FOR THIS QUESTION (answer from these first)\n${rows.join('\n')}` : '# EXACT MATCHES FOR THIS QUESTION\n(none found in the feed or calendar)';
}

module.exports = { find, answer, contextBlock, whenText, parse };
