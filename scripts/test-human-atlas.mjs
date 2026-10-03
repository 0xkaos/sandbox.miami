import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MIN_YEAR, MAX_YEAR, TIME_KNOTS, REGIONS, bracket, yearToPosition, positionToYear, populationAt, summarize, densityHeight, containsPoint, borderBracket, nearbyEvents, activeMigrations, migrationProgress } from '../public/threejs/human_atlas/model.mjs';
import { SOURCES, EVENTS, MIGRATIONS } from '../public/threejs/human_atlas/history.mjs';
import { makeSnapshot, snapshotCSV } from '../public/threejs/human_atlas/snapshot.mjs';
import { validateResearch } from '../public/threejs/human_atlas/import.mjs';
import { PopulationDetail } from '../public/threejs/human_atlas/population-detail.mjs';
import { sitesAt, phasesAt, searchSites, siteSnapshot, hasSiteLocation } from '../public/threejs/human_atlas/sites.mjs';
import { activeNearEast, nearEastAt, nearEastForRegion, nearEastSnapshot } from '../public/threejs/human_atlas/near-east.mjs';
import { paleohumansRemainsAt, paleohumansRemainsSnapshot } from '../public/threejs/human_atlas/paleohumans-remains.mjs';
import { euppadDatesAt, euppadDatesSnapshot } from '../public/threejs/human_atlas/euppad-dates.mjs';

