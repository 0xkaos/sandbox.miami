import { distanceKm, pointInAtlasRegion } from './model.mjs';

// Pleiades is a gazetteer. A location's or name's broad temporal bounds
// express an association with a period, not occupation throughout it.
// Pleiades calls AD 1700 onward "Modern"; its modern names and locations
// remain searchable, but do not establish ancient activity on a dated map.
export const PLEIADES_MODERN_START_YEAR = 1700;

const P = { id: 0, title: 1, lat: 2, lon: 3, precision: 4, kind: 5,
  types: 6, description: 7, provenance: 8, accuracyRadiusMeters: 9,
  locationSpreadKm: 10, archaeologicalRemains: 11,
  temporalAssociations: 12, nameAliases: 13 };

function associationAt(catalog, row, year, options) {
  for (const index of row[P.temporalAssociations]) {
    const [start, end, certaintyIndex, basisIndex] = catalog.dictionary.temporalAssociations[index];
    if (start <= year && year <= end && (!options.onlyCertain ||
        catalog.dictionary.associationCertainty[certaintyIndex] === 'certain') &&
        (!options.locationOnly || basisIndex === 0)) return true;
  }
  return false;
}

function eligible(catalog, row, year, region, options) {
  if (!pointInAtlasRegion(row[P.lat], row[P.lon], region) || !associationAt(catalog, row, year, options)) return false;
  if (options.preciseOnly && !row[P.precision]) return false;
  const kind = catalog.dictionary.kinds[row[P.kind]];
  if (options.kind && kind !== options.kind) return false;
  if (options.kinds && !options.kinds.has(kind)) return false;
  if (options.typeCode && !row[P.types].some(index => catalog.dictionary.types[index].code === options.typeCode)) return false;
  if (Number.isFinite(options.maxAccuracyRadiusMeters) &&
      (row[P.accuracyRadiusMeters] == null || row[P.accuracyRadiusMeters] > options.maxAccuracyRadiusMeters)) return false;
  return true;
}

function decodeAssociation(catalog, index) {
  const [start, end, certaintyIndex, basisIndex, name] = catalog.dictionary.temporalAssociations[index];
  return { start, end, basis: catalog.dictionary.temporalBasis[basisIndex],
    associationCertainty: catalog.dictionary.associationCertainty[certaintyIndex], name };
}

export function pleiadesPlaceRecord(catalog, index, year = null) {
  if (!catalog) return null;
  const row = catalog.places[index];
  if (!row) return null;
  const associations = row[P.temporalAssociations].map(i => decodeAssociation(catalog, i));
  return {
    id: row[P.id], title: row[P.title], lat: row[P.lat], lon: row[P.lon],
    placeUrl: `https://pleiades.stoa.org/places/${row[P.id]}`,
    kind: catalog.dictionary.kinds[row[P.kind]],
    types: row[P.types].map(i => catalog.dictionary.types[i]),
    description: row[P.description], provenance: catalog.dictionary.provenance[row[P.provenance]],
    locationPrecision: row[P.precision] ? 'precise' : 'rough',
    accuracyRadiusMeters: row[P.accuracyRadiusMeters],
    locationSpreadKm: row[P.locationSpreadKm],
    archaeologicalRemains: row[P.archaeologicalRemains].map(i => catalog.dictionary.archaeologicalRemains[i]),
    nameAliases: row[P.nameAliases],
    temporalAssociations: associations,
    matchingTemporalAssociations: year == null ? [] : associations.filter(period => period.start <= year && year <= period.end),
  };
}

export function pleiadesPlaceIndicesAt(catalog, year, region = null, options = {}) {
  if (!catalog || !Number.isFinite(year) || year >= PLEIADES_MODERN_START_YEAR) return [];
  const indices = [];
  for (let i = 0; i < catalog.places.length; i++) {
    if (eligible(catalog, catalog.places[i], year, region, options)) indices.push(i);
  }
  return indices;
}

export function pleiadesPlacesAt(catalog, year, region = null, options = {}) {
  const { limit = Infinity } = options;
  return pleiadesPlaceIndicesAt(catalog, year, region, options).slice(0, limit)
    .map(index => pleiadesPlaceRecord(catalog, index, year));
}

export function nearbyPleiadesPlaces(catalog, year, lat, lon, radiusKm = 50, options = {}) {
  if (!catalog || !Number.isFinite(year) || year >= PLEIADES_MODERN_START_YEAR || radiusKm <= 0) return [];
  const { limit = 30 } = options;
  const latitudeSpan = radiusKm / 111;
  const longitudeSpan = radiusKm / Math.max(20, 111 * Math.cos(lat * Math.PI / 180));
  const hits = [];
  for (let i = 0; i < catalog.places.length; i++) {
    const row = catalog.places[i];
    if (Math.abs(row[P.lat] - lat) > latitudeSpan || Math.abs(row[P.lon] - lon) > longitudeSpan ||
        !eligible(catalog, row, year, null, options)) continue;
    const distance = distanceKm(lat, lon, row[P.lat], row[P.lon]);
    if (distance <= radiusKm) hits.push({ index: i, distanceKm: distance });
  }
  hits.sort((a, b) => a.distanceKm - b.distanceKm || a.index - b.index);
  return hits.slice(0, limit).map(hit => ({ ...pleiadesPlaceRecord(catalog, hit.index, year), distanceKm: hit.distanceKm }));
}

export function pleiadesPlacesForRegion(catalog, year, region, options = {}) {
  return pleiadesPlacesAt(catalog, year, region, options);
}

export function pleiadesPlacesSnapshot(catalog, year, region = null, options = {}) {
  if (!catalog) return null;
  const { limit = 100 } = options;
  const indices = pleiadesPlaceIndicesAt(catalog, year, region, options);
  const byKind = Object.fromEntries(catalog.dictionary.kinds.map(kind => [kind, 0]));
  let roughLocations = 0;
  let largeAccuracyRadius = 0;
  let datedNameFallback = 0;
  for (const index of indices) {
    const row = catalog.places[index];
    byKind[catalog.dictionary.kinds[row[P.kind]]]++;
    if (!row[P.precision]) roughLocations++;
    if (row[P.accuracyRadiusMeters] != null && row[P.accuracyRadiusMeters] >= 1000) largeAccuracyRadius++;
    if (catalog.dictionary.temporalAssociations[row[P.temporalAssociations][0]][3] === 1) datedNameFallback++;
  }
  return {
    status: year >= PLEIADES_MODERN_START_YEAR
      ? 'Pleiades Modern-period name and location associations are searchable geographic references, not evidence of ancient activity at this date; dated map markers are suppressed from 1700 CE onward.'
      : 'Pleiades places whose location, or dated name where location dates are absent, is associated with a period containing this year. Broad period bounds are not evidence of continuous occupation. Many entries are settlements or built places, not excavated archaeological sites; representative locations may be approximate.',
    source: catalog.source,
    totalAssociatedPlaces: indices.length,
    byKind, roughLocations, largeAccuracyRadius, datedNameFallback,
    places: indices.slice(0, limit).map(index => pleiadesPlaceRecord(catalog, index, year)),
  };
}
