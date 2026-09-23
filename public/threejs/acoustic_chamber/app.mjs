import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { DEFAULTS, configure, SOUND_SPEED } from './physics.mjs?v=1';
import { volumeVertex, volumeFragment, sliceFragment, particleVertex, particleFragment } from './field-shaders.mjs?v=1';

const $ = id => document.getElementById(id);
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }

function boot() {
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 is required.');
    } catch (error) { $('unsupported').hidden = false; notice(); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(innerWidth, innerHeight);
    renderer.setClearColor(0x090e13);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    $('scene').append(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, 0.02, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.minDistance = 1;
    controls.maxDistance = 22;
    scene.add(new THREE.HemisphereLight(0xc2e2ec, 0x172025, 2.2));
    const key = new THREE.DirectionalLight(0xffd6aa, 3);
    key.position.set(1, 5, 4); scene.add(key);
    const fill = new THREE.DirectionalLight(0x90bdcd, 1.2);
    fill.position.set(-5, 2, -4); scene.add(fill);
    const chamber = new THREE.Group(); scene.add(chamber);
    const grid = new THREE.GridHelper(18, 72, 0x32434a, 0x1d2b32);
    grid.material.transparent = true; grid.material.opacity = 0.28; grid.material.depthWrite = false;
    scene.add(grid);

    let config = configure(DEFAULTS), meta, fieldTexture, volume, slice, points, hornFace;
    let generation = 0, ready = false, inFlight = false, refreshPending = false, paused = false, acousticTime = 0;
    let lastSubmit = performance.now(), pendingRebuild, pendingCount, loadTimeout;
    let panelHidden = innerWidth < 760, sourcePulseTime = 0;
    const worker = new Worker(new URL('./simulation.mjs?v=1', import.meta.url), { type: 'module' });

    function fail(message) {
        ready = false; inFlight = false;
        clearTimeout(loadTimeout);
        notice(`The simulation stopped. ${message} Reload the page to try again.`);
    }
    worker.onerror = event => fail(event.message || 'The simulation worker could not load.');

    function readControls() {
        return configure({ shape: $('shape').value, length: +$('length').value, height: +$('height').value, depth: +$('depth').value,
            frequency: +$('frequency').value, amplitude: +$('amplitude').value / 100, reflection: +$('reflection').value / 100,
            opening: $('opening').checked, openingSize: +$('openingSize').value, count: +$('count').value,
            mobility: +$('mobility').value / 100, drive: $('drive').value, resolution: +$('resolution').value,
            slow: +$('slow').value, seed: config.seed });
    }

    function updateLabels() {
        for (const id of ['length', 'height', 'depth']) $(`${id}Value`).textContent = `${Number($(id).value).toFixed(1)} m`;
        $('frequencyValue').textContent = `${Math.round(config.frequency)} Hz`;
        $('amplitudeValue').textContent = `${$('amplitude').value}%`;
        $('reflectionValue').textContent = `${$('reflection').value}%`;
        $('mobilityValue').textContent = `${$('mobility').value}%`;
        $('countValue').textContent = Number($('count').value).toLocaleString('en');
        $('opacityValue').textContent = `${$('opacity').value}%`;
        $('openingSizeValue').textContent = `${config.openingSize.toFixed(2)} m`;
        $('openingSize').disabled = !config.opening;
        $('openingSize').max = Math.min(config.height * (config.shape === 'taper' ? 0.58 : 0.92), config.depth * 0.92).toFixed(2);
        $('openingSize').value = config.openingSize;
        $('frequency').max = config.maxFrequency;
        $('frequency').value = config.frequency;
        $('wavelength').textContent = `Wavelength ${(SOUND_SPEED / config.frequency).toFixed(2)} m`;
        $('decayHint').textContent = `About ${Math.round(config.reflection ** 2 * 100)}% pressure amplitude after two reflections.`;
        $('resolutionHint').textContent = `Up to ${config.maxFrequency} Hz at this size and detail. Higher detail resolves shorter wavelengths.`;
        $('sourceLabel').replaceChildren(document.createTextNode('HORN'));
        const frequency = document.createElement('span'); frequency.textContent = `${Math.round(config.frequency)} Hz`; $('sourceLabel').append(frequency);
        $('portLabel').textContent = config.opening ? `OPEN · Ø ${config.openingSize.toFixed(2)} m` : 'CLOSED WALL';
    }

    function disposeObject(object) {
        object.traverse(child => {
            child.geometry?.dispose();
            if (child.material) (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => material.dispose());
        });
        object.removeFromParent();
    }

    function addWall(geometry) {
        const material = new THREE.MeshBasicMaterial({ color: 0x7dabb8, transparent: true, opacity: 0.027, side: THREE.DoubleSide, depthWrite: false });
        const wall = new THREE.Mesh(geometry, material); wall.renderOrder = 2; chamber.add(wall);
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 24),
            new THREE.LineBasicMaterial({ color: 0x76a0ad, transparent: true, opacity: 0.32, depthWrite: false }));
        edge.renderOrder = 2; chamber.add(edge);
        return wall;
    }

    function cap(at, height, holeRadius) {
        const config = meta.config;
        const shape = new THREE.Shape(), w = config.depth / 2, h = height / 2;
        if (config.shape === 'cylinder') shape.absellipse(0, 0, w, h, 0, Math.PI * 2, false);
        else { shape.moveTo(-w, -h); shape.lineTo(w, -h); shape.lineTo(w, h); shape.lineTo(-w, h); shape.closePath(); }
        if (holeRadius) {
            const hole = new THREE.Path(); hole.absarc(0, 0, holeRadius, 0, Math.PI * 2, true); shape.holes.push(hole);
        }
        const geometry = new THREE.ShapeGeometry(shape, 64);
        geometry.rotateY(-Math.PI / 2); geometry.translate(at, 0, 0); addWall(geometry);
    }

    function buildChamber() {
        const config = meta.config;
        for (const child of [...chamber.children]) disposeObject(child);
        const { length: l, height: h, depth: d } = config;
        const rightHeight = config.shape === 'taper' ? h * 0.6 : h;
        if (config.shape === 'cylinder') {
            const side = new THREE.CylinderGeometry(1, 1, l, 64, 1, true);
            side.rotateZ(-Math.PI / 2); side.scale(1, h / 2, d / 2); addWall(side);
            const guides = [];
            for (let i = 0; i < 8; i++) {
                const angle = i * Math.PI / 4;
                guides.push(-l / 2, Math.sin(angle) * h / 2, Math.cos(angle) * d / 2, l / 2, Math.sin(angle) * h / 2, Math.cos(angle) * d / 2);
            }
            const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(guides, 3));
            chamber.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x76a0ad, transparent: true, opacity: 0.16 })));
        } else {
            const p = [[-l/2,-h/2,-d/2],[-l/2,h/2,-d/2],[-l/2,h/2,d/2],[-l/2,-h/2,d/2],
                [l/2,-rightHeight/2,-d/2],[l/2,rightHeight/2,-d/2],[l/2,rightHeight/2,d/2],[l/2,-rightHeight/2,d/2]];
            const positions = [];
            for (let i = 0; i < 4; i++) {
                const next = (i + 1) % 4;
                for (const index of [i, next, next + 4, i, next + 4, i + 4]) positions.push(...p[index]);
            }
            const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geometry.computeVertexNormals(); addWall(geometry);
        }
        cap(-l / 2, h, meta.hornRadius);
        cap(l / 2, rightHeight, config.opening ? config.openingSize / 2 : 0);

        const hornLength = Math.min(h, d) * 0.32, mouth = meta.hornRadius;
        const profile = [];
        for (let i = 0; i <= 22; i++) {
            const t = i / 22;
            profile.push(new THREE.Vector2(mouth * (0.18 + 0.82 * t ** 2.1), -hornLength + hornLength * t));
        }
        const hornGeometry = new THREE.LatheGeometry(profile, 64);
        hornGeometry.rotateZ(-Math.PI / 2); hornGeometry.translate(-l / 2, 0, 0);
        const horn = new THREE.Mesh(hornGeometry, new THREE.MeshStandardMaterial({ color: 0xa27146, metalness: 0.62, roughness: 0.36, side: THREE.DoubleSide }));
        chamber.add(horn);
        const rimGeometry = new THREE.TorusGeometry(mouth, mouth * 0.035, 8, 64);
        rimGeometry.rotateY(Math.PI / 2); rimGeometry.translate(-l / 2 + 0.004, 0, 0);
        chamber.add(new THREE.Mesh(rimGeometry, new THREE.MeshStandardMaterial({ color: 0xc39764, roughness: 0.3, metalness: 0.6 })));
        const diaphragmGeometry = new THREE.CircleGeometry(mouth * 0.18, 40);
        diaphragmGeometry.rotateY(Math.PI / 2); diaphragmGeometry.translate(-l / 2 - hornLength, 0, 0);
        hornFace = new THREE.Mesh(diaphragmGeometry, new THREE.MeshBasicMaterial({ color: 0xe2b878, side: THREE.DoubleSide }));
        chamber.add(hornFace);
        if (config.opening) {
            const rim = new THREE.TorusGeometry(config.openingSize / 2, 0.009, 8, 64);
            rim.rotateY(Math.PI / 2); rim.translate(l / 2 + 0.005, 0, 0);
            chamber.add(new THREE.Mesh(rim, new THREE.MeshBasicMaterial({ color: 0xa2d0d2, transparent: true, opacity: 0.7 })));
        }
        grid.position.y = -h / 2 - 0.18;
    }

    function buildField() {
        if (volume) disposeObject(volume);
        if (slice) disposeObject(slice);
        fieldTexture?.dispose();
        fieldTexture = new THREE.Data3DTexture(new Uint8Array(meta.dimensions.reduce((a, b) => a * b, 4)), ...meta.dimensions);
        fieldTexture.format = THREE.RGBAFormat;
        fieldTexture.type = THREE.UnsignedByteType;
        fieldTexture.minFilter = fieldTexture.magFilter = THREE.LinearFilter;
        fieldTexture.unpackAlignment = 1;
        fieldTexture.needsUpdate = true;
        const min = new THREE.Vector3(...meta.min), max = new THREE.Vector3(...meta.max);
        const size = max.clone().sub(min), center = max.clone().add(min).multiplyScalar(0.5);
        const uniforms = { uField: { value: fieldTexture }, uMin: { value: min }, uMax: { value: max }, uEye: { value: camera.position }, uOpacity: { value: +$('opacity').value / 100 } };
        volume = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.ShaderMaterial({
            vertexShader: volumeVertex, fragmentShader: volumeFragment, uniforms, glslVersion: THREE.GLSL3,
            side: THREE.BackSide, transparent: true, depthWrite: false,
        }));
        volume.position.copy(center); scene.add(volume);
        slice = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.y), new THREE.ShaderMaterial({
            vertexShader: volumeVertex, fragmentShader: sliceFragment, uniforms, glslVersion: THREE.GLSL3,
            side: THREE.DoubleSide, transparent: true, depthWrite: false,
        }));
        slice.position.copy(center); slice.position.z = 0; scene.add(slice);
        setDisplay();
    }

    function updateParticles(positions, colors) {
        if (!points || points.geometry.attributes.position.array.length !== positions.length) {
            if (points) disposeObject(points);
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions.length), 3).setUsage(THREE.DynamicDrawUsage));
            geometry.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(colors.length), 3, true).setUsage(THREE.DynamicDrawUsage));
            points = new THREE.Points(geometry, new THREE.ShaderMaterial({ vertexShader: particleVertex, fragmentShader: particleFragment,
                uniforms: { uPixelRatio: { value: renderer.getPixelRatio() } }, transparent: true, depthWrite: false }));
            points.frustumCulled = false; points.renderOrder = 1; scene.add(points);
        }
        points.geometry.attributes.position.array.set(positions); points.geometry.attributes.position.needsUpdate = true;
        points.geometry.attributes.color.array.set(colors); points.geometry.attributes.color.needsUpdate = true;
        points.visible = true;
    }

    function setDisplay() {
        if (!volume) return;
        volume.visible = $('display').value === 'volume';
        slice.visible = $('display').value === 'slice';
        volume.material.uniforms.uOpacity.value = +$('opacity').value / 100;
    }

    function resize() {
        renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        renderer.setSize(innerWidth, innerHeight);
        camera.aspect = innerWidth / innerHeight;
        camera.setViewOffset(innerWidth, innerHeight, !panelHidden && innerWidth >= 760 ? 150 : 0, 0, innerWidth, innerHeight);
        camera.updateProjectionMatrix();
        if (points) points.material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    }
    function resetView() {
        const size = Math.max(config.length, config.height, config.depth);
        const framing = Math.max(1, 0.95 / camera.aspect);
        controls.target.set(0, -config.height * 0.03, 0);
        controls.maxDistance = Math.max(22, size * 7);
        camera.position.set(size * 1.24, size * 0.88, size * 1.48).multiplyScalar(framing);
        controls.update();
    }
    function panel() {
        $('panel').hidden = panelHidden;
        $('panelToggle').textContent = panelHidden ? 'Show controls' : 'Hide controls';
        $('panelToggle').setAttribute('aria-expanded', String(!panelHidden));
        resize();
    }

    function requestFrame(seconds) {
        if (!ready || inFlight) { if (seconds === 0) refreshPending = true; return; }
        refreshPending = false;
        inFlight = true; lastSubmit = performance.now();
        worker.postMessage({ type: 'step', generation, seconds });
    }
    function rebuild() {
        clearTimeout(pendingRebuild);
        config = readControls(); updateLabels();
        ready = false; inFlight = false; refreshPending = false; generation++;
        if (points) points.visible = false;
        notice('Rebuilding the chamber…');
        clearTimeout(loadTimeout);
        loadTimeout = setTimeout(() => fail('The worker did not respond.'), 15000);
        worker.postMessage({ type: 'configure', generation, config });
    }
    worker.onmessage = ({ data }) => {
        if (data.generation !== generation) return;
        if (data.type === 'error') { fail(data.message); return; }
        if (data.type === 'ready') {
            clearTimeout(loadTimeout);
            meta = data.meta;
            acousticTime = sourcePulseTime = 0;
            buildChamber(); buildField();
            updateLabels(); ready = true;
            notice(); requestFrame(0);
        } else if (data.type === 'frame') {
            inFlight = false;
            fieldTexture.image.data = data.volume;
            fieldTexture.needsUpdate = true;
            updateParticles(data.positions, data.colors);
            acousticTime = data.time;
            if (refreshPending) requestFrame(0);
        }
    };

    function tune() {
        config = readControls(); updateLabels();
        worker.postMessage({ type: 'tune', generation, changes: { frequency: config.frequency, amplitude: config.amplitude,
            reflection: config.reflection, mobility: config.mobility, drive: config.drive, slow: config.slow } });
    }
    for (const id of ['length', 'height', 'depth', 'openingSize']) $(id).addEventListener('input', () => {
        config = readControls(); updateLabels();
        clearTimeout(pendingRebuild); pendingRebuild = setTimeout(rebuild, 180);
    });
    for (const id of ['shape', 'opening', 'resolution']) $(id).addEventListener('change', rebuild);
    for (const id of ['frequency', 'amplitude', 'reflection', 'mobility', 'slow']) $(id).addEventListener('input', tune);
    $('drive').addEventListener('change', () => { tune(); if (config.drive === 'burst') sendBurst(); });
    function sendBurst() {
        $('drive').value = 'burst'; config.drive = 'burst'; sourcePulseTime = acousticTime;
        worker.postMessage({ type: 'burst', generation });
        if (paused) { paused = false; updatePause(); }
    }
    $('burst').addEventListener('click', sendBurst);
    function reseed() {
        clearTimeout(pendingCount);
        config.count = +$('count').value; config.seed++;
        worker.postMessage({ type: 'particles', generation, count: config.count, seed: config.seed });
        if (paused) requestFrame(0);
    }
    $('count').addEventListener('input', () => { updateLabels(); clearTimeout(pendingCount); pendingCount = setTimeout(reseed, 150); });
    $('reseed').addEventListener('click', reseed);
    $('display').addEventListener('change', setDisplay);
    $('opacity').addEventListener('input', () => { updateLabels(); setDisplay(); });
    $('resetView').addEventListener('click', resetView);
    $('panelToggle').addEventListener('click', () => { panelHidden = !panelHidden; panel(); });
    function updatePause() {
        $('pause').textContent = paused ? 'Resume' : 'Pause';
        $('pause').setAttribute('aria-pressed', String(paused)); lastSubmit = performance.now();
    }
    $('pause').addEventListener('click', () => { paused = !paused; updatePause(); });
    $('clear').addEventListener('click', rebuild);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => { lastSubmit = performance.now(); });
    window.addEventListener('pagehide', event => {
        if (event.persisted) return;
        worker.terminate(); clearTimeout(pendingRebuild); clearTimeout(pendingCount); clearTimeout(loadTimeout);
    });

    const labelPosition = new THREE.Vector3();
    function positionLabel(element, x, y, z) {
        labelPosition.set(x, y, z).project(camera);
        const sx = (labelPosition.x + 1) * innerWidth / 2, sy = (1 - labelPosition.y) * innerHeight / 2;
        element.style.left = `${sx}px`; element.style.top = `${sy}px`;
        element.style.opacity = labelPosition.z < 1 && sx > 40 && sx < innerWidth - (panelHidden ? 40 : 330) && sy > 75 && sy < innerHeight - 80 ? '0.8' : '0';
    }
    function render(now) {
        requestAnimationFrame(render);
        if (document.hidden) return;
        controls.update();
        if (!paused && now - lastSubmit > 1000 / 30) requestFrame(Math.min((now - lastSubmit) / 1000, 0.05));
        positionLabel($('sourceLabel'), -config.length / 2 - 0.12, -(meta?.hornRadius ?? 0.4), 0);
        positionLabel($('portLabel'), config.length / 2 + 0.06, -config.height * (config.shape === 'taper' ? 0.34 : 0.53), 0);
        if (hornFace) {
            const emitting = config.drive === 'continuous' || acousticTime - sourcePulseTime < 3 / config.frequency;
            const pulse = emitting ? 0.4 + 0.6 * Math.abs(Math.sin(acousticTime * config.frequency * Math.PI * 2)) : 0.25;
            hornFace.material.color.setRGB(0.75 * pulse, 0.45 * pulse, 0.19 * pulse);
        }
        renderer.render(scene, camera);
    }
    panel(); resetView(); rebuild(); requestAnimationFrame(render);
}

try { boot(); } catch (error) { notice(`Could not start the chamber. ${error.message}`); }
