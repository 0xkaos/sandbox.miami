import * as THREE from 'three';
import { clamp, lowerBound } from './performance.mjs';
import { handPathEdgePose, MAX_HAND_BALLS } from './hand-paths.mjs';

const TAIL_LIFE = 1.8, TAIL_SEGMENTS = 216;
const TAIL_CAPACITY = (TAIL_SEGMENTS + 64) * MAX_HAND_BALLS;
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
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TAIL_CAPACITY * 6), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('fade', new THREE.BufferAttribute(new Float32Array(TAIL_CAPACITY * 2), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    super(geometry, fadingMaterial(color, 0.7));
    this.frustumCulled = false;
    this.renderOrder = 1;
  }

  draw(path, time, spacing, reduced) {
    const positions = this.geometry.getAttribute('position'), fades = this.geometry.getAttribute('fade');
    let count = 0;
    const from = Math.max(0, time - TAIL_LIFE);
    const first = lowerBound(path.sections, from, 'end');
    const last = lowerBound(path.sections, time + 1e-7) - 1;
    const alpha = (pose, at) => Math.max(0, 1 - (time - at) / TAIL_LIFE) ** 1.7 * pose.opacity;
    // Draw actual graph edges, so a tail forks at its source and joins at its destination.
    // Sampling a ball's slot across chord changes would incorrectly connect unrelated voices.
    for (let sectionIndex = last; sectionIndex >= first; sectionIndex--) {
      const section = path.sections[sectionIndex];
      const start = Math.max(from, section.time), end = Math.min(time, section.end);
      const steps = Math.ceil((end - start) / TAIL_LIFE * TAIL_SEGMENTS);
      for (const edge of section.edges) {
        let previous = handPathEdgePose(edge, end, spacing, reduced), previousFade = alpha(previous, end);
        for (let i = 1; i <= steps && count + 2 <= positions.count; i++) {
          const at = end - (end - start) * i / steps;
          const pose = handPathEdgePose(edge, at, spacing, reduced), fade = alpha(pose, at);
          const distance = Math.hypot(pose.x - previous.x, pose.y - previous.y, pose.z - previous.z);
          if (pose.opacity > 0.08 && previous.opacity > 0.08 && distance > 0.00001) {
            positions.setXYZ(count, previous.x, previous.y, previous.z);
            fades.setX(count++, previousFade);
            positions.setXYZ(count, pose.x, pose.y, pose.z);
            fades.setX(count++, fade);
          }
          previous = pose; previousFade = fade;
        }
      }
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
