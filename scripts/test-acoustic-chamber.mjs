import test from 'node:test';
import assert from 'node:assert/strict';
import { WaveChamber, ParticleCloud, configure, insideChamber, COURANT, SOUND_SPEED } from '../public/threejs/acoustic_chamber/physics.mjs';

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
    for (const shape of ['box', 'cylinder', 'taper']) {
        const field = new WaveChamber({ resolution: 32, shape, amplitude: 2, reflection: 0.9, opening: true, frequency: 99999 });
        field.step(800); field.updateGradient();
        assert.ok(field.pressure.every(Number.isFinite));
        assert.ok(maximum(field.pressure) < 15, `${shape}: pressure stays bounded`);
        assert.ok(field.meanEnergy > 0);
        assert.ok(field.meanSquare.every(value => Number.isFinite(value) && value >= 0));
        assert.ok(field.gradient.every(axis => axis.every(Number.isFinite)));
    }
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
        const field = new WaveChamber({ resolution: 32, shape, count: 1000 });
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
