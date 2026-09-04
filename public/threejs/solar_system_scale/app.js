import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const EPOCH = new Date('2026-01-01T00:00:00Z');
const SPEEDS = [0, 1 / 24, 1, 7, 30, 365];
const SPEED_LABELS = ['Stopped', '1 hour / sec', '1 day / sec', '1 week / sec', '1 month / sec', '1 year / sec'];
const OVERVIEW_POSITION = new THREE.Vector3(2500, 5700, 8800);

const planets = [
  { name:'Mercury', color:0xa9a39a, texture:'mercury.jpg', radius:.0024397, mass:3.301e23, a:57.91, e:.20563, i:7.005, node:48.33, peri:29.12, phase:174.8, period:87.969, rotation:58.646, moons:[] },
  { name:'Venus', color:0xd9b46d, texture:'venus.jpg', radius:.0060518, mass:4.867e24, a:108.21, e:.00677, i:3.395, node:76.68, peri:54.88, phase:50.4, period:224.701, rotation:-243.025, moons:[] },
  { name:'Earth', color:0x5b9bd5, texture:'earth.jpg', radius:.006371, mass:5.972e24, a:149.60, e:.01671, i:.0001, node:-11.26, peri:114.21, phase:357.5, period:365.256, rotation:.9973, moons:[
    { name:'Moon', radius:.0017374, mass:7.342e22, a:.3844, e:.0549, i:5.145, node:125.1, peri:318.1, phase:135.3, period:27.322 }
  ]},
  { name:'Mars', color:0xbf6044, texture:'mars.jpg', radius:.0033895, mass:6.417e23, a:227.92, e:.0934, i:1.85, node:49.56, peri:286.5, phase:19.4, period:686.98, rotation:1.026, moons:[
    { name:'Phobos', radius:.00001127, mass:1.066e16, a:.009376, e:.0151, i:1.093, node:0, peri:150, phase:20, period:.3189 },
    { name:'Deimos', radius:.0000062, mass:1.476e15, a:.023463, e:.00033, i:1.79, node:0, peri:260, phase:170, period:1.263 }
  ]},
  { name:'Jupiter', color:0xd0a477, texture:'jupiter.jpg', radius:.069911, mass:1.898e27, a:778.57, e:.0489, i:1.303, node:100.46, peri:273.87, phase:20.0, period:4332.59, rotation:.414, moons:[
    { name:'Io', radius:.0018216, mass:8.932e22, a:.4217, e:.0041, i:.05, node:43, peri:84, phase:20, period:1.769 },
    { name:'Europa', radius:.0015608, mass:4.800e22, a:.6711, e:.009, i:.47, node:219, peri:88, phase:120, period:3.551 },
    { name:'Ganymede', radius:.0026341, mass:1.482e23, a:1.0704, e:.0013, i:.2, node:63, peri:192, phase:210, period:7.155 },
    { name:'Callisto', radius:.0024103, mass:1.076e23, a:1.8827, e:.0074, i:.28, node:298, peri:52, phase:300, period:16.689 }
  ]},
  { name:'Saturn', color:0xd8c08d, texture:'saturn.jpg', radius:.058232, mass:5.683e26, a:1433.53, e:.0565, i:2.485, node:113.67, peri:339.39, phase:317, period:10759.2, rotation:.444, rings:true, moons:[
    { name:'Mimas', radius:.0001982, mass:3.749e19, a:.18554, e:.0196, i:1.57, node:173, peri:332, phase:70, period:.942 },
    { name:'Enceladus', radius:.0002521, mass:1.080e20, a:.23804, e:.0047, i:.02, node:0, peri:90, phase:120, period:1.37 },
    { name:'Tethys', radius:.0005311, mass:6.174e20, a:.29467, e:.0001, i:1.09, node:0, peri:180, phase:180, period:1.888 },
    { name:'Dione', radius:.0005614, mass:1.095e21, a:.3774, e:.0022, i:.03, node:0, peri:250, phase:230, period:2.737 },
    { name:'Rhea', radius:.0007638, mass:2.307e21, a:.5271, e:.001, i:.35, node:0, peri:20, phase:280, period:4.518 },
    { name:'Titan', radius:.0025747, mass:1.345e23, a:1.22187, e:.0288, i:.35, node:29, peri:186, phase:320, period:15.945 },
    { name:'Iapetus', radius:.0007345, mass:1.806e21, a:3.56082, e:.0286, i:15.47, node:81, peri:275, phase:30, period:79.321 }
  ]},
  { name:'Uranus', color:0x9fd9df, texture:'uranus.jpg', radius:.025362, mass:8.681e25, a:2872.46, e:.0463, i:.773, node:74.01, peri:96.99, phase:142, period:30688.5, rotation:-.718, moons:[
    { name:'Miranda', radius:.0002358, mass:6.59e19, a:.1299, e:.0013, i:4.34, node:326, peri:68, phase:20, period:1.413 },
    { name:'Ariel', radius:.0005789, mass:1.353e21, a:.1909, e:.0012, i:.26, node:22, peri:115, phase:95, period:2.52 },
    { name:'Umbriel', radius:.0005847, mass:1.172e21, a:.266, e:.0039, i:.13, node:33, peri:84, phase:160, period:4.144 },
    { name:'Titania', radius:.0007889, mass:3.527e21, a:.4363, e:.0011, i:.08, node:99, peri:285, phase:240, period:8.706 },
    { name:'Oberon', radius:.0007614, mass:3.014e21, a:.5835, e:.0014, i:.07, node:279, peri:104, phase:310, period:13.463 }
  ]},
  { name:'Neptune', color:0x477bd2, texture:'neptune.jpg', radius:.024622, mass:1.024e26, a:4495.06, e:.0095, i:1.77, node:131.78, peri:273.19, phase:256, period:60182, rotation:.671, moons:[
    { name:'Triton', radius:.0013534, mass:2.14e22, a:.35476, e:.000016, i:156.9, node:178, peri:40, phase:60, period:-5.877 },
    { name:'Nereid', radius:.00017, mass:3.1e19, a:5.5134, e:.7507, i:7.09, node:320, peri:280, phase:220, period:360.13 }
  ]},
  { name:'Pluto', type:'Dwarf planet', color:0xc1aa93, texture:'pluto.jpg', radius:.0011883, mass:1.303e22, a:5906.38, e:.2488, i:17.16, node:110.3, peri:113.8, phase:14.5, period:90560, rotation:-6.387, moons:[
    { name:'Charon', radius:.000606, mass:1.586e21, a:.019596, e:.0002, i:.08, node:0, peri:0, phase:130, period:6.387 },
    { name:'Nix', radius:.0000249, mass:4.5e16, a:.048694, e:.002, i:.13, node:0, peri:0, phase:250, period:24.85 },
    { name:'Hydra', radius:.0000254, mass:4.8e16, a:.064738, e:.0059, i:.24, node:0, peri:0, phase:20, period:38.20 }
  ]}
];

