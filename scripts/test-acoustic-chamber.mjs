import test from 'node:test';
import assert from 'node:assert/strict';
import { WaveChamber, ParticleCloud, configure, insideChamber, COURANT, SOUND_SPEED, PARTICLE_BANDS } from '../public/threejs/acoustic_chamber/physics.mjs';

function maximum(values) { return values.reduce((max, value) => Math.max(max, Math.abs(value)), 0); }
function exteriorEnergy(field) {
    return field.active.reduce((sum, i) => sum + (field.mask[i] === 2 ? field.meanSquare[i] : 0), 0);
}

test('grid respects the 3D stability limit and resolves supported wavelengths', () => {
    assert.ok(COURANT < 1 / Math.sqrt(3));
    for (const length of [1.6, 3.6, 6]) for (const resolution of [32, 40, 56]) {
        const c = configure({ length, resolution, frequency: 99999 });
        assert.ok(SOUND_SPEED / c.frequency >= c.cell * 9);
        const field = new WaveChamber(c);
        assert.ok(field.source.length > 0);
        if (length === 6) assert.equal(field.interiorX, resolution);
        assert.ok(field.dt * SOUND_SPEED / c.cell < 1 / Math.sqrt(3));
    }
});

test('zero excitation remains silent; pressure scales linearly with source amplitude', () => {
    const silent = new WaveChamber({ resolution: 32, amplitude: 0, opening: true });
    silent.step(150);
    assert.equal(silent.energy(), 0);
    const low = new WaveChamber({ resolution: 32, amplitude: 0.5 });
    const high = new WaveChamber({ resolution: 32, amplitude: 1 });
    low.step(170); high.step(170);
    assert.ok(maximum(high.pressure) > 0.05);
    for (const i of low.active) assert.ok(Math.abs(high.pressure[i] - 2 * low.pressure[i]) < 1e-6);
});

test('a closed wall isolates the exterior; the outlet transmits and changes the interior field', () => {
    const closed = new WaveChamber({ resolution: 32 });
    const open = new WaveChamber({ resolution: 32, opening: true });
    closed.step(650); open.step(650);
    assert.equal(exteriorEnergy(closed), 0);
    assert.ok(exteriorEnergy(open) > 0.01);
    let difference = 0, baseline = 0;
    for (const i of closed.interior) if (closed.coordinates(i)[0] > closed.interiorX / 2) {
        difference += (closed.meanSquare[i] - open.meanSquare[i]) ** 2;
        baseline += closed.meanSquare[i] ** 2;
    }
    assert.ok(Math.sqrt(difference / baseline) > 0.08, 'opening changes the distal interference pattern');
});

test('burst ends and decays; higher wall return retains more sound', () => {
    const soft = new WaveChamber({ resolution: 32, drive: 'burst', reflection: 0.38 });
    const hard = new WaveChamber({ resolution: 32, drive: 'burst', reflection: 0.85 });
    soft.step(90); hard.step(90);
    const initial = soft.energy();
    assert.ok(initial > 0.1);
    assert.equal(soft.sourceSignal(), 0);
    soft.step(260); hard.step(260);
    assert.ok(soft.energy() < initial * 0.001);
    assert.ok(hard.energy() > soft.energy() * 20);
    const before = soft.energy();
    soft.burst(); soft.step(60);
    assert.ok(soft.energy() > before * 100, 'a fresh burst re-excites the field');
});

test('all chamber shapes remain finite under maximum drive and reflection', () => {
    for (const shape of ['box', 'cylinder', 'taper']) for (const opening of [false, true]) {
        const field = new WaveChamber({ resolution: 32, shape, amplitude: 2, reflection: 1, opening, frequency: 99999 });
        assert.equal(field.config.reflection, 1);
        field.step(2400); field.updateGradient();
        assert.ok(field.pressure.every(Number.isFinite));
        // Continuous resonant forcing may physically increase amplitude over time.
        // A magnitude cap would hide that behavior instead of checking stability.
        assert.ok(field.meanEnergy > 0);
        assert.ok(field.meanSquare.every(value => Number.isFinite(value) && value >= 0));
        assert.ok(field.gradient.every(axis => axis.every(Number.isFinite)));
    }
});

test('100% walls retain a burst much longer while the medium still dissipates energy', () => {
    const fields = [0.9, 0.99, 1].map(reflection => new WaveChamber({ resolution: 32, reflection, drive: 'burst' }));
    const initial = fields.map(field => { field.step(150); return field.energy(); });
    fields.forEach(field => field.step(1800));
    const late = fields.map(field => field.energy());
    assert.ok(late[2] > late[1] * 3);
    assert.ok(late[1] > late[0] * 100);
    assert.ok(late[2] > initial[2] * 0.25, 'the burst persists after many reflections');
    assert.ok(late[2] < initial[2] * 0.8, '100% wall return retains the existing bulk loss');
    const hard = fields[2];
    const damping = hard.damping[hard.interior[0]];
    assert.ok(damping > 0);
    assert.ok(hard.interior.every(i => hard.damping[i] === damping), 'wall cells add no loss at 100%');
    hard.tune({ reflection: 0.995 });
    assert.equal(hard.config.reflection, 0.995);
    assert.ok(hard.interior.some(i => hard.wallFaces[i] && hard.damping[i] > damping), 'live tuning restores wall loss');
});

