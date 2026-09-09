import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const sceneHost = document.querySelector('#scene');
const loading = document.querySelector('#loading');
const unsupported = document.querySelector('#unsupported');
const sampleSelect = document.querySelector('#sample-count');
const depthInput = document.querySelector('#depth');
const depthOutput = document.querySelector('#depth-output');
const edgeCount = document.querySelector('#edge-count');
const flightCount = document.querySelector('#flight-count');
const peakValue = document.querySelector('#peak-value');
const rotateToggle = document.querySelector('#rotate-toggle');

const MAX_START = 1_000_000;
const EVEN_TURN = THREE.MathUtils.degToRad(8.65);
const ODD_TURN = THREE.MathUtils.degToRad(-16);
const BUCKETS = 12;
const palette = ['#efca83', '#f2b16e', '#f69165', '#f16e62', '#e65369', '#d63d72', '#be2d7c', '#9f247d', '#7e1e78', '#61196e', '#481363', '#2d0b55'];

let renderer;
let camera;
let controls;
let treeGroup;
let lineMaterials = [];
let seed = 0x9e3779b9;
let autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let revealStarted = 0;
let homeView = null;

function collatz(n) {
  return n % 2 === 0 ? n / 2 : n * 3 + 1;
}

function mulberry32(value) {
  return function random() {
    value |= 0;
    value = value + 0x6D2B79F5 | 0;
    let t = Math.imul(value ^ value >>> 15, 1 | value);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function compactNumber(value) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function fullNumber(value) {
  return new Intl.NumberFormat('en').format(value);
}

function hashInteger(value) {
  let x = (value % 0xffffffff) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  return (x ^ x >>> 16) >>> 0;
}

function buildGraph(sampleCount) {
  const random = mulberry32(seed);
  const edges = new Map();
  const starts = new Set();
  let longest = { start: 1, steps: 0, peak: 1 };
  let overallPeak = 1;

  while (starts.size < sampleCount) starts.add(1 + Math.floor(random() * (MAX_START - 1)));

  for (const start of starts) {
    let n = start;
    let localPeak = n;
    let steps = 0;

    while (n !== 1 && steps < 1000) {
      const parent = collatz(n);
      let edge = edges.get(n);
      if (!edge) {
        edge = { child: n, parent, count: 0 };
        edges.set(n, edge);
      }
      edge.count += 1;
      n = parent;
      localPeak = Math.max(localPeak, n);
      steps += 1;
    }

    overallPeak = Math.max(overallPeak, localPeak);
    if (steps > longest.steps) longest = { start, steps, peak: localPeak };
  }

  return { edges, longest, overallPeak };
}

function layoutGraph(graph) {
  const positions = new Map([[1, { point: new THREE.Vector3(0, 0, 0), heading: 0, depthSlope: 0 }]]);

  function place(n) {
    if (positions.has(n)) return positions.get(n);
    const parentValue = collatz(n);
    const parent = place(parentValue);
    const turn = n % 2 === 0 ? EVEN_TURN : ODD_TURN;
    const heading = parent.heading + turn;
    const length = 5.35 / Math.max(1, Math.log2(n + 1));
    let depthSlope = parent.depthSlope * 0.987;

    // Odd predecessors are true branch events in the reverse Collatz tree. Give
    // them one decisive depth turn, then let even descendants inherit and ease
    // that slope so every limb reads as a smooth arc rather than a random walk.
    if (n % 2 !== 0) {
      const branchHash = hashInteger(n);
      const direction = branchHash % 2 === 0 ? -1 : 1;
      const branchStrength = 0.9 + branchHash / 0xffffffff * 0.75;
      depthSlope = THREE.MathUtils.clamp(parent.depthSlope * 0.78 + direction * branchStrength, -2.5, 2.5);
    }

    const point = new THREE.Vector3(
      parent.point.x + Math.cos(heading) * length,
      parent.point.y + Math.sin(heading) * length,
      parent.point.z + depthSlope * length * 0.7
    );
    const result = { point, heading, depthSlope };
    positions.set(n, result);
    return result;
  }

  for (const edge of graph.edges.values()) place(edge.child);
  return positions;
}

function removeTree() {
  if (!treeGroup) return;
  scene.remove(treeGroup);
  treeGroup.traverse((object) => {
    object.geometry?.dispose();
    object.material?.dispose();
  });
  treeGroup.clear();
  lineMaterials = [];
}

function colorForTraffic(t) {
  return palette[Math.min(palette.length - 1, Math.floor(t * palette.length))];
}

function makeTree(graph, positions) {
  removeTree();
  treeGroup = new THREE.Group();
  treeGroup.name = 'collatz-canopy';
  scene.add(treeGroup);

  let maxTraffic = 1;
  for (const edge of graph.edges.values()) maxTraffic = Math.max(maxTraffic, edge.count);
  const bins = Array.from({ length: BUCKETS }, () => []);

  for (const edge of graph.edges.values()) {
    const traffic = Math.log1p(edge.count) / Math.log1p(maxTraffic);
    const bin = Math.min(BUCKETS - 1, Math.floor(traffic * BUCKETS));
    const child = positions.get(edge.child).point;
    const parent = positions.get(edge.parent).point;
    bins[bin].push(parent.x, parent.y, parent.z, child.x, child.y, child.z);
  }

  bins.forEach((values, index) => {
    if (!values.length) return;
    const t = (index + 0.5) / BUCKETS;
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(values);
    const material = new LineMaterial({
      color: colorForTraffic(t),
      linewidth: 0.42 + 4.25 * Math.pow(t, 1.65),
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      alphaToCoverage: true
    });
    material.userData.targetOpacity = 0.18 + t * 0.77;
    material.resolution.set(window.innerWidth, window.innerHeight);
    lineMaterials.push(material);
    const lines = new LineSegments2(geometry, material);
    lines.renderOrder = index;
    lines.frustumCulled = false;
    treeGroup.add(lines);
  });

  fitCamera(treeGroup);
  revealStarted = performance.now();
}

function fitCamera(group) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const fitHeightDistance = size.y / (2 * Math.tan(fov / 2));
  const fitWidthDistance = size.x / (2 * Math.tan(fov / 2)) / camera.aspect;
  const distance = Math.max(fitHeightDistance, fitWidthDistance) * 1.22;
  const direction = new THREE.Vector3(0.04, -0.03, 1).normalize();
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(direction, Math.max(distance, 24));
  camera.near = Math.max(0.05, distance / 1000);
  camera.far = Math.max(1000, distance * 20);
  camera.updateProjectionMatrix();
  controls.minDistance = distance * 0.12;
  controls.maxDistance = distance * 4;
  controls.update();
  homeView = { position: camera.position.clone(), target: controls.target.clone() };
}

function rebuild() {
  loading.classList.remove('done');
  loading.querySelector('p').textContent = 'Growing integer paths';
  const sampleCount = Number(sampleSelect.value);
  window.setTimeout(() => {
    try {
      const graph = buildGraph(sampleCount);
      const positions = layoutGraph(graph);
      makeTree(graph, positions);
      edgeCount.textContent = fullNumber(graph.edges.size);
      flightCount.textContent = `${fullNumber(graph.longest.steps)} steps`;
      peakValue.textContent = compactNumber(graph.overallPeak);
      requestAnimationFrame(() => loading.classList.add('done'));
    } catch (error) {
      console.error('Could not build the Collatz canopy.', error);
      loading.querySelector('p').textContent = 'Could not grow paths — try fewer samples';
    }
  }, 40);
}

function resetView() {
  if (!homeView) return;
  camera.position.copy(homeView.position);
  controls.target.copy(homeView.target);
  controls.update();
}

function onResize() {
  const width = sceneHost.clientWidth;
  const height = sceneHost.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  lineMaterials.forEach((material) => material.resolution.set(width, height));
}

function animate(time) {
  requestAnimationFrame(animate);
  const reveal = THREE.MathUtils.smoothstep((time - revealStarted) / 1500, 0, 1);
  lineMaterials.forEach((material, index) => {
    const stagger = THREE.MathUtils.clamp(reveal * 1.35 - index * 0.025, 0, 1);
    material.opacity = material.userData.targetOpacity * stagger;
  });
  if (treeGroup) treeGroup.scale.z = Number(depthInput.value);
  controls.autoRotate = autoRotate;
  controls.update();
  renderer.render(scene, camera);
}

let scene;

function init() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (error) {
    loading.hidden = true;
    unsupported.hidden = false;
    return;
  }

  renderer.setClearColor('#f7f1e8', 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  sceneHost.prepend(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#f7f1e8');
  scene.fog = new THREE.FogExp2('#f7f1e8', 0.0012);

  camera = new THREE.PerspectiveCamera(34, 1, 0.05, 2000);
  camera.position.set(0, 0, 100);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.screenSpacePanning = true;
  controls.autoRotateSpeed = 0.22;
  controls.zoomToCursor = true;

  sampleSelect.addEventListener('change', rebuild);
  depthInput.addEventListener('input', () => {
    depthOutput.value = `${Math.round(Number(depthInput.value) * 100)}%`;
  });
  document.querySelector('#new-sample').addEventListener('click', () => {
    seed = Math.floor(Math.random() * 0xffffffff);
    rebuild();
  });
  rotateToggle.addEventListener('click', () => {
    autoRotate = !autoRotate;
    rotateToggle.classList.toggle('active', autoRotate);
    rotateToggle.textContent = autoRotate ? 'Drift on' : 'Drift off';
    rotateToggle.setAttribute('aria-pressed', String(autoRotate));
  });
  renderer.domElement.addEventListener('dblclick', resetView);
  window.addEventListener('resize', onResize);

  rotateToggle.classList.toggle('active', autoRotate);
  rotateToggle.textContent = autoRotate ? 'Drift on' : 'Drift off';
  onResize();
  rebuild();
  requestAnimationFrame(animate);
}

init();