const sceneHost = document.querySelector('#scene');
const unsupported = document.querySelector('#unsupported');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance', logarithmicDepthBuffer:true });
} catch (error) {
  unsupported.hidden = false;
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
sceneHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02050a);
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, .00001, 60000);
camera.position.copy(OVERVIEW_POSITION);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = .055;
controls.rotateSpeed = .45;
controls.zoomSpeed = .85;
controls.minDistance = 20;
controls.maxDistance = 20000;

scene.add(new THREE.AmbientLight(0x6b7892, .18));
const sunlight = new THREE.PointLight(0xfff0d4, 3.4, 0, 0);
scene.add(sunlight);

const loading = document.querySelector('#loading');
const loadProgress = document.querySelector('#load-progress');
const manager = new THREE.LoadingManager();
manager.onProgress = (_url, loaded, total) => { loadProgress.style.width = `${Math.max(5, loaded / total * 100)}%`; };
function finishLoading() {
  if (!loading.isConnected) return;
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 850);
}
manager.onLoad = () => setTimeout(finishLoading, 350);
setTimeout(finishLoading, 4500);
const textureLoader = new THREE.TextureLoader(manager);
const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
const textureCache = new Map();

function loadTexture(file) {
  if (textureCache.has(file)) return textureCache.get(file);
  const texture = textureLoader.load(`./assets/textures/${file}`);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  textureCache.set(file, texture);
  return texture;
}

