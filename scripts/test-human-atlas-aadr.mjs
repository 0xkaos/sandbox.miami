import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aadrSamplesAt, nearbyAadrSamples, aadrSamplesSnapshot } from '../public/threejs/human_atlas/aadr-samples.mjs';
import { buildResearchIndex, searchResearchIndex } from '../public/threejs/human_atlas/research-model.mjs';

const url = new URL('../public/threejs/human_atlas/data/aadr-archaeological-samples.json', import.meta.url);
const catalog = JSON.parse(readFileSync(url));
const selectedLabel = /(?:^|_)(?:yamnaya|catacomb|sintashta|urnfield|hallstatt|la[ _-]?tene|wielbark|mycenaean|phoenician|punic|etruscan|roman)(?:_|$)/i;

test('AADR archaeological samples retain source labels, dated localities, and source provenance', () => {
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.source.license, 'CC0 1.0');
  assert.match(catalog.source.repository, /^https:\/\//);
  assert.ok(catalog.records.length >= 1_000);
  assert.equal(new Set(catalog.records.map(record => record.id)).size, catalog.records.length);
  for (const record of catalog.records) {
    assert.match(record.sourceLabel, selectedLabel, record.id);
    assert.ok(record.dateRange[0] <= record.dateRange[1], record.id);
    assert.ok(Math.abs(record.lat) <= 90 && Math.abs(record.lon) <= 180, record.id);
    assert.ok(record.site && record.dateBasis && (record.fullDate || record.dateMeanBP), record.id);
  }
});

test('AADR samples filter by source date range, locality, and searchable source label', () => {
  const sample = catalog.records.find(record => record.sourceLabel.includes('Yamnaya'));
  assert.ok(sample, 'a Yamnaya-labelled AADR record is available');
  const year = Math.round((sample.dateRange[0] + sample.dateRange[1]) / 2);
  assert.ok(aadrSamplesAt(catalog, year).some(record => record.id === sample.id));
  assert.equal(aadrSamplesAt(catalog, sample.dateRange[0] - 1).some(record => record.id === sample.id), false);
  assert.ok(nearbyAadrSamples(catalog, year, sample.lat, sample.lon, 1).some(record => record.id === sample.id));
  const snapshot = aadrSamplesSnapshot(catalog, year, { id: 'world' });
  assert.equal(snapshot.totalRecords, 1);
  assert.match(snapshot.status, /source Group ID/);
  const index = buildResearchIndex({ aadr: catalog });
  assert.ok(searchResearchIndex(index, { query: 'yamnaya' }).some(row => row.id === `aadr:${sample.id}`));
});