export const MIN_YEAR = -70000;
export const MAX_YEAR = 2017;
export const TIME_KNOTS = [-70000, -48000, -20000, -10000, -4000, -1000, 500, 1500, 1800, 2017];
export const REGIONS = [
  { id: 'world', name: 'World', lat: 24, lon: 24, distance: 3.2 },
  { id: 'europe', name: 'Europe', lat: 49, lon: 15, distance: 1.85, index: 1 },
  { id: 'mediterranean', name: 'Mediterranean', lat: 34, lon: 24, distance: 1.8, bounds: [-12, 24, 46, 47] },
  { id: 'africa', name: 'Africa', lat: 4, lon: 22, distance: 2.3, index: 0 },
  { id: 'asia', name: 'Asia', lat: 30, lon: 91, distance: 2.6, index: 2 },
  { id: 'americas', name: 'Americas', lat: 13, lon: -87, distance: 2.7, indices: [3, 4] },
  { id: 'oceania', name: 'Oceania', lat: -20, lon: 140, distance: 2.2, index: 5 },
];
export const CATEGORY_COLORS = { migration: '#81cfbf', technology: '#e7c37e', society: '#b7a4e8', religion: '#d9a0bd', famine: '#dfaa6c', plague: '#ef8378', climate: '#8fbacb' };
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const mix = (a, b, t) => a + (b - a) * t;
export function bracket(years, year) {
  if (year < years[0] || year > years.at(-1)) return null;
  let lo = 0, hi = years.length - 1;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (years[mid] < year) lo = mid + 1; else hi = mid; }
  if (years[lo] === year) return { a: lo, b: lo, t: 0 };
  return { a: lo - 1, b: lo, t: (year - years[lo - 1]) / (years[lo] - years[lo - 1]) };
}
export function yearToPosition(year) {
  const b = bracket(TIME_KNOTS, clamp(year, MIN_YEAR, MAX_YEAR));
  return (b.a + (b.b - b.a) * b.t) / (TIME_KNOTS.length - 1);
}
export function positionToYear(position) {
  const x = clamp(position, 0, 1) * (TIME_KNOTS.length - 1), i = Math.min(TIME_KNOTS.length - 2, Math.floor(x));
  return mix(TIME_KNOTS[i], TIME_KNOTS[i + 1], x - i);
}
export function formatYear(year) { const n = Math.round(year); return n <= 0 ? `${Math.max(1, Math.abs(n)).toLocaleString('en-US')} BCE` : `${n} CE`; }
export function formatPeople(value) {
  if (value == null || !Number.isFinite(value)) return 'Unknown';
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e8 ? 0 : 1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(value >= 1e5 ? 0 : 1)}K`;
  return Math.round(value).toLocaleString('en-US');
}
export function densityHeight(density, scale = 'log', gain = 1) {
  return gain * (scale === 'linear' ? density * .00015 : .1 * Math.log10(1 + Math.max(0, density)));
}
export function populationAt(meta, values, year, output = new Float32Array(meta.cells.length)) {
  const b = bracket(meta.years, year);
  if (!b) return null;
  const n = meta.cells.length;
  for (let i = 0; i < n; i++) output[i] = mix(values[b.a * n + i], values[b.b * n + i], b.t);
  return output;
}
export function inRegion(cell, region) {
  if (region.id === 'world') return true;
  if (region.bounds) return cell[1] >= region.bounds[0] && cell[0] >= region.bounds[1] && cell[1] <= region.bounds[2] && cell[0] <= region.bounds[3];
  return region.indices ? region.indices.includes(cell[3]) : cell[3] === region.index;
}
export function summarize(meta, populations, region) {
  if (!populations) return { total: null, area: 0, cells: 0, regions: [], peak: null };
  const bins = meta.regions.map(name => ({ name, population: 0 }));
  let total = 0, area = 0, cells = 0, peak = null;
  for (let i = 0; i < populations.length; i++) {
    const cell = meta.cells[i];
    if (!inRegion(cell, region)) continue;
    const p = populations[i]; total += p; area += cell[2]; cells++;
    bins[cell[3]].population += p;
    if (!peak || p / cell[2] > peak.density) peak = { index: i, density: p / cell[2], population: p };
  }
  return { total, area, cells, regions: bins.filter(x => x.population > 0).sort((a, b) => b.population - a.population), peak };
}
export function distanceKm(aLat, aLon, bLat, bLon) {
  const rad = Math.PI / 180, dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742.0176 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function contextWindow(year) { return year < -10000 ? 4000 : year < -1000 ? 600 : year < 1500 ? 100 : 35; }
export function nearbyEvents(events, year, region, category = 'all', location = null) {
  const window = contextWindow(year);
  return events.filter(e => (category === 'all' || e.kind === category)
    && e.start <= year + window && e.end >= year - window
    && (!location || distanceKm(location.lat, location.lon, e.lat, e.lon) < 1800)
    && (location || region.id === 'world' || inRegion([e.lat, e.lon, 0, e.region], region)))
    .sort((a, b) => Math.abs((a.start + a.end) / 2 - year) - Math.abs((b.start + b.end) / 2 - year));
}
export function migrationProgress(route, year) { return clamp((year - route.start) / (route.end - route.start), 0, 1); }
export function activeMigrations(routes, year) { return routes.filter(r => year >= r.start && year <= r.end + (r.hold ?? 0)); }
export function sourceLinks(ids, sources) { return ids.map(id => sources.find(s => s.id === id)).filter(Boolean); }
function inRing(lon, lat, ring) {
  // Unwrap consecutive vertices, then put the query in the same longitude
  // interval. Wrapping each vertex around the query creates false interiors
  // on the opposite side of a polygon crossing the international date line.
  let previous = ring[0]?.[0] ?? 0;
  const xs = ring.map(p => { const x = p[0] + 360 * Math.round((previous - p[0]) / 360); previous = x; return [x, p[1]]; });
  const center = (Math.min(...xs.map(p => p[0])) + Math.max(...xs.map(p => p[0]))) / 2;
  const query = lon + 360 * Math.round((center - lon) / 360);
  let inside = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    const [xi, yi] = xs[i], [xj, yj] = xs[j];
    if (((yi > lat) !== (yj > lat)) && query < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function containsPoint(geometry, lon, lat) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.some(p => inRing(lon, lat, p[0]) && !p.slice(1).some(hole => inRing(lon, lat, hole)));
}
export function borderBracket(snapshots, year) {
  if (!snapshots.length || year < snapshots[0].year) return null;
  const last = snapshots.at(-1).year;
  return { ...bracket(snapshots.map(s => s.year), Math.min(year, last)), held: year > last };
}
export function escapeHTML(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
