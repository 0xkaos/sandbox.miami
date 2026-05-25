import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

const canvas = document.getElementById('scene');
const particleReadout = document.getElementById('particleReadout');
const fpsReadout = document.getElementById('fpsReadout');
const gpuReadout = document.getElementById('gpuReadout');
const statusLine = document.getElementById('statusLine');
const errorPanel = document.getElementById('errorPanel');
const errorCopy = document.getElementById('errorCopy');

const PI = Math.PI;
const TWO_PI = Math.PI * 2;
const STATE_MAGIC = 0x41574231;
const PARTICLE_PRESETS = {
  '200k': 200000,
  '500k': 500000,
  '1M': 1000000,
  '2M': 2000000
};

const params = {
  particlePreset: '200k',
  particleCount: 200000,
  omega1: 1.0,
  ratio: Math.SQRT2,
  amplitude: 0.22,
  coupling: 0.082,
  diffusion: 0.028,
  damping: 0.002,
  maxSpeed: 2.5,
  resonanceSharpness: 11.0,
  dt: 0.34,
  substeps: 2,
  projection: 0.78,
  pointSize: 0.78,
  bloomStrength: 0.92,
  bloomRadius: 0.42,
  trailMemory: 0.88,
  autoRotate: true,
  colorMode: 'web + speed',
  sliceAxis: 'z',
  sliceCenter: 0.0,
  sliceWidth: PI,
  pause: false,
  stateUrl: '',
  putUrl: ''
};

let renderer;
let scene;
let camera;
let controls;
let composer;
let renderPass;
let bloomPass;
let afterimagePass;
let outputPass;
let particleSystem;
let particleGeometry;
let particleMaterial;
let sim;
let gui;
let clock;
let simulationTime = 0;
let fpsFrames = 0;
let fpsLastTime = performance.now();
let statusTimer = 0;

const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const simScene = new THREE.Scene();
const simQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
simScene.add(simQuad);

const passVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const copyFragmentShader = `
  precision highp float;

  uniform sampler2D tSource;
  varying vec2 vUv;

  void main() {
    gl_FragColor = texture2D(tSource, vUv);
  }
`;

