import { WaveChamber, ParticleCloud } from './physics.mjs?v=1';
let field, particles, generation = 0, remainder = 0;
self.onmessage = ({ data }) => {
    try {
        if (data.type === 'configure') {
            generation = data.generation;
            field = new WaveChamber(data.config);
            particles = new ParticleCloud(field);
            remainder = 0;
            self.postMessage({ type: 'ready', generation, meta: field.metadata() });
        } else if (!field || data.generation !== generation) return;
        else if (data.type === 'tune') field.tune(data.changes);
        else if (data.type === 'burst') field.burst();
        else if (data.type === 'particles') particles = new ParticleCloud(field, data.count, data.seed);
        else if (data.type === 'step') {
            const start = performance.now();
            remainder += Math.min(data.seconds, 0.05) / field.config.slow;
            const steps = Math.min(24, Math.floor(remainder / field.dt));
            remainder = Math.min(remainder - steps * field.dt, field.dt * 24);
            field.step(steps);
            field.updateGradient();
            particles.advance(data.seconds);
            const volume = field.encode(), positions = particles.positions.slice(), colors = particles.colors.slice();
            self.postMessage({ type: 'frame', generation, volume, positions, colors, time: field.time,
                energy: field.meanEnergy, compute: performance.now() - start }, [volume.buffer, positions.buffer, colors.buffer]);
        }
    } catch (error) { self.postMessage({ type: 'error', generation, message: error.message }); }
};