function radialTexture(core = '#fff', edge = 'rgba(255,255,255,0)') {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64,64,0,64,64,64);
  gradient.addColorStop(0, core);
  gradient.addColorStop(.16, core);
  gradient.addColorStop(1, edge);
  context.fillStyle = gradient;
  context.fillRect(0,0,128,128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const locatorMap = radialTexture('#ffffff');
const glowMap = radialTexture('#fff3ba', 'rgba(255,165,40,0)');
const orbitMaterials = [];
const planetObjects = [];
const moonObjects = [];

function solveEccentricAnomaly(meanAnomaly, eccentricity) {
  let eccentricAnomaly = meanAnomaly;
  for (let iteration = 0; iteration < 7; iteration++) {
    eccentricAnomaly -= (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly) /
      (1 - eccentricity * Math.cos(eccentricAnomaly));
  }
  return eccentricAnomaly;
}

function rotateOrbitPosition(vector, body) {
  vector.applyAxisAngle(new THREE.Vector3(0,1,0), (body.peri || 0) * DEG);
  vector.applyAxisAngle(new THREE.Vector3(1,0,0), (body.i || 0) * DEG);
  vector.applyAxisAngle(new THREE.Vector3(0,1,0), (body.node || 0) * DEG);
  return vector;
}

function orbitalPosition(body, elapsedDays, target = new THREE.Vector3()) {
  const direction = body.period < 0 ? -1 : 1;
  const mean = ((body.phase || 0) * DEG + direction * elapsedDays / Math.abs(body.period) * TAU) % TAU;
  const eccentric = solveEccentricAnomaly(mean, body.e || 0);
  target.set(
    body.a * (Math.cos(eccentric) - (body.e || 0)),
    0,
    body.a * Math.sqrt(1 - (body.e || 0) ** 2) * Math.sin(eccentric)
  );
  return rotateOrbitPosition(target, body);
}

function createOrbitLine(body, color, linewidth = 1.05, opacity = .3, segments = 360) {
  const positions = [];
  for (let index = 0; index <= segments; index++) {
    const eccentric = index / segments * TAU;
    const point = new THREE.Vector3(
      body.a * (Math.cos(eccentric) - (body.e || 0)),
      0,
      body.a * Math.sqrt(1 - (body.e || 0) ** 2) * Math.sin(eccentric)
    );
    rotateOrbitPosition(point, body);
    positions.push(point.x, point.y, point.z);
  }
  const geometry = new LineGeometry();
  geometry.setPositions(positions);
  const material = new LineMaterial({
    color,
    linewidth,
    transparent:true,
    opacity,
    depthWrite:false,
    alphaToCoverage:true,
    worldUnits:false,
    resolution:new THREE.Vector2(innerWidth, innerHeight)
  });
  const line = new Line2(geometry, material);
  line.computeLineDistances();
  orbitMaterials.push(material);
  return line;
}

function createLocator(color) {
  const material = new THREE.SpriteMaterial({ map:locatorMap, color, transparent:true, opacity:.92, depthWrite:false, blending:THREE.AdditiveBlending });
  const sprite = new THREE.Sprite(material);
  sprite.userData.isLocator = true;
  return sprite;
}

function moonLineWeight(mass, maximumMass) {
  const relativeMass = Math.sqrt(mass / maximumMass);
  return {
    linewidth:.55 + relativeMass * 1.9,
    opacity:.3 + relativeMass * .4
  };
}

function createMoon(moon, planetObject, maximumMoonMass) {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(moon.radius, 24, 16);
  const material = new THREE.MeshStandardMaterial({ map:loadTexture('moon.jpg'), roughness:.92, metalness:0 });
  const mesh = new THREE.Mesh(geometry, material);
  group.add(mesh);
  const locator = createLocator(0xc8deeb);
  group.add(locator);
  const lineWeight = moonLineWeight(moon.mass, maximumMoonMass);
  const line = createOrbitLine(moon, 0x8fdcef, lineWeight.linewidth, lineWeight.opacity, 220);
  line.userData.baseOpacity = lineWeight.opacity;
  line.visible = false;
  planetObject.group.add(line);
  planetObject.group.add(group);
  const object = { ...moon, group, mesh, locator, line, parent:planetObject, kind:'moon' };
  moonObjects.push(object);
  return object;
}

function createPlanet(data) {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(data.radius, 48, 32);
  const material = new THREE.MeshStandardMaterial({ map:loadTexture(data.texture), roughness:.82, metalness:0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.z = (data.tilt || 0) * DEG;
  group.add(mesh);

  if (data.name === 'Earth') {
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(data.radius * 1.035, 40, 28),
      new THREE.MeshBasicMaterial({ color:0x66aaff, transparent:true, opacity:.13, blending:THREE.AdditiveBlending, side:THREE.BackSide })
    );
    group.add(atmosphere);
  }

  if (data.rings) {
    const ringTexture = loadTexture('saturn-rings.png');
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(data.radius * 1.35, data.radius * 2.35, 128),
      new THREE.MeshBasicMaterial({ map:ringTexture, alphaMap:ringTexture, transparent:true, opacity:.82, side:THREE.DoubleSide, depthWrite:false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = 26.7 * DEG;
    group.add(ring);
  }

  const locator = createLocator(data.color);
  group.add(locator);
  const orbit = createOrbitLine(data, data.color, 1.1, .26, data.e > .15 ? 520 : 420);
  scene.add(orbit);
  scene.add(group);
  const object = { ...data, group, mesh, locator, orbit, kind:'planet', moons:[] };
  locator.userData.body = object;
  const maximumMoonMass = Math.max(1, ...data.moons.map(moon => moon.mass));
  object.moons = data.moons.map(moon => createMoon(moon, object, maximumMoonMass));
  planetObjects.push(object);
  return object;
}

function createSun() {
  const group = new THREE.Group();
  const radius = .6957;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 40),
    new THREE.MeshBasicMaterial({ map:loadTexture('sun.jpg'), color:0xffe0a0 })
  );
  group.add(mesh);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map:glowMap, color:0xffb13b, transparent:true, opacity:.72, blending:THREE.AdditiveBlending, depthWrite:false }));
  glow.scale.setScalar(radius * 12);
  group.add(glow);
  scene.add(group);
  return { name:'Sun', kind:'star', radius, mass:1.9885e30, group, mesh, glow, moons:[] };
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function createDustBelt(inner, outer, count, color, size, seed) {
  const random = seededRandom(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const baseColor = new THREE.Color(color);
  for (let index = 0; index < count; index++) {
    const angle = random() * TAU;
    const radius = THREE.MathUtils.lerp(inner, outer, Math.pow(random(), .8));
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = (random() - .5) * radius * .035;
    positions[index * 3 + 2] = Math.sin(angle) * radius;
    const brightness = .45 + random() * .55;
    colors[index * 3] = baseColor.r * brightness;
    colors[index * 3 + 1] = baseColor.g * brightness;
    colors[index * 3 + 2] = baseColor.b * brightness;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size, vertexColors:true, transparent:true, opacity:.55, depthWrite:false, sizeAttenuation:true });
  scene.add(new THREE.Points(geometry, material));
}

