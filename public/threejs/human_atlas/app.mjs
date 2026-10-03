import { HistoryGlobe } from './globe.mjs';
import { SOURCES, EVENTS, MIGRATIONS, CHAPTERS } from './history.mjs';
import { MIN_YEAR, MAX_YEAR, TIME_KNOTS, REGIONS, CATEGORY_COLORS, clamp, bracket, borderBracket, formatYear, formatPeople, yearToPosition, positionToYear, populationAt, summarize, densityHeight, contextWindow, nearbyEvents, activeMigrations, migrationProgress, distanceKm, sourceLinks, escapeHTML as esc } from './model.mjs';
import { populationSeries, sparklinePath, makeSnapshot, snapshotCSV, downloadFile } from './snapshot.mjs';
import { validateResearch } from './import.mjs';
import { PopulationDetail, POPULATION_RESOLUTIONS } from './population-detail.mjs';
import { hasSiteLocation, phasesAt, sitesAt, searchSites, sitePhaseHTML, siteSnapshot } from './sites.mjs';
import { activeNearEast, nearEastForRegion, nearEastRole, nearEastSnapshot } from './near-east.mjs';
import { europeanPeoplesForRegion, europeanPeoplesSnapshot } from './europe.mjs';
import { burialEventsAt, burialSitesAt, nearbyBurialEvidence, burialEvidenceSnapshot } from './burial-evidence.mjs';
import { activeLevantSiteIndices, levantSiteRecord, nearbyLevantSites, levantSitesSnapshot } from './levant-sites.mjs';
import { PLEIADES_MODERN_START_YEAR, pleiadesPlaceIndicesAt, pleiadesPlaceRecord, nearbyPleiadesPlaces, pleiadesPlacesSnapshot } from './pleiades-places.mjs';
import { languagesForRegion, languageFamilySummary, languageGroups, languageSnapshot } from './languages.mjs';
import { languageAttestationsForRegion, languageAttestationSnapshot } from './language-attestations.mjs';
import { buildResearchIndex, searchResearchIndex } from './research-model.mjs';
import { contextsAt, nearbyContexts, archaeologicalContextsSnapshot } from './archaeological-contexts.mjs';
import { aadrSamplesAt, nearbyAadrSamples, aadrSamplesSnapshot } from './aadr-samples.mjs';
import { paleohumansRemainsAt, nearbyPaleohumansRemains, paleohumansRemainsSnapshot } from './paleohumans-remains.mjs';
import { euppadDatesAt, nearbyEuppadDates, euppadDatesSnapshot } from './euppad-dates.mjs';

