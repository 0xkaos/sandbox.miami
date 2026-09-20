import * as THREE from 'three';
import { handGuidePose, lowerBound, notePosition } from './performance.mjs';

const SPACING = 8;
const INK = 0xaebfc9, MUTED = 0x354650, TREBLE = 0xefaa83, BASS = 0x77c8cf;

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
    this.headGeometry = new THREE.SphereGeometry(1, 16, 8);
    this.ringGeometry = new THREE.TorusGeometry(0.12, 0.035, 6, 18);
    this.stemMaterial = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.72 });
    this.staffMaterial = new THREE.LineBasicMaterial({ color: 0x5b7788, transparent: true, opacity: 0.65 });
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 64;
    const glowContext = glowCanvas.getContext('2d');
    const gradient = glowContext.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(0.15, '#ffffff80'); gradient.addColorStop(1, '#ffffff00');
    glowContext.fillStyle = gradient; glowContext.fillRect(0, 0, 64, 64);
    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    this.handBalls = {};
    for (const [hand, color] of [['right', TREBLE], ['left', BASS]]) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.23, 24, 16), new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.7, roughness: 0.24, metalness: 0.2, transparent: true,
      }));
      ball.castShadow = true;
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.29, 0.32, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.set(1.8, 1.8, 1.8);
      const light = new THREE.PointLight(color, 3, 5);
      this.handBalls[hand] = { ball, halo, glow, light };
      this.scene.add(ball, halo, glow, light);
    }
    this.view = 'drift';
    this.showBall = true;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    this.focus = 0;
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
    const from = Math.max(-2, Math.floor(beat / 4) * 4 - 6), to = from + 36;
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
      for (let ledger = bottom - 0.48; ledger >= y - 0.025; ledger -= 0.48) this.line([[x - 0.29, ledger, 0.012], [x + 0.29, ledger, 0.012]]);
      for (let ledger = top + 0.48; ledger <= y + 0.025; ledger += 0.48) this.line([[x - 0.29, ledger, 0.012], [x + 0.29, ledger, 0.012]]);
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
  }

  draw(time, delta = 0.016) {
    if (!this.performance) return;
    const beat = Math.max(0, this.performance.header.secondsToTicks(Math.min(time, this.performance.end)) / this.performance.header.ppq);
    const chunk = Math.floor(beat / 4);
    if (chunk !== this.chunk) { this.rebuild(beat); this.chunk = chunk; }
    const target = beat * SPACING;
    if (Math.abs(target - this.focus) > SPACING * 4) this.focus = target;
    this.focus += (target - this.focus) * (1 - Math.exp(-delta * 7));
    const center = this.focus + 10;
    const overhead = this.view === 'overhead';
    const narrow = this.camera.aspect < 1.5;
    // Ride behind the notes, looking along +X (musical time), with a slight diagonal across both hands.
    this.camera.up.set(0, overhead ? 1 : 0, overhead ? 0 : 1);
    const cameraTarget = new THREE.Vector3(overhead ? center : this.focus - 14,
      this.centerY + (overhead ? -0.1 : -8), (overhead ? 24 : 14) * this.heightScale);
    if (narrow) cameraTarget.z += 4;
    this.camera.position.lerp(cameraTarget, 1 - Math.exp(-delta * 5));
    this.camera.lookAt(center, this.centerY + 0.05, 0);
    this.light.position.set(this.focus - 3, 5, 18);
    this.light.target.position.set(center, 0, 0);
    this.paper.position.x = this.paperEdge.position.x = this.focus + 80;
    for (const { note, head, color } of this.noteMeshes) {
      const active = time >= note.time && time < note.end;
      head.material.color.setHex(active ? color : time >= note.end ? MUTED : INK);
      head.material.emissive.setHex(active ? color : 0x000000);
      head.material.emissiveIntensity = active ? 0.65 : 0;
      head.position.z = active ? 0.095 : 0.055;
    }
    for (const [hand, { ball, halo, glow, light }] of Object.entries(this.handBalls)) {
      const pose = handGuidePose(this.performance.guides[hand], time, SPACING, this.reduced);
      ball.visible = halo.visible = glow.visible = light.visible = this.showBall && !!pose && pose.opacity > 0;
      if (!pose) continue;
      ball.position.set(pose.x, pose.y, pose.z);
      ball.material.opacity = pose.opacity;
      glow.position.copy(ball.position);
      glow.material.opacity = pose.opacity * 0.48;
      light.position.copy(ball.position);
      light.intensity = pose.opacity * 3;
      halo.position.set(pose.x, pose.y, 0.025);
      halo.scale.setScalar(1 + (pose.z - 0.32) * 0.65);
      halo.material.opacity = pose.opacity * 0.4 / (pose.z + 0.6);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
