// Screen coordinates are normalized to the calibrated viewport. Never clamp a
// prediction before measuring error: off-screen estimates still count.
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const median = values => quantile(values, 0.5);
export function quantile(values, q) {
    if (!values.length) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const i = (sorted.length - 1) * q;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function calibrationPoints(count = 9) {
    const points = [[0.5, 0.5], [0.08, 0.1], [0.92, 0.9], [0.92, 0.1], [0.08, 0.9]];
    if (count >= 9) points.push([0.5, 0.1], [0.5, 0.9], [0.08, 0.5], [0.92, 0.5]);
    if (count >= 17) points.push([0.28, 0.3], [0.72, 0.7], [0.72, 0.3], [0.28, 0.7],
        [0.5, 0.3], [0.5, 0.7], [0.28, 0.5], [0.72, 0.5]);
    return points;
}

// These locations are deliberately different from every training target.
export const validationPoints = () => [[0.19, 0.21], [0.81, 0.79], [0.8, 0.23],
    [0.21, 0.78], [0.43, 0.42], [0.61, 0.63]];

export function extractEyeFeatures(landmarks, width, height) {
    if (!landmarks || landmarks.length < 478) return { reason: 'Bring your face into view' };
    const point = index => ({ x: landmarks[index].x * width, y: landmarks[index].y * height, z: landmarks[index].z * width });
    const eye = (a, b, iris, upper, lower) => {
        const p = point(a), q = point(b), c = point(iris), top = point(upper), bottom = point(lower);
        const dx = q.x - p.x, dy = q.y - p.y, length = Math.hypot(dx, dy);
        const ux = dx / length, uy = dy / length;
        return {
            x: ((c.x - p.x) * ux + (c.y - p.y) * uy) / length - 0.5,
            y: ((c.x - (p.x + q.x) / 2) * -uy + (c.y - (p.y + q.y) / 2) * ux) / length,
            open: Math.abs((bottom.x - top.x) * -uy + (bottom.y - top.y) * ux) / length,
            length,
        };
    };
    const left = eye(33, 133, 468, 159, 145), right = eye(362, 263, 473, 386, 374);
    if (Math.min(left.length, right.length) < 14) return { reason: 'Move a little closer to the camera' };
    if (Math.min(left.open, right.open) < 0.12) return { reason: 'Eyes closed or obscured' };
    const a = point(33), b = point(263), nose = point(1);
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const roll = Math.atan2(b.y - a.y, b.x - a.x);
    const yaw = (b.z - a.z) / span;
    const pitch = ((nose.x - center.x) * -Math.sin(roll) + (nose.y - center.y) * Math.cos(roll)) / span;
    const pose = [center.x / width, center.y / height, span / width, yaw];
    const features = [left.x, left.y, right.x, right.y, yaw, pitch, roll, ...pose.slice(0, 3)];
    if (features.some(value => !Number.isFinite(value)) || Math.abs(yaw) > 0.65
        || Math.abs(roll) > 0.45 || Math.max(Math.abs(left.x), Math.abs(right.x)) > 0.6) {
        return { reason: 'Face the screen so both eyes are visible' };
    }
    const eyePoints = [33, 159, 133, 145, 33, 468, 362, 386, 263, 374, 362, 473]
        .map(index => [landmarks[index].x, landmarks[index].y]);
    return { features, pose, eyePoints };
}

function expand(features, curved) {
    if (!curved) return features;
    const x = (features[0] + features[2]) / 2, y = (features[1] + features[3]) / 2;
    return [...features, x * x, y * y, x * y];
}

export function cleanSamples(samples) {
    if (samples.length < 8) return samples;
    const centers = samples[0].features.map((_, j) => median(samples.map(sample => sample.features[j])));
    const deviations = centers.map((center, j) => Math.max(j < 4 ? 0.006 : 0.015,
        median(samples.map(sample => Math.abs(sample.features[j] - center))) * 1.4826));
    return samples.filter(sample => sample.features.every((value, j) => Math.abs(value - centers[j]) < 4.5 * deviations[j]));
}

// Ridge regression with feature scaling and an unpenalized intercept. Use a
// fixed regularizer; the separate validation set is never used to fit this model.
export function fitGaze(samples, curved = false) {
    if (samples.length < 20) throw new Error('Not enough eye samples. Try calibration again.');
    const rows = samples.map(sample => expand(sample.features, curved));
    const columns = rows[0].length;
    const mean = Array.from({ length: columns }, (_, j) => rows.reduce((sum, row) => sum + row[j], 0) / rows.length);
    const floors = [0.015, 0.01, 0.015, 0.01, 0.04, 0.04, 0.04, 0.04, 0.04, 0.03, 0.002, 0.001, 0.001];
    const scale = mean.map((m, j) => Math.max(floors[j], Math.sqrt(rows.reduce((sum, row) => sum + (row[j] - m) ** 2, 0) / rows.length)));
    const size = columns + 1;
    const matrix = Array.from({ length: size }, () => new Float64Array(size + 2));
    rows.forEach((row, i) => {
        const z = [1, ...row.map((v, j) => (v - mean[j]) / scale[j])];
        for (let a = 0; a < size; a++) {
            for (let b = 0; b < size; b++) matrix[a][b] += z[a] * z[b] / rows.length;
            matrix[a][size] += z[a] * samples[i].target[0] / rows.length;
            matrix[a][size + 1] += z[a] * samples[i].target[1] / rows.length;
        }
    });
    for (let j = 1; j < size; j++) matrix[j][j] += 0.035;
    // Partial-pivot Gaussian elimination, solving x and y together.
    for (let col = 0; col < size; col++) {
        let pivot = col;
        for (let row = col + 1; row < size; row++) if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
        [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
        const divisor = matrix[col][col];
        if (Math.abs(divisor) < 1e-10) throw new Error('Could not fit calibration. Try again with brighter, even light.');
        for (let j = col; j < size + 2; j++) matrix[col][j] /= divisor;
        for (let row = 0; row < size; row++) {
            if (row === col) continue;
            const factor = matrix[row][col];
            for (let j = col; j < size + 2; j++) matrix[row][j] -= factor * matrix[col][j];
        }
    }
    const coefficients = matrix.map(row => [row[size], row[size + 1]]);
    const pose = samples[0].pose.map((_, j) => median(samples.map(sample => sample.pose[j])));
    return { mean, scale, coefficients, curved, pose };
}

export function predictGaze(model, features) {
    const row = [1, ...expand(features, model.curved).map((v, j) => (v - model.mean[j]) / model.scale[j])];
    return [0, 1].map(axis => row.reduce((sum, value, j) => sum + value * model.coefficients[j][axis], 0));
}

export function headMoved(reference, pose) {
    return Math.hypot(pose[0] - reference[0], pose[1] - reference[1]) > 0.12
        || Math.abs(Math.log(pose[2] / reference[2])) > 0.3 || Math.abs(pose[3] - reference[3]) > 0.22;
}

export function validationReport(groups, width, height) {
    const distance = (a, b) => Math.hypot((a[0] - b[0]) * width, (a[1] - b[1]) * height);
    const errors = [], jitter = [];
    const points = groups.map(group => {
        const center = [0, 1].map(axis => median(group.predictions.map(p => p[axis])));
        for (const point of group.predictions) {
            errors.push(distance(point, group.target));
            jitter.push(distance(point, center));
        }
        return { target: group.target, center, error: distance(center, group.target), predictions: group.predictions };
    });
    const error = median(errors);
    return { error, p90: quantile(errors, 0.9), jitter: median(jitter), percent: error / Math.hypot(width, height) * 100,
        samples: errors.length, points, width, height };
}