const velocityFragmentShader = `
  precision highp float;

  uniform sampler2D tPosition;
  uniform sampler2D tVelocity;
  uniform float uTime;
  uniform float uDt;
  uniform float uOmega1;
  uniform float uOmega2;
  uniform float uAmplitude;
  uniform float uCoupling;
  uniform float uDiffusion;
  uniform float uDamping;
  uniform float uMaxSpeed;
  uniform float uSharpness;
  uniform float uSeed;
  varying vec2 vUv;

  const float PI = 3.141592653589793;
  const float TWO_PI = 6.283185307179586;

  float hash11(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  vec3 hash31(vec3 p) {
    p = fract(p * vec3(0.1031, 0.11369, 0.13787));
    p += dot(p, p.yxz + 19.19);
    return fract(vec3((p.x + p.y) * p.z, (p.x + p.z) * p.y, (p.y + p.z) * p.x));
  }

  float resonanceGate(float phase) {
    float d = abs(sin(phase));
    return pow(max(0.0, 1.0 - d), uSharpness);
  }

  vec3 forceAt(vec3 q, float t, out float web) {
    float phi1 = uOmega1 * t;
    float phi2 = uOmega2 * t;

    float c0 = q.x + q.y - q.z;
    float c1 = 2.0 * q.x - q.y + phi1;
    float c2 = q.x - 2.0 * q.z + phi2;
    float c3 = -q.x + q.y + q.z + phi1 - phi2;
    float c4 = 3.0 * q.y - 2.0 * q.z - phi1 * 0.5 + phi2;

    float g0 = resonanceGate(c0);
    float g1 = resonanceGate(c1);
    float g2 = resonanceGate(c2);
    float g3 = resonanceGate(c3);
    float g4 = resonanceGate(c4);
    web = clamp(max(max(g0, g1), max(max(g2, g3), g4)), 0.0, 1.0);

    vec3 force = vec3(0.0);

    // Integrable standing-wave cavity modes: weak enough to leave broad KAM-like islands.
    force += uAmplitude * 0.28 * vec3(
      sin(q.x),
      sin(q.y),
      sin(q.z)
    );

    // Two incommensurate acoustic drives deform the separatrices without repeating.
    force += uAmplitude * vec3(
      0.72 * sin(q.y + phi1) + 0.33 * sin(q.z - phi2),
      0.64 * sin(q.z - phi2) + 0.29 * sin(q.x + phi1 - phi2),
      0.58 * sin(q.x + phi1) - 0.31 * sin(q.y - phi2)
    );

    // Resonance terms approximate the thin channels of an Arnold web.
    float s0 = sin(c0);
    float s1 = sin(c1);
    float s2 = sin(c2);
    float s3 = sin(c3);
    float s4 = sin(c4);
    force += uCoupling * vec3(s0, s0, -s0);
    force += uCoupling * 0.82 * vec3(2.0 * s1, -s1, 0.0);
    force += uCoupling * 0.74 * vec3(s2, 0.0, -2.0 * s2);
    force += uCoupling * 0.56 * vec3(-s3, s3, s3);
    force += uCoupling * 0.38 * vec3(0.0, 3.0 * s4, -2.0 * s4);

    return force;
  }

  void main() {
    vec4 posData = texture2D(tPosition, vUv);
    vec4 velData = texture2D(tVelocity, vUv);
    vec3 q = posData.xyz;
    vec3 p = velData.xyz;

    float web = 0.0;
    vec3 force = forceAt(q, uTime, web);

    float cell = floor(vUv.x * 4096.0) + floor(vUv.y * 4096.0) * 4096.0;
    float kickEpoch = floor(uTime * 19.0);
    vec3 kick = hash31(vec3(cell + uSeed, kickEpoch, cell * 0.071 + uSeed)) - 0.5;
    float stochasticGate = web * web * (0.35 + 0.65 * hash11(cell + kickEpoch + uSeed));

    p += force * uDt;
    p += kick * (uDiffusion * stochasticGate * uDt);
    p *= max(0.0, 1.0 - uDamping * uDt);

    float speed = length(p);
    if (speed > uMaxSpeed) {
      p *= uMaxSpeed / max(speed, 0.0001);
      speed = uMaxSpeed;
    }

    gl_FragColor = vec4(p, web);
  }
`;

const positionFragmentShader = `
  precision highp float;

  uniform sampler2D tPosition;
  uniform sampler2D tVelocity;
  uniform float uDt;
  varying vec2 vUv;

  const float PI = 3.141592653589793;
  const float TWO_PI = 6.283185307179586;

  vec3 wrapPi(vec3 value) {
    return mod(value + PI, TWO_PI) - PI;
  }

  void main() {
    vec4 posData = texture2D(tPosition, vUv);
    vec3 velocity = texture2D(tVelocity, vUv).xyz;
    vec3 q = wrapPi(posData.xyz + velocity * uDt);
    gl_FragColor = vec4(q, posData.w);
  }
`;

