import * as THREE from 'three';

// A source-specific detail layer stays in its own geographic window. Replacing
// one dated map crossfades its premultiplied color so overlapping areas do not
// blink or darken while the timeline is playing.
export class CroppedAreaLayer {
  constructor(scene, sphereGeometry, bounds, { width = 2048, height = 1344, renderOrder = 2.1 } = {}) {
    this.bounds = bounds;
    this.width = width;
    this.height = height;
    const blank = document.createElement('canvas'); blank.width = 2; blank.height = 2;
    this.empty = this.texture(blank);
    this.uniforms = {
      oldMap: { value: this.empty }, map: { value: this.empty }, weight: { value: 1 },
      bounds: { value: new THREE.Vector4((bounds.west + 180) / 360, (bounds.south + 90) / 180,
        (bounds.east - bounds.west) / 360, (bounds.north - bounds.south) / 180) },
    };
    this.mesh = new THREE.Mesh(sphereGeometry.clone(), new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `uniform sampler2D oldMap,map; uniform float weight; uniform vec4 bounds; varying vec2 vUv;
        void main(){vec2 uv=(vUv-bounds.xy)/bounds.zw;
          if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0){gl_FragColor=vec4(0.0);return;}
          vec4 a=texture2D(oldMap,uv),b=texture2D(map,uv);
          float alpha=mix(a.a,b.a,weight);
          vec3 rgb=mix(a.rgb*a.a,b.rgb*b.a,weight)/max(alpha,0.00001);
          gl_FragColor=vec4(rgb,alpha);
          #include <colorspace_fragment>
        }`,
    }));
    this.mesh.scale.setScalar(1.005);
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.scene = scene;
    this.key = null;
    this.current = null;
    this.previous = null;
    this.pending = null;
    this.fade = 1;
    this.enabled = true;
  }

  texture(canvas) {
    const value = new THREE.CanvasTexture(canvas);
    value.colorSpace = THREE.SRGBColorSpace;
    value.anisotropy = 4;
    return value;
  }

  draw(areas) {
    if (!areas.length) return this.empty;
    const canvas = document.createElement('canvas');
    canvas.width = this.width; canvas.height = this.height;
    const ctx = canvas.getContext('2d');
    const { west, east, south, north } = this.bounds;
    // Cultural horizons are drawn first. A polity or named people can overlap
    // them without implying that the cultural material suddenly disappeared.
    const ordered = [...areas].sort((a, b) => (a.kind === 'culture' ? 0 : 1) - (b.kind === 'culture' ? 0 : 1)
      || (b.area ?? 0) - (a.area ?? 0));
    for (const area of ordered) {
      const polys = area.geometry.type === 'Polygon' ? [area.geometry.coordinates]
        : area.geometry.type === 'MultiPolygon' ? area.geometry.coordinates : [];
      ctx.beginPath();
      for (const polygon of polys) for (const ring of polygon) {
        ring.forEach(([lon, lat], index) => {
          const x = (lon - west) / (east - west) * this.width;
          const y = (north - lat) / (north - south) * this.height;
          if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
      ctx.fillStyle = area.color ?? '#b7a787';
      ctx.globalAlpha = area.opacity ?? (area.kind === 'culture' ? .28 : area.confidence === 'schematic' ? .48 : .66);
      ctx.fill('evenodd');
      ctx.globalAlpha = area.kind === 'culture' ? .82 : .95;
      ctx.lineWidth = area.confidence === 'schematic' ? 1.5 : 1;
      ctx.setLineDash(area.confidence === 'schematic' ? [4, 3] : []);
      ctx.strokeStyle = area.color ?? '#b7a787';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    return this.texture(canvas);
  }

  begin(next) {
    this.previous = this.current;
    this.current = next.texture;
    this.key = next.key;
    this.fade = 0;
    this.uniforms.oldMap.value = this.previous ?? this.empty;
    this.uniforms.map.value = this.current;
    this.uniforms.weight.value = 0;
    this.updateVisibility();
  }

  setAreas(areas) {
    const key = areas.map(area => area.id).join('|');
    if (key === this.key && this.pending) {
      if (this.pending.texture !== this.empty) this.pending.texture.dispose();
      this.pending = null;
    }
    if (key === this.key || key === this.pending?.key) return false;
    const next = { key, texture: this.draw(areas) };
    if (this.fade < 1) {
      if (this.pending?.texture !== this.empty) this.pending?.texture.dispose();
      this.pending = next;
    } else this.begin(next);
    return true;
  }

  advance(dt) {
    if (this.fade >= 1) return false;
    this.fade = Math.min(1, this.fade + Math.max(0, dt) / .28);
    this.uniforms.weight.value = this.fade * this.fade * (3 - 2 * this.fade);
    if (this.fade === 1) {
      if (this.previous && this.previous !== this.empty && this.previous !== this.current) this.previous.dispose();
      this.previous = null;
      this.uniforms.oldMap.value = this.current;
      if (this.pending) {
        const next = this.pending;
        this.pending = null;
        this.begin(next);
      } else this.updateVisibility();
    }
    return true;
  }

  setVisible(enabled) {
    this.enabled = enabled;
    this.updateVisibility();
  }

  updateVisibility() {
    this.mesh.visible = this.enabled && !!this.current && (this.current !== this.empty || this.fade < 1);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    for (const texture of new Set([this.current, this.previous, this.pending?.texture, this.empty])) texture?.dispose();
  }
}
