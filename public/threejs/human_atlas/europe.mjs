import { containsPoint, distanceKm } from './model.mjs';

function geographicBounds(region) {
  if (region.id === 'europe') return [-13, 35, 45, 72];
  if (region.id === 'africa') return [-18, -35, 52, 37];
  return region.bounds ?? null;
}

function inGeographicRegion(item, region) {
  if (!region || region.id === 'world') return true;
  // Population-grid region indices cannot classify arbitrary evidence points.
  // Use geographic windows for this independently georeferenced catalog.
  const bounds = geographicBounds(region);
  return !!bounds && item.lon >= bounds[0] && item.lon <= bounds[2]
    && item.lat >= bounds[1] && item.lat <= bounds[3];
}

function segmentIntersectsBounds([x, y], [nextX, nextY], [west, south, east, north]) {
  const dx = nextX - x, dy = nextY - y;
  let enter = 0, leave = 1;
  for (const [p, q] of [[-dx, x - west], [dx, east - x], [-dy, y - south], [dy, north - y]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const fraction = q / p;
      if (p < 0) enter = Math.max(enter, fraction);
      else leave = Math.min(leave, fraction);
      if (enter > leave) return false;
    }
  }
  return true;
}

function polygonIntersectsBounds(rings, bounds) {
  const outer = rings[0];
  const [west, south, east, north] = bounds;
  if (!outer.length || outer.every(([lon]) => lon < west) || outer.every(([lon]) => lon > east)
    || outer.every(([, lat]) => lat < south) || outer.every(([, lat]) => lat > north)) return false;
  if (outer.some(([lon, lat]) => lon >= west && lon <= east && lat >= south && lat <= north)) return true;
  const polygon = { type: 'Polygon', coordinates: rings };
  if ([[west, south], [west, north], [east, south], [east, north]]
    .some(([lon, lat]) => containsPoint(polygon, lon, lat))) return true;
  return outer.slice(1).some((point, index) => segmentIntersectsBounds(outer[index], point, bounds));
}

function areaInGeographicRegion(item, region) {
  if (!region || region.id === 'world') return true;
  const bounds = geographicBounds(region);
  if (!bounds) return false;
  // Africa's rectangular viewing window also clips southern Iberia and Sicily.
  // For these multipart areas, require a mapped component's interior point;
  // a tiny European fringe at the window edge is not an African territory.
  if (region.id === 'africa' && item.componentCenters?.length)
    return item.componentCenters.some(([lon, lat]) => inGeographicRegion({ lon, lat }, region));
  const polygons = item.geometry.type === 'Polygon' ? [item.geometry.coordinates] : item.geometry.coordinates;
  return polygons.some(rings => polygonIntersectsBounds(rings, bounds));
}

// These are two different kinds of evidence: approximate dated source
// reconstructions for peoples/polities, and ethnonym label points. EUROEVOL
// phase associations remain undated and are available only through search.
export function activeEuropeanPeoples(catalog, year) {
  if (!catalog) return { areas: [], places: [] };
  return {
    areas: catalog.features.filter(item => item.start <= year && year <= item.end),
    places: catalog.places.filter(item => item.start <= year && year <= item.end),
  };
}

export function europeanPeoplesAt(catalog, year, lat, lon) {
  const { areas, places } = activeEuropeanPeoples(catalog, year);
  const hits = areas.filter(item => containsPoint(item.geometry, lon, lat));
  hits.sort((a, b) => (a.kind === 'people') - (b.kind === 'people') || (a.area ?? Infinity) - (b.area ?? Infinity));
  const labels = places.filter(item => distanceKm(lat, lon, item.lat, item.lon) <= 35)
    .sort((a, b) => distanceKm(lat, lon, a.lat, a.lon) - distanceKm(lat, lon, b.lat, b.lon));
  return [...labels, ...hits];
}

export function europeanPeoplesForRegion(catalog, year, region) {
  const { areas, places } = activeEuropeanPeoples(catalog, year);
  const unique = new Map();
  for (const item of areas.filter(item => areaInGeographicRegion(item, region))) if (!unique.has(item.name)) unique.set(item.name, item);
  return [...unique.values()].sort((a, b) => (a.kind === 'people') - (b.kind === 'people') || a.name.localeCompare(b.name))
    .concat(places.filter(item => inGeographicRegion(item, region)));
}

export function europeanPeoplesSnapshot(catalog, year, region) {
  if (!catalog) return null;
  return {
    status: 'Approximate source reconstructions and ethnonym label points; no exact tribal borders.',
    source: catalog.source,
    records: europeanPeoplesForRegion(catalog, year, region).map(item => ({
      id: item.id, name: item.name, kind: item.kind, collection: item.collection,
      start: item.start, end: item.end,
      lat: item.lat, lon: item.lon, confidence: item.confidence, note: item.note,
      sources: item.sources,
      ...(item.sourceInterval ? { sourceInterval: item.sourceInterval } : {}),
      ...(item.namePeriod ? { namePeriod: item.namePeriod } : {}),
      ...(item.url ? { url: item.url } : {}),
    })),
  };
}

export function searchEuroevolSites(catalog, query = '', region = null, culture = '') {
  if (!catalog) return [];
  const needle = query.trim().toLocaleLowerCase();
  const cultural = culture.trim().toLocaleLowerCase();
  return catalog.sites.filter(site => {
    if (region && !inGeographicRegion(site, region)) return false;
    if (cultural && !site.phases.some(phase =>
      `${phase.culture ?? ''} ${phase.subculture ?? ''}`.toLocaleLowerCase().includes(cultural))) return false;
    if (!needle) return true;
    return `${site.name} ${site.country} ${site.phases.map(phase => `${phase.culture ?? ''} ${phase.subculture ?? ''} ${phase.siteType ?? ''}`).join(' ')}`
      .toLocaleLowerCase().includes(needle);
  });
}
