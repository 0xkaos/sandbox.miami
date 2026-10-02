import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { burialEventsAt, burialSitesAt, nearbyBurialEvidence } from '../public/threejs/human_atlas/burial-evidence.mjs';
import { activeLevantSiteIndices, levantSiteRecord, nearbyLevantSites } from '../public/threejs/human_atlas/levant-sites.mjs';
import { PLEIADES_MODERN_START_YEAR, nearbyPleiadesPlaces, pleiadesPlaceIndicesAt, pleiadesPlaceRecord, pleiadesPlacesSnapshot } from '../public/threejs/human_atlas/pleiades-places.mjs';
import { activeLanguages, languagesForRegion, languageGroups } from '../public/threejs/human_atlas/languages.mjs';
import { activeLanguageAttestations } from '../public/threejs/human_atlas/language-attestations.mjs';
import { buildResearchIndex, searchResearchIndex } from '../public/threejs/human_atlas/research-model.mjs';
import { makeSnapshot } from '../public/threejs/human_atlas/snapshot.mjs';
import { SOURCES } from '../public/threejs/human_atlas/history.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../public/threejs/human_atlas/data/${name}.json`, import.meta.url)));
const burials=read('corded-beaker-burials'),levant=read('levant-sites'),euroevol=read('euroevol-sites');
const pleiades=read('pleiades-places'),languages=read('languages'),attestations=read('language-attestations');
const world={id:'world',name:'World'},europe={id:'europe',name:'Europe'},nearEast={id:'near-east',name:'Near East',bounds:[32,27,51,40]};

test('burial dates remain uncertainty intervals and low-agreement events stay out of default time views',()=>{
  assert.equal(burials.events.length,967);
  assert.equal(burials.events.filter(event=>event.modelAgreement!=null&&event.modelAgreement<=60).length,16);
  const events=burialEventsAt(burials,-2400,europe);
  assert.equal(events.length,401);
  assert.ok(events.every(event=>event.modeledRange95[0]<=-2400&&event.modeledRange95[1]>=-2400));
  assert.ok(events.every(event=>event.modelAgreement==null||event.modelAgreement>60));
  assert.ok(burialSitesAt(burials,-2400,europe).length<events.length);
  const sample=events[0];
  assert.equal(nearbyBurialEvidence(burials,-2400,sample.lat,sample.lon,1)[0].site,sample.site);
  assert.equal(burialEventsAt(burials,-2400,europe,{interval:'mean'}).every(event=>event.modeledMean===-2400),true);
});

test('southern Levant time view counts sites with phases, not phase rows',()=>{
  assert.equal(levant.sites.length,5587);
  assert.equal(levant.phases.length,14268);
  const indices=activeLevantSiteIndices(levant,-800,nearEast);
  assert.equal(indices.length,1917);
  const site=levantSiteRecord(levant,indices[0],-800);
  assert.ok(site.phases.length>=1);
  assert.ok(site.phases.every(phase=>phase.start<=-800&&phase.end>=-800));
  assert.equal(nearbyLevantSites(levant,-800,site.lat,site.lon,1)[0].id,site.id);
  assert.equal(activeLevantSiteIndices(levant,-800,europe).length,0);
});

test('Pleiades retains location precision and distinguishes location dates from name dates',()=>{
  assert.equal(pleiades.places.length,21380);
  const urIndex=pleiades.places.findIndex(row=>row[0]==='912985');
  const romeIndex=pleiades.places.findIndex(row=>row[0]==='423025');
  const ur=pleiadesPlaceRecord(pleiades,urIndex,-3000),rome=pleiadesPlaceRecord(pleiades,romeIndex,-500);
  assert.equal(ur.title,'Ur(i)');
  assert.equal(ur.locationPrecision,'precise');
  assert.ok(ur.matchingTemporalAssociations.some(period=>period.basis==='location'));
  assert.equal(rome.title,'Roma');
  assert.equal(rome.locationPrecision,'rough');
  assert.ok(rome.matchingTemporalAssociations.every(period=>period.basis==='name'));
  assert.ok(rome.nameAliases.includes('Rome'));
  assert.ok(ur.nameAliases.includes('Tall al-Muqayyar'));
  const mapIndices=pleiadesPlaceIndicesAt(pleiades,-500,world,{onlyCertain:true,preciseOnly:true});
  assert.ok(mapIndices.includes(urIndex));
  assert.ok(!mapIndices.includes(romeIndex));
  const ecbatanaIndex=pleiades.places.findIndex(row=>row[0]==='903021');
  assert.ok(mapIndices.includes(ecbatanaIndex));
  assert.ok(!pleiadesPlaceIndicesAt(pleiades,-500,europe,{onlyCertain:true,preciseOnly:true}).includes(ecbatanaIndex));
  assert.ok(pleiadesPlaceIndicesAt(pleiades,-500,nearEast,{onlyCertain:true,preciseOnly:true}).includes(ecbatanaIndex));
  const snapshot=pleiadesPlacesSnapshot(pleiades,100,europe,{onlyCertain:true,preciseOnly:true,limit:10});
  assert.equal(snapshot.totalAssociatedPlaces,pleiadesPlaceIndicesAt(pleiades,100,europe,{onlyCertain:true,preciseOnly:true}).length);
  assert.equal(snapshot.places.length,10);
});

