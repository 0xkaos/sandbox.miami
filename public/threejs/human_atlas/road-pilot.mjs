import { distanceKm, pointInAtlasRegion } from './model.mjs';

// ROAD ranges are correlation-derived BP bounds. displayRange is only the
// corresponding placement on the atlas axis with 1950 CE as BP zero.
export function roadRecordsAt(catalog, year, region = null, limit = Infinity) {
  if (!catalog) return [];
  return catalog.records.filter(record => record.displayRange[0] <= year && year <= record.displayRange[1]
    && pointInAtlasRegion(record.lat, record.lon, region)).slice(0, limit);
}

export function nearbyRoadRecords(catalog, year, lat, lon, radiusKm = 80, limit = 20) {
  if (!catalog || radiusKm <= 0) return [];
  return roadRecordsAt(catalog, year).map(record => ({
    ...record, distanceKm: distanceKm(lat, lon, record.lat, record.lon),
  })).filter(record => record.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.assemblage.localeCompare(b.assemblage) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function roadSnapshot(catalog, year, region, limit = 50) {
  if (!catalog) return null;
  const records = roadRecordsAt(catalog, year, region);
  return {
    status: 'ROAD assemblage observations use correlation-derived BP bounds. Timeline placement is not a calibrated date or continuous occupation.',
    source: catalog.source,
    selection: catalog.selection,
    totalRecords: records.length,
    records: records.slice(0, limit),
  };
}