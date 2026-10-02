import { distanceKm, pointInAtlasRegion } from './model.mjs';

// A context is evidence at a named place. A convention or later association
// is a search aid, never a territorial, linguistic, or biological identity.
export function contextsAt(catalog, year, region = null, limit = Infinity) {
  if (!catalog) return [];
  return catalog.records.filter(record => record.start <= year && year <= record.end
    && pointInAtlasRegion(record.lat, record.lon, region)).slice(0, limit);
}

export function nearbyContexts(catalog, year, lat, lon, radiusKm = 80, limit = 20) {
  if (!catalog || radiusKm <= 0) return [];
  const latitudeSpan = radiusKm / 111;
  const longitudeSpan = radiusKm / Math.max(20, 111 * Math.cos(lat * Math.PI / 180));
  return contextsAt(catalog, year).filter(record => Math.abs(record.lat - lat) <= latitudeSpan
    && Math.abs(record.lon - lon) <= longitudeSpan)
    .map(record => ({ ...record, distanceKm: distanceKm(lat, lon, record.lat, record.lon) }))
    .filter(record => record.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function archaeologicalContextsSnapshot(catalog, year, region, limit = 50) {
  if (!catalog) return null;
  const records = contextsAt(catalog, year, region);
  const byEvidenceKind = {};
  for (const record of records) byEvidenceKind[record.evidenceKind] = (byEvidenceKind[record.evidenceKind] ?? 0) + 1;
  return {
    status: 'Selected archaeological contexts at named places. Their date windows index the cited evidence, not continuous occupation, a culture boundary, language, ancestry, or a movement path.',
    source: catalog.source,
    totalRecords: records.length,
    byEvidenceKind,
    records: records.slice(0, limit),
  };
}