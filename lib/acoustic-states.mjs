import { decodeSnapshot, MAX_SNAPSHOT_BYTES } from '../public/threejs/acoustic_chamber/snapshot.mjs';
const PREFIX = 'acoustic-states/v1/';
const validId = id => /^\d{13}-[a-f0-9-]{36}$/.test(id);
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function boundedBody(request) {
    if (Number(request.headers.get('content-length')) > MAX_SNAPSHOT_BYTES) throw new Error('Snapshot exceeds 16 MiB.');
    if (!request.body) throw new Error('Missing snapshot.');
    const reader = request.body.getReader(), chunks = []; let size = 0;
    while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_SNAPSHOT_BYTES) { await reader.cancel(); throw new Error('Snapshot exceeds 16 MiB.'); }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes.buffer;
}

export async function handleAcousticStates(request, env) {
    if (!env.BUCKET) return json({ error: 'Cloud storage needs the BUCKET R2 binding. Your browser captures are still available.' }, 503);
    const url = new URL(request.url);
    try {
        if (request.method === 'GET') {
            const id = url.searchParams.get('id');
            if (id !== null) {
                if (!validId(id)) return json({ error: 'Invalid snapshot ID.' }, 400);
                const object = await env.BUCKET.get(`${PREFIX}${id}.acfield`);
                if (!object) return json({ error: 'Snapshot not found.' }, 404);
                return new Response(object.body, { headers: { 'Content-Type': 'application/octet-stream',
                    'Cache-Control': 'public, max-age=31536000, immutable', 'ETag': object.httpEtag,
                    'X-Content-Type-Options': 'nosniff' } });
            }
            const cursor = url.searchParams.get('cursor');
            if (cursor?.length > 2048) return json({ error: 'Invalid list cursor.' }, 400);
            const list = await env.BUCKET.list({ prefix: PREFIX, limit: 50, include: ['customMetadata'], ...(cursor ? { cursor } : {}) });
            return json({ snapshots: list.objects.filter(o => o.key.endsWith('.acfield')).map(o => ({
                id: o.key.slice(PREFIX.length, -8), name: o.customMetadata?.name || 'Untitled field',
                createdAt: o.customMetadata?.createdAt || o.uploaded.toISOString(), bytes: o.size,
            })), cursor: list.truncated ? list.cursor : null });
        }
        if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
        if (!env.ADMIN_PASSWORD) return json({ error: 'Set ADMIN_PASSWORD in Cloudflare to enable cloud saves. Local capture and download still work.' }, 503);
        if (request.headers.get('x-admin-password') !== env.ADMIN_PASSWORD) return json({ error: 'The admin password was not accepted.' }, 401);
        if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) return json({ error: 'Save from this site.' }, 403);
        if (!request.headers.get('content-type')?.startsWith('application/octet-stream')) return json({ error: 'Send an .acfield snapshot.' }, 415);
        let buffer, snapshot;
        try { buffer = await boundedBody(request); snapshot = decodeSnapshot(buffer); }
        catch (error) { return json({ error: error.message }, 400); }
        const id = `${9999999999999 - Date.now()}-${crypto.randomUUID()}`;
        await env.BUCKET.put(`${PREFIX}${id}.acfield`, buffer, {
            httpMetadata: { contentType: 'application/octet-stream' },
            customMetadata: { name: snapshot.meta.name, createdAt: snapshot.meta.createdAt },
        });
        return json({ id, name: snapshot.meta.name, createdAt: snapshot.meta.createdAt }, 201);
    } catch { return json({ error: 'Cloud storage could not complete the request. Your local capture is unchanged; try again.' }, 503); }
}
