import * as THREE from 'three';
import { distanceKm } from './model.mjs';

const R = Math.PI / 180;
function position(lat, lon, radius) {
  return [radius * Math.cos(lat * R) * Math.cos(lon * R), radius * Math.sin(lat * R),
    -radius * Math.cos(lat * R) * Math.sin(lon * R)];
}

function markerTexture(shape = 'circle') {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.beginPath();
  if (shape === 'diamond') { ctx.moveTo(16, 2); ctx.lineTo(30, 16); ctx.lineTo(16, 30); ctx.lineTo(2, 16); }
  else if (shape === 'hexagon') { for (let index = 0; index < 6; index++) { const angle = -Math.PI / 2 + index * Math.PI / 3; const x = 16 + 14 * Math.cos(angle), y = 16 + 14 * Math.sin(angle); if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y); } }
  else if (shape === 'triangle-down') { ctx.moveTo(2, 4); ctx.lineTo(30, 4); ctx.lineTo(16, 29); }
  else if (shape === 'triangle') { ctx.moveTo(16, 3); ctx.lineTo(30, 28); ctx.lineTo(2, 28); }
  else if (shape === 'square') ctx.rect(4, 4, 24, 24);
  else ctx.arc(16, 16, 13, 0, Math.PI * 2);
  ctx.closePath(); ctx.fill();
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function uncertaintyOpacity(years) {
  if (!Number.isFinite(years) || years < 10_000) return 1;
  if (years <= 20_000) return .7;
  if (years <= 100_000) return .45;
  return .25;
}

