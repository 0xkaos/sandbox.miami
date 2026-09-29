import { CATEGORY_COLORS, MIN_YEAR, MAX_YEAR, distanceKm } from './model.mjs';

// Validate the whole document before changing the running atlas. Imported text
// is rendered as text/escaped HTML; only HTTP(S) source links are accepted.
export function validateResearch(input, existing) {
  const fail = message => { throw new Error(message); };
  if (!input || input.schemaVersion !== 1) fail('Expected schemaVersion: 1. See the field notes for an example.');
  for (const key of ['sources', 'events', 'migrations']) if (input[key] !== undefined && !Array.isArray(input[key])) fail(`${key} must be an array.`);
  const sources = input.sources ?? [], events = input.events ?? [], migrations = input.migrations ?? [];
  if (sources.length > 100 || events.length > 2000 || migrations.length > 100) fail('Use at most 100 sources, 2,000 events, and 100 routes per import.');
  const ids = new Set([...existing.sources, ...existing.events, ...existing.migrations].map(x => x.id));
  function string(value, field, limit = 3000) { if (typeof value !== 'string' || !value.trim() || value.length > limit) fail(`Invalid ${field}.`); return value; }
  function identity(record) { if (!record || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(record.id)) fail('Use a short lowercase id with letters, numbers, underscores, or dashes.'); if (ids.has(record.id)) fail(`Duplicate id: ${record.id}`); ids.add(record.id); string(record.title, 'title', 180); }
  const preparedSources = sources.map(s => { identity(s); let url; try { url = new URL(s.url); } catch { fail(`Invalid source URL for ${s.id}.`); } if (!['http:', 'https:'].includes(url.protocol)) fail('Sources must use http or https links.'); return { id: s.id, title: s.title, author: string(s.author, 'author', 200), url: url.href, detail: string(s.detail, 'source detail'), status: 'Local import' }; });
  const sourceIds = new Set([...existing.sources, ...preparedSources].map(s => s.id));
  function common(r) {
    identity(r);
    if (![r.start, r.end].every(Number.isFinite) || r.start < MIN_YEAR || r.end > MAX_YEAR || r.start > r.end) fail(`Invalid dates for ${r.id}. Supported years: ${MIN_YEAR} to ${MAX_YEAR}.`);
    if (!Array.isArray(r.sources) || !r.sources.length || r.sources.some(s => !sourceIds.has(s))) fail(`Every source in ${r.id} must have a source record.`);
    return { id: r.id, title: r.title, start: r.start, end: r.end, sources: r.sources, detail: string(r.detail, 'detail') };
  }
  function coordinate(lat, lon) { if (![lat, lon].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180) fail('Coordinates must be latitude/longitude in degrees.'); }
  const preparedEvents = events.map(e => { const base = common(e); coordinate(e.lat, e.lon); if (!Object.hasOwn(CATEGORY_COLORS, e.kind)) fail(`Unknown event kind: ${e.kind}`); if (!Number.isInteger(e.region) || e.region < 0 || e.region > 5) fail('Event region must be an integer from 0 to 5.'); return { ...base, lat: e.lat, lon: e.lon, kind: e.kind, region: e.region, certainty: string(e.certainty ?? 'Local research import', 'certainty', 160) }; });
  const preparedMigrations = migrations.map(r => {
    const base = common(r);
    if (r.start === r.end) fail('Migration routes need a nonzero time interval.');
    if (!Array.isArray(r.points) || r.points.length < 2 || r.points.length > 40) fail('Routes need 2–40 [latitude, longitude] points.');
    r.points.forEach(p => { if (!Array.isArray(p) || p.length !== 2) fail('Invalid route point.'); coordinate(...p); });
    for (let i = 1; i < r.points.length; i++) if (distanceKm(...r.points[i - 1], ...r.points[i]) > 19000) fail('Add an intermediate waypoint to the nearly antipodal route segment.');
    if (!/^#[\da-fA-F]{6}$/.test(r.color)) fail('Route colors must be six-digit hex colors.');
    if (r.blend) fail('Ancestry-study mixtures require review in history.mjs; this importer accepts qualitative routes only.');
    return { ...base, points: r.points, color: r.color, hold: 0 };
  });
  if (!preparedEvents.length && !preparedMigrations.length && !preparedSources.length) fail('This file contains no records.');
  return { sources: preparedSources, events: preparedEvents, migrations: preparedMigrations };
}
