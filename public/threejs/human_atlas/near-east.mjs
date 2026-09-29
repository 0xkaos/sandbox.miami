import { containsPoint, distanceKm, inRegion } from './model.mjs';

// Dates here select reviewed map phases. City windows do not encode settlement
// foundation or abandonment. Polygons remain approximate source reconstructions.
export function activeNearEast(catalog, year) {
  if (!catalog) return { areas: [], places: [] };
  return {
    areas: catalog.features.filter(item => item.start <= year && year <= item.end),
    places: catalog.places.filter(item => item.start <= year && year <= item.end),
  };
}

export function nearEastAt(catalog, year, lat, lon) {
  const { areas, places } = activeNearEast(catalog, year);
  const hits = areas.filter(item => containsPoint(item.geometry, lon, lat));
  hits.sort((a, b) => (a.kind === 'culture') - (b.kind === 'culture') || (a.area ?? Infinity) - (b.area ?? Infinity));
  const city = places.filter(item => distanceKm(lat, lon, item.lat, item.lon) <= 18)
    .sort((a, b) => distanceKm(lat, lon, a.lat, a.lon) - distanceKm(lat, lon, b.lat, b.lon))[0];
  return city ? [city, ...hits] : hits;
}

export function nearEastRole(item, year) {
  return item.roles?.find(role => role.start <= year && year <= role.end)?.label ?? null;
}

export function nearEastForRegion(catalog, year, region) {
  const { areas, places } = activeNearEast(catalog, year);
  const included = item => inRegion([item.lat, item.lon, 0, 2], region);
  // One card per continuing polity or cultural region, even when the source
  // changes its polygon during this year. Places remain separate point records.
  const unique = new Map();
  for (const item of areas.filter(included)) if (!unique.has(item.name)) unique.set(item.name, item);
  return [...unique.values()].sort((a, b) => (a.kind === 'culture') - (b.kind === 'culture') || a.name.localeCompare(b.name))
    .concat(places.filter(included));
}

export function nearEastSnapshot(catalog, year, region) {
  if (!catalog) return null;
  return {
    status: 'Selected dated regional records; boundaries and city display windows are approximate.',
    source: catalog.source,
    records: nearEastForRegion(catalog, year, region).map(item =>
      ({ id: item.id, name: item.name, kind: item.kind, start: item.start, end: item.end,
         lat: item.lat, lon: item.lon, confidence: item.confidence ?? 'site location', note: item.note,
         roleAtYear: nearEastRole(item, year), sources: item.sources,
         ...(item.sourceInterval ? { sourceInterval: item.sourceInterval } : {}),
         ...(item.url ? { url: item.url } : {}) })),
  };
}
