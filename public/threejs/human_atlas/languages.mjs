import { distanceKm, pointInAtlasRegion } from './model.mjs';

// Glottolog 5.3 is a 2026 catalog. It is shown only at this atlas's terminal
// frame for reference, not projected backwards or asserted to survey 2017.
export function activeLanguages(catalog, year) {
  return catalog && year >= catalog.referenceYear ? catalog.languages : [];
}

export function languageGroups(catalog, language) {
  if (!catalog || !language) return [];
  const byId = new Map(catalog.groups.map(group => [group.id, group]));
  const path = [];
  let next = language.parentId || language.familyId;
  const seen = new Set();
  while (next && !seen.has(next)) {
    seen.add(next);
    const group = byId.get(next);
    if (!group) break;
    path.push(group);
    next = group.parentId;
  }
  return path.reverse();
}

export function nearbyLanguages(catalog, year, lat, lon, radiusKm = 150, limit = 30) {
  const nearby = [];
  for (const language of activeLanguages(catalog, year)) {
    const distance = distanceKm(lat, lon, language.lat, language.lon);
    if (distance <= radiusKm) nearby.push({ ...language, distanceKm: distance });
  }
  return nearby.sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name)).slice(0, limit);
}

export function languageAt(catalog, year, lat, lon, radiusKm = 35) {
  return nearbyLanguages(catalog, year, lat, lon, radiusKm, 1)[0] ?? null;
}

// `groupId` may be a top-level family, a subgroup (e.g. Germanic), or an
// isolate. Counts represent catalog entries with representative points,
// never people or speaker populations.
export function languagesForRegion(catalog, year, region, groupId = null) {
  const selected = activeLanguages(catalog, year)
    .filter(language => pointInAtlasRegion(language.lat, language.lon, region));
  if (!groupId) return selected.sort((a, b) => a.name.localeCompare(b.name));
  const byId = new Map(catalog.groups.map(group => [group.id, group]));
  const belongs = language => {
    let next = language.parentId || language.familyId;
    const seen = new Set();
    while (next && !seen.has(next)) {
      if (next === groupId) return true;
      seen.add(next);
      next = byId.get(next)?.parentId;
    }
    return false;
  };
  return selected.filter(belongs)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function languageFamilySummary(catalog, year, region, groupId = null) {
  const counts = new Map();
  for (const language of languagesForRegion(catalog, year, region, groupId)) {
    const item = counts.get(language.familyId) || { id: language.familyId, name: language.familyName, count: 0 };
    item.count++;
    counts.set(language.familyId, item);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function languageSnapshot(catalog, year, region, sampleLimit = 80, groupId = null) {
  if (!catalog) return null;
  const languages = languagesForRegion(catalog, year, region, groupId);
  return {
    status: catalog.status,
    source: catalog.source,
    familyFilter: groupId ? catalog.groups.find(group => group.id === groupId) ?? { id: groupId, name: groupId } : null,
    catalogLanguageCount: languages.length,
    familyCounts: languageFamilySummary(catalog, year, region, groupId),
    sample: languages.slice(0, sampleLimit).map(({ id, name, lat, lon, familyId, familyName, aesStatus }) =>
      ({ id, name, lat, lon, familyId, familyName, aesStatus })),
  };
}