const particleVertexShader = `
  precision highp float;

  uniform sampler2D tPosition;
  uniform sampler2D tVelocity;
  uniform float uProjectionMix;
  uniform float uPointSize;
  uniform float uPixelRatio;
  uniform float uDensityScale;
  uniform float uSliceCenter;
  uniform float uSliceWidth;
  uniform float uSliceAxis;
  uniform float uTime;
  uniform int uColorMode;
  attribute vec2 reference;
  varying vec3 vColor;
  varying float vAlpha;

  const float PI = 3.141592653589793;

  vec3 paletteSpeed(float t) {
    vec3 a = vec3(0.08, 0.45, 0.95);
    vec3 b = vec3(0.12, 0.96, 1.0);
    vec3 c = vec3(1.0, 0.78, 0.34);
    vec3 d = vec3(1.0, 0.22, 0.38);
    return mix(mix(a, b, smoothstep(0.0, 0.42, t)), mix(c, d, smoothstep(0.62, 1.0, t)), smoothstep(0.34, 0.92, t));
  }

  vec3 paletteWeb(float web, float speed) {
    vec3 low = vec3(0.08, 0.2, 0.62);
    vec3 channel = vec3(0.45, 1.0, 0.92);
    vec3 hot = vec3(1.0, 0.68, 0.26);
    return mix(mix(low, channel, smoothstep(0.06, 0.55, web)), hot, smoothstep(0.52, 1.0, speed));
  }

  void main() {
    vec4 posData = texture2D(tPosition, reference);
    vec4 velData = texture2D(tVelocity, reference);
    vec3 q = posData.xyz;
    vec3 p = velData.xyz;
    float speed = clamp(length(p) / 2.5, 0.0, 1.0);
    float web = clamp(velData.w, 0.0, 1.0);

    float major = 2.12 + 0.28 * cos(q.z * 2.0 + 0.08 * sin(uTime));
    float minor = 0.82 + 0.16 * sin(q.z + 0.4 * sin(q.x));
    vec3 torus = vec3(
      (major + minor * cos(q.y)) * cos(q.x),
      (major + minor * cos(q.y)) * sin(q.x),
      minor * sin(q.y) + 0.42 * sin(q.z) + 0.08 * sin(q.x - q.y)
    );

    vec3 cavity = vec3(
      1.18 * q.x + 0.18 * sin(q.y + q.z),
      1.18 * q.y + 0.18 * sin(q.z + q.x),
      1.18 * q.z + 0.18 * sin(q.x + q.y)
    );
    vec3 projected = mix(cavity, torus, uProjectionMix);

    float sliceCoord = q.z;
    if (uSliceAxis < 0.5) {
      sliceCoord = q.x;
    } else if (uSliceAxis < 1.5) {
      sliceCoord = q.y;
    }

    float sliceDistance = abs(sliceCoord - uSliceCenter);
    sliceDistance = min(sliceDistance, 6.28318530718 - sliceDistance);
    float sliceInner = max(0.001, uSliceWidth * 0.55);
    float sliceFade = 1.0 - smoothstep(sliceInner, uSliceWidth, sliceDistance);
    sliceFade = mix(1.0, sliceFade, step(0.02, PI - uSliceWidth));

    vec3 speedColor = paletteSpeed(speed);
    vec3 webColor = paletteWeb(web, speed);
    vec3 energyColor = mix(vec3(0.12, 0.32, 0.95), vec3(1.0, 0.78, 0.18), smoothstep(0.08, 0.95, speed * speed + web * 0.45));
    vColor = webColor;
    if (uColorMode == 1) {
      vColor = speedColor;
    } else if (uColorMode == 2) {
      vColor = energyColor;
    }

    vColor *= 0.38 + 1.18 * web + 0.26 * speed;
    vAlpha = posData.w * sliceFade * uDensityScale * (0.025 + 0.46 * smoothstep(0.02, 0.86, web + speed * 0.55));

    vec4 mvPosition = modelViewMatrix * vec4(projected, 1.0);
    float perspectiveScale = 1.0 / max(0.24, -mvPosition.z);
    gl_PointSize = clamp(uPointSize * uPixelRatio * (14.0 + 19.0 * web + 5.0 * speed) * perspectiveScale, 0.45, 8.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const particleFragmentShader = `
  precision highp float;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 p = gl_PointCoord.xy - 0.5;
    float r = length(p) * 2.0;
    float core = 1.0 - smoothstep(0.02, 0.72, r);
    float halo = (1.0 - smoothstep(0.08, 1.0, r)) * 0.14;
    float alpha = vAlpha * (core + halo);
    if (alpha < 0.006) discard;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

const copyMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tSource: { value: null }
  },
  vertexShader: passVertexShader,
  fragmentShader: copyFragmentShader,
  depthWrite: false,
  depthTest: false
});

const velocityMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tPosition: { value: null },
    tVelocity: { value: null },
    uTime: { value: 0 },
    uDt: { value: 0 },
    uOmega1: { value: params.omega1 },
    uOmega2: { value: params.omega1 * params.ratio },
    uAmplitude: { value: params.amplitude },
    uCoupling: { value: params.coupling },
    uDiffusion: { value: params.diffusion },
    uDamping: { value: params.damping },
    uMaxSpeed: { value: params.maxSpeed },
    uSharpness: { value: params.resonanceSharpness },
    uSeed: { value: Math.random() * 1000 }
  },
  vertexShader: passVertexShader,
  fragmentShader: velocityFragmentShader,
  depthWrite: false,
  depthTest: false
});

const positionMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tPosition: { value: null },
    tVelocity: { value: null },
    uDt: { value: 0 }
  },
  vertexShader: passVertexShader,
  fragmentShader: positionFragmentShader,
  depthWrite: false,
  depthTest: false
});

