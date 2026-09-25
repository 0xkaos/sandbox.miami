export const SOUND_SPEED = 343;
export const COURANT = 0.48; // Below the 3D six-neighbor limit, 1 / sqrt(3).
export const DEFAULTS = Object.freeze({ shape: 'box', length: 3.6, height: 2.2, depth: 2.6,
    resolution: 40, frequency: 240, amplitude: 1, reflection: 0.38, opening: false,
    harmonics: false, harmonic2: 0.5, harmonic3: 0.3, harmonic4: 0.15,
    openingSize: 1.4, count: 48000, layers: 'bands', mobility: 1, drive: 'continuous', slow: 100, seed: 1847 });
export const PARTICLE_BANDS = Object.freeze([
    { energy: 0, color: [244, 229, 196] },
    { energy: 0.18, color: [81, 204, 235] },
    { energy: 0.55, color: [238, 128, 164] },
]);
export const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
const numeric = (value, fallback, min, max) => clamp(Number.isFinite(Number(value)) ? Number(value) : fallback, min, max);

export function configure(input = {}) {
    const c = { ...DEFAULTS, ...input };
    c.shape = ['box', 'cylinder', 'taper'].includes(c.shape) ? c.shape : 'box';
    c.length = numeric(c.length, 3.6, 1.6, 6);
    c.height = numeric(c.height, 2.2, 0.8, 4);
    c.depth = numeric(c.depth, 2.6, 0.8, 4);
    c.resolution = [32, 40, 56].includes(Number(c.resolution)) ? Number(c.resolution) : 40;
    c.amplitude = numeric(c.amplitude, 1, 0, 2);
    c.reflection = numeric(c.reflection, 0.38, 0, 1);
    c.opening = Boolean(c.opening);
    c.openingSize = numeric(c.openingSize, 1.4, 0.15, Math.min(c.height * (c.shape === 'taper' ? 0.58 : 0.92), c.depth * 0.92));
    c.count = Math.round(numeric(c.count, 48000, 1000, 500000));
    c.layers = c.layers === 'nodes' ? 'nodes' : 'bands';
    c.mobility = numeric(c.mobility, 1, 0, 3);
    c.drive = c.drive === 'burst' ? 'burst' : 'continuous';
    c.slow = numeric(c.slow, 100, 40, 250);
    c.seed = Number(c.seed) >>> 0;
    c.cell = Math.max(c.length, c.height, c.depth) / c.resolution;
    c.maxFrequency = Math.floor(SOUND_SPEED / (c.cell * 9));
    c.harmonics = Boolean(c.harmonics);
    for (let n = 2; n <= 4; n++) c[`harmonic${n}`] = numeric(c[`harmonic${n}`], DEFAULTS[`harmonic${n}`], 0, 1);
    const levels = c.harmonics ? [1, c.harmonic2, c.harmonic3, c.harmonic4] : [1];
    const total = levels.reduce((sum, level) => sum + level, 0);
    c.partials = levels.map((level, index) => ({ multiple: index + 1, gain: level / total })).filter(partial => partial.gain > 0);
    c.maxFundamental = Math.floor(c.maxFrequency / c.partials.at(-1).multiple);
    c.frequency = numeric(c.frequency, 240, 40, c.maxFundamental);
    return c;
}

export function insideChamber(c, x, y, z, margin = 0) {
    if (Math.abs(x) > c.length / 2 - margin) return false;
    const h = c.height * (c.shape === 'taper' ? 1 - 0.4 * (x / c.length + 0.5) : 1) / 2 - margin;
    const d = c.depth / 2 - margin;
    if (h <= 0 || d <= 0) return false;
    return c.shape === 'cylinder' ? (y / h) ** 2 + (z / d) ** 2 < 1 : Math.abs(y) < h && Math.abs(z) < d;
}

