import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MIN_YEAR, MAX_YEAR, TIME_KNOTS, REGIONS, bracket, yearToPosition, positionToYear, populationAt, summarize, densityHeight, containsPoint, borderBracket, nearbyEvents, activeMigrations, migrationProgress } from '../public/threejs/human_atlas/model.mjs';
import { SOURCES, EVENTS, MIGRATIONS } from '../public/threejs/human_atlas/history.mjs';
import { makeSnapshot, snapshotCSV } from '../public/threejs/human_atlas/snapshot.mjs';
import { validateResearch } from '../public/threejs/human_atlas/import.mjs';
import { PopulationDetail } from '../public/threejs/human_atlas/population-detail.mjs';

const dir = new URL('../public/threejs/human_atlas/data/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('population.json', dir)));
const binary = readFileSync(new URL('population.f32', dir));
const values = new Float32Array(binary.buffer, binary.byteOffset, binary.byteLength / 4);
const borders = JSON.parse(readFileSync(new URL('borders.json', dir)));
const comparison = JSON.parse(readFileSync(new URL('comparison.json', dir)));
const world = REGIONS[0];

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
