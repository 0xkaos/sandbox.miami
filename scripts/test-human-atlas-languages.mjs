import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REGIONS, geographicBin, pointInAtlasRegion, inRegion } from '../public/threejs/human_atlas/model.mjs';
import { activeLanguages, languagesForRegion, languageGroups, languageSnapshot } from '../public/threejs/human_atlas/languages.mjs';
import { activeLanguageAttestations, languageAttestationsForRegion, languageAttestationSnapshot } from '../public/threejs/human_atlas/language-attestations.mjs';
import { makeSnapshot } from '../public/threejs/human_atlas/snapshot.mjs';
import { SOURCES } from '../public/threejs/human_atlas/history.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../public/threejs/human_atlas/data/${name}.json`, import.meta.url)));
const population = read('population');
const languages = read('languages');
const attestations = read('language-attestations');
const world = REGIONS.find(region => region.id === 'world');
const europe = REGIONS.find(region => region.id === 'europe');
const africa = REGIONS.find(region => region.id === 'africa');

test('point evidence uses the same geographic bins and named regions as the population atlas', () => {
  for (const cell of population.cells) {
    assert.equal(geographicBin(cell[0], cell[1]), cell[3]);
    for (const region of REGIONS) {
      assert.equal(pointInAtlasRegion(cell[0], cell[1], region), inRegion(cell, region));
    }
  }
  // Region IDs without copied index metadata remain valid for public queries.
  assert.equal(pointInAtlasRegion(35.4208, 3.2303, { id: 'europe' }), false);
  assert.equal(pointInAtlasRegion(35.4208, 3.2303, { id: 'africa' }), true);
  const algerianArabic = languages.languages.find(language => language.name === 'Algerian Arabic');
  assert.ok(algerianArabic);
  assert.ok(!languagesForRegion(languages, 2017, europe).some(language => language.id === algerianArabic.id));
  assert.ok(languagesForRegion(languages, 2017, africa).some(language => language.id === algerianArabic.id));
});

test('modern family selection carries into regional snapshots without entering earlier years', () => {
  assert.equal(activeLanguages(languages, 2016).length, 0);
  assert.deepEqual(languagesForRegion(null, 2017, europe, 'germ1287'), []);
  const germanic = languagesForRegion(languages, 2017, europe, 'germ1287');
  const snapshot = languageSnapshot(languages, 2017, europe, 5, 'germ1287');
  assert.ok(germanic.length > 0);
  assert.equal(snapshot.catalogLanguageCount, germanic.length);
  assert.equal(snapshot.familyFilter.name, 'Germanic');
  assert.equal(snapshot.sample.length, 5);
  assert.equal(snapshot.familyCounts.reduce((total, row) => total + row.count, 0), germanic.length);
  assert.ok(germanic.every(language => languageGroups(languages, language).some(group => group.id === 'germ1287')));
  assert.equal(languageSnapshot(languages, 2016, europe, 5, 'germ1287').catalogLanguageCount, 0);
});

test('dated EDH points follow the same region bins without creating language ranges', () => {
  assert.equal(activeLanguageAttestations(attestations, -100).length, 2);
  assert.equal(activeLanguageAttestations(attestations, 2017).length, 0);
  assert.ok(languageAttestationsForRegion(attestations, 42, africa).some(record => record.sourceId === 'HD004092'));
  assert.ok(languageAttestationsForRegion(attestations, -100, europe).some(record => record.sourceId === 'HD056798'));
  assert.ok(!languageAttestationsForRegion(attestations, -100, africa).some(record => record.sourceId === 'HD056798'));
});

function chartAt(year, languageEvidence) {
  return makeSnapshot({
    meta: { years: [-10000, 2017], cells: [[35, 3, 100, 0]], regions: population.regions },
    values: new Float32Array([10, 20]), populations: new Float32Array([15]),
    year, region: world, events: [], migrations: [], sources: SOURCES,
    comparison: { series: { World: [[-10000, 10], [2017, 20]] } },
    borderStatus: 'held', ...languageEvidence,
  });
}

test('standalone SVG credits each included language source and preserves the family filter', () => {
  const modern = chartAt(2017, { languages: languageSnapshot(languages, 2017, world, 5, 'germ1287') });
  assert.equal(modern.data.languageEvidence.modernReference.catalogLanguageCount, 86);
  assert.ok(modern.data.sources.some(source => source.id === 'glottolog'));
  assert.match(modern.svg, /Germanic catalog points/);
  assert.match(modern.svg, /Glottolog 5\.3 \(2026\)/);
  assert.match(modern.svg, /creativecommons\.org\/licenses\/by\/4\.0/);
  const ancient = chartAt(-100, { attestations: languageAttestationSnapshot(attestations, -100, world) });
  assert.equal(ancient.data.languageEvidence.historicalAttestations.attestationCount, 2);
  assert.ok(ancient.data.sources.some(source => source.id === 'edh'));
  assert.match(ancient.svg, /Epigraphic Database Heidelberg/);
  assert.match(ancient.svg, /creativecommons\.org\/licenses\/by-sa\/4\.0/);
});