init();

function init() {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;

  if (!renderer.capabilities.isWebGL2) {
    showFatalError('This lab needs WebGL2 so fragment shaders can update floating-point state textures on the GPU.');
    return;
  }

  const hasFloatTargets = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('WEBGL_color_buffer_float');
  if (!hasFloatTargets) {
    showFatalError('Your browser/GPU did not expose renderable floating-point textures. Try a current desktop Chromium, Firefox, or Safari build with hardware acceleration enabled.');
    return;
  }

  gpuReadout.textContent = 'webgl2 fbo';

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03050a);
  scene.fog = new THREE.FogExp2(0x03050a, 0.032);

  camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.05, 120);
  camera.position.set(4.8, 3.2, 6.0);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.autoRotate = params.autoRotate;
  controls.autoRotateSpeed = 0.32;
  controls.minDistance = 2.2;
  controls.maxDistance = 18;

  buildPhaseSpaceGuides();
  buildSimulation(params.particleCount);
  buildPostProcessing();
  buildGui();

  clock = new THREE.Clock();
  window.addEventListener('resize', onResize);

  const stateFromUrl = new URLSearchParams(window.location.search).get('state');
  if (stateFromUrl) {
    params.stateUrl = stateFromUrl;
    loadStateFromUrl(stateFromUrl).catch((error) => {
      console.error(error);
      setStatus('state fetch failed; running procedural seed');
    });
  }

  setStatus('gpu state ready; integrating');
  animate();
}

function showFatalError(message) {
  gpuReadout.textContent = 'unavailable';
  statusLine.textContent = 'simulation stopped';
  errorCopy.textContent = message;
  errorPanel.hidden = false;
}

function buildPhaseSpaceGuides() {
  const grid = new THREE.GridHelper(10, 24, 0x264c5a, 0x13242d);
  grid.position.y = -3.18;
  grid.material.transparent = true;
  grid.material.opacity = 0.28;
  scene.add(grid);

  const light = new THREE.PointLight(0x6ee7ff, 0.8, 18);
  light.position.set(3.5, 2.2, 4.2);
  scene.add(light);
}

function buildSimulation(particleCount, loadedState = null) {
  disposeSimulation();

  const textureSize = loadedState?.textureSize || Math.ceil(Math.sqrt(particleCount));
  const capacity = textureSize * textureSize;
  const state = loadedState || createInitialState(particleCount, textureSize);

  sim = {
    particleCount,
    textureSize,
    capacity,
    positionA: createStateTarget(textureSize),
    positionB: createStateTarget(textureSize),
    velocityA: createStateTarget(textureSize),
    velocityB: createStateTarget(textureSize),
    positionRead: null,
    positionWrite: null,
    velocityRead: null,
    velocityWrite: null
  };

  sim.positionRead = sim.positionA;
  sim.positionWrite = sim.positionB;
  sim.velocityRead = sim.velocityA;
  sim.velocityWrite = sim.velocityB;

  const positionTexture = new THREE.DataTexture(state.position, textureSize, textureSize, THREE.RGBAFormat, THREE.FloatType);
  const velocityTexture = new THREE.DataTexture(state.velocity, textureSize, textureSize, THREE.RGBAFormat, THREE.FloatType);
  positionTexture.needsUpdate = true;
  velocityTexture.needsUpdate = true;
  positionTexture.minFilter = positionTexture.magFilter = THREE.NearestFilter;
  velocityTexture.minFilter = velocityTexture.magFilter = THREE.NearestFilter;
  positionTexture.wrapS = positionTexture.wrapT = THREE.ClampToEdgeWrapping;
  velocityTexture.wrapS = velocityTexture.wrapT = THREE.ClampToEdgeWrapping;

  copyTextureToTarget(positionTexture, sim.positionRead);
  copyTextureToTarget(velocityTexture, sim.velocityRead);
  positionTexture.dispose();
  velocityTexture.dispose();

  buildParticleGeometry(textureSize, capacity, particleCount);
  updateParticleUniforms();
  updateReadouts();
}

