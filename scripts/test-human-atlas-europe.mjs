import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { containsPoint, REGIONS } from '../public/threejs/human_atlas/model.mjs';
import {
  activeEuropeanPeoples,
  europeanPeoplesAt,
  europeanPeoplesForRegion,
  europeanPeoplesSnapshot,
  searchEuroevolSites,
} from '../public/threejs/human_atlas/europe.mjs';

const people = JSON.parse(readFileSync(new URL('../public/threejs/human_atlas/data/european-peoples.json', import.meta.url)));
const euroevol = JSON.parse(readFileSync(new URL('../public/threejs/human_atlas/data/euroevol-sites.json', import.meta.url)));
const region = Object.fromEntries(REGIONS.map(item => [item.id, item]));

function rings(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flat();
}

test('pinned European sources produce the reviewed people areas and ethnonym labels', () => {
  assert.equal(people.schemaVersion, 1);
  assert.deepEqual(people.bounds, [-11, 29, 41, 62]);
  assert.equal(people.source.polygons.license, 'CC BY 4.0');
  assert.equal(people.source.labels.license, 'CC BY 3.0');
  assert.equal(people.features.length, 159);
  assert.equal(people.places.length, 10);
  assert.equal(new Set([...people.features, ...people.places].map(item => item.id)).size, 169);
  assert(people.features.some(item => item.name === 'Magna Frisia'));
  assert(!people.features.some(item => item.name === 'Frisia Kingdom'));
  assert(!people.places.some(item => item.name === 'Cimbri'));
});

test('European geometries and label coordinates are well formed and in the intended region', () => {
  const [west, south, east, north] = people.bounds;
  for (const area of people.features) {
    assert.equal(area.collection, 'european');
    assert(['people', 'polity'].includes(area.kind));
    assert(Number.isFinite(area.start) && Number.isFinite(area.end) && area.start <= area.end);
    assert(area.geometry.type === 'Polygon' || area.geometry.type === 'MultiPolygon');
    assert(containsPoint(area.geometry, area.lon, area.lat), `${area.id} has a representative point outside its area`);
    const components = area.geometry.type === 'Polygon' ? [area.geometry.coordinates] : area.geometry.coordinates;
    assert.equal(area.componentCenters.length, components.length, `${area.id} is missing a component reference point`);
    for (const [index, [lon, lat]] of area.componentCenters.entries())
      assert(containsPoint({ type: 'Polygon', coordinates: components[index] }, lon, lat),
        `${area.id} has a component point outside its associated polygon`);
    for (const ring of rings(area.geometry)) {
      assert(ring.length >= 4, `${area.id} has a short polygon ring`);
      assert.deepEqual(ring[0], ring.at(-1), `${area.id} has an open polygon ring`);
      for (const [lon, lat] of ring) {
        assert(lon >= west && lon <= east && lat >= south && lat <= north, `${area.id} falls outside its catalog bounds`);
      }
    }
  }
  for (const label of people.places) {
    assert.equal(label.collection, 'european');
    assert.equal(label.kind, 'ethnonym');
    assert(label.lat >= south && label.lat <= north && label.lon >= west && label.lon <= east);
    assert(label.start <= label.end);
    assert(label.namePeriod[0] <= label.start && label.end <= label.namePeriod[1]);
  }
});

test('dated people and successor polities are separate, and isolated source flashes are held', () => {
  const year100 = activeEuropeanPeoples(people, 100);
  assert.equal(year100.places.length, 10);
  assert(year100.places.some(item => item.name === 'Cherusci'));
  assert(europeanPeoplesAt(people, 100, 52.2669, 9.4717).some(item => item.name === 'Cherusci'));
  assert(activeEuropeanPeoples(people, 500).areas.some(item => item.name === 'Vandal Kingdom' && item.kind === 'polity'));
  assert(!activeEuropeanPeoples(people, 500).areas.some(item => item.name === 'Vandals'));
  const visigoth458 = activeEuropeanPeoples(people, 458).areas.find(item => item.name === 'Visigothic Kingdom');
  assert(visigoth458);
  assert.equal(visigoth458.sourceInterval[1], 457);
  assert(!people.features.some(item => item.name === 'Visigothic Kingdom' && item.sourceInterval[0] === 458));
  const saxon776 = activeEuropeanPeoples(people, 776).areas.find(item => item.name === 'Saxons');
  assert.equal(saxon776?.sourceInterval[1], 774);
  for (const item of people.features.filter(area => area.name === 'Vandal Kingdom')) {
    assert(item.lat >= 36 && item.lat <= 37 && item.lon >= 9 && item.lon <= 11,
      `${item.id} should focus near Carthage rather than a Mediterranean island`);
    assert(containsPoint(item.geometry, item.lon, item.lat));
  }
});