function createStars() {
  const random = seededRandom(90210);
  const count = 12000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const palette = [new THREE.Color(0xb9d9ff), new THREE.Color(0xffffff), new THREE.Color(0xffd6a0)];
  for (let index = 0; index < count; index++) {
    const direction = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize();
    const radius = 14000 + random() * 8000;
    direction.multiplyScalar(radius);
    positions.set([direction.x,direction.y,direction.z], index * 3);
    const starColor = palette[Math.floor(random() * palette.length)].clone().multiplyScalar(.55 + random() * .45);
    colors.set([starColor.r,starColor.g,starColor.b], index * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors,3));
  const material = new THREE.PointsMaterial({ size:5.5, vertexColors:true, transparent:true, opacity:.8, sizeAttenuation:true, depthWrite:false });
  scene.add(new THREE.Points(geometry,material));
}

const sun = createSun();
planets.forEach(createPlanet);
createDustBelt(329, 478, 5000, 0x85929e, .11, 31871);
createDustBelt(4600, 7600, 8500, 0x5b738d, .8, 81421);
createStars();

const planetList = document.querySelector('#planet-list');
planetList.innerHTML = planetObjects.map(body => `
  <button class="body-link" data-body="${body.name}">
    <span class="planet-glyph" style="--color:#${body.color.toString(16).padStart(6,'0')};--size:${body.radius > .02 ? 9 : body.radius > .005 ? 7 : 5}px"></span>
    <b>${body.name}</b><small>${Math.round(body.a)}M</small>
  </button>`).join('');