function createInitialState(particleCount, textureSize) {
  const capacity = textureSize * textureSize;
  const position = new Float32Array(capacity * 4);
  const velocity = new Float32Array(capacity * 4);

  for (let i = 0; i < capacity; i += 1) {
    const o = i * 4;
    if (i >= particleCount) {
      position[o + 3] = 0;
      continue;
    }

    const family = i % 7;
    let qx = randRange(-PI, PI);
    let qy = randRange(-PI, PI);
    let qz = randRange(-PI, PI);

    if (family === 0) {
      qy = wrapScalarPi(2.0 * qx + randRange(-0.045, 0.045));
    } else if (family === 1) {
      qz = wrapScalarPi(0.5 * qx + randRange(-0.06, 0.06));
    } else if (family === 2) {
      qz = wrapScalarPi((qx + qy) + randRange(-0.05, 0.05));
    } else if (family === 3) {
      qy = wrapScalarPi(qx - qz + randRange(-0.08, 0.08));
    }

    const shell = Math.pow(Math.random(), 1.9);
    const phase = Math.random() * TWO_PI;
    const tilt = randRange(-1, 1);

    position[o] = qx;
    position[o + 1] = qy;
    position[o + 2] = qz;
    position[o + 3] = 1;

    velocity[o] = 0.13 * shell * Math.cos(phase) + 0.018 * Math.sin(qy);
    velocity[o + 1] = 0.13 * shell * Math.sin(phase) + 0.018 * Math.sin(qz);
    velocity[o + 2] = 0.09 * shell * tilt + 0.018 * Math.sin(qx);
    velocity[o + 3] = 0;
  }

  return { position, velocity };
}

function buildParticleGeometry(textureSize, capacity, particleCount) {
  if (particleSystem) {
    scene.remove(particleSystem);
  }
  if (particleGeometry) {
    particleGeometry.dispose();
  }
  if (particleMaterial) {
    particleMaterial.dispose();
  }

  const references = new Float32Array(capacity * 2);
  for (let i = 0; i < capacity; i += 1) {
    references[i * 2] = ((i % textureSize) + 0.5) / textureSize;
    references[i * 2 + 1] = (Math.floor(i / textureSize) + 0.5) / textureSize;
  }

  particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  particleGeometry.setAttribute('reference', new THREE.BufferAttribute(references, 2));
  particleGeometry.setDrawRange(0, particleCount);

  particleMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tPosition: { value: sim.positionRead.texture },
      tVelocity: { value: sim.velocityRead.texture },
      uProjectionMix: { value: params.projection },
      uPointSize: { value: params.pointSize },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uDensityScale: { value: viewportDensityScale() },
      uSliceCenter: { value: params.sliceCenter },
      uSliceWidth: { value: params.sliceWidth },
      uSliceAxis: { value: sliceAxisValue(params.sliceAxis) },
      uTime: { value: simulationTime },
      uColorMode: { value: colorModeValue(params.colorMode) }
    },
    vertexShader: particleVertexShader,
    fragmentShader: particleFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending
  });

  particleSystem = new THREE.Points(particleGeometry, particleMaterial);
  particleSystem.frustumCulled = false;
  scene.add(particleSystem);
}

function createStateTarget(size) {
  return new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false
  });
}

function copyTextureToTarget(texture, target) {
  simQuad.material = copyMaterial;
  copyMaterial.uniforms.tSource.value = texture;
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(simScene, simCamera);
  renderer.setRenderTarget(null);
}

function buildPostProcessing() {
  renderPass = new RenderPass(scene, camera);
  afterimagePass = new AfterimagePass(params.trailMemory);
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    params.bloomStrength,
    params.bloomRadius,
    0.08
  );
  outputPass = new OutputPass();

  composer = new EffectComposer(renderer);
  composer.addPass(renderPass);
  composer.addPass(afterimagePass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);
}

