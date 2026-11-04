// Direct answers to factual questions about your feed and calendar:
//   "When did Alex call me?"  "Did Priya email me?"  "What did Sam text?"  "Who called me?"
//   "When is my meeting with Sarah?"  "Anything from Acme?"
// Used by the offline demo brain, and to give Claude/ChatGPT/Gemini the exact matching items.
const vault = require('./vault');

const STOP = new Set(('when what whats who whom whose where which why how did does do doing has have had is are was were be been ' +
  'the a an to of on in at for from with about and or but me my mine i im you your our us we it its this that these those there ' +
  'last latest recent recently ever today yesterday tonight tomorrow week weekend month time ago any anything something everything ' +
  'tell show find get give please can could would will should maestro brain hey ok okay just still yet already new next ' +
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

// "When is board prep?", "What time is Kids soccer?", "Where is the offsite?": match the words of the question
// against event titles, attendees and locations, best match first, then soonest.
const EVENT_FILLER = new Set(('happening happen happens scheduled schedule event events calendar calender booked planned plan start starts starting ' +
  'begin begins day date held going taking place appointment meeting meetings meet call is are about details detail purpose agenda topic topics summary summarize summarise tell more covering cover covers ticket tickets get buy purchase register registration rsvp sign signup link page find can could where').split(' '));
const stem = (t) => (t.length > 4 ? t.replace(/(ing|es|s)$/, '') : t);
function matchEvents(m, events) {
  const words = tokens(m).filter((t) => t.length > 1 && !STOP.has(t));
  const content = words.filter((t) => !EVENT_FILLER.has(t) && !VERB_WORDS.has(t));
  if (!content.length) return null;
  const scored = events.map((e) => {
    const bag = new Set(tokens(`${e.title} ${(e.attendees || []).join(' ')} ${e.location || ''}`).map(stem));
    const hit = (t) => bag.has(stem(t)) || (SYN[t] || []).some((x) => bag.has(x));
    return { e, s: content.filter(hit).length * 2 + words.filter((t) => EVENT_FILLER.has(t) && hit(t)).length, c: content.filter(hit).length };
  }).filter((x) => x.c > 0);
  if (!scored.length) return null;
  const best = Math.max(...scored.map((x) => x.s));
  const top = scored.filter((x) => x.s === best).map((x) => x.e).sort((a, b) => new Date(a.start) - new Date(b.start));
  const upcoming = top.filter((e) => new Date(e.end) > Date.now());
  const past = top.filter((e) => new Date(e.end) <= Date.now());
  const first = upcoming[0] || past[past.length - 1];
  const inTitle = new Set(tokens(first.title).map(stem));
  return { events: upcoming, past: upcoming.length ? null : past[past.length - 1], want: content, byTitle: content.some((t) => inTitle.has(stem(t))) };
}

// Find feed items and events that answer the question. Returns null when it isn't a lookup question.
// "Where can I get tickets to the Brain Builder workshop?", "How do I register for …?"
const TICKETS = /\b(tickets?|register|registration|rsvp|sign ?up|buy (a )?(seat|spot|pass)|book (a )?(seat|spot)|admission|entry pass)\b/;
const TICKET_SITES = [[/(^|\.)(lu\.ma|luma\.com)$/, 'Luma'], [/eventbrite\./, 'Eventbrite'], [/meetup\.com$/, 'Meetup'], [/ticketmaster\./, 'Ticketmaster'], [/(^|\.)ti\.to$|tito\.io$/, 'Tito'], [/universe\.com$/, 'Universe'], [/tickettailor\.com$/, 'Ticket Tailor'], [/humanitix\.com$/, 'Humanitix'], [/partiful\.com$/, 'Partiful'], [/zoom\.us$/, ''], [/teams\.microsoft\.com$|meet\.google\.com$/, '']];
// Links in an event (description, location and URL), best ticket page first.
// Ryan (2026-11-02): the link written in the description comes first, whatever site it's on; the calendar's own
// URL field and the location are only a fallback.
const NOT_TICKETS = /(^|\.)(google\.[a-z.]+\/maps|maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl|maps\.apple\.com)/;
function ticketLinks(e) {
  const clean = (t) => String(t || '').replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/&amp;/g, '&');
  const inDesc = new Set();
  const grab = (t) => (clean(t).match(/https?:\/\/[^\s<>"')\]]+|\b(?:lu\.ma|luma\.com|www\.eventbrite\.[a-z.]+|eventbrite\.[a-z.]+|meetup\.com)\/[^\s<>"')\]]+/gi) || []).map((u) => (/^https?:/i.test(u) ? u : 'https://' + u).replace(/[.,;:!?]+$/, ''));
  grab([e.description, e.notes].filter(Boolean).join(' ')).forEach((u) => inDesc.add(u));
  const text = [e.description, e.notes, e.url, e.location].filter(Boolean).join(' ');
  const urls = [...new Set((clean(text).match(/https?:\/\/[^\s<>"')\]]+|\b(?:lu\.ma|luma\.com|www\.eventbrite\.[a-z.]+|eventbrite\.[a-z.]+|meetup\.com)\/[^\s<>"')\]]+/gi) || []).map((u) => (/^https?:/i.test(u) ? u : 'https://' + u).replace(/[.,;:!?]+$/, '')))];
  return urls.map((u) => {
    let host = ''; try { host = new URL(u).hostname.replace(/^www\./, ''); } catch { return null; }
    const site = TICKET_SITES.find(([re]) => re.test(host));
    if (site && site[1] === '') return null; // meeting links aren't ticket pages
    if (NOT_TICKETS.test(host + new URL(u).pathname)) return null; // map links aren't ticket pages
    const score = (inDesc.has(u) ? 10 : 0) + (site ? 3 : 0) + (/ticket|register|rsvp|event|tix|book/i.test(u) ? 2 : 0);
    return { url: u, name: site ? site[1] : host, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}
function ticketAnswer(e) {
  const links = ticketLinks(e);
  if (!links.length) return `**I don't see a ticket link in ${e.title}'s details.** Check the invite or the organiser's website.`;
  const best = links[0];
  // Ryan (2026-11-02): "Get your ticket to the event from the Luma event page."
  // Ryan (2026-11-02): just that, plus where the link is. No date line.
  return `**Get your ticket to the event from the [${best.name} event page](${best.url}).** Click the link in the description.`;
}

// "What is board prep about?", "What's the Sprint Review about?", "Tell me about the offsite", "What's on the agenda for …"
// "What is X about?" / "what's on the agenda" keep the short description summary; "tell me about…" gets the intro.
const SUMMARY_Q = /\bwhat('?s| is| was| are)?\b.*\babout\b|agenda|summari[sz]e|what happens at|purpose of/;
const ABOUT = /\b(what('?s| is| was| are)?\b.*\babout\b|tell me (more )?about|details (of|on|for|about)|what('?s| is) (on )?the agenda|summari[sz]e (the |my )?|what happens at|purpose of|what('?s| is) .* for\?)/;

// The event's own description (calendar DESCRIPTION, or the text Maestro saved), else its linked vault note,
// cleaned of meeting-link boilerplate. Returns plain sentences.
function eventDescription(e) {
  let text = e.description || (e.notes && !/^[\w -]+\/[\w .'&-]+$/.test(e.notes) ? e.notes : '');
  if (!text && e.notes) { try { text = vault.readNote(/\.md$/.test(e.notes) ? e.notes : e.notes + '.md').body; } catch { /* no note */ } }
  const lines = String(text || '').replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\;/g, ';').split('\n')
    .filter((l) => !/^\s*(created by maestro|with [^.]*$|join (zoom|microsoft teams|with google meet)|meeting id|passcode|password|dial|one tap|find your local|-+:+~|https?:\/\/\S+$|# |---|tags:|date:|\**attendees:?\**:?)/i.test(l.trim()));
  const clean = (l) => l.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1').replace(/[*_`]/g, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  const out = [];
  let list = [];
  const flush = () => {
    if (!list.length) return;
    const items = list.map((x) => x.replace(/[.;]$/, ''));
    out.push(`${items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0]}.`);
    list = [];
  };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { flush(); continue; }
    if (/^#{2,}\s/.test(l)) { flush(); if (/agenda|topics?|purpose|goal|covering/i.test(l)) out.push('It covers'); continue; }
    if (/^([-*•]|\d+[.)])\s+/.test(l)) { list.push(clean(l.replace(/^([-*•]|\d+[.)])\s+/, ''))); continue; }
    const c = clean(l);
    if (!c || /:\s*$/.test(c)) continue; // a label whose link was removed ("Tickets: https://…")
    flush(); out.push(c);
  }
  flush();
  return out.join(' ').replace(/It covers ([A-Z])/g, (m, c) => `It covers ${c.toLowerCase()}`).replace(/It covers\s*$/, '').trim();
}
function aboutAnswer(e) {
  const when = e.allDay ? whenText(e.start).replace(/ at .*/, '') : whenText(e.start);
  const desc = eventDescription(e);
  const sentences = (desc.match(/[^.!?]+[.!?]*/g) || []).map((s) => s.trim()).filter((s) => s.length > 2);
  if (!sentences.length) {
    const who = e.attendees && e.attendees.length ? ` with ${e.attendees.join(', ')}` : '';
    return `**${e.title}, ${when}, has no description on your calendar.**${who || e.location ? ` It's${who}${e.location ? ` at ${e.location}` : ''}.` : ''}`;
  }
  // At most 2 sentences (Ryan, 2026-11-02): the event and the first line of its description, then one more.
  const trim = (s) => (s.length > 220 ? s.slice(0, 217).replace(/\s+\S*$/, '') + '…' : s);
  const end = (s) => (/[.!?…]$/.test(s) ? s : s + '.');
  const first = end(trim(sentences[0]));
  // Ryan (2026-11-02): two short sentences, then ask what they want to know.
  return `**${e.title}**, ${when}: ${first.charAt(0).toUpperCase() + first.slice(1)}${sentences[1] ? ' ' + end(trim(sentences[1])) : ''}\n\nWhat would you like to know specifically?`;
}

// "Tell me about this event" (Ryan, 2026-11-02): "The <event> is being held on <date> from <start> to <end> at the
// <location>. You can get tickets to it from <ticket link>. Would you like me to give you an overview on topics,
// speakers and any other details?" A "yes" then gets overviewAnswer.
const OVERVIEW_OFFER = 'Would you like me to give you an overview on topics, speakers and any other details?';
function eventIntro(e) {
  const name = /^the\s/i.test(e.title) ? e.title : `The ${e.title}`;
  const s = new Date(e.start), en = new Date(e.end);
  const day = (d) => d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const t = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])\.?m\.?/i, (m, a) => ` ${a.toUpperCase()}M`);
  const multi = new Date(e.end) - new Date(e.start) > 86400000 && midnightOf(s) !== midnightOf(new Date(+en - 1));
  const when = e.allDay ? (multi ? `from ${day(s)} to ${day(new Date(+en - 1))}` : `on ${day(s)}, all day`)
    : multi ? `from ${day(s)} at ${t(s)} to ${day(en)} at ${t(en)}` : `on ${day(s)} from ${t(s)} to ${t(en)}`;
  const loc = String(e.location || '').replace(/\\,/g, ',').replace(/\s+/g, ' ').trim();
  const where = !loc ? '' : /^https?:\/\//i.test(loc) ? ' online' : ` at ${/^(the|a|an)\s/i.test(loc) || /^\d/.test(loc) ? '' : 'the '}${loc}`;
  const verb = new Date(e.end) < Date.now() ? 'was held' : 'is being held';
  const tix = ticketLinks(e)[0];
  return `**${name} ${verb} ${when}${where}.**${tix ? ` You can get tickets to it from the [${tix.name} event page](${tix.url}).` : ''}`;
}
const midnightOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return +x; };
// "When is the AI Brain Builder Workshop?" (Ryan, 2026-11-02): "The AI Brain Builder Workshop is happening tomorrow at
// 5:30 PM to 8:00 PM at the Platform Innovation Centre. What else would you like to know about the event?"
const WHEN_ASK = 'What else would you like to know about the event?';
function whenAnswer(e) {
  const name = /^the\s/i.test(e.title) ? e.title : `The ${e.title}`;
  const s = new Date(e.start), en = new Date(e.end);
  const t = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])\.?m\.?/i, (m, a) => ` ${a.toUpperCase()}M`);
  const days = Math.round((midnightOf(s) - midnightOf(new Date())) / 86400000);
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : days > 1 && days < 7 ? `on ${s.toLocaleDateString([], { weekday: 'long' })}` : `on ${s.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}`;
  const multi = en - s > 86400000 && midnightOf(s) !== midnightOf(new Date(+en - 1));
  const when = e.allDay ? `${day}, all day` : multi ? `${day} at ${t(s)} until ${en.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}` : `${day} at ${t(s)} to ${t(en)}`;
  const loc = String(e.location || '').replace(/\\,/g, ',').replace(/\s+/g, ' ').trim();
  const venue = loc.split(',')[0].trim(); // the venue's name; the full address is in the event
  const where = !loc ? '' : /^https?:\/\//i.test(loc) ? ' online' : ` at ${/^(the|a|an)\s/i.test(venue) || /^\d/.test(venue) ? '' : 'the '}${venue}`;
  const verb = en < Date.now() ? 'happened' : 'is happening';
  if (s <= Date.now() && en >= Date.now()) return `**${name} is happening now until ${t(en)}${where}.** ${WHEN_ASK}`;
  return `**${name} ${verb} ${when}${where}.** ${WHEN_ASK}`;
}
function introAnswer(e) {
  const hasMore = !!require('./feed').eventText(e);
  return `${eventIntro(e)}\n\n${hasMore ? OVERVIEW_OFFER : 'There are no other details in the calendar description.'}`;
}
// After "yes": what it's about, the speakers and the topics, from the description.
function overviewAnswer(e) {
  const desc = eventDescription(e);
  const sentences = (desc.match(/[^.!?]+[.!?]*/g) || []).map((x) => x.trim()).filter((x) => x.length > 2);
  const parts = overviewParts(e);
  const speakers = parts.speakers && parts.speakers.text;
  const topics = parts.topics && parts.topics.text;
  const out = [`**${e.title}:** ${sentences.slice(0, 2).join(' ') || 'There is no summary in the description.'}`];
  if (topics) out.push(`**Topics:** ${topics}.`);
  if (speakers) out.push(`**Speakers:** ${speakers}.`);
  const other = parts.other.map((x) => x.text);
  if (other.length) out.push(`**Good to know:** ${other.map((x) => x.replace(/https?:\/\/\S+/g, '').trim().replace(/([^.!?])$/, '$1.')).join(' ')}`);
  if (parts.rest.length) out.push('Want more? Just say "tell me more".');
  return out.join('\n\n');
}
// Asking for more about the event (Ryan, 2026-11-02): the first time gives the overview, after that each "tell me more"
// summarizes the next part of the description that hasn't been covered, until it's all been said.
const MORE = /^(tell me more|more|more (details|detail|info|information)|what else|anything else|go on|keep going|continue|and|and then|elaborate|more about (it|that|this|the event)|(give|tell) me (more|the|some more) (details|info|information|about it)|what are the details|(any )?other details|details( please)?|what other details|is there more|what more)( please| about it| about this event)?$/i;
function overviewParts(e) {
  const lines = descLines(e);
  const used = new Set();
  const speakers = lines.find((x) => x.head && /speak|presenter|host|panel|instructor|facilitat|guest|keynote/i.test(x.head));
  const topics = lines.find((x) => x.head && /agenda|topic|cover|learn|program|schedule|outline|curriculum/i.test(x.head));
  [speakers, topics].forEach((x) => x && used.add(x));
  const other = DETAILS.filter((d) => ['bring', 'food', 'parking', 'dress', 'cost'].includes(d.key)).map((d) => lines.find((x) => !x.head && d.line.test(x.text))).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  other.forEach((x) => used.add(x));
  // the summary uses the first two plain lines
  lines.filter((x) => !x.head).slice(0, 2).forEach((x) => used.add(x));
  const rest = lines.filter((x) => !used.has(x) && !/^(tickets?|register|rsvp)\b/i.test(x.head || x.text) && !/^https?:\/\/\S+$/.test(x.text));
  return { speakers, topics, other, rest };
}
function moreAnswer(e, step) {
  const { rest } = overviewParts(e);
  const chunk = rest.slice((step - 1) * 4, step * 4);
  const clean = (t) => t.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').replace(/[:\s]+$/, '').trim();
  const end = (t) => (/[.!?…]$/.test(t) ? t : t + '.');
  if (!chunk.length) return `**That's everything in the ${e.title} description.** For anything else, the organiser's event page is the best place to look.`;
  const more = rest.length > step * 4;
  return `**More on ${e.title}:** ${chunk.map((x) => end(clean(x.head ? `${x.head}: ${x.text}` : x.text))).join(' ')}${more ? '\n\nThere\'s a bit more. Want me to keep going?' : '\n\nThat covers everything in the description.'}`;
}
const YES = /^(yes|yeah|yep|yup|sure|please|ok|okay|go ahead|do it|absolutely|definitely|of course|tell me|sounds good)\b/i;

// Follow-up questions answered from the event's description (Ryan, 2026-11-02): speakers, topics, cost, what to
// bring, food, parking, dress code and links. strict: only with "it"/"this event" or the event's name. q: the question; line: what a matching line or section header says.
const DETAILS = [
  { key: 'speakers', label: 'who is speaking', q: /\b(speakers?|speaking|presenters?|presenting|hosts?|hosting|hosted|panel(ists?)?|instructors?|teach(ing|er)|facilitat\w*|who('?s| is| are)? (running|leading|giving|teaching|presenting|on stage)|who (will|is going to) (be )?(speak|talk|present|teach))\b/, line: /speak|presenter|presented by|present(ing|s)\b|host|panel|instructor|facilitat|featuring|led by|keynote|guest/i },
  { key: 'topics', strict: true, label: 'the topics', q: /\b(topics?|cover(ed|ing|s)?|agenda|learn|talk(ing|ed)? about|discuss(ed|ing)?|program(me)?|run ?of ?show|outline|curriculum|what will (we|i|they|you) (do|learn|cover|build)|what('?s| is) (happening|planned))\b/, line: /topic|agenda|cover|learn|discuss|program|outline|curriculum|you('ll| will)|session|build|explore|walk ?through|hands-on|schedule/i },
  { key: 'cost', strict: true, label: 'the price', q: /\b(cost|costs|price|pricing|how much|fee|fees|is it free|free to)\b/, line: /[$€£]\s?\d|\bfree\b|price|cost|fee\b|\bcad\b|\busd\b/i },
  { key: 'bring', strict: true, label: 'what to bring', q: /\b(bring|prerequisites?|requirements?|need to (have|install|know)|(prepare|prep|get ready) for (it|this|that|the (event|workshop|session|class|meeting|talk))|before (it|the (event|workshop|session|class)))\b/, line: /bring|laptop|prerequisite|require|install|before (the|you)|prepare|need/i },
  { key: 'food', label: 'food or drinks', q: /\b(food|lunch|dinner|breakfast|snacks?|drinks?|refreshments?|catering|pizza|coffee)\b/, line: /food|lunch|dinner|breakfast|snack|drink|refreshment|cater|pizza|coffee|beer|wine/i },
  { key: 'parking', label: 'parking or directions', q: /\b(park(ing)?|transit|subway|directions|get there|getting there)\b/, line: /park|transit|subway|direction|entrance|floor|suite|buzz/i },
  { key: 'dress', label: 'a dress code', q: /\b(dress( code)?|what (should|do) i wear|attire)\b/, line: /dress|attire|wear|casual|formal/i },
  { key: 'links', strict: true, label: 'any links', q: /\b(links?|website|web ?page|url|join link|zoom link|stream|livestream)\b/, line: /https?:\/\//i },
];
// "this event", "the workshop", "it": the event the conversation is about.
const FOCUS_REF = /\b(this|that|the|it'?s|its) (event|meeting|workshop|session|talk|conference|class|webinar|meetup|seminar|course|one)\b|\b(it|its|there)\b/;

// The description as lines, with "Header:" sections gathered so "Speakers:" followed by names reads as one line.
function descLines(e) {
  const raw = require('./feed').eventText(e);
  const out = [];
  let head = null;
  for (const l0 of raw.split('\n')) {
    const l = l0.replace(/^\s*([-*•]|\d+[.)])\s+/, '').replace(/[*_`#]/g, '').trim();
    if (!l) { head = null; continue; }
    if (/^(created by maestro|join (zoom|microsoft teams|with google meet)|meeting id|passcode|password|dial|one tap|find your local)/i.test(l)) continue;
    if (/^#{1,}\s/.test(l0.trim()) || /^[^:]{2,40}:$/.test(l)) { head = { head: l.replace(/:$/, ''), items: [] }; out.push(head); continue; }
    if (head && /^\s*([-*•]|\d+[.)])\s+/.test(l0)) { head.items.push(l); continue; }
    if (head && !head.items.length) { head.items.push(l); continue; }
    head = null; out.push({ head: '', items: [l] });
  }
  return out.filter((x) => x.items.length).map((x) => ({ head: x.head, text: x.items.length > 1 ? `${x.items.slice(0, -1).join(', ')} and ${x.items[x.items.length - 1]}` : x.items[0] }));
}
function detailAnswer(e, d) {
  const lines = descLines(e);
  const noUrl = (t) => t.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').replace(/[:\s]+$/, '').trim();
  let hits;
  if (d.key === 'links') {
    const urls = [...new Set((require('./feed').eventText(e).match(/https?:\/\/[^\s<>"')\]]+/g) || []).map((u) => u.replace(/[.,;:!?]+$/, '')))];
    if (!urls.length) return `**${e.title}'s description has no links.**`;
    return `**${e.title} links:** ${urls.slice(0, 4).map((u) => `[${u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}](${u})`).join(', ')}.`;
  }
  // A section whose header names it ("Speakers:", "Agenda") wins; otherwise lines that mention it.
  hits = lines.filter((x) => x.head && d.line.test(x.head)).map((x) => `${x.head}: ${x.text}`);
  if (!hits.length) hits = lines.filter((x) => d.line.test(`${x.head} ${x.text}`)).map((x) => (x.head ? `${x.head}: ${x.text}` : x.text));
  hits = hits.map(noUrl).filter((t) => t.length > 2);
  if (!hits.length) return `**${e.title}'s description doesn't mention ${d.label}.** The organiser's event page may have more.`;
  const end = (t) => (/[.!?…]$/.test(t) ? t : t + '.');
  const trim = (t) => (t.length > 240 ? t.slice(0, 237).replace(/\s+\S*$/, '') + '…' : t);
  return `**${e.title}:** ${hits.slice(0, 2).map((t) => end(trim(t))).join(' ')}`;
}
// The event this question is about: named in it, or the one the conversation is on ("this event", "who's speaking?").
function eventFor(q, ctx, { loose = false } = {}) {
  const a = matchEvents(q.m, ctx.events || []);
  if (a && (a.events.length || a.past) && a.byTitle) return a.events[0] || a.past;
  if (ctx.focus && (FOCUS_REF.test(q.m) || (loose && !a))) return ctx.focus;
  // "Tell me about this event" with nothing discussed yet: the event on now, else the next one.
  if (/\b(this|the) (event|meeting|workshop|session|talk|conference|webinar|meetup)\b/.test(q.m) && !a) {
    const now = Date.now(), evs = (ctx.events || []).filter((e) => new Date(e.end) > now).sort((x, y) => new Date(x.start) - new Date(y.start));
    return evs.find((e) => new Date(e.start) <= now) || evs[0] || null;
  }
  return null;
}

function find(message, ctx) {
  const q = parse(message);
  if (TICKETS.test(q.m)) {
    const ev = eventFor(q, ctx, { loose: true });
    if (ev) return { kind: 'tickets', q, subject: [], event: ev };
  }
  if (ctx.focus && ((ctx.offered && YES.test(q.m.trim())) || MORE.test(q.m.trim().replace(/[?!.]+$/, '')))) {
    const step = ctx.moreStep || 0; // 0: overview not given yet
    return step ? { kind: 'more', q, subject: [], event: ctx.focus, step } : { kind: 'overview', q, subject: [], event: ctx.focus };
  }
  const detail = DETAILS.find((d) => d.q.test(q.m));
  if (detail) {
    const ev = eventFor(q, ctx, { loose: !detail.strict || /\bwhat (should|do|can|must) (i|we) (need to )?bring\b/.test(q.m) }); // words like "bring" or "links" need "this event" or the event's name
    if (ev) return { kind: 'detail', q, subject: [], event: ev, detail };
  }
  if (!q.past && ABOUT.test(q.m)) {
    const ev = eventFor(q, ctx);
    if (ev) return { kind: 'about', q, subject: [], event: ev };
  }
  const r = findBasic(message, ctx);
  const t = !q.past && /\b(when|what time|what day|which day|where|how long until)\b/.test(q.m) ? matchEvents(q.m, ctx.events || []) : null;
  // "when is my meeting with Sarah?" keeps the person-first answer, unless the question names the event itself
  if (r && r.kind === 'event' && ((r.subject.length && r.events.length) || r.past) && !(t && t.byTitle)) return r;
  if (t) return { kind: 'event', q, subject: [], titleMatch: true, ...t };
  return r;
}

function findBasic(message, { items, events, otherItems = [] }) {
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
    // "What time is standup?" after standup ended today: say when it was.
    const earlier = want.length && !hit.length ? events.filter((e) => new Date(e.end) <= Date.now() && want.some((t) => inEvent(e, t))) : [];
    if (earlier.length) return { kind: 'event', q, subject, events: [], past: earlier[earlier.length - 1] };
    return { kind: 'event', q, subject, events: hit.length || subject.length || want.length ? hit : upcoming, want };
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

  if (r.kind === 'about') return SUMMARY_Q.test(r.q.m) ? aboutAnswer(r.event) : introAnswer(r.event);
  if (r.kind === 'overview') return overviewAnswer(r.event);
  if (r.kind === 'more') return moreAnswer(r.event, r.step);
  if (r.kind === 'tickets') return ticketAnswer(r.event);
  if (r.kind === 'detail') return detailAnswer(r.event, r.detail);
  if (r.kind === 'event') {
    if (r.past && r.titleMatch) return `**${r.past.title} was ${whenText(r.past.start)}.** There isn't another one on your calendar in the next 6 months.`;
    if (r.past) return `**${r.past.title} was ${whenText(r.past.start)}.** Nothing else like it is coming up this week.`;
    if (!r.events.length) return `**I don't see ${who ? `anything with ${who}` : r.want && r.want.length ? `"${r.want.join(' ')}"` : 'anything'} on your calendar in the next 6 months.**`;
    const [e, ...rest] = r.events;
    if (r.titleMatch) return whenAnswer(e);
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
  if (r.kind === 'tickets') { const l = ticketLinks(r.event); return `# EXACT MATCH FOR THIS QUESTION (reply only: \"Get your ticket to the event from the <site> event page. Click the link in the description.\" with the link)\n- EVENT ${r.event.title} · ${whenText(r.event.start)}\n  Ticket links: ${l.map((x) => `${x.name}: ${x.url}`).join(', ') || '(none in the event details)'}`; }
  if (r.kind === 'detail') { const e = r.event; return `# EXACT MATCH FOR THIS QUESTION (answer about ${r.detail.label} for this event in at most 2 short sentences, using only its description; say so if it isn't there)\n- EVENT ${e.title} · ${whenText(e.start)}${e.location ? ' · at ' + e.location : ''}\n  Full description:\n${require('./feed').eventText(e) || '(none)'}`; }
  if (r.kind === 'about') {
    const e = r.event;
    return `# EXACT MATCH FOR THIS QUESTION (summarize what this event is about in at most 2 short sentences from its description, then ask "What would you like to know specifically?")\n- EVENT ${e.title} · ${whenText(e.start)}${e.attendees && e.attendees.length ? ' · with ' + e.attendees.join(', ') : ''}${e.location ? ' · at ' + e.location : ''}\n  Summary: ${eventDescription(e) || '(none)'}\n  Full description (speakers, topics, tickets and other details for follow-up questions):\n${require('./feed').eventText(e) || '(none)'}`;
  }
  const rows = r.kind === 'event'
    ? r.events.slice(0, 6).map((e) => `- EVENT ${e.title} · ${whenText(e.start)} · ${e.attendees ? 'with ' + e.attendees.join(', ') : ''}`)
    : r.items.slice(0, 8).map((i) => `- [${i.category}] ${i.sourceName} · ${whenText(i.ts)} · ${i.title}${i.quote ? ' — ' + i.quote : ''}`);
  return rows.length ? `# EXACT MATCHES FOR THIS QUESTION (answer from these first)\n${rows.join('\n')}` : '# EXACT MATCHES FOR THIS QUESTION\n(none found in the feed or calendar)';
}

module.exports = { OVERVIEW_OFFER, find, answer, contextBlock, whenText, parse, matchEvents };