const dir = new URL('../public/threejs/human_atlas/data/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('population.json', dir)));
const binary = readFileSync(new URL('population.f32', dir));
const values = new Float32Array(binary.buffer, binary.byteOffset, binary.byteLength / 4);
const borders = JSON.parse(readFileSync(new URL('borders.json', dir)));
const comparison = JSON.parse(readFileSync(new URL('comparison.json', dir)));
const world = REGIONS[0];
const heritage = JSON.parse(readFileSync(new URL('unesco-sites.json', dir)));
const nearEast = JSON.parse(readFileSync(new URL('near-east.json', dir)));
const paleohumans = JSON.parse(readFileSync(new URL('paleohumans-remains.json', dir)));
const euppad = JSON.parse(readFileSync(new URL('euppad-calibrated-dates.json', dir)));

test('PaleoHumans catalog preserves dated-result provenance without claiming calibration', () => {
  assert.equal(paleohumans.schemaVersion, 1);
  assert.equal(paleohumans.source.license, 'CC BY 4.0');
  assert.equal(paleohumans.source.sha256, 'ea528877d0c04505619020069c96f7a64770c0e2cc0523a7b5822dcfa82092ea');
  assert.equal(paleohumans.records.length, 134);
  assert.equal(new Set(paleohumans.records.map(record => record.id)).size, paleohumans.records.length);
  for (const record of paleohumans.records) {
    assert.ok(Math.abs(record.lat) <= 90 && Math.abs(record.lon) <= 180, record.id);
    assert.ok(record.displayRange[0] <= record.displayRange[1], record.id);
    assert.ok(Number.isFinite(record.radiocarbonBP) && Number.isFinite(record.radiocarbonRange), record.id);
  }
  const active = paleohumansRemainsAt(paleohumans, -12000, world);
  assert.ok(active.length > 0);
  const snapshot = paleohumansRemainsSnapshot(paleohumans, -12000, world);
  assert.equal(snapshot.source.sha256, paleohumans.source.sha256);
  assert.equal(snapshot.totalRecords, active.length);
  assert.match(snapshot.status, /uncalibrated/i);
  assert.match(snapshot.status, /not a calibrated calendar interval/i);
});

test('EUPPAD preserves independently calibrated target-95.4% intervals', () => {
  assert.equal(euppad.schemaVersion, 1);
  assert.equal(euppad.source.license, 'CC BY 4.0');
  assert.equal(euppad.source.sha256, '53f0f1dfd198b4e8a065254b74337faf14e377b559bb09186f09dd5ddee65f46');
  assert.equal(euppad.source.inputRows, 471);
  assert.equal(euppad.records.length, 471);
  assert.equal(new Set(euppad.records.map(record => record.id)).size, euppad.records.length);
  assert.equal(new Set(euppad.records.map(record => record.siteId)).size, 123);
  assert.ok(euppad.records.some(record => record.calibratedRanges95.length > 1));
  for (const record of euppad.records) {
    assert.ok(Math.abs(record.lat) <= 90 && Math.abs(record.lon) <= 180, record.id);
    assert.ok(record.calibrationCurve === 'IntCal20' && record.calibrationMethod === 'BchronCalibrate', record.id);
    assert.ok(record.calibratedProbability >= .954 && record.calibratedProbability < .956, record.id);
    for (const [start, end] of record.calibratedRanges95) assert.ok(Number.isFinite(start) && Number.isFinite(end) && start <= end, record.id);
  }
  const active = euppadDatesAt(euppad, -14000, world);
  assert.ok(active.length > 0);
  const snapshot = euppadDatesSnapshot(euppad, -14000, world);
  assert.equal(snapshot.totalRecords, active.length);
  assert.match(snapshot.status, /IntCal20/);
  assert.match(snapshot.status, /not continuous occupation/i);
});

test('Near East layer distinguishes Ur the city, Sumer the region, and successive political rule', () => {
  assert.equal(nearEast.schemaVersion,1);
  assert.equal(nearEast.source.polygonsLicense,'CC BY 4.0');
  assert.equal(nearEast.source.placesLicense,'CC BY 3.0');
  assert.equal(new Set(nearEast.features.map(f=>f.id)).size,nearEast.features.length);
  for(const item of [...nearEast.features,...nearEast.places]){
    assert.ok(item.start<=item.end&&item.start>=MIN_YEAR&&item.end<=MAX_YEAR,item.id);
    assert.ok(Math.abs(item.lat)<=90&&Math.abs(item.lon)<=180,item.id);
    assert.ok(item.note&&item.sources.length,item.id);
  }
  const names=year=>nearEastAt(nearEast,year,30.962,46.105).map(x=>x.name);
  assert.ok(names(-3000).includes('Ur'));
  assert.ok(names(-3000).includes('Sumerian city-states'));
  assert.ok(names(-3000).includes('Sumer · cultural region'));
  assert.ok(names(-2250).includes('Akkadian Empire'));
  assert.ok(!names(-2250).some(x=>x.includes('Ur III')));
  assert.ok(names(-2050).includes('Ur III state · approximate core'));
  assert.ok(!names(-2050).includes('Akkadian Empire'));
  assert.ok(!names(-2050).includes('Sumerian city-states'));
});

test('Near East chronology separates Israel, Samaria, Judah, and later Judea', () => {
  const samaria=year=>nearEastAt(nearEast,year,32.276,35.190).map(x=>x.name);
  assert.ok(samaria(-800).includes('Kingdom of Israel'));
  assert.ok(!samaria(-722).includes('Kingdom of Israel'));
  assert.ok(samaria(-700).includes('Samaria'));
  assert.ok(samaria(-700).includes('Neo-Assyrian Empire'));
  assert.ok(activeNearEast(nearEast,-600).areas.some(x=>x.name==='Kingdom of Judah · approximate core'));
  assert.ok(activeNearEast(nearEast,-1).areas.some(x=>x.name==='Judea · region'));
  const region=REGIONS.find(x=>x.id==='near-east');
  assert.ok(nearEastForRegion(nearEast,-800,region).some(x=>x.name==='Kingdom of Judah'));
  const snap=nearEastSnapshot(nearEast,-800,region);
  assert.ok(snap.records.find(x=>x.name==='Samaria').url.includes('pleiades.stoa.org'));
  assert.ok(snap.records.find(x=>x.name==='Kingdom of Israel').sources.includes('oracc-israel'));
  assert.equal(nearEastSnapshot(nearEast,-4000,region).records.length,0);
});

test('UNESCO catalog preserves provenance, coordinates, and reviewed evidence separately from inscription', () => {
  const { sites, counts } = heritage;
  assert.equal(counts.sites, 1248);
  assert.equal(sites.length, counts.sites);
  assert.equal(new Set(sites.map(s => s.id)).size, sites.length);
  assert.equal(counts.reviewedSites, sites.filter(s => s.phases.length).length);
  assert.equal(counts.phases, sites.reduce((n, s) => n + s.phases.length, 0));
  assert.equal(counts.unlocatedSites, sites.filter(s => !hasSiteLocation(s)).length);
  assert.equal(createHash('sha256').update(readFileSync(new URL('unesco-phases.json', dir))).digest('hex'), heritage.reviewFileSha256);
  for (const site of sites) {
    assert.match(site.url, /^https:\/\/whc.unesco.org\/en\/list\/\d+\/$/);
    if (hasSiteLocation(site)) assert.ok(Math.abs(site.lat) <= 90 && Math.abs(site.lon) <= 180);
    else assert.equal(site.region, null);
    for (const phase of site.phases) {
      assert.ok(phase.start <= phase.end && phase.start >= MIN_YEAR && phase.end <= MAX_YEAR);
      assert.ok(phase.start !== 0 && phase.end !== 0);
      assert.ok(site.description.includes(phase.quote), `${site.id}: source phrase`);
      assert.ok(phase.note && phase.precision && phase.dateLabel);
    }
    for (const mention of site.dateMentions) {
      assert.equal(mention.status, 'unreviewed');
      assert.ok(!('start' in mention) && !('end' in mention));
      assert.ok(site.description.includes(mention.text));
    }
  }
  const jericho = sites.find(s => s.unescoId === '1687');
  assert.equal(jericho.inscribed, 2023);
  assert.deepEqual(jericho.phases.map(p => [p.start, p.end]), [[-9000, -7001]]);
  assert.ok(heritage.source.license && heritage.source.descriptionLicense && heritage.source.sha256);
});

test('heritage timeline uses reviewed phase bounds; overlapping phases produce one property', () => {
  const sites = heritage.sites, jericho = sites.find(s => s.unescoId === '1687');
  assert.ok(sitesAt(sites, -8000, world).includes(jericho));
  assert.ok(!sitesAt(sites, -10000, world).includes(jericho));
  assert.ok(!sitesAt(sites, 2023, world).includes(jericho));
  const catal = sites.find(s => s.unescoId === '1405');
  assert.equal(phasesAt(catal, -6200).length, 2);
  assert.equal(sitesAt(sites, -6200, world).filter(s => s.id === catal.id).length, 1);
  assert.equal(phasesAt(catal, -5500)[0].label, 'Western mound · Chalcolithic phase');
  assert.ok(!sitesAt(sites, -8000, REGIONS.find(r => r.id === 'americas')).includes(jericho));
  assert.ok(!sitesAt(sites, -8000, world, {lat: 40, lon: -100}).includes(jericho));
  assert.equal(sitesAt(sites.filter(s => !s.phases.length), 1900, world).length, 0);
});

test('heritage search finds undated sites without inventing dates or locations; snapshots retain attribution', () => {
  const sites = heritage.sites;
  assert.equal(searchSites(sites, 'gobekli', 'all', -8000, world)[0].unescoId, '1572');
  assert.equal(searchSites(sites, 'catalhoyuk', 'all', -8000, world)[0].unescoId, '1405');
  const stonehenge = searchSites(sites, 'stonehenge', 'all', -3000, world)[0];
  assert.equal(stonehenge.phases.length, 0);
  assert.equal(searchSites(sites, 'stonehenge', 'time', -3000, world).length, 0);
  assert.equal(searchSites(sites, 'Jericho', 'unreviewed', -8000, world).length, 0);
  assert.equal(searchSites(sites, '1567', 'all', 1916, world)[0].lat, null);
  const selected = sitesAt(sites, -8000, REGIONS.find(r => r.id === 'mediterranean'));
  const snapshot = siteSnapshot(selected, -8000, heritage.source);
  assert.equal(snapshot.records.find(s => s.id === 'unesco-1687').inscriptionYear, 2023);
  assert.equal(snapshot.attribution.descriptionLicense, 'CC BY-SA 3.0 IGO');
  assert.equal(snapshot.attribution.download, heritage.source.download);
  assert.ok(snapshot.records.every(s => s.phases.every(p => p.start <= -8000 && p.end >= -8000)));
  assert.match(siteSnapshot([], -8000).status, /unavailable/);
});

test('bundled population grid is complete, finite, nonnegative, and matches its checksum', () => {
  assert.equal(createHash('sha256').update(binary).digest('hex'), meta.sha256);
  assert.equal(values.length, meta.years.length * meta.cells.length);
  assert.equal(meta.years.length, 75);
  assert.equal(meta.cells.length, 15098);
  assert.ok(values.every(x => Number.isFinite(x) && x >= 0));
  for (const cell of meta.cells) {
    assert.ok(Math.abs(cell[0]) <= 90 && Math.abs(cell[1]) <= 180 && cell[2] > 0);
    assert.ok(cell[3] >= 0 && cell[3] < 6);
  }
  for (let j = 0; j < meta.years.length; j++) {
    let sum = 0; for (let i = 0; i < meta.cells.length; i++) sum += values[j * meta.cells.length + i];
    assert.equal(Math.round(sum), meta.totals[j]);
  }
  assert.equal(meta.totals[0], 4432265);
  assert.equal(meta.totals.at(-1), 7406762974);
});

test('interpolation conserves population and does not extrapolate beyond evidence', () => {
  const a = populationAt(meta, values, -4000), b = populationAt(meta, values, -3000), mid = populationAt(meta, values, -3500);
  for (let i = 0; i < mid.length; i++) assert.ok(Math.abs(mid[i] - (a[i] + b[i]) / 2) < Math.max(.01, mid[i] * 1e-6));
  assert.equal(populationAt(meta, values, -10001), null);
  assert.equal(populationAt(meta, values, 2018), null);
  assert.equal(bracket(meta.years, -10000).a, 0);
  assert.deepEqual(bracket(meta.years, MAX_YEAR), { a: 74, b: 74, t: 0 });
});

test('geographic bins partition the world without double counting', () => {
  const p = populationAt(meta, values, 1850), all = summarize(meta, p, world);
  assert.ok(Math.abs(all.regions.reduce((s, r) => s + r.population, 0) - all.total) < .01);
  const countries = REGIONS.filter(r => ['africa','europe','asia','americas','oceania'].includes(r.id));
  const sum = countries.reduce((s, r) => s + summarize(meta, p, r).total, 0);
  assert.ok(Math.abs(sum - all.total) < .01);
  assert.ok(summarize(meta, p, REGIONS.find(r=>r.id==='mediterranean')).total < all.total);
});

test('era-weighted time mapping round trips all eras and endpoints', () => {
  for (const year of [...TIME_KNOTS, -5555, -1, 0, 1, 1348, 1918]) assert.ok(Math.abs(positionToYear(yearToPosition(year)) - year) < 1e-8);
  assert.equal(positionToYear(-2), MIN_YEAR); assert.equal(positionToYear(5), MAX_YEAR);
});

test('height depends on density and explicit settings, never the selected date', () => {
  assert.equal(densityHeight(0), 0);
  assert.ok(Math.abs(densityHeight(100, 'linear') - densityHeight(10, 'linear') * 10) < 1e-12);
  assert.equal(densityHeight(1, 'log', 3), densityHeight(1, 'log', 1) * 3);
  assert.ok(densityHeight(1000, 'log') > densityHeight(100, 'log'));
});

test('spatial selection respects polygon holes and the international date line', () => {
  const ordinary = { type:'Polygon', coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[3,3],[7,3],[7,7],[3,7],[3,3]]] };
  assert.ok(containsPoint(ordinary,2,2)); assert.ok(!containsPoint(ordinary,5,5));assert.ok(!containsPoint(ordinary,20,5));
  const seam={type:'Polygon',coordinates:[[[178,-20],[-178,-20],[-178,-10],[178,-10],[178,-20]]]};
  assert.ok(containsPoint(seam,179,-15));assert.ok(containsPoint(seam,-179,-15));assert.ok(!containsPoint(seam,0,-15));
});