export function seededRandom(seed) {
    let state = seed >>> 0;
    return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

export class WaveChamber {
    constructor(options) {
        this.config = configure(options);
        const c = this.config, h = c.cell;
        this.interiorX = Math.ceil(c.length / h - 1e-8);
        this.exteriorX = Math.max(8, Math.ceil(c.resolution * 0.3));
        this.nx = this.interiorX + this.exteriorX + 1;
        this.ny = Math.ceil(c.height / h - 1e-8);
        this.nz = Math.ceil(c.depth / h - 1e-8);
        this.size = this.nx * this.ny * this.nz;
        this.min = [-c.length / 2, -this.ny * h / 2, -this.nz * h / 2];
        this.max = [this.min[0] + this.nx * h, this.ny * h / 2, this.nz * h / 2];
        this.dt = COURANT * h / SOUND_SPEED;
        this.time = this.phase = 0;
        this.burstStart = 0;
        this.pressure = new Float32Array(this.size);
        this.previous = new Float32Array(this.size);
        this.next = new Float32Array(this.size);
        this.meanSquare = new Float32Array(this.size);
        this.mask = new Uint8Array(this.size);
        this.wallFaces = new Uint8Array(this.size);
        this.exitFaces = new Uint8Array(this.size);
        this.damping = new Float32Array(this.size);
        this.neighbors = Array.from({ length: 6 }, () => new Int32Array(this.size).fill(-1));
        this.gradient = Array.from({ length: 3 }, () => new Float32Array(this.size));
        this.source = [];
        const active = [], interior = [];
        for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++) {
            const i = this.index(x, y, z), p = this.position(x, y, z);
            const inside = x < this.interiorX && insideChamber(c, Math.min(p[0], c.length / 2 - 1e-6), p[1], p[2]);
            const aperture = x === this.interiorX && c.opening && Math.hypot(p[1], p[2]) < c.openingSize / 2;
            const exterior = x > this.interiorX;
            if (!inside && !aperture && !exterior) continue;
            this.mask[i] = inside ? 1 : 2;
            active.push(i);
            if (inside) interior.push(i);
            if (inside && x === 0) {
                const radius = this.hornRadius;
                const distance = Math.hypot(p[1], p[2]) / radius;
                if (distance < 1) this.source.push([i, Math.cos(distance * Math.PI / 2) ** 2]);
            }
        }
        this.active = Int32Array.from(active);
        this.interior = Int32Array.from(interior);
        const directions = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
        for (const i of this.active) {
            const [x, y, z] = this.coordinates(i);
            directions.forEach(([dx, dy, dz], side) => {
                const a = x + dx, b = y + dy, d = z + dz;
                const j = a >= 0 && a < this.nx && b >= 0 && b < this.ny && d >= 0 && d < this.nz ? this.index(a, b, d) : -1;
                if (j >= 0 && this.mask[j]) this.neighbors[side][i] = j;
                else if (x > this.interiorX && (a >= this.nx || b < 0 || b >= this.ny || d < 0 || d >= this.nz)) this.exitFaces[i]++;
                else this.wallFaces[i]++;
            });
        }
        this.updateDamping();
        this.meanEnergy = 0;
    }
    get hornRadius() { return Math.min(this.config.height, this.config.depth) * 0.19; }
    index(x, y, z) { return x + this.nx * (y + this.ny * z); }
    coordinates(i) { const z = Math.floor(i / (this.nx * this.ny)); const rem = i - z * this.nx * this.ny; return [rem % this.nx, Math.floor(rem / this.nx), z]; }
    position(x, y, z) { return [this.min[0] + (x + 0.5) * this.config.cell, this.min[1] + (y + 0.5) * this.config.cell, this.min[2] + (z + 0.5) * this.config.cell]; }
    updateDamping() {
        // A locally reacting wall: admittance beta=(1-R)/(1+R).
        // R=1 gives beta=0: perfectly reflecting walls, with bulk loss retained.
        // Pressure damping is centered in time, keeping loss passive and stable.
        const beta = (1 - this.config.reflection) / (1 + this.config.reflection);
        for (const i of this.active) {
            const [x, y, z] = this.coordinates(i);
            let sponge = 0;
            if (x > this.interiorX) {
                const edge = Math.max((x - this.interiorX) / this.exteriorX, 1 - Math.min(y, this.ny - 1 - y, z, this.nz - 1 - z) / 4);
                sponge = 0.18 * clamp(edge, 0, 1) ** 3;
            }
            this.damping[i] = COURANT * (this.wallFaces[i] * beta + this.exitFaces[i]) * 0.5 + sponge + 0.00012;
        }
    }
    tune(changes) {
        const oldReflection = this.config.reflection;
        this.config = configure({ ...this.config, ...changes });
        if (this.config.reflection !== oldReflection) this.updateDamping();
    }
    burst() { this.config.drive = 'burst'; this.burstStart = this.time; }
    sourceSignal() {
        const c = this.config, omega = 2 * Math.PI * c.frequency;
        let envelope, derivative, phase = this.phase;
        if (c.drive === 'burst') {
            const age = this.time - this.burstStart, duration = 3 / c.frequency;
            if (age < 0 || age >= duration) return 0;
            envelope = Math.sin(Math.PI * age / duration) ** 2;
            derivative = Math.PI / duration * Math.sin(2 * Math.PI * age / duration);
            phase = omega * age;
        } else {
            const ramp = 2 / c.frequency;
            envelope = 1 - Math.exp(-((this.time / ramp) ** 2));
            derivative = 2 * this.time / (ramp * ramp) * Math.exp(-((this.time / ramp) ** 2));
        }
        // Mix the velocity-source derivatives once per step. All partials share
        // the existing field, so the grid and particle workload do not multiply.
        let signal = 0;
        for (const { multiple, gain } of c.partials) {
            signal += gain * (derivative * Math.sin(multiple * phase) + envelope * multiple * omega * Math.cos(multiple * phase));
        }
        return c.amplitude * COURANT * this.dt * signal;
    }
    step(count = 1) {
        const lambda2 = COURANT * COURANT, alpha = 1 - Math.exp(-this.dt * this.config.frequency / 2);
        const [xm, xp, ym, yp, zm, zp] = this.neighbors;
        for (let step = 0; step < count; step++) {
            const p = this.pressure, old = this.previous, next = this.next, loss = this.damping;
            for (let k = 0; k < this.active.length; k++) {
                const i = this.active[k], value = p[i];
                const lap = (xm[i] < 0 ? 0 : p[xm[i]] - value) + (xp[i] < 0 ? 0 : p[xp[i]] - value)
                    + (ym[i] < 0 ? 0 : p[ym[i]] - value) + (yp[i] < 0 ? 0 : p[yp[i]] - value)
                    + (zm[i] < 0 ? 0 : p[zm[i]] - value) + (zp[i] < 0 ? 0 : p[zp[i]] - value);
                next[i] = (2 * value - (1 - loss[i]) * old[i] + lambda2 * lap) / (1 + loss[i]);
            }
            const signal = this.sourceSignal();
            for (const [i, weight] of this.source) next[i] += signal * weight / (1 + loss[i]);
            for (let k = 0; k < this.active.length; k++) {
                const i = this.active[k];
                this.meanSquare[i] += alpha * (next[i] * next[i] - this.meanSquare[i]);
            }
            this.previous = p; this.pressure = next; this.next = old;
            this.time += this.dt;
            this.phase = (this.phase + 2 * Math.PI * this.config.frequency * this.dt) % (Math.PI * 2);
        }
    }
    updateGradient() {
        const e = this.meanSquare, [gx, gy, gz] = this.gradient;
        const scale = 0.5 / this.config.cell;
        const n = this.neighbors;
        let sum = 0;
        for (let k = 0; k < this.active.length; k++) {
            const i = this.active[k], v = e[i];
            gx[i] = ((n[1][i] < 0 ? v : e[n[1][i]]) - (n[0][i] < 0 ? v : e[n[0][i]])) * scale;
            gy[i] = ((n[3][i] < 0 ? v : e[n[3][i]]) - (n[2][i] < 0 ? v : e[n[2][i]])) * scale;
            gz[i] = ((n[5][i] < 0 ? v : e[n[5][i]]) - (n[4][i] < 0 ? v : e[n[4][i]])) * scale;
            if (this.mask[i] === 1) sum += v;
        }
        this.meanEnergy = sum / this.interior.length;
    }
    sample(array, x, y, z) {
        const h = this.config.cell;
        const px = clamp((x - this.min[0]) / h - 0.5, 0, this.nx - 1.001);
        const py = clamp((y - this.min[1]) / h - 0.5, 0, this.ny - 1.001);
        const pz = clamp((z - this.min[2]) / h - 0.5, 0, this.nz - 1.001);
        const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
        const a = px - ix, b = py - iy, d = pz - iz, i = this.index(ix, iy, iz);
        const row = this.nx, plane = this.nx * this.ny;
        const low = (array[i] * (1 - a) + array[i + 1] * a) * (1 - b) + (array[i + row] * (1 - a) + array[i + row + 1] * a) * b;
        const high = (array[i + plane] * (1 - a) + array[i + plane + 1] * a) * (1 - b)
            + (array[i + plane + row] * (1 - a) + array[i + plane + row + 1] * a) * b;
        return low * (1 - d) + high * d;
    }
    encode() {
        const data = new Uint8Array(this.size * 4);
        for (let i = 0; i < this.size; i++) {
            data[i * 4] = Math.round(clamp(0.5 + this.pressure[i] * 2.5, 0, 1) * 255);
            data[i * 4 + 1] = Math.round(clamp(Math.sqrt(this.meanSquare[i]) * 5, 0, 1) * 255);
            data[i * 4 + 2] = this.mask[i] ? 255 : 0;
            data[i * 4 + 3] = this.mask[i] === 1 ? 255 : 0;
        }
        return data;
    }
    energy() {
        let sum = 0;
        for (const i of this.active) sum += this.pressure[i] ** 2 + ((this.pressure[i] - this.previous[i]) / COURANT) ** 2;
        return sum;
    }
    metadata() { return { config: this.config, dimensions: [this.nx, this.ny, this.nz], min: this.min, max: this.max, dt: this.dt, hornRadius: this.hornRadius }; }
}

