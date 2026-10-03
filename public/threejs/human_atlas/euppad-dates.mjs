import { distanceKm, pointInAtlasRegion } from './model.mjs';

// Each range is a calibrated target-95.4% highest-density calendar interval. Several
// segments may exist because a radiocarbon calibration can be multi-modal.
export function euppadDatesAt(catalog, year, region = null, limit = Infinity) {
  if (!catalog) return [];
  return catalog.records.filter(record => record.calibratedRanges95.some(([start, end]) => start <= year && year <= end)
    && pointInAtlasRegion(record.lat, record.lon, region)).slice(0, limit);
}

export function nearbyEuppadDates(catalog, year, lat, lon, radiusKm = 80, limit = 20) {
  if (!catalog || radiusKm <= 0) return [];
  const latitudeSpan = radiusKm / 111;
  const longitudeSpan = radiusKm / Math.max(20, 111 * Math.cos(lat * Math.PI / 180));
  return euppadDatesAt(catalog, year).filter(record => Math.abs(record.lat - lat) <= latitudeSpan && Math.abs(record.lon - lon) <= longitudeSpan)
    .map(record => ({ ...record, distanceKm: distanceKm(lat, lon, record.lat, record.lon) }))
    .filter(record => record.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.site.localeCompare(b.site) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function euppadDatesSnapshot(catalog, year, region, limit = 50) {
  if (!catalog) return null;
  const records = euppadDatesAt(catalog, year, region);
  return {
    status: 'Independently calibrated EUPPAD selected radiocarbon results. Every retained target-95.4% highest-density segment from Bchron with IntCal20 is preserved; the date concerns one dated sample, not continuous occupation.',
    source: catalog.source,
    totalRecords: records.length,
    records: records.slice(0, limit),
  };
}