test('boundary snapshots exist, have valid geometries, and expose held/unknown dates', () => {
  assert.equal(borders.snapshots.length,48);
  for(const row of borders.snapshots){const geo=JSON.parse(readFileSync(new URL(`borders/${row.file}`,dir)));assert.equal(geo.features.length,row.features);assert.ok(geo.features.every(f=>f.properties.name&&['Polygon','MultiPolygon'].includes(f.geometry.type)));}
  assert.equal(borderBracket(borders.snapshots,-4000),null);
  assert.equal(borderBracket(borders.snapshots,2017).held,true);
  const b=borderBracket(borders.snapshots,1348);assert.equal(borders.snapshots[b.a].year,1300);assert.equal(borders.snapshots[b.b].year,1400);assert.equal(b.t,.48);
});

test('every story and migration has provenance and valid dates', () => {
  const sourceIds=new Set(SOURCES.map(s=>s.id));
  for(const item of [...EVENTS,...MIGRATIONS]){assert.ok(item.start<=item.end);assert.ok(item.sources.length);assert.ok(item.sources.every(id=>sourceIds.has(id)));}
  const selected=nearbyEvents(EVENTS,1348,REGIONS.find(r=>r.id==='europe'),'plague');assert.ok(selected.some(e=>e.id==='black-death'));assert.ok(selected.every(e=>e.kind==='plague'));
  const steppe=MIGRATIONS.find(r=>r.id==='steppe-west');assert.equal(migrationProgress(steppe,-4000),0);assert.equal(migrationProgress(steppe,-2000),1);assert.ok(activeMigrations(MIGRATIONS,-3000).includes(steppe));assert.ok(!activeMigrations(MIGRATIONS,1000).includes(steppe));
});

