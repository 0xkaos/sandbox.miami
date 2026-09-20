import * as THREE from 'three';
import { clamp, lowerBound, notePosition } from './performance.mjs';

const SPACING = 1.15;
const INK = 0x343c35, MUTED = 0xa3a595, TREBLE = 0xbd583e, BASS = 0x617764;

export class ScoreScene {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf3efe6);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.append(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 180);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc6bb9e, 2.8));
    this.light = new THREE.DirectionalLight(0xfff5df, 3.2);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    Object.assign(this.light.shadow.camera, { left: -18, right: 18, top: 12, bottom: -12 });
    this.light.shadow.bias = -0.0007;
    this.scene.add(this.light, this.light.target);
    this.paper = new THREE.Mesh(new THREE.BoxGeometry(80, 11, 0.07), new THREE.MeshStandardMaterial({ color: 0xf7f3ea, roughness: 1 }));
    this.paper.position.z = -0.09;
    this.paper.receiveShadow = true;
    this.scene.add(this.paper);
    this.paperEdge = new THREE.Mesh(new THREE.BoxGeometry(80, 11.04, 0.05), new THREE.MeshStandardMaterial({ color: 0xe5dece, roughness: 1 }));
    this.paperEdge.position.set(0, -0.035, -0.15);
    this.scene.add(this.paperEdge);
    this.score = new THREE.Group();
    this.scene.add(this.score);
    this.headGeometry = new THREE.SphereGeometry(1, 16, 8);
    this.ringGeometry = new THREE.TorusGeometry(0.12, 0.035, 6, 18);
    this.stemMaterial = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.72 });
    this.staffMaterial = new THREE.LineBasicMaterial({ color: 0xb0b1a2, transparent: true, opacity: 0.65 });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.19, 24, 16), new THREE.MeshStandardMaterial({ color: TREBLE, roughness: 0.28, metalness: 0.15 }));
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    this.halo = new THREE.Mesh(new THREE.RingGeometry(0.23, 0.25, 40), new THREE.MeshBasicMaterial({ color: TREBLE, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    this.scene.add(this.halo);
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
      const y = notePosition(note.midi).y;
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
    ctx.fillStyle = '#727969';
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
    const from = Math.max(-4, Math.floor(beat / 8) * 8 - 16), to = from + 64;
    for (const bottom of [-2.65, 1.05]) {
      for (let i = 0; i < 5; i++) this.line([[from * SPACING, bottom + i * 0.48, 0], [to * SPACING, bottom + i * 0.48, 0]], this.staffMaterial);
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
      const position = notePosition(note.midi);
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
    const chunk = Math.floor(beat / 8);
    if (chunk !== this.chunk) { this.rebuild(beat); this.chunk = chunk; }
    const target = beat * SPACING;
    if (Math.abs(target - this.focus) > 7) this.focus = target;
    this.focus += (target - this.focus) * (1 - Math.exp(-delta * 7));
    const center = this.focus + 4;
    const overhead = this.view === 'overhead';
    const narrow = this.camera.aspect < 1.5;
    const cameraTarget = new THREE.Vector3(center + (overhead ? 0 : 2.8), this.centerY + (overhead ? -0.1 : -8.6), (overhead ? 22 : 18) * this.heightScale);
    if (narrow) cameraTarget.z += 3;
    this.camera.position.lerp(cameraTarget, 1 - Math.exp(-delta * 5));
    this.camera.lookAt(center, this.centerY + 0.05, 0);
    this.light.position.set(center - 8, 10, 15);
    this.light.target.position.set(center, 0, 0);
    this.paper.position.x = center;
    this.paperEdge.position.x = center;
    for (const { note, head, color } of this.noteMeshes) {
      const active = time >= note.time && time < note.end;
      head.material.color.setHex(active ? color : time >= note.end ? MUTED : INK);
      head.material.emissive.setHex(active ? color : 0x000000);
      head.material.emissiveIntensity = active ? 0.16 : 0;
      head.position.z = active ? 0.095 : 0.055;
    }
    const melody = this.performance.melody;
    if (melody.length) {
      const nextIndex = lowerBound(melody, time + 0.00001);
      const a = melody[Math.max(0, nextIndex - 1)], b = melody[Math.min(melody.length - 1, nextIndex)];
      const fraction = clamp((time - a.time) / Math.max(0.01, b.time - a.time), 0, 1);
      const from = notePosition(a.midi), to = notePosition(b.midi);
      this.ball.position.set((a.beat + (b.beat - a.beat) * fraction) * SPACING,
        from.y + (to.y - from.y) * fraction,
        0.29 + (this.reduced ? 0 : Math.sin(fraction * Math.PI) * Math.min(1.5, 0.5 + (b.time - a.time) * 0.55)));
      this.halo.position.set(this.ball.position.x, this.ball.position.y, 0.025);
      this.halo.scale.setScalar(1 + (this.ball.position.z - 0.29) * 0.65);
      this.halo.material.opacity = 0.3 / (this.ball.position.z + 0.6);
      this.ball.visible = this.halo.visible = this.showBall && time <= this.performance.end;
    } else this.ball.visible = this.halo.visible = false;
    this.renderer.render(this.scene, this.camera);
  }
}
