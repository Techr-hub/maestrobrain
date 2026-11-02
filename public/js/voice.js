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

  start({ handsFree = false } = {}) {
    if (!SR) throw new Error('Voice input needs Chrome or Edge.');
    this.stopSpeaking();
    this.handsFree = handsFree;
    const rec = new SR();
    rec.lang = this.lang;
    rec.interimResults = true;
    rec.continuous = handsFree;
    rec.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
      }
      if (interim) this.onInterim && this.onInterim(interim);
      if (final) {
        let text = final.trim();
        if (this.handsFree) {
          const re = new RegExp(`^(?:hey |hi |ok |okay )?(?:${this.wakeName}|maestro|mistro|maestra|my stro)[,.!]?\\s*`, 'i');
          if (!re.test(text)) return; // ignore speech without the wake word
          text = text.replace(re, '');
          if (!text) return;
        }
        this.onFinal && this.onFinal(text);
      }
    };
    rec.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') this.onState && this.onState('error', e.error); };
    rec.onend = () => {
      if (this.handsFree && this.listening) { try { rec.start(); return; } catch { /* restart failed */ } }
      this.listening = false;
      this.stopMeter();
      this.onState && this.onState('idle');
    };
    this.rec = rec;
    rec.start();
    this.listening = true;
    this.startMeter();
    this.onState && this.onState('listening');
  }

  stop() {
    this.handsFree = false;
    this.listening = false;
    if (this.rec) try { this.rec.stop(); } catch { /* already stopped */ }
    this.stopMeter();
  }

  voices() { return voiceSupported.tts ? speechSynthesis.getVoices() : []; }

  // The most natural-sounding English voice this browser has (Edge "Online (Natural)", macOS Premium/Enhanced,
  // Google voices), skipping the novelty and robotic ones.
  bestVoice() { return rankVoices(this.voices())[0] || null; }

  speak(text, { voiceName, rate = 0.92, pause = 380, onStart, onEnd } = {}) {
    if (!voiceSupported.tts || !text) { onEnd && onEnd(); return; }
    this.stopSpeaking();
    // One utterance per sentence, with a short breath between them. Each sentence is cleaned so the voice never
    // reads punctuation or symbols aloud (some voices say "dot", "end" or "point" for a trailing full stop).
    const sentences = (text.match(/[^.!?]+[.!?]*/g) || [text]).map(speakable).filter(Boolean);
    // Very long sentences get split at commas so Chrome doesn't cut them off.
    const parts = sentences.flatMap((x) => (x.length <= 230 ? [x] : x.split(/(?<=,)\s+/).reduce((acc, p) => { const l = acc.length - 1; if (l >= 0 && acc[l].length + p.length < 230) acc[l] += ' ' + p; else acc.push(p); return acc; }, [])));
    if (!parts.length) { onEnd && onEnd(); return; }
    const voice = this.voices().find((v) => v.name === voiceName) || this.bestVoice();
    const run = (this._run = (this._run || 0) + 1); // a newer speak() or stopSpeaking() cancels this one
    const next = (i) => {
      if (run !== this._run) return;
      if (i >= parts.length) { onEnd && onEnd(); return; }
      const u = new SpeechSynthesisUtterance(parts[i]);
      if (voice) u.voice = voice;
      u.lang = voice ? voice.lang : this.lang;
      u.rate = rate;
      u.pitch = 1;
      if (i === 0) u.onstart = () => onStart && onStart();
      const after = () => { if (run !== this._run) return; this._timer = setTimeout(() => next(i + 1), i < parts.length - 1 ? pause : 0); };
      u.onend = after; u.onerror = after;
      speechSynthesis.speak(u);
    };
    next(0);
  }

  stopSpeaking() {
    this._run = (this._run || 0) + 1;
    clearTimeout(this._timer);
    if (voiceSupported.tts) speechSynthesis.cancel();
  }
}

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
  if (/\b(andrew|brian|guy|christopher|eric|roger|steffan|ryan|thomas|daniel|arthur|evan|nathan|aaron|tom|oliver|jamie|alex)\b/i.test(v.name)) s += 15;
  if (/en[-_](us|gb|ca|au)/i.test(v.lang)) s += 8;
  if (v.localService === false) s += 5;
  return s;
}
export function rankVoices(list) { return list.filter((v) => voiceScore(v) > -500).sort((a, b) => voiceScore(b) - voiceScore(a)); }

// Turn a chunk of reply text into something a speech engine reads naturally.
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

