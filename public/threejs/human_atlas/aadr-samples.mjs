import { distanceKm, pointInAtlasRegion } from './model.mjs';

export function aadrSamplesAt(catalog, year, region = null, limit = Infinity) {
  if (!catalog) return [];
  return catalog.records.filter(record => record.dateRange[0] <= year && year <= record.dateRange[1]
    && pointInAtlasRegion(record.lat, record.lon, region)).slice(0, limit);
}

export function nearbyAadrSamples(catalog, year, lat, lon, radiusKm = 80, limit = 20) {
  if (!catalog || radiusKm <= 0) return [];
  const latitudeSpan = radiusKm / 111;
  const longitudeSpan = radiusKm / Math.max(20, 111 * Math.cos(lat * Math.PI / 180));
  return aadrSamplesAt(catalog, year).filter(record => Math.abs(record.lat - lat) <= latitudeSpan
    && Math.abs(record.lon - lon) <= longitudeSpan)
    .map(record => ({ ...record, distanceKm: distanceKm(lat, lon, record.lat, record.lon) }))
    .filter(record => record.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.site.localeCompare(b.site) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function aadrSamplesSnapshot(catalog, year, region, limit = 50) {
  if (!catalog) return null;
  const records = aadrSamplesAt(catalog, year, region);
  const bySourceLabel = {};
  for (const record of records) bySourceLabel[record.sourceLabel] = (bySourceLabel[record.sourceLabel] ?? 0) + 1;
  return {
    status: 'Ancient individual samples at source localities whose published AADR date ranges include this year. A source Group ID is retained verbatim; it does not define a culture boundary, population, language, or route.',
    source: catalog.source,
    totalRecords: records.length,
    bySourceLabel,
    records: records.slice(0, limit),
  };
}