function buildGui() {
  gui = new GUI({ title: 'Arnold Web Controls', width: 320 });
  gui.close();

  const simFolder = gui.addFolder('Hamiltonian');
  simFolder.add(params, 'particlePreset', Object.keys(PARTICLE_PRESETS)).name('particles').onFinishChange((label) => {
    params.particleCount = PARTICLE_PRESETS[label];
    setStatus(`rebuilding ${label} state textures`);
    buildSimulation(params.particleCount);
  });
  simFolder.add(params, 'omega1', 0.1, 2.4, 0.001).name('omega 1');
  simFolder.add(params, 'ratio', 1.05, 2.5, 0.0001).name('omega 2 / 1');
  simFolder.add(params, 'amplitude', 0.0, 0.6, 0.001).name('drive amp');
  simFolder.add(params, 'coupling', 0.0, 0.24, 0.001).name('web coupling');
  simFolder.add(params, 'diffusion', 0.0, 0.12, 0.0005).name('thin-layer drift');
  simFolder.add(params, 'damping', 0.0, 0.025, 0.0001).name('damping');
  simFolder.add(params, 'maxSpeed', 0.4, 6.0, 0.01).name('speed clamp');
  simFolder.add(params, 'resonanceSharpness', 3.0, 24.0, 0.1).name('layer sharpness');
  simFolder.add(params, 'dt', 0.04, 0.9, 0.001).name('dt');
  simFolder.add(params, 'substeps', 1, 4, 1).name('substeps');
  simFolder.add(params, 'pause').name('pause');
  simFolder.add({ reset: () => {
    setStatus('resetting procedural torus ensemble');
    simulationTime = 0;
    buildSimulation(params.particleCount);
  } }, 'reset').name('reset state');

  const viewFolder = gui.addFolder('View');
  viewFolder.add(params, 'projection', 0.0, 1.0, 0.001).name('torus projection');
  viewFolder.add(params, 'pointSize', 0.35, 3.0, 0.01).name('point size');
  viewFolder.add(params, 'colorMode', ['web + speed', 'speed', 'energy']).name('color');
  viewFolder.add(params, 'sliceAxis', ['x', 'y', 'z']).name('slice axis');
  viewFolder.add(params, 'sliceCenter', -PI, PI, 0.001).name('slice center');
  viewFolder.add(params, 'sliceWidth', 0.04, PI, 0.001).name('slice width');
  viewFolder.add(params, 'autoRotate').name('auto rotate').onChange((value) => {
    controls.autoRotate = value;
  });

  const glowFolder = gui.addFolder('Glow');
  glowFolder.add(params, 'bloomStrength', 0.0, 3.0, 0.01).name('bloom');
  glowFolder.add(params, 'bloomRadius', 0.0, 1.0, 0.01).name('radius');
  glowFolder.add(params, 'trailMemory', 0.72, 0.97, 0.001).name('trails');

  const ioFolder = gui.addFolder('R2 State IO');
  ioFolder.add(params, 'stateUrl').name('fetch URL');
  ioFolder.add({ load: () => loadStateFromUrl(params.stateUrl).catch((error) => {
    console.error(error);
    setStatus('state load failed');
  }) }, 'load').name('load state');
  ioFolder.add(params, 'putUrl').name('PUT URL');
  ioFolder.add({ put: () => putStateToUrl(params.putUrl).catch((error) => {
    console.error(error);
    setStatus('snapshot PUT failed');
  }) }, 'put').name('PUT snapshot');
}

function updateMaterialUniforms() {
  const omega2 = params.omega1 * params.ratio;
  velocityMaterial.uniforms.uOmega1.value = params.omega1;
  velocityMaterial.uniforms.uOmega2.value = omega2;
  velocityMaterial.uniforms.uAmplitude.value = params.amplitude;
  velocityMaterial.uniforms.uCoupling.value = params.coupling;
  velocityMaterial.uniforms.uDiffusion.value = params.diffusion;
  velocityMaterial.uniforms.uDamping.value = params.damping;
  velocityMaterial.uniforms.uMaxSpeed.value = params.maxSpeed;
  velocityMaterial.uniforms.uSharpness.value = params.resonanceSharpness;

  if (particleMaterial) {
    particleMaterial.uniforms.uProjectionMix.value = params.projection;
    particleMaterial.uniforms.uPointSize.value = params.pointSize;
    particleMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    particleMaterial.uniforms.uDensityScale.value = viewportDensityScale();
    particleMaterial.uniforms.uSliceCenter.value = params.sliceCenter;
    particleMaterial.uniforms.uSliceWidth.value = params.sliceWidth;
    particleMaterial.uniforms.uSliceAxis.value = sliceAxisValue(params.sliceAxis);
    particleMaterial.uniforms.uColorMode.value = colorModeValue(params.colorMode);
    particleMaterial.uniforms.uTime.value = simulationTime;
  }

  if (bloomPass) {
    bloomPass.strength = params.bloomStrength;
    bloomPass.radius = params.bloomRadius;
  }
  if (afterimagePass) {
    afterimagePass.uniforms.damp.value = params.trailMemory;
  }
}

