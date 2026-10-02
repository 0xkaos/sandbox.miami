import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contextsAt, nearbyContexts, archaeologicalContextsSnapshot } from '../public/threejs/human_atlas/archaeological-contexts.mjs';

const catalog = { source: { title: 'Fixture' }, records: [
  { id: 'yamnaya', name: 'Steppe cemetery', evidenceKind: 'cemetery', convention: 'Yamnaya', start: -3300, end: -2700, lat: 48, lon: 40 },
  { id: 'hallstatt', name: 'Hallstatt', evidenceKind: 'settlement phase', convention: 'Hallstatt', start: -800, end: -450, lat: 47.56, lon: 13.65 },
] };

test('archaeological contexts filter by cited time and place without producing a flow', () => {
  assert.deepEqual(contextsAt(catalog, -3000).map(record => record.id), ['yamnaya']);
  assert.equal(contextsAt(catalog, -3000, { id: 'europe' }).length, 1);
  assert.equal(contextsAt(catalog, -3000, { id: 'africa' }).length, 0);
  assert.equal(nearbyContexts(catalog, -3000, 48, 40, 20)[0].id, 'yamnaya');
  const snapshot = archaeologicalContextsSnapshot(catalog, -3000, { id: 'world' });
  assert.equal(snapshot.totalRecords, 1);
  assert.equal(snapshot.byEvidenceKind.cemetery, 1);
  assert.match(snapshot.status, /not continuous occupation/);
});

test('starter context catalog retains evidence kinds, source links, and non-identity caveats', () => {
  const url = new URL('../public/threejs/human_atlas/data/archaeological-contexts.json', import.meta.url);
  const contexts = JSON.parse(readFileSync(url));
  assert.equal(contexts.schemaVersion, 1);
  assert.ok(contexts.records.length >= 14);
  assert.equal(new Set(contexts.records.map(record => record.id)).size, contexts.records.length);
  for (const record of contexts.records) {
    assert.ok(record.start <= record.end, record.id);
    assert.ok(Math.abs(record.lat) <= 90 && Math.abs(record.lon) <= 180, record.id);
    assert.ok(record.evidenceKind && record.convention && record.note, record.id);
    assert.match(record.sourceUrl, /^https:\/\//, record.id);
  }
  const hallstatt = contexts.records.find(record => record.id === 'hallstatt-salt-mine');
  const wielbark = contexts.records.find(record => record.id === 'wielbark-malbork');
  assert.match(hallstatt.association, /not proof/i);
  assert.match(wielbark.association, /not itself a Goth identity map/i);
});