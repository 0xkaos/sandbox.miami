import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compilePerformance, createDemo, defaultTrackHands, handGuidePose, notePosition, sampleFor, suggestHandSplit, trackOptions, validateMidi } from '../public/threejs/piano_motion/performance.mjs';

const require = createRequire(import.meta.url);
const { Midi } = require('../public/threejs/piano_motion/vendor/Midi.js');
const { scanMidiFiles } = require('./generate-midi-manifest.js');

test('the original study survives MIDI export/import with tempo, meter, dynamics, and pedal', () => {
  const original = createDemo(Midi);
  const bytes = original.toArray();
  validateMidi(bytes);
  const midi = new Midi(bytes);
  assert.equal(midi.name, 'After the rain');
  assert.equal(midi.header.tempos.length, 3);
  assert.deepEqual(midi.header.timeSignatures[0].timeSignature, [6, 8]);
  const tracks = trackOptions(midi);
  assert.equal(tracks.length, 2);
  const performance = compilePerformance(midi, new Set(tracks.map(track => track.id)));
  assert.equal(performance.notes.length, 240);
  assert.equal(performance.pedals.length, 48);
  assert.ok(performance.notes.some(note => note.end > note.keyEnd));
  assert.ok(new Set(performance.notes.map(note => note.velocity)).size > 8);
  assert.ok(performance.duration > 55 && performance.duration < 65);
  assert.deepEqual(performance.bars.slice(0, 3).map(bar => bar.beat), [0, 3, 6]);
});

test('tempo changes and note durations remain in performance time', () => {
  const midi = new Midi();
  const ppq = midi.header.ppq;
  midi.header.tempos = [{ ticks: 0, bpm: 120 }, { ticks: ppq * 2, bpm: 60 }];
  midi.header.update();
  midi.addTrack().addNote({ midi: 60, ticks: ppq * 3, durationTicks: ppq, velocity: 0.6 });
  const performance = compilePerformance(midi, new Set([0]));
  assert.equal(performance.notes[0].time, 2);
  assert.equal(performance.notes[0].keyEnd, 3);
  assert.equal(midi.header.secondsToTicks(2), ppq * 3);
});

test('sustain belongs to a channel, including controller-only tracks and an unclosed pedal', () => {
  const midi = new Midi();
  const notes = midi.addTrack(); notes.channel = 0;
  notes.addNote({ midi: 60, time: 0.1, duration: 0.4, velocity: 0.8 });
  notes.addNote({ midi: 64, time: 1.2, duration: 0.4, velocity: 0.8 });
  const control = midi.addTrack(); control.channel = 0;
  control.addCC({ number: 64, time: 0, value: 1 });
  control.addCC({ number: 64, time: 1, value: 0 });
  control.addCC({ number: 64, time: 1.1, value: 1 });
  const other = midi.addTrack(); other.channel = 1;
  other.addNote({ midi: 48, time: 0.1, duration: 0.4, velocity: 0.5 });
  const performance = compilePerformance(midi, new Set([0, 2]));
  assert.equal(performance.notes.find(note => note.midi === 60).end, 1);
  assert.equal(performance.notes.find(note => note.midi === 48).end, 0.5);
  assert.ok(Math.abs(performance.notes.find(note => note.midi === 64).end - 2.4) < 1e-9);
  assert.equal(performance.pedals.at(-1).down, false);
});

test('track filtering and zero selection never play excluded notes', () => {
  const midi = createDemo(Midi);
  assert.equal(compilePerformance(midi, new Set([0])).notes.length, 96);
  assert.equal(compilePerformance(midi, new Set([1])).notes.length, 144);
  assert.equal(compilePerformance(midi, new Set()).notes.length, 0);
});

test('humanize is opt-in, bounded, and deterministic', () => {
  const midi = createDemo(Midi);
  const original = compilePerformance(midi, new Set([0, 1]));
  const human = compilePerformance(midi, new Set([0, 1]), 1);
  assert.deepEqual(human.notes, compilePerformance(midi, new Set([0, 1]), 1).notes);
  const byId = new Map(original.notes.map(note => [note.id, note]));
  for (const note of human.notes) {
    const raw = byId.get(note.id);
    assert.ok(Math.abs(note.time - raw.time) <= 0.0111);
    assert.ok(Math.abs(note.velocity - raw.velocity) <= 0.091);
    assert.ok(note.end >= note.keyEnd);
  }
  assert.notDeepEqual(human.notes, original.notes);
});

test('MIDI validation rejects non-MIDI, Type 2, and SMPTE rather than misplaying them', () => {
  assert.throws(() => validateMidi(new TextEncoder().encode('<html>not midi</html>')), /Standard MIDI/);
  const bytes = createDemo(Midi).toArray();
  bytes[9] = 2;
  assert.throws(() => validateMidi(bytes), /Type 2/);
  bytes[9] = 1; bytes[12] = 0x80;
  assert.throws(() => validateMidi(bytes), /SMPTE/);
});

test('sample mapping covers the 88 keys, velocity extremes, and chromatic transposition', () => {
  assert.equal(sampleFor({ midi: 21, velocity: 0.01 }).key, 'A0v1');
  assert.equal(sampleFor({ midi: 108, velocity: 1 }).key, 'C8v16');
  assert.equal(sampleFor({ midi: 61, velocity: 0.5 }).key, 'C4v8');
  assert.equal(sampleFor({ midi: 61, velocity: 0.5 }).rate, 2 ** (1 / 12));
  for (let midi = 0; midi < 128; midi++) {
    const sample = sampleFor({ midi, velocity: 0.5 }, 4);
    assert.ok(sample.root >= 21 && sample.root <= 108);
    assert.ok([3, 7, 11, 15].includes(sample.layer));
  }
  assert.equal(notePosition(64).y, 1.05); // E4: bottom line of the treble staff.
  assert.equal(notePosition(43).y, -2.65); // G2: bottom line of the bass staff.
});

