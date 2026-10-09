import { distanceKm, pointInAtlasRegion } from './model.mjs';

export function p3k14cDisplayRange(record) {
  const ranges = record.calibratedRanges95;
  return [Math.min(...ranges.map(([start]) => start)), Math.max(...ranges.map(([, end]) => end))];
}

export function p3k14cDatesAt(catalog, year, region = null, { materials = null, minimumLocationAccuracy = 0, limit = Infinity } = {}) {
  if (!catalog) return [];
  return catalog.records.filter(record => {
    const [start, end] = p3k14cDisplayRange(record);
    return record.locationAccuracy >= minimumLocationAccuracy
      && (!materials || materials.has(record.materialClass))
      && start <= year && year <= end
      && pointInAtlasRegion(record.lat, record.lon, region);
  }).slice(0, limit);
}

export function nearbyP3k14cDates(catalog, year, lat, lon, radiusKm = 80, options = {}) {
  if (!catalog || radiusKm <= 0) return [];
  const latitudeSpan = radiusKm / 111;
  const longitudeSpan = radiusKm / Math.max(20, 111 * Math.cos(lat * Math.PI / 180));
  return p3k14cDatesAt(catalog, year, null, { ...options, limit: Infinity }).filter(record => Math.abs(record.lat - lat) <= latitudeSpan && Math.abs(record.lon - lon) <= longitudeSpan)
    .map(record => ({ ...record, distanceKm: distanceKm(lat, lon, record.lat, record.lon) }))
    .filter(record => record.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.site.localeCompare(b.site) || a.id.localeCompare(b.id))
    .slice(0, options.limit ?? 20);
}

export function p3k14cDatesSnapshot(catalog, year, region, options = {}, limit = 50) {
  if (!catalog) return null;
  const records = p3k14cDatesAt(catalog, year, region, options);
  return {
    status: 'Independently calibrated P3K14C radiocarbon determinations. The map uses each result\'s continuous earliest-to-latest target-95.4% display envelope to avoid flicker across multi-modal calibration gaps; the exact Bchron/IntCal20 highest-density segments remain in every record. Each date concerns one sampled material, not continuous occupation.',
    source: catalog.source,
    totalRecords: records.length,
    records: records.slice(0, limit),
  };
}