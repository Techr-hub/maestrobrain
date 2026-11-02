// Browser voice: Web Speech API for speech-to-text and text-to-speech, plus a mic level meter
// that drives the pulsing avatar. Works best in Chrome and Edge (Safari partially, Firefox has no recognition).
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voiceSupported = { stt: !!SR, tts: 'speechSynthesis' in window };

export class Voice {
  constructor({ onInterim, onFinal, onState, onLevel, lang = 'en-US' }) {
    Object.assign(this, { onInterim, onFinal, onState, onLevel, lang });
    this.listening = false;
    this.handsFree = false;
    this.wakeName = 'maestro';
  }

  async startMeter() {
    if (this.stream || !navigator.mediaDevices) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const src = ac.createMediaStreamSource(this.stream);
      const an = ac.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      this.ac = ac;
      const tick = () => {
        if (!this.stream) return;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
        this.onLevel && this.onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 5));
        requestAnimationFrame(tick);
      };
      tick();
    } catch { /* level meter is optional */ }
  }

  stopMeter() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ac) this.ac.close().catch(() => {});
    this.ac = null;
    this.onLevel && this.onLevel(0);
  }

  // The mic stays on until stop() is called (the mic button is a switch), so you can talk to Maestro at any point.
  // wakeWord: only act on speech that starts with "Hey Maestro" (the hands-free setting).
  // While Maestro is speaking the mic keeps listening: if you start talking, Maestro stops and listens instead.
  start({ wakeWord = false } = {}) {
    if (!SR) throw new Error('Voice input needs Chrome or Edge.');
    this.stopSpeaking();
    this.active = true;
    this.handsFree = true; // kept for older callers: "keep listening"
    this.wakeWord = wakeWord;
    this._listen();
    this.startMeter();
    this.onState && this.onState('listening');
  }

  _listen() {
    const rec = new SR();
    rec.lang = this.lang;
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
      }
      const heard = (final || interim).trim();
      if (!heard) return;
      // Maestro hearing its own voice through the speakers is not an interruption.
      if (this.isEcho(heard)) return;
      // You started talking while Maestro was speaking: stop and listen.
      if (this.isSpeaking() && (final || words(interim).length >= 2)) {
        this.stopSpeaking();
        this.onInterrupt && this.onInterrupt();
      }
      if (interim && !final) { this.onInterim && this.onInterim(interim); return; }
      let text = final.trim();
      if (STOP.test(text)) { this.stopSpeaking(); this.onInterim && this.onInterim(''); return; } // "stop", "wait": just be quiet
      if (this.wakeWord) {
        const re = new RegExp(`^(?:hey |hi |ok |okay )?(?:${this.wakeName}|maestro|mistro|maestra|my stro)[,.!]?\\s*`, 'i');
        if (!re.test(text)) return; // ignore speech without the wake word
        text = text.replace(re, '');
        if (!text) return;
      }
      this.onFinal && this.onFinal(text);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.active = false; }
      if (e.error !== 'no-speech' && e.error !== 'aborted') this.onState && this.onState('error', e.error);
    };
    rec.onend = () => {
      // Browsers end recognition after a silence or about a minute; start again while the mic is switched on.
      if (this.active) { try { this._listen(); return; } catch { /* restart failed */ } }
      this.listening = false;
      this.stopMeter();
      this.onState && this.onState('idle');
    };
    this.rec = rec;
    rec.start();
    this.listening = true;
  }

  // Is this what Maestro is saying (or just said)? Most of the words match the reply being spoken.
  isEcho(heard) {
    if (!this._said || Date.now() > this._saidUntil) return false;
    const w = words(heard);
    if (!w.length) return true;
    const hit = w.filter((x) => this._said.has(x)).length;
    return hit / w.length >= 0.6;
  }

  isSpeaking() { return !!this._speaking; }

  stop() {
    this.active = false;
    this.handsFree = false;
    this.listening = false;
    if (this.rec) try { this.rec.stop(); } catch { /* already stopped */ }
    this.stopMeter();
  }

  voices() { return voiceSupported.tts ? speechSynthesis.getVoices() : []; }

  // The most natural-sounding English voice this browser has (Edge "Online (Natural)", macOS Premium/Enhanced,
  // Google voices), skipping the novelty and robotic ones.
  // gender: 'male' | 'female' | '' (any). Falls back to the best voice of any gender if none match.
  bestVoice(gender = '') { const r = rankVoices(this.voices()); return (gender && r.find((v) => voiceGender(v) === gender)) || r[0] || null; }

  speak(text, { voiceName, gender = '', rate = 0.92, pause = 1500, onStart, onEnd } = {}) {
    if (!voiceSupported.tts || !text) { onEnd && onEnd(); return; }
    this.stopSpeaking();
    // One utterance per sentence, with a short breath between them. Each sentence is cleaned so the voice never
    // reads punctuation or symbols aloud (some voices say "dot", "end" or "point" for a trailing full stop).
    const sentences = splitSentences(text).map(speakable).filter(Boolean);
    // Very long sentences get split at commas so Chrome doesn't cut them off.
    const parts = sentences.flatMap((x) => (x.length <= 230 ? [x] : x.split(/(?<=,)\s+/).reduce((acc, p) => { const l = acc.length - 1; if (l >= 0 && acc[l].length + p.length < 230) acc[l] += ' ' + p; else acc.push(p); return acc; }, [])));
    if (!parts.length) { onEnd && onEnd(); return; }
    const voice = this.voices().find((v) => v.name === voiceName) || this.bestVoice(gender);
    // Ryan (2026-11-02): the man's voice speaks 10% faster than the chosen speed.
    const manBoost = (voice ? voiceGender(voice) === 'male' : gender === 'male') ? 1.1 : 1;
    const run = (this._run = (this._run || 0) + 1); // a newer speak() or stopSpeaking() cancels this one
    this._said = new Set(words(text)); this._saidUntil = Infinity; this._speaking = true;
    const finish = () => { this._speaking = false; this._saidUntil = Date.now() + 1500; onEnd && onEnd(); }; // the echo can lag a moment
    const next = (i) => {
      if (run !== this._run) return;
      if (i >= parts.length) { finish(); return; }
      const u = new SpeechSynthesisUtterance(parts[i]);
      if (voice) u.voice = voice;
      u.lang = voice ? voice.lang : this.lang;
      u.rate = Math.min(2, rate * manBoost);
      u.pitch = 1;
      // The pause is the whole silence between sentences (Ryan, 2026-11-02: 1.5 s). Voices take a moment to start
      // each sentence (online "Natural" voices up to a second), so that start-up lag is measured and taken off the wait.
      const asked = Date.now();
      u.onstart = () => {
        const lag = Math.min(1500, Date.now() - asked);
        this._lag = this._lag == null ? lag : Math.round(this._lag * 0.5 + lag * 0.5);
        if (i === 0 && onStart) onStart();
      };
      const after = () => { if (run !== this._run) return; this._timer = setTimeout(() => next(i + 1), i < parts.length - 1 ? Math.max(0, pause - (this._lag || 0)) : 0); };
      u.onend = after; u.onerror = after;
      speechSynthesis.speak(u);
    };
    next(0);
  }

  stopSpeaking() {
    this._run = (this._run || 0) + 1;
    if (this._speaking) this._saidUntil = Date.now() + 1500;
    this._speaking = false;
    clearTimeout(this._timer);
    if (voiceSupported.tts) speechSynthesis.cancel();
  }
}