test('measure boundaries follow meter changes', () => {
  const midi = new Midi();
  const ppq = midi.header.ppq;
  midi.header.timeSignatures = [{ ticks: 0, timeSignature: [3, 4] }, { ticks: ppq * 6, timeSignature: [5, 8] }];
  midi.header.update();
  midi.addTrack().addNote({ midi: 60, ticks: ppq * 12, durationTicks: ppq, velocity: 1 });
  assert.deepEqual(compilePerformance(midi, new Set([0])).bars.slice(0, 6).map(bar => bar.beat), [0, 3, 6, 8.5, 11, 13.5]);
});

test('the MIDI library finds nested files and safely encodes names without indexing other assets', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'piano-library-'));
  try {
    mkdirSync(path.join(root, 'Studies'));
    for (const file of ['First piece.mid', 'Studies/Étude #2.MIDI', 'notes.txt', '.hidden.mid']) writeFileSync(path.join(root, file), 'fixture');
    const files = scanMidiFiles(root);
    assert.equal(files.length, 2);
    assert.ok(files.some(file => file.path === '/midi/First%20piece.mid'));
    assert.ok(files.some(file => file.path === '/midi/Studies/%C3%89tude%20%232.MIDI' && file.title === 'Studies/Étude #2'));
    assert.deepEqual(scanMidiFiles(path.join(root, 'missing')), []);
    rmSync(path.join(root, 'First piece.mid'));
    assert.equal(scanMidiFiles(root).length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('hand-labelled tracks keep their hands when crossing middle C', () => {
  const midi = new Midi();
  const left = midi.addTrack(); left.name = 'Left hand';
  left.addNote({ midi: 72, time: 0, duration: 0.4, velocity: 0.7 });
  const right = midi.addTrack(); right.name = 'Right hand';
  right.addNote({ midi: 48, time: 0, duration: 0.4, velocity: 0.7 });
  const performance = compilePerformance(midi, new Set([0, 1]));
  assert.deepEqual(defaultTrackHands(midi), new Map([[0, 'left'], [1, 'right']]));
  assert.equal(performance.guides.left[0].midi, 72);
  assert.equal(performance.guides.right[0].midi, 48);
  assert.equal(notePosition(72, 'left').treble, false);
});

test('combined tracks split by adjustable pitch, with independent rhythms and chord landings', () => {
  const midi = new Midi(); const track = midi.addTrack();
  for (const [time, pitch] of [[0, 48], [0, 55], [0, 72], [0, 76], [0.2, 74], [0.4, 60], [0.6, 77]]) {
    track.addNote({ midi: pitch, time, duration: 0.18, velocity: 0.7 });
  }
  const selected = new Set([0]);
  const performance = compilePerformance(midi, selected, 0, { handSplit: 65 });
  assert.deepEqual(performance.guides.left.map(note => note.midi), [48, 60]);
  assert.deepEqual(performance.guides.right.map(note => note.midi), [76, 74, 77]);
  assert.equal(compilePerformance(midi, selected, 0, { handSplit: 60 }).guides.left.length, 1);
  const forced = compilePerformance(midi, selected, 0, { trackHands: new Map([[0, 'right']]) });
  assert.equal(forced.guides.left.length, 0);
  assert.equal(forced.notes.length, performance.notes.length);
  assert.equal(forced.duration, performance.duration);
});

test('hand guides land on their notes, travel along time, handle rests, and honor reduced motion', () => {
  const guide = [
    { midi: 60, hand: 'right', beat: 0, time: 0, keyEnd: 0.45 },
    { midi: 67, hand: 'right', beat: 1, time: 0.5, keyEnd: 0.95 },
    { midi: 72, hand: 'right', beat: 8, time: 4, keyEnd: 4.5 },
  ];
  const halfway = handGuidePose(guide, 0.25, 8);
  assert.equal(halfway.x, 4);
  assert.ok(halfway.z > 0.32);
  assert.equal(handGuidePose(guide, 0.5, 8).x, 8);
  assert.equal(handGuidePose(guide, 0.5, 8).z, 0.32);
  assert.equal(handGuidePose(guide, 2, 8).opacity, 0);
  assert.equal(handGuidePose(guide, 4, 8).x, 64);
  assert.equal(handGuidePose(guide, 5, 8).opacity, 0);
  assert.equal(handGuidePose(guide, 0.25, 8, true).z, 0.32);
  assert.equal(handGuidePose([], 0, 8), null);
});

test('the supplied Interstellar MIDI indexes and produces two independent hand guides', () => {
  const file = new URL('../public/midi/The Interstellar Experience.mid', import.meta.url);
  const bytes = new Uint8Array(readFileSync(file));
  validateMidi(bytes);
  const midi = new Midi(bytes);
  const split = suggestHandSplit(midi);
  const selected = new Set(trackOptions(midi).map(track => track.id));
  const performance = compilePerformance(midi, selected, 0, { handSplit: split });
  assert.equal(split, 65);
  assert.equal(performance.notes.length, 2190);
  assert.ok(performance.guides.left.length > 700);
  assert.ok(performance.guides.right.length > 1000);
  for (const guide of Object.values(performance.guides)) {
    assert.ok(guide.every((note, i) => i === 0 || note.time > guide[i - 1].time));
  }
});
