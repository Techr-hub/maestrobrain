// Conversation: how Maestro answers when you talk to it like a person, not a search box.
// "I'm stressed out", "you're awesome", "tell me a joke", "I need a break", "I'm bored"…
//
// Maestro reads what you said, decides what kind of moment it is (venting, celebrating, joking,
// asking for a break), and answers in kind, using what it knows about your day where that helps.
// It is personal and a little sarcastic, but never sarcastic about real distress.
// Returns null when the message is a request for information, so the rest of the brain can answer it.

const timeOf = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const ask = (options) => `Which do you want to hear more about: ${options.length < 2 ? options.join('') : `${options.slice(0, -1).join(', ')} or ${options[options.length - 1]}`}?`;

// What the rest of today looks like, in a form a reply can lean on.
function dayShape(ctx) {
  const now = Date.now();
  const today = (ctx.events || []).filter((e) => sameDay(e.start, now));
  const left = today.filter((e) => new Date(e.end) > now);
  const next = left.find((e) => new Date(e.start) > now);
  const highs = (ctx.items || []).filter((i) => i.priority === 'High');
  // next free half hour before 6 PM
  let free = null;
  let t = now;
  const endOfDay = new Date(); endOfDay.setHours(18, 0, 0, 0);
  for (const e of left.slice().sort((a, b) => new Date(a.start) - new Date(b.start))) {
    if (new Date(e.start) - t >= 30 * 60000) break;
    t = Math.max(t, new Date(e.end).getTime());
  }
  if (t < endOfDay.getTime()) free = t;
  const h = new Date().getHours();
  return { today, left, next, highs, free, late: h >= 18 || h < 5, tasks: (ctx.openTasks || []).length, busy: left.length >= 3 || highs.length >= 3 };
}
function freeText(s) {
  if (!s.left.length) return s.late ? 'the workday is over' : "you're free for the rest of the day";
  if (s.free == null) return 'your calendar is packed until this evening';
  return s.free - Date.now() < 5 * 60000 ? "you're free right now" : `you're free from ${timeOf(s.free)}`;
}
// "I'm stressed about the sprint" → offer the sprint first.
function topicOf(m) {
  const t = [[/\bsprint\b/, 'sprint'], [/\b(release|launch|ship(ping)?)\b/, 'release'], [/\b(inbox|emails?)\b/, 'emails'], [/\b(meetings?|calendar|schedule)\b/, 'meetings'], [/\b(messages?|slack|texts?)\b/, 'messages'], [/\bcalls?\b/, 'calls']].find(([re]) => re.test(m));
  return t ? t[1] : null;
}