export class ParticleCloud {
    constructor(field, count = field.config.count, seed = field.config.seed) {
        this.field = field;
        this.count = count;
        this.random = seededRandom(seed);
        this.positions = new Float32Array(count * 3);
        this.velocities = new Float32Array(count * 3);
        this.colors = new Uint8Array(count * 3);
        for (let i = 0; i < count; i++) this.respawn(i);
    }
    respawn(i) {
        const c = this.field.config, j = i * 3;
        let x, y, z;
        do { x = (this.random() - 0.5) * c.length; y = (this.random() - 0.5) * c.height; z = (this.random() - 0.5) * c.depth; }
        while (!insideChamber(c, x, y, z, 0.025));
        this.positions[j] = x; this.positions[j + 1] = y; this.positions[j + 2] = z;
        this.velocities.fill(0, j, j + 3);
    }
    advance(seconds) {
        const f = this.field, c = f.config, dt = Math.min(seconds, 0.05);
        const forceScale = c.mobility * c.amplitude ** 2 * 0.12 / Math.max(f.meanEnergy, 0.00003);
        const drag = Math.exp(-3.8 * dt), maxSpeed = Math.min(c.length, c.height, c.depth) * 0.24;
        const bands = c.layers === 'bands';
        for (let i = 0; i < this.count; i++) {
            const j = i * 3, x = this.positions[j], y = this.positions[j + 1], z = this.positions[j + 2];
            const energy = f.sample(f.meanSquare, x, y, z);
            const population = i % PARTICLE_BANDS.length;
            const target = PARTICLE_BANDS[population].energy * f.meanEnergy;
            // The node population follows the original downhill force. The others
            // follow -grad((E - target)^2), with a soft, capped attraction to the contour.
            const direction = bands && population > 0 ? clamp((energy - target) / Math.max(target * 0.5, 0.00001), -1, 1) : 1;
            for (let axis = 0; axis < 3; axis++) {
                const acceleration = clamp(-f.sample(f.gradient[axis], x, y, z) * forceScale * direction, -2, 2);
                this.velocities[j + axis] = clamp((this.velocities[j + axis] + acceleration * dt) * drag, -maxSpeed, maxSpeed);
            }
            const nx = x + this.velocities[j] * dt, ny = y + this.velocities[j + 1] * dt, nz = z + this.velocities[j + 2] * dt;
            const escaping = c.opening && nx > c.length / 2 - 0.025 && Math.hypot(ny, nz) < c.openingSize / 2 - 0.02;
            if (escaping && nx > c.length / 2 + f.exteriorX * c.cell * 0.75) this.respawn(i);
            else if (insideChamber(c, nx, ny, nz, 0.02) || escaping) {
                this.positions[j] = nx; this.positions[j + 1] = ny; this.positions[j + 2] = nz;
            }
            else { this.velocities[j] *= -0.15; this.velocities[j + 1] *= -0.15; this.velocities[j + 2] *= -0.15; }
            const relativeEnergy = energy / Math.max(f.meanEnergy, 0.00003);
            const colorBand = bands ? population : relativeEnergy < 0.09 ? 0 : relativeEnergy < 0.365 ? 1 : 2;
            const color = PARTICLE_BANDS[colorBand].color;
            this.colors[j] = color[0]; this.colors[j + 1] = color[1]; this.colors[j + 2] = color[2];
        }
    }
}