const words = (t) => String(t).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
// Short commands that only mean "be quiet": they stop Maestro and aren't sent as a message.
const STOP = /^(?:(?:hey |ok |okay )?(?:maestro|mistro)[,.!]?\s*)?(stop|stop talking|wait|hold on|hang on|quiet|be quiet|shush|shh+|pause|that's enough|enough|okay stop|ok stop)[.!]?$/i;

const ROBOTIC = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|fred|good news|hysterical|jester|junior|kathy|organ|pipe organ|princess|ralph|superstar|trinoids|whisper|wobble|zarvox|eloquence|espeak|microsoft (david|mark|zira) desktop)\b/i;
// Score each voice: higher sounds more human.
export function voiceScore(v) {
  if (!/^en([-_]|$)/i.test(v.lang || '')) return -1000;
  if (ROBOTIC.test(v.name)) return -500;
  let s = 0;
  if (/natural|neural/i.test(v.name)) s += 100;
  if (/premium/i.test(v.name)) s += 90;
  if (/enhanced/i.test(v.name)) s += 70;
  if (/online/i.test(v.name)) s += 30;
  if (/^google/i.test(v.name)) s += 35;
  if (/en[-_](us|gb|ca|au)/i.test(v.lang)) s += 8;
  if (v.localService === false) s += 5;
  return s;
}
// Whether a voice sounds like a man or a woman, from its name (browsers don't report this).
const FEMALE = /\b(female|woman|aria|jenny|ava|emma|michelle|sonia|libby|maisie|natasha|clara|samantha|victoria|karen|moira|tessa|fiona|serena|allison|susan|zoe|nicky|joanna|salli|kendra|kimberly|ivy|amy|olivia|emily|catherine|hazel|zira|ana|jane|nancy|sara|elizabeth|molly|ashley|cora|monica|heather|linda|kate|stephanie|sabina|ellie|isla|neerja|rosa|amber|hayley|abbi|bella|hollie|google us english)\b/i;
const MALE = /\b(male|man|andrew|brian|guy|christopher|eric|roger|steffan|ryan|thomas|daniel|arthur|evan|nathan|aaron|tom|oliver|alex|davis|jason|tony|william|liam|connor|mitchell|james|rishi|lee|gordon|fred|matthew|joey|justin|russell|david|mark|george|reed|rocko|ralph|alfie|elliot|ethan|noah|ollie|kai|luke|prabhat|duncan)\b/i;
export function voiceGender(v) {
  const n = v.name || '';
  if (/\bfemale\b/i.test(n)) return 'female';
  if (/\bmale\b/i.test(n)) return 'male';
  return FEMALE.test(n) ? 'female' : MALE.test(n) ? 'male' : '';
}
export function rankVoices(list) { return list.filter((v) => voiceScore(v) > -500).sort((a, b) => voiceScore(b) - voiceScore(a)); }

