import { distanceKm, pointInAtlasRegion } from './model.mjs';

export function potterySitesAt(catalog, year, region = null, toleranceYears = 100) {
  if (!catalog) return [];
  return catalog.records.filter(record => Number.isFinite(record.lat) && Number.isFinite(record.lon)
    && Math.abs(record.displayYear - year) <= toleranceYears
    && pointInAtlasRegion(record.lat, record.lon, region));
}

export function nearbyPotterySites(catalog, year, lat, lon, radiusKm = 80, options = {}) {
  if (!catalog || radiusKm <= 0) return [];
  return potterySitesAt(catalog, year, null, options.toleranceYears).map(record => ({
    ...record, distanceKm: distanceKm(lat, lon, record.lat, record.lon),
  })).filter(record => record.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.site.localeCompare(b.site) || a.id.localeCompare(b.id))
    .slice(0, options.limit ?? 20);
}