import { distanceKm, pointInAtlasRegion } from './model.mjs';

export function normalizeEditorNote(record) {
  if (!record || typeof record.id !== 'string' || typeof record.title !== 'string') return null;
  const lat = Number(record.lat), lon = Number(record.lon);
  const start = Number(record.start ?? record.startYear ?? record.start_year);
  const end = Number(record.end ?? record.endYear ?? record.end_year);
  if (![lat, lon, start, end].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || start > end) return null;
  return {
    id: record.id,
    title: record.title,
    lat,
    lon,
    start,
    end,
    author: typeof record.author === 'string' ? record.author : 'Editor',
    visibility: typeof record.visibility === 'string' ? record.visibility : 'public',
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : record.updated_at ?? null,
  };
}

export function notesAt(records, year, region = null) {
  return (records ?? []).filter(note => note.start <= year && year <= note.end
    && pointInAtlasRegion(note.lat, note.lon, region));
}

export function nearbyNotes(records, year, lat, lon, radiusKm = 120, limit = 10) {
  if (radiusKm <= 0) return [];
  return notesAt(records, year).map(note => ({ ...note, distanceKm: distanceKm(lat, lon, note.lat, note.lon) }))
    .filter(note => note.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.title.localeCompare(b.title))
    .slice(0, limit);
}