// Turn a chunk of reply text into something a speech engine reads naturally.
// Split a reply into sentences for the pause between them, without splitting "3:15 p.m.", "Dr. Kim", "e.g." or "3.5".
export function splitSentences(text = '') {
  const DOT = '․'; // a dot that isn't a full stop, put back after splitting
  const t = String(text)
    // "3 p.m." / "3pm" / "3 P.M" -> "3 PM", one word with no pause. A full stop stays only if a new sentence follows.
    .replace(/\b(\d{1,2}(?::\d{2})?)\s*([aApP])\.?\s?[mM]\b(\.?)(?=(\s+\S)?)/g, (_, time, ap, dot, next) => `${time} ${ap.toUpperCase()}M${dot}`)
    .replace(/\b([aApP])\.[mM]\.(?=\s+[a-z])/g, (_, ap) => `${ap.toUpperCase()}M`) // "in the p.m. today"
    .replace(/\b([aApP])\.[mM]\./g, (_, ap) => `${ap.toUpperCase()}M.`)
    .replace(/(\d (?:AM|PM))\.(?=\s+[a-z])/g, '$1') // "3 PM. tomorrow" was never a sentence end
    .replace(/\b(Dr|Mr|Mrs|Ms|Prof|Jr|Sr|St|Mt|No|vs|approx|etc)\.(?=\s+\S)/g, (m, w) => (/^(St|Mt|No|etc|Jr|Sr)$/.test(w) ? m : `${w}${DOT}`))
    .replace(/\b(St|Mt|No|etc|Jr|Sr|Ave|Rd|Inc|Ltd|Co)\.(?=\s+[a-z\d])/g, `$1${DOT}`)
    .replace(/\b(e)\.(g)\.?/gi, `$1${DOT}$2${DOT}`).replace(/\b(i)\.(e)\.?/gi, `$1${DOT}$2${DOT}`)
    .replace(/(\d)\.(\d)/g, `$1${DOT}$2`); // 3.5, 10.30
  return (t.match(/[^.!?]+[.!?]*/g) || [t]).map((x) => x.replace(new RegExp(DOT, 'g'), '.'));
}

export function speakable(s = '') {
  return s
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '') // emoji
    .replace(/\s+[·•|]\s+/g, ', ').replace(/\s+[—–]\s+/g, ', ').replace(/[·•|—–]/g, ' ')
    .replace(/(\w)\/(\w)/g, '$1 or $2').replace(/\s\/\s/g, ' or ')
    .replace(/[()[\]{}"“”«»_*#>~^=<+]/g, ' ')
    .replace(/(^|\s)#(\w)/g, '$1$2')
    .replace(/\.{2,}|…/g, '.')
    .replace(/\s+([,;:])/g, '$1').replace(/([,;:])\1+/g, '$1')
    .replace(/\s+/g, ' ').trim()
    .replace(/[\s.,;:!-]+$/, '') // no trailing full stop: the pause between chunks is enough
    .replace(/^[\s.,;:!-]+/, '');
}

