import { bracket, summarize, inRegion, formatYear, formatPeople, escapeHTML as esc, yearToPosition, mix } from './model.mjs';

export function populationSeries(meta, values, region) {
  return meta.years.map((year, j) => {
    let total = 0;
    for (let i = 0; i < meta.cells.length; i++) if (inRegion(meta.cells[i], region)) total += values[j * meta.cells.length + i];
    return [year, total];
  });
}
export function makeSnapshot({ meta, populations, values, year, region, events, migrations, sources, comparison, borderStatus, heritage = null, regional = null, european = null, burials = null, levant = null, contexts = null, aadrSamples = null, paleohumansRemains = null, euppadDates = null, gazetteer = null, languages = null, attestations = null }) {
  const stats = summarize(meta, populations, region), b = bracket(meta.years, year);
  const bins = [0, .1, 1, 10, 100, 1000, Infinity];
  const density = bins.slice(0, -1).map((n, i) => ({ label: i === 5 ? '1,000+' : `${n}–${bins[i + 1]}`, population: 0 }));
  if (populations) for (let i = 0; i < populations.length; i++) if (inRegion(meta.cells[i], region)) {
    const d = populations[i] / meta.cells[i][2];
    density[Math.max(0, bins.findIndex((n, k) => k < bins.length - 1 && d >= n && d < bins[k + 1]))].population += populations[i];
  }
  const series = populationSeries(meta, values, region);
  const compare = region.id === 'world' ? comparison.series.World : null;
  const comparisonBracket = compare ? bracket(compare.map(p => p[0]), year) : null;
  const comparisonValue = comparisonBracket ? mix(compare[comparisonBracket.a][1], compare[comparisonBracket.b][1], comparisonBracket.t) : null;
  const sourceIds = new Set(['hyde', 'archive', 'basemaps', 'naturalearth', ...(compare ? ['owid'] : []), ...events.flatMap(e => e.sources), ...migrations.flatMap(e => e.sources)]);
  if(heritage?.records.length)sourceIds.add('unesco');
  for(const item of regional?.records??[])for(const source of item.sources)sourceIds.add(source);
  for(const item of european?.records??[])for(const source of item.sources)sourceIds.add(source);
  if(burials?.totalEvents)sourceIds.add('burial-rituals');
  if(levant?.totalActiveSites)sourceIds.add('levant-survey');
  if(contexts?.totalRecords)sourceIds.add('archaeological-contexts');
  if(paleohumansRemains?.totalRecords)sourceIds.add('paleohumans');
  if(euppadDates?.totalRecords)sourceIds.add('euppad');
  if(gazetteer?.totalAssociatedPlaces)sourceIds.add('pleiades');
  if(languages?.catalogLanguageCount)sourceIds.add('glottolog');
  if(attestations?.attestationCount)sourceIds.add('edh');
  const result = {
    schemaVersion: 1, title: `${region.name} · ${formatYear(year)}`, year, region: { ...region },
    population: stats.total, comparisonPopulation: comparisonValue, geographicBins: stats.regions, densityBins: density,
    populationProvenance: b ? { status: b.a === b.b ? 'source reconstruction' : 'linear interpolation', fromYear: meta.years[b.a], toYear: meta.years[b.b], weight: b.t, source: 'HYDE 3.2 baseline' } : { status: 'unavailable before 10000 BCE' },
    boundaries: borderStatus, nearbyEvents: events, activeMigrations: migrations, migrationScope: 'Global context; routes are not clipped to the snapshot region.',
    heritageSites: heritage, nearEastDetail: regional, europeanDetail: european,
    archaeology: { datedBurials: burials, southernLevantSites: levant, selectedContexts: contexts, aadrAncientSamples: aadrSamples, paleohumansDatedRemains: paleohumansRemains, euppadCalibratedDates: euppadDates, ancientPlaces: gazetteer },
    languageEvidence: { historicalAttestations: attestations, modernReference: languages },
    sources: sources.filter(s => sourceIds.has(s.id)),
    limitations: [
      'Population is a historical reconstruction. No statistical confidence interval is bundled.',
      'Density is people per square kilometer of the entire 1-degree grid cell, including coastal water. It is not urban density.',
      'Geographic regions use approximate fixed bins; political territory populations are not computed.',
      'Boundary crossfades and migration paths are visual interpolations. They do not supply evidence for intermediate dates.',
      'Ancestry colors refer to particular studies; intermediate fractions and affected footprints are illustrative.',
      'Nearby events can precede or follow the selected year. Their dates are included. The event collection favors Europe and the Mediterranean.',
      'Coarse population dates may smooth over famine or plague. Events do not apply an extra loss factor to HYDE.',
      'Modern coastlines are held constant; ice sheets and exposed land bridges are not represented.',
      'Burial modeled intervals, AADR individual sample date ranges, and broad archaeological phases express different kinds of temporal uncertainty; none proves continuous activity.',
      'EUROEVOL site culture associations are searchable but lack calendar-year ranges in the selected source table, so they are not placed in dated snapshots.',
      'Pleiades period associations and representative coordinates are approximate. Modern-period names and locations are kept in search but excluded from the dated map and snapshot at 1700 CE and later. A gazetteer place is not necessarily an excavated site or continuously occupied settlement.',
      'Historical inscription findspots do not define language territories. The Glottolog catalog is a modern reference shown only at the 2017 endpoint.',
    ],
  };
  return { data: result, svg: snapshotSVG(result, series, compare) };
}
function svgText(x, y, text, size = 12, fill = '#a8b3a4', more = '') { return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${more}>${esc(text)}</text>`; }
export function sparklinePath(series, width, height, margin = 0) {
  const ys = series.map(p => Math.log10(Math.max(1, p[1]))), min = Math.min(...ys), max = Math.max(...ys);
  const left = yearToPosition(-10000), right = yearToPosition(2017);
  const path = series.filter(p => p[0] >= -10000 && p[0] <= 2017).map(([year, count], i) => `${i ? 'L' : 'M'}${(margin + (yearToPosition(year) - left) / (right - left) * (width - margin * 2)).toFixed(2)},${(height - margin - (Math.log10(Math.max(1, count)) - min) / Math.max(.001, max - min) * (height - margin * 2)).toFixed(2)}`).join(' ');
  return { path, min, max };
}
function snapshotSVG(data, series, comparison) {
  const languageSources = [];
  if (data.languageEvidence.modernReference?.catalogLanguageCount) languageSources.push({
    label: 'Glottolog 5.3 (2026) · CC BY 4.0 · glottolog.org/meta/downloads',
    url: 'https://glottolog.org/meta/downloads', license: 'https://creativecommons.org/licenses/by/4.0/',
  });
  if (data.languageEvidence.historicalAttestations?.attestationCount) languageSources.push({
    label: 'Epigraphic Database Heidelberg · CC BY-SA 4.0 · edh.ub.uni-heidelberg.de',
    url: 'https://github.com/epigraphic-database-heidelberg/data', license: 'https://creativecommons.org/licenses/by-sa/4.0/',
  });
  const W = 740, H = 690 + languageSources.length * 18, left = 42, right = 698, top = 214, bottom = 365;
  const validSeries = series.filter(p => p[1] > 0), minLog = validSeries.length ? Math.floor(Math.min(...validSeries.map(p => Math.log10(p[1])))) : 0;
  const maxLog = Math.ceil(Math.max(...series.map(p => Math.log10(Math.max(1, p[1]))), 1));
  const x = year => left + (yearToPosition(year) - yearToPosition(-10000)) / (1 - yearToPosition(-10000)) * (right - left);
  const y = pop => bottom - (Math.log10(Math.max(1, pop)) - minLog) / Math.max(1, maxLog - minLog) * (bottom - top);
  const path = s => s.filter(p => p[0] >= -10000 && p[0] <= 2017 && p[1] > 0).map(([yr, p], i) => `${i ? 'L' : 'M'}${x(yr).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const bars = data.region.id === 'world' ? data.geographicBins : data.densityBins;
  const maxBar = Math.max(...bars.map(b => b.population), 1);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(data.title)} population snapshot"><desc>${esc(languageSources.map(source => `${source.label}; source ${source.url}; license ${source.license}`).join(' | '))}</desc><rect width="740" height="${H}" fill="#142019"/><g font-family="Arial, sans-serif">`;
  svg += svgText(42, 35, 'HUMAN ATLAS / SNAPSHOT', 10, '#90a38f', 'letter-spacing="2"');
  svg += svgText(42, 78, data.title, 28, '#e6dec1', 'font-family="Georgia, serif"');
  svg += svgText(42, 140, formatPeople(data.population), 47, '#e5cd99', 'font-family="Georgia, serif"');
  svg += svgText(42, 164, data.population == null ? 'No quantitative population reconstruction for this date.' : 'people · HYDE 3.2 baseline reconstruction', 11);
  if (data.comparisonPopulation != null) svg += svgText(400, 138, `${formatPeople(data.comparisonPopulation)} · OWID comparison`, 13);
  svg += svgText(42, 194, 'Population through time · logarithmic vertical axis · era-weighted horizontal axis', 10);
  for (let power = minLog; power <= maxLog; power++) { const yy = y(10 ** power); svg += `<path d="M42 ${yy}H698" stroke="#314232" stroke-width=".7"/>` + svgText(46, yy - 5, formatPeople(10 ** power), 9, '#81917f'); }
  svg += `<path d="${path(series)}" fill="none" stroke="#ddc48c" stroke-width="2"/>`;
  if (comparison) svg += `<path d="${path(comparison)}" fill="none" stroke="#81cfbf" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  if (data.year >= -10000) svg += `<path d="M${x(data.year)} ${top}V${bottom}" stroke="#d4d8b9" stroke-dasharray="2 3"/>`;
  for (const yr of [-10000, -4000, -1000, 1500, 2017]) svg += svgText(x(yr), 383, formatYear(yr), 9, '#91a08e', `text-anchor="${yr === -10000 ? 'start' : yr === 2017 ? 'end' : 'middle'}"`);
  svg += svgText(42, 414, data.region.id === 'world' ? 'Population by approximate geographic region' : 'People living in cells of each density · people / km²', 12, '#d3d8c0');
  if (data.population != null) bars.forEach((b, i) => {
    const yy = 438 + i * 22;
    svg += svgText(42, yy + 8, b.name ?? b.label, 10);
    svg += `<rect x="157" y="${yy}" width="${(b.population / maxBar * 435).toFixed(1)}" height="9" rx="1" fill="${i % 2 ? '#9cb59b' : '#c5b685'}"/>`;
    svg += svgText(698, yy + 8, formatPeople(b.population), 10, '#cbd3bd', 'text-anchor="end"');
  });
  else svg += svgText(42, 454, 'Migration and archaeological context are available; population bars are intentionally absent.', 11);
  svg += svgText(42, 574, `Evidence: ${data.archaeology.datedBurials?.totalEvents??0} dated burials · ${data.archaeology.aadrAncientSamples?.totalRecords??0} AADR samples · ${data.archaeology.paleohumansDatedRemains?.totalRecords??0} PaleoHumans dates · ${data.archaeology.southernLevantSites?.totalActiveSites??0} Levant sites · ${data.archaeology.selectedContexts?.totalRecords??0} contexts`, 10, '#d7b88a');
  const modern = data.languageEvidence.modernReference;
  const modernLabel = modern?.familyFilter?.name ? `${modern.familyFilter.name.slice(0, 24)} catalog points` : 'modern language points';
  svg += svgText(42, 588, `${data.europeanDetail?.records.length??0} European area records · ${data.languageEvidence.historicalAttestations?.attestationCount??0} inscriptions · ${modern?.catalogLanguageCount??0} ${modernLabel}`, 10, '#d7b88a');
  const p = data.populationProvenance;
  svg += svgText(42, 608, p.fromYear != null ? `${p.status} · ${formatYear(p.fromYear)} → ${formatYear(p.toYear)}` : 'Population unavailable · no extrapolated headcounts', 10, '#d1c59f');
  svg += svgText(42, 629, '1° cells; fixed modern coastlines. Approximate regions. No bundled confidence interval.', 10);
  svg += svgText(42, 648, 'Sources: HYDE doi:10.5194/essd-9-927-2017 · archive doi:10.7910/DVN/E3H3AK', 10);
  svg += svgText(42, 667, comparison ? 'Dashed mint: ourworldindata.org/grapher/population (separate series). Gold: HYDE 3.2.' : 'Full sources, nearby events, and methodological limits accompany the JSON export.', 10);
  languageSources.forEach((source, index) => {
    svg += `<a href="${esc(source.url)}">${svgText(42, 686 + index * 18, source.label, 9, '#b9cdb9')}</a>`;
  });
  return svg + '</g></svg>';
}
export function snapshotCSV(meta, populations, region, year) {
  const header = 'year,latitude,longitude,population_estimate,cell_area_km2,density_per_km2,geographic_bin,source_year_from,source_year_to,interpolation_weight,source_url\r\n';
  if (!populations) return header;
  const b = bracket(meta.years, year);
  const rows = [];
  for (let i = 0; i < populations.length; i++) if (inRegion(meta.cells[i], region)) {
    const c = meta.cells[i];
    rows.push([year, c[0], c[1], populations[i].toFixed(3), c[2], (populations[i] / c[2]).toFixed(6), meta.regions[c[3]], meta.years[b.a], meta.years[b.b], b.t.toFixed(6), 'https://doi.org/10.5194/essd-9-927-2017'].join(','));
  }
  return header + rows.join('\r\n') + '\r\n';
}
export function downloadFile(contents, name, type) {
  const url = URL.createObjectURL(new Blob([contents], { type })), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