// Site and language datasets keep their own meanings and chronology. This
// class only renders dated/selected point records and supports local picking.
export class PointEvidenceLayer {
  constructor(scene, { size = 4, radius = 1.014, zoomLimit = 2.3, opacity = .88,
    stemBaseRadius = null, stemOpacity = .58, accentStemBaseRadius = null, accentStemOpacity = .9, shape = 'circle' } = {}) {
    this.scene = scene;
    this.radius = radius;
    this.stemBaseRadius = stemBaseRadius;
    this.accentStemBaseRadius = accentStemBaseRadius;
    this.zoomLimit = zoomLimit;
    this.records = [];
    this.enabled = false;
    this.cameraDistance = Infinity;
    this.texture = markerTexture(shape);
    const material = new THREE.PointsMaterial({
      size, sizeAttenuation: false, vertexColors: true, map: this.texture,
      alphaTest: .15, transparent: true, opacity, depthWrite: false,
    });
    material.onBeforeCompile = shader => {
      shader.vertexShader = `attribute float uncertaintyOpacity; varying float vUncertaintyOpacity;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvUncertaintyOpacity = uncertaintyOpacity;');
      shader.fragmentShader = `varying float vUncertaintyOpacity;\n${shader.fragmentShader}`.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vUncertaintyOpacity;');
    };
    this.mesh = new THREE.Points(new THREE.BufferGeometry(), material);
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
    this.accentStems = accentStemBaseRadius == null ? null : new THREE.LineSegments(
      new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: accentStemOpacity, depthWrite: false,
      }),
    );
    if (this.accentStems) {
      this.accentStems.frustumCulled = false;
      this.accentStems.renderOrder = 5.1;
      this.accentStems.visible = false;
      scene.add(this.accentStems);
    }
    this.accentCaps = accentStemBaseRadius == null ? null : new THREE.Points(
      new THREE.BufferGeometry(), new THREE.PointsMaterial({
        size: 3.1, sizeAttenuation: false, vertexColors: true, map: markerTexture(), alphaTest: .15,
        transparent: true, opacity: accentStemOpacity, depthWrite: false,
      }),
    );
    if (this.accentCaps) {
      this.accentCaps.frustumCulled = false;
      this.accentCaps.renderOrder = 5.2;
      this.accentCaps.visible = false;
      scene.add(this.accentCaps);
    }
  }

  setRecords(records) {
    this.records = records;
    const positions = new Float32Array(records.length * 3);
    const colors = new Float32Array(records.length * 3);
    const opacities = new Float32Array(records.length);
    const stemPositions = this.stems ? new Float32Array(records.length * 6) : null;
    const stemColors = this.stems ? new Float32Array(records.length * 6) : null;
    const accentRecords = this.accentStems ? records.filter(record => record.accentStem) : [];
    const accentPositions = this.accentStems ? new Float32Array(accentRecords.length * 6) : null;
    const accentColors = this.accentStems ? new Float32Array(accentRecords.length * 6) : null;
    const accentCapPositions = this.accentCaps ? new Float32Array(accentRecords.length * 6) : null;
    const accentCapColors = this.accentCaps ? new Float32Array(accentRecords.length * 6) : null;
    const color = new THREE.Color();
    records.forEach((record, index) => {
      const head = position(record.lat, record.lon, this.radius + (record.stackOffset ?? 0));
      positions.set(head, index * 3);
      color.set(record.color ?? '#e4c28d');
      colors[index * 3] = color.r; colors[index * 3 + 1] = color.g; colors[index * 3 + 2] = color.b;
      opacities[index] = uncertaintyOpacity(record.uncertaintyYears);
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
    accentRecords.forEach((record, index) => {
      const head = position(record.lat, record.lon, this.radius);
      const tip = position(record.lat, record.lon, this.accentStemBaseRadius);
      color.set(record.color ?? '#e4c28d');
      accentPositions.set(head, index * 6);
      accentPositions.set(tip, index * 6 + 3);
      accentCapPositions.set(head, index * 6);
      accentCapPositions.set(tip, index * 6 + 3);
      for (let end = 0; end < 2; end++) {
        const offset = index * 6 + end * 3;
        accentColors[offset] = color.r;
        accentColors[offset + 1] = color.g;
        accentColors[offset + 2] = color.b;
        accentCapColors[offset] = color.r;
        accentCapColors[offset + 1] = color.g;
        accentCapColors[offset + 2] = color.b;
      }
    });
    const old = this.mesh.geometry;
    this.mesh.geometry = new THREE.BufferGeometry();
    this.mesh.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.mesh.geometry.setAttribute('uncertaintyOpacity', new THREE.BufferAttribute(opacities, 1));
    old.dispose();
    if (this.stems) {
      const oldStems = this.stems.geometry;
      this.stems.geometry = new THREE.BufferGeometry();
      this.stems.geometry.setAttribute('position', new THREE.BufferAttribute(stemPositions, 3));
      this.stems.geometry.setAttribute('color', new THREE.BufferAttribute(stemColors, 3));
      oldStems.dispose();
    }
    if (this.accentStems) {
      const oldAccentStems = this.accentStems.geometry;
      this.accentStems.geometry = new THREE.BufferGeometry();
      this.accentStems.geometry.setAttribute('position', new THREE.BufferAttribute(accentPositions, 3));
      this.accentStems.geometry.setAttribute('color', new THREE.BufferAttribute(accentColors, 3));
      oldAccentStems.dispose();
    }
    if (this.accentCaps) {
      const oldAccentCaps = this.accentCaps.geometry;
      this.accentCaps.geometry = new THREE.BufferGeometry();
      this.accentCaps.geometry.setAttribute('position', new THREE.BufferAttribute(accentCapPositions, 3));
      this.accentCaps.geometry.setAttribute('color', new THREE.BufferAttribute(accentCapColors, 3));
      oldAccentCaps.dispose();
    }
    this.mesh.visible = this.enabled && records.length > 0 && this.cameraDistance <= this.zoomLimit;
    if (this.stems) this.stems.visible = this.mesh.visible;
    if (this.accentStems) this.accentStems.visible = this.mesh.visible && accentRecords.length > 0;
    if (this.accentCaps) this.accentCaps.visible = this.mesh.visible && accentRecords.length > 0;
  }

  setVisible(enabled, cameraDistance) {
    const old = this.mesh.visible;
    this.enabled = enabled;
    this.cameraDistance = cameraDistance;
    this.mesh.visible = enabled && this.records.length > 0 && cameraDistance <= this.zoomLimit;
    if (this.stems) this.stems.visible = this.mesh.visible;
    if (this.accentStems) this.accentStems.visible = this.mesh.visible && this.records.some(record => record.accentStem);
    if (this.accentCaps) this.accentCaps.visible = this.mesh.visible && this.records.some(record => record.accentStem);
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

  nearestScreen(camera, width, height, x, y, maxPixels = 10) {
    let best = null, bestDistance = maxPixels;
    const positions = this.mesh.geometry.getAttribute('position');
    if (!positions) return null;
    const point = new THREE.Vector3(), cameraNormal = camera.position.clone().normalize(), horizon = 1 / camera.position.length();
    for (let index = 0; index < this.records.length; index++) {
      point.fromBufferAttribute(positions, index);
      if (point.clone().normalize().dot(cameraNormal) <= horizon) continue;
      point.project(camera);
      if (point.z < -1 || point.z > 1) continue;
      const dx = (point.x * .5 + .5) * width - x, dy = (-point.y * .5 + .5) * height - y;
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) { best = this.records[index]; bestDistance = distance; }
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
    if (this.accentStems) {
      this.scene.remove(this.accentStems);
      this.accentStems.geometry.dispose(); this.accentStems.material.dispose();
    }
    if (this.accentCaps) {
      this.scene.remove(this.accentCaps);
      this.accentCaps.geometry.dispose(); this.accentCaps.material.map.dispose(); this.accentCaps.material.dispose();
    }
  }
}