test('Pleiades Modern-period associations remain searchable but leave dated views from 1700 CE',()=>{
  assert.equal(PLEIADES_MODERN_START_YEAR,1700);
  const modernOnlyIndex=pleiades.places.findIndex(row=>row[0]==='99054');
  const modernOnly=pleiadesPlaceRecord(pleiades,modernOnlyIndex,2017);
  assert.equal(modernOnly.title,'Valløby');
  assert.ok(modernOnly.temporalAssociations.every(period=>period.start>=1700));
  assert.ok(modernOnly.matchingTemporalAssociations.length>0);
  const indices=pleiadesPlaceIndicesAt(pleiades,2017,world,{onlyCertain:true,preciseOnly:true});
  assert.deepEqual(indices,[]);
  assert.deepEqual(nearbyPleiadesPlaces(pleiades,2017,modernOnly.lat,modernOnly.lon,50),[]);
  const snapshot=pleiadesPlacesSnapshot(pleiades,2017,world,{onlyCertain:true,preciseOnly:true});
  assert.equal(snapshot.totalAssociatedPlaces,0);
  assert.deepEqual(snapshot.places,[]);
  assert.match(snapshot.status,/Modern-period/);

  const index=buildResearchIndex({burials,levant,euroevol,pleiades});
  assert.equal(searchResearchIndex(index,{query:'Rome',kind:'pleiades'})[0].id,'pleiades:423025');
  assert.equal(searchResearchIndex(index,{query:'Valløby',kind:'pleiades'})[0].id,'pleiades:99054');
  assert.equal(searchResearchIndex(index,{kind:'pleiades',scope:'time',year:2017,region:world}).length,0);
  assert.equal(searchResearchIndex(index,{query:'Valløby',kind:'pleiades',scope:'time',year:2017,region:world}).length,0);
  assert.ok(searchResearchIndex(index,{kind:'burial',scope:'time',year:-2400,region:europe}).length>0);
});

test('EUROEVOL culture associations remain searchable without fabricated calendar dates',()=>{
  assert.equal(euroevol.sites.length,4756);
  const index=buildResearchIndex({burials,levant,euroevol,pleiades});
  const broad=searchResearchIndex(index,{query:'Corded Ware',kind:'euroevol',scope:'region',region:europe});
  assert.ok(broad.length>=200);
  assert.ok(broad.every(row=>row.ranges.length===0));
  const timed=searchResearchIndex(index,{query:'Corded Ware',scope:'time',year:-2400,region:europe});
  assert.ok(timed.some(row=>row.kind==='burial'));
  assert.ok(timed.every(row=>row.kind!=='euroevol'&&!row.lowAgreement));
  assert.equal(searchResearchIndex(index,{query:'Ur(i)',kind:'pleiades',scope:'time',year:-3000,region:nearEast})[0].id,'pleiades:912985');
  assert.equal(searchResearchIndex(index,{query:'Roma',kind:'pleiades'})[0].id,'pleiades:423025');
  assert.equal(searchResearchIndex(index,{query:'Rome',kind:'pleiades'})[0].id,'pleiades:423025');
  assert.equal(searchResearchIndex(index,{query:'Tall al-Muqayyar',kind:'pleiades'})[0].id,'pleiades:912985');
  assert.equal(searchResearchIndex(index,{query:'Ecbatana',kind:'pleiades',scope:'region',region:europe}).some(row=>row.id==='pleiades:903021'),false);
  assert.equal(searchResearchIndex(index,{query:'Ecbatana',kind:'pleiades',scope:'region',region:nearEast})[0].id,'pleiades:903021');
});

test('research search ranks an exact title before an exact source alias and description-only matches',()=>{
  const rows=[
    {id:'description',kind:'pleiades',title:'Roman camp',aliases:[],search:'roman camp near rome'},
    {id:'alias',kind:'pleiades',title:'Roma',aliases:['rome'],search:'roma rome'},
    {id:'title',kind:'pleiades',title:'Rome',aliases:[],search:'rome'},
  ];
  assert.deepEqual(searchResearchIndex(rows,{query:'Rome'}).map(row=>row.id),['title','alias','description']);
});

test('modern language families and ancient inscriptions use different clocks',()=>{
  assert.equal(languages.languages.length,6683);
  assert.equal(activeLanguages(languages,-1000).length,0);
  assert.equal(activeLanguages(languages,2017).length,6683);
  const germanic=languagesForRegion(languages,2017,world,'germ1287');
  assert.equal(germanic.length,86);
  assert.ok(germanic.every(language=>languageGroups(languages,language).some(group=>group.id==='germ1287')));
  assert.equal(attestations.records.length,20);
  assert.equal(activeLanguageAttestations(attestations,-100).length,2);
  assert.equal(activeLanguageAttestations(attestations,-1000).length,0);
  assert.equal(activeLanguageAttestations(attestations,2017).length,0);
});

test('snapshot exports counts, capped samples, source links, and the new chart context',()=>{
  const gazetteer=pleiadesPlacesSnapshot(pleiades,-3000,nearEast,{onlyCertain:true,preciseOnly:true,limit:3});
  const snapshot=makeSnapshot({
    meta:{years:[-10000,2017],cells:[[33,40,100,2]],regions:['Africa','Europe','Asia']},
    values:new Float32Array([10,20]),populations:new Float32Array([20]),year:2017,
    region:world,events:[],migrations:[],sources:SOURCES,comparison:{series:{World:[[-10000,10],[2017,20]]}},
    borderStatus:'held',gazetteer,
  });
  assert.equal(snapshot.data.archaeology.ancientPlaces.totalAssociatedPlaces,gazetteer.totalAssociatedPlaces);
  assert.equal(snapshot.data.archaeology.ancientPlaces.places.length,3);
  assert.ok(snapshot.data.sources.some(source=>source.id==='pleiades'));
  assert.match(snapshot.svg,/Pleiades places/);
});