test('continuous forcing at a closed-chamber resonance stays finite at 100% wall return', () => {
    const field = new WaveChamber({ resolution: 32, reflection: 1, amplitude: 2 });
    // The first axial eigenfrequency of this discrete Neumann grid.
    const frequency = Math.asin(COURANT * Math.sin(Math.PI / (2 * field.interiorX))) / (Math.PI * field.dt);
    field.tune({ frequency });
    field.step(500);
    const early = field.energy();
    field.step(7500); field.updateGradient();
    assert.ok(field.pressure.every(Number.isFinite));
    assert.ok(field.energy() > early, 'resonant input can accumulate instead of being clamped');
    assert.ok(Number.isFinite(field.meanEnergy));
    const particles = new ParticleCloud(field, 1200);
    particles.advance(0.05);
    assert.ok(particles.positions.every(Number.isFinite));
    assert.ok(particles.velocities.every(Number.isFinite));
});

test('geometry and frequency produce different fields', () => {
    const fields = [new WaveChamber({ resolution: 32 }), new WaveChamber({ resolution: 32, shape: 'taper' }),
        new WaveChamber({ resolution: 32, frequency: 160 })];
    for (const f of fields) f.step(450);
    assert.ok(fields[1].interior.length < fields[0].interior.length);
    for (const f of fields.slice(1)) {
        let difference = 0, baseline = 0;
        // Compare the far half, away from the identical driven patch's dominant near field.
        for (const i of f.interior) if (f.coordinates(i)[0] > f.interiorX / 2) {
            difference += (fields[0].meanSquare[i] - f.meanSquare[i]) ** 2;
            baseline += fields[0].meanSquare[i] ** 2;
        }
        assert.ok(Math.sqrt(difference / baseline) > 0.15);
    }
});

test('particles descend a known quiet-node potential, remain contained, and preserve count', () => {
    for (const shape of ['box', 'cylinder', 'taper']) {
        const field = new WaveChamber({ resolution: 32, shape, count: 1000, layers: 'nodes' });
        // Independent quadratic potential: its quiet node is the central x=0 plane.
        for (const i of field.active) { const x = field.position(...field.coordinates(i))[0]; field.meanSquare[i] = 0.01 * x * x; }
        field.updateGradient();
        const particles = new ParticleCloud(field);
        const spread = () => particles.positions.reduce((sum, value, i) => sum + (i % 3 === 0 ? value * value : 0), 0);
        const initial = spread();
        for (let i = 0; i < 300; i++) particles.advance(1 / 30);
        assert.ok(spread() < initial * 0.8, `${shape}: particles move toward the quiet plane`);
        assert.equal(particles.positions.length, 3000);
        for (let i = 0; i < particles.count; i++) assert.ok(insideChamber(field.config, ...particles.positions.subarray(i * 3, i * 3 + 3)));
        assert.ok(particles.velocities.every(Number.isFinite));
    }
});

test('seeded redistribution is reproducible and zero response holds particles still', () => {
    const field = new WaveChamber({ resolution: 32, mobility: 0, count: 1000 });
    field.step(160); field.updateGradient();
    const a = new ParticleCloud(field), b = new ParticleCloud(field);
    assert.deepEqual(a.positions, b.positions);
    a.advance(0.05);
    assert.deepEqual(a.positions, b.positions);
    const c = new ParticleCloud(field, 1000, field.config.seed + 1);
    assert.notDeepEqual(a.positions, c.positions);
});

test('three populations converge on distinct energy contours from both directions', () => {
    const field = new WaveChamber({ resolution: 32, count: 1200, layers: 'bands' });
    // A quadratic well has known contour locations on either side of its quiet plane.
    for (const i of field.active) { const x = field.position(...field.coordinates(i))[0]; field.meanSquare[i] = 0.01 * x * x; }
    field.updateGradient();
    const cloud = new ParticleCloud(field);
    const errors = () => {
        const sum = [0, 0, 0];
        for (let i = 0; i < cloud.count; i++) {
            const band = i % 3, targetX = Math.sqrt(PARTICLE_BANDS[band].energy * field.meanEnergy / 0.01);
            sum[band] += (Math.abs(cloud.positions[i * 3]) - targetX) ** 2;
        }
        return sum;
    };
    const initial = errors();
    for (let frame = 0; frame < 900; frame++) cloud.advance(1 / 30);
    errors().forEach((error, band) => assert.ok(error < initial[band] * 0.1, `population ${band} approaches its target contour`));
    for (let i = 0; i < cloud.count; i++) assert.deepEqual([...cloud.colors.subarray(i * 3, i * 3 + 3)], PARTICLE_BANDS[i % 3].color);
    // Move the quiet plane; all populations must follow instead of remaining on a static shell.
    for (const i of field.active) { const x = field.position(...field.coordinates(i))[0]; field.meanSquare[i] = 0.01 * (x - 0.4) ** 2; }
    field.updateGradient();
    const initialPositions = cloud.positions.slice();
    for (let frame = 0; frame < 300; frame++) cloud.advance(1 / 30);
    for (let band = 0; band < 3; band++) {
        let displacement = 0;
        for (let i = band; i < cloud.count; i += 3) displacement += Math.abs(cloud.positions[i * 3] - initialPositions[i * 3]);
        assert.ok(displacement / (cloud.count / 3) > 0.1, `population ${band} follows a changing field`);
    }
});