test('regional filtering uses geography for evidence records rather than population-grid indices', () => {
  assert(europeanPeoplesForRegion(people, 100, region.europe).some(item => item.name === 'Cherusci'));
  assert(europeanPeoplesForRegion(people, 500, region.mediterranean).some(item => item.name === 'Visigothic Kingdom'));
  assert(!europeanPeoplesForRegion(people, 100, region.mediterranean).some(item => item.name === 'Cherusci'));
  assert(europeanPeoplesForRegion(people, 500, region.africa).some(item => item.name === 'Vandal Kingdom'));
  assert(!europeanPeoplesForRegion(people, 500, region.africa).some(item =>
    item.name === 'Visigothic Kingdom' || item.name === 'Ostrogothic Kingdom'));
  assert.equal(europeanPeoplesForRegion(people, 100, region.world).length, 10);
  const snapshot = europeanPeoplesSnapshot(people, 500, region.mediterranean);
  assert(snapshot.records.every(item => item.collection === 'european' && item.start <= 500 && item.end >= 500));
  assert(europeanPeoplesSnapshot(people, 500, region.africa).records.some(item => item.name === 'Vandal Kingdom'));
});

test('multipart areas use polygon coverage, not the focus point or their combined bounding box', () => {
  const area = {
    id: 'test-multipart', name: 'Test multipart', kind: 'polity', start: 1, end: 1,
    lat: 45.5, lon: .5, componentCenters: [[.5, 45.5], [10, 31]],
    geometry: { type: 'MultiPolygon', coordinates: [
      [[[0, 45], [1, 45], [1, 46], [0, 46], [0, 45]]],
      [[[9, 30], [11, 30], [11, 32], [9, 32], [9, 30]]],
    ] },
  };
  const fixture = { features: [area], places: [] };
  assert(europeanPeoplesForRegion(fixture, 1, region.africa).some(item => item.id === area.id));
  assert.equal(europeanPeoplesForRegion(fixture, 1, { id: 'gap', bounds: [3, 35, 4, 36] }).length, 0);
  const crossing = { ...area, geometry: { type: 'Polygon', coordinates: [
    [[-1, .5], [2, .5], [2, .6], [-1, .6], [-1, .5]],
  ] } };
  assert(europeanPeoplesForRegion({ features: [crossing], places: [] }, 1,
    { id: 'crossing', bounds: [0, 0, 1, 1] }).some(item => item.id === area.id));
});

test('EUROEVOL source associations are searchable evidence without implied calendar dates', () => {
  assert.equal(euroevol.schemaVersion, 1);
  assert.equal(euroevol.source.license, 'CC0 1.0');
  assert.equal(euroevol.counts.sites, 4756);
  assert.equal(euroevol.counts.phaseRows, 2807);
  assert.equal(euroevol.counts.unlocatedPhaseRows, 1);
  assert.equal(euroevol.sites.reduce((sum, site) => sum + site.phases.length, 0), 2806);
  assert.equal(euroevol.counts.sitesWithNamedCulture, 2053);
  assert.equal(euroevol.counts.cultureAssignments['Corded Ware'], 213);
  assert.equal(euroevol.counts.cultureAssignments['Bell Beaker'], 123);
  assert(euroevol.sites.every(site => site.temporalStatus === 'undated-phase-association' && !('start' in site) && !('end' in site)));
  assert(euroevol.sites.every(site => site.phases.every(phase => !('start' in phase) && !('end' in phase))));
  assert.equal(activeEuropeanPeoples(people, -2500).areas.length, 0);
  assert.equal(activeEuropeanPeoples(people, -2500).places.length, 0);
  const corded = searchEuroevolSites(euroevol, '', region.europe, 'Corded Ware');
  assert.equal(corded.length, 215); // Search also matches six subculture associations.
  assert.equal(corded.filter(site => site.phases.some(phase => phase.culture === 'Corded Ware')).length, 209);
  assert.equal(searchEuroevolSites(euroevol, '', region.mediterranean, 'Cardial').length, 52);
  assert.equal(searchEuroevolSites(euroevol, '', region.mediterranean, 'Corded Ware').length, 0);
});
