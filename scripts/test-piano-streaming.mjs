import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { SampleBank, SampleCapacityError, DECODED_BUDGET, sampleRequirements } from '../public/threejs/piano_motion/sample-bank.mjs';
import { compilePerformance } from '../public/threejs/piano_motion/performance.mjs';
import { cameraDrift } from '../public/threejs/piano_motion/camera-motion.mjs';
import { GrandPiano } from '../public/threejs/piano_motion/piano.mjs';

const { Midi } = createRequire(import.meta.url)('../public/threejs/piano_motion/vendor/Midi.js');
const signal = () => new AbortController().signal;
function fakeBuffer(channels, length, sampleRate = 100) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
    getChannelData: i => data[i], copyToChannel: (source, i) => data[i].set(source) };
}
function context() {
  return {
    createBuffer: fakeBuffer,
    async decodeAudioData(bytes) {
      const data = structuredClone(bytes, { transfer: [bytes] });
      return fakeBuffer(2, new Uint8Array(data)[0] * 100);
    },
  };
}
const fetchSample = async () => new Uint8Array([2]).buffer;

test('compressed inventory does not allocate decoded audio and survives decoding', async () => {
  const bank = new SampleBank(context(), { fetchSample });
  await bank.loadEncoded(['a', 'b', 'c'], undefined, signal());
  assert.equal(bank.encoded.size, 3);
  assert.equal(bank.bytes(), 0);
  await bank.prepare(new Map([['a', 1]]), () => new Set(), signal());
  assert.equal(bank.buffers.size, 1);
  assert.equal(bank.bytes(), 800);
  assert.equal(bank.encoded.get('a').byteLength, 1);
  assert.equal(bank.buffers.get('a').duration, 1);
});

test('moving windows evict unused PCM while pinning sounding buffers within the budget', async () => {
  const bank = new SampleBank(context(), { fetchSample, maxBytes: 1600 });
  await bank.loadEncoded(['a', 'b', 'c', 'd'], undefined, signal());
  await bank.prepare(new Map([['a', 1], ['b', 1]]), () => new Set(), signal());
  const active = new Set([bank.buffers.get('a')]);
  await bank.prepare(new Map([['c', 1]]), () => active, signal());
  assert.equal(bank.buffers.has('a'), true);
  assert.equal(bank.buffers.has('b'), false);
  assert.equal(bank.buffers.has('c'), true);
  assert.equal(bank.bytes(active), 1600);
  await assert.rejects(bank.prepare(new Map([['c', 1], ['d', 1]]), () => active, signal()), SampleCapacityError);
  assert.ok(bank.bytes(active) <= 1600);
  active.clear();
  await bank.prepare(new Map([['c', 1], ['d', 1]]), () => active, signal());
  assert.equal(bank.buffers.has('a'), false);
  assert.equal(bank.bytes(), 1600);
  assert.equal(bank.encoded.size, 4);
});

test('slower playback can grow a buffer without forgetting its still-sounding old version', async () => {
  const bank = new SampleBank(context(), { fetchSample, maxBytes: 2400 });
  await bank.loadEncoded(['a'], undefined, signal());
  await bank.prepare(new Map([['a', 1]]), () => new Set(), signal());
  const old = bank.buffers.get('a');
  await bank.prepare(new Map([['a', 2]]), () => new Set([old]), signal());
  assert.notEqual(bank.buffers.get('a'), old);
  assert.equal(bank.bytes(new Set([old])), 2400);
  assert.equal(bank.bytes(), 1600);
  assert.equal(bank.ready(new Map([['a', 100]])), true); // The full recording has naturally decayed.
});

test('cancelled decoding cannot write a stale buffer after seeking or switching pieces', async () => {
  const ctx = context();
  let finish;
  ctx.decodeAudioData = () => new Promise(resolve => { finish = resolve; });
  const bank = new SampleBank(ctx, { fetchSample });
  await bank.loadEncoded(['a'], undefined, signal());
  const controller = new AbortController();
  const pending = bank.prepare(new Map([['a', 1]]), () => new Set(), controller.signal);
  controller.abort(); finish(fakeBuffer(2, 200));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(bank.buffers.size, 0);
});

test('sample download failure is retryable, and switching pieces releases their compressed inventory', async () => {
  let failing = true;
  const bank = new SampleBank(context(), { fetchSample: async () => { if (failing) throw new Error('offline'); return fetchSample(); } });
  await assert.rejects(bank.loadEncoded(['a'], undefined, signal()), /Could not load piano sample/);
  failing = false;
  await bank.loadEncoded(['a'], undefined, signal());
  await bank.prepare(new Map([['a', 1]]), () => new Set(), signal());
  await bank.loadEncoded(['b'], undefined, signal());
  assert.equal(bank.encoded.has('a'), false);
  assert.equal(bank.buffers.has('a'), false);
});

