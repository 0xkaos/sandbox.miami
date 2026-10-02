import { distanceKm, pointInAtlasRegion } from './model.mjs';

// A returned event is a dated burial, not a population, language, migration,
// or culture polygon. A 95.4% modeled interval can be centuries wide.
function withinDate(event, year, interval) {
  if (interval === 'mean') return event.modeledMean === year;
  const range = interval === '68' ? event.modeledRange68 : event.modeledRange95;
  return range[0] <= year && year <= range[1];
}
function usable(event, options) {
  return options.includeLowAgreement || event.modelAgreement == null || event.modelAgreement > 60;
}

export function burialEventsAt(catalog, year, region = null, options = {}) {
  if (!catalog) return [];
  const { interval = '95', limit = Infinity } = options;
  return catalog.events.filter(event => pointInAtlasRegion(event.lat, event.lon, region) && usable(event, options) && withinDate(event, year, interval))
    .slice(0, limit);
}

export function nearbyBurialEvidence(catalog, year, lat, lon, radiusKm = 50, options = {}) {
  if (!catalog || radiusKm <= 0) return [];
  const { limit = 30, interval = '95' } = options;
  const latitudeSpan = radiusKm / 111;
  const longitudeSpan = radiusKm / Math.max(20, 111 * Math.cos(lat * Math.PI / 180));
  return catalog.events.filter(event => Math.abs(event.lat - lat) <= latitudeSpan && Math.abs(event.lon - lon) <= longitudeSpan
      && usable(event, options) && withinDate(event, year, interval))
    .map(event => ({ ...event, distanceKm: distanceKm(lat, lon, event.lat, event.lon) }))
    .filter(event => event.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function burialSitesAt(catalog, year, region = null, options = {}) {
  const groups = new Map();
  for (const event of burialEventsAt(catalog, year, region, options)) {
    const key = `${event.site}\0${event.lat}\0${event.lon}`;
    if (!groups.has(key)) groups.set(key, {
      site: event.site, lat: event.lat, lon: event.lon, country: event.country,
      events: [], traditions: new Set(), modeledMeanFrom: Infinity, modeledMeanTo: -Infinity,
    });
    const group = groups.get(key);
    group.events.push(event);
    group.traditions.add(event.tradition);
    group.modeledMeanFrom = Math.min(group.modeledMeanFrom, event.modeledMean);
    group.modeledMeanTo = Math.max(group.modeledMeanTo, event.modeledMean);
  }
  return [...groups.values()].map(group => ({ ...group,
    traditions: [...group.traditions], eventCount: group.events.length }));
}

export function burialEvidenceForRegion(catalog, year, region, options = {}) {
  return burialEventsAt(catalog, year, region, options);
}

export function burialEvidenceSnapshot(catalog, year, region, options = {}) {
  if (!catalog) return null;
  const { limit = Infinity, interval = '95' } = options;
  const all = burialEventsAt(catalog, year, region, { ...options, limit: Infinity, interval });
  return {
    status: `Burial events whose modeled ${interval === '68' ? '68.3%' : interval === 'mean' ? 'mean' : '95.4%'} date ${interval === 'mean' ? 'equals' : 'includes'} this year. Date ranges express uncertainty, not burial activity throughout the interval.`,
    source: catalog.source,
    totalEvents: all.length,
    byTradition: {
      'Corded Ware': all.filter(event => event.tradition === 'Corded Ware').length,
      'Bell Beaker': all.filter(event => event.tradition === 'Bell Beaker').length,
    },
    excludedLowAgreement: options.includeLowAgreement ? 0 : catalog.events.filter(event => pointInAtlasRegion(event.lat, event.lon, region)
      && event.modelAgreement != null && event.modelAgreement <= 60 && withinDate(event, year, interval)).length,
    events: all.slice(0, limit),
  };
}
