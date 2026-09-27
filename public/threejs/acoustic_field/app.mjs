import * as THREE from 'three';
import { OrbitControls } from '../acoustic_chamber/vendor/OrbitControls.js';
import { decodeSnapshot, encodeSnapshot, MAX_SNAPSHOT_BYTES } from '../acoustic_chamber/snapshot.mjs';
import { listLocal, loadLocal, saveLocal, downloadSnapshot, cloudRequest } from '../acoustic_chamber/snapshot-store.mjs';
import { vertexShader, fragmentShader } from './mist.mjs';

const $ = id => document.getElementById(id);
const controlIds = ['mode','axis','slices','count','steps','twist','radius','bandWidth','density','opacity','smoothing',
    'level0','level1','level2','enabled0','enabled1','enabled2','color0','color1','color2','cutAxis','cut','outline','rotate'];
const defaults = Object.fromEntries(controlIds.map(id => [id,$(id).type === 'checkbox' ? $(id).checked : $(id).value]));
function notice(text = '') { $('notice').textContent = text; $('notice').hidden = !text; }
const hints = {
    contours:'Equal-energy contours on parallel slices. Each line is a continuous, thin tube.',
    strands:'Strands follow a chosen direction and curl along the energy surfaces.',
    surfaces:'Three energy levels become continuous membranes. Lower opacity or use a cutaway to see inside.',
    mist:'Soft, translucent bands around the same energy levels, drawn throughout the volume.',
};

