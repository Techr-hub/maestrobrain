// Browser voice: Web Speech API for speech-to-text and text-to-speech, plus a mic level meter
// that drives the pulsing avatar. Works best in Chrome and Edge (Safari partially, Firefox has no recognition).
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voiceSupported = { stt: !!SR, tts: 'speechSynthesis' in window };

export class Voice {
  constructor({ onInterim, onFinal, onState, onLevel, lang = 'en-US' }) {
    Object.assign(this, { onInterim, onFinal, onState, onLevel, lang });
    this.listening = false;
    this.handsFree = false;
    this.wakeName = 'jarvis';
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
          const re = new RegExp(`^(?:hey |ok |okay )?${this.wakeName}[,.!]?\\s*`, 'i');
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

  speak(text, { voiceName, rate = 1, onStart, onEnd } = {}) {
    if (!voiceSupported.tts || !text) { onEnd && onEnd(); return; }
    speechSynthesis.cancel();
    // Speak in sentence-sized chunks: long utterances get cut off in Chrome.
    const chunks = text.match(/[^.!?]+[.!?]*/g) || [text];
    const voice = this.voices().find((v) => v.name === voiceName) || this.voices().find((v) => /en[-_]GB/i.test(v.lang) && /male|daniel|arthur|george/i.test(v.name)) || null;
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk.trim());
      if (voice) u.voice = voice;
      u.rate = rate; u.lang = this.lang;
      if (i === 0) u.onstart = () => onStart && onStart();
      if (i === chunks.length - 1) { u.onend = () => onEnd && onEnd(); u.onerror = () => onEnd && onEnd(); }
      speechSynthesis.speak(u);
    });
  }

  stopSpeaking() { if (voiceSupported.tts) speechSynthesis.cancel(); }
}