const RX = {
  crisis: /\b(kill myself|suicid|end (it|my life)|hurt myself|self[- ]harm|don'?t want to (live|be here)|no reason to live)\b/,
  stressed: /\b(stress(ed|ful)?|overwhelm(ed|ing)?|anxious|anxiety|panick?(ing|ed)?|freaking out|losing my mind|too much (on|going on)|swamped|drowning|under (a lot of )?pressure|burn(ed|t)? ?out|frazzled|on edge)\b/,
  tired: /\b(tired|exhausted|sleepy|wiped( out)?|drained|knackered|beat|fried|no energy|didn'?t sleep|running on empty)\b/,
  sad: /\b(sad|down|depressed|lonely|alone|upset|hurt|heartbroken|miserable|crying|rough (day|week)|bad (day|week)|awful (day|week)|terrible (day|week))\b/,
  angry: /\b(angry|mad|pissed( off)?|furious|frustrat(ed|ing)|annoy(ed|ing)|irritated|fed up|sick of)\b/,
  worried: /\b(worried|nervous|scared|afraid|dreading|concerned)\b/,
  bored: /\b(bored|boring|nothing to do)\b/,
  happy: /\b(happy|great|amazing|awesome|fantastic|excited|pumped|stoked|good mood|on fire|crushing it|killing it|nailed it|won|closed the deal|got the deal)\b/,
  hungry: /\b(hungry|starving|lunch time|need (food|coffee|a coffee)|coffee)\b/,
  sick: /\b(sick|ill|unwell|headache|migraine|flu|cold|not feeling (well|good))\b/,
  breakQ: /\b(need a break|take a break|should i (take a break|stop|go home|log off)|can i (take a break|leave|go home)|time for a break|step away)\b/,
};

function aboutMe(m) { return /^(i('m| am)|i feel|i'?ve been|feeling|i was|today (is|was)|this (day|week) (is|was)|ugh|man|honestly|so)\b/.test(m) || /\b(i('m| am)|i feel|feeling|me)\b/.test(m); }

function converse(message, ctx, cfg) {
  const m = String(message || '').toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
  const bare = m.replace(/[?!.,]+$/g, '').trim();
  const me = String(cfg.user.name || 'there').split(/\s+/)[0];
  if (!bare) return null;
  const isQuestion = /\?$/.test(m) || /^(what|when|who|where|which|how many|did|does|do i|is there|are there|show|list|find|summari[sz]e|brief|check|read|create|add|schedule|remind|remember)\b/.test(bare);

  // Real distress comes first, with no jokes.
  if (RX.crisis.test(bare)) {
    return `${me}, I'm really glad you told me. You deserve support from a real person right now. If you're in Canada or the US, call or text 988 (Suicide Crisis Helpline) any time; elsewhere, findahelpline.com lists free local lines. If you're in danger, call 911. I'm here too. Do you want to tell me what's going on?`;
  }

  const s = dayShape(ctx);
  const feeling = !isQuestion && (aboutMe(bare) || /^(this|that|it|today|ugh|argh|man|honestly|so|work)\b/.test(bare));
  const topic = topicOf(bare);

  if (feeling && RX.stressed.test(bare)) {
    const load = [s.left.length ? plural(s.left.length, 'meeting', 'meetings') + ' left today' : 'no more meetings today', s.highs.length ? plural(s.highs.length, 'high-priority item', 'high-priority items') : ''].filter(Boolean).join(' and ');
    const calm = s.late ? "It's late, so none of it gets solved tonight. Park it, and we'll pick the first thing in the morning." : s.busy ? "Let's not try to win everything today. I'd pick one thing and let me hold the rest." : "It's less than it feels like. Breathe, then we pick one thing.";
    return `That's a lot to carry, ${me}. Here's the honest picture: ${load}, and ${freeText(s)}. ${calm}\n\n${ask([...(topic ? [topic] : []), 'priority items', 'tasks'].filter((x, i, a) => a.indexOf(x) === i))}`;
  }
  if (feeling && RX.worried.test(bare)) {
    return topic ? `Worry usually means you care, ${me}. Let's look at the facts instead of the feeling.\n\n${ask([topic, 'priority items'])}` : `Worry usually means you care, ${me}. Tell me what's on your mind and I'll check what we actually know about it.${s.next ? ` Your next thing is ${s.next.title} at ${timeOf(s.next.start)}, if that's the one.` : ''}`;
  }
  if (feeling && RX.sad.test(bare)) {
    return `I'm sorry, ${me}. That sounds rough. Do you want to talk it through, or should I quietly lighten today's load? ${s.left.length ? `You've got ${plural(s.left.length, 'meeting', 'meetings')} left; I can tell you which ones could move.` : 'Your calendar is clear for the rest of today, which helps.'}`;
  }
  if (feeling && RX.angry.test(bare)) {
    return pick([`Fair enough, ${me}. Want to vent, or want me to find the thing causing it so we can deal with it?`, `Noted, and probably justified. Tell me who or what, and I'll pull up everything we have on it.`]);
  }
  if (feeling && RX.sick.test(bare)) {
    return `Sorry you're not feeling well, ${me}. ${s.left.length ? `You've got ${plural(s.left.length, 'meeting', 'meetings')} left today. Want me to list them so you can decide what to move?` : 'Nothing else is booked today, so rest is officially on the schedule.'}`;
  }
  if ((feeling && RX.tired.test(bare)) || RX.breakQ.test(bare)) {
    const nxt = s.next ? `Your next thing is ${s.next.title} at ${timeOf(s.next.start)}` : 'Nothing else is booked today';
    return RX.breakQ.test(bare)
      ? (s.late ? `It's ${timeOf(Date.now())}, ${me}. That's not a break, that's bedtime. Log off; I'll keep watch.` : `Yes. ${nxt}, and ${freeText(s)}. Take the break, ${me}. The inbox will still be terrible when you get back.`)
      : s.late ? `Then call it a night, ${me}. ${s.next ? `${nxt}.` : 'Nothing else is booked today.'} I'll keep watch and have your morning ready.`
        : `Running on fumes, ${me}? ${nxt}, and ${freeText(s)}. A 15-minute break now beats a foggy afternoon. Coffee is optional but strongly encouraged.`;
  }
  if (feeling && RX.bored.test(bare)) {
    const t = (ctx.openTasks || [])[0];
    return t ? `Bored? I can fix that, ${me}. You have ${plural(s.tasks, 'open task', 'open tasks')}. Top of the list: ${t.text}.` : `Bored with nothing on the list? Enjoy it, ${me}. That almost never happens.`;
  }
  if (feeling && RX.hungry.test(bare)) {
    return `${s.next ? `You've got until ${timeOf(s.next.start)} before ${s.next.title}.` : 'Nothing else is booked today.'} Go eat, ${me}. Decisions made hungry are how sprints get re-planned.`;
  }
  if (feeling && RX.happy.test(bare) && !/\b(not|n't)\b/.test(bare)) {
    return pick([`Love that, ${me}. Let's ride it. Want me to point that energy at the top priority?`, `Look at you. Let's bank the win before someone books a meeting about it.`, `That's what I like to hear, ${me}. Momentum is a terrible thing to waste.`]);
  }

  // Talking to Maestro itself
  if (/^(you('re| are)|ur) (awesome|amazing|the best|great|smart|brilliant|a genius|so helpful|helpful|cool|incredible)/.test(bare) || /^(good|nice|great) (job|work|one)( maestro)?$/.test(bare) || /^(i love (you|this|it)|love (you|it|this))/.test(bare))
    return pick([`I know. But it's nice to hear, ${me}.`, `Careful, ${me}, I'll start expecting a raise.`, `Thanks, ${me}. I'll add it to my performance review.`]);
  if (/^(you('re| are)|ur) (useless|stupid|dumb|wrong|terrible|bad|annoying|broken|not helpful)|^(you suck|this sucks|that'?s wrong|wrong answer|that'?s not (right|what i (asked|meant)))/.test(bare))
    return `Fair, ${me}. Tell me what you were after and I'll take another swing. If I keep missing, connecting an AI engine in Settings gives me a much bigger brain.`;
  if (/^(sorry|my bad|apologies|oops)\b/.test(bare)) return pick([`No need, ${me}. We're good.`, `Forgiven. I wasn't keeping score. Much.`]);
  if (/^(tell me a joke|make me laugh|say something funny|joke|got any jokes)/.test(bare)) {
    return pick([
      "I'd tell you a joke about the sprint, but it's still in progress.",
      'Why did the meeting go so well? It could have been an email, and it was.',
      'My favourite exercise is running late. Your calendar agrees.',
      "There are two hard things in product: naming things, scope creep, and off-by-one errors.",
      "I asked the inbox how it was doing. It said it's at zero. We both knew it was lying.",
    ]);
  }
  if (/^(are you (real|human|alive|a person|a robot|an ai|ai|sentient|conscious))/.test(bare))
    return `I'm an AI, ${me}, living in your notes, calendar and messages. Not human, but I do remember everything you tell me, which is more than most people manage.`;
  if (/^(how was your day|how('s| is) your day( going)?|what('ve| have) you been up to|what are you doing)/.test(bare))
    return `Busy. I read your feed, watched your calendar and judged a few email subject lines. How's yours going, ${me}?`;
  if (/^(bye|goodbye|see (you|ya)|later|talk (to you )?later|ttyl|i'?m (off|out|done)( for (the day|today|tonight))?|signing off|logging off|good ?night)\b/.test(bare))
    return pick([`See you, ${me}. I'll keep watch.`, `Go. I've got this. I'll flag anything that actually matters.`, `Later, ${me}. Try not to check Slack from the couch.`]);
  if (/^(what do you think|any (thoughts|advice|ideas)|what would you do|should i)\b/.test(bare) && !/\b(meeting|email|task|project|sprint|call|calendar)\b/.test(bare))
    return `Give me a bit more to go on, ${me}. What's the decision, and what's pulling you each way?`;
  if (/^(yes|yeah|yep|yup|no|nope|nah|maybe|not really|i guess)$/.test(bare))
    return `Got it. Tell me what you'd like next, ${me}, or say "summarize my day".`;
  if (/^(lol|haha+|ha+|lmao|😂|🤣)$/.test(bare)) return pick(['Glad one of us is amused.', 'I have my moments.']);

  // Any other statement about how you feel gets an honest, open reply instead of "I don't understand".
  if (feeling && /^(i('m| am)|i feel|feeling)\b/.test(bare) && bare.split(' ').length <= 12) {
    return `Thanks for telling me, ${me}. Want to talk about it, or is there something I can take off your plate?`;
  }
  return null;
}

module.exports = { converse, dayShape };