function stepSimulation(delta) {
  if (!sim || params.pause) return;

  const substeps = Math.max(1, Math.floor(params.substeps));
  const dt = params.dt * delta / substeps;

  for (let i = 0; i < substeps; i += 1) {
    velocityMaterial.uniforms.tPosition.value = sim.positionRead.texture;
    velocityMaterial.uniforms.tVelocity.value = sim.velocityRead.texture;
    velocityMaterial.uniforms.uTime.value = simulationTime;
    velocityMaterial.uniforms.uDt.value = dt;
    simQuad.material = velocityMaterial;
    renderer.setRenderTarget(sim.velocityWrite);
    renderer.render(simScene, simCamera);

    positionMaterial.uniforms.tPosition.value = sim.positionRead.texture;
    positionMaterial.uniforms.tVelocity.value = sim.velocityWrite.texture;
    positionMaterial.uniforms.uDt.value = dt;
    simQuad.material = positionMaterial;
    renderer.setRenderTarget(sim.positionWrite);
    renderer.render(simScene, simCamera);

    renderer.setRenderTarget(null);
    swapSimTargets();
    simulationTime += dt;
  }
}

function swapSimTargets() {
  const nextPositionRead = sim.positionWrite;
  sim.positionWrite = sim.positionRead;
  sim.positionRead = nextPositionRead;

  const nextVelocityRead = sim.velocityWrite;
  sim.velocityWrite = sim.velocityRead;
  sim.velocityRead = nextVelocityRead;
}

function updateParticleUniforms() {
  if (!particleMaterial || !sim) return;
  particleMaterial.uniforms.tPosition.value = sim.positionRead.texture;
  particleMaterial.uniforms.tVelocity.value = sim.velocityRead.texture;
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.045);
  statusTimer += delta;

  updateMaterialUniforms();
  stepSimulation(delta);
  updateParticleUniforms();

  controls.update();
  composer.render(delta);
  updateFps();

  if (statusTimer > 3.8) {
    statusTimer = 0;
    setStatus(`omega2=${(params.omega1 * params.ratio).toFixed(4)}; web=${params.coupling.toFixed(3)}; drift=${params.diffusion.toFixed(3)}`);
  }
}

function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (composer) {
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(width, height);
  }
  if (bloomPass) {
    bloomPass.setSize(width, height);
  }
  updateMaterialUniforms();
}

function updateFps() {
  fpsFrames += 1;
  const now = performance.now();
  if (now - fpsLastTime >= 500) {
    const fps = Math.round((fpsFrames * 1000) / (now - fpsLastTime));
    fpsReadout.textContent = String(fps);
    fpsFrames = 0;
    fpsLastTime = now;
  }
}

function updateReadouts() {
  particleReadout.textContent = formatCount(params.particleCount);
}

function setStatus(message) {
  statusLine.textContent = message;
}

function disposeSimulation() {
  if (particleSystem) {
    scene.remove(particleSystem);
    particleSystem = null;
  }
  if (particleGeometry) {
    particleGeometry.dispose();
    particleGeometry = null;
  }
  if (particleMaterial) {
    particleMaterial.dispose();
    particleMaterial = null;
  }
  if (sim) {
    sim.positionA.dispose();
    sim.positionB.dispose();
    sim.velocityA.dispose();
    sim.velocityB.dispose();
    sim = null;
  }
}

