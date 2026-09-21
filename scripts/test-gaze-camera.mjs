import test from 'node:test';
import assert from 'node:assert/strict';
import { openCamera, preferCameraQuality, cameraDiagnostics, cameraErrorMessage } from '../public/threejs/gaze_lab/camera.mjs';

function fakeStream() {
    const track = { stopped: false, stop() { this.stopped = true; } };
    return { track, getTracks: () => [track] };
}
const failure = name => new DOMException(`Browser returned ${name}`, name);

test('initial default request has no format restrictions and does not depend on enumeration', async () => {
    const stream = fakeStream(), requests = [];
    const result = await openCamera({
        getUserMedia: async request => { requests.push(request); return stream; },
        enumerateDevices: async () => { throw new Error('Must not inspect devices before requesting access'); },
    });
    assert.equal(result, stream);
    assert.deepEqual(requests, [{ audio: false, video: true }]);
});

test('an unavailable default falls back to explicit video devices without requesting audio', async () => {
    const stream = fakeStream(), requests = [];
    const result = await openCamera({
        getUserMedia: async request => {
            requests.push(request);
            if (request.video === true) throw failure('NotFoundError');
            return stream;
        },
        enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic' }, { kind: 'videoinput', deviceId: '' },
            { kind: 'videoinput', deviceId: 'default' }, { kind: 'videoinput', deviceId: 'color-camera' }],
    });
    assert.equal(result, stream);
    assert.deepEqual(requests, [{ audio: false, video: true }, { audio: false, video: { deviceId: { exact: 'color-camera' } } }]);
});

test('permission denial is not retried or used to try a different camera', async () => {
    let calls = 0;
    await assert.rejects(openCamera({
        getUserMedia: async () => { calls++; throw failure('NotAllowedError'); },
        enumerateDevices: async () => { throw new Error('Should not enumerate'); },
    }), { name: 'NotAllowedError' });
    assert.equal(calls, 1);
});

test('an explicit selection never silently switches to a different device', async () => {
    let calls = 0;
    await assert.rejects(openCamera({
        getUserMedia: async request => { calls++; assert.equal(request.video.deviceId.exact, 'chosen-camera'); throw failure('NotFoundError'); },
        enumerateDevices: async () => { throw new Error('Should not enumerate'); },
    }, { deviceId: 'chosen-camera' }), { name: 'NotFoundError' });
    assert.equal(calls, 1);
});

test('empty or failed discovery preserves the real capture error', async () => {
    for (const enumerateDevices of [async () => [], async () => { throw failure('NotAllowedError'); }]) {
        const error = failure('NotFoundError');
        await assert.rejects(openCamera({ getUserMedia: async () => { throw error; }, enumerateDevices }), value => value === error);
    }
});

test('fallback skips stale devices and stops on a permission denial', async () => {
    const calls = [];
    await assert.rejects(openCamera({
        getUserMedia: async request => {
            const id = request.video.deviceId?.exact || 'default'; calls.push(id);
            throw failure(id === 'camera-2' ? 'NotAllowedError' : 'NotFoundError');
        },
        enumerateDevices: async () => ['camera-1', 'camera-1', 'camera-2', 'camera-3'].map(deviceId => ({ kind: 'videoinput', deviceId })),
    }), { name: 'NotAllowedError' });
    assert.deepEqual(calls, ['default', 'camera-1', 'camera-2']);
});

test('a camera that opens after cancellation is immediately released', async () => {
    const stream = fakeStream();
    let current = true, resolve;
    const pending = openCamera({ getUserMedia: () => new Promise(done => { resolve = done; }) }, { isCurrent: () => current });
    current = false;
    resolve(stream);
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(stream.track.stopped, true);
});

test('cancel during fallback enumeration prevents another capture request', async () => {
    let current = true, calls = 0;
    await assert.rejects(openCamera({
        getUserMedia: async () => { calls++; throw failure('NotFoundError'); },
        enumerateDevices: async () => { current = false; return [{ kind: 'videoinput', deviceId: 'camera' }]; },
    }, { isCurrent: () => current }), { name: 'AbortError' });
    assert.equal(calls, 1);
});

test('quality settings are optional and a rejected format does not discard the stream', async () => {
    const stream = fakeStream();
    stream.track.applyConstraints = async options => {
        assert.deepEqual(options, { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } });
        throw failure('OverconstrainedError');
    };
    await preferCameraQuality(stream.track);
    assert.equal(stream.track.stopped, false);
    await preferCameraQuality({});
});

test('diagnostics preserve browser evidence without exposing device IDs', async () => {
    const rows = await cameraDiagnostics({
        error: failure('NotFoundError'), secure: true, stage: 'Requesting camera access', request: 'Default camera; video: true',
        mediaDevices: { enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'private-id', label: 'Integrated Camera' }] },
        permissions: { query: async () => ({ state: 'prompt' }) }, policy: { allowsFeature: () => true },
    });
    const report = Object.fromEntries(rows);
    assert.equal(report['Browser error'], 'NotFoundError');
    assert.equal(report['Camera permission'], 'prompt');
    assert.equal(report['Video devices exposed'], '1 · Integrated Camera');
    assert.ok(!JSON.stringify(rows).includes('private-id'));
    assert.match(cameraErrorMessage(failure('NotFoundError')), /built-in camera can still be present/);
});

test('missing or synchronously throwing diagnostic APIs do not hide the error', async () => {
    const report = Object.fromEntries(await cameraDiagnostics({
        error: failure('NotFoundError'), secure: true, stage: 'Requesting camera access',
        permissions: { query() { throw new TypeError('Unsupported permission name'); } },
        policy: { allowsFeature() { throw new TypeError('Unsupported feature'); } },
    }));
    assert.equal(report['Camera permission'], 'Not reported by this browser');
    assert.equal(report['Video devices exposed'], 'Device list unavailable');
    assert.equal(report['Browser error'], 'NotFoundError');
});
