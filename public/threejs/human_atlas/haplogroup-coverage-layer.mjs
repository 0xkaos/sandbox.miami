import * as THREE from 'three';

const TEXTURE_WIDTH = 2048;
const TEXTURE_HEIGHT = TEXTURE_WIDTH / 2;
const R = Math.PI / 180;

function xy(lat, lon) {
  return [(lon + 180) / 360 * TEXTURE_WIDTH, (90 - lat) / 180 * TEXTURE_HEIGHT];
}
function colorForAge(age) {
  return `hsl(${220 - age * 220} 88% 58%)`;
}
function transparentColorForAge(age) {
  return `hsl(${220 - age * 220} 88% 58% / 0)`;
}

// This layer describes dated sample coverage, not a reconstructed population
// territory. Locations join only when their sampled findspots are nearby.
export class HaplogroupCoverageLayer {
  constructor(scene, surfaceGeometry, radius) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = TEXTURE_WIDTH; this.canvas.height = TEXTURE_HEIGHT;
    this.context = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.minFilter = THREE.LinearFilter;
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: { coverageMap: { value: this.texture }, texel: { value: new THREE.Vector2(1 / TEXTURE_WIDTH, 1 / TEXTURE_HEIGHT) } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `uniform sampler2D coverageMap; varying vec2 vUv;
        void main(){vec4 coverage=texture2D(coverageMap,vUv);if(coverage.a<0.015)discard;gl_FragColor=vec4(coverage.rgb,coverage.a*.58);}`,
    });
    this.mesh = new THREE.Mesh(surfaceGeometry.clone(), this.material);
    this.mesh.scale.setScalar(radius + .004);
    this.mesh.renderOrder = 4.6;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.scene = scene; this.records = []; this.enabled = false; this.recordKey = '';
  }
  setRecords(records = []) {
    const recordKey = records.map(record => record.id).join('|');
    if (recordKey === this.recordKey) return;
    this.recordKey = recordKey;
    this.records = records;
    const ctx = this.context;
    ctx.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
    if (!records.length) { this.texture.needsUpdate = true; this.mesh.visible = false; return; }
    const first = Math.min(...records.map(record => record.firstYear));
    const last = Math.max(...records.map(record => record.firstYear));
    const span = Math.max(1, last - first);
    const nodes = records.map(record => {
      const [x, y] = xy(record.lat, record.lon);
      const age = (record.firstYear - first) / span;
      const radiusY = 12;
      return { ...record, x, y, radiusY, radiusX: radiusY / Math.max(.22, Math.cos(record.lat * R)), color: colorForAge(age), transparentColor: transparentColorForAge(age) };
    });
    ctx.globalCompositeOperation = 'source-over';
    for (const node of nodes) for (const shift of [-TEXTURE_WIDTH, 0, TEXTURE_WIDTH]) {
      const gradient = ctx.createRadialGradient(node.x + shift, node.y, 0, node.x + shift, node.y, node.radiusY);
      gradient.addColorStop(0, node.color); gradient.addColorStop(.28, node.color); gradient.addColorStop(.72, node.transparentColor);
      ctx.globalAlpha = .7; ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.ellipse(node.x + shift, node.y, node.radiusX, node.radiusY, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.texture.needsUpdate = true;
    this.mesh.visible = this.enabled;
  }
  setVisible(enabled) { this.enabled = enabled; this.mesh.visible = enabled && this.records.length > 0; }
  dispose() { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.material.dispose(); this.texture.dispose(); }
}