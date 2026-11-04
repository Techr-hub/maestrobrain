// Event types for calendar cards (Ryan, 2026-11-04): each calendar card is labelled Meeting, Event, Conference,
// Workshop, Call… from its title, description and location. The list can be edited (rename, recolour, add,
// remove, change the words that pick it), and any card can be switched to another type from its label. A switch
// is remembered for that event, so later calendar reads keep it.
const config = require('./config');

const DEFAULTS = [
  { id: 'meeting', name: 'Meeting', color: '#00e5ff', words: ['meeting', 'sync', 'standup', 'stand-up', '1:1', 'one on one', 'review', 'check-in', 'catch up', 'catch-up', 'retro', 'planning', 'interview', 'lunch'] },
  { id: 'event', name: 'Event', color: '#b18cff', words: ['event', 'party', 'dinner', 'launch', 'meetup', 'meet-up', 'gala', 'festival', 'concert', 'networking', 'mixer', 'celebration', 'tickets', 'social'] },
  { id: 'conference', name: 'Conference', color: '#ff9f43', words: ['conference', 'summit', 'expo', 'keynote', 'convention', 'symposium', 'forum', 'congress', 'tradeshow', 'trade show'] },
  { id: 'workshop', name: 'Workshop', color: '#00f2af', words: ['workshop', 'bootcamp', 'boot camp', 'training', 'hands-on', 'masterclass', 'master class', 'class', 'course', 'seminar', 'hackathon', 'webinar', 'lab'] },
  { id: 'call', name: 'Call', color: '#ff5a8a', words: ['call', 'phone', 'dial-in', 'dial in', 'zoom', 'google meet', 'meet.google.com', 'zoom.us', 'teams.microsoft.com', 'microsoft teams', 'facetime'] },
];

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'type';

function clean(list) {
  const seen = new Set(), out = [];
  for (const t of Array.isArray(list) ? list : []) {
    const name = String((t && t.name) || '').trim().slice(0, 30);
    if (!name) continue;
    let id = slug(t.id || name);
    while (seen.has(id)) id += '-2';
    seen.add(id);
    const words = (Array.isArray(t.words) ? t.words : String(t.words || '').split(',')).map((w) => String(w).trim().toLowerCase()).filter(Boolean).slice(0, 40);
    out.push({ id, name, color: /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : '#00e5ff', words });
  }
  return out;
}

function list(cfg = config.load()) { return Array.isArray(cfg.eventTypes) && cfg.eventTypes.length ? cfg.eventTypes : DEFAULTS; }
function overrides(cfg = config.load()) { return cfg.eventTypeOverrides || {}; }

// The type whose words show up most: the title counts most, then the description and location.
function classify(e, types = list()) {
  if (!types.length) return '';
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const has = (text, w) => new RegExp(`(^|[^a-z0-9])${esc(w)}(?=$|[^a-z0-9])`, 'i').test(text);
  const title = String(e.title || ''), rest = `${e.description || ''} ${e.location || ''} ${e.url || ''}`;
  let best = null, bestScore = 0;
  types.forEach((t, k) => {
    let score = 0;
    for (const w of t.words || []) { if (has(title, w)) score += 10; if (has(rest, w)) score += 1; }
    if (score > bestScore) { best = t; bestScore = score; }
  });
  return (best || types.find((t) => t.id === 'meeting') || types[0]).id;
}

// The type for one event: your choice for it if you made one, else what its words say.
function typeFor(e, source, cfg = config.load()) {
  const types = list(cfg);
  const o = overrides(cfg)[keyOf(source, e.uid || e.eventKey || e.title)];
  return o && types.some((t) => t.id === o) ? o : classify(e, types);
}
const keyOf = (source, eventKey) => `${source}|${eventKey}`;

module.exports = { DEFAULTS, clean, list, overrides, classify, typeFor, keyOf };
