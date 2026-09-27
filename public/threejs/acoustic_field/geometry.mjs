// Geometry generation is independent of Three.js and runs in a disposable worker.
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, s) => a.map(v => v * s);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = a => mul(a, 1 / (Math.hypot(...a) || 1));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function random(seed = 847) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }

export class EnergyField {
    constructor(snapshot, smoothing = 1) {
        this.meta = snapshot.meta; this.dims = snapshot.meta.dimensions; this.mask = snapshot.mask;
        this.cell = snapshot.meta.config.cell;
        this.origin = snapshot.meta.min.map(v => v + this.cell / 2);
        const [nx, ny, nz] = this.dims, size = nx * ny * nz;
        let sum = 0, count = 0;
        for (let i = 0; i < size; i++) if (this.mask[i] === 1) { sum += snapshot.energy[i]; count++; }
        this.mean = sum / Math.max(1, count);
        this.values = Float32Array.from(snapshot.energy, v => v / Math.max(this.mean, 1e-20));
        const offsets = [-1, 1, -nx, nx, -nx*ny, nx*ny];
        // Mask-aware diffusion: never blur exterior/solid zeroes into the chamber.
        for (let pass = 0; pass < clamp(Math.round(smoothing), 0, 4); pass++) {
            const next = this.values.slice();
            for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
                const i = this.index(x, y, z); if (this.mask[i] !== 1) continue;
                let value = this.values[i] * 4, weight = 4;
                const allowed = [x>0, x<nx-1, y>0, y<ny-1, z>0, z<nz-1];
                for (let a = 0; a < 6; a++) if (allowed[a] && this.mask[i + offsets[a]] === 1) { value += this.values[i + offsets[a]]; weight++; }
                next[i] = value / weight;
            }
            this.values = next;
        }
        this.gradients = Array.from({ length: 3 }, () => new Float32Array(size));
        for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
            const i = this.index(x, y, z); if (this.mask[i] !== 1) continue;
            [x, y, z].forEach((c, axis) => {
                const stride = [1, nx, nx*ny][axis], lo = i-stride, hi = i+stride;
                const a = c > 0 && this.mask[lo] === 1 ? this.values[lo] : this.values[i];
                const b = c < this.dims[axis]-1 && this.mask[hi] === 1 ? this.values[hi] : this.values[i];
                this.gradients[axis][i] = (b-a) / (2*this.cell);
            });
        }
    }
    index(x, y, z) { return x + this.dims[0]*(y + this.dims[1]*z); }
    position(x, y, z) { return [x, y, z].map((v, a) => this.origin[a] + v*this.cell); }
    sample(p, values = this.values) {
        const q = p.map((v, a) => (v-this.origin[a])/this.cell);
        if (q.some((v, a) => v < -1e-6 || v > this.dims[a]-1+1e-6)) return null;
        const base = q.map((v, a) => Math.min(this.dims[a]-2, Math.max(0, Math.floor(v))));
        const t = q.map((v, a) => clamp(v-base[a], 0, 1));
        let value = 0;
        for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
            const weight = (x?t[0]:1-t[0])*(y?t[1]:1-t[1])*(z?t[2]:1-t[2]);
            if (weight < 1e-9) continue;
            const i = this.index(base[0]+x, base[1]+y, base[2]+z);
            if (this.mask[i] !== 1) return null;
            value += weight*values[i];
        }
        return value;
    }
    gradient(p) { return this.gradients.map(g => this.sample(p, g) ?? 0); }
}

