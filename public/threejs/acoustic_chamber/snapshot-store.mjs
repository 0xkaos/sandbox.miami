import { encodeSnapshot, decodeSnapshot } from './snapshot.mjs';

function database() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('acoustic-fields', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('snapshots', { keyPath: 'id' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('Browser storage is unavailable. Download a snapshot to keep it.'));
    });
}
async function transaction(mode, operation) {
    const db = await database();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('snapshots', mode), request = operation(tx.objectStore('snapshots'));
        tx.oncomplete = () => { db.close(); resolve(request.result); };
        tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Could not save or read browser storage. Download a snapshot to keep it.')); };
    });
}
export async function saveLocal(snapshot, id = crypto.randomUUID()) {
    const buffer = encodeSnapshot(snapshot);
    await transaction('readwrite', store => store.put({ id, name: snapshot.meta.name, createdAt: snapshot.meta.createdAt, buffer }));
    return id;
}
export async function listLocal() {
    const db = await database();
    // Read metadata one entry at a time instead of retaining every volume in RAM.
    return new Promise((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readonly'), rows = [], request = tx.objectStore('snapshots').openCursor();
        request.onsuccess = () => {
            const cursor = request.result; if (!cursor) return;
            const { id, name, createdAt } = cursor.value; rows.push({ id, name, createdAt }); cursor.continue();
        };
        tx.oncomplete = () => { db.close(); resolve(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))); };
        tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Could not read browser captures.')); };
    });
}
export async function loadLocal(id) {
    const row = await transaction('readonly', store => store.get(id));
    if (!row) throw new Error('This capture is not in this browser. Open an R2 save or import its snapshot file.');
    return decodeSnapshot(row.buffer);
}
export function downloadSnapshot(snapshot) {
    const url = URL.createObjectURL(new Blob([encodeSnapshot(snapshot)], { type: 'application/octet-stream' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `${snapshot.meta.name.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80) || 'field'}.acfield`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function cloudRequest(query = '', options = {}) {
    const response = await fetch(`/api/acoustic-states${query}`, { ...options, signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Cloud storage is unavailable here. Browser saves and snapshot files still work.');
    }
    if (!response.headers.get('content-type')?.includes(query.includes('id=') && !options.method ? 'application/octet-stream' : 'application/json')) throw new Error('The field storage API is not available on this server.');
    return response;
}
