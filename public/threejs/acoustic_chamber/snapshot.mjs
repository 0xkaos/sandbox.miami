// Portable render snapshots: JSON metadata, then little-endian float32 E and p,
// followed by the uint8 domain mask. X varies fastest; samples are cell-centered.
export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAGIC = 'ACFLD001';
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });

export function captureField(field, name = 'Untitled field') {
    field.updateGradient();
    return { meta: { format: 'acoustic-field', version: 1, name, createdAt: new Date().toISOString(),
        ...field.metadata(), time: field.time, meanEnergy: field.meanEnergy, levels: [0.06, 0.18, 0.55] },
    energy: field.meanSquare.slice(), pressure: field.pressure.slice(), mask: field.mask.slice() };
}

function validateMeta(meta) {
    if (!meta || meta.format !== 'acoustic-field' || meta.version !== 1) throw new Error('Unsupported field snapshot version.');
    if (typeof meta.name !== 'string' || !meta.name.trim() || meta.name.length > 120) throw new Error('Use a snapshot name of 1–120 characters.');
    if (!Number.isFinite(Date.parse(meta.createdAt))) throw new Error('Invalid capture date.');
    if (!Array.isArray(meta.dimensions) || meta.dimensions.length !== 3 || !meta.dimensions.every(n => Number.isInteger(n) && n >= 2 && n <= 192)) throw new Error('Invalid field dimensions.');
    const count = meta.dimensions.reduce((a, b) => a * b, 1);
    if (count * 9 > MAX_SNAPSHOT_BYTES - 65548) throw new Error('Field snapshot is too large.');
    const cell = meta.config?.cell;
    if (!Number.isFinite(cell) || cell <= 0 || cell > 10) throw new Error('Invalid voxel spacing.');
    for (const key of ['min', 'max']) if (!Array.isArray(meta[key]) || meta[key].length !== 3 || !meta[key].every(n => Number.isFinite(n) && Math.abs(n) < 1000)) throw new Error('Invalid field bounds.');
    for (let a = 0; a < 3; a++) if (Math.abs(meta.max[a] - meta.min[a] - meta.dimensions[a] * cell) > cell * 0.001) throw new Error('Field bounds do not match its grid.');
    if (![meta.time, meta.meanEnergy].every(n => Number.isFinite(n) && n >= 0)) throw new Error('Invalid field statistics.');
    if (!['box', 'cylinder', 'taper'].includes(meta.config.shape) || !['length', 'height', 'depth'].every(k => Number.isFinite(meta.config[k]) && meta.config[k] > 0 && meta.config[k] <= 100)) throw new Error('Invalid chamber geometry.');
    if (!Array.isArray(meta.levels) || meta.levels.length !== 3 || !meta.levels.every(n => Number.isFinite(n) && n > 0 && n <= 10)) throw new Error('Invalid shell levels.');
    return count;
}

export function validateSnapshot(snapshot) {
    const count = validateMeta(snapshot.meta);
    if (!(snapshot.energy instanceof Float32Array) || !(snapshot.pressure instanceof Float32Array) || !(snapshot.mask instanceof Uint8Array)
        || [snapshot.energy, snapshot.pressure, snapshot.mask].some(a => a.length !== count)) throw new Error('Incomplete field data.');
    let interior = 0;
    for (let i = 0; i < count; i++) {
        if (!Number.isFinite(snapshot.energy[i]) || snapshot.energy[i] < 0 || !Number.isFinite(snapshot.pressure[i]) || snapshot.mask[i] > 2) throw new Error('Field contains invalid samples.');
        if (snapshot.mask[i] === 1) interior++;
    }
    if (!interior) throw new Error('Field has no chamber interior.');
    return snapshot;
}

export function encodeSnapshot(snapshot) {
    validateSnapshot(snapshot);
    const header = encoder.encode(JSON.stringify(snapshot.meta));
    if (header.length > 65536) throw new Error('Snapshot metadata is too large.');
    const offset = Math.ceil((12 + header.length) / 4) * 4, count = snapshot.energy.length;
    const buffer = new ArrayBuffer(offset + count * 9), bytes = new Uint8Array(buffer), view = new DataView(buffer);
    bytes.set(encoder.encode(MAGIC)); view.setUint32(8, header.length, true); bytes.set(header, 12);
    for (let i = 0; i < count; i++) {
        view.setFloat32(offset + i * 4, snapshot.energy[i], true);
        view.setFloat32(offset + (count + i) * 4, snapshot.pressure[i], true);
    }
    bytes.set(snapshot.mask, offset + count * 8);
    return buffer;
}

export function decodeSnapshot(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 16 || buffer.byteLength > MAX_SNAPSHOT_BYTES) throw new Error('Invalid snapshot size (maximum 16 MiB).');
    const bytes = new Uint8Array(buffer), view = new DataView(buffer);
    if (decoder.decode(bytes.subarray(0, 8)) !== MAGIC) throw new Error('Choose an .acfield snapshot.');
    const length = view.getUint32(8, true), offset = Math.ceil((12 + length) / 4) * 4;
    if (length > 65536 || offset > buffer.byteLength) throw new Error('Truncated snapshot header.');
    const meta = JSON.parse(decoder.decode(bytes.subarray(12, 12 + length))), count = validateMeta(meta);
    if (buffer.byteLength !== offset + count * 9) throw new Error('Truncated or unexpected field data.');
    const energy = new Float32Array(count), pressure = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        energy[i] = view.getFloat32(offset + i * 4, true);
        pressure[i] = view.getFloat32(offset + (count + i) * 4, true);
    }
    return validateSnapshot({ meta, energy, pressure, mask: bytes.slice(offset + count * 8) });
}