const objectName = document.querySelector('#object-name');
const objectType = document.querySelector('#object-type');
const objectStats = document.querySelector('#object-stats');
const inspectorNote = document.querySelector('#inspector-note');
const moonKey = document.querySelector('#moon-key');
const dateReadout = document.querySelector('#date-readout');
const timeSpeed = document.querySelector('#time-speed');
const timeLabel = document.querySelector('#time-label');
const playToggle = document.querySelector('#play-toggle');
const orbitToggle = document.querySelector('#orbit-toggle');
const viewHint = document.querySelector('#view-hint');

let elapsedDays = 0;
let speedIndex = 2;
let selected = null;
let orbitsVisible = true;
let travel = null;
let lastTime = performance.now();
let lastDateUpdate = 0;

function formatNumber(value, maximumFractionDigits = 1) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value);
}

function currentDate() {
  return new Date(EPOCH.getTime() + elapsedDays * 86400000);
}

function updateInspector(body) {
  if (!body) {
    objectName.textContent = 'Solar System';
    objectType.textContent = 'One star · eight planets · one dwarf planet';
    objectStats.innerHTML = `
      <div><dt>Outer radius</dt><dd>5,906M km</dd></div>
      <div><dt>Simulation date</dt><dd id="date-readout">${currentDate().toISOString().slice(0,10)}</dd></div>
      <div><dt>Model</dt><dd>Keplerian</dd></div>`;
    inspectorNote.textContent = 'Select a planet to travel to its physical-scale body and satellite system.';
    moonKey.hidden = true;
    return;
  }
  objectName.textContent = body.name;
  objectType.textContent = `${body.type || 'Planet'} · ${body.moons.length} natural satellite${body.moons.length === 1 ? '' : 's'}`;
  objectStats.innerHTML = `
    <div><dt>Radius</dt><dd>${formatNumber(body.radius * 1e6, 0)} km</dd></div>
    <div><dt>Semi-major axis</dt><dd>${formatNumber(body.a, 2)}M km</dd></div>
    <div><dt>Eccentricity</dt><dd>${body.e.toFixed(4)}</dd></div>
    <div><dt>Orbital period</dt><dd>${formatNumber(body.period, 1)} days</dd></div>
    <div><dt>Mass</dt><dd>${body.mass.toExponential(3)} kg</dd></div>`;
  inspectorNote.textContent = body.moons.length ? 'Satellite path weight follows logarithmic moon mass. Paths are revealed only at this local scale.' : 'No known natural satellites are shown for this body.';
  moonKey.hidden = !body.moons.length;
}

function setActiveNav(name) {
  document.querySelectorAll('.body-link').forEach(button => button.classList.toggle('active', button.dataset.body === (name || 'system')));
}

function setOrbitVisibility() {
  planetObjects.forEach(body => {
    body.orbit.visible = orbitsVisible && !selected;
    body.moons.forEach(moon => { moon.line.visible = orbitsVisible && selected === body; });
  });
}