test('quiet-node mode changes colors with local energy and preserves positions when paused', () => {
    const field = new WaveChamber({ resolution: 32, count: 1000, layers: 'bands' });
    const cloud = new ParticleCloud(field), initial = cloud.positions.slice();
    field.tune({ layers: 'nodes' });
    field.meanEnergy = 1;
    for (const [energy, band] of [[0.01, 0], [0.2, 1], [0.8, 2]]) {
        field.meanSquare.fill(energy);
        cloud.advance(0);
        assert.deepEqual(cloud.positions, initial);
        assert.deepEqual([...cloud.colors.subarray(0, 3)], PARTICLE_BANDS[band].color);
    }
});

test('every active harmonic stays inside the grid frequency limit', () => {
    for (const length of [1.6, 3.6, 6]) for (const resolution of [32, 40, 56]) {
        const c = configure({ length, resolution, frequency: 99999, harmonics: true });
        assert.equal(c.partials.length, 4);
        assert.ok(Math.abs(c.partials.reduce((sum, partial) => sum + partial.gain, 0) - 1) < 1e-12);
        for (const partial of c.partials) assert.ok(SOUND_SPEED / (partial.multiple * c.frequency) >= c.cell * 9);
    }
    const two = configure({ frequency: 99999, harmonics: true, harmonic3: 0, harmonic4: 0 });
    assert.deepEqual(two.partials.map(partial => partial.multiple), [1, 2]);
    assert.equal(two.maxFundamental, Math.floor(two.maxFrequency / 2));
    const one = configure({ frequency: 240, harmonics: true, harmonic2: 0, harmonic3: 0, harmonic4: 0 });
    assert.equal(one.frequency, 240);
    assert.equal(one.maxFundamental, one.maxFrequency);
});

test('muting every overtone exactly preserves the single-tone field', () => {
    for (const drive of ['continuous', 'burst']) {
        const single = new WaveChamber({ resolution: 32, frequency: 100, drive });
        const muted = new WaveChamber({ resolution: 32, frequency: 100, drive, harmonics: true, harmonic2: 0, harmonic3: 0, harmonic4: 0 });
        single.step(350); muted.step(350);
        assert.deepEqual(muted.pressure, single.pressure);
        assert.deepEqual(muted.meanSquare, single.meanSquare);
    }
});

test('the mixed wave field equals the sum of independently driven harmonic fields', () => {
    const fundamental = 80, levels = [1, 0.5, 0.3, 0.15], total = levels.reduce((sum, level) => sum + level, 0);
    const mixed = new WaveChamber({ resolution: 32, frequency: fundamental, harmonics: true });
    const separate = levels.map((level, i) => new WaveChamber({ resolution: 32, frequency: fundamental * (i + 1), amplitude: level / total }));
    // Begin after the source ramp, so all independent single-tone references have
    // the same envelope. Pressure is linear; time-averaged energy is not.
    for (const field of [mixed, ...separate]) { field.time = 1; field.step(300); }
    let error = 0, reference = 0;
    for (const i of mixed.active) {
        const expected = separate.reduce((sum, field) => sum + field.pressure[i], 0);
        error += (mixed.pressure[i] - expected) ** 2;
        reference += expected ** 2;
    }
    assert.ok(Math.sqrt(error / reference) < 0.00001, 'all four frequencies propagate through the same linear field');
    assert.equal(mixed.size, separate[0].size, 'harmonics allocate no additional grid cells');
    const pressure = mixed.pressure, time = mixed.time;
    mixed.tune({ harmonics: false });
    assert.equal(mixed.pressure, pressure);
    assert.equal(mixed.time, time, 'live mode changes preserve the running field');
});

test('a harmonic burst ends after three fundamental cycles and decays', () => {
    const field = new WaveChamber({ resolution: 32, frequency: 80, drive: 'burst', harmonics: true, harmonic2: 1, harmonic3: 1, harmonic4: 1 });
    field.step(Math.ceil(3 / (field.config.frequency * field.dt)) + 1);
    const initial = field.energy();
    assert.ok(initial > 0.1);
    assert.equal(field.sourceSignal(), 0);
    field.step(1000);
    assert.ok(field.pressure.every(Number.isFinite));
    assert.ok(field.energy() < initial * 0.001);
});
