import { distanceKm, pointInAtlasRegion } from './model.mjs';

// An EDH date interval expresses uncertainty in when an object was made. A
// match here does not imply continuous language use from start through end.
export function activeLanguageAttestations(catalog, year, windowYears = 0) {
  if (!catalog || !Number.isFinite(year)) return [];
  const window = Math.max(0, windowYears);
  return catalog.records.filter(record => record.start <= year + window && record.end >= year - window);
}

export function nearbyLanguageAttestations(catalog, year, lat, lon, radiusKm = 150, windowYears = 0, limit = 30) {
  const nearby = [];
  for (const record of activeLanguageAttestations(catalog, year, windowYears)) {
    const distance = distanceKm(lat, lon, record.lat, record.lon);
    if (distance <= radiusKm) nearby.push({ ...record, distanceKm: distance });
  }
  return nearby.sort((a, b) => a.distanceKm - b.distanceKm || a.sourceId.localeCompare(b.sourceId))
    .slice(0, limit);
}

export function languageAttestationsForRegion(catalog, year, region, windowYears = 0) {
  return activeLanguageAttestations(catalog, year, windowYears)
    .filter(record => pointInAtlasRegion(record.lat, record.lon, region))
    .sort((a, b) => a.start - b.start || a.sourceId.localeCompare(b.sourceId));
}

export function languageAttestationSnapshot(catalog, year, region, windowYears = 0) {
  if (!catalog) return null;
  const records = languageAttestationsForRegion(catalog, year, region, windowYears);
  const counts = new Map();
  for (const record of records) {
    for (const language of record.languages) {
      counts.set(language.name, (counts.get(language.name) || 0) + 1);
    }
  }
  return {
    status: catalog.status,
    source: catalog.source,
    windowYears,
    attestationCount: records.length,
    languageCounts: [...counts].map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    records,
  };
}
