import { distanceKm, pointInAtlasRegion } from './model.mjs';

// The compact file stores each surveyed site once and keeps its dated phases
// separately. Broad archaeological period labels are not exact occupations.
const S = { id: 0, sourceSiteId: 1, name: 2, alternativeName: 3, ancientName: 4,
  lat: 5, lon: 6, locationQuality: 7, region: 8, phaseOffset: 9, phaseCount: 10 };
const P = { start: 0, end: 1, period: 2, type: 3, morphology: 4, subtype: 5,
  status: 6, sizeHa: 7, sizeQuality: 8, source: 9, pages: 10, sourceId: 11,
  alternativeSource: 12, alternativePages: 13, alternativeSourceId: 14, notes: 15 };

function dict(catalog, column, index) { return catalog.dictionary[column][index] ?? ''; }
function activePhases(catalog, siteRow, year) {
  const phases = [];
  for (let i = siteRow[S.phaseOffset], end = i + siteRow[S.phaseCount]; i < end; i++) {
    const row = catalog.phases[i];
    if (row[P.start] <= year && year <= row[P.end]) phases.push(row);
  }
  return phases;
}
function hasActivePhase(catalog, siteRow, year) {
  for (let i = siteRow[S.phaseOffset], end = i + siteRow[S.phaseCount]; i < end; i++) {
    const row = catalog.phases[i];
    if (row[P.start] <= year && year <= row[P.end]) return true;
  }
  return false;
}
function phaseRecord(catalog, row) {
  return {
    start: row[P.start], end: row[P.end], period: dict(catalog, 'period', row[P.period]),
    type: dict(catalog, 'type', row[P.type]), morphology: dict(catalog, 'morphology', row[P.morphology]),
    subtype: dict(catalog, 'subtype', row[P.subtype]),
    archaeologicalStatus: dict(catalog, 'status', row[P.status]),
    sizeHa: row[P.sizeHa], sizeQuality: dict(catalog, 'sizeQuality', row[P.sizeQuality]),
    source: dict(catalog, 'source', row[P.source]), sourcePages: row[P.pages], sourceId: row[P.sourceId],
    alternativeSource: dict(catalog, 'alternativeSource', row[P.alternativeSource]),
    alternativeSourcePages: row[P.alternativePages], alternativeSourceId: row[P.alternativeSourceId],
    notes: dict(catalog, 'notes', row[P.notes]),
  };
}
export function levantSiteRecord(catalog, index, year = null) {
  if (!catalog) return null;
  const site = catalog.sites[index];
  if (!site) return null;
  const phaseRows = year == null
    ? catalog.phases.slice(site[S.phaseOffset], site[S.phaseOffset] + site[S.phaseCount])
    : activePhases(catalog, site, year);
  return {
    id: site[S.id], sourceSiteId: site[S.sourceSiteId], name: site[S.name],
    alternativeName: site[S.alternativeName], ancientName: site[S.ancientName],
    lat: site[S.lat], lon: site[S.lon],
    locationQuality: dict(catalog, 'locationQuality', site[S.locationQuality]),
    region: dict(catalog, 'region', site[S.region]),
    phases: phaseRows.map(row => phaseRecord(catalog, row)),
  };
}

export function activeLevantSiteIndices(catalog, year, region = null) {
  if (!catalog) return [];
  const indices = [];
  for (let i = 0; i < catalog.sites.length; i++) {
    const site = catalog.sites[i];
    if (pointInAtlasRegion(site[S.lat], site[S.lon], region) && hasActivePhase(catalog, site, year)) indices.push(i);
  }
  return indices;
}

export function activeLevantSites(catalog, year, region = null, limit = Infinity) {
  return activeLevantSiteIndices(catalog, year, region).slice(0, limit)
    .map(index => levantSiteRecord(catalog, index, year));
}

export function nearbyLevantSites(catalog, year, lat, lon, radiusKm = 25, limit = 20) {
  if (!catalog || radiusKm <= 0) return [];
  const latitudeSpan = radiusKm / 111;
  const longitudeSpan = radiusKm / Math.max(20, 111 * Math.cos(lat * Math.PI / 180));
  const hits = [];
  for (let i = 0; i < catalog.sites.length; i++) {
    const site = catalog.sites[i];
    if (Math.abs(site[S.lat] - lat) > latitudeSpan || Math.abs(site[S.lon] - lon) > longitudeSpan) continue;
    const distance = distanceKm(lat, lon, site[S.lat], site[S.lon]);
    if (distance <= radiusKm && hasActivePhase(catalog, site, year)) hits.push({ index: i, distanceKm: distance });
  }
  hits.sort((a, b) => a.distanceKm - b.distanceKm || a.index - b.index);
  return hits.slice(0, limit).map(hit => ({ ...levantSiteRecord(catalog, hit.index, year), distanceKm: hit.distanceKm }));
}

export function levantSitesForRegion(catalog, year, region, limit = Infinity) {
  return activeLevantSites(catalog, year, region, limit);
}

export function levantSitesSnapshot(catalog, year, region, limit = Infinity) {
  if (!catalog) return null;
  const indices = activeLevantSiteIndices(catalog, year, region);
  return {
    status: 'Dated archaeological site phases from surveyed parts of Samaria and Judah; periods indicate evidence of activity, not continuous occupation or political affiliation.',
    source: catalog.source,
    totalActiveSites: indices.length,
    records: indices.slice(0, limit).map(index => levantSiteRecord(catalog, index, year)),
  };
}