// Marching squares, joined by shared endpoints into actual continuous polylines.
export function contours(field, level, axis = 1, slices = 36) {
    const uv = [0, 1, 2].filter(a => a !== axis), [u, v] = uv;
    const paths = [], { dims, origin, cell } = field;
    for (let slice = 0; slice < slices; slice++) {
        const fixed = origin[axis] + (dims[axis]-1)*cell*(slice+0.5)/slices;
        const point = (a, b) => { const p = [...origin]; p[axis] = fixed; p[u] += a*cell; p[v] += b*cell; return p; };
        const nodes = new Map(), edges = [];
        const key = p => p.map(c => c.toFixed(7)).join(',');
        function segment(a, b) {
            if (Math.hypot(...sub(a,b)) < 1e-8) return;
            const ids = [a,b].map(p => { const id = key(p); if (!nodes.has(id)) nodes.set(id, { p, edges: [] }); return id; });
            const index = edges.length; edges.push(ids); ids.forEach(id => nodes.get(id).edges.push(index));
        }
        for (let b = 0; b < dims[v]-1; b++) for (let a = 0; a < dims[u]-1; a++) {
            const p = [point(a,b), point(a+1,b), point(a+1,b+1), point(a,b+1)];
            const values = p.map(q => field.sample(q));
            if (values.includes(null)) continue;
            const hits = [];
            for (let e = 0; e < 4; e++) {
                const j = (e+1)%4;
                if ((values[e] >= level) !== (values[j] >= level)) hits.push({ edge:e, p:mix(p[e],p[j],(level-values[e])/(values[j]-values[e])) });
            }
            if (hits.length === 2) segment(hits[0].p, hits[1].p);
            else if (hits.length === 4) {
                // Asymptotic decider for the bilinear saddle; avoid arbitrary crossings.
                const f = values.map(v => v-level), positive = f[0]*f[2] - f[1]*f[3] >= 0;
                for (const [a,b] of positive ? [[0,1],[2,3]] : [[0,3],[1,2]]) segment(hits[a].p,hits[b].p);
            }
        }
        const visited = new Uint8Array(edges.length);
        function walk(start, edge) {
            const path = [nodes.get(start).p]; let id = start;
            while (edge !== undefined && !visited[edge]) {
                visited[edge] = 1;
                id = edges[edge][0] === id ? edges[edge][1] : edges[edge][0];
                path.push(nodes.get(id).p);
                edge = nodes.get(id).edges.find(e => !visited[e]);
            }
            if (path.length > 2) paths.push(path);
        }
        for (const [id,node] of nodes) if (node.edges.length === 1) walk(id,node.edges[0]);
        edges.forEach((edge,i) => { if (!visited[i]) walk(edge[0],i); });
    }
    return paths;
}