const $ = selector => document.querySelector(selector);
const state = { year: -3000, region: REGIONS[0], playing: false, speed: 1, mode: 'era', category: 'all', location: null, detail: null, scale: 'log', gain: .2, opacity: .3, spikeWidth: 1.5, resolution: .5, densityColors: 'long', languageFamily: 'all', layers: { population: true, territories: true, migrations: true, ancestry: true, events: true, sites: true, archaeology: true, languages: false, rivers: false, contours: false } };
const data = { sources: [...SOURCES], events: [...EVENTS], migrations: [...MIGRATIONS] };
let meta, values, comparison, borders, nearEastCatalog, globe, populations, buffer, lastRenderedYear, ready = false, hashTimer, lastEventKey, lastRouteKey, series, currentSnapshot, borderLoadStatus;
let detailGrid=null, resolutionRequest=0, resolutionError=null, displayedPopulationYear=null;
let siteCatalog=null, siteLoadError=null, lastSiteKey=null, catalogSelection=null, siteResultLimit=40;
let europeCatalog=null, burialCatalog=null, levantCatalog=null, euroevolCatalog=null, contextCatalog=null, aadrCatalog=null, paleohumansCatalog=null, euppadCatalog=null, pleiadesCatalog=null, languageCatalog=null, languageAttestationCatalog=null;
let researchIndex=[], researchById=new Map(), researchSelection=null, researchResultLimit=40, researchLoadErrors=[], evidenceKey=null, pleiadesKey=null, catalogRevision=0;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const y = Number(params.get('year'));
  if (params.has('year') && Number.isFinite(y)) state.year = clamp(Math.round(y), MIN_YEAR, MAX_YEAR);
  state.region = REGIONS.find(r => r.id === params.get('region')) ?? state.region;
  if (['linear', 'log'].includes(params.get('scale'))) state.scale = params.get('scale');
  if (params.has('gain') && Number.isFinite(Number(params.get('gain')))) state.gain = clamp(Number(params.get('gain')), .05, 2);
  if (params.has('opacity') && Number.isFinite(Number(params.get('opacity')))) state.opacity = clamp(Number(params.get('opacity')), 0, 1);
  if (params.has('spikeWidth') && Number.isFinite(Number(params.get('spikeWidth')))) state.spikeWidth = clamp(Number(params.get('spikeWidth')), 0, 2);
  if (POPULATION_RESOLUTIONS.includes(Number(params.get('resolution')))) state.resolution = Number(params.get('resolution'));
  if (['current', 'long'].includes(params.get('densityColors'))) state.densityColors = params.get('densityColors');
  if (params.has('family')) state.languageFamily = params.get('family') || 'all';
  if (params.has('layers')) { const shown = params.get('layers').split(','); for (const key in state.layers) state.layers[key] = shown.includes(key); }
}
function saveHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const p = new URLSearchParams({ year: Math.round(state.year), region: state.region.id, scale: state.scale, gain: state.gain, opacity: state.opacity, spikeWidth: state.spikeWidth, resolution: state.resolution, densityColors: state.densityColors, layers: Object.keys(state.layers).filter(k => state.layers[k]).join(',') });
    if (state.languageFamily !== 'all') p.set('family', state.languageFamily);
    history.replaceState(null, '', `${location.pathname}${location.search}#${p}`);
  }, 250);
}
function sourceHTML(ids) { return sourceLinks(ids, data.sources).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)} ↗</a>`).join(''); }
function setPlaying(playing) {
  if (!ready) return;
  if (playing && state.year >= MAX_YEAR) setYear(MIN_YEAR);
  state.playing = playing;
  $('#play').textContent = playing ? 'Ⅱ' : '▶'; $('#play').setAttribute('aria-label', playing ? 'Pause timeline' : 'Play timeline'); $('#play').setAttribute('aria-pressed', String(playing));
  if (!playing) { $('#render-performance').textContent='Play to measure frame rate on this device.'; saveHash(); }
}
function setYear(year, pause = false) {
  if (pause) setPlaying(false);
  state.year = clamp(year, MIN_YEAR, MAX_YEAR);
  if (ready) renderState();
  if (!state.playing) saveHash();
}
function setRegion(region, move = true) {
  state.region = region; state.location = null; state.detail = null; globe?.clearSelection();
  if (move) globe?.focus(region);
  series = populationSeries(meta, values, REGIONS[0]); lastEventKey = null;
  renderState(); saveHash();
}
function chooseEvent(event) {
  setPlaying(false); state.detail = { type: 'event', item: event };
  state.location = { lat: event.lat, lon: event.lon, index: globe?.nearestCell(event.lat, event.lon) ?? -1 };
  globe?.selectLocation(event.lat, event.lon); globe?.focus({ lat: event.lat, lon: event.lon, distance: 1.9 });
  renderState(); $('#place-info').scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'instant' : 'smooth' });
}
function chooseRoute(route) {
  setPlaying(false); state.detail = { type: 'route', item: route }; state.location = null; globe?.clearSelection();
  const [lat, lon] = route.points[Math.floor(route.points.length / 2)]; globe?.focus({ lat, lon, distance: 2.2 });
  renderState(); $('#place-info').scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'instant' : 'smooth' });
}
function chooseSite(site) {
  setPlaying(false);state.detail={type:'site',item:site};
  if(hasSiteLocation(site)){
    state.location={lat:site.lat,lon:site.lon,index:globe?.nearestCell(site.lat,site.lon)??-1};
    globe?.selectLocation(site.lat,site.lon);globe?.focus({lat:site.lat,lon:site.lon,distance:1.6});
  }else{state.location=null;globe?.clearSelection();}
  renderState();$('#place-info').scrollIntoView({block:'nearest',behavior:reduceMotion?'instant':'smooth'});
}
function chooseRegional(item) {
  setPlaying(false);state.detail={type:'regional',item};
  state.location={lat:item.lat,lon:item.lon,index:globe?.nearestCell(item.lat,item.lon)??-1};
  globe?.selectLocation(item.lat,item.lon);globe?.focus({lat:item.lat,lon:item.lon,distance:1.55});
  renderState();$('#place-info').scrollIntoView({block:'nearest',behavior:reduceMotion?'instant':'smooth'});
}
function chooseEvidence(item) {
  if(item.kind==='levant'&&!item.record)item={...item,record:levantSiteRecord(levantCatalog,item.index)};
  if(item.kind==='pleiades'&&!item.record)item={...item,record:pleiadesPlaceRecord(pleiadesCatalog,item.index,Math.round(state.year))};
  setPlaying(false); state.detail={type:'evidence',item};
  state.location={lat:item.lat,lon:item.lon,index:globe?.nearestCell(item.lat,item.lon)??-1};
  globe?.selectLocation(item.lat,item.lon);globe?.focus({lat:item.lat,lon:item.lon,distance:1.45});
  renderState();$('#place-info').scrollIntoView({block:'nearest',behavior:reduceMotion?'instant':'smooth'});
}
function chooseLanguage(item) {
  setPlaying(false);state.detail={type:'language',item};
  state.location={lat:item.lat,lon:item.lon,index:globe?.nearestCell(item.lat,item.lon)??-1};
  globe?.selectLocation(item.lat,item.lon);globe?.focus({lat:item.lat,lon:item.lon,distance:1.55});
  renderState();$('#place-info').scrollIntoView({block:'nearest',behavior:reduceMotion?'instant':'smooth'});
}
function jumpSite(id, index) {
  const site=siteCatalog?.sites.find(s=>s.id===id),phase=site?.phases[index];if(!phase)return;
  $('#sites-dialog').close();setYear(Math.round((phase.start+phase.end)/2),true);chooseSite(site);
}
function siteLinkHTML(site) {
  return `<a href="${esc(site.url)}" target="_blank" rel="noopener">UNESCO · ${esc(site.title)} ↗</a>`;
}
function renderSitePanel(year) {
  const sites=sitesAt(siteCatalog?.sites??[],year,state.region,state.location);
  $('#site-count').textContent=siteCatalog?String(sites.length):'';
  $('#site-status').textContent=siteLoadError??(siteCatalog?`Reviewed phases matching this year${state.location?' within 1,800 km':''}. ${siteCatalog.counts.reviewedSites} of ${siteCatalog.counts.sites.toLocaleString('en-US')} sites dated so far; gaps reflect coverage.`:'Loading the heritage catalog…');
  // Phase labels can change while the same site remains on the map.
  const key=sites.map(s=>s.id+':'+phasesAt(s,year).map(p=>p.label).join('/')).join('|');
  if(key!==lastSiteKey){lastSiteKey=key;$('#site-list').innerHTML=sites.slice(0,6).map(site=>`<button class="event-card site-card" data-site="${esc(site.id)}"><span class="event-kind">Heritage site</span><b>${esc(site.title)}</b><small>${phasesAt(site,year).map(p=>esc(p.dateLabel)).join(' · ')}</small></button>`).join('');}
  $('#sites-at-time').textContent=sites.length>6?`Browse all ${sites.length} matching sites →`:'Browse the heritage catalog →';
}
function renderNearEastPanel(year) {
  const records=state.layers.territories?nearEastForRegion(nearEastCatalog,year,state.region):[];
  const panel=$('#near-east-panel');panel.hidden=!records.length;
  if(!records.length)return;
  $('#near-east-count').textContent=String(records.length);
  $('#near-east-list').innerHTML=records.map(item=>`<button class="regional-card" data-regional="${esc(item.id)}" style="--regional-color:${esc(item.color??'#e5d39c')}"><i aria-hidden="true"></i><span><b>${esc(item.name)}</b><small>${esc(nearEastRole(item,year)??(item.kind==='city'?'City · selected viewing window':item.kind==='culture'?'Cultural / geographic region':item.confidence==='schematic'?'Political area · schematic':'Political area · approximate'))}</small></span></button>`).join('');
}
function renderEuropePanel(year) {
  const records=state.layers.territories?europeanPeoplesForRegion(europeCatalog,year,state.region):[];
  $('#europe-panel').hidden=!records.length;
  if(!records.length)return;
  $('#europe-count').textContent=String(records.length);
  $('#europe-list').innerHTML=records.map(item=>`<button class="regional-card" data-european="${esc(item.id)}" style="--regional-color:${esc(item.color??'#bc9374')}"><i aria-hidden="true"></i><span><b>${esc(item.name)}</b><small>${item.kind==='ethnonym'?'Ethnonym · reference point':item.kind==='people'?'Named people · approximate source area':'Polity · approximate source area'}</small></span></button>`).join('');
}
function languageColor(family) {
  const selected={ 'Indo-European':'#b8a0d8','Afro-Asiatic':'#d7a679','Uralic':'#8fc3aa','Kartvelian':'#d9b87a','Dravidian':'#96b6d8','Atlantic-Congo':'#c6a86e','Austronesian':'#8cb7c2' };
  if(selected[family])return selected[family];
  let hash=0;for(const char of family??'')hash=(hash*31+char.charCodeAt(0))|0;
  return `hsl(${(hash>>>0)%360},42%,67%)`;
}
function aadrColor(label) {
  let hash=0;for(const char of label??'')hash=(hash*31+char.charCodeAt(0))|0;
  return `hsl(${(hash>>>0)%360},46%,66%)`;
}
function populateLanguageFamilies() {
  if(!languageCatalog)return;
  const roots=languageFamilySummary(languageCatalog,languageCatalog.referenceYear,REGIONS[0]);
  const groups=new Map(languageCatalog.groups.map(group=>[group.id,group]));
  const focus=['Germanic','Celtic','Italic','Romance','Slavic','Baltic','Indo-Iranian','Iranian','Indo-Aryan','Semitic','Berber','Kartvelian','Dravidian'];
  const focused=focus.map(name=>[...groups.values()].find(group=>group.name===name)).filter(Boolean);
  const valid=new Set(['all',...roots.map(group=>group.id),...focused.map(group=>group.id)]);
  if(!valid.has(state.languageFamily))state.languageFamily='all';
  $('#language-family').innerHTML=`<option value="all">All families</option><optgroup label="West Eurasian branches">${focused.map(group=>`<option value="${esc(group.id)}">${esc(group.name)}</option>`).join('')}</optgroup><optgroup label="Catalog families and isolates">${roots.map(group=>`<option value="${esc(group.id)}">${esc(group.name)} · ${group.count.toLocaleString('en-US')}</option>`).join('')}</optgroup>`;
  $('#language-family').value=state.languageFamily;
}
function renderLanguagePanel(year) {
  const panel=$('#language-panel');panel.hidden=!state.layers.languages;
  $('#language-options').hidden=!state.layers.languages;
  if(panel.hidden)return;
  if(year<2017){
    const records=languageAttestationsForRegion(languageAttestationCatalog,year,state.region);
    $('#language-count').textContent=String(records.length);
    $('#language-status').textContent=languageAttestationCatalog?`${records.length} selected, dated inscription${records.length===1?'':'s'} from the EDH sample match this year and region. The date window describes an object's dating uncertainty, not the duration or territory of a language. Modern language families appear at the 2017 endpoint.`:researchLoadErrors.find(x=>x.startsWith('Inscriptions:'))??'Loading selected historical inscriptions…';
    const nearby=state.location?records.map(record=>({...record,distanceKm:distanceKm(state.location.lat,state.location.lon,record.lat,record.lon)})).filter(record=>record.distanceKm<=180).sort((a,b)=>a.distanceKm-b.distanceKm||a.sourceId.localeCompare(b.sourceId)).slice(0,8):records.slice(0,8);
    const emptyNote=state.location?'No selected dated inscription within 180 km of this place.':'No dated inscription in this selected sample matches this year and region.';
    $('#language-list').innerHTML=nearby.map(record=>`<button class="regional-card" data-attestation="${esc(record.id)}" style="--regional-color:#a6a1d5"><i aria-hidden="true"></i><span><b>${esc(record.languages.map(language=>language.name).join(' / '))} · ${esc(record.placeLabel)}</b><small>${formatYear(record.start)}–${formatYear(record.end)} · dated inscription</small></span></button>`).join('')||`<p class="empty-note">${emptyNote}</p>`;
    $('#language-jump').hidden=false;return;
  }
  if(!languageCatalog){$('#language-count').textContent='';$('#language-status').textContent=researchLoadErrors.find(x=>x.startsWith('Languages:'))??'Loading Glottolog…';$('#language-list').innerHTML='';$('#language-jump').hidden=true;return;}
  $('#language-jump').hidden=true;
  const familyId=state.languageFamily==='all'?null:state.languageFamily;
  const selectedGroup=familyId?languageCatalog.groups.find(group=>group.id===familyId):null;
  const selected=languagesForRegion(languageCatalog,year,state.region,familyId);
  $('#language-count').textContent=selected.length.toLocaleString('en-US');
  $('#language-status').textContent=`${selected.length.toLocaleString('en-US')} ${selectedGroup?`${selectedGroup.name} `:''}catalog language points in this viewing region. Points are representative locations, not speaker ranges; the 2026 catalog is shown at the atlas endpoint for reference.`;
  if(state.location){
    const nearby=selected.map(language=>({language,distance:distanceKm(state.location.lat,state.location.lon,language.lat,language.lon)})).filter(row=>row.distance<=150).sort((a,b)=>a.distance-b.distance).slice(0,8);
    $('#language-list').innerHTML=nearby.length?nearby.map(({language,distance})=>`<button class="regional-card" data-language="${esc(language.id)}" style="--regional-color:${esc(languageColor(language.familyName))}"><i aria-hidden="true"></i><span><b>${esc(language.name)}</b><small>${esc(language.familyName)} · ${Math.round(distance)} km from selected point</small></span></button>`).join(''):'<p class="empty-note">No catalog point within 150 km of this selection.</p>';
  }else if(selectedGroup){
    $('#language-list').innerHTML=`<div class="regional-card" style="--regional-color:${esc(languageColor(selected[0]?.familyName??selectedGroup.name))}"><i aria-hidden="true"></i><span><b>${esc(selectedGroup.name)}</b><small>${selected.length.toLocaleString('en-US')} selected catalog language points</small></span></div>`;
  }else{
    const families=languageFamilySummary(languageCatalog,year,state.region).slice(0,6);
    $('#language-list').innerHTML=families.map(group=>`<div class="regional-card" style="--regional-color:${esc(languageColor(group.name))}"><i aria-hidden="true"></i><span><b>${esc(group.name)}</b><small>${group.count.toLocaleString('en-US')} catalog language points</small></span></div>`).join('');
  }
}
function evidenceFromRow(row) {
  if(row.kind==='levant')return {...row,record:levantSiteRecord(levantCatalog,row.index)};
  if(row.kind==='pleiades')return {...row,record:pleiadesPlaceRecord(pleiadesCatalog,row.index,Math.round(state.year))};
  return row;
}
function evidenceHTML(item, compact=false) {
  const year=Math.round(state.year),record=item.record;
  if(item.kind==='burial-site'){
    const events=record.events.slice(0,compact?3:12);
    return `<span class="section-label">DATED BURIAL SITE · ${esc(record.traditions.join(' / '))}</span><h2>${esc(record.site)}</h2><p>${record.eventCount} modelled burial event${record.eventCount===1?'':'s'} whose 95.4% date ranges include ${formatYear(year)}. This does not establish activity throughout those ranges.</p>${events.map(event=>`<div class="research-phase"><b>${esc(event.grave||event.id)} · ${esc(event.culture||event.tradition)}</b><small>Modelled mean ${formatYear(event.modeledMean)} · 95.4% ${formatYear(event.modeledRange95[0])}–${formatYear(event.modeledRange95[1])}</small>${!compact&&event.graveDescription?`<p>${esc(event.graveDescription)}</p>`:''}</div>`).join('')}${record.eventCount>events.length?`<p>Showing ${events.length} of ${record.eventCount} events. Search the collection for each grave.</p>`:''}<button class="outline-button" data-research-query="${esc(record.site)}">Search this burial site ↗</button>${sourceHTML(['burial-rituals'])}`;
  }
  if(item.kind==='burial'){
    const event=record;
    return `<span class="section-label">DATED BURIAL · ${esc(event.tradition)}</span><h2>${esc(event.site)}</h2><p>${esc(event.grave||'Grave not specified')} · ${esc(event.country)}${event.culture?` · ${esc(event.culture)}`:''}</p><p><strong>Modelled mean:</strong> ${formatYear(event.modeledMean)}. <strong>95.4% interval:</strong> ${formatYear(event.modeledRange95[0])}–${formatYear(event.modeledRange95[1])}. <strong>68.3% interval:</strong> ${formatYear(event.modeledRange68[0])}–${formatYear(event.modeledRange68[1])}.</p><p class="context-note">The ranges express date uncertainty, not continuous burial activity, a population boundary, or genetic ancestry. The tradition is the excavated funerary classification.</p>${!compact?`<div class="research-phase"><b>Radiocarbon evidence</b><p>${event.radiocarbonBP??'—'} ± ${event.radiocarbonSd??'—'} BP · ${esc(event.sample||'sample unspecified')} · ${esc(event.directOrIndirect||'')} · lab ${esc(event.labId||'not recorded')}${event.modelAgreement!=null?` · model agreement ${event.modelAgreement}`:''}${item.lowAgreement?' · low model agreement, excluded from default time view':''}</p></div><div class="research-phase"><b>Reported burial and finds</b><p>${esc(event.graveDescription||'No grave description in this compiled row.')}</p>${event.burialRite?`<p>Rite: ${esc(event.burialRite)}</p>`:''}${event.notes?`<p>Notes: ${esc(event.notes)}</p>`:''}</div>${event.sampleId||event.mtDnaHaplogroup&&event.mtDnaHaplogroup!=='–'||event.yHaplogroup&&event.yHaplogroup!=='–'?`<p>Published sample metadata: ${esc([event.sampleId?`ID ${event.sampleId}`:'',event.mtDnaHaplogroup&&event.mtDnaHaplogroup!=='–'?`mtDNA ${event.mtDnaHaplogroup}`:'',event.yHaplogroup&&event.yHaplogroup!=='–'?`Y ${event.yHaplogroup}`:''].filter(Boolean).join(' · '))}. These are individual markers, not ancestry fractions or a migration route.</p>`:''}<p>Compiled citation: ${esc(event.sourceCitation||'not supplied')}.</p>`:event.graveDescription?`<p>${esc(event.graveDescription.slice(0,380))}${event.graveDescription.length>380?'…':''}</p>`:''}<a href="${esc(burialCatalog?.source.paper??'https://doi.org/10.1126/sciadv.adx2262')}" target="_blank" rel="noopener">Study and supplementary data ↗</a>${sourceHTML(['burial-rituals'])}`;
  }
  if(item.kind==='levant'){
    const site=record;
    const active=site.phases.filter(phase=>phase.start<=year&&year<=phase.end);
    const shown=compact?(active.length?active:site.phases.slice(0,2)):site.phases;
    return `<span class="section-label">SURVEYED SITE · SOUTHERN LEVANT</span><h2>${esc(site.name)}</h2><p>${esc(site.region)} · ${site.lat.toFixed(4)}°, ${site.lon.toFixed(4)}°${site.ancientName?` · ancient name ${esc(site.ancientName)}`:''}</p><p class="context-note">${site.phases.length} broad archaeological phase${site.phases.length===1?'':'s'}; reported activity need not continue through the entire period. This collection covers surveyed parts of Samaria and Judah.</p>${shown.map(phase=>`<div class="research-phase"><b>${esc(phase.period)} · ${formatYear(phase.start)}–${formatYear(phase.end)}</b><small>${esc([phase.type,phase.subtype,phase.morphology].filter(Boolean).join(' · '))}${phase.sizeHa?` · ${phase.sizeHa} ha`:''}</small>${!compact?`<p>${esc(phase.archaeologicalStatus||'')} ${esc(phase.notes||'')}</p><small>Survey source: ${esc(phase.source||'not specified')}${phase.sourcePages?` · ${esc(phase.sourcePages)}`:''}${phase.sourceId?` · ID ${esc(phase.sourceId)}`:''}</small>`:''}</div>`).join('')}${compact&&shown.length<site.phases.length?`<p>${site.phases.length-shown.length} other phases in the source record.</p>`:''}<a href="${esc(levantCatalog?.source.paper??'https://doi.org/10.5334/joad.158')}" target="_blank" rel="noopener">Dataset and methodology ↗</a>${sourceHTML(['levant-survey'])}`;
  }
  if(item.kind==='euroevol'){
    const site=record;
    return `<span class="section-label">EUROPEAN SITE · UNDATED ASSOCIATIONS</span><h2>${esc(site.name)}</h2><p>${esc(site.country)} · ${site.lat.toFixed(4)}°, ${site.lon.toFixed(4)}°</p><p class="context-note">The downloaded CommonPhases table names cultural associations but has no calibrated calendar-year range for these rows. They remain searchable and are not placed on the dated map.</p>${site.phases.length?site.phases.slice(0,compact?3:Infinity).map(phase=>`<div class="research-phase"><b>${esc(phase.culture||'Culture unspecified')}${phase.subculture?` · ${esc(phase.subculture)}`:''}</b><small>${esc(phase.periodCode||'Period code absent')}${phase.siteType?` · ${esc(phase.siteType)}`:''} · phase ${esc(phase.id)}</small></div>`).join(''):'<p>No phase association in the imported CommonPhases table.</p>'}<a href="${esc(euroevolCatalog?.source.url??'https://discovery.ucl.ac.uk/id/eprint/1469811/')}" target="_blank" rel="noopener">EUROEVOL source tables ↗</a>${sourceHTML(['euroevol'])}`;
  }
  if(item.kind==='context'){
    const context=record;
    return `<span class="section-label">${esc(context.evidenceKind.toUpperCase())} · SELECTED CONTEXT</span><h2>${esc(context.name)}</h2><p><strong>Archaeological convention:</strong> ${esc(context.convention)} · ${formatYear(context.start)}–${formatYear(context.end)}</p>${context.association?`<p><strong>Later historical association:</strong> ${esc(context.association)}.</p>`:''}<p>${esc(context.note)}</p><p class="context-note">This is evidence at a named place, not a mapped people, language, ancestry, territory, or inferred route. The date window indexes the cited context and does not establish continuous activity.</p><a href="${esc(context.sourceUrl)}" target="_blank" rel="noopener">${esc(context.sourceTitle)} ↗</a>${sourceHTML(['archaeological-contexts'])}`;
  }
  if(item.kind==='aadr'){
    const sample=record;
    return `<span class="section-label">AADR ANCIENT INDIVIDUAL · SOURCE LABEL</span><h2>${esc(sample.site||sample.id)}</h2><p><strong>Source Group ID:</strong> ${esc(sample.sourceLabel)} · ${esc(sample.country||'country not recorded')}</p><div class="research-phase"><b>Sample ${esc(sample.id)}</b><small>${esc(sample.skeletalElement||'skeletal element not recorded')}${sample.skeletalCode?` · ${esc(sample.skeletalCode)}`:''}</small><p>${esc(sample.fullDate||'No full source date text recorded.')}</p><small>${esc(sample.dateType||'Date method not recorded')} · ${esc(sample.dateBasis)}</small></div><p><strong>AADR date:</strong> ${formatYear(sample.dateRange[0])}–${formatYear(sample.dateRange[1])}.</p><p>Publication: ${sample.publicationDOI?`<a href="${esc(sample.publicationDOI)}" target="_blank" rel="noopener">${esc(sample.publication||sample.publicationDOI)} ↗</a>`:esc(sample.publication||'not recorded')}.</p><p class="context-note">This is one ancient individual sample at the source locality. The retained Group ID is a source label, not a culture boundary, population, language, or route. Its range expresses source date uncertainty, not continuous site activity.</p><a href="${esc(aadrCatalog?.source.repository??'https://doi.org/10.7910/DVN/FFIDCW')}" target="_blank" rel="noopener">Allen Ancient DNA Resource source ↗</a>`;
  }
  if(item.kind==='paleohumans'){
    return `<span class="section-label">PALEOHUMANS · DATED HUMAN REMAINS</span><h2>${esc(record.site)}</h2><div class="research-phase"><b>${esc(record.culture||'Culture unspecified')}</b><small>${esc(record.culturePhase||'phase not recorded')}${record.stratigraphicContext?` · ${esc(record.stratigraphicContext)}`:''}</small><p>${esc(record.country||'country not recorded')}${record.region?` · ${esc(record.region)}`:''}${record.municipality?` · ${esc(record.municipality)}`:''}</p></div><p><strong>Published radiocarbon result:</strong> ${esc(record.radiocarbonBP)} ± ${esc(record.radiocarbonRange)} BP${record.material?` · ${esc(record.material)}`:''}${record.datingType?` · ${esc(record.datingType)}`:''}.</p><p><strong>Timeline placement:</strong> approximately ${formatYear(record.displayRange[0])}–${formatYear(record.displayRange[1])}, calculated as 1950 CE − (BP ± the source’s reported range).</p><p class="context-note">This is an uncalibrated BP result, not a calibrated calendar interval. It is used only to place a dated human-remains observation on the atlas timeline. It does not establish continuous occupation, a culture boundary, ancestry, language, or population.</p><a href="${esc(paleohumansCatalog?.source.url??'https://paleohumans.org/dataset')}" target="_blank" rel="noopener">PaleoHumans dataset ↗</a>${paleohumansCatalog?.source.paper?`<a href="${esc(paleohumansCatalog.source.paper)}" target="_blank" rel="noopener">Dataset paper ↗</a>`:''}${sourceHTML(['paleohumans'])}`;
  }
  if(item.kind==='euppad'){
    const ranges=record.calibratedRanges95.map(([start,end])=>`${formatYear(start)}–${formatYear(end)}`).join(' · ');
    return `<span class="section-label">EUPPAD · CALIBRATED RADIOCARBON DATE</span><h2>${esc(record.site)}</h2><div class="research-phase"><b>${esc(record.siteId)}</b><small>${esc(record.feature||'feature not recorded')}</small><p>${esc(record.references||'Reference not recorded')}</p></div><p><strong>Published result:</strong> ${esc(record.radiocarbonBP)} ± ${esc(record.radiocarbonSd)} BP${record.material?` · ${esc(record.material)}`:''}${record.method?` · ${esc(record.method)}`:''}${record.labId?` · lab ${esc(record.labId)}`:''}.</p><p><strong>IntCal20 calibration:</strong> target-95.4% highest-density interval${record.calibratedRanges95.length===1?'':'s'} ${ranges}. ${record.calibratedRanges95.length>1?'Separate segments preserve the multi-modal posterior.':''}</p><p class="context-note">Each date was independently calibrated with Bchron and IntCal20. It dates one sampled material, not continuous occupation, a culture boundary, ancestry, language, or population.</p><a href="${esc(euppadCatalog?.source.doi??'https://doi.org/10.5281/zenodo.19930467')}" target="_blank" rel="noopener">EUPPAD dataset ↗</a>${sourceHTML(['euppad'])}`;
  }
  if(item.kind==='pleiades'){
    const place=record,matching=place.matchingTemporalAssociations.length?place.matchingTemporalAssociations:place.temporalAssociations;
    const remains=place.archaeologicalRemains.filter(tag=>tag!=='notapplicable')
      .map(tag=>({notvisible:'not visible',substantive:'substantive remains',restored:'restored remains'}[tag]??tag));
    const types=place.types.map(type=>type.label).filter(Boolean);
    const description=compact?place.description.slice(0,430):place.description;
    return `<span class="section-label">PLEIADES · ${esc(place.kind.toUpperCase())}</span>
      <h2>${esc(place.title)}</h2>
      <p class="evidence-types"><strong>${types.length?'Types:':'Place class:'}</strong> ${esc(types.length?types.join(' · '):place.kind)}</p>
      ${description?`<p class="evidence-description">${esc(description)}${compact&&place.description.length>430?'…':''}</p>`:''}
      <p class="evidence-location">${place.lat.toFixed(4)}°, ${place.lon.toFixed(4)}° · ${esc(place.locationPrecision)} location${place.accuracyRadiusMeters!=null?` · largest linked-location accuracy radius ${Math.round(place.accuracyRadiusMeters).toLocaleString('en-US')} m`:''}</p>
      ${matching.slice(0,compact?3:Infinity).map(period=>`<div class="research-phase"><b>${esc(period.name||'Period association')} · ${formatYear(period.start)}–${formatYear(period.end)}</b><small>${esc(period.basis)} record · ${esc(period.associationCertainty)} association</small></div>`).join('')}
      ${remains.length?`<p class="evidence-remains">Source archaeological-remains tags: ${esc(remains.join(' · '))}.</p>`:''}
      <details class="evidence-method"><summary>About Pleiades dates and place types</summary><p>Gazetteer period associations are broad and may come from a dated name when a location date is absent. They do not prove continuous occupation. Modern source periods may describe present names or locations and remain searchable, but do not appear on the dated map. A place can be a settlement or built location rather than an excavated archaeological site. Archaeological-remains tags are pooled across location records, not dated to the selected year.</p></details>
      <a href="${esc(place.placeUrl)}" target="_blank" rel="noopener">Pleiades place ${esc(place.id)} ↗</a>${sourceHTML(['pleiades'])}`;
  }
  return '';
}
function renderResearchDirectory() {
  const results=searchResearchIndex(researchIndex,{query:$('#research-search').value,kind:$('#research-kind').value,scope:$('#research-scope').value,year:Math.round(state.year),region:state.region});
  const loaded=[burialCatalog,levantCatalog,euroevolCatalog,contextCatalog,aadrCatalog,paleohumansCatalog,euppadCatalog,pleiadesCatalog].filter(Boolean).length;
  $('#research-results-status').textContent=`${results.length.toLocaleString('en-US')} matches · ${loaded}/8 collections loaded${$('#research-scope').value==='time'?` · ${state.region.name}, ${formatYear(state.year)}`:''}${researchLoadErrors.length?` · ${researchLoadErrors.join(' ')}`:''}`;
  $('#research-results').innerHTML=results.slice(0,researchResultLimit).map(row=>`<button class="site-result" data-research-record="${esc(row.id)}" aria-pressed="${row.id===researchSelection}"><b>${esc(row.title)}</b><small>${esc(row.subtitle)} · ${row.kind==='burial'?`modelled 95.4% ${formatYear(row.ranges[0][0])}–${formatYear(row.ranges[0][1])}${row.lowAgreement?' · low model agreement':''}`:row.kind==='levant'?`${row.ranges.length} broad dated phases`:row.kind==='context'||row.kind==='aadr'?`${formatYear(row.ranges[0][0])}–${formatYear(row.ranges[0][1])}`:row.kind==='paleohumans'?`uncal. BP ± reported range · display ${formatYear(row.ranges[0][0])}–${formatYear(row.ranges[0][1])}`:row.kind==='euppad'?`IntCal20 target-95.4% · ${row.ranges.map(([start,end])=>`${formatYear(start)}–${formatYear(end)}`).join(' / ')}`:row.kind==='pleiades'?`${row.roughLocation?'rough':'precise'} point`:'no calendar date'}</small></button>`).join('')||'<p class="empty-note">No matching records. Try a site name, culture, or wider filter.</p>';
  $('#research-more').hidden=results.length<=researchResultLimit;
}
function historicalPleiadesRanges(row) {
  return (row.timeRanges??[]).filter(([start,end])=>start<PLEIADES_MODERN_START_YEAR&&end>=MIN_YEAR);
}
function renderResearchRecord(row) {
  if(!row)return;
  researchSelection=row.id;
  const item=evidenceFromRow(row);
  const locateLabel=row.kind==='burial'?'Go to modelled mean and locate':row.kind==='levant'?'Locate a dated phase':row.kind==='context'?'Locate this selected context':row.kind==='aadr'?'Locate this AADR sample':row.kind==='paleohumans'?'Locate uncalibrated-date placement':row.kind==='euppad'?'Locate calibrated-date placement':row.kind==='pleiades'?(historicalPleiadesRanges(row).length?'Locate in a historical association':'Locate place reference · no dated map point'):'Locate at current year · undated';
  $('#research-record').innerHTML=evidenceHTML(item)+`<button class="outline-button" data-research-locate="${esc(row.id)}">${locateLabel} →</button>`;
  renderResearchDirectory();
}
function openResearch({kind='all',query='',scope='all',recordId=null}={}) {
  $('#research-kind').value=kind;$('#research-search').value=query;$('#research-scope').value=scope;
  researchResultLimit=40;
  const row=researchById.get(recordId);
  if(row)renderResearchRecord(row);
  else {researchSelection=null;$('#research-record').innerHTML='<p>Select a record for its dates, evidence, and original source.</p>';renderResearchDirectory();}
  showDialog('#research-dialog');$('#research-dialog').scrollTop=0;
  if(row&&innerWidth<=700)requestAnimationFrame(()=>$('#research-record').scrollIntoView({block:'start',behavior:'instant'}));
}
function locateResearch(row) {
  if(!row)return;
  $('#research-dialog').close();
  const year=Math.round(state.year);
  if(row.kind==='burial')setYear(row.record.modeledMean,true);
  if(row.kind==='levant'&&!row.ranges.some(([start,end])=>start<=year&&year<=end)&&row.ranges.length)setYear(Math.round((row.ranges[0][0]+row.ranges[0][1])/2),true);
  if(row.kind==='context'&&!row.ranges.some(([start,end])=>start<=year&&year<=end))setYear(Math.round((row.ranges[0][0]+row.ranges[0][1])/2),true);
  if(row.kind==='aadr'&&!row.ranges.some(([start,end])=>start<=year&&year<=end))setYear(Math.round((row.ranges[0][0]+row.ranges[0][1])/2),true);
  if(row.kind==='paleohumans'&&!row.ranges.some(([start,end])=>start<=year&&year<=end))setYear(Math.round((row.ranges[0][0]+row.ranges[0][1])/2),true);
  if(row.kind==='euppad'&&!row.ranges.some(([start,end])=>start<=year&&year<=end))setYear(Math.round((row.ranges[0][0]+row.ranges[0][1])/2),true);
  if(row.kind==='pleiades'){
    const ranges=historicalPleiadesRanges(row);
    if(ranges.length&&(year>=PLEIADES_MODERN_START_YEAR||!ranges.some(([start,end])=>start<=year&&year<=end))){
      const [start,end]=ranges[0];
      setYear(Math.round((Math.max(start,MIN_YEAR)+Math.min(end,PLEIADES_MODERN_START_YEAR-1))/2),true);
    }
  }
  chooseEvidence(evidenceFromRow(row));
}
function renderArchaeologyPanel(year) {
  const panel=$('#archaeology-panel');panel.hidden=!state.layers.archaeology;
  if(panel.hidden)return;
  const burials=burialEventsAt(burialCatalog,year,state.region);
  const levant=activeLevantSiteIndices(levantCatalog,year,state.region);
  const contexts=contextsAt(contextCatalog,year,state.region);
  const aadr=aadrSamplesAt(aadrCatalog,year,state.region);
  const paleohumans=paleohumansRemainsAt(paleohumansCatalog,year,state.region);
  const euppad=euppadDatesAt(euppadCatalog,year,state.region);
  const places=pleiadesPlaceIndicesAt(pleiadesCatalog,year,state.region,{onlyCertain:true,preciseOnly:true});
  $('#archaeology-count').textContent=(burials.length+levant.length+contexts.length+aadr.length+paleohumans.length+euppad.length+places.length).toLocaleString('en-US');
  const loaded=[burialCatalog,levantCatalog,euroevolCatalog,contextCatalog,aadrCatalog,paleohumansCatalog,euppadCatalog,pleiadesCatalog].filter(Boolean).length;
  $('#archaeology-status').textContent=researchLoadErrors.length?researchLoadErrors.join(' '):loaded<8?'Loading archaeology and ancient-place collections…':`${burials.length} modelled burial dates, ${aadr.length} AADR ancient samples, ${paleohumans.length} PaleoHumans uncalibrated-date placements, ${euppad.length} EUPPAD calibrated-date placements, ${levant.length} surveyed sites with matching phases, ${contexts.length} selected contexts, and ${places.length} Pleiades period-associated places match this year and region. These are source records, not a census of occupied sites. EUPPAD preserves all target-95.4% IntCal20 HDR segments; PaleoHumans placements use uncalibrated BP ± the source’s reported range, converted from 1950 CE for browsing.${year>=PLEIADES_MODERN_START_YEAR?' Pleiades Modern-period names and locations remain searchable but are hidden from the dated map.':''} EUROEVOL associations are searchable but undated.`;
  if(state.location){
    const nearby=[...nearbyBurialEvidence(burialCatalog,year,state.location.lat,state.location.lon,80,{limit:10}).map(event=>({id:`burial:${event.id}`,title:event.site,sub:event.tradition,distance:event.distanceKm})),
      ...nearbyLevantSites(levantCatalog,year,state.location.lat,state.location.lon,35,10).map(site=>({id:`levant:${site.id}`,title:site.name,sub:site.phases.map(phase=>phase.period).slice(0,2).join(' / '),distance:site.distanceKm})),
      ...nearbyContexts(contextCatalog,year,state.location.lat,state.location.lon,80,10).map(context=>({id:`context:${context.id}`,title:context.name,sub:`${context.evidenceKind} · ${context.convention}`,distance:context.distanceKm})),
      ...nearbyAadrSamples(aadrCatalog,year,state.location.lat,state.location.lon,80,10).map(sample=>({id:`aadr:${sample.id}`,title:sample.site||sample.id,sub:`AADR · ${sample.sourceLabel}`,distance:sample.distanceKm})),
      ...nearbyPaleohumansRemains(paleohumansCatalog,year,state.location.lat,state.location.lon,80,10).map(record=>({id:`paleohumans:${record.id}`,title:record.site,sub:`PaleoHumans · ${record.radiocarbonBP} ± ${record.radiocarbonRange} BP`,distance:record.distanceKm})),
      ...nearbyEuppadDates(euppadCatalog,year,state.location.lat,state.location.lon,80,10).map(record=>({id:`euppad:${record.id}`,title:record.site,sub:`EUPPAD · ${record.radiocarbonBP} ± ${record.radiocarbonSd} BP`,distance:record.distanceKm})),
      ...nearbyPleiadesPlaces(pleiadesCatalog,year,state.location.lat,state.location.lon,20,{onlyCertain:true,preciseOnly:true,limit:10}).map(place=>({id:`pleiades:${place.id}`,title:place.title,sub:`Pleiades · ${place.kind}`,distance:place.distanceKm}))]
      .sort((a,b)=>a.distance-b.distance).slice(0,6);
    $('#archaeology-list').innerHTML=nearby.length?nearby.map(row=>`<button class="regional-card" data-evidence="${esc(row.id)}" style="--regional-color:${row.id.startsWith('burial:')?'#dbad77':row.id.startsWith('context:')?'#d19a7d':row.id.startsWith('aadr:')?'#b59ac7':row.id.startsWith('paleohumans:')?'#d6bf87':row.id.startsWith('pleiades:')?'#b5a8d0':'#89b9a4'}"><i aria-hidden="true"></i><span><b>${esc(row.title)}</b><small>${esc(row.sub)} · ${Math.round(row.distance)} km away</small></span></button>`).join(''):'<p class="empty-note">No associated records from these collections near this point and year.</p>';
  }else $('#archaeology-list').innerHTML=burials.length+levant.length+contexts.length+aadr.length+paleohumans.length+euppad.length+places.length?`<p class="context-note">${burials.filter(event=>event.tradition==='Corded Ware').length} Corded Ware burial dates · ${burials.filter(event=>event.tradition==='Bell Beaker').length} Bell Beaker burial dates · ${aadr.length} AADR ancient samples · ${paleohumans.length} PaleoHumans uncalibrated-date placements · ${euppad.length} EUPPAD calibrated-date placements · ${contexts.length} selected contexts · ${levant.length} Levant sites · ${places.length} Pleiades place associations. Zoom in and select a point, or search the collections.</p>`:year>=PLEIADES_MODERN_START_YEAR?'<p class="empty-note">No dated burial, AADR sample, PaleoHumans or EUPPAD result, selected context, or Levant survey record matches this year and region. Pleiades Modern-period place references remain available in search.</p>':'<p class="empty-note">No records from these dated collections match this year and region. This is a coverage gap.</p>';
}
function renderSiteDirectory() {
  if(!siteCatalog){$('#site-results-status').textContent=siteLoadError??'Loading the heritage catalog…';$('#site-more').hidden=true;return;}
  const focused=document.activeElement?.dataset.siteRecord;
  const results=searchSites(siteCatalog.sites,$('#site-search').value,$('#site-scope').value,Math.round(state.year),state.region);
  $('#site-results-status').textContent=`${results.length.toLocaleString('en-US')} matches · ${siteCatalog.counts.reviewedSites} of ${siteCatalog.counts.sites.toLocaleString('en-US')} sites have reviewed dates${$('#site-scope').value==='time'?` · ${state.region.name}, ${formatYear(state.year)}`:''}`;
  $('#site-results').innerHTML=results.slice(0,siteResultLimit).map(site=>`<button class="site-result" data-site-record="${esc(site.id)}" aria-pressed="${catalogSelection===site.id}"><b>${esc(site.title)}</b><small>${esc(site.country)} · ${site.phases.length?'Reviewed dates':'Dates awaiting review'}${hasSiteLocation(site)?'':' · no coordinates'}</small></button>`).join('')||'<p class="empty-note">No matching sites. Try another name or widen the filter.</p>';
  $('#site-more').hidden=results.length<=siteResultLimit;
  if(focused)$('#site-results').querySelector(`[data-site-record="${focused}"]`)?.focus({preventScroll:true});
}
function renderSiteRecord(site) {
  catalogSelection=site.id;
  $('#site-record').innerHTML=`<span class="section-label">${esc(site.category)} heritage · UNESCO ${esc(site.unescoId)}</span><h3 class="site-title">${esc(site.title)}</h3><p class="site-location">${esc(site.country)} · ${hasSiteLocation(site)?`${site.lat.toFixed(3)}°, ${site.lon.toFixed(3)}°`:'No coordinates supplied'}</p>
    <button class="outline-button" data-site-locate="${esc(site.id)}" ${hasSiteLocation(site)?'':'disabled'}>Locate on globe · keep current year ↗</button>
    <p class="context-note">Representative property coordinate; some properties contain multiple sites. Inscribed on the World Heritage List in ${site.inscribed}, independently of the historical dates below.</p>
    ${sitePhaseHTML(site,Math.round(state.year))}
    <details class="site-description" open><summary>UNESCO source description</summary><p>${esc(site.description)}</p>${siteLinkHTML(site)}</details>
    <details class="site-mentions"><summary>${site.dateMentions.length} automatically detected date mentions · unreviewed</summary><p>Research leads only. These may concern excavation, restoration, a tradition, or a relative age. They never place a site on the timeline. Relative ages and BP need a reference date and calibration check.</p>${site.dateMentions.map(m=>`<article><b>${esc(m.text)}</b><p>${esc(m.context)}</p></article>`).join('')||'<p>No date phrase was recognized. This does not mean the site has no historical dates.</p>'}</details>`;
  renderSiteDirectory();
}
function openSites(scope='all',site=null) {
  $('#site-scope').value=scope;$('#site-search').value='';siteResultLimit=40;
  site??=siteCatalog?.sites.find(s=>s.id===catalogSelection);
  if(site)renderSiteRecord(site);
  renderSiteDirectory();showDialog('#sites-dialog');$('#sites-dialog').scrollTop=0;
}
async function loadSites() {
  try{siteCatalog=await loadJSON('unesco-sites.json');}catch(error){siteLoadError=`Heritage catalog unavailable: ${error.message} Reload to retry.`;}
  renderState();if($('#sites-dialog').open)renderSiteDirectory();
}
function rebuildResearchIndex() {
  researchIndex=buildResearchIndex({burials:burialCatalog,levant:levantCatalog,euroevol:euroevolCatalog,pleiades:pleiadesCatalog,contexts:contextCatalog,aadr:aadrCatalog,paleohumans:paleohumansCatalog,euppad:euppadCatalog});
  researchById=new Map(researchIndex.map(row=>[row.id,row]));
  if($('#research-dialog').open){renderResearchDirectory();if(researchSelection)renderResearchRecord(researchById.get(researchSelection));}
}
async function loadResearch() {
  const jobs=[
    ['European areas','european-peoples.json',catalog=>{europeCatalog=catalog;globe?.setEuropeanCatalog(catalog);}],
    ['Burials','corded-beaker-burials.json',catalog=>{burialCatalog=catalog;}],
    ['Levant surveys','levant-sites.json',catalog=>{levantCatalog=catalog;}],
    ['EUROEVOL','euroevol-sites.json',catalog=>{euroevolCatalog=catalog;}],
    ['Selected contexts','archaeological-contexts.json',catalog=>{contextCatalog=catalog;}],
    ['AADR samples','aadr-archaeological-samples.json',catalog=>{aadrCatalog=catalog;}],
    ['PaleoHumans','paleohumans-remains.json',catalog=>{paleohumansCatalog=catalog;}],
    ['EUPPAD','euppad-calibrated-dates.json',catalog=>{euppadCatalog=catalog;}],
    ['Pleiades','pleiades-places.json',catalog=>{pleiadesCatalog=catalog;}],
    ['Languages','languages.json',catalog=>{languageCatalog=catalog;populateLanguageFamilies();}],
    ['Inscriptions','language-attestations.json',catalog=>{languageAttestationCatalog=catalog;}],
  ];
  await Promise.allSettled(jobs.map(async ([label,file,assign])=>{
    try {assign(await loadJSON(file));}
    catch(error){researchLoadErrors.push(`${label}: ${error.message}`);}
    catalogRevision++;rebuildResearchIndex();renderState();
  }));
}
function updateEvidenceView(year) {
  if(!globe)return;
  const key=`${year}/${catalogRevision}/${state.languageFamily}/${state.layers.archaeology}/${state.layers.languages}`;
  if(key===evidenceKey)return;
  evidenceKey=key;
  const burialPoints=state.layers.archaeology?burialSitesAt(burialCatalog,year).map((group,index)=>({
    id:`burial-site:${index}`,kind:'burial-site',lat:group.lat,lon:group.lon,record:group,
    color:group.traditions.includes('Corded Ware')?'#dbad77':'#b6a2d7',
  })):[];
  const contextPoints=state.layers.archaeology?contextsAt(contextCatalog,year).map(record=>({
    id:`context:${record.id}`,kind:'context',lat:record.lat,lon:record.lon,record,color:'#d19a7d',
  })):[];
  const aadrPoints=state.layers.archaeology?aadrSamplesAt(aadrCatalog,year).map(record=>({
    id:`aadr:${record.id}`,kind:'aadr',lat:record.lat,lon:record.lon,record,color:aadrColor(record.sourceLabel),
  })):[];
  const paleohumansPoints=state.layers.archaeology?paleohumansRemainsAt(paleohumansCatalog,year).map(record=>({
    id:`paleohumans:${record.id}`,kind:'paleohumans',lat:record.lat,lon:record.lon,record,color:'#d6bf87',
  })) :[];
  const euppadPoints=state.layers.archaeology?euppadDatesAt(euppadCatalog,year).map(record=>({
    id:`euppad:${record.id}`,kind:'euppad',lat:record.lat,lon:record.lon,record,color:'#79b9c4',
  })) :[];
  const levantPoints=state.layers.archaeology?activeLevantSiteIndices(levantCatalog,year).map(index=>{
    const row=levantCatalog.sites[index];return{id:`levant:${row[0]}`,kind:'levant',index,lat:row[5],lon:row[6],color:'#8fc0a6'};
  }):[];
  const ancient=state.layers.languages?languageAttestationsForRegion(languageAttestationCatalog,year,REGIONS[0]).map(record=>({
    id:record.id,kind:'attestation',lat:record.lat,lon:record.lon,color:'#aaa5dc',record,
  })):[];
  const modern=state.layers.languages?languagesForRegion(languageCatalog,year,REGIONS[0],state.languageFamily==='all'?null:state.languageFamily).map(record=>({
    id:record.id,kind:'modern-language',lat:record.lat,lon:record.lon,color:languageColor(record.familyName),record,
  })):[];
  globe.setEvidencePoints(burialPoints.concat(contextPoints,aadrPoints,paleohumansPoints,euppadPoints),levantPoints,ancient.concat(modern));
  const indices=state.layers.archaeology?pleiadesPlaceIndicesAt(pleiadesCatalog,year,null,{onlyCertain:true,preciseOnly:true}):[];
  const currentKey=indices.join(',');
  if(currentKey!==pleiadesKey){
    pleiadesKey=currentKey;
    globe.setPleiadesPoints(indices.map(index=>{
      const row=pleiadesCatalog.places[index],kind=pleiadesCatalog.dictionary.kinds[row[5]];
      return{id:`pleiades:${row[0]}`,kind:'pleiades',index,lat:row[2],lon:row[3],color:kind==='archaeological site'?'#c0a5d6':kind==='built or funerary site'?'#d7ae9b':'#92b4ab'};
    }));
  }
}
function clearPlace() { state.location = null; state.detail = null; globe?.clearSelection(); lastEventKey = null; renderState(); }
function renderDetail() {
  const el = $('#place-info'), location = state.location, detail = state.detail;
  el.hidden = !location && !detail; $('#clear-location').hidden = el.hidden;
  if (el.hidden) return;
  let html = '<button class="detail-close" aria-label="Clear selected place">×</button>';
  if (detail?.type === 'regional') {
    const item=detail.item;
    html+=`<span class="section-label">${item.collection==='european'?'EUROPE':'NEAR EAST'} · ${esc(item.kind.toUpperCase())}</span><h2>${esc(item.name)}</h2><p>${formatYear(item.start)} – ${formatYear(item.end)}${item.kind==='city'||item.kind==='ethnonym'?' · selected viewing window':' · approximate mapping interval'}</p>${nearEastRole(item,Math.round(state.year))?`<p><strong>${esc(nearEastRole(item,Math.round(state.year)))}</strong></p>`:''}<p>${esc(item.note)}</p>${item.sourceInterval&&(item.sourceInterval[0]!==item.start||item.sourceInterval[1]!==item.end)?`<p class="context-note">This shape is from a ${formatYear(item.sourceInterval[0])}–${formatYear(item.sourceInterval[1])} source interval; its shape is held to the reviewed transition.</p>`:''}${item.confidence==='schematic'?'<p class="context-note">Schematic area; its edge is not a surveyed historical border.</p>':''}${item.url?`<a href="${esc(item.url)}" target="_blank" rel="noopener">Place record ↗</a>`:''}${sourceHTML(item.sources)}`;
  } else if (detail?.type === 'evidence') {
    const selected=detail.item,year=Math.round(state.year);
    let current=selected;
    if(selected.kind==='burial-site'){
      const site=selected.record;
      const active=burialSitesAt(burialCatalog,year).find(group=>group.site===site.site&&group.lat===site.lat&&group.lon===site.lon);
      current={...selected,record:active??{...site,events:[],eventCount:0}};
    }else if(selected.kind==='pleiades'){
      current={...selected,record:pleiadesPlaceRecord(pleiadesCatalog,selected.index,year)??selected.record};
    }
    html+=evidenceHTML(current,true);
    if(selected.kind==='pleiades'&&year>=PLEIADES_MODERN_START_YEAR)html+=`<p class="context-note">Pleiades Modern-period names and locations remain searchable references. No Pleiades time-map point is shown at ${formatYear(year)}.</p>`;
    else if(selected.kind==='pleiades'&&!current.record.matchingTemporalAssociations.length)html+=`<p class="context-note">No source period association includes ${formatYear(year)}. The periods above are source context, not current-year matches.</p>`;
    if(detail.item.kind!=='burial-site')html+=`<button class="outline-button" data-detail-research="${esc(detail.item.id)}">Open complete record ↗</button>`;
  } else if (detail?.type === 'language') {
    const item=detail.item,record=item.record;
    if(item.kind==='attestation')html+=`<span class="section-label">HISTORICAL LANGUAGE ATTESTATION</span><h2>${esc(record.languages.map(language=>language.name).join(' / '))}</h2><p>${esc(record.placeLabel)} · ${formatYear(record.start)}–${formatYear(record.end)} · ${esc(record.dateLabel)}</p><p>${esc(record.sourceTitle)}</p><p class="context-note">The date range estimates when this inscription was made. It is not a period of continuous language use. The point is a representative findspot, sometimes a city centroid.</p><a href="${esc(record.sourceUrl)}" target="_blank" rel="noopener">EDH inscription ${esc(record.sourceId)} ↗</a>${sourceHTML(['edh'])}`;
    else html+=`<span class="section-label">MODERN LANGUAGE REFERENCE</span><h2>${esc(record.name)}</h2><p>${esc(languageGroups(languageCatalog,record).map(group=>group.name).join(' → ')||record.familyName)}</p><p>Glottolog ID ${esc(record.id)}${record.iso639P3code?` · ISO 639-3 ${esc(record.iso639P3code)}`:''}${record.aesStatus?` · ${esc(record.aesStatus)}`:''}</p><p class="context-note">A representative catalog coordinate, not a speaker territory or a claim that this language existed earlier on the atlas timeline. Glottolog 5.3 is shown at the 2017 endpoint as a reference.</p><a href="https://glottolog.org/resource/languoid/id/${esc(record.id)}" target="_blank" rel="noopener">Glottolog record ↗</a>${sourceHTML(['glottolog'])}`;
    const year=Math.round(state.year);
    if(item.kind==='attestation'&&(year<record.start||year>record.end))html+=`<p class="context-note">This inscription's estimated date does not include ${formatYear(year)}. It remains selected for reference, but its map point is hidden at this date.</p>`;
    if(item.kind!=='attestation'&&year<(languageCatalog?.referenceYear??2017))html+=`<p class="context-note">This modern catalog point remains selected while viewing ${formatYear(year)}; it appears on the map only at the atlas endpoint.</p>`;
  } else if (detail?.type === 'site') {
    const site=detail.item;
    html+=`<span class="section-label">HERITAGE SITE · ${site.phases.length?'REVIEWED PHASES':'DATES AWAITING REVIEW'}</span><h2>${esc(site.title)}</h2>${sitePhaseHTML(site,Math.round(state.year))}<p>World Heritage inscription: ${site.inscribed}. This is separate from occupation or construction dates.</p><button class="outline-button" id="site-read-more">Read the source description ↗</button>${siteLinkHTML(site)}`;
  } else if (detail) {
    const item = detail.item;
    html += `<span class="section-label">${detail.type === 'event' ? esc(item.kind) : 'MIGRATION STUDY'}</span><h2>${esc(item.title)}</h2><p>${formatYear(item.start)} – ${formatYear(item.end)}</p><p>${esc(item.detail)}</p>`;
    if (detail.type === 'route' && item.blend) {
      const b = item.blend, progress = migrationProgress(item, state.year), f = progress * (b.fraction ?? .55);
      html += `<h3>${esc(b.label)}</h3><div class="mixture-bar" aria-hidden="true"><i style="width:${(1-f)*100}%;background:${b.prior}"></i><i style="width:${f*100}%;background:${b.incoming}"></i></div><p>${esc(b.scope)} ${b.fraction == null ? 'Color proportions are illustrative.' : `Animation: ${Math.round(f * 100)}% incoming color; ${Math.round(b.fraction * 100)}% is the study endpoint.`}</p>`;
    }
    if (detail.type === 'event') html += `<p>${esc(item.certainty)}</p><button class="outline-button" id="event-jump">Go to this period →</button>`;
    html += sourceHTML(item.sources);
  }
  if (location) {
    const grid=globe?.meta??meta, shown=globe?globe.populations:populations;
    const c = location.index >= 0 ? grid.cells[location.index] : null, count = c && shown ? shown[location.index] : null;
    if (!detail) html += `<span class="section-label">SELECTED PLACE</span><h2>${Math.abs(location.lat).toFixed(1)}° ${location.lat >= 0 ? 'N' : 'S'} · ${Math.abs(location.lon).toFixed(1)}° ${location.lon >= 0 ? 'E' : 'W'}</h2>`;
    if (c && count != null) html += `<dl><dt>Nearby ${grid.resolutionDegrees}° cell</dt><dd>${formatPeople(count)} people</dd><dt>Mean cell density</dt><dd>${(count / c[2]).toLocaleString('en-US', { maximumFractionDigits: 3 })} / km²</dd><dt>Cell footprint</dt><dd>${Math.round(c[2]).toLocaleString('en-US')} km²</dd></dl><p>Cell center: ${c[0]}°, ${c[1]}°. These are grid estimates, not settlement counts.${displayedPopulationYear!=null&&displayedPopulationYear!==Math.round(state.year)?` Displayed population: ${formatYear(displayedPopulationYear)} while detail loads.`:''}</p>`;
    else html += `<p>${state.year < -10000 ? 'No quantitative population estimate is available at this date.' : 'No population grid cell is available near this point.'}</p>`;
    const territories = globe?.territoriesAt(location.lat, location.lon) ?? [];
    if (territories.length) html += territories.map(t => t.source==='regional'||t.source==='european'
      ? `<p class="territory-chip" style="border-color:${esc(t.color??'#d1ad68')}"><b>${esc(t.name)}</b> · ${esc(nearEastRole(t,Math.round(state.year))??t.kind)}${t.confidence==='schematic'?' · schematic':''}<small>${esc(t.note)}</small></p>`
      : `<p class="territory-chip">${esc(t.name)}${t.year != null ? ` · ${formatYear(t.year)} snapshot` : ' · broad schematic zone'}</p>`).join('');
    else html += '<p>No territorial label in the available snapshot. This does not mean the place was uninhabited or ungoverned.</p>';
    if (!detail) html += sourceHTML(['hyde', ...(territories.some(t=>t.source==='basemaps') ? ['basemaps'] : []), ...territories.flatMap(t=>t.sources??[])]);
  }
  el.innerHTML = html; el.querySelector('.detail-close').onclick = clearPlace;
  const jump = $('#event-jump'); if (jump) jump.onclick = () => setYear((detail.item.start + detail.item.end) / 2, true);
  el.querySelectorAll('[data-site-jump]').forEach(button=>button.onclick=()=>jumpSite(button.dataset.siteJump,Number(button.dataset.phase)));
  const readMore=$('#site-read-more');if(readMore)readMore.onclick=()=>openSites('all',detail.item);
  el.querySelectorAll('[data-detail-research]').forEach(button=>button.onclick=()=>openResearch({recordId:button.dataset.detailResearch}));
  el.querySelectorAll('[data-research-query]').forEach(button=>button.onclick=()=>openResearch({kind:'burial',query:button.dataset.researchQuery}));
}
function boundaryDescription(status = borderLoadStatus) {
  if (status?.error) return status.error;
  const b = borderBracket(borders.snapshots, Math.round(state.year));
  if (!state.layers.territories) return 'Territory layer hidden. Population remains independent of political boundaries.';
  if (!b) return activeNearEast(nearEastCatalog,Math.round(state.year)).areas.length?'Near East regional context only; global territory snapshots begin at 3000 BCE. Regional areas are approximate.':state.year < -7400 ? 'No territory reconstruction for this date. Modern coastlines are shown.' : 'Selected early farming zones only: overlapping, schematic areas of activity, not states.';
  if (status?.loading) return 'Loading the adjoining boundary snapshots; keeping the last available map visible…';
  const a = borders.snapshots[b.a].year, z = borders.snapshots[b.b].year;
  if (b.held) return `Holding the ${formatYear(a)} reconstruction. No later boundary snapshot is bundled.`;
  const base=b.a === b.b ? `${formatYear(a)} reconstruction. Approximate territories and cultural regions.` : `${formatYear(a)} ↔ ${formatYear(z)} · ${Math.round(b.t*100)}% crossfade. The intervening boundaries are not independently known.`;
  const regional=[];
  if(activeNearEast(nearEastCatalog,Math.round(state.year)).areas.length)regional.push('Near East');
  if(europeanPeoplesForRegion(europeCatalog,Math.round(state.year),state.region).some(item=>item.kind!=='ethnonym'))regional.push('European');
  return regional.length?`${base} ${regional.join(' and ')} detail has its own dated intervals.`:base;
}
function renderSparkline(year) {
  const endYear=Math.max(-10000,year),{path}=sparklinePath(series,260,57,2,'linear',endYear);
  $('#population-sparkline').innerHTML = `<defs><linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9b177" stop-opacity=".15"/><stop offset="1" stop-color="#c9b177" stop-opacity="0"/></linearGradient></defs>${path?`<path d="${path} L258,62 L2,62Z" fill="url(#trend-fill)"/><path d="${path}" fill="none" stroke="#b9b580" stroke-width="1.3"/>`:''}`;
  $('#population-sparkline').setAttribute('aria-label', `Global population through ${formatYear(endYear)}, linear vertical axis, era-weighted time axis.`);
  $('#sparkline-end').textContent=formatYear(endYear);
}
function renderState() {
  if (!ready) return;
  const year = Math.round(state.year); lastRenderedYear = year;
  populations = populationAt(meta, values, year, buffer);
  const stats = summarize(meta, populations, REGIONS[0]), b = bracket(meta.years, year);
  $('#year-label').textContent = formatYear(year);
  const slider = $('#year-slider'); slider.value = Math.round(yearToPosition(year) * 10000); slider.style.setProperty('--progress', `${yearToPosition(year)*100}%`); slider.setAttribute('aria-valuetext', formatYear(year));
  $('#population-number').textContent = formatPeople(stats.total);
  $('#focus-kicker').textContent = 'GLOBAL / ESTIMATED POPULATION';
  $('#population-description').textContent = stats.total == null ? 'people are present; headcounts are not known' : 'people worldwide';
  $('#data-status').textContent = !b ? 'No headcount' : b.a === b.b ? 'Reconstruction' : 'Interpolated';
  $('#estimate-note').textContent = !b ? 'Migration and archaeological evidence extend into deep time. The quantitative grid starts at 10,000 BCE; no population is extrapolated backward.' : b.a === b.b ? 'HYDE baseline estimate, aggregated to 1°. Small chart: global population on a linear axis over era-weighted time. No confidence interval is bundled.' : `Interpolated between ${formatYear(meta.years[b.a])} and ${formatYear(meta.years[b.b])}. Coarse samples can smooth over crises. Small chart uses a linear axis.`;
  $('#map-caption').textContent = !b ? 'Deep time · migration evidence · population unknown' : `${state.region.name} · ${meta.cells.length.toLocaleString('en-US')} population cells · ${b.a === b.b ? 'source reconstruction' : 'interpolated reconstruction'}`;
  $('#record-label').textContent = !b ? 'Before the population record · modern coastlines' : `HYDE 3.2 · ${b.a === b.b ? formatYear(year) : `${formatYear(meta.years[b.a])} → ${formatYear(meta.years[b.b])}`}`;
  $('#height-gain-output').textContent=`${Number(state.gain.toFixed(2))}×`;
  $('#spike-opacity-output').textContent=`${Math.round(state.opacity*100)}%`;
  $('#height-gain').setAttribute('aria-valuetext',`${Number(state.gain.toFixed(2))} times height`);
  $('#spike-opacity').setAttribute('aria-valuetext',`${Math.round(state.opacity*100)} percent visible`);
  $('.map-key').classList.toggle('study-colors',state.layers.ancestry);
  document.querySelectorAll('.density-key i').forEach((el,i)=>{el.style.height=`${Math.max(1,32*densityHeight([.01,1,10,100,1000][i],state.scale)/densityHeight(1000,state.scale))}px`;});
  const chapter = CHAPTERS.reduce((a, c) => Math.abs(c.year - year) < Math.abs(a.year - year) ? c : a, CHAPTERS[0]);
  $('#chapter-title').textContent = chapter.title;
  $('#time-context').textContent = year < -48000 ? 'Earlier context for the later global dispersals.' : 'People, places, and the spaces between.';
  document.querySelectorAll('.chapter').forEach(el => { const active = Number(el.dataset.year) === chapter.year; el.classList.toggle('active', active); if (active) el.setAttribute('aria-current', 'true'); else el.removeAttribute('aria-current'); });
  document.querySelectorAll('[data-region]').forEach(el => { const active = el.dataset.region === state.region.id; el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active)); });
  renderSparkline(year);
  const events = nearbyEvents(data.events, year, state.region, state.category, state.location);
  $('#context-note').textContent = `Includes records within ±${contextWindow(year).toLocaleString('en-US')} years${state.location ? ' and 1,800 km' : ''}.`;
  const eventKey = events.map(e=>e.id).join('|');
  if (eventKey !== lastEventKey) {
    lastEventKey = eventKey;
    $('#event-list').innerHTML = events.length ? events.map(e => `<button class="event-card" data-event="${esc(e.id)}" style="--event-color:${CATEGORY_COLORS[e.kind] ?? '#cbb786'}"><span class="event-kind">${esc(e.kind)}</span><b>${esc(e.title)}</b><small>${formatYear(e.start)} – ${formatYear(e.end)}</small></button>`).join('') : '<p class="empty-note">No curated records match this place and time. This is a coverage gap, not an absence of history.</p>';
  }
  const routes = activeMigrations(data.migrations, year);
  $('#migration-panel').hidden = !routes.length; $('#migration-count').textContent = String(routes.length);
  const routeKey = routes.map(r=>r.id).join('|');
  if (routeKey !== lastRouteKey) {
    lastRouteKey = routeKey;
    $('#migration-list').innerHTML = routes.map(r => `<button class="migration-card" data-route="${esc(r.id)}" style="--route-color:${r.color}"><b>${esc(r.title)}</b><small>${r.blend ? 'Ancient DNA study · inspect mixture' : 'Schematic corridor · inspect evidence'}</small></button>`).join('');
  }
  const mapEvents = nearbyEvents(data.events, year, REGIONS[0], state.category).slice(0,100);
  globe?.setYear(year, data.migrations, mapEvents,sitesAt(siteCatalog?.sites??[],year,REGIONS[0])); updatePopulationView(year);updateEvidenceView(year);
  renderSitePanel(year);
  renderNearEastPanel(year);
  renderEuropePanel(year);
  renderArchaeologyPanel(year);
  renderLanguagePanel(year);
  $('#territory-status').textContent = boundaryDescription();
  renderDetail();
}
function updatePopulationView(year) {
  if(!globe)return;
  const previousGrid=globe.meta;
  let status='',sample;
  if(state.resolution===1){
    if(globe.meta!==meta)globe.setPopulationGrid(meta);
    globe.updatePopulation(populations);displayedPopulationYear=populations?year:null;
  }else if(detailGrid){
    sample=detailGrid.sample(year);
    if('populations' in sample){
      if(sample.populations&&globe.meta!==detailGrid.meta)globe.setPopulationGrid(detailGrid.meta);
      globe.updatePopulation(sample.populations);displayedPopulationYear=sample.populations?year:null;
    }else{
      status=sample.error??`Loading ${state.resolution}° population for ${formatYear(year)}…`;
    }
  }else status=resolutionError??`Loading the ${state.resolution}° grid…`;
  // Missing deep-time evidence must never leave a previous headcount on screen.
  if(!populations){globe.updatePopulation(null);displayedPopulationYear=null;}
  if(state.resolution!==1&&globe.meta===meta){globe.updatePopulation(populations);displayedPopulationYear=populations?year:null;}
  const grid=globe.meta;
  if(state.location&&grid!==previousGrid)state.location.index=globe.nearestCell(state.location.lat,state.location.lon);
  const held=displayedPopulationYear!=null&&displayedPopulationYear!==year;
  $('#resolution-status').textContent=status?(status+(held?` Spikes still show ${formatYear(displayedPopulationYear)}.`:` Showing the ${grid.resolutionDegrees}° grid.`)):`${grid.cells.length.toLocaleString('en-US')} cells · ${grid.resolutionDegrees}° grid. Finer grids use more graphics power.`;
  $('#scale-caption').textContent=`Fixed ${state.scale==='log'?'log':'linear'} height · ${Number(state.gain.toFixed(2))}× · ${grid.resolutionDegrees}° cells`;
  if(populations)$('#map-caption').textContent=`${state.region.name} · ${grid.cells.length.toLocaleString('en-US')} population cells · ${grid.resolutionDegrees}°${held?` · displaying ${formatYear(displayedPopulationYear)}`:''}`;
}
async function setPopulationResolution(resolution) {
  state.resolution=resolution;$('#population-resolution').value=resolution;
  const request=++resolutionRequest;
  detailGrid?.dispose();detailGrid=null;resolutionError=null;
  if(ready)renderState();saveHash();
  if(resolution===1||!globe){return;}
  try{
    const root=`./data/population-${resolution}`;
    const response=await fetch(`${root}/index.json`);
    if(!response.ok)throw new Error(`The ${resolution}° grid could not load (${response.status}).`);
    const detailMeta=await response.json();
    if(request!==resolutionRequest)return;
    if(detailMeta.resolutionDegrees!==resolution||detailMeta.years.length!==meta.years.length||detailMeta.frames.length!==meta.years.length)throw new Error('Population detail metadata is incomplete.');
    detailGrid=new PopulationDetail(detailMeta,root,()=>{if(ready)renderState();});
    renderState();
  }catch(error){if(request!==resolutionRequest)return;resolutionError=`${error.message} Choose another resolution to retry.`;renderState();}
}
function renderCatalog() {
  $('#source-list').innerHTML = data.sources.map(s => `<article class="source-row"><div><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)} ↗</a><small>${esc(s.author)}</small></div><span class="status-pill">${esc(s.status)}</span><p>${esc(s.detail)}</p></article>`).join('');
}
function renderTimelineMarkers() {
  $('#timeline-markers').innerHTML = data.events.filter(e=>e.start >= MIN_YEAR && e.start <= MAX_YEAR).map(e=>`<button data-event-jump="${esc(e.id)}" style="left:${yearToPosition(e.start)*100}%;--marker-color:${CATEGORY_COLORS[e.kind]??'#cbb786'}" aria-label="${esc(e.title)} · ${formatYear(e.start)}" title="${esc(e.title)} · ${formatYear(e.start)}"></button>`).join('');
}
function showDialog(id) { setPlaying(false); $(id).showModal(); }
function snapshot() {
  setPlaying(false);
  const year = Math.round(state.year), events = nearbyEvents(data.events, year, state.region, state.category), migrations = activeMigrations(data.migrations, year);
  const heritage=siteSnapshot(sitesAt(siteCatalog?.sites??[],year,state.region),year,siteCatalog?.source);
  const regional=nearEastSnapshot(nearEastCatalog,year,state.region);
  const european=europeanPeoplesSnapshot(europeCatalog,year,state.region);
  const burials=burialEvidenceSnapshot(burialCatalog,year,state.region,{limit:50});
  const levant=levantSitesSnapshot(levantCatalog,year,state.region,50);
  const contexts=archaeologicalContextsSnapshot(contextCatalog,year,state.region,50);
  const aadrSamples=aadrSamplesSnapshot(aadrCatalog,year,state.region,50);
  const paleohumansRemains=paleohumansRemainsSnapshot(paleohumansCatalog,year,state.region,50);
  const euppadDates=euppadDatesSnapshot(euppadCatalog,year,state.region,50);
  const gazetteer=pleiadesPlacesSnapshot(pleiadesCatalog,year,state.region,{onlyCertain:true,preciseOnly:true,limit:50});
  const languages=year>=2017?languageSnapshot(languageCatalog,year,state.region,80,state.languageFamily==='all'?null:state.languageFamily):null;
  const attestations=languageAttestationSnapshot(languageAttestationCatalog,year,state.region);
  currentSnapshot = makeSnapshot({ meta, populations, values, year, region: state.region, events, migrations, sources: data.sources, comparison, borderStatus: boundaryDescription(), heritage, regional, european, burials, levant, contexts, aadrSamples, paleohumansRemains, euppadDates, gazetteer, languages, attestations });
  currentSnapshot.populations = populations?.slice() ?? null; currentSnapshot.region = state.region; currentSnapshot.year = year;
  $('#snapshot-title').textContent = currentSnapshot.data.title;
  $('#snapshot-subtitle').textContent = 'Population and context for the selected region. Charts and CSV use the fixed 1° reference grid at every display resolution.';
  $('#snapshot-chart').innerHTML = currentSnapshot.svg;
  $('#snapshot-notes').innerHTML = `<p>${esc(boundaryDescription())}</p><h3>Nearby records · ${esc(state.category === 'all' ? 'all themes' : state.category)}</h3>${events.length ? `<ul>${events.map(e=>`<li>${esc(e.title)} · ${formatYear(e.start)}–${formatYear(e.end)}</li>`).join('')}</ul>` : '<p>No curated events in this region and time window.</p>'}<p>Routes and ancestry colors summarize selected evidence; they do not establish local headcounts or precise paths. Regional totals use geographic bins, not historical political borders.</p>`;
  $('#snapshot-notes').insertAdjacentHTML('beforeend',`<h3>Heritage sites · reviewed phases at this time</h3>${heritage.records.length?`<ul>${heritage.records.map(site=>`<li>${siteLinkHTML(site)} · ${site.phases.map(p=>esc(p.dateLabel)).join(' · ')}</li>`).join('')}</ul>`:`<p>${esc(siteLoadError??(siteCatalog?'No reviewed site phases match this region and year.':'Heritage catalog is still loading.'))}</p>`}<p>Site phases and UNESCO attribution accompany the JSON export. Dates describe selected evidence, not complete settlement lifespans.</p>`);
  if(regional?.records.length)$('#snapshot-notes').insertAdjacentHTML('beforeend',`<h3>Near East · dated places and areas</h3><ul>${regional.records.map(item=>`<li>${esc(item.name)} · ${esc(item.kind)}${item.confidence==='schematic'?' · schematic':''}</li>`).join('')}</ul><p>Area outlines are approximate; city windows are selected display periods. The JSON export includes dates and source attribution.</p>`);
  if(european?.records.length)$('#snapshot-notes').insertAdjacentHTML('beforeend',`<h3>Europe · peoples and polities</h3><ul>${european.records.slice(0,18).map(item=>`<li>${esc(item.name)} · ${esc(item.kind)} · ${formatYear(item.start)}–${formatYear(item.end)}</li>`).join('')}</ul>${european.records.length>18?`<p>Showing 18 of ${european.records.length} records here; all are included in JSON.</p>`:''}<p>These source areas are approximate and do not draw surveyed ethnic frontiers.</p>`);
  if(burials?.totalEvents||levant?.totalActiveSites||contexts?.totalRecords||aadrSamples?.totalRecords||paleohumansRemains?.totalRecords||euppadDates?.totalRecords)$('#snapshot-notes').insertAdjacentHTML('beforeend',`<h3>Archaeological evidence</h3><p>${burials?.totalEvents??0} modelled burial dates (${burials?.byTradition['Corded Ware']??0} Corded Ware, ${burials?.byTradition['Bell Beaker']??0} Bell Beaker); ${aadrSamples?.totalRecords??0} AADR ancient individual samples; ${paleohumansRemains?.totalRecords??0} PaleoHumans uncalibrated-date placements; ${euppadDates?.totalRecords??0} EUPPAD IntCal20 calibrated-date placements; ${contexts?.totalRecords??0} selected contexts; ${levant?.totalActiveSites??0} surveyed South Levant sites with matching broad phases. The JSON export includes up to 50 sample records from each collection and full source metadata.</p><p>A burial's 95.4% date interval, an AADR sample's published range, a PaleoHumans uncalibrated BP ± reported-range placement, an EUPPAD target-95.4% IntCal20 HDR, a selected context's cited display window, and a site's broad archaeological phase are different uncertainties, not continuous lifespans.</p>`);
  if(gazetteer?.totalAssociatedPlaces)$('#snapshot-notes').insertAdjacentHTML('beforeend',`<h3>Ancient places · Pleiades</h3><p>${gazetteer.totalAssociatedPlaces.toLocaleString('en-US')} precise, certain gazetteer points have a broad period association that includes this year in this viewing region. ${gazetteer.byKind['archaeological site']??0} are classified archaeological sites; other entries include settlements and built places. The JSON includes 50 sample records and source metadata.</p><p>Period associations do not prove continuous occupation or precise foundation dates.</p>`);
  if(attestations?.attestationCount)$('#snapshot-notes').insertAdjacentHTML('beforeend',`<h3>Historical language attestations</h3><ul>${attestations.records.map(record=>`<li><a href="${esc(record.sourceUrl)}" target="_blank" rel="noopener">${esc(record.languages.map(language=>language.name).join(' / '))} · ${esc(record.placeLabel)} ↗</a> · ${formatYear(record.start)}–${formatYear(record.end)}</li>`).join('')}</ul><p>Inscription dating and findspots do not establish spoken-language borders.</p>`);
  if(languages?.catalogLanguageCount)$('#snapshot-notes').insertAdjacentHTML('beforeend',`<h3>Modern language reference</h3><p>${languages.catalogLanguageCount.toLocaleString('en-US')} ${languages.familyFilter?`${esc(languages.familyFilter.name)} `:''}Glottolog catalog points in this region at the atlas endpoint.${languages.familyFilter?'':` Largest families in this selection: ${esc(languages.familyCounts.slice(0,5).map(item=>`${item.name} ${item.count}`).join(' · '))}.`} These are not historical language ranges.</p>`);
  $('#download-csv').disabled = !populations; $('#download-csv').title = populations ? '' : 'No population grid is available at this date.';
  showDialog('#snapshot-dialog');
}
function filename(suffix) { return `human-atlas-${currentSnapshot.region.id}-${currentSnapshot.year < 0 ? `${Math.abs(currentSnapshot.year)}-bce` : `${currentSnapshot.year}-ce`}.${suffix}`; }
function onHover(hit) {
  const tooltip = $('#tooltip'); if (!hit) { tooltip.hidden = true; return; }
  let html;
  if (hit.event) html = `<strong>${esc(hit.event.title)}</strong><small>${formatYear(hit.event.start)} – ${formatYear(hit.event.end)} · click to read</small>`;
  else if (hit.site) html = `<strong>${esc(hit.site.title)}</strong><small>${phasesAt(hit.site,Math.round(state.year)).map(p=>esc(p.dateLabel)).join(' · ')} · click to read</small>`;
  else if (hit.regionalPlace) html=`<strong>${esc(hit.regionalPlace.name)}</strong><small>${esc(nearEastRole(hit.regionalPlace,Math.round(state.year))??(hit.regionalPlace.kind==='ethnonym'?'Ethnonym reference point':'Ancient city'))} · click to read</small>`;
  else if (hit.evidence){
    const e=hit.evidence;
    if(e.kind==='pleiades'){
      const row=pleiadesCatalog?.places[e.index];
      const types=row?.[6].map(index=>pleiadesCatalog.dictionary.types[index]?.label).filter(Boolean)??[];
      const typeSummary=types.length?`Types: ${types.slice(0,3).join(' · ')}${types.length>3?` +${types.length-3} more`:''}`:`Place class: ${pleiadesCatalog?.dictionary.kinds[row?.[5]]??'ancient place'}`;
      html=`<strong>${esc(row?.[1]??'Ancient place')}</strong><small>${esc(typeSummary)}</small><small>Broad period association · click to read</small>`;
    }else {
      const burialCultures=e.kind==='burial-site'?[...new Set(e.record.events.map(event=>event.culture).filter(Boolean))]:[];
      const levantPhases=e.kind==='levant'?levantSiteRecord(levantCatalog,e.index,Math.round(state.year))?.phases??[]:[];
      const phaseTypes=[...new Set(levantPhases.map(phase=>phase.type).filter(Boolean))];
      const label=e.kind==='burial-site'?e.record.site:e.kind==='levant'?levantCatalog?.sites[e.index]?.[2]??'Surveyed site':e.kind==='context'?e.record.name:e.record?.site??'Archaeological evidence';
      const detail=e.kind==='burial-site'?[`${e.record.eventCount} dated burial records`,burialCultures.length?`Culture: ${burialCultures.slice(0,3).join(' · ')}${burialCultures.length>3?` +${burialCultures.length-3} more`:''}`:''].filter(Boolean).join('<br>')
        :e.kind==='levant'?[`${levantPhases.length} dated survey phase${levantPhases.length===1?'':'s'}`,phaseTypes.length?`Type: ${phaseTypes.slice(0,3).join(' · ')}${phaseTypes.length>3?` +${phaseTypes.length-3} more`:''}`:''].filter(Boolean).join('<br>')
        :e.kind==='context'?`${e.record.evidenceKind} · ${e.record.convention}`:e.kind==='aadr'?`AADR · ${e.record.sourceLabel}`:e.kind==='euppad'?`EUPPAD · IntCal20 calibrated date`:'Excavated evidence';
      html=`<strong>${esc(label)}</strong><small>${detail} · click to read</small>`;
    }
  }
  else if (hit.language){const item=hit.language;html=`<strong>${esc(item.kind==='attestation'?item.record.languages.map(language=>language.name).join(' / '):item.record.name)}</strong><small>${item.kind==='attestation'?`Dated inscription · ${formatYear(item.record.start)}–${formatYear(item.record.end)}`:`${esc(item.record.familyName)} · modern reference point`} · click to read</small>`;}
  else {
    const grid=globe?.meta??meta, shown=globe?globe.populations:populations;
    const c = hit.index >= 0 ? grid.cells[hit.index] : null, p = shown && c ? shown[hit.index] : null;
    html = `<strong>${esc(hit.territories[0]?.name ?? `${Math.abs(hit.lat).toFixed(1)}°${hit.lat>=0?'N':'S'} · ${Math.abs(hit.lon).toFixed(1)}°${hit.lon>=0?'E':'W'}`)}</strong><small>${p == null ? 'Population estimate unavailable' : `${formatPeople(p)} people · ${(p/c[2]).toLocaleString('en-US',{maximumFractionDigits:2})} / km²`}${displayedPopulationYear!=null&&displayedPopulationYear!==Math.round(state.year)?` · ${formatYear(displayedPopulationYear)}`:''}<br>Click to pause and inspect</small>`;
  }
  tooltip.innerHTML = html; tooltip.hidden = false;
  const stage = $('.map-stage').getBoundingClientRect(); tooltip.style.left = `${clamp(hit.x+15,8,stage.width-tooltip.offsetWidth-8)}px`; tooltip.style.top = `${clamp(hit.y+15,8,stage.height-tooltip.offsetHeight-8)}px`;
}
function initializeControls() {
  $('#chapters').innerHTML = CHAPTERS.map(c=>`<button class="chapter" data-year="${c.year}" data-focus="${c.region}"><strong>${esc(c.title)}</strong><small>${esc(c.label)}</small></button>`).join('');
  $('#region-nav').innerHTML = REGIONS.map(r=>`<button data-region="${r.id}" aria-pressed="${r.id===state.region.id}">${r.name}</button>`).join('');
  $('#timeline-ticks').innerHTML = TIME_KNOTS.map((y,i)=>`<span style="left:${i/(TIME_KNOTS.length-1)*100}%">${y<0?`${Math.abs(y)>=1000?Math.abs(y)/1000+'k':Math.abs(y)} BCE`:y}</span>`).join('');
  renderTimelineMarkers(); renderCatalog();
  $('#chapters').onclick = event => { const b=event.target.closest('[data-year]');if(!b)return;setPlaying(false);state.year=Number(b.dataset.year);setRegion(REGIONS.find(r=>r.id===b.dataset.focus));document.body.classList.remove('controls-open');$('#mobile-controls').setAttribute('aria-expanded','false'); };
  $('#region-nav').onclick = event => {const b=event.target.closest('[data-region]');if(b)setRegion(REGIONS.find(r=>r.id===b.dataset.region));};
  $('#play').onclick = ()=>setPlaying(!state.playing);
  $('#year-slider').oninput = event => {$('#tooltip').hidden=true;setYear(positionToYear(Number(event.target.value)/10000),true);};
  $('#playback-speed').onchange=e=>state.speed=Number(e.target.value);
  $('#playback-mode').onchange=e=>state.mode=e.target.value;
  const stepEvent = direction => { const years=[...new Set(data.events.map(e=>e.start))].sort((a,b)=>a-b);const next=direction>0?years.find(y=>y>state.year+1):years.findLast(y=>y<state.year-1);if(next!=null)setYear(next,true); };
  $('#previous-event').onclick=()=>stepEvent(-1);$('#next-event').onclick=()=>stepEvent(1);
  $('#timeline-markers').onclick=e=>{const b=e.target.closest('[data-event-jump]');if(b){const event=data.events.find(x=>x.id===b.dataset.eventJump);setYear(event.start,true);chooseEvent(event);}};
  $('#event-list').onclick=e=>{const b=e.target.closest('[data-event]');if(b)chooseEvent(data.events.find(x=>x.id===b.dataset.event));};
  $('#migration-list').onclick=e=>{const b=e.target.closest('[data-route]');if(b)chooseRoute(data.migrations.find(x=>x.id===b.dataset.route));};
  $('#sites-button').onclick=()=>openSites();
  $('#sites-at-time').onclick=()=>openSites(sitesAt(siteCatalog?.sites??[],Math.round(state.year),state.region,state.location).length?'time':'all');
  $('#site-list').onclick=e=>{const b=e.target.closest('[data-site]');if(b)chooseSite(siteCatalog.sites.find(s=>s.id===b.dataset.site));};
  $('#near-east-list').onclick=e=>{const b=e.target.closest('[data-regional]');if(b){const item=nearEastForRegion(nearEastCatalog,Math.round(state.year),state.region).find(x=>x.id===b.dataset.regional);if(item)chooseRegional(item);}};
  $('#near-east-focus').onclick=()=>setRegion(REGIONS.find(r=>r.id==='near-east'));
  $('#europe-list').onclick=e=>{const b=e.target.closest('[data-european]');if(b){const item=europeanPeoplesForRegion(europeCatalog,Math.round(state.year),state.region).find(x=>x.id===b.dataset.european);if(item)chooseRegional(item);}};
  $('#europe-focus').onclick=()=>setRegion(REGIONS.find(r=>r.id==='europe'));
  $('#archaeology-browse').onclick=()=>openResearch({scope:'time'});
  $('#archaeology-list').onclick=e=>{const b=e.target.closest('[data-evidence]');if(b){const row=researchById.get(b.dataset.evidence);if(row)chooseEvidence(evidenceFromRow(row));}};
  $('#research-button').onclick=()=>openResearch();
  const filterResearch=()=>{researchResultLimit=40;renderResearchDirectory();};
  $('#research-search').oninput=filterResearch;$('#research-kind').onchange=filterResearch;$('#research-scope').onchange=filterResearch;
  $('#research-more').onclick=()=>{researchResultLimit+=40;renderResearchDirectory();};
  $('#research-results').onclick=e=>{const b=e.target.closest('[data-research-record]');if(b){renderResearchRecord(researchById.get(b.dataset.researchRecord));if(innerWidth<=700)$('#research-record').scrollIntoView({block:'start',behavior:'instant'});}};
  $('#research-record').onclick=e=>{const b=e.target.closest('[data-research-locate]');if(b)locateResearch(researchById.get(b.dataset.researchLocate));};
  $('#language-family').onchange=e=>{state.languageFamily=e.target.value;renderState();saveHash();};
  $('#language-jump').onclick=()=>{if(state.detail?.type==='language')state.detail=null;setYear(2017,true);};
  $('#language-list').onclick=e=>{const att=e.target.closest('[data-attestation]'),lang=e.target.closest('[data-language]');if(att){const record=languageAttestationCatalog?.records.find(x=>x.id===att.dataset.attestation);if(record)chooseLanguage({kind:'attestation',record,lat:record.lat,lon:record.lon});}else if(lang){const record=languageCatalog?.languages.find(x=>x.id===lang.dataset.language);if(record)chooseLanguage({kind:'modern-language',record,lat:record.lat,lon:record.lon});}};
  const filterSites=()=>{siteResultLimit=40;renderSiteDirectory();};$('#site-search').oninput=filterSites;$('#site-scope').onchange=filterSites;
  $('#site-more').onclick=()=>{siteResultLimit+=40;renderSiteDirectory();};
  $('#site-results').onclick=e=>{const b=e.target.closest('[data-site-record]');if(b){renderSiteRecord(siteCatalog.sites.find(s=>s.id===b.dataset.siteRecord));if(innerWidth<=620)$('#site-record').scrollIntoView({block:'start',behavior:reduceMotion?'instant':'smooth'});}};
  $('#site-record').onclick=e=>{
    const jump=e.target.closest('[data-site-jump]'),locate=e.target.closest('[data-site-locate]');
    if(jump)jumpSite(jump.dataset.siteJump,Number(jump.dataset.phase));
    else if(locate){$('#sites-dialog').close();chooseSite(siteCatalog.sites.find(s=>s.id===locate.dataset.siteLocate));}
  };
  $('#event-category').onchange=e=>{state.category=e.target.value;renderState();};
  $('#clear-location').onclick=clearPlace;
  for (const key in state.layers) {const el=$(`#layer-${key}`);el.checked=state.layers[key];el.onchange=()=>{state.layers[key]=el.checked;globe?.setLayers(state.layers);renderState();saveHash();};}
  $('#height-scale').value=state.scale;$('#height-gain').value=state.gain;$('#spike-opacity').value=state.opacity*100;$('#spike-width').value=state.spikeWidth*100;$('#spike-width-output').textContent=`${Math.round(state.spikeWidth*100)}%`;$('#density-colors').value=state.densityColors;$('#population-resolution').value=state.resolution;
  const scale=()=>{state.scale=$('#height-scale').value;state.gain=Number($('#height-gain').value);globe?.setScale(state.scale,state.gain);renderState();saveHash();};$('#height-scale').onchange=scale;$('#height-gain').oninput=scale;
  $('#density-colors').onchange=e=>{state.densityColors=e.target.value;globe?.setDensityColorMode(state.densityColors);renderState();saveHash();};
  $('#spike-opacity').oninput=e=>{state.opacity=Number(e.target.value)/100;globe?.setPopulationOpacity(state.opacity);renderState();saveHash();};
  $('#spike-width').oninput=e=>{state.spikeWidth=Number(e.target.value)/100;globe?.setSpikeWidth(state.spikeWidth);$('#spike-width-output').textContent=`${Math.round(state.spikeWidth*100)}%`;saveHash();};
  $('#population-resolution').onchange=e=>setPopulationResolution(Number(e.target.value));
  $('#zoom-in').onclick=()=>globe?.zoom(.82);$('#zoom-out').onclick=()=>globe?.zoom(1.2);$('#reset-view').onclick=()=>globe?.focus(state.region);
  $('#sources-button').onclick=()=>showDialog('#sources-dialog');$('#snapshot-button').onclick=snapshot;
  $('#date-button').onclick=()=>{const y=Math.round(state.year);$('#jump-year').value=Math.max(1,Math.abs(y));$('#jump-era').value=y<=0?'bce':'ce';$('#jump-error').textContent='';showDialog('#date-dialog');};
  $('#jump-go').onclick=()=>{const year=Number($('#jump-year').value),bce=$('#jump-era').value==='bce';if(!Number.isInteger(year)||year<1||year>(bce?70000:MAX_YEAR)){$('#jump-error').textContent=`Enter a whole year from 1 to ${bce?70000:MAX_YEAR}.`;return;}setYear(bce?-year:year,true);$('#date-dialog').close();};
  $('.date-form').addEventListener('submit',e=>{if(e.submitter?.classList.contains('dialog-close'))return;e.preventDefault();$('#jump-go').click();});
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).close());
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
  $('#download-svg').onclick=()=>downloadFile(currentSnapshot.svg,filename('svg'),'image/svg+xml');
  $('#download-json').onclick=()=>downloadFile(JSON.stringify(currentSnapshot.data,null,2),filename('json'),'application/json');
  $('#download-csv').onclick=()=>downloadFile(snapshotCSV(meta,currentSnapshot.populations,currentSnapshot.region,currentSnapshot.year),filename('csv'),'text/csv;charset=utf-8');
  $('#mobile-controls').onclick=()=>{const open=document.body.classList.toggle('controls-open');$('#mobile-controls').setAttribute('aria-expanded',String(open));};
  $('#import-data').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>4e6)throw new Error('Please use a file smaller than 4 MB.');const extra=validateResearch(JSON.parse(await file.text()),data);data.sources.push(...extra.sources);data.events.push(...extra.events);data.migrations.push(...extra.migrations);renderCatalog();renderTimelineMarkers();lastEventKey=null;lastRouteKey=null;renderState();$('#import-status').textContent=`Added ${extra.events.length} events and ${extra.migrations.length} routes from ${file.name}. They remain in this tab only.`;}catch(error){$('#import-status').textContent=`Could not import: ${error.message}`;}e.target.value='';};
  addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')||e.target.closest('input,select,textarea,button,a,summary'))return;if(e.code==='Space'){e.preventDefault();setPlaying(!state.playing);}if(e.code==='ArrowLeft'||e.code==='ArrowRight'){e.preventDefault();const step=state.year < -10000?1000:state.year<0?100:10;setYear(state.year+(e.code==='ArrowLeft'?-step:step),true);}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)setPlaying(false);});
  document.addEventListener('site-theme-change',event=>globe?.setTheme(event.detail.theme));
  addEventListener('hashchange',()=>{setPlaying(false);readHash();for(const key in state.layers)$(`#layer-${key}`).checked=state.layers[key];if(languageCatalog)populateLanguageFamilies();$('#height-scale').value=state.scale;$('#height-gain').value=state.gain;$('#spike-opacity').value=state.opacity*100;$('#spike-width').value=state.spikeWidth*100;$('#spike-width-output').textContent=`${Math.round(state.spikeWidth*100)}%`;$('#density-colors').value=state.densityColors;setPopulationResolution(state.resolution);globe?.setPopulationOpacity(state.opacity);globe?.setSpikeWidth(state.spikeWidth);globe?.setDensityColorMode(state.densityColors);globe?.setLayers(state.layers);globe?.setScale(state.scale,state.gain);setRegion(state.region);});
}
async function loadJSON(name) {const r=await fetch(`./data/${name}`);if(!r.ok)throw new Error(`${name} could not load (${r.status}).`);return r.json();}
async function start() {
  readHash();
  try {
    const results=await Promise.all([loadJSON('population.json'),fetch('./data/population.f32').then(r=>{if(!r.ok)throw new Error('Population grid could not load.');return r.arrayBuffer();}),loadJSON('land.json'),loadJSON('borders.json'),loadJSON('comparison.json'),loadJSON('near-east.json'),loadJSON('physical.json')]);
    [meta,, ,borders,comparison,nearEastCatalog]=results;values=new Float32Array(results[1]);
    if(values.length!==meta.years.length*meta.cells.length)throw new Error('Population grid is incomplete. Reload to retry.');
    buffer=new Float32Array(meta.cells.length);series=populationSeries(meta,values,REGIONS[0]);
    try {
      globe=new HistoryGlobe($('#globe'),meta,results[2],borders,nearEastCatalog,results[6],{
        onLocation:place=>{setPlaying(false);state.location=place;state.detail=null;lastEventKey=null;renderState();},onEvent:chooseEvent,onSite:chooseSite,onRegional:chooseRegional,onEvidence:chooseEvidence,onLanguage:chooseLanguage,onHover,
        onBorders:status=>{borderLoadStatus=status;if(ready){$('#territory-status').textContent=boundaryDescription(status);if(state.location)renderDetail();}},
        onError:message=>{$('#map-error').hidden=false;$('#map-error').textContent=message;setPlaying(false);},
      });
      globe.setLayers(state.layers);globe.setScale(state.scale,state.gain);globe.setPopulationOpacity(state.opacity);globe.setSpikeWidth(state.spikeWidth);globe.setDensityColorMode(state.densityColors);globe.focus(state.region);
    } catch (error) {
      console.error(error);$('#map-error').hidden=false;$('#map-error').innerHTML='<strong>The 3D globe could not start.</strong><p>Enable WebGL and hardware acceleration, then reload. The timeline, sources, and population snapshots are still available.</p>';
    }
    ready=true;initializeControls();renderState();if(state.resolution!==1)setPopulationResolution(state.resolution);$('#loading').hidden=true;loadSites();loadResearch();
    let previous=performance.now(),accumulator=0,fpsStart=previous,fpsFrames=0;
    function frame(now){const dt=clamp((now-previous)/1000,0,.1);previous=now;
      if(state.playing){state.year=state.mode==='era'?positionToYear(yearToPosition(state.year)+dt*state.speed/180):clamp(state.year+dt*100*state.speed,MIN_YEAR,MAX_YEAR);accumulator+=dt;if(accumulator>.08||state.year>=MAX_YEAR){if(Math.round(state.year)!==lastRenderedYear)renderState();accumulator=0;}if(state.year>=MAX_YEAR)setPlaying(false);}
      globe?.render(dt,state.playing);
      if(state.playing&&globe){fpsFrames++;if(now-fpsStart>=1000){$('#render-performance').textContent=`${Math.round(fpsFrames*1000/(now-fpsStart))} fps · ${globe.meta.resolutionDegrees}° grid`;fpsStart=now;fpsFrames=0;}}else{fpsStart=now;fpsFrames=0;}
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    addEventListener('pagehide',()=>{if(!document.hidden)return;setPlaying(false);});
  } catch(error) {console.error(error);$('#loading').hidden=true;$('#map-error').hidden=false;$('#map-error').innerHTML=`<strong>The atlas could not load.</strong><p>${esc(error.message)}</p><p>Serve this project over HTTP, then reload.</p><a href="./README.md">Read the field notes →</a>`;}
}
start();
