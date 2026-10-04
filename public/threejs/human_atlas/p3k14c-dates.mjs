import { distanceKm, pointInAtlasRegion } from './model.mjs';

export function p3k14cDatesAt(catalog, year, region = null, { materials = null, minimumLocationAccuracy = 0, limit = Infinity } = {}) {
  if (!catalog) return [];
  return catalog.records.filter(record => record.locationAccuracy >= minimumLocationAccuracy
    && (!materials || materials.has(record.materialClass))
    && record.calibratedRanges95.some(([start, end]) => start <= year && year <= end)
    && pointInAtlasRegion(record.lat, record.lon, region)).slice(0, limit);
}

export function nearbyP3k14cDates(catalog, year, lat, lon, radiusKm = 80, options = {}) {
  if (!catalog || radiusKm <= 0) return [];
  const latitudeSpan = radiusKm / 111;
  const longitudeSpan = radiusKm / Math.max(20, 111 * Math.cos(lat * Math.PI / 180));
  return p3k14cDatesAt(catalog, year, null, options).filter(record => Math.abs(record.lat - lat) <= latitudeSpan && Math.abs(record.lon - lon) <= longitudeSpan)
    .map(record => ({ ...record, distanceKm: distanceKm(lat, lon, record.lat, record.lon) }))
    .filter(record => record.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.site.localeCompare(b.site) || a.id.localeCompare(b.id))
    .slice(0, options.limit ?? 20);
}

export function p3k14cDatesSnapshot(catalog, year, region, options = {}, limit = 50) {
  if (!catalog) return null;
  const records = p3k14cDatesAt(catalog, year, region, options);
  return {
    status: 'Independently calibrated P3K14C radiocarbon determinations. Every retained target-95.4% highest-density segment from Bchron with IntCal20 is preserved; each date concerns one sampled material, not continuous occupation.',
    source: catalog.source,
    totalRecords: records.length,
    records: records.slice(0, limit),
  };
}