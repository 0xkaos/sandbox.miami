import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compilePerformance, notePosition } from '../public/threejs/piano_motion/performance.mjs';
import { buildHandPaths, handPathEdgePose, handPathPoses, HAND_LANDING_HEIGHT } from '../public/threejs/piano_motion/hand-paths.mjs';

const { Midi } = createRequire(import.meta.url)('../public/threejs/piano_motion/vendor/Midi.js');
const chord = (time, pitches, hand = 'right', duration = 0.9) => pitches.map(midi => ({
  midi, hand, time, beat: time * 2, keyEnd: time + duration, end: time + duration,
}));

test('one guide forks onto four chord tones and converges to one without changing the notes', () => {
  const notes = [...chord(0, [60]), ...chord(1, [60, 64, 67, 72]), ...chord(2, [67])];
  const original = structuredClone(notes);
  const path = buildHandPaths(notes).right;
  assert.equal(handPathPoses(path, 0, 8).length, 1);
  assert.equal(handPathPoses(path, 0.5, 8).length, 4);
  const landed = handPathPoses(path, 1, 8);
  assert.deepEqual(landed.map(pose => pose.y), [60, 64, 67, 72].map(pitch => notePosition(pitch, 'right').y));
  assert.ok(landed.every(pose => pose.x === 16 && pose.z === HAND_LANDING_HEIGHT));
  assert.equal(handPathPoses(path, 1.5, 8).length, 4);
  assert.equal(handPathPoses(path, 2, 8).length, 1);
  assert.deepEqual(notes, original);
});

test('unequal chords connect nearby voices in pitch order and retain every endpoint', () => {
  const path = buildHandPaths([...chord(0, [60, 72]), ...chord(1, [60, 64, 72]), ...chord(2, [60, 72])]).right;
  const pitches = section => section.edges.map(edge => edge.guide.map(note => note.midi));
  assert.deepEqual(pitches(path.sections[0]), [[60, 60], [60, 64], [72, 72]]);
  assert.deepEqual(pitches(path.sections[1]), [[60, 60], [64, 60], [72, 72]]);
  for (let i = 0; i < path.sections.length - 1; i++) {
    const section = path.sections[i], next = path.sections[i + 1];
    const arrivals = new Set(section.edges.map(edge => JSON.stringify(handPathEdgePose(edge, section.end, 8))));
    const departures = new Set(next.edges.map(edge => JSON.stringify(handPathEdgePose(edge, next.time, 8))));
    assert.deepEqual(arrivals, departures);
  }
});

test('large chords use at most four real pitches, preserve the range, and collapse unisons', () => {
  const notes = [...chord(0, [48, 48, 52, 55, 59, 62, 65, 69]), ...chord(1, [55, 55])];
  const path = buildHandPaths(notes).right;
  assert.equal(path.groups[0].notes.length, 4);
  assert.equal(path.groups[0].notes[0].midi, 48);
  assert.equal(path.groups[0].notes.at(-1).midi, 69);
  assert.ok(path.groups[0].notes.every(note => notes.some(original => original.midi === note.midi)));
  assert.equal(path.groups[1].notes.length, 1);
  for (let time = 0; time < 2; time += 0.02) assert.ok(handPathPoses(path, time, 8).length <= 4);
});

test('branching respects hand assignments, rests, reduced motion, and repeated seeks', () => {
  const notes = [...chord(0, [76, 79], 'left', 0.2), ...chord(0, [40, 43], 'right', 0.2),
    ...chord(4, [48, 52, 55], 'left', 0.3), ...chord(4, [72], 'right', 0.3)];
  const paths = buildHandPaths(notes);
  assert.equal(paths.left.groups[0].notes[0].midi, 76);
  assert.equal(paths.right.groups[0].notes[0].midi, 40);
  for (const path of Object.values(paths)) {
    assert.deepEqual(handPathPoses(path, 2, 8), []);
    assert.deepEqual(handPathPoses(path, 5, 8), []);
    const returning = handPathPoses(path, 3.8, 8);
    assert.ok(returning.length > 0);
    assert.ok(handPathPoses(path, 3.8, 8, true).every(pose => pose.z === HAND_LANDING_HEIGHT));
    handPathPoses(path, 4.3, 8); handPathPoses(path, 0.1, 8);
    assert.deepEqual(handPathPoses(path, 3.8, 8), returning);
  }
  assert.deepEqual(handPathPoses(buildHandPaths([]).left, 0, 8), []);
});

test('the complete ps29 performance retains its audio notes and bounds every hand transition', () => {
  const midi = new Midi(readFileSync(new URL('../public/midi/ps29_01.mid', import.meta.url)));
  const performance = compilePerformance(midi, new Set(midi.tracks.map((_, i) => i)));
  const paths = buildHandPaths(performance.notes);
  assert.equal(performance.notes.length, 8430);
  for (const path of Object.values(paths)) {
    assert.ok(path.groups.some(group => group.notes.length === 4));
    for (const section of path.sections) {
      assert.ok(section.edges.length >= 1 && section.edges.length <= 4);
      for (const time of [section.time, (section.time + section.end) / 2, section.end]) {
        const poses = handPathPoses(path, time, 8);
        assert.ok(poses.length <= 4);
        assert.ok(poses.every(pose => [pose.x, pose.y, pose.z, pose.opacity].every(Number.isFinite)));
      }
    }
  }
});
