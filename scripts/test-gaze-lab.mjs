import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrationPoints, validationPoints, extractEyeFeatures, cleanSamples, fitGaze, predictGaze, headMoved, validationReport } from '../public/threejs/gaze_lab/gaze-math.mjs';

const features = (x, y) => [(x - 0.5) * 0.2, (y - 0.5) * 0.14, (x - 0.5) * 0.21, (y - 0.5) * 0.13, 0, 0.3, 0, 0.5, 0.4, 0.25];
const pose = [0.5, 0.4, 0.25, 0];
const samples = (count, transform = (x, y) => [x, y]) => calibrationPoints(count).flatMap(([x, y]) =>
    Array.from({ length: 25 }, (_, i) => ({ features: features(...transform(x, y)).map((v, j) => j < 4 ? v + Math.sin(i * 2.3 + j) * 0.0002 : v), target: [x, y], pose })));

test('calibration covers the corners; all six validation locations are held out', () => {
    for (const count of [5, 9, 17]) {
        const points = calibrationPoints(count);
        assert.equal(points.length, count);
        assert.equal(new Set(points.map(JSON.stringify)).size, count);
        for (const validation of validationPoints()) assert.ok(!points.some(point => JSON.stringify(point) === JSON.stringify(validation)));
    }
});

test('ridge learns independent eye movement with completely stationary head features', () => {
    const model = fitGaze(samples(9));
    for (const [x, y] of validationPoints()) {
        const prediction = predictGaze(model, features(x, y));
        assert.ok(Math.hypot(prediction[0] - x, prediction[1] - y) < 0.015);
    }
    assert.ok(predictGaze(model, features(1.2, -0.2))[0] > 1, 'off-screen predictions must not be clamped');
});

test('curved mapping can improve a nonlinear eye-to-screen relationship', () => {
    const nonlinear = (x, y) => [x, y + (x - 0.5) ** 2 * 0.8];
    const rows = samples(17, nonlinear);
    const linear = fitGaze(rows), curved = fitGaze(rows, true);
    const error = model => validationPoints().reduce((sum, [x, y]) => {
        const p = predictGaze(model, features(...nonlinear(x, y)));
        return sum + Math.hypot(p[0] - x, p[1] - y);
    }, 0);
    assert.ok(error(curved) < error(linear) * 0.6);
});

test('constant calibration stays numerically finite and does not invent a range', () => {
    const rows = samples(9).map(sample => ({ ...sample, features: features(0.5, 0.5) }));
    const model = fitGaze(rows, true);
    const p = predictGaze(model, features(0.5, 0.5));
    assert.ok(p.every(Number.isFinite));
    assert.ok(Math.hypot(p[0] - 0.5, p[1] - 0.5) < 1e-8);
});

test('training rejects transient feature outliers', () => {
    const rows = samples(5).slice(0, 25);
    rows.push({ ...rows[0], features: rows[0].features.map(value => value + 2) });
    assert.equal(cleanSamples(rows).length, 25);
});

test('accuracy includes raw off-screen misses and separates spread from bias', () => {
    const report = validationReport([{ target: [0.5, 0.5], predictions: [[-0.1, 0.5], [0.1, 0.5]] }], 1000, 1000);
    assert.equal(report.error, 500);
    assert.equal(report.p90, 580);
    assert.equal(report.jitter, 100);
    assert.equal(report.samples, 2);
    assert.ok(Math.abs(report.percent - 35.355339) < 0.00001);
});

function landmarks() {
    const data = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    for (const [index, x, y] of [[33, 0.32, 0.4], [133, 0.42, 0.4], [468, 0.37, 0.4], [159, 0.37, 0.37], [145, 0.37, 0.43],
        [362, 0.58, 0.4], [263, 0.68, 0.4], [473, 0.63, 0.4], [386, 0.63, 0.37], [374, 0.63, 0.43], [1, 0.5, 0.55]]) data[index] = { x, y, z: 0 };
    return data;
}

test('iris features respond to eyes independently of head pose and reject blinks', () => {
    const data = landmarks(), center = extractEyeFeatures(data, 640, 480);
    assert.equal(center.features.length, 10);
    data[468].x += 0.01; data[473].x += 0.01;
    const gazeRight = extractEyeFeatures(data, 640, 480);
    assert.deepEqual(gazeRight.pose, center.pose);
    assert.ok(gazeRight.features[0] > center.features[0] + 0.09);
    assert.ok(gazeRight.features[2] > center.features[2] + 0.09);
    data[145].y = data[159].y;
    assert.equal(extractEyeFeatures(data, 640, 480).features, undefined);
    assert.equal(extractEyeFeatures(null, 640, 480).features, undefined);
});

test('large position, distance, and head-angle changes invalidate tracking', () => {
    assert.equal(headMoved(pose, [0.52, 0.4, 0.26, 0.03]), false);
    assert.equal(headMoved(pose, [0.7, 0.4, 0.25, 0]), true);
    assert.equal(headMoved(pose, [0.5, 0.4, 0.4, 0]), true);
    assert.equal(headMoved(pose, [0.5, 0.4, 0.25, 0.4]), true);
});