test('snapshot exports use the selected region, date, interpolation, and source links', () => {
  const region=REGIONS.find(r=>r.id==='europe'),year=1348,populations=populationAt(meta,values,year);
  const s=makeSnapshot({meta,values,populations,year,region,events:[],migrations:[],sources:SOURCES,comparison,borderStatus:'1300 → 1400'});
  assert.equal(s.data.population,summarize(meta,populations,region).total);assert.equal(s.data.populationProvenance.weight,.48);assert.ok(s.svg.includes('Europe · 1348 CE'));assert.ok(s.data.sources.some(s=>s.id==='hyde'));
  const csv=snapshotCSV(meta,populations,region,year),rows=csv.trim().split('\r\n');assert.equal(rows.length-1,summarize(meta,populations,region).cells);assert.ok(rows[1].startsWith('1348,'));
  const empty=makeSnapshot({meta,values,populations:null,year:-45000,region:world,events:[],migrations:[],sources:SOURCES,comparison,borderStatus:'Unknown'});assert.equal(empty.data.population,null);assert.ok(empty.svg.includes('No quantitative population'));
});

test('local research import rejects unsafe links, invented source IDs, invalid geography, and duplicate records atomically', () => {
  const existing={sources:SOURCES,events:EVENTS,migrations:MIGRATIONS};
  const record={id:'my-research-event',title:'Local event',kind:'society',start:1200,end:1201,lat:40,lon:20,region:1,sources:['hyde'],detail:'An imported record.'};
  const good={schemaVersion:1,events:[record]};
  assert.equal(validateResearch(good,existing).events.length,1);
  for(const edit of [{sources:['missing']},{lat:91},{start:1400,end:1200},{kind:'toString'},{id:EVENTS[0].id}])assert.throws(()=>validateResearch({schemaVersion:1,events:[{...record,...edit}]},existing));
  assert.throws(()=>validateResearch({schemaVersion:1,sources:[{id:'evil',title:'Bad',url:'javascript:alert(1)',author:'x',detail:'x'}]},existing));
  assert.throws(()=>validateResearch({schemaVersion:1,events:[record,record]},existing));
  assert.equal(existing.events.length,EVENTS.length);
});

