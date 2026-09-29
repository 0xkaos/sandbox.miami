import { HistoryGlobe } from './globe.mjs';
import { SOURCES, EVENTS, MIGRATIONS, CHAPTERS } from './history.mjs';
import { MIN_YEAR, MAX_YEAR, TIME_KNOTS, REGIONS, CATEGORY_COLORS, clamp, bracket, borderBracket, formatYear, formatPeople, yearToPosition, positionToYear, populationAt, summarize, densityHeight, contextWindow, nearbyEvents, activeMigrations, migrationProgress, sourceLinks, escapeHTML as esc } from './model.mjs';
import { populationSeries, sparklinePath, makeSnapshot, snapshotCSV, downloadFile } from './snapshot.mjs';
import { validateResearch } from './import.mjs';

const $ = selector => document.querySelector(selector);
const state = { year: -3000, region: REGIONS[0], playing: false, speed: 1, mode: 'era', category: 'all', location: null, detail: null, scale: 'log', gain: 1, layers: { population: true, territories: true, migrations: true, ancestry: true, events: true } };
const data = { sources: [...SOURCES], events: [...EVENTS], migrations: [...MIGRATIONS] };
let meta, values, comparison, borders, globe, populations, buffer, lastRenderedYear, ready = false, hashTimer, lastEventKey, lastRouteKey, series, currentSnapshot, borderLoadStatus;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const y = Number(params.get('year'));
  if (params.has('year') && Number.isFinite(y)) state.year = clamp(Math.round(y), MIN_YEAR, MAX_YEAR);
  state.region = REGIONS.find(r => r.id === params.get('region')) ?? state.region;
  if (['linear', 'log'].includes(params.get('scale'))) state.scale = params.get('scale');
  if ([.25, .5, 1, 3, 10].includes(Number(params.get('gain')))) state.gain = Number(params.get('gain'));
  if (params.has('layers')) { const shown = params.get('layers').split(','); for (const key in state.layers) state.layers[key] = shown.includes(key); }
}
function saveHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const p = new URLSearchParams({ year: Math.round(state.year), region: state.region.id, scale: state.scale, gain: state.gain, layers: Object.keys(state.layers).filter(k => state.layers[k]).join(',') });
    history.replaceState(null, '', `${location.pathname}${location.search}#${p}`);
  }, 250);
}
function sourceHTML(ids) { return sourceLinks(ids, data.sources).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)} ↗</a>`).join(''); }
function setPlaying(playing) {
  if (!ready) return;
  if (playing && state.year >= MAX_YEAR) setYear(MIN_YEAR);
  state.playing = playing;
  $('#play').textContent = playing ? 'Ⅱ' : '▶'; $('#play').setAttribute('aria-label', playing ? 'Pause timeline' : 'Play timeline'); $('#play').setAttribute('aria-pressed', String(playing));
  if (!playing) saveHash();
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
  series = populationSeries(meta, values, region); lastEventKey = null;
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
function clearPlace() { state.location = null; state.detail = null; globe?.clearSelection(); lastEventKey = null; renderState(); }
function renderDetail() {
  const el = $('#place-info'), location = state.location, detail = state.detail;
  el.hidden = !location && !detail; $('#clear-location').hidden = el.hidden;
  if (el.hidden) return;
  let html = '<button class="detail-close" aria-label="Clear selected place">×</button>';
  if (detail) {
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
    const c = location.index >= 0 ? meta.cells[location.index] : null, count = c && populations ? populations[location.index] : null;
    if (!detail) html += `<span class="section-label">SELECTED PLACE</span><h2>${Math.abs(location.lat).toFixed(1)}° ${location.lat >= 0 ? 'N' : 'S'} · ${Math.abs(location.lon).toFixed(1)}° ${location.lon >= 0 ? 'E' : 'W'}</h2>`;
    if (c && count != null) html += `<dl><dt>Nearby 1° cell</dt><dd>${formatPeople(count)} people</dd><dt>Mean cell density</dt><dd>${(count / c[2]).toLocaleString('en-US', { maximumFractionDigits: 3 })} / km²</dd><dt>Cell footprint</dt><dd>${Math.round(c[2]).toLocaleString('en-US')} km²</dd></dl><p>Cell center: ${c[0]}°, ${c[1]}°. These are grid estimates, not settlement counts.</p>`;
    else html += `<p>${state.year < -10000 ? 'No quantitative population estimate is available at this date.' : 'No population grid cell is available near this point.'}</p>`;
    const territories = globe?.territoriesAt(location.lat, location.lon) ?? [];
    if (territories.length) html += territories.map(t => `<p class="territory-chip">${esc(t.name)}${t.year != null ? ` · ${formatYear(t.year)} snapshot` : ' · broad schematic zone'}</p>`).join('');
    else html += '<p>No territorial label in the available snapshot. This does not mean the place was uninhabited or ungoverned.</p>';
    if (!detail) html += sourceHTML(['hyde', ...(territories.length ? ['basemaps'] : [])]);
  }
  el.innerHTML = html; el.querySelector('.detail-close').onclick = clearPlace;
  const jump = $('#event-jump'); if (jump) jump.onclick = () => setYear((detail.item.start + detail.item.end) / 2, true);
}
function boundaryDescription(status = borderLoadStatus) {
  if (status?.error) return status.error;
  const b = borderBracket(borders.snapshots, Math.round(state.year));
  if (!state.layers.territories) return 'Territory layer hidden. Population remains independent of political boundaries.';
  if (!b) return state.year < -7400 ? 'No territory reconstruction for this date. Modern coastlines are shown.' : 'Selected early farming zones only: overlapping, schematic areas of activity, not states.';
  if (status?.loading) return 'Loading the adjoining boundary snapshots…';
  const a = borders.snapshots[b.a].year, z = borders.snapshots[b.b].year;
  if (b.held) return `Holding the ${formatYear(a)} reconstruction. No later boundary snapshot is bundled.`;
  return b.a === b.b ? `${formatYear(a)} reconstruction. Approximate territories and cultural regions.` : `${formatYear(a)} ↔ ${formatYear(z)} · ${Math.round(b.t*100)}% crossfade. The intervening boundaries are not independently known.`;
}
function renderSparkline(year) {
  const { path } = sparklinePath(series, 260, 57, 2), x = clamp((yearToPosition(year) - yearToPosition(-10000)) / (1 - yearToPosition(-10000)), 0, 1) * 256 + 2;
  $('#population-sparkline').innerHTML = `<defs><linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9b177" stop-opacity=".15"/><stop offset="1" stop-color="#c9b177" stop-opacity="0"/></linearGradient></defs><path d="${path} L258,62 L2,62Z" fill="url(#trend-fill)"/><path d="${path}" fill="none" stroke="#b9b580" stroke-width="1.3"/>${year >= -10000 ? `<path d="M${x},0 V62" stroke="#d9c392" stroke-width=".8" stroke-dasharray="2 3"/>` : ''}`;
  $('#population-sparkline').setAttribute('aria-label', `${state.region.name} population through time, logarithmic vertical axis, era-weighted time axis.`);
}
function renderState() {
  if (!ready) return;
  const year = Math.round(state.year); lastRenderedYear = year;
  populations = populationAt(meta, values, year, buffer);
  const stats = summarize(meta, populations, state.region), b = bracket(meta.years, year);
  $('#year-label').textContent = formatYear(year);
  const slider = $('#year-slider'); slider.value = Math.round(yearToPosition(year) * 10000); slider.style.setProperty('--progress', `${yearToPosition(year)*100}%`); slider.setAttribute('aria-valuetext', formatYear(year));
  $('#population-number').textContent = formatPeople(stats.total);
  $('#focus-kicker').textContent = `${state.region.name.toUpperCase()} / ESTIMATED POPULATION`;
  $('#population-description').textContent = stats.total == null ? 'people are present; headcounts are not known' : 'people in the selected geographic region';
  $('#data-status').textContent = !b ? 'No headcount' : b.a === b.b ? 'Reconstruction' : 'Interpolated';
  $('#estimate-note').textContent = !b ? 'Migration and archaeological evidence extend into deep time. The quantitative grid starts at 10,000 BCE; no population is extrapolated backward.' : b.a === b.b ? 'HYDE baseline estimate, aggregated to 1°. Small chart: log population over era-weighted time. No confidence interval is bundled.' : `Interpolated between ${formatYear(meta.years[b.a])} and ${formatYear(meta.years[b.b])}. Coarse samples can smooth over crises. Small chart uses a log axis.`;
  $('#map-caption').textContent = !b ? 'Deep time · migration evidence · population unknown' : `${state.region.name} · ${meta.cells.length.toLocaleString('en-US')} population cells · ${b.a === b.b ? 'source reconstruction' : 'interpolated reconstruction'}`;
  $('#record-label').textContent = !b ? 'Before the population record · modern coastlines' : `HYDE 3.2 · ${b.a === b.b ? formatYear(year) : `${formatYear(meta.years[b.a])} → ${formatYear(meta.years[b.b])}`}`;
  $('#scale-caption').textContent = `Fixed ${state.scale === 'log' ? 'log' : 'linear'} height · ${state.gain}× · 1° cells`;
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
  globe?.setYear(year, data.migrations, mapEvents); globe?.updatePopulation(populations);
  $('#territory-status').textContent = boundaryDescription();
  renderDetail();
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
  currentSnapshot = makeSnapshot({ meta, populations, values, year, region: state.region, events, migrations, sources: data.sources, comparison, borderStatus: boundaryDescription() });
  currentSnapshot.populations = populations?.slice() ?? null; currentSnapshot.region = state.region; currentSnapshot.year = year;
  $('#snapshot-title').textContent = currentSnapshot.data.title;
  $('#snapshot-subtitle').textContent = 'Population, local context, and the limits of the record at this moment. The geographic region comes from the region selector.';
  $('#snapshot-chart').innerHTML = currentSnapshot.svg;
  $('#snapshot-notes').innerHTML = `<p>${esc(boundaryDescription())}</p><h3>Nearby records · ${esc(state.category === 'all' ? 'all themes' : state.category)}</h3>${events.length ? `<ul>${events.map(e=>`<li>${esc(e.title)} · ${formatYear(e.start)}–${formatYear(e.end)}</li>`).join('')}</ul>` : '<p>No curated events in this region and time window.</p>'}<p>Routes and ancestry colors summarize selected evidence; they do not establish local headcounts or precise paths. Regional totals use geographic bins, not historical political borders.</p>`;
  $('#download-csv').disabled = !populations; $('#download-csv').title = populations ? '' : 'No population grid is available at this date.';
  showDialog('#snapshot-dialog');
}
function filename(suffix) { return `human-atlas-${currentSnapshot.region.id}-${currentSnapshot.year < 0 ? `${Math.abs(currentSnapshot.year)}-bce` : `${currentSnapshot.year}-ce`}.${suffix}`; }
function onHover(hit) {
  const tooltip = $('#tooltip'); if (!hit) { tooltip.hidden = true; return; }
  let html;
  if (hit.event) html = `<strong>${esc(hit.event.title)}</strong><small>${formatYear(hit.event.start)} – ${formatYear(hit.event.end)} · click to read</small>`;
  else {
    const c = hit.index >= 0 ? meta.cells[hit.index] : null, p = populations && c ? populations[hit.index] : null;
    html = `<strong>${esc(hit.territories[0]?.name ?? `${Math.abs(hit.lat).toFixed(1)}°${hit.lat>=0?'N':'S'} · ${Math.abs(hit.lon).toFixed(1)}°${hit.lon>=0?'E':'W'}`)}</strong><small>${p == null ? 'Population estimate unavailable' : `${formatPeople(p)} people · ${(p/c[2]).toLocaleString('en-US',{maximumFractionDigits:2})} / km²`}<br>Click to pause and inspect</small>`;
  }
  tooltip.innerHTML = html; tooltip.hidden = false;
  const stage = $('.map-stage').getBoundingClientRect(); tooltip.style.left = `${clamp(hit.x+15,8,stage.width-tooltip.offsetWidth-8)}px`; tooltip.style.top = `${clamp(hit.y+15,8,stage.height-tooltip.offsetHeight-8)}px`;
}
function initializeControls() {
  $('#chapters').innerHTML = CHAPTERS.map(c=>`<button class="chapter" data-year="${c.year}" data-focus="${c.region}"><strong>${esc(c.title)}</strong><small>${esc(c.label)} · ${formatYear(c.year)}</small></button>`).join('');
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
  $('#event-category').onchange=e=>{state.category=e.target.value;renderState();};
  $('#clear-location').onclick=clearPlace;
  for (const key in state.layers) {const el=$(`#layer-${key}`);el.checked=state.layers[key];el.onchange=()=>{state.layers[key]=el.checked;globe?.setLayers(state.layers);renderState();saveHash();};}
  $('#height-scale').value=state.scale;$('#height-gain').value=state.gain;
  const scale=()=>{state.scale=$('#height-scale').value;state.gain=Number($('#height-gain').value);globe?.setScale(state.scale,state.gain);renderState();saveHash();};$('#height-scale').onchange=scale;$('#height-gain').onchange=scale;
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
  addEventListener('hashchange',()=>{setPlaying(false);readHash();for(const key in state.layers)$(`#layer-${key}`).checked=state.layers[key];$('#height-scale').value=state.scale;$('#height-gain').value=state.gain;globe?.setLayers(state.layers);globe?.setScale(state.scale,state.gain);setRegion(state.region);});
}
async function loadJSON(name) {const r=await fetch(`./data/${name}`);if(!r.ok)throw new Error(`${name} could not load (${r.status}).`);return r.json();}
async function start() {
  readHash();
  try {
    const results=await Promise.all([loadJSON('population.json'),fetch('./data/population.f32').then(r=>{if(!r.ok)throw new Error('Population grid could not load.');return r.arrayBuffer();}),loadJSON('land.json'),loadJSON('borders.json'),loadJSON('comparison.json')]);
    [meta,, ,borders,comparison]=results;values=new Float32Array(results[1]);
    if(values.length!==meta.years.length*meta.cells.length)throw new Error('Population grid is incomplete. Reload to retry.');
    buffer=new Float32Array(meta.cells.length);series=populationSeries(meta,values,state.region);
    try {
      globe=new HistoryGlobe($('#globe'),meta,results[2],borders,{
        onLocation:place=>{setPlaying(false);state.location=place;state.detail=null;lastEventKey=null;renderState();},onEvent:chooseEvent,onHover,
        onBorders:status=>{borderLoadStatus=status;if(ready){$('#territory-status').textContent=boundaryDescription(status);if(state.location)renderDetail();}},
        onError:message=>{$('#map-error').hidden=false;$('#map-error').textContent=message;setPlaying(false);},
      });
      globe.setLayers(state.layers);globe.setScale(state.scale,state.gain);globe.focus(state.region);
    } catch (error) {
      console.error(error);$('#map-error').hidden=false;$('#map-error').innerHTML='<strong>The 3D globe could not start.</strong><p>Enable WebGL and hardware acceleration, then reload. The timeline, sources, and population snapshots are still available.</p>';
    }
    ready=true;initializeControls();renderState();$('#loading').hidden=true;
    let previous=performance.now(),accumulator=0;
    function frame(now){const dt=Math.min(.1,(now-previous)/1000);previous=now;
      if(state.playing){state.year=state.mode==='era'?positionToYear(yearToPosition(state.year)+dt*state.speed/180):clamp(state.year+dt*100*state.speed,MIN_YEAR,MAX_YEAR);accumulator+=dt;if(accumulator>.08||state.year>=MAX_YEAR){if(Math.round(state.year)!==lastRenderedYear)renderState();accumulator=0;}if(state.year>=MAX_YEAR)setPlaying(false);}
      globe?.render(dt,state.playing);requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    addEventListener('pagehide',()=>{if(!document.hidden)return;setPlaying(false);});
  } catch(error) {console.error(error);$('#loading').hidden=true;$('#map-error').hidden=false;$('#map-error').innerHTML=`<strong>The atlas could not load.</strong><p>${esc(error.message)}</p><p>Serve this project over HTTP, then reload.</p><a href="./README.md">Read the field notes →</a>`;}
}
start();
