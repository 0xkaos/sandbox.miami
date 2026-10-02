import * as THREE from 'three';
import { distanceKm } from './model.mjs';

const R = Math.PI / 180;
function position(lat, lon, radius) {
  return [radius * Math.cos(lat * R) * Math.cos(lon * R), radius * Math.sin(lat * R),
    -radius * Math.cos(lat * R) * Math.sin(lon * R)];
}

function dotTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(16, 16, 13, 0, Math.PI * 2); ctx.fill();
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Site and language datasets keep their own meanings and chronology. This
// class only renders dated/selected point records and supports local picking.
export class PointEvidenceLayer {
  constructor(scene, { size = 4, radius = 1.014, zoomLimit = 2.3, opacity = .88,
    stemBaseRadius = null, stemOpacity = .58 } = {}) {
    this.scene = scene;
    this.radius = radius;
    this.stemBaseRadius = stemBaseRadius;
    this.zoomLimit = zoomLimit;
    this.records = [];
    this.enabled = false;
    this.cameraDistance = Infinity;
    this.texture = dotTexture();
    this.mesh = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
      size, sizeAttenuation: false, vertexColors: true, map: this.texture,
      alphaTest: .15, transparent: true, opacity, depthWrite: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.stems = stemBaseRadius == null ? null : new THREE.LineSegments(
      new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: stemOpacity, depthWrite: false,
      }),
    );
    if (this.stems) {
      this.stems.frustumCulled = false;
      this.stems.renderOrder = 4.9;
      this.stems.visible = false;
      scene.add(this.stems);
    }
  }

  setRecords(records) {
    this.records = records;
    const positions = new Float32Array(records.length * 3);
    const colors = new Float32Array(records.length * 3);
    const stemPositions = this.stems ? new Float32Array(records.length * 6) : null;
    const stemColors = this.stems ? new Float32Array(records.length * 6) : null;
    const color = new THREE.Color();
    records.forEach((record, index) => {
      const head = position(record.lat, record.lon, this.radius);
      positions.set(head, index * 3);
      color.set(record.color ?? '#e4c28d');
      colors[index * 3] = color.r; colors[index * 3 + 1] = color.g; colors[index * 3 + 2] = color.b;
      if (stemPositions) {
        stemPositions.set(position(record.lat, record.lon, this.stemBaseRadius), index * 6);
        stemPositions.set(head, index * 6 + 3);
        for (let end = 0; end < 2; end++) {
          const offset = index * 6 + end * 3;
          stemColors[offset] = color.r;
          stemColors[offset + 1] = color.g;
          stemColors[offset + 2] = color.b;
        }
      }
    });
    const old = this.mesh.geometry;
    this.mesh.geometry = new THREE.BufferGeometry();
    this.mesh.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    old.dispose();
    if (this.stems) {
      const oldStems = this.stems.geometry;
      this.stems.geometry = new THREE.BufferGeometry();
      this.stems.geometry.setAttribute('position', new THREE.BufferAttribute(stemPositions, 3));
      this.stems.geometry.setAttribute('color', new THREE.BufferAttribute(stemColors, 3));
      oldStems.dispose();
    }
    this.mesh.visible = this.enabled && records.length > 0 && this.cameraDistance <= this.zoomLimit;
    if (this.stems) this.stems.visible = this.mesh.visible;
  }

  setVisible(enabled, cameraDistance) {
    const old = this.mesh.visible;
    this.enabled = enabled;
    this.cameraDistance = cameraDistance;
    this.mesh.visible = enabled && this.records.length > 0 && cameraDistance <= this.zoomLimit;
    if (this.stems) this.stems.visible = this.mesh.visible;
    return old !== this.mesh.visible;
  }

  nearest(lat, lon, maxKm = 35) {
    let best = null, bestDistance = maxKm;
    const lonWindow = maxKm / (111 * Math.max(.1, Math.cos(lat * R)));
    for (const record of this.records) {
      const wrappedLonDistance = Math.abs(((record.lon - lon + 540) % 360) - 180);
      if (Math.abs(record.lat - lat) > maxKm / 111 || wrappedLonDistance > lonWindow) continue;
      const distance = distanceKm(lat, lon, record.lat, record.lon);
      if (distance < bestDistance) { best = record; bestDistance = distance; }
    }
    return best;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.texture.dispose();
    if (this.stems) {
      this.scene.remove(this.stems);
      this.stems.geometry.dispose(); this.stems.material.dispose();
    }
  }
}