test('finer grids preserve source counts, dates, checksums, and the original spatial distribution', () => {
  const parentIndex=new Map(meta.cells.map((c,i)=>[`${Math.floor(90-c[0])}/${Math.floor(c[1]+180)}`,i]));
  for(const resolution of [.5,.25]){
    const root=new URL(`population-${resolution}/`,dir),fine=JSON.parse(readFileSync(new URL('index.json',root)));
    assert.equal(fine.resolutionDegrees,resolution);assert.deepEqual(fine.years,meta.years);
    assert.equal(fine.cells.length,resolution===.5?52498:185566);
    const parents=fine.cells.map(c=>parentIndex.get(`${Math.floor(90-c[0])}/${Math.floor(c[1]+180)}`));
    assert.ok(parents.every(i=>i!==undefined));
    for(let j=0;j<fine.frames.length;j++){
      const frame=fine.frames[j],binary=readFileSync(new URL(frame.file,root));
      assert.equal(binary.byteLength,fine.cells.length*4);assert.ok(binary.byteLength<25*1024*1024);
      assert.equal(createHash('sha256').update(binary).digest('hex'),frame.sha256);
      const cells=new Float32Array(binary.buffer,binary.byteOffset,binary.byteLength/4),sums=new Float64Array(meta.cells.length);
      assert.ok(cells.every(p=>Number.isFinite(p)&&p>=0));
      let total=0;for(let i=0;i<cells.length;i++){total+=cells[i];sums[parents[i]]+=cells[i];}
      assert.equal(Math.round(total),frame.total);
      assert.ok(Math.abs(total-meta.totals[j])<Math.max(1,total*1e-7));
      for(let i=0;i<sums.length;i++)assert.ok(Math.abs(sums[i]-values[j*meta.cells.length+i])<Math.max(.01,sums[i]*1e-6));
    }
  }
});

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function detailFixture(fetcher,onChange=()=>{}){
  return new PopulationDetail({years:[0,10,20],cells:[[0,0,1],[1,1,1]],frames:[{file:'0.f32'},{file:'10.f32'},{file:'20.f32'}]},'/detail',onChange,fetcher);
}
test('detail loads only adjoining dates, interpolates counts, and reuses cached frames', async () => {
  const requests=[],changed=[];
  const detail=detailFixture(async url=>{requests.push(url);const year=Number(url.split('/').at(-1).split('.')[0]);return {ok:true,arrayBuffer:async()=>new Float32Array([year,year*2]).buffer};},()=>changed.push(true));
  assert.deepEqual(detail.sample(-1),{populations:null,year:-1});assert.equal(requests.length,0);
  assert.equal(detail.sample(4).loading,true);await tick();
  assert.deepEqual(requests,['/detail/0.f32','/detail/10.f32']);assert.equal(changed.length,1);
  assert.deepEqual([...detail.sample(4).populations],[4,8]);assert.deepEqual([...detail.sample(3).populations],[3,6]);assert.equal(requests.length,2);
  detail.dispose();
});
test('scrubbing aborts obsolete detail requests and suppresses stale callbacks', async () => {
  const waiting=[],changed=[];
  const detail=detailFixture((url,{signal})=>new Promise(resolve=>waiting.push({url,signal,resolve})),()=>changed.push(true));
  detail.sample(4);const old=waiting.slice();detail.sample(20);
  assert.ok(old.every(r=>r.signal.aborted));
  for(const r of old)r.resolve({ok:true,arrayBuffer:async()=>new Float32Array([999,999]).buffer});
  await tick();assert.equal(changed.length,0);
  waiting.at(-1).resolve({ok:true,arrayBuffer:async()=>new Float32Array([20,40]).buffer});await tick();
  assert.deepEqual([...detail.sample(20).populations],[20,40]);assert.equal(changed.length,1);detail.dispose();
});
test('failed detail requests remain errors without a retry storm', async () => {
  let count=0;const detail=detailFixture(async()=>{count++;return {ok:false,status:503};});
  detail.sample(4);await tick();
  for(let i=0;i<30;i++)assert.match(detail.sample(4).error,/503/);
  assert.equal(count,2);detail.dispose();
});