function focusBody(body, immediate = false) {
  if (!body || selected === body) return;
  selected = body;
  history.replaceState(null, '', `${location.pathname}?focus=${encodeURIComponent(body.name)}`);
  setActiveNav(body.name);
  updateInspector(body);
  setOrbitVisibility();
  const moonOrbits = body.moons.map(moon => moon.a * (1 + moon.e)).sort((a,b) => a-b);
  const largestMoonOrbit = Math.max(body.radius * 5, ...moonOrbits);
  const innerMoonOrbit = moonOrbits.length > 1 && moonOrbits.at(-1) > moonOrbits.at(-2) * 4 ? moonOrbits.at(-2) : largestMoonOrbit;
  const focusDistance = Math.max(body.radius * 8, innerMoonOrbit * 2.1);
  const target = body.group.position.clone();
  const offset = new THREE.Vector3(1.15,.62,1).normalize().multiplyScalar(focusDistance);
  if (immediate) {
    camera.position.copy(target).add(offset);
    controls.target.copy(target);
    travel = null;
    controls.enabled = true;
  } else {
    travel = {
      start:performance.now(), duration:2100,
      fromPosition:camera.position.clone(), fromTarget:controls.target.clone(),
      offset,
      body
    };
    controls.enabled = false;
  }
  controls.minDistance = Math.max(body.radius * 1.45, .00002);
  controls.maxDistance = Math.max(focusDistance * 7, largestMoonOrbit * 4, body.radius * 40);
  camera.near = Math.max(body.radius * .015, .000002);
  camera.updateProjectionMatrix();
  viewHint.style.opacity = '0';
}

function showOverview() {
  selected = null;
  history.replaceState(null, '', location.pathname);
  setActiveNav(null);
  updateInspector(null);
  setOrbitVisibility();
  travel = {
    start:performance.now(), duration:2200,
    fromPosition:camera.position.clone(), fromTarget:controls.target.clone(),
    fixedPosition:OVERVIEW_POSITION.clone(), offset:null, body:null
  };
  controls.enabled = false;
  controls.minDistance = 20;
  controls.maxDistance = 20000;
  camera.near = .00001;
  camera.updateProjectionMatrix();
}

function updateTravel(now) {
  if (!travel) return;
  const raw = Math.min(1, (now - travel.start) / travel.duration);
  const eased = raw < .5 ? 4 * raw ** 3 : 1 - Math.pow(-2 * raw + 2, 3) / 2;
  const destinationTarget = travel.body ? travel.body.group.position : new THREE.Vector3();
  const destinationPosition = travel.body ? destinationTarget.clone().add(travel.offset) : travel.fixedPosition;
  camera.position.lerpVectors(travel.fromPosition, destinationPosition, eased);
  controls.target.lerpVectors(travel.fromTarget, destinationTarget, eased);
  if (raw >= 1) {
    travel = null;
    controls.enabled = true;
  }
}

function updateBodies(deltaDays, realDelta) {
  planetObjects.forEach(body => {
    orbitalPosition(body, elapsedDays, body.group.position);
    body.mesh.rotation.y += realDelta / Math.max(Math.abs(body.rotation), .2) * .08 * Math.sign(body.rotation);
    body.moons.forEach(moon => {
      orbitalPosition(moon, elapsedDays, moon.group.position);
      moon.mesh.rotation.y += realDelta * .08;
    });
  });
  sun.mesh.rotation.y += realDelta * .015;
}

function updateLocators() {
  const viewportHeight = renderer.domElement.clientHeight;
  const tangent = Math.tan(camera.fov * DEG * .5) * 2 / viewportHeight;
  planetObjects.forEach(body => {
    const distanceToCamera = camera.position.distanceTo(body.group.position);
    const markerSize = distanceToCamera * tangent * (selected === body ? 0 : 13);
    body.locator.visible = selected !== body;
    body.locator.scale.setScalar(markerSize);
    body.moons.forEach(moon => {
      const moonDistance = camera.position.distanceTo(moon.group.getWorldPosition(new THREE.Vector3()));
      moon.locator.visible = selected === body;
      moon.locator.scale.setScalar(moonDistance * tangent * 7);
    });
  });
}

