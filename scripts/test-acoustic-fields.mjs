import test from 'node:test';
import assert from 'node:assert/strict';
import { captureField, encodeSnapshot, decodeSnapshot } from '../public/threejs/acoustic_chamber/snapshot.mjs';
import { WaveChamber } from '../public/threejs/acoustic_chamber/physics.mjs';
import { EnergyField, contours, surface, strands, tubes } from '../public/threejs/acoustic_field/geometry.mjs';
import { handleAcousticStates } from '../lib/acoustic-states.mjs';

function analytic(fn, n = 19) {
    const cell = 2/(n-1), origin = -1-cell/2, energy = new Float32Array(n**3), mask = new Uint8Array(n**3).fill(1);
    for (let z=0; z<n; z++) for (let y=0; y<n; y++) for (let x=0; x<n; x++) energy[x+n*(y+n*z)] = fn(-1+x*cell,-1+y*cell,-1+z*cell);
    return { meta:{ format:'acoustic-field',version:1,name:'Analytic test',createdAt:'2026-09-27T00:00:00Z',dimensions:[n,n,n],
        min:[origin,origin,origin],max:[origin+n*cell,origin+n*cell,origin+n*cell],config:{cell,shape:'box',length:2,height:2,depth:2},time:0,meanEnergy:1,levels:[0.06,0.18,0.55] },
    energy,pressure:new Float32Array(n**3),mask };
}

test('capture and binary round trip preserve original float samples, geometry, settings and view', () => {
    const wave = new WaveChamber({ resolution:32,opening:true,harmonics:true }); wave.step(170);
    const snapshot = captureField(wave,'Overtones · étude'); snapshot.meta.view = {controls:{mode:'strands'},camera:[1,2,3]};
    const decoded = decodeSnapshot(encodeSnapshot(snapshot));
    assert.deepEqual(decoded,snapshot);
    const captured = snapshot.energy[wave.source[0][0]];
    wave.step(25); assert.equal(snapshot.energy[wave.source[0][0]],captured,'capture owns its samples');
    assert.ok(wave.energy()>0,'capture does not detach the active solver');
    assert.deepEqual(decoded.meta.config.partials,wave.config.partials);
});
test('invalid and truncated snapshots fail before rendering', () => {
    const snapshot = analytic((x,y,z)=>x*x+y*y+z*z), buffer = encodeSnapshot(snapshot);
    assert.throws(()=>decodeSnapshot(buffer.slice(0,-1)),/Truncated/);
    const corrupt = buffer.slice(0); new DataView(corrupt).setUint32(8,100000,true);
    assert.throws(()=>decodeSnapshot(corrupt),/header/);
    snapshot.energy[2] = NaN; assert.throws(()=>encodeSnapshot(snapshot),/invalid samples/);
    snapshot.energy[2] = 1; snapshot.meta.dimensions[0] = 99999; assert.throws(()=>encodeSnapshot(snapshot),/dimensions/);
});
test('contours join into closed curves and stay on a spherical energy level', () => {
    const field = new EnergyField(analytic((x,y,z)=>x*x+y*y+z*z),0), level = 0.5/field.mean;
    const paths = contours(field,level,1,17); assert.ok(paths.length>8);
    for (const path of paths) {
        assert.ok(Math.hypot(...path[0].map((v,i)=>v-path.at(-1)[i]))<1e-6,'closed loop');
        for (const p of path) assert.ok(Math.abs(field.sample(p)-level)<1e-5);
    }
    const mesh = tubes(paths,0.005);
    assert.ok(mesh.indices.length>100); assert.equal(mesh.positions.length,mesh.normals.length);
    assert.ok(mesh.indices.every(i=>i<mesh.positions.length/3)); assert.ok(mesh.positions.every(Number.isFinite));
});
test('membranes locate a known sphere, with outward normals and no solid-cell shells', () => {
    const snapshot = analytic((x,y,z)=>x*x+y*y+z*z), field = new EnergyField(snapshot,0);
    const mesh = surface(field,0.5/field.mean); assert.ok(mesh.positions.length>1000);
    for (let i=0; i<mesh.positions.length; i+=3) {
        const p = Array.from(mesh.positions.subarray(i,i+3)), n = Array.from(mesh.normals.subarray(i,i+3));
        assert.ok(Math.abs(Math.hypot(...p)-Math.sqrt(0.5))<field.cell*0.12);
        assert.ok(p.reduce((s,v,a)=>s+v*n[a],0)>0.5,'normal faces outward');
    }
    snapshot.mask.fill(2); assert.equal(surface(new EnergyField(snapshot,0),0.3).positions.length,0);
});
test('strands follow rather than cross their energy shell', () => {
    const field = new EnergyField(analytic((x,y,z)=>x*x+y*y+z*z),0), level = 0.5/field.mean;
    const paths = strands(field,level,{count:18,steps:60,axis:1,twist:1}); assert.ok(paths.length>=15);
    for (const path of paths) {
        assert.ok(path.length>20);
        for (const p of path) assert.ok(Math.abs(field.sample(p)-level)<level*0.035);
    }
});
test('smoothing preserves a uniform interior next to a masked boundary; silent fields are finite', () => {
    const snapshot = analytic(()=>5);
    for (let i=0; i<snapshot.mask.length; i++) if (i%19<5) { snapshot.mask[i]=0; snapshot.energy[i]=0; }
    const field = new EnergyField(snapshot,4);
    for (let i=0; i<field.values.length; i++) if (field.mask[i]===1) assert.equal(field.values[i],1);
    const silent = new EnergyField(analytic(()=>0),1); assert.ok(silent.values.every(v=>v===0));
    assert.equal(surface(silent,0.1).positions.length,0); assert.deepEqual(contours(silent,0.1),[]);
});

