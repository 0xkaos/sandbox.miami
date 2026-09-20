import { clamp, lowerBound, sampleFor } from './performance.mjs';

const SAMPLE_BASE = 'https://tambien.github.io/Piano/audio/';
const CACHE_NAME = 'piano-motion-salamander-v1';
const MAX_MEMORY = 240 * 1024 * 1024;

export class GrandPiano {
  constructor(onState) {
    this.onState = onState;
    this.buffers = new Map();
    this.voices = new Set();
    this.position = 0;
    this.speed = 1;
    this.playing = false;
    this.layers = 16;
    this.room = 0.22;
    this.volume = 0.7;
    this.mechanics = 0.28;
  }

  async unlock() {
    if (!this.context) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error('This browser does not support Web Audio. Try a current Safari, Firefox, or Chrome.');
      this.context = new Audio({ latencyHint: 'playback', sampleRate: 44100 });
      const ctx = this.context;
      this.input = ctx.createGain();
      this.noise = ctx.createGain();
      this.dry = ctx.createGain();
      this.wet = ctx.createGain();
      this.master = ctx.createGain();
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -5;
      this.compressor.knee.value = 8;
      this.compressor.ratio.value = 8;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.2;
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = makeRoom(ctx);
      this.input.connect(this.dry).connect(this.compressor);
      this.input.connect(this.reverb).connect(this.wet).connect(this.compressor);
      this.noise.connect(this.input);
      this.compressor.connect(this.master).connect(ctx.destination);
      this.setMix();
    }
    await this.context.resume();
    if (this.context.state !== 'running') throw new Error('Audio is suspended. Press Play again to enable sound.');
  }

  setMix() {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(this.volume * 0.8, now, 0.03);
    this.dry.gain.setTargetAtTime(1 - this.room * 0.22, now, 0.03);
    this.wet.gain.setTargetAtTime(this.room * 0.65, now, 0.03);
    this.noise.gain.setTargetAtTime(this.mechanics, now, 0.03);
  }

  async load(performance, layers, onProgress, signal) {
    this.pause();
    this.performance = performance;
    this.layers = layers;
    // Retain only the portion a piece can use; pitch shifts and slower tempo need extra source audio.
    const needed = new Map();
    const need = (key, seconds) => needed.set(key, Math.max(needed.get(key) || 0, seconds));
    for (const note of performance.notes) {
      const sample = sampleFor(note, layers);
      need(sample.key, ((note.end - note.time) / 0.5 + 2.8) * sample.rate);
      need(`rel${clamp(note.midi - 20, 1, 88)}`, 1.4);
    }
    if (performance.pedals.length) ['pedalD1', 'pedalD2', 'pedalU1', 'pedalU2'].forEach(key => need(key, 2));
    for (const key of this.buffers.keys()) if (!needed.has(key)) this.buffers.delete(key);
    let memory = [...this.buffers.values()].reduce((sum, buffer) => sum + buffer.length * buffer.numberOfChannels * 4, 0);
    let cache;
    try { cache = await caches.open(CACHE_NAME); } catch { /* Private browsing can disable CacheStorage. */ }
    const queue = [...needed.entries()];
    let completed = 0, cursor = 0, failed = false;
    const workers = Array.from({ length: 4 }, async () => {
      while (cursor < queue.length && !failed) {
        signal.throwIfAborted();
        const [key, seconds] = queue[cursor++];
        const existing = this.buffers.get(key);
        if (!existing || (existing.duration + 0.05 < seconds && !existing.completeSample)) {
          try {
            const url = SAMPLE_BASE + key + '.mp3';
            let response = await cache?.match(url);
            if (!response) {
              const timeout = AbortSignal.timeout(25000);
              const controller = new AbortController();
              const cancel = () => controller.abort();
              signal.addEventListener('abort', cancel, { once: true });
              timeout.addEventListener('abort', cancel, { once: true });
              try {
                response = await fetch(url, { signal: controller.signal, mode: 'cors' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                // Await the body so a timeout covers the entire download.
                const data = await response.arrayBuffer();
                response = new Response(data, { headers: { 'Content-Type': 'audio/mpeg' } });
                if (cache) await cache.put(url, response.clone()).catch(() => {});
              } finally {
                signal.removeEventListener('abort', cancel);
                timeout.removeEventListener('abort', cancel);
              }
            }
            const decoded = await this.context.decodeAudioData(await response.arrayBuffer());
            signal.throwIfAborted();
            const length = Math.min(decoded.length, Math.ceil(seconds * decoded.sampleRate));
            memory -= existing ? existing.length * existing.numberOfChannels * 4 : 0;
            memory += length * decoded.numberOfChannels * 4;
            if (memory > MAX_MEMORY) throw new Error('This piece needs too much sample memory. Choose 4 velocity layers or fewer tracks.');
            const buffer = this.context.createBuffer(decoded.numberOfChannels, length, decoded.sampleRate);
            for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
              buffer.copyToChannel(decoded.getChannelData(channel).subarray(0, length), channel);
            }
            buffer.completeSample = length === decoded.length;
            this.buffers.set(key, buffer);
          } catch (error) {
            failed = true;
            if (signal.aborted) throw error;
            throw new Error(error.message.includes('sample memory') ? error.message : `Could not load piano sample ${key}. Check your connection and press Play to retry.`);
          }
        }
        onProgress(++completed, queue.length);
      }
    });
    const results = await Promise.allSettled(workers);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    this.memoryMB = Math.round(memory / 1024 / 1024);
  }

  get time() {
    if (!this.playing) return this.position;
    return clamp(this.position + (this.context.currentTime - this.origin) * this.speed, 0, this.performance.duration);
  }

  play() {
    if (!this.performance?.notes.length) return;
    if (this.position >= this.performance.duration - 0.03) this.position = 0;
    this.origin = this.context.currentTime + 0.075;
    this.playing = true;
    this.noteIndex = lowerBound(this.performance.notes, this.position);
    this.pedalIndex = lowerBound(this.performance.pedals, this.position);
    // Reconstruct sounding strings when seeking/resuming, without replaying their attacks.
    for (let i = 0; i < this.noteIndex; i++) {
      const note = this.performance.notes[i];
      if (note.end > this.position) this.scheduleNote(note, this.origin, (this.position - note.time) / this.speed);
    }
    this.lastTick = this.context.currentTime;
    this.tick();
    this.timer = setInterval(() => this.tick(), 25);
    this.onState?.('playing');
  }

  tick() {
    const now = this.context.currentTime;
    if (now - this.lastTick > 0.5) {
      this.pause();
      this.onState?.('interrupted');
      return;
    }
    this.lastTick = now;
    const horizon = this.time + 0.2 * this.speed;
    while (this.noteIndex < this.performance.notes.length && this.performance.notes[this.noteIndex].time <= horizon) {
      const note = this.performance.notes[this.noteIndex++];
      const at = this.origin + (note.time - this.position) / this.speed;
      this.scheduleNote(note, Math.max(now, at), Math.max(0, now - at));
    }
    while (this.pedalIndex < this.performance.pedals.length && this.performance.pedals[this.pedalIndex].time <= horizon) {
      const event = this.performance.pedals[this.pedalIndex++];
      const at = this.origin + (event.time - this.position) / this.speed;
      this.oneShot(`pedal${event.down ? 'D' : 'U'}${this.pedalIndex % 2 + 1}`, Math.max(now, at), 0.11);
    }
    if (this.time >= this.performance.duration) {
      this.pause();
      this.position = this.performance.duration;
      this.onState?.('ended');
    }
  }

  scheduleNote(note, at, elapsed = 0) {
    const { key, rate, layer } = sampleFor(note, this.layers);
    const buffer = this.buffers.get(key);
    const offset = elapsed * rate;
    if (!buffer || offset >= buffer.duration) return;
    const duration = Math.max(0.02, (note.end - note.time) / this.speed - elapsed);
    // The recordings already contain the timbral dynamics; only interpolate gain within a layer.
    const gain = 0.7 * clamp((note.velocity * 16 + 0.5) / (layer + 0.5), 0.25, 1.45);
    const release = clamp(0.48 + (72 - note.midi) * 0.01, 0.22, 1.1);
    this.source(buffer, at, offset, rate, gain, duration, release, this.input);
    const keyTime = at + (note.keyEnd - note.time) / this.speed - elapsed;
    if (keyTime >= at) this.oneShot(`rel${clamp(note.midi - 20, 1, 88)}`, keyTime, 0.024 * note.velocity);
  }

  oneShot(key, at, gain) {
    const buffer = this.buffers.get(key);
    if (buffer) this.source(buffer, at, 0, 1, gain, buffer.duration, 0.02, this.noise);
  }

  source(buffer, at, offset, rate, volume, duration, release, destination) {
    const ctx = this.context;
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const audible = Math.min(duration, (buffer.duration - offset) / rate);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + (offset ? 0.025 : 0.003));
    gain.gain.setValueAtTime(volume, at + Math.max(0.03, audible));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.03, audible) + release);
    source.connect(gain).connect(destination);
    const voice = { source, gain };
    this.voices.add(voice);
    source.onended = () => { source.disconnect(); gain.disconnect(); this.voices.delete(voice); };
    source.start(at, offset);
    source.stop(at + Math.max(0.03, audible) + release + 0.02);
  }

  pause() {
    this.position = this.time;
    this.playing = false;
    clearInterval(this.timer);
    if (this.context) {
      const now = this.context.currentTime;
      for (const { source, gain } of this.voices) {
        gain.gain.cancelAndHoldAtTime(now);
        gain.gain.linearRampToValueAtTime(0, now + 0.025);
        source.stop(now + 0.03);
      }
    }
    this.onState?.('paused');
  }

  seek(position) {
    const resume = this.playing;
    this.pause();
    this.position = clamp(position, 0, this.performance?.duration || 0);
    if (resume) this.play();
  }

  setSpeed(speed) {
    const resume = this.playing;
    this.pause();
    this.speed = speed;
    if (resume) this.play();
  }
}

function makeRoom(ctx) {
  const duration = 2.6;
  const buffer = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  let seed = 813;
  for (let channel = 0; channel < 2; channel++) {
    const samples = buffer.getChannelData(channel);
    let low = 0;
    for (let i = 0; i < samples.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      low = low * 0.6 + (seed / 2147483648) * 0.4;
      const time = i / ctx.sampleRate;
      samples[i] = time < 0.018 ? 0 : low * Math.exp(-time * 3.2) * 0.5;
    }
    [0.027, 0.043, 0.071, 0.113].forEach((time, index) => {
      samples[Math.floor((time + channel * 0.003) * ctx.sampleRate)] += 0.6 / (index + 1);
    });
  }
  return buffer;
}