function updateMoonLineFade() {
  if (!selected || !selected.moons.length) return;
  const maximumOrbit = Math.max(...selected.moons.map(moon => moon.a * (1 + moon.e)));
  const distanceFromFocus = camera.position.distanceTo(controls.target);
  const fade = THREE.MathUtils.clamp(1 - (distanceFromFocus / Math.max(maximumOrbit * 9, selected.radius * 50) - .3), .12, 1);
  selected.moons.forEach(moon => { moon.line.material.opacity = moon.line.userData.baseOpacity * fade; });
}

function updateDate(now) {
  if (now - lastDateUpdate < 200) return;
  lastDateUpdate = now;
  const liveDate = document.querySelector('#date-readout');
  if (liveDate) liveDate.textContent = currentDate().toISOString().slice(0,10);
}

function animate(now) {
  requestAnimationFrame(animate);
  const realDelta = Math.min((now - lastTime) / 1000, .1);
  lastTime = now;
  const deltaDays = realDelta * SPEEDS[speedIndex];
  elapsedDays += deltaDays;
  const previousFocusPosition = selected && !travel ? selected.group.position.clone() : null;
  updateBodies(deltaDays, realDelta);
  if (previousFocusPosition) {
    const focusDelta = selected.group.position.clone().sub(previousFocusPosition);
    camera.position.add(focusDelta);
    controls.target.add(focusDelta);
  }
  updateTravel(now);
  if (selected && !travel) controls.target.copy(selected.group.position);
  updateLocators();
  updateMoonLineFade();
  updateDate(now);
  controls.update();
  renderer.render(scene,camera);
}

document.querySelector('.body-nav').addEventListener('click', event => {
  const button = event.target.closest('[data-body]');
  if (!button) return;
  if (button.dataset.body === 'system') showOverview();
  else focusBody(planetObjects.find(body => body.name === button.dataset.body));
});
document.querySelector('#close-focus').addEventListener('click', showOverview);

timeSpeed.addEventListener('input', () => {
  speedIndex = Number(timeSpeed.value);
  timeLabel.textContent = SPEED_LABELS[speedIndex];
  playToggle.classList.toggle('paused', speedIndex === 0);
});
playToggle.addEventListener('click', () => {
  if (speedIndex === 0) speedIndex = Number(playToggle.dataset.previousSpeed || 2);
  else { playToggle.dataset.previousSpeed = speedIndex; speedIndex = 0; }
  timeSpeed.value = speedIndex;
  timeLabel.textContent = SPEED_LABELS[speedIndex];
  playToggle.classList.toggle('paused', speedIndex === 0);
});
document.querySelector('#reset-date').addEventListener('click', () => { elapsedDays = 0; });
orbitToggle.addEventListener('click', () => {
  orbitsVisible = !orbitsVisible;
  orbitToggle.classList.toggle('active', orbitsVisible);
  orbitToggle.setAttribute('aria-pressed', String(orbitsVisible));
  orbitToggle.textContent = orbitsVisible ? 'Orbits on' : 'Orbits off';
  setOrbitVisibility();
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerStart = null;
renderer.domElement.addEventListener('pointerdown', event => { pointerStart = { x:event.clientX, y:event.clientY }; });
renderer.domElement.addEventListener('pointerup', event => {
  if (!pointerStart || Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y) > 5) return;
  pointer.x = event.clientX / innerWidth * 2 - 1;
  pointer.y = -(event.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer,camera);
  const hit = raycaster.intersectObjects(planetObjects.map(body => body.locator), false)[0];
  if (hit?.object.userData.body) focusBody(hit.object.userData.body);
});
controls.addEventListener('start', () => { viewHint.style.opacity = '0'; });

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  orbitMaterials.forEach(material => material.resolution.set(innerWidth,innerHeight));
});

updateBodies(0,0);
updateInspector(null);
setOrbitVisibility();
const requestedFocus = new URLSearchParams(location.search).get('focus');
const initialBody = planetObjects.find(body => body.name.toLowerCase() === requestedFocus?.toLowerCase());
if (initialBody) focusBody(initialBody, true);
requestAnimationFrame(animate);

// Texture and structural data were adapted from sanderblue/solar-system-threejs
// (Apache-2.0). Rendering, UI, orbital mechanics, and line work are rewritten.
