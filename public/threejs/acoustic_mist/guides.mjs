import * as THREE from 'three';

function lines(positions, color, opacity) {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent:true, opacity, depthWrite:false }));
}
export function makeGuides(meta) {
    const c = meta.config, chamber = new THREE.Group(), segments = c.shape === 'cylinder' ? 64 : 4, rings = [];
    for (const end of [0, 1]) {
        const height = c.height * (c.shape === 'taper' && end ? 0.6 : 1), ring = [];
        for (let i = 0; i < segments; i++) {
            const angle = i / segments * Math.PI * 2;
            const yz = c.shape === 'cylinder' ? [Math.sin(angle)*height/2, Math.cos(angle)*c.depth/2]
                : [[-height/2,-c.depth/2],[height/2,-c.depth/2],[height/2,c.depth/2],[-height/2,c.depth/2]][i];
            ring.push([(end-0.5)*c.length, ...yz]);
        }
        rings.push(ring);
    }
    const outline = [];
    for (const ring of rings) for (let i = 0; i < segments; i++) outline.push(...ring[i], ...ring[(i+1)%segments]);
    for (let i = 0; i < segments; i += c.shape === 'cylinder' ? 8 : 1) outline.push(...rings[0][i], ...rings[1][i]);
    if (c.opening) for (let i = 0; i < 64; i++) for (const j of [i, i+1]) {
        const angle = j * Math.PI / 32;
        outline.push(c.length/2, Math.cos(angle)*c.openingSize/2, Math.sin(angle)*c.openingSize/2);
    }
    chamber.add(lines(outline, 0x92b3bd, 0.23));
    const hornLength = Math.min(c.height, c.depth)*0.32, positions = [];
    function point(t, angle) {
        const radius = meta.hornRadius * (0.18 + 0.82*t**2.1);
        return [-c.length/2 - hornLength*(1-t), radius*Math.cos(angle), radius*Math.sin(angle)];
    }
    for (let rib = 0; rib < 8; rib++) for (let s = 0; s < 16; s++) positions.push(...point(s/16, rib*Math.PI/4), ...point((s+1)/16, rib*Math.PI/4));
    for (const t of [0, 0.55, 1]) for (let s = 0; s < 64; s++) positions.push(...point(t, s*Math.PI/32), ...point(t, (s+1)*Math.PI/32));
    return { chamber, horn:lines(positions, 0xc39764, 0.6) };
}
export function disposeGuide(object) {
    if (!object) return;
    object.traverse(child => { child.geometry?.dispose(); child.material?.dispose(); });
    object.removeFromParent();
}
