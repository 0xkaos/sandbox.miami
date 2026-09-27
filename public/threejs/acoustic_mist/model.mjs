import { WaveChamber, clamp } from '../acoustic_chamber/physics.mjs?v=5';
import { captureField } from '../acoustic_chamber/snapshot.mjs';

// The same source as Field Studio's example, now evolving continuously.
export const MIST_DEFAULTS = Object.freeze({ resolution:56, frequency:138, reflection:0.96, harmonics:true, slow:50 });

export class MistSimulation {
    constructor(config = {}, smoothing = 1) {
        this.field = new WaveChamber({ ...MIST_DEFAULTS, ...config });
        this.remainder = 0;
        this.referenceEnergy = 0.00001;
        this.setSmoothing(smoothing);
        this.scratch = [new Float32Array(this.field.size), new Float32Array(this.field.size)];
    }
    setSmoothing(value) { this.smoothing = Number.isFinite(+value) ? clamp(Math.round(+value), 0, 4) : 1; }
    tune(changes) { this.field.tune(changes); }
    burst() { this.field.burst(); }
    frame(seconds = 0, recycledBuffer) {
        const field = this.field, start = performance.now();
        let steps = 0;
        // Bound catch-up work. A paused refresh must never consume leftover time.
        if (Number.isFinite(seconds) && seconds > 0) {
            this.remainder += Math.min(seconds, 0.05) / field.config.slow;
            steps = Math.min(24, Math.floor(this.remainder / field.dt));
            this.remainder = Math.min(this.remainder - steps * field.dt, field.dt * 24);
            field.step(steps);
        }
        let sum = 0;
        for (const i of field.interior) sum += field.meanSquare[i];
        field.meanEnergy = sum / field.interior.length;
        this.referenceEnergy = Math.max(this.referenceEnergy, field.meanEnergy);
        const activity = Math.sqrt(field.meanEnergy / this.referenceEnergy);
        const scale = Math.max(field.meanEnergy, 1e-20);
        let [source, target] = this.scratch;
        for (let i = 0; i < field.size; i++) source[i] = field.meanSquare[i] / scale;
        // Reuse the solver's neighbors for the same mask-aware smoothing as Studio.
        for (let pass = 0; pass < this.smoothing; pass++) {
            target.set(source);
            for (const i of field.interior) {
                let value = source[i] * 4, weight = 4;
                for (let side = 0; side < 6; side++) {
                    const j = field.neighbors[side][i];
                    if (j >= 0 && field.mask[j] === 1) { value += source[j]; weight++; }
                }
                target[i] = value / weight;
            }
            [source, target] = [target, source];
        }
        const values = recycledBuffer instanceof ArrayBuffer && recycledBuffer.byteLength === field.size * 4
            ? new Float32Array(recycledBuffer) : new Float32Array(field.size);
        values.set(source);
        return { values, time:field.time, energy:field.meanEnergy, activity, steps, compute:performance.now()-start };
    }
    capture(name, view) {
        const snapshot = captureField(this.field, name);
        snapshot.meta.view = view;
        return snapshot;
    }
}
