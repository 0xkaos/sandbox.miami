import { clamp, sampleFor } from './performance.mjs';

const SAMPLE_BASE = 'https://tambien.github.io/Piano/audio/';
const CACHE_NAME = 'piano-motion-salamander-v1';
export const DECODED_BUDGET = 192 * 1024 * 1024;
export const releaseSeconds = midi => clamp(0.48 + (72 - midi) * 0.01, 0.22, 1.1);
export const bufferBytes = buffer => buffer.length * buffer.numberOfChannels * 4;

export function sampleRequirements(performance, layers, position = 0, ahead = Infinity, speed = 1) {
  const needed = new Map();
  const need = (key, seconds) => needed.set(key, Math.max(needed.get(key) || 0, seconds));
  for (const note of performance.notes) {
    if (note.time > position + ahead) break;
    if (note.end < position) continue;
    const sample = sampleFor(note, layers);
    need(sample.key, ((note.end - note.time) / speed + releaseSeconds(note.midi) + 0.08) * sample.rate);
    if (note.keyEnd >= position) need(`rel${clamp(note.midi - 20, 1, 88)}`, 1.4);
  }
  if (performance.pedals.some(event => event.time >= position && event.time <= position + ahead)) {
    for (const key of ['pedalD1', 'pedalD2', 'pedalU1', 'pedalU2']) need(key, 2);
  }
  return needed;
}

export class SampleCapacityError extends Error {
  constructor() { super('The current passage needs more piano memory. Try 4 velocity layers.'); }
}

// Compressed MP3s stay available for the piece. Only a moving window is decoded into PCM.
export class SampleBank {
  constructor(context, { maxBytes = DECODED_BUDGET, fetchSample } = {}) {
    this.context = context;
    this.maxBytes = maxBytes;
    this.fetchSample = fetchSample || ((key, signal) => this.download(key, signal));
    this.encoded = new Map();
    this.buffers = new Map();
  }

  bytes(active = new Set()) {
    return [...new Set([...this.buffers.values(), ...active])].reduce((sum, buffer) => sum + bufferBytes(buffer), 0);
  }

  retain(keys) {
    for (const key of this.encoded.keys()) if (!keys.has(key)) this.encoded.delete(key);
    for (const key of this.buffers.keys()) if (!keys.has(key)) this.buffers.delete(key);
  }

  async download(key, signal) {
    if (!this.cachePromise) this.cachePromise = (async () => {
      try { return await caches.open(CACHE_NAME); } catch { return null; }
    })();
    const cache = await this.cachePromise;
    const url = SAMPLE_BASE + key + '.mp3';
    const cached = await cache?.match(url);
    signal.throwIfAborted();
    if (cached) return cached.arrayBuffer();
    const timeout = AbortSignal.timeout(25000);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    timeout.addEventListener('abort', cancel, { once: true });
    try {
      const response = await fetch(url, { signal: controller.signal, mode: 'cors' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      signal.throwIfAborted();
      if (cache) await cache.put(url, new Response(data, { headers: { 'Content-Type': 'audio/mpeg' } })).catch(() => {});
      return data;
    } finally {
      signal.removeEventListener('abort', cancel);
      timeout.removeEventListener('abort', cancel);
    }
  }

  async loadEncoded(keys, onProgress, signal) {
    this.retain(new Set(keys));
    let cursor = 0, completed = 0, failed = false;
    const workers = Array.from({ length: 4 }, async () => {
      while (cursor < keys.length && !failed) {
        const key = keys[cursor++];
        signal.throwIfAborted();
        try {
          if (!this.encoded.has(key)) {
            const bytes = await this.fetchSample(key, signal);
            signal.throwIfAborted();
            this.encoded.set(key, bytes);
          }
          onProgress?.(++completed, keys.length, 'download');
        } catch (error) {
          failed = true;
          if (signal.aborted) throw error;
          throw new Error(`Could not load piano sample ${key}. Check your connection and press Play to retry.`);
        }
      }
    });
    const results = await Promise.allSettled(workers);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  }

  ready(requirements) {
    return [...requirements].every(([key, seconds]) => {
      const buffer = this.buffers.get(key);
      return buffer && (buffer.completeSample || buffer.duration + 0.001 >= seconds);
    });
  }

  async prepare(requirements, activeBuffers, signal, onProgress) {
    let completed = 0;
    // Serial decoding bounds temporary full-length PCM allocations, including on mobile.
    for (const [key, seconds] of requirements) {
      signal.throwIfAborted();
      const existing = this.buffers.get(key);
      if (!existing || (!existing.completeSample && existing.duration + 0.001 < seconds)) {
        const encoded = this.encoded.get(key);
        if (!encoded) throw new Error(`Piano sample ${key} is unavailable. Press Play to retry.`);
        let decoded;
        try {
          // decodeAudioData detaches its argument; keep the original MP3 for future windows.
          decoded = await this.context.decodeAudioData(encoded.slice(0));
        } catch {
          throw new Error(`Could not decode piano sample ${key}. Reload the page to retry.`);
        }
        signal.throwIfAborted();
        const length = Math.min(decoded.length, Math.ceil(seconds * decoded.sampleRate));
        const bytes = length * decoded.numberOfChannels * 4;
        const active = activeBuffers();
        // Replaced buffers can still belong to ringing voices; count those separately.
        if (existing) this.buffers.delete(key);
        for (const [oldKey, oldBuffer] of this.buffers) {
          if (this.bytes(active) + bytes <= this.maxBytes) break;
          if (!requirements.has(oldKey) && !active.has(oldBuffer)) this.buffers.delete(oldKey);
        }
        if (this.bytes(active) + bytes > this.maxBytes) {
          if (existing) this.buffers.set(key, existing);
          throw new SampleCapacityError();
        }
        const buffer = length === decoded.length ? decoded : this.context.createBuffer(decoded.numberOfChannels, length, decoded.sampleRate);
        if (buffer !== decoded) {
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            buffer.copyToChannel(decoded.getChannelData(channel).subarray(0, length), channel);
          }
        }
        buffer.completeSample = length === decoded.length;
        this.buffers.set(key, buffer);
      } else {
        // Map insertion order is the least-recently-used eviction order.
        this.buffers.delete(key); this.buffers.set(key, existing);
      }
      onProgress?.(++completed, requirements.size, 'decode');
    }
  }
}
