import { inRegion, distanceKm, escapeHTML as esc } from './model.mjs';

export const hasSiteLocation = site => Number.isFinite(site.lat) && Number.isFinite(site.lon);
export const phasesAt = (site, year) => site.phases.filter(p => p.start <= year && year <= p.end);
export function sitesAt(sites, year, region, location = null) {
  return sites.filter(site => hasSiteLocation(site) && phasesAt(site, year).length &&
    inRegion([site.lat, site.lon, 0, site.region], region) &&
    (!location || distanceKm(location.lat, location.lon, site.lat, site.lon) <= 1800));
}
export const searchText = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en');
export function searchSites(sites, query, scope, year, region) {
  const words = searchText(query).trim().split(/\s+/).filter(Boolean);
  const candidates = scope === 'time' ? sitesAt(sites, year, region) : sites;
  return candidates.filter(site => (scope !== 'reviewed' || site.phases.length) &&
    (scope !== 'unreviewed' || !site.phases.length) &&
    words.every(word => searchText(`${site.title} ${site.country} ${site.unescoId}`).includes(word)));
}
export function sitePhaseHTML(site, year) {
  return site.phases.length ? site.phases.map((phase, i) => `<article class="site-phase">
    <span class="section-label">${phase.start <= year && year <= phase.end ? 'Matches selected year' : 'Reviewed phase'} · ${esc(phase.precision)}</span>
    <h3>${esc(phase.label)}</h3><strong>${esc(phase.dateLabel)}</strong><p>${esc(phase.note)}</p>
    <button class="outline-button" data-site-jump="${esc(site.id)}" data-phase="${i}">Explore this period →</button>
  </article>`).join('') : '<p class="empty-note">Historical dates have not been reviewed for this site. It stays off the time-based map; you can still locate it and read its description.</p>';
}
export function siteSnapshot(sites, year, source) {
  return {
    status: source ? 'catalog available; partial date review' : 'catalog unavailable or still loading',
    scope: 'Reviewed phase intervals matching the selected year and named region. These can express uncertain dating, not continuous occupation. One point may represent a multi-part property. The catalog is selective evidence, not a settlement census.',
    attribution: source ? { ...source } : null,
    records: sites.map(site => ({
      id: site.id, title: site.title, lat: site.lat, lon: site.lon, url: site.url,
      inscriptionYear: site.inscribed, phases: phasesAt(site, year),
    })),
  };
}
