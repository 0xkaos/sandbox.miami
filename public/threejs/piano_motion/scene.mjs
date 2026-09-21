import * as THREE from 'three';
import { handGuidePose, lowerBound, notePosition } from './performance.mjs';
import { cameraDrift } from './camera-motion.mjs';
import { BounceTail, LedgerLines } from './score-lines.mjs';

const SPACING = 8;
const INK = 0xaebfc9, MUTED = 0x354650, TREBLE = 0xefaa83, BASS = 0x77c8cf;
const LIGHT_STEP = 0.05, LIGHT_LIFE = 3.2;
const LIGHT_CAPACITY = 2 * (Math.ceil(LIGHT_LIFE / LIGHT_STEP) + 1);

export class ScoreScene {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1017);
    this.scene.fog = new THREE.Fog(0x0b1017, 50, 180);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.append(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(44, 1, 0.1, 500);
    this.scene.add(new THREE.HemisphereLight(0xacc9e8, 0x080c13, 1.1));
    this.light = new THREE.DirectionalLight(0xb7d1ed, 1.7);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    Object.assign(this.light.shadow.camera, { left: -24, right: 24, top: 16, bottom: -16 });
    this.light.shadow.bias = -0.0007;
    this.scene.add(this.light, this.light.target);
    this.paper = new THREE.Mesh(new THREE.BoxGeometry(512, 11, 0.07), new THREE.MeshStandardMaterial({ color: 0x111b26, roughness: 0.82, metalness: 0.15 }));
    this.paper.position.z = -0.09;
    this.paper.receiveShadow = true;
    this.scene.add(this.paper);
    this.paperEdge = new THREE.Mesh(new THREE.BoxGeometry(512, 11.04, 0.05), new THREE.MeshStandardMaterial({ color: 0x253446, roughness: 0.7 }));
    this.paperEdge.position.set(0, -0.035, -0.15);
    this.scene.add(this.paperEdge);
    this.score = new THREE.Group();
    this.scene.add(this.score);
    this.ledgerLines = new LedgerLines();
    this.scene.add(this.ledgerLines);
    this.headGeometry = new THREE.SphereGeometry(1, 16, 8);
    this.ringGeometry = new THREE.TorusGeometry(0.12, 0.035, 6, 18);
    this.stemMaterial = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.72 });
    this.staffMaterial = new THREE.LineBasicMaterial({ color: 0x5b7788, transparent: true, opacity: 0.65 });
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 64;
    const glowContext = glowCanvas.getContext('2d');
    const gradient = glowContext.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(0.2, '#ffffffa0');
    gradient.addColorStop(0.55, '#ffffff30'); gradient.addColorStop(1, '#ffffff00');
    glowContext.fillStyle = gradient; glowContext.fillRect(0, 0, 64, 64);
    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    this.handBalls = {};
    for (const [hand, color] of [['right', TREBLE], ['left', BASS]]) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.23, 24, 16), new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.3, roughness: 0.24, metalness: 0.2, transparent: true,
      }));
      ball.castShadow = true;
      ball.renderOrder = 2;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.set(0.65, 0.65, 0.65);
      glow.renderOrder = 3;
      const light = new THREE.PointLight(color, 9, 9);
      const tail = new BounceTail(color);
      this.handBalls[hand] = { ball, glow, light, tail, color: new THREE.Color(color) };
      this.scene.add(ball, glow, light, tail);
    }
    // A single instanced layer projects lingering light onto the paper, below the notation.
    // Per-instance alpha keeps fading smooth without changing the light's hue.
    const surfaceGeometry = new THREE.PlaneGeometry(1, 1);
    this.surfaceOpacity = new THREE.InstancedBufferAttribute(new Float32Array(LIGHT_CAPACITY), 1);
    this.surfaceOpacity.setUsage(THREE.DynamicDrawUsage);
    surfaceGeometry.setAttribute('surfaceOpacity', this.surfaceOpacity);
    const surfaceMaterial = new THREE.MeshBasicMaterial({ map: glowTexture, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    surfaceMaterial.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float surfaceOpacity; varying float vSurfaceOpacity;\n' + shader.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurfaceOpacity = surfaceOpacity;');
      shader.fragmentShader = 'varying float vSurfaceOpacity;\n' + shader.fragmentShader
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vSurfaceOpacity;');
    };
    surfaceMaterial.customProgramCacheKey = () => 'piano-surface-light-v1';
    this.surfaceLights = new THREE.InstancedMesh(surfaceGeometry, surfaceMaterial, LIGHT_CAPACITY);
    this.surfaceLights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.surfaceLights.frustumCulled = false;
    this.surfaceLights.count = 0;
    this.lightStamp = new THREE.Object3D();
    this.scene.add(this.surfaceLights);
    this.view = 'drift';
    this.showBall = true;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.driftEnabled = !this.reduced;
    this.focus = 0;
    this.chunk = null;
    this.noteMeshes = [];
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      container.dispatchEvent(new CustomEvent('scene-lost'));
    });
  }

  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.renderer.setSize(width, height);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  setPerformance(performance) {
    this.performance = performance;
    this.byBeat = [...performance.notes].sort((a, b) => a.beat - b.beat);
    let bottom = -5.5, top = 5.5;
    for (const note of performance.notes) {
      const y = notePosition(note.midi, note.hand).y;
      bottom = Math.min(bottom, y - 1.2);
      top = Math.max(top, y + 1.2);
    }
    this.centerY = (bottom + top) / 2;
    this.heightScale = (top - bottom) / 11;
    this.paper.scale.y = this.paperEdge.scale.y = this.heightScale;
    this.paper.position.y = this.centerY;
    this.paperEdge.position.y = this.centerY - 0.035;
    this.chunk = null;
    this.draw(0, 1);
  }

  line(points, material = this.stemMaterial) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
    const line = new THREE.Line(geometry, material);
    this.score.add(line);
    return line;
  }

  label(text, x, y, size = 0.5, serif = false, music = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#8aa5b6';
    ctx.font = `${serif ? 'italic' : ''} 70px ${serif ? 'Georgia, serif' : 'sans-serif'}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (music) {
      ctx.font = '100px Bravura';
      let metrics = ctx.measureText(text);
      const scale = 110 / (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent);
      ctx.font = `${100 * scale}px Bravura`;
      ctx.textBaseline = 'alphabetic';
      metrics = ctx.measureText(text);
      ctx.fillText(text, 128, (128 + metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2);
    } else ctx.fillText(text, 128, 64);
    const map = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size * 2, size), material);
    mesh.position.set(x, y, 0.03);
    this.score.add(mesh);
  }

  rebuild(beat) {
    this.score.traverse(object => {
      if (object.geometry && object.geometry !== this.headGeometry && object.geometry !== this.ringGeometry) object.geometry.dispose();
      if (object.material && object.material !== this.stemMaterial && object.material !== this.staffMaterial) {
        object.material.map?.dispose(); object.material.dispose();
      }
    });
    this.score.clear();
    this.noteMeshes = [];
    const ledgerMarks = [];
    const from = Math.max(-2, Math.floor(beat / 4) * 4 - 12), to = from + 40;
    for (const bottom of [-2.65, 1.05]) {
      for (let i = 0; i < 5; i++) {
        // Short segments keep near-plane clipping stable as the camera rides over the staff.
        const points = [];
        for (let step = from; step <= to; step += 2) points.push([step * SPACING, bottom + i * 0.48, 0.02]);
        this.line(points, this.staffMaterial);
      }
    }
    for (const bar of this.performance.bars) {
      if (bar.beat < from || bar.beat > to) continue;
      const x = bar.beat * SPACING - 0.4;
      for (const [bottom, top] of [[-2.65, -0.73], [1.05, 2.97]]) this.line([[x, bottom, 0.005], [x, top, 0.005]], this.staffMaterial);
      this.label(String(bar.number).padStart(2, '0'), x + 0.22, -4.2, 0.23);
    }
    if (from < 0) {
      this.label('\uE050', -2.25, 1.95, 3.3, false, true);
      this.label('\uE062', -2.25, -1.5, 1.65, false, true);
      const signature = this.performance.bars[0]?.signature || [4, 4];
      for (const center of [1.95, -1.65]) {
        this.label(String(signature[0]), -1.1, center + 0.34, 0.58, true);
        this.label(String(signature[1]), -1.1, center - 0.34, 0.58, true);
      }
    }
    const start = lowerBound(this.byBeat, from, 'beat');
    for (let i = start; i < this.byBeat.length && this.byBeat[i].beat <= to; i++) {
      const note = this.byBeat[i];
      const position = notePosition(note.midi, note.hand);
      const x = note.beat * SPACING, y = position.y;
      const length = note.durationTicks / this.performance.header.ppq;
      const material = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.8 });
      const head = new THREE.Mesh(length >= 1.85 ? this.ringGeometry : this.headGeometry, material);
      head.position.set(x, y, 0.055);
      head.rotation.z = -0.32;
      if (length >= 1.85) head.scale.set(1.35, 0.85, 0.7);
      else head.scale.set(0.19, 0.13, 0.065);
      this.score.add(head);
      this.noteMeshes.push({ note, head, color: position.treble ? TREBLE : BASS });
      const bottom = position.treble ? 1.05 : -2.65, top = bottom + 1.92;
      for (let ledger = bottom - 0.48; ledger >= y - 0.025; ledger -= 0.48) ledgerMarks.push({ x, y: ledger, start: note.time, end: note.end });
      for (let ledger = top + 0.48; ledger <= y + 0.025; ledger += 0.48) ledgerMarks.push({ x, y: ledger, start: note.time, end: note.end });
      if (length < 3.7) {
        const direction = y > bottom + 0.96 ? -1 : 1;
        const sx = x + direction * 0.155, tip = y + direction * 0.94;
        this.line([[sx, y, 0.02], [sx, tip, 0.02]]);
        const flags = length < 0.32 ? 2 : length < 0.8 ? 1 : 0;
        for (let flag = 0; flag < flags; flag++) {
          const fy = tip - flag * direction * 0.2;
          this.line([[sx, fy, 0.02], [sx + 0.2, fy - direction * 0.18, 0.02], [sx + 0.24, fy - direction * 0.38, 0.02]]);
        }
      }
      if (position.sharp) this.label('♯', x - 0.38, y, 0.49);
    }
    this.ledgerLines.setMarks(ledgerMarks);
  }

  drawSurfaceLight(time) {
    let count = 0;
    const stamp = (pose, color, opacity) => {
      if (!pose || pose.opacity <= 0) return;
      const height = Math.max(0, pose.z - 0.32);
      const radius = 1.45 + height * 0.45;
      this.lightStamp.position.set(pose.x, pose.y, -0.047);
      this.lightStamp.scale.set(radius * 2, radius * 2, 1);
      this.lightStamp.updateMatrix();
      this.surfaceLights.setMatrixAt(count, this.lightStamp.matrix);
      this.surfaceLights.setColorAt(count, color);
      this.surfaceOpacity.setX(count, opacity * pose.opacity / (1 + height * height * 0.65));
      count++;
    };
    if (this.showBall) {
      const latest = Math.floor(time / LIGHT_STEP) * LIGHT_STEP;
      for (const [hand, { color }] of Object.entries(this.handBalls)) {
        const guide = this.performance.guides[hand];
        stamp(handGuidePose(guide, time, SPACING, this.reduced), color, 0.28);
        for (let i = 0; i < LIGHT_CAPACITY / 2 - 1; i++) {
          const past = latest - i * LIGHT_STEP;
          if (past < 0) break;
          const age = time - past;
          const fade = Math.exp(-age / 1.15) * Math.max(0, 1 - age / LIGHT_LIFE);
          // Fixed musical timestamps keep footprints on the paper as the ball moves away.
          // Reconstructing them also makes pause, reverse seeks, and file changes deterministic.
          stamp(handGuidePose(guide, past, SPACING, this.reduced), color, fade * 0.06);
        }
      }
    }
    this.surfaceLights.count = count;
    this.surfaceLights.instanceMatrix.needsUpdate = true;
    if (this.surfaceLights.instanceColor) this.surfaceLights.instanceColor.needsUpdate = true;
    this.surfaceOpacity.needsUpdate = true;
  }

  draw(time, delta = 0.016) {
    if (!this.performance) return;
    const beat = Math.max(0, this.performance.header.secondsToTicks(Math.min(time, this.performance.end)) / this.performance.header.ppq);
    const chunk = Math.floor(beat / 4);
    if (chunk !== this.chunk) { this.rebuild(beat); this.chunk = chunk; }
    const target = beat * SPACING;
    // Follow the music clock exactly; smooth only changes in viewing angle and distance.
    // Translating both the camera and its target also keeps seeks centered immediately.
    this.camera.position.x += target - this.focus;
    this.focus = target;
    const overhead = this.view === 'overhead';
    const drift = cameraDrift(time, this.driftEnabled);
    const center = this.focus + (overhead ? 0 : drift.ahead);
    const framing = Math.max(1, 1.25 / this.camera.aspect);
    // Look across the staff from its bass side: time runs mainly left to right,
    // the left hand stays below the right, and the present sits near the center.
    this.camera.up.set(0, overhead ? 1 : 0, overhead ? 0 : 1);
    const cameraTarget = new THREE.Vector3(overhead ? center : center + drift.x * framing,
      this.centerY + (overhead ? -0.1 : drift.y * framing), (overhead ? 24 : drift.z) * this.heightScale * framing);
    this.camera.position.lerp(cameraTarget, 1 - Math.exp(-delta * 5));
    this.camera.lookAt(center, this.centerY + 0.05, 0);
    this.light.position.set(this.focus - 3, 5, 18);
    this.light.target.position.set(center, 0, 0);
    this.paper.position.x = this.paperEdge.position.x = this.focus;
    for (const { note, head, color } of this.noteMeshes) {
      const active = time >= note.time && time < note.end;
      head.material.color.setHex(active ? color : time >= note.end ? MUTED : INK);
      head.material.emissive.setHex(active ? color : 0x000000);
      head.material.emissiveIntensity = active ? 0.65 : 0;
      head.position.z = active ? 0.095 : 0.055;
    }
    this.ledgerLines.draw(time);
    for (const [hand, { ball, glow, light, tail }] of Object.entries(this.handBalls)) {
      tail.visible = this.showBall;
      tail.draw(this.performance.guides[hand], time, SPACING, this.reduced);
      const pose = handGuidePose(this.performance.guides[hand], time, SPACING, this.reduced);
      ball.visible = glow.visible = light.visible = this.showBall && !!pose && pose.opacity > 0;
      if (!pose) continue;
      ball.position.set(pose.x, pose.y, pose.z);
      ball.material.opacity = pose.opacity;
      glow.position.copy(ball.position);
      glow.material.opacity = pose.opacity * 0.1;
      light.position.copy(ball.position);
      light.intensity = pose.opacity * 9;
    }
    this.drawSurfaceLight(time);
    this.renderer.render(this.scene, this.camera);
  }
}
