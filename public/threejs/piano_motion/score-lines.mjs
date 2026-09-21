import * as THREE from 'three';
import { clamp, handGuidePose } from './performance.mjs';

const TAIL_LIFE = 1.8, TAIL_SEGMENTS = 216;
const LEDGER_RADIUS = 1.35, LEDGER_SEGMENTS = 16;
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

function fadingMaterial(color, opacity) {
  const material = new THREE.LineBasicMaterial({ color, opacity, transparent: true, depthWrite: false });
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float fade; varying float vFade;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = fade;');
    shader.fragmentShader = 'varying float vFade;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vFade;');
  };
  material.customProgramCacheKey = () => 'piano-fading-line-v1';
  return material;
}

export class BounceTail extends THREE.LineSegments {
  constructor(color) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TAIL_SEGMENTS * 6), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('fade', new THREE.BufferAttribute(new Float32Array(TAIL_SEGMENTS * 2), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    super(geometry, fadingMaterial(color, 0.7));
    this.frustumCulled = false;
    this.renderOrder = 1;
  }

  draw(guide, time, spacing, reduced) {
    const positions = this.geometry.getAttribute('position'), fades = this.geometry.getAttribute('fade');
    let count = 0;
    let previous = handGuidePose(guide, time, spacing, reduced), previousFade = previous?.opacity || 0;
    // Rebuild a continuous polyline from musical time, including its height above the sheet.
    // Reusing these buffers keeps pauses and seeks deterministic without accumulating history.
    for (let i = 1; i <= TAIL_SEGMENTS && previous; i++) {
      const age = i / TAIL_SEGMENTS * TAIL_LIFE;
      if (time < age) break;
      const pose = handGuidePose(guide, time - age, spacing, reduced);
      const fade = (1 - age / TAIL_LIFE) ** 1.7 * pose.opacity;
      // The guide vanishes between rests and entrances. Don't join across that invisible jump
      // or leave a dot where a resting ball stays still.
      const distance = Math.hypot(pose.x - previous.x, pose.y - previous.y, pose.z - previous.z);
      if (pose.opacity > 0.08 && previous.opacity > 0.08 && distance > 0.00001) {
        positions.setXYZ(count, previous.x, previous.y, previous.z);
        fades.setX(count++, previousFade);
        positions.setXYZ(count, pose.x, pose.y, pose.z);
        fades.setX(count++, fade);
      }
      previous = pose; previousFade = fade;
    }
    this.geometry.setDrawRange(0, count);
    positions.needsUpdate = fades.needsUpdate = true;
  }
}

export class LedgerLines extends THREE.LineSegments {
  constructor() {
    super(new THREE.BufferGeometry(), fadingMaterial(0x91adbe, 0.62));
    this.frustumCulled = false;
    this.marks = [];
  }

  setMarks(marks) {
    // Chord tones often share ledger lines; draw each location once to avoid stacked brightness.
    const unique = new Map();
    for (const mark of marks) {
      const key = `${mark.x.toFixed(3)}:${mark.y.toFixed(3)}`;
      const existing = unique.get(key);
      if (existing) {
        existing.start = Math.min(existing.start, mark.start);
        existing.end = Math.max(existing.end, mark.end);
      } else unique.set(key, { ...mark });
    }
    this.marks = [...unique.values()];
    const vertices = this.marks.length * LEDGER_SEGMENTS * 2;
    const positions = new Float32Array(vertices * 3), fades = new Float32Array(vertices);
    this.edgeFade = new Float32Array(vertices);
    let offset = 0;
    for (const mark of this.marks) {
      mark.offset = offset;
      for (let segment = 0; segment < LEDGER_SEGMENTS; segment++) {
        for (const point of [segment, segment + 1]) {
          const fraction = point / LEDGER_SEGMENTS;
          positions.set([mark.x + (fraction * 2 - 1) * LEDGER_RADIUS, mark.y, 0.012], offset * 3);
          this.edgeFade[offset++] = Math.sin(fraction * Math.PI) ** 2;
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('fade', new THREE.BufferAttribute(fades, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.dispose();
    this.geometry = geometry;
  }

  draw(time) {
    const fades = this.geometry.getAttribute('fade');
    if (!fades) return;
    for (const mark of this.marks) {
      const approach = smooth((time - mark.start + 2.6) / 2.6);
      const release = 1 - smooth((time - mark.end) / 2.8);
      // Keep a faint guide for future/past notes, with a gentle lift around the present.
      const opacity = 0.18 + 0.82 * approach * release;
      for (let i = mark.offset; i < mark.offset + LEDGER_SEGMENTS * 2; i++) fades.setX(i, this.edgeFade[i] * opacity);
    }
    fades.needsUpdate = true;
  }
}
