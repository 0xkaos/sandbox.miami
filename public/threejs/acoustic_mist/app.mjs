import * as THREE from 'three';
import { OrbitControls } from '../acoustic_chamber/vendor/OrbitControls.js';
import { configure, SOUND_SPEED } from '../acoustic_chamber/physics.mjs?v=5';
import { saveLocal, downloadSnapshot } from '../acoustic_chamber/snapshot-store.mjs';
import { vertexShader, createMistFragment } from '../acoustic_field/mist.mjs';
import { MIST_DEFAULTS } from './model.mjs';
import { makeGuides, disposeGuide } from './guides.mjs';

const $ = id => document.getElementById(id);
const QUALITY = { light:{ steps:96, pixelRatio:0.8 }, balanced:{ steps:144, pixelRatio:1.25 }, fine:{ steps:224, pixelRatio:1.5 } };
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }

function boot() {
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ antialias:false, powerPreference:'high-performance' });
        if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 is required.');
    } catch { $('unsupported').hidden = false; notice(); return; }
    renderer.setClearColor(0x090e13); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
    $('scene').append(renderer.domElement);
    if (innerWidth < 760) $('quality').value = 'light';
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, innerWidth/innerHeight, 0.02, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.065; controls.minDistance = 0.3; controls.maxDistance = 50; controls.autoRotateSpeed = 0.35;
    const worker = new Worker(new URL('./simulation.mjs', import.meta.url), { type:'module' });
    let config = configure(MIST_DEFAULTS), meta, volume, texture, guides, pixels, recycledBuffer;
    let generation = 0, ready = false, inFlight = false, pendingRefresh = false, paused = false, capturing = false;
    let activity = 0, dirty = true, panelHidden = innerWidth < 760, pendingRebuild, loadTimeout;
    let lastSubmit = performance.now(), lastDraw = 0, lastClock = 0;

    function readConfig() {
        return configure({ ...config, shape:$('shape').value, length:+$('length').value, height:+$('height').value, depth:+$('depth').value,
            frequency:+$('frequency').value, amplitude:+$('amplitude').value/100, reflection:+$('reflection').value/100,
            harmonics:$('harmonics').checked, harmonic2:+$('harmonic2').value/100, harmonic3:+$('harmonic3').value/100, harmonic4:+$('harmonic4').value/100,
            opening:$('opening').checked, openingSize:+$('openingSize').value, resolution:+$('resolution').value, slow:+$('slow').value, drive:$('drive').value });
    }
    function labels() {
        $('frequency').max = config.maxFundamental; $('frequency').value = config.frequency;
        $('frequencyLabel').textContent = config.harmonics ? 'Fundamental' : 'Frequency'; $('frequencyValue').textContent = `${Math.round(config.frequency)} Hz`;
        $('harmonicControls').hidden = !config.harmonics;
        for (let n = 2; n <= 4; n++) {
            $(`harmonic${n}Frequency`).textContent = `${n}× · ${Math.round(config.frequency*n)} Hz`;
            $(`harmonic${n}Value`).textContent = `${$(`harmonic${n}`).value}%`;
        }
        $('frequencyHint').textContent = config.harmonics
            ? `${config.partials.map(p => Math.round(p.multiple*config.frequency)).join(' + ')} Hz. Mix normalized; fundamental limited to ${config.maxFundamental} Hz at this field detail.`
            : `Wavelength ${(SOUND_SPEED/config.frequency).toFixed(2)} m. Up to ${config.maxFrequency} Hz at this field detail.`;
        for (const id of ['length','height','depth']) $(`${id}Value`).textContent = `${config[id].toFixed(1)} m`;
        for (const id of ['amplitude','reflection']) $(`${id}Value`).textContent = `${$(id).value}%`;
        $('decayHint').textContent = config.reflection === 1 ? 'Perfectly reflecting walls. Gentle loss in the medium still applies.'
            : `About ${Number((config.reflection**2*100).toFixed(1))}% pressure amplitude after two head-on reflections, before loss in the medium.`;
        $('openingSize').disabled = !config.opening;
        $('openingSize').max = Math.min(config.height*(config.shape === 'taper' ? 0.58 : 0.92), config.depth*0.92).toFixed(2);
        $('openingSize').value = config.openingSize; $('openingSizeValue').textContent = `${config.openingSize.toFixed(2)} m`;
        for (const id of ['bandWidth','density','smoothing']) $(`${id}Value`).textContent = $(id).value;
        $('opacityValue').textContent = `${Math.round(+$('opacity').value*100)}%`;
        for (let i = 0; i < 3; i++) $(`level${i}Value`).textContent = `${Number($(`level${i}`).value).toFixed(2)}×`;
        $('cut').disabled = $('cutAxis').value === '-1'; $('cutValue').textContent = `${$('cut').value}%`;
    }
    function updateView() {
        labels(); dirty = true; controls.autoRotate = $('rotate').checked;
        if (guides) { guides.chamber.visible = $('outline').checked; guides.horn.visible = $('showHorn').checked; }
        if (!volume) return;
        const u = volume.material.uniforms;
        u.uLevels.value.set(...[0,1,2].map(i => +$(`level${i}`).value));
        u.uEnabled.value.set(...[0,1,2].map(i => Number($(`enabled${i}`).checked)));
        for (let i = 0; i < 3; i++) u[`uColor${i}`].value.set($(`color${i}`).value);
        u.uWidth.value = +$('bandWidth').value; u.uDensity.value = +$('density').value;
        u.uOpacity.value = +$('opacity').value*activity;
        const axis = +$('cutAxis').value, c = meta.config, span = [c.length,c.height,c.depth][Math.max(0,axis)];
        u.uCutAxis.value = axis; u.uCut.value = span*(+$('cut').value/100-0.5);
        volume.visible = activity > 0.001 && [0,1,2].some(i => $(`enabled${i}`).checked);
    }
    function buildScene(mask) {
        if (volume) { volume.geometry.dispose(); volume.material.dispose(); volume.removeFromParent(); }
        texture?.dispose(); disposeGuide(guides?.chamber); disposeGuide(guides?.horn);
        guides = makeGuides(meta); scene.add(guides.chamber, guides.horn);
        pixels = new Uint16Array(mask.length*2);
        for (let i = 0; i < mask.length; i++) pixels[i*2+1] = mask[i] === 1 ? 0x3c00 : 0; // half-float 1 / 0
        texture = new THREE.Data3DTexture(pixels, ...meta.dimensions);
        texture.format = THREE.RGFormat; texture.type = THREE.HalfFloatType; texture.unpackAlignment = 1;
        texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
        const min = new THREE.Vector3(...meta.min), max = new THREE.Vector3(...meta.max), size = max.clone().sub(min);
        const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader:createMistFragment(QUALITY[$('quality').value].steps), glslVersion:THREE.GLSL3,
            transparent:true, depthWrite:false, side:THREE.BackSide, uniforms:{
                uField:{value:texture}, uMin:{value:min}, uMax:{value:max}, uEye:{value:camera.position},
                uLevels:{value:new THREE.Vector3()}, uEnabled:{value:new THREE.Vector3()},
                uColor0:{value:new THREE.Color()}, uColor1:{value:new THREE.Color()}, uColor2:{value:new THREE.Color()},
                uWidth:{value:0.045}, uDensity:{value:2.5}, uOpacity:{value:0}, uCutAxis:{value:-1}, uCut:{value:0} } });
        volume = new THREE.Mesh(new THREE.BoxGeometry(size.x,size.y,size.z), material);
        volume.position.copy(min.clone().add(max).multiplyScalar(0.5)); scene.add(volume); updateView();
    }
    function requestFrame(seconds) {
        if (!ready || inFlight) { if (seconds === 0) pendingRefresh = true; return; }
        inFlight = true; pendingRefresh = false; lastSubmit = performance.now();
        const recycle = recycledBuffer; recycledBuffer = null;
        worker.postMessage({ type:'step', generation, seconds, recycle }, recycle ? [recycle] : []);
    }
    function fail(message) {
        ready = false; inFlight = false; capturing = false; clearTimeout(loadTimeout); $('capture').disabled = true;
        notice(`The field stopped. ${message} Reload to try again.`);
    }
    worker.onerror = event => fail(event.message || 'The simulation worker could not load.');
    function rebuild() {
        clearTimeout(pendingRebuild); pendingRebuild = null;
        config = readConfig(); labels(); generation++; ready = inFlight = pendingRefresh = false;
        activity = 0; recycledBuffer = null; $('capture').disabled = true;
        if (volume) volume.visible = false; dirty = true;
        notice('Starting the wave field…'); clearTimeout(loadTimeout);
        loadTimeout = setTimeout(() => fail('The worker did not respond.'), 15000);
        worker.postMessage({ type:'configure', generation, config, smoothing:+$('smoothing').value });
    }
    function captureView() {
        const ids = ['bandWidth','density','opacity','smoothing','cutAxis','cut','outline','rotate',
            'level0','level1','level2','enabled0','enabled1','enabled2','color0','color1','color2'];
        const settings = Object.fromEntries(ids.map(id => [id, $(id).type === 'checkbox' ? $(id).checked : $(id).value]));
        settings.mode = 'mist'; settings.opacity = String(Math.max(0.05, +$('opacity').value*activity));
        return { controls:settings, camera:camera.position.toArray(), target:controls.target.toArray() };
    }
    function capture() {
        // Called only after the outstanding frame arrives, so appearance and field agree.
        const name = $('snapshotName').value.trim() || `Living mist · ${Math.round(config.frequency)} Hz`;
        worker.postMessage({ type:'capture', generation, name, view:captureView() });
    }
    worker.onmessage = async ({ data }) => {
        if (data.generation !== generation) return;
        if (data.type === 'error') { fail(data.message); return; }
        if (data.type === 'ready') {
            clearTimeout(loadTimeout); meta = data.meta; buildScene(data.mask); ready = true;
            $('capture').disabled = false; notice(); requestFrame(0);
        } else if (data.type === 'frame') {
            inFlight = false; activity = data.activity;
            for (let i = 0; i < data.values.length; i++) pixels[i*2] = THREE.DataUtils.toHalfFloat(Math.min(data.values[i],65504));
            recycledBuffer = data.values.buffer; texture.needsUpdate = true;
            volume.material.uniforms.uOpacity.value = +$('opacity').value*activity;
            volume.visible = activity > 0.001 && [0,1,2].some(i => $(`enabled${i}`).checked); dirty = true;
            if (performance.now()-lastClock > 250 || paused) {
                $('clock').textContent = `${data.time.toFixed(3)} s of wave motion · ${config.slow}× slower`; lastClock = performance.now();
            }
            if (capturing) capture(); else if (pendingRefresh) requestFrame(0);
        } else if (data.type === 'snapshot') {
            try {
                const id = await saveLocal(data.snapshot);
                location.href = `../acoustic_field/?local=${encodeURIComponent(id)}`;
            } catch (error) {
                downloadSnapshot(data.snapshot); capturing = false; $('panel').inert = false; $('pause').disabled = $('restart').disabled = false;
                $('capture').disabled = false; notice(`${error.message} Import the downloaded snapshot in Field Studio.`);
            }
        }
    };
    function tune() {
        config = readConfig(); labels();
        worker.postMessage({ type:'tune', generation, changes:{ frequency:config.frequency, amplitude:config.amplitude, reflection:config.reflection,
            harmonics:config.harmonics, harmonic2:config.harmonic2, harmonic3:config.harmonic3, harmonic4:config.harmonic4, drive:config.drive, slow:config.slow } });
    }
    for (const id of ['frequency','amplitude','reflection','harmonic2','harmonic3','harmonic4']) $(id).addEventListener('input', tune);
    for (const id of ['harmonics','slow']) $(id).addEventListener('change', tune);
    function updatePause() {
        $('pause').textContent = paused ? 'Resume' : 'Pause'; $('pause').setAttribute('aria-pressed', String(paused)); lastSubmit = performance.now();
    }
    function burst() {
        $('drive').value = 'burst'; config.drive = 'burst'; worker.postMessage({ type:'burst', generation });
        paused = false; updatePause();
    }
    $('drive').addEventListener('change', () => { tune(); if (config.drive === 'burst') burst(); });
    $('burst').addEventListener('click', burst);
    for (const id of ['length','height','depth','openingSize']) $(id).addEventListener('input', () => {
        config = readConfig(); labels(); $('capture').disabled = true;
        clearTimeout(pendingRebuild); pendingRebuild = setTimeout(rebuild,180);
    });
    for (const id of ['shape','opening','resolution']) $(id).addEventListener('change', rebuild);
    for (const id of ['bandWidth','density','opacity','cut','level0','level1','level2','color0','color1','color2']) $(id).addEventListener('input', updateView);
    for (const id of ['cutAxis','outline','showHorn','rotate','enabled0','enabled1','enabled2']) $(id).addEventListener('change', updateView);
    $('smoothing').addEventListener('input', () => {
        labels(); worker.postMessage({ type:'smoothing', generation, value:+$('smoothing').value }); requestFrame(0);
    });
    function resize() {
        renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[$('quality').value].pixelRatio)); renderer.setSize(innerWidth,innerHeight);
        camera.aspect = innerWidth/innerHeight; camera.setViewOffset(innerWidth,innerHeight,!panelHidden && innerWidth>=760 ? 165 : 0,0,innerWidth,innerHeight);
        camera.updateProjectionMatrix(); dirty = true;
    }
    $('quality').addEventListener('change', () => {
        if (volume) { volume.material.fragmentShader = createMistFragment(QUALITY[$('quality').value].steps); volume.material.needsUpdate = true; }
        resize();
    });
    function resetView() {
        const size = Math.max(config.length,config.height,config.depth), framing = Math.max(1,1/camera.aspect);
        controls.target.set(0,0,0); camera.position.set(size*1.2,size*0.65,size*1.45).multiplyScalar(framing); controls.update(); dirty = true;
    }
    function panel() {
        $('panel').hidden = panelHidden; $('panelToggle').textContent = panelHidden ? 'Show controls' : 'Hide controls';
        $('panelToggle').setAttribute('aria-expanded',String(!panelHidden)); resize();
    }
    $('panelToggle').addEventListener('click', () => { panelHidden = !panelHidden; panel(); });
    $('resetView').addEventListener('click', resetView);
    $('pause').addEventListener('click', () => { paused = !paused; updatePause(); });
    $('restart').addEventListener('click', rebuild);
    $('capture').addEventListener('click', () => {
        if (!ready || capturing) return;
        paused = capturing = true; updatePause(); clearTimeout(pendingRebuild);
        $('panel').inert = true; $('capture').disabled = $('pause').disabled = $('restart').disabled = true;
        notice('Saving the field…'); if (!inFlight) capture();
    });
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => { lastSubmit = performance.now(); dirty = true; });
    window.addEventListener('pageshow', event => {
        if (!event.persisted) return;
        // Returning from Studio should leave a usable, paused chamber in bfcache.
        capturing = false; $('panel').inert = false; $('pause').disabled = $('restart').disabled = false;
        $('capture').disabled = !ready; if (ready) notice(); lastSubmit = performance.now(); dirty = true;
    });
    renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); fail('The graphics context was lost.'); });
    window.addEventListener('pagehide', event => {
        if (event.persisted) return;
        worker.terminate(); clearTimeout(pendingRebuild); clearTimeout(loadTimeout);
    });
    function animate(now) {
        requestAnimationFrame(animate); if (document.hidden) return;
        if (!paused && now-lastSubmit >= 1000/30) requestFrame(Math.min((now-lastSubmit)/1000,0.05));
        if (now-lastDraw < 1000/30) return;
        lastDraw = now; const moved = controls.update();
        if (dirty || moved) { renderer.render(scene,camera); dirty = false; }
    }
    panel(); resetView(); rebuild(); requestAnimationFrame(animate);
}
try { boot(); } catch (error) { notice(`Could not start Living Mist. ${error.message}`); }
