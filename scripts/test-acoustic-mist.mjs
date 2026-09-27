import test from 'node:test';
import assert from 'node:assert/strict';
import { WaveChamber } from '../public/threejs/acoustic_chamber/physics.mjs';
import { MistSimulation } from '../public/threejs/acoustic_mist/model.mjs';
import { EnergyField } from '../public/threejs/acoustic_field/geometry.mjs';
import { decodeSnapshot, encodeSnapshot } from '../public/threejs/acoustic_chamber/snapshot.mjs';
import { createMistFragment, fragmentShader } from '../public/threejs/acoustic_field/mist.mjs';

test('live frames use the original wave solver without particle or gradient updates', () => {
    const mist = new MistSimulation({ resolution:32, slow:50 }), reference = new WaveChamber(mist.field.config);
    mist.field.updateGradient = () => { throw new Error('Frame path must not calculate particle gradients'); };
    let steps = 0, buffer;
    for (let i = 0; i < 32; i++) {
        const frame = mist.frame(1/30, buffer); steps += frame.steps;
        assert.equal(frame.values.length, mist.field.size);
        assert.ok(frame.values.every(Number.isFinite));
        assert.ok(frame.activity >= 0 && frame.activity <= 1);
        assert.equal(frame.positions, undefined);
        if (buffer) assert.equal(frame.values.buffer, buffer, 'reuse transferred storage');
        buffer = frame.values.buffer;
    }
    reference.step(steps);
    assert.deepEqual(mist.field.pressure, reference.pressure);
    assert.deepEqual(mist.field.meanSquare, reference.meanSquare);
});

test('live normalization and all smoothing levels agree with Field Studio', () => {
    for (const shape of ['box','cylinder','taper']) {
        const mist = new MistSimulation({ resolution:32, shape, opening:true }); mist.field.step(180);
        const snapshot = mist.capture('Live test');
        for (const smoothing of [0,1,4]) {
            mist.setSmoothing(smoothing);
            const frame = mist.frame(0), reference = new EnergyField(snapshot, smoothing);
            assert.deepEqual(frame.values, reference.values);
        }
    }
});

test('silence is invisible; a dying burst fades rather than being amplified by normalization', () => {
    const silent = new MistSimulation({ resolution:32, amplitude:0 });
    for (let i = 0; i < 8; i++) assert.equal(silent.frame(0.05).activity, 0);
    const mist = new MistSimulation({ resolution:32, reflection:0.38, drive:'burst', slow:40 });
    let peak = 0, peakEnergy = 0, frame;
    for (let i = 0; i < 220; i++) {
        frame = mist.frame(0.05);
        peak = Math.max(peak, frame.activity); peakEnergy = Math.max(peakEnergy, frame.energy);
    }
    assert.equal(peak, 1);
    assert.ok(frame.activity < 0.01, `remaining opacity multiplier: ${frame.activity}`);
    assert.ok(frame.energy < peakEnergy*0.0001);
    assert.ok(frame.values.every(Number.isFinite));
});

test('paused appearance changes and capture preserve time, phase and raw samples', () => {
    const mist = new MistSimulation({ resolution:32 }); mist.frame(0.05);
    const time = mist.field.time, phase = mist.field.phase, raw = mist.field.meanSquare.slice();
    mist.remainder = 50*mist.field.dt; // Even pending catch-up must remain paused.
    mist.setSmoothing(4); const refresh = mist.frame(0);
    assert.equal(refresh.steps, 0); assert.equal(mist.field.time, time); assert.equal(mist.field.phase, phase);
    assert.deepEqual(mist.field.meanSquare, raw);
    const view = { controls:{ mode:'mist', level1:'0.35', opacity:'0.7' }, camera:[3,2,5], target:[0,0,0] };
    const snapshot = decodeSnapshot(encodeSnapshot(mist.capture('A live moment', view)));
    assert.deepEqual(snapshot.energy, raw); assert.deepEqual(snapshot.meta.view, view);
    assert.equal(snapshot.meta.time, time);
    assert.equal(mist.frame(1000).steps, 24, 'catch-up is bounded');
});

test('live tuning preserves the field and keeps all harmonics in range; 100% return remains finite', () => {
    const mist = new MistSimulation({ resolution:32 }); mist.frame(0.05);
    const pressure = mist.field.pressure, time = mist.field.time;
    mist.tune({ frequency:9000, reflection:1, harmonic4:1 });
    assert.equal(mist.field.pressure, pressure); assert.equal(mist.field.time, time);
    assert.ok(mist.field.config.frequency*4 <= mist.field.config.maxFrequency);
    for (let i = 0; i < 100; i++) assert.ok(mist.frame(0.05).values.every(Number.isFinite));
});

test('ray sampling presets preserve the Studio default and stay bounded', () => {
    assert.equal(fragmentShader, createMistFragment(176));
    for (const steps of [96,144,224]) assert.ok(createMistFragment(steps).includes(`i<${steps};`));
    assert.ok(createMistFragment(10000).includes('i<256;'));
    assert.equal(createMistFragment(NaN), fragmentShader);
});
