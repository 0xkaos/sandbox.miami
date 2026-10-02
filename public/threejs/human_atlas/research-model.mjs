// Search keeps dated observations separate from undated cultural assignments.
// A broad date range is evidence uncertainty, not continuous site occupation.
import { pointInAtlasRegion } from './model.mjs';
import { PLEIADES_MODERN_START_YEAR } from './pleiades-places.mjs';
export { pointInAtlasRegion };

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

export function buildResearchIndex({ burials = null, levant = null, euroevol = null, pleiades = null } = {}) {
  const rows = [];
  for (const event of burials?.events ?? []) rows.push({
    id: `burial:${event.id}`, kind: 'burial', title: event.site,
    subtitle: `${event.tradition} · ${event.culture || event.region} · ${event.grave}`,
    lat: event.lat, lon: event.lon, ranges: [event.modeledRange95],
    lowAgreement: event.modelAgreement != null && event.modelAgreement <= 60,
    search: normalize([event.site, event.grave, event.tradition, event.culture,
      event.region, event.country, event.graveDescription, event.burialRite, event.labId].join(' ')),
    record: event,
  });
  if (levant) for (let index = 0; index < levant.sites.length; index++) {
    const site = levant.sites[index];
    const phases = levant.phases.slice(site[9], site[9] + site[10]);
    const phaseText = phases.flatMap(row => [
      levant.dictionary.period[row[2]], levant.dictionary.type[row[3]],
      levant.dictionary.morphology[row[4]], levant.dictionary.subtype[row[5]],
    ]).join(' ');
    rows.push({
      id: `levant:${site[0]}`, kind: 'levant', title: site[2],
      subtitle: `${site[10]} recorded phase${site[10] === 1 ? '' : 's'} · Samaria / Judah survey`,
      lat: site[5], lon: site[6], ranges: phases.map(row => [row[0], row[1]]),
      search: normalize([site[1], site[2], site[3], site[4], phaseText].join(' ')),
      index,
    });
  }
  for (const site of euroevol?.sites ?? []) rows.push({
    id: `euroevol:${site.id}`, kind: 'euroevol', title: site.name,
    subtitle: `${site.country} · ${site.phases.length} undated culture association${site.phases.length === 1 ? '' : 's'}`,
    lat: site.lat, lon: site.lon, ranges: [],
    search: normalize([site.name, site.country, ...site.phases.flatMap(phase =>
      [phase.culture, phase.subculture, phase.periodCode, phase.siteType])].join(' ')),
    record: site,
  });
  if (pleiades) for (let index = 0; index < pleiades.places.length; index++) {
    const place = pleiades.places[index];
    const associations = place[12].map(i => pleiades.dictionary.temporalAssociations[i]);
    const kind = pleiades.dictionary.kinds[place[5]];
    const aliases = (place[13] ?? []).map(normalize);
    rows.push({
      id: `pleiades:${place[0]}`, kind: 'pleiades', title: place[1],
      subtitle: `${kind} · ${associations.length} broad period association${associations.length === 1 ? '' : 's'}`,
      lat: place[2], lon: place[3], ranges: associations.map(row => [row[0], row[1]]),
      timeRanges: associations.filter(row => row[2] === 0).map(row => [row[0], row[1]]),
      roughLocation: !place[4],
      aliases,
      search: normalize([place[1], ...(place[13] ?? []), place[7], kind,
        ...place[6].map(i => pleiades.dictionary.types[i].label),
        ...place[11].map(i => pleiades.dictionary.archaeologicalRemains[i])].join(' ')),
      index,
    });
  }
  return rows;
}

export function searchResearchIndex(index, { query = '', kind = 'all', scope = 'all', year = 0, region = null } = {}) {
  const needle = normalize(query).trim(), words = needle.split(/\s+/).filter(Boolean);
  const results = index.filter(row => {
    if (kind !== 'all' && row.kind !== kind) return false;
    if (scope !== 'all' && !pointInAtlasRegion(row.lat, row.lon, region)) return false;
    if (scope === 'time' && row.kind === 'pleiades' && year >= PLEIADES_MODERN_START_YEAR) return false;
    if (scope === 'time' && (row.lowAgreement || !(row.timeRanges ?? row.ranges).some(([start, end]) => start <= year && year <= end))) return false;
    return words.every(word => row.search.includes(word));
  });
  const nameRank = row => {
    const title = normalize(row.title);
    if (title === needle) return 0;
    if (row.aliases?.includes(needle)) return 1;
    if (title.startsWith(needle)) return 2;
    if (row.aliases?.some(alias => alias.startsWith(needle))) return 3;
    const tokens = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (words.every(word => tokens.some(token => token.startsWith(word)))) return 4;
    if (words.every(word => title.includes(word))) return 5;
    return 6;
  };
  // Sort can compare each row many times. Compute the query-dependent title
  // and alias rank once per result, especially for broad one-letter searches.
  const ranked = results.map(row => ({ row, rank: words.length ? nameRank(row) : 0 }));
  ranked.sort((a, b) => a.rank - b.rank || a.row.title.localeCompare(b.row.title)
    || a.row.kind.localeCompare(b.row.kind) || a.row.id.localeCompare(b.row.id));
  return ranked.map(item => item.row);
}
