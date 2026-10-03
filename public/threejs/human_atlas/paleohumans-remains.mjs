import { distanceKm, pointInAtlasRegion } from './model.mjs';

// displayRange maps the source's uncalibrated BP +/- reported range to the atlas axis.
// It is browsing placement only, never a calibrated calendar interval.
export function paleohumansRemainsAt(catalog, year, region = null, limit = Infinity) {
  if (!catalog) return [];
  return catalog.records.filter(record => record.displayRange[0] <= year && year <= record.displayRange[1]
    && pointInAtlasRegion(record.lat, record.lon, region)).slice(0, limit);
}

export function nearbyPaleohumansRemains(catalog, year, lat, lon, radiusKm = 80, limit = 20) {
  if (!catalog || radiusKm <= 0) return [];
  const latitudeSpan = radiusKm / 111;
  const longitudeSpan = radiusKm / Math.max(20, 111 * Math.cos(lat * Math.PI / 180));
  return paleohumansRemainsAt(catalog, year).filter(record => Math.abs(record.lat - lat) <= latitudeSpan && Math.abs(record.lon - lon) <= longitudeSpan)
    .map(record => ({ ...record, distanceKm: distanceKm(lat, lon, record.lat, record.lon) }))
    .filter(record => record.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.site.localeCompare(b.site) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function paleohumansRemainsSnapshot(catalog, year, region, limit = 50) {
  if (!catalog) return null;
  const records = paleohumansRemainsAt(catalog, year, region);
  const byCulture = {};
  for (const record of records) byCulture[record.culture ?? 'Unspecified'] = (byCulture[record.culture ?? 'Unspecified'] ?? 0) + 1;
  return {
    status: 'Published uncalibrated radiocarbon results linked to PaleoHumans contexts and sites. Timeline placement converts BP +/- the source dates_range field relative to 1950 CE for browsing only; it is not a calibrated calendar interval or continuous occupation.',
    source: catalog.source,
    totalRecords: records.length,
    byCulture,
    records: records.slice(0, limit),
  };
}