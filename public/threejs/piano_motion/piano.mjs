import { clamp, lowerBound, sampleFor } from './performance.mjs';

import { SampleBank, SampleCapacityError, releaseSeconds, sampleRequirements } from './sample-bank.mjs';

export class GrandPiano {
  constructor(onState) {
    this.onState = onState;
    this.buffers = new Map();
    this.voices = new Set();
    this.position = 0;
    this.speed = 1;
    this.playing = false;
    this.wantPlay = false;
    this.buffering = false;
    this.nextPrepareTime = 0;
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
      this.bank = new SampleBank(ctx);
      this.buffers = this.bank.buffers;
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
    await this.preparation?.catch(() => {});
    signal.throwIfAborted();
    this.performance = performance;
    this.layers = layers;
    const keys = [...sampleRequirements(performance, layers).keys()];
    await this.bank.loadEncoded(keys, onProgress, signal);
    await this.requestWindow(this.position, signal, onProgress);
  }

  activeBuffers() {
    return new Set([...this.voices].map(({ source }) => source.buffer).filter(Boolean));
  }

  get memoryMB() {
    return Math.round((this.bank?.bytes(this.activeBuffers()) || 0) / 1024 / 1024);
  }

  windowReady(position, ahead = 0.2 * this.speed) {
    return this.bank?.ready(sampleRequirements(this.performance, this.layers, position, ahead, this.speed));
  }

  async requestWindow(position, signal, onProgress) {
    const previous = this.preparation;
    this.prepareController?.abort();
    const controller = this.prepareController = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const performance = this.performance, layers = this.layers, speed = this.speed;
    const task = (async () => {
      await previous?.catch(() => {});
      controller.signal.throwIfAborted();
      for (let ahead = 12; ahead >= 0.75; ahead /= 2) {
        try {
          const required = sampleRequirements(performance, layers, position, ahead, speed);
          await this.bank.prepare(required, () => this.activeBuffers(), controller.signal, onProgress);
          this.nextPrepareTime = position + ahead / 4;
          return;
        } catch (error) {
          if (!(error instanceof SampleCapacityError) || ahead === 0.75) throw error;
          // Dense passages need a shorter lookahead, without reducing sample quality.
        }
      }
    })();
    this.preparation = task;
    try { await task; }
    finally {
      signal?.removeEventListener('abort', cancel);
      if (this.preparation === task) this.preparation = null;
    }
  }

  bufferAndResume() {
    this.stopAudio();
    this.buffering = true;
    this.onState?.('buffering');
    const task = this.requestWindow(this.position);
    const controller = this.prepareController;
    task.then(() => {
      if (controller.signal.aborted || !this.wantPlay) return;
      if (this.context.state !== 'running') {
        this.pause(); this.onState?.('interrupted'); return;
      }
      this.startAudio();
    }).catch(error => {
      if (!controller.signal.aborted) { this.pause(); this.onState?.('error', error.message); }
    });
  }

  prefetch() {
    const task = this.requestWindow(this.time);
    const controller = this.prepareController;
    task.catch(error => {
      if (!controller.signal.aborted) { this.pause(); this.onState?.('error', error.message); }
    });
  }

  get time() {
    if (!this.playing) return this.position;
    return clamp(this.position + Math.max(0, this.context.currentTime - this.origin) * this.speed, 0, this.performance.duration);
  }

  play() {
    if (!this.performance?.notes.length || this.playing || this.buffering) return;
    if (this.position >= this.performance.duration - 0.03) this.position = this.nextPrepareTime = 0;
    this.wantPlay = true;
    if (this.windowReady(this.position)) this.startAudio();
    else this.bufferAndResume();
  }

  startAudio() {
    this.buffering = false;
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
    this.onState?.('playing');
    this.tick();
    if (this.playing) this.timer = setInterval(() => this.tick(), 25);
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
    if (!this.windowReady(this.time)) { this.bufferAndResume(); return; }
    if (!this.preparation && this.time >= this.nextPrepareTime) this.prefetch();
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
    const release = releaseSeconds(note.midi);
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

  stopAudio() {
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
  }

  pause() {
    this.wantPlay = false;
    this.buffering = false;
    this.prepareController?.abort();
    this.stopAudio();
    this.nextPrepareTime = this.position;
    this.onState?.('paused');
  }

  seek(position) {
    const resume = this.wantPlay;
    this.pause();
    this.position = clamp(position, 0, this.performance?.duration || 0);
    this.nextPrepareTime = this.position;
    if (resume) this.play();
  }

  setSpeed(speed) {
    const resume = this.wantPlay;
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
