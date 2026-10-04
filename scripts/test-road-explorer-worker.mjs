import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker.js';

function object(body) {
  return {
    body: new TextEncoder().encode(JSON.stringify(body)),
    httpEtag: '"road-test"',
    writeHttpMetadata(headers) { headers.set('Content-Type', 'application/json'); },
  };
}

function bucket(entries = {}) {
  return { get: async key => entries[key] ?? null };
}

test('ROAD explorer only serves the manifest and allowlisted partitions', async () => {
  const env = { BUCKET: bucket({
    'human-atlas/road/v1/manifest.json': object({ partitions: ['west-asia'] }),
    'human-atlas/road/v1/west-asia.json': object({ records: [{ id: 'road-00001' }] }),
  }) };
  const manifest = await worker.fetch(new Request('https://sandbox.miami/api/human-atlas/road'), env);
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.deepEqual(await manifest.json(), { partitions: ['west-asia'] });
  const partition = await worker.fetch(new Request('https://sandbox.miami/api/human-atlas/road?partition=west-asia'), env);
  assert.equal(partition.status, 200);
  assert.deepEqual(await partition.json(), { records: [{ id: 'road-00001' }] });
  const rejected = await worker.fetch(new Request('https://sandbox.miami/api/human-atlas/road?partition=../../letters'), env);
  assert.equal(rejected.status, 404);
  const post = await worker.fetch(new Request('https://sandbox.miami/api/human-atlas/road', { method: 'POST' }), env);
  assert.equal(post.status, 405);
});

test('ROAD explorer reports unpublished data without exposing bucket keys', async () => {
  const response = await worker.fetch(new Request('https://sandbox.miami/api/human-atlas/road?partition=europe'), { BUCKET: bucket() });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'ROAD explorer data has not been published.', code: 'NOT_PUBLISHED' });
});