function boot() {
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
        if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 is required.');
    } catch { $('unsupported').hidden = false; notice(); return; }
    renderer.setClearColor(0x090e13); renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
    renderer.localClippingEnabled = true; $('scene').append(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40,innerWidth/innerHeight,0.02,200);
    const controls = new OrbitControls(camera,renderer.domElement); controls.enableDamping = true;
    controls.dampingFactor = 0.065; controls.autoRotateSpeed = 0.35; controls.minDistance = 0.3; controls.maxDistance = 50;
    scene.add(new THREE.HemisphereLight(0xd4e6f4,0x24313d,2));
    for (const [color,intensity,position] of [[0xffe4c4,3,[2,5,4]],[0x81cfed,2,[-4,1,-2]],[0xec9ebf,1.6,[4,0,-3]]]) {
        const light = new THREE.DirectionalLight(color,intensity); light.position.set(...position); scene.add(light);
    }
    const artwork = new THREE.Group(), outline = new THREE.Group(); scene.add(artwork,outline);
    const cutPlane = new THREE.Plane();
    let snapshot, localId = null, cloudId = null, worker, mistTexture, activeMode, buildTimer, saveTimer;
    let panelHidden = innerWidth<760, loadVersion = 0, localRows = [], cloudRows = [], cursor = null, dirty = true;

    function dispose(group) {
        for (const object of [...group.children]) {
            object.geometry?.dispose(); object.material?.dispose(); group.remove(object);
        }
    }
    function options() {
        return { mode:$('mode').value, axis:+$('axis').value, slices:+$('slices').value, count:+$('count').value,
            steps:+$('steps').value, twist:+$('twist').value, radius:+$('radius').value, smoothing:+$('smoothing').value,
            levels:[0,1,2].map(i => +$(`level${i}`).value), enabled:[0,1,2].map(i => $(`enabled${i}`).checked) };
    }
    function labels() {
        const mode = $('mode').value;
        $('modeHint').textContent = hints[mode];
        $('curveControls').hidden = !['contours','strands'].includes(mode);
        $('contourControls').hidden = mode !== 'contours'; $('strandControls').hidden = mode !== 'strands'; $('mistControls').hidden = mode !== 'mist';
        $('cut').disabled = $('cutAxis').value === '-1';
        for (const id of ['slices','count','steps','twist','bandWidth','density','smoothing']) $(`${id}Value`).textContent = $(id).value;
        $('radiusValue').textContent = `${Math.round(+$('radius').value*2000)} mm`;
        $('opacityValue').textContent = `${Math.round(+$('opacity').value*100)}%`; $('cutValue').textContent = `${$('cut').value}%`;
        for (let i = 0; i < 3; i++) $(`level${i}Value`).textContent = `${Number($(`level${i}`).value).toFixed(2)}×`;
    }
    function viewState() {
        return { controls:Object.fromEntries(controlIds.map(id => [id,$(id).type === 'checkbox' ? $(id).checked : $(id).value])),
            camera:camera.position.toArray(), target:controls.target.toArray() };
    }
    function currentSnapshot() {
        return { ...snapshot, meta:{ ...snapshot.meta, name:$('name').value.trim() || 'Untitled field', view:viewState() } };
    }
    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            if (!snapshot) return;
            const version = loadVersion, copy = currentSnapshot(), id = localId ||= crypto.randomUUID();
            try {
                await saveLocal(copy,id);
                if (version !== loadVersion) return;
                localRows = await listLocal(); populateLibrary();
                if (!cloudId) history.replaceState(null,'',`?local=${encodeURIComponent(id)}`);
            } catch (error) { notice(error.message); }
        },750);
    }
    controls.addEventListener('end',scheduleSave);
    function resetView() {
        if (!snapshot) return;
        dirty = true;
        const c = snapshot.meta.config, size = Math.max(c.length,c.height,c.depth), framing = Math.max(1,1/camera.aspect);
        controls.target.set(0,0,0); camera.position.set(size*1.2,size*0.65,size*1.45).multiplyScalar(framing); controls.update();
    }
    function buildOutline() {
        dispose(outline);
        const c = snapshot.meta.config, segments = c.shape === 'cylinder' ? 64 : 4, rings = [];
        for (const end of [0,1]) {
            const height = c.height*(c.shape === 'taper' && end ? 0.6 : 1), ring = [];
            for (let i = 0; i < segments; i++) {
                const a = i/segments*Math.PI*2;
                const yz = c.shape === 'cylinder' ? [Math.sin(a)*height/2,Math.cos(a)*c.depth/2]
                    : [[-height/2,-c.depth/2],[height/2,-c.depth/2],[height/2,c.depth/2],[-height/2,c.depth/2]][i];
                ring.push([(end-0.5)*c.length,...yz]);
            }
            rings.push(ring);
        }
        const positions = [];
        for (const ring of rings) for (let i = 0; i < segments; i++) positions.push(...ring[i],...ring[(i+1)%segments]);
        for (let i = 0; i < segments; i += c.shape === 'cylinder' ? 8 : 1) positions.push(...rings[0][i],...rings[1][i]);
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
        outline.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({ color:0x92b3bd,transparent:true,opacity:0.17 })));
        outline.visible = $('outline').checked;
    }
    function materialUpdate() {
        dirty = true; labels(); if (!snapshot) return;
        const axis = +$('cutAxis').value, c = snapshot.meta.config;
        const span = [c.length,c.height,c.depth][Math.max(0,axis)], cut = -span/2 + span*+$('cut').value/100;
        const normal = [0,0,0]; normal[Math.max(0,axis)] = -1; cutPlane.normal.set(...normal); cutPlane.constant = cut;
        outline.visible = $('outline').checked; controls.autoRotate = $('rotate').checked;
        for (const object of artwork.children) {
            const material = object.material;
            if (material.isShaderMaterial) {
                const u = material.uniforms;
                u.uLevels.value.set(...options().levels); u.uEnabled.value.set(...options().enabled.map(Number));
                for (let i = 0; i < 3; i++) u[`uColor${i}`].value.set($(`color${i}`).value);
                u.uWidth.value = +$('bandWidth').value; u.uDensity.value = +$('density').value; u.uOpacity.value = +$('opacity').value;
                u.uCutAxis.value = axis; u.uCut.value = cut;
            } else {
                material.color.set($(`color${object.userData.layer}`).value);
                material.opacity = +$('opacity').value;
                const transparent = material.opacity<1;
                if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
                material.depthWrite = !transparent;
                const planes = axis<0 ? [] : [cutPlane];
                if (material.clippingPlanes?.length !== planes.length) material.needsUpdate = true;
                material.clippingPlanes = planes;
            }
        }
    }
    function buildMist(values) {
        const meta = snapshot.meta, data = new Uint16Array(values.length*2);
        for (let i = 0; i < values.length; i++) { data[i*2] = THREE.DataUtils.toHalfFloat(Math.min(values[i],65504)); data[i*2+1] = THREE.DataUtils.toHalfFloat(snapshot.mask[i] === 1 ? 1 : 0); }
        mistTexture = new THREE.Data3DTexture(data,...meta.dimensions); mistTexture.format = THREE.RGFormat; mistTexture.type = THREE.HalfFloatType;
        mistTexture.minFilter = mistTexture.magFilter = THREE.LinearFilter; mistTexture.unpackAlignment = 1; mistTexture.needsUpdate = true;
        const min = new THREE.Vector3(...meta.min), max = new THREE.Vector3(...meta.max), size = max.clone().sub(min);
        const material = new THREE.ShaderMaterial({ vertexShader,fragmentShader,glslVersion:THREE.GLSL3,transparent:true,depthWrite:false,side:THREE.BackSide,
            uniforms:{ uField:{value:mistTexture},uMin:{value:min},uMax:{value:max},uEye:{value:camera.position},
                uLevels:{value:new THREE.Vector3()},uEnabled:{value:new THREE.Vector3()},uColor0:{value:new THREE.Color()},uColor1:{value:new THREE.Color()},uColor2:{value:new THREE.Color()},
                uWidth:{value:0.04},uDensity:{value:2},uOpacity:{value:1},uCutAxis:{value:-1},uCut:{value:0} } });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x,size.y,size.z),material);
        mesh.position.copy(min.clone().add(max).multiplyScalar(0.5)); artwork.add(mesh);
    }
    function rebuild() {
        clearTimeout(buildTimer); if (!snapshot) return;
        worker?.terminate(); const pending = worker = new Worker(new URL('./build-worker.mjs',import.meta.url),{type:'module'});
        const requested = options(); notice('Shaping the field…');
        pending.onerror = event => { if (worker === pending) { notice(`Could not build this view. ${event.message}`); pending.terminate(); } };
        pending.onmessage = ({data}) => {
            if (worker !== pending) return;
            pending.terminate(); worker = null;
            if (data.error) { notice(data.error); return; }
            dispose(artwork); mistTexture?.dispose(); mistTexture = null; activeMode = requested.mode;
            let triangles = 0, paths = 0;
            data.layers.forEach((layer,i) => {
                if (!layer?.positions.length) return;
                const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.BufferAttribute(layer.positions,3));
                geometry.setAttribute('normal',new THREE.BufferAttribute(layer.normals,3)); if (layer.indices) geometry.setIndex(new THREE.BufferAttribute(layer.indices,1));
                const material = new THREE.MeshStandardMaterial({ color:$(`color${i}`).value,roughness:0.4,metalness:0.18,side:THREE.DoubleSide });
                const mesh = new THREE.Mesh(geometry,material); mesh.userData.layer = i; artwork.add(mesh);
                triangles += (layer.indices?.length || layer.positions.length/3)/3; paths += layer.pathCount || 0;
            });
            if (data.values) buildMist(data.values);
            materialUpdate();
            $('renderInfo').textContent = requested.mode === 'mist' ? 'Frozen field · drag to orbit' : `${paths ? `${paths.toLocaleString()} curves · ` : ''}${Math.round(triangles).toLocaleString()} triangles`;
            if (!artwork.children.length) notice(requested.enabled.some(Boolean) ? 'No shells at these energy levels. Try a higher level, less smoothing, or a later capture.' : 'Enable an energy layer to see the field.');
            else if (data.mean<1e-15) notice('This capture is silent. Run the chamber before capturing a field.');
            else notice();
        };
        pending.postMessage({snapshot,options:requested});
    }
    function scheduleBuild() { clearTimeout(buildTimer); buildTimer = setTimeout(rebuild,180); }
    function populateLibrary() {
        const selected = $('library').value, fragment = document.createDocumentFragment();
        fragment.append(new Option('Example · harmonic chamber','demo'));
        for (const [label,rows,prefix] of [['This browser',localRows,'local'],['R2',cloudRows,'cloud']]) {
            if (!rows.length) continue;
            const group = document.createElement('optgroup'); group.label = label;
            for (const row of rows) group.append(new Option(`${row.name} · ${new Date(row.createdAt).toLocaleDateString()}`,`${prefix}:${row.id}`));
            fragment.append(group);
        }
        $('library').replaceChildren(fragment);
        const wanted = localId ? `local:${localId}` : cloudId ? `cloud:${cloudId}` : selected;
        if ([...$('library').options].some(o => o.value === wanted)) $('library').value = wanted;
        $('more').hidden = !cursor;
    }
    async function refreshLibrary(more = false) {
        $('refresh').disabled = true; $('more').disabled = true;
        try { localRows = await listLocal(); } catch (error) { $('libraryHint').textContent = error.message; }
        try {
            const result = await (await cloudRequest(more && cursor ? `?cursor=${encodeURIComponent(cursor)}` : '')).json();
            cloudRows = more ? [...cloudRows,...result.snapshots] : result.snapshots; cursor = result.cursor;
            $('libraryHint').textContent = 'Captures and view changes are saved in this browser. R2 saves are available across devices.';
        } catch (error) { $('libraryHint').textContent = error.message; }
        populateLibrary(); $('refresh').disabled = false; $('more').disabled = false;
    }
    async function openField(source,id) {
        const version = ++loadVersion; clearTimeout(saveTimer); clearTimeout(buildTimer); worker?.terminate(); worker = null;
        notice('Opening the field…'); $('cloudSave').disabled = $('download').disabled = true;
        try {
            let loaded;
            if (source === 'local') loaded = await loadLocal(id);
            else if (source === 'cloud') loaded = decodeSnapshot(await (await cloudRequest(`?id=${encodeURIComponent(id)}`)).arrayBuffer());
            else if (source === 'file') loaded = id;
            else {
                const response = await fetch('./example.acfield'); if (!response.ok) throw new Error('Could not open the example field.');
                loaded = decodeSnapshot(await response.arrayBuffer());
            }
            if (version !== loadVersion) return;
            snapshot = loaded; localId = source === 'local' ? id : null; cloudId = source === 'cloud' ? id : null;
            $('name').value = loaded.meta.name;
            for (const key of controlIds) {
                const input = $(key), value = loaded.meta.view?.controls?.[key] ?? defaults[key];
                if (input.type === 'checkbox') input.checked = typeof value === 'boolean' ? value : defaults[key];
                else if (input.tagName === 'SELECT') input.value = [...input.options].some(o => o.value === String(value)) ? value : defaults[key];
                else if (input.type === 'range') input.value = Number.isFinite(Number(value)) ? Math.max(+input.min,Math.min(+input.max,+value)) : defaults[key];
                else input.value = /^#[0-9a-f]{6}$/i.test(value) ? value : defaults[key];
            }
            if (!loaded.meta.view) for (let i = 0; i < 3; i++) $(`level${i}`).value = loaded.meta.levels[i];
            resetView();
            const validVector = v => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n)<1000);
            if (validVector(loaded.meta.view?.camera) && validVector(loaded.meta.view?.target)) {
                camera.position.set(...loaded.meta.view.camera); controls.target.set(...loaded.meta.view.target);
                if (camera.position.distanceTo(controls.target)<0.1) resetView(); else controls.update();
            }
            const c = loaded.meta.config;
            $('fieldInfo').textContent = `${c.shape} · ${c.length} × ${c.height} × ${c.depth} m · ${Math.round(c.frequency || 0)} Hz${c.harmonics ? ' + harmonics' : ''} · ${(loaded.meta.time*1000).toFixed(0)} ms captured`;
            $('copyLink').hidden = !cloudId;
            history.replaceState(null,'',source === 'local' ? `?local=${encodeURIComponent(id)}` : source === 'cloud' ? `?id=${encodeURIComponent(id)}` : location.pathname);
            buildOutline(); labels(); rebuild(); populateLibrary();
            if (source === 'file') scheduleSave();
        } catch (error) { if (version === loadVersion) notice(error.message); }
        finally { if (version === loadVersion) $('cloudSave').disabled = $('download').disabled = !snapshot; }
    }

    for (const id of controlIds) $(id).addEventListener($(id).type === 'checkbox' || $(id).tagName === 'SELECT' ? 'change' : 'input',() => {
        if (id === 'mode') $('opacity').value = $('mode').value === 'surfaces' ? 0.35 : 0.85;
        materialUpdate(); scheduleSave();
        const geometryChange = ['mode','axis','slices','count','steps','twist','radius','smoothing'].includes(id) || /^(level|enabled)/.test(id);
        if (geometryChange && !(activeMode === 'mist' && $('mode').value === 'mist' && id !== 'smoothing')) scheduleBuild();
    });
    $('name').addEventListener('input',scheduleSave);
    $('resetView').addEventListener('click',() => { resetView(); scheduleSave(); });
    $('library').addEventListener('change',() => { const [source,id] = $('library').value.split(':'); openField(source,id); });
    $('refresh').addEventListener('click',() => refreshLibrary()); $('more').addEventListener('click',() => refreshLibrary(true));
    $('import').addEventListener('click',() => $('file').click());
    $('file').addEventListener('change',async () => {
        const file = $('file').files[0]; if (!file) return;
        try { if (file.size>MAX_SNAPSHOT_BYTES) throw new Error('Snapshot exceeds 16 MiB.'); await openField('file',decodeSnapshot(await file.arrayBuffer())); }
        catch (error) { notice(error.message); } finally { $('file').value = ''; }
    });
    $('download').addEventListener('click',() => { if (snapshot) downloadSnapshot(currentSnapshot()); });
    $('cloudSave').addEventListener('click',() => { if (!snapshot) return; $('saveMessage').textContent = ''; $('saveDialog').showModal(); });
    $('cancelSave').addEventListener('click',() => $('saveDialog').close());
    $('saveForm').addEventListener('submit',async event => {
        event.preventDefault(); $('confirmSave').disabled = true; $('saveMessage').textContent = 'Saving…';
        const copy = currentSnapshot(), version = loadVersion;
        try {
            const result = await (await cloudRequest('',{ method:'POST',headers:{'Content-Type':'application/octet-stream','x-admin-password':$('password').value},body:encodeSnapshot(copy) })).json();
            $('password').value = ''; $('saveDialog').close();
            if (version !== loadVersion) return;
            cloudId = result.id; history.replaceState(null,'',`?id=${encodeURIComponent(cloudId)}`); $('copyLink').hidden = false;
            notice('Saved to R2. Copy the link to open this view on another device.'); scheduleSave(); await refreshLibrary();
        } catch (error) { $('saveMessage').textContent = error.message; }
        finally { $('confirmSave').disabled = false; }
    });
    $('copyLink').addEventListener('click',async () => {
        try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?id=${encodeURIComponent(cloudId)}`); notice('Saved field link copied.'); }
        catch { notice('Copy the saved field address from your browser’s address bar.'); }
    });
    function resize() {
        dirty = true;
        renderer.setSize(innerWidth,innerHeight); camera.aspect = innerWidth/innerHeight;
        camera.setViewOffset(innerWidth,innerHeight,!panelHidden && innerWidth>=760 ? 165 : 0,0,innerWidth,innerHeight); camera.updateProjectionMatrix();
    }
    function panel() { $('panel').hidden = panelHidden; $('panelToggle').textContent = panelHidden ? 'Show controls' : 'Hide controls'; $('panelToggle').setAttribute('aria-expanded',String(!panelHidden)); resize(); }
    $('panelToggle').addEventListener('click',() => { panelHidden = !panelHidden; panel(); });
    window.addEventListener('resize',resize);
    window.addEventListener('pagehide',() => { worker?.terminate(); clearTimeout(buildTimer); clearTimeout(saveTimer); });
    let lastFrame = 0;
    function animate(now) {
        requestAnimationFrame(animate); if (document.hidden || now-lastFrame<1000/30) return; lastFrame = now;
        const moved = controls.update();
        if (dirty || moved) { renderer.render(scene,camera); dirty = false; }
    }
    panel(); requestAnimationFrame(animate);
    const params = new URLSearchParams(location.search);
    openField(params.has('id') ? 'cloud' : params.has('local') ? 'local' : 'demo',params.get('id') || params.get('local'));
    refreshLibrary();
}
try { boot(); } catch (error) { notice(`Could not open Field Studio. ${error.message}`); }