async function loadStateFromUrl(url) {
  if (!url) {
    setStatus('no state URL set');
    return;
  }

  setStatus('fetching external state');
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) {
    throw new Error(`state fetch failed: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('json')) {
    const json = await response.json();
    const loaded = stateFromJson(json);
    applyLoadedState(loaded);
    return;
  }

  const buffer = await response.arrayBuffer();
  const loaded = stateFromBinary(buffer);
  applyLoadedState(loaded);
}

function applyLoadedState(loaded) {
  params.particleCount = loaded.particleCount;
  const matchingPreset = Object.entries(PARTICLE_PRESETS).find(([, count]) => count === loaded.particleCount);
  params.particlePreset = matchingPreset ? matchingPreset[0] : `${loaded.particleCount}`;
  simulationTime = 0;
  buildSimulation(loaded.particleCount, loaded);
  setStatus(`loaded ${formatCount(loaded.particleCount)} external state`);
  if (typeof gui.controllersRecursive === 'function') {
    gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
  }
}

function stateFromBinary(buffer) {
  const header = new Uint32Array(buffer, 0, 4);
  if (header[0] !== STATE_MAGIC) {
    throw new Error('Unknown Arnold web state binary. Expected AWB1 header.');
  }

  const particleCount = header[1];
  const textureSize = header[2];
  const channels = header[3];
  if (channels !== 4) {
    throw new Error('Only RGBA float state buffers are supported.');
  }

  const floatsPerTexture = textureSize * textureSize * channels;
  const floatOffset = 4;
  const floats = new Float32Array(buffer, floatOffset * Uint32Array.BYTES_PER_ELEMENT);
  const position = floats.slice(0, floatsPerTexture);
  const velocity = floats.slice(floatsPerTexture, floatsPerTexture * 2);
  return { particleCount, textureSize, position, velocity };
}

function stateFromJson(json) {
  const particleCount = Number(json.particleCount);
  const textureSize = Number(json.textureSize || Math.ceil(Math.sqrt(particleCount)));
  const position = Float32Array.from(json.position || json.positions || []);
  const velocity = Float32Array.from(json.velocity || json.velocities || []);
  const required = textureSize * textureSize * 4;
  if (!particleCount || position.length < required || velocity.length < required) {
    throw new Error('JSON state must include particleCount, textureSize, position, and velocity arrays.');
  }
  return { particleCount, textureSize, position, velocity };
}

async function putStateToUrl(url) {
  if (!url) {
    setStatus('no PUT URL set');
    return;
  }
  if (!sim) return;

  setStatus('reading gpu state for PUT');
  const buffer = readStateBinary();
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'content-type': 'application/octet-stream',
      'x-arnold-web-particles': String(sim.particleCount),
      'x-arnold-web-texture-size': String(sim.textureSize)
    },
    body: buffer
  });

  if (!response.ok) {
    throw new Error(`PUT failed: ${response.status}`);
  }
  setStatus('snapshot PUT complete');
}

function readStateBinary() {
  const textureFloats = sim.textureSize * sim.textureSize * 4;
  const position = new Float32Array(textureFloats);
  const velocity = new Float32Array(textureFloats);
  renderer.readRenderTargetPixels(sim.positionRead, 0, 0, sim.textureSize, sim.textureSize, position);
  renderer.readRenderTargetPixels(sim.velocityRead, 0, 0, sim.textureSize, sim.textureSize, velocity);

  const headerBytes = Uint32Array.BYTES_PER_ELEMENT * 4;
  const dataBytes = Float32Array.BYTES_PER_ELEMENT * textureFloats * 2;
  const buffer = new ArrayBuffer(headerBytes + dataBytes);
  const header = new Uint32Array(buffer, 0, 4);
  header[0] = STATE_MAGIC;
  header[1] = sim.particleCount;
  header[2] = sim.textureSize;
  header[3] = 4;
  const floats = new Float32Array(buffer, headerBytes);
  floats.set(position, 0);
  floats.set(velocity, textureFloats);
  return buffer;
}

function formatCount(count) {
  if (count >= 1000000) return `${(count / 1000000).toFixed(count % 1000000 === 0 ? 0 : 1)}M`;
  if (count >= 1000) return `${Math.round(count / 1000)}k`;
  return String(count);
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function wrapScalarPi(value) {
  return ((((value + PI) % TWO_PI) + TWO_PI) % TWO_PI) - PI;
}

function sliceAxisValue(axis) {
  if (axis === 'x') return 0;
  if (axis === 'y') return 1;
  return 2;
}

function colorModeValue(mode) {
  if (mode === 'speed') return 1;
  if (mode === 'energy') return 2;
  return 0;
}

function viewportDensityScale() {
  const referenceArea = 1280 * 720;
  const area = Math.max(1, window.innerWidth * window.innerHeight);
  return Math.min(1, Math.max(0.32, Math.pow(area / referenceArea, 0.72)));
}