const CORNERS = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const TETS = [[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
export function surface(field, level) {
    const positions = [], normals = [], [nx,ny,nz] = field.dims;
    function triangle(a,b,c) {
        const face = cross(sub(b,a),sub(c,a));
        if (dot(face,face) < 1e-20) return;
        const g = field.gradient(mul(add(add(a,b),c),1/3));
        if (dot(face,g) < 0) [b,c] = [c,b];
        const fallback = unit(cross(sub(b,a),sub(c,a)));
        for (const p of [a,b,c]) {
            positions.push(...p);
            const normal = field.gradient(p);
            normals.push(...(dot(normal,normal)>1e-12 ? unit(normal) : fallback));
        }
        if (positions.length > 2700000) throw new Error('This field produces too many triangles. Increase smoothing or choose another energy level.');
    }
    for (let z = 0; z < nz-1; z++) for (let y = 0; y < ny-1; y++) for (let x = 0; x < nx-1; x++) {
        const ids = CORNERS.map(([a,b,c]) => field.index(x+a,y+b,z+c));
        if (ids.some(i => field.mask[i] !== 1)) continue;
        const values = ids.map(i => field.values[i]);
        if (Math.min(...values) > level || Math.max(...values) < level) continue;
        const p = CORNERS.map(([a,b,c]) => field.position(x+a,y+b,z+c));
        const hit = (a,b) => mix(p[a],p[b],clamp((level-values[a])/(values[b]-values[a]),0,1));
        for (const tet of TETS) {
            const inside = tet.filter(i => values[i] >= level), outside = tet.filter(i => values[i] < level);
            if (!inside.length || !outside.length) continue;
            if (inside.length === 1 || outside.length === 1) {
                const lone = inside.length === 1 ? inside[0] : outside[0], other = inside.length === 1 ? outside : inside;
                triangle(...other.map(i => hit(lone,i)));
            } else {
                const [a,b] = inside, [c,d] = outside;
                const q = [hit(a,c),hit(a,d),hit(b,d),hit(b,c)];
                triangle(q[0],q[1],q[2]); triangle(q[0],q[2],q[3]);
            }
        }
    }
    return { positions: Float32Array.from(positions), normals: Float32Array.from(normals) };
}

export function strands(field, level, { count = 80, steps = 100, axis = 0, twist = 0.7 } = {}) {
    const mesh = surface(field,level), p = mesh.positions, rng = random(1487+Math.round(level*1000));
    const cumulative = []; let totalArea = 0;
    for (let i = 0; i < p.length; i += 9) {
        const a = Array.from(p.subarray(i,i+3)), b = Array.from(p.subarray(i+3,i+6)), c = Array.from(p.subarray(i+6,i+9));
        totalArea += Math.hypot(...cross(sub(b,a),sub(c,a)))/2; cumulative.push(totalArea);
    }
    if (!totalArea) return [];
    const step = field.cell*0.38, tolerance = Math.max(0.001,level*0.015);
    function project(point) {
        let p = point;
        for (let iteration = 0; iteration < 7; iteration++) {
            const e = field.sample(p); if (e === null) return null;
            const g = field.gradient(p), g2 = dot(g,g);
            if (Math.abs(e-level) < tolerance) return p;
            if (g2 < 1e-12) return null;
            const correction = clamp((e-level)/Math.sqrt(g2),-step,step);
            p = sub(p,mul(unit(g),correction));
        }
        const e = field.sample(p); return e !== null && Math.abs(e-level) < tolerance*2 ? p : null;
    }
    function tangent(p) {
        const g = field.gradient(p); if (dot(g,g)<1e-12) return null;
        const n = unit(g), direction = [0,0,0]; direction[axis] = 1;
        const c = field.meta.config;
        const spin = mul(cross(direction,p),twist/Math.max(c.length,c.height,c.depth));
        let t = add(direction,spin); t = sub(t,mul(n,dot(t,n)));
        if (dot(t,t)<0.002) { const alt = [0,0,0]; alt[(axis+1)%3] = 1; t = sub(alt,mul(n,dot(alt,n))); }
        return unit(t);
    }
    function trace(seed, sign) {
        const points = []; let p = seed;
        for (let i = 0; i < steps; i++) {
            const t = tangent(p); if (!t) break;
            const midpoint = project(add(p,mul(t,sign*step/2))); if (!midpoint) break;
            const midT = tangent(midpoint); if (!midT) break;
            const next = project(add(p,mul(midT,sign*step))); if (!next || Math.hypot(...sub(p,next))<step*0.1) break;
            if (i>15 && Math.hypot(...sub(next,seed))<step*0.8) break;
            points.push(next); p = next;
        }
        return points;
    }
    const paths = [];
    for (let s = 0; s < count; s++) {
        const area = rng()*totalArea; let lo = 0, hi = cumulative.length-1;
        while (lo<hi) { const mid = (lo+hi)>>1; if (cumulative[mid]<area) lo = mid+1; else hi = mid; }
        const i = lo*9, a = Array.from(p.subarray(i,i+3)), b = Array.from(p.subarray(i+3,i+6)), c = Array.from(p.subarray(i+6,i+9));
        const r = Math.sqrt(rng()), t = rng();
        const seed = project(add(add(mul(a,1-r),mul(b,r*(1-t))),mul(c,r*t))); if (!seed) continue;
        const path = [...trace(seed,-1).reverse(),seed,...trace(seed,1)];
        if (path.length>5) paths.push(path);
    }
    return paths;
}

// Parallel-transport frames keep thin tubes continuous through bends.
export function tubes(paths, radius, sides = 5) {
    const positions = [], normals = [], indices = [];
    for (const path of paths) {
        if (path.length < 2) continue;
        const base = positions.length/3; let frame;
        const closed = Math.hypot(...sub(path[0],path.at(-1))) < 1e-6;
        for (let j = 0; j < path.length; j++) {
            const before = j>0 ? path[j-1] : closed ? path.at(-2) : path[0];
            const after = j<path.length-1 ? path[j+1] : closed ? path[1] : path.at(-1);
            const tangent = unit(sub(after,before));
            if (!frame || Math.abs(dot(frame,tangent))>0.98) frame = unit(cross(tangent,Math.abs(tangent[1])<0.9 ? [0,1,0] : [1,0,0]));
            frame = unit(sub(frame,mul(tangent,dot(frame,tangent))));
            const binormal = unit(cross(tangent,frame));
            for (let side = 0; side < sides; side++) {
                const a = side/sides*Math.PI*2, n = add(mul(frame,Math.cos(a)),mul(binormal,Math.sin(a)));
                positions.push(...add(path[j],mul(n,radius))); normals.push(...n);
                if (j<path.length-1) {
                    const a = base+j*sides+side, b = base+j*sides+(side+1)%sides;
                    indices.push(a,b,b+sides,a,b+sides,a+sides);
                }
            }
            if (positions.length>4500000) throw new Error('Too many curve segments. Reduce curve count or length.');
        }
    }
    return { positions:Float32Array.from(positions), normals:Float32Array.from(normals), indices:Uint32Array.from(indices), pathCount:paths.length };
}

export function buildView(snapshot, options) {
    const field = new EnergyField(snapshot,options.smoothing);
    const layers = options.mode === 'mist' ? [] : options.levels.map((level,i) => {
        if (!options.enabled[i]) return null;
        if (options.mode === 'surfaces') return surface(field,level);
        const paths = options.mode === 'strands' ? strands(field,level,{ count:options.count, steps:options.steps, axis:options.axis, twist:options.twist })
            : contours(field,level,options.axis,options.slices);
        return tubes(paths,options.radius);
    });
    return { layers, values:options.mode === 'mist' ? field.values : null, mean:field.mean };
}
