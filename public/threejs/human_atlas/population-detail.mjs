import { bracket, mix } from './model.mjs';

export const POPULATION_RESOLUTIONS = [1, .5, .25];

// The optional grids download only adjoining dates, with a small bounded cache.
// Cancel superseded requests when scrubbing, and never apply a stale response.
export class PopulationDetail {
  constructor(meta, root, onChange, fetcher = fetch) {
    this.meta = meta; this.root = root; this.onChange = onChange; this.fetcher = (...args) => fetcher(...args);
    this.frames = new Map(); this.buffer = new Float32Array(meta.cells.length);
    this.pending = null; this.failure = null; this.disposed = false;
  }
  async loadFrame(index, signal) {
    if (this.frames.has(index)) return this.frames.get(index);
    const response = await this.fetcher(`${this.root}/${this.meta.frames[index].file}`, { signal });
    if (!response.ok) throw new Error(`Population detail could not load (${response.status}).`);
    const binary = await response.arrayBuffer();
    if (binary.byteLength !== this.meta.cells.length * 4) throw new Error('Population detail is incomplete.');
    const values = new Float32Array(binary);
    if (signal.aborted || this.disposed) return values;
    this.frames.set(index, values);
    while (this.frames.size > 8) this.frames.delete(this.frames.keys().next().value);
    return values;
  }
  sample(year) {
    const b = bracket(this.meta.years, year);
    if (!b) { this.cancel(); return { populations: null, year }; }
    const key = `${b.a}/${b.b}`;
    if (this.pending && this.pending.key !== key) this.cancel();
    if (this.frames.has(b.a) && this.frames.has(b.b)) {
      const a = this.frames.get(b.a), z = this.frames.get(b.b);
      // Touch the current pair so prefetch and distant jumps cannot evict it.
      for (const i of [b.a, b.b]) { const f = this.frames.get(i); this.frames.delete(i); this.frames.set(i, f); }
      for (let i = 0; i < a.length; i++) this.buffer[i] = mix(a[i], z[i], b.t);
      if (b.t > .5 && b.b + 1 < this.meta.years.length && !this.frames.has(b.b + 1) && !this.prefetch) {
        const controller = new AbortController(); this.prefetch = controller;
        this.loadFrame(b.b + 1, controller.signal).catch(() => {}).finally(() => { if (this.prefetch === controller) this.prefetch = null; });
      }
      return { populations: this.buffer, year };
    }
    if (this.failure?.key === key) return { error: this.failure.message };
    if (!this.pending) {
      const controller = new AbortController();
      const pending = { key, controller }; this.pending = pending;
      this.failure = null;
      Promise.all([...new Set([b.a, b.b])].map(i => this.loadFrame(i, controller.signal))).then(() => {
        if (this.pending !== pending || this.disposed) return;
        this.pending = null; this.onChange();
      }).catch(error => {
        if (this.pending !== pending || this.disposed || error.name === 'AbortError') return;
        this.pending = null; this.failure = { key, message: `${error.message} Choose another resolution to retry.` }; this.onChange();
      });
    }
    return { loading: true };
  }
  cancel() { this.pending?.controller.abort(); this.pending = null; }
  dispose() { this.disposed = true; this.cancel(); this.prefetch?.abort(); this.frames.clear(); }
}