function bucket() {
    const objects = new Map();
    return { objects, async put(key,body,options) { objects.set(key,{ body:body.slice(0),...options,key,uploaded:new Date(),size:body.byteLength,httpEtag:'"test"' }); },
        async get(key) { return objects.get(key) || null; },
        async list({prefix,limit,cursor}) { const all = [...objects.values()].filter(o=>o.key.startsWith(prefix)).sort((a,b)=>a.key.localeCompare(b.key));
            const start = +(cursor || 0), page = all.slice(start,start+limit); return {objects:page,truncated:start+limit<all.length,cursor:String(start+limit)}; } };
}
test('R2 save, listing and reload preserve the snapshot; unauthorized and malformed writes are rejected', async () => {
    const env = { BUCKET:bucket(),ADMIN_PASSWORD:'local-test-password' }, binary = encodeSnapshot(analytic((x,y,z)=>x*x+y*y+z*z));
    const request = (method='GET',query='',body=binary,password=env.ADMIN_PASSWORD) => new Request(`https://example.test/api/acoustic-states${query}`,{
        method,headers:{'Content-Type':'application/octet-stream','x-admin-password':password,...(method==='POST' ? {origin:'https://example.test'} : {})},...(method==='POST' ? {body} : {}) });
    assert.equal((await handleAcousticStates(request('POST','',binary,'wrong'),env)).status,401);
    assert.equal(env.BUCKET.objects.size,0);
    assert.equal((await handleAcousticStates(request('POST','',binary.slice(0,12)),env)).status,400);
    const saved = await handleAcousticStates(request('POST'),env); assert.equal(saved.status,201);
    const {id} = await saved.json();
    const listed = await (await handleAcousticStates(request(),env)).json(); assert.equal(listed.snapshots[0].id,id);
    const fetched = await handleAcousticStates(request('GET',`?id=${id}`),env); assert.equal(fetched.status,200);
    assert.deepEqual(await fetched.arrayBuffer(),binary);
    assert.equal((await handleAcousticStates(request('GET','?id=../../letters.json'),env)).status,400);
    assert.equal((await handleAcousticStates(request('DELETE'),env)).status,405);
    assert.equal((await handleAcousticStates(request('POST'),{BUCKET:env.BUCKET})).status,503);
    assert.equal((await handleAcousticStates(request(),{})).status,503);
});