test('window plans include sustained notes across seeks and grow at slower tempos', () => {
  const performance = { notes: [
    { midi: 60, time: 0, end: 10, keyEnd: 1, velocity: 0.5 },
    { midi: 64, time: 50, end: 51, keyEnd: 51, velocity: 0.5 },
  ], pedals: [{ time: 10, down: false }] };
  const normal = sampleRequirements(performance, 16, 5, 12, 1);
  assert.ok(normal.has('C4v8'));
  assert.ok(normal.has('pedalU1'));
  assert.ok(!normal.has('rel41'));
  assert.ok(!normal.has('Ds4v8'));
  assert.ok(sampleRequirements(performance, 16, 5, 12, 0.5).get('C4v8') > normal.get('C4v8'));
});

test('dense passages shorten lookahead without lowering velocity detail', async () => {
  const piano = new GrandPiano();
  piano.bank = new SampleBank(context(), { fetchSample, maxBytes: 3200 });
  piano.performance = { notes: [
    { midi: 60, time: 0, end: 1, keyEnd: 1, velocity: 0.5 },
    { midi: 64, time: 6, end: 7, keyEnd: 7, velocity: 0.5 },
  ], pedals: [] };
  await piano.bank.loadEncoded([...sampleRequirements(piano.performance, 16).keys()], undefined, signal());
  await piano.requestWindow(0);
  assert.ok(piano.nextPrepareTime < 3);
  assert.ok(piano.windowReady(0));
  assert.equal(piano.layers, 16);
  await piano.requestWindow(6);
  assert.ok(piano.windowReady(6));
  assert.ok(piano.bank.bytes() <= 3200);
});

test('a newer seek waits for cancelled decoding and prepares only its own passage', async () => {
  const ctx = context(), decode = ctx.decodeAudioData;
  let finish, started;
  const decoding = new Promise(resolve => { started = resolve; });
  ctx.decodeAudioData = bytes => {
    ctx.decodeAudioData = decode;
    started();
    return new Promise(resolve => { finish = () => resolve(decode(bytes)); });
  };
  const piano = new GrandPiano();
  piano.bank = new SampleBank(ctx, { fetchSample });
  piano.performance = { notes: [
    { midi: 60, time: 0, end: 1, keyEnd: 1, velocity: 0.5 },
    { midi: 64, time: 50, end: 51, keyEnd: 51, velocity: 0.5 },
  ], pedals: [] };
  await piano.bank.loadEncoded([...sampleRequirements(piano.performance, 16).keys()], undefined, signal());
  const oldWindow = piano.requestWindow(0);
  await decoding;
  const newWindow = piano.requestWindow(50);
  finish();
  await assert.rejects(oldWindow, { name: 'AbortError' });
  await newWindow;
  assert.ok(piano.windowReady(50));
  assert.equal(piano.windowReady(0), false);
  assert.equal(piano.nextPrepareTime, 53);
  assert.equal(piano.preparation, null);
});

test('every ps29_01 passage fits the rolling budget, including at half tempo', () => {
  const midi = new Midi(readFileSync(new URL('../public/midi/ps29_01.mid', import.meta.url)));
  const performance = compilePerformance(midi, new Set(midi.tracks.map((_, i) => i)));
  assert.equal(performance.notes.length, 8430);
  const bytes = plan => [...plan.values()].reduce((sum, seconds) => sum + Math.ceil(seconds * 44100) * 2 * 4, 0);
  assert.ok(bytes(sampleRequirements(performance, 16, 0, Infinity, 0.5)) > DECODED_BUDGET);
  for (let position = 0; position < performance.duration; position += 2) {
    assert.ok(bytes(sampleRequirements(performance, 16, position, 12, 0.5)) < DECODED_BUDGET, `Position ${position}`);
  }
});

test('camera drift moves closer, toward overhead, and smoothly returns to its original framing', () => {
  assert.deepEqual(cameraDrift(0), cameraDrift(72));
  assert.deepEqual(cameraDrift(20, false), cameraDrift(0));
  assert.ok(cameraDrift(20).z < cameraDrift(0).z);
  assert.ok(cameraDrift(44).z > cameraDrift(0).z);
  for (let time = 0; time <= 144; time += 0.1) {
    const pose = cameraDrift(time), next = cameraDrift(time + 0.01);
    assert.ok(pose.z >= 11.8 && pose.z <= 19);
    assert.ok(pose.x >= -14 && pose.x <= -8);
    assert.ok(Math.abs(next.z - pose.z) < 0.01);
  }
});
