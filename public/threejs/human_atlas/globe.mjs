import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { densityHeight, distanceKm, activeMigrations, migrationProgress, borderBracket, containsPoint, clamp, mix, CATEGORY_COLORS } from './model.mjs';
import { EARLY_ZONES } from './history.mjs';

const R = Math.PI / 180;
export function latLonVector(lat, lon, radius = 1) {
  return new THREE.Vector3(radius * Math.cos(lat * R) * Math.cos(lon * R), radius * Math.sin(lat * R), -radius * Math.cos(lat * R) * Math.sin(lon * R));
}
function vectorLatLon(p) { return { lat: Math.asin(clamp(p.y / p.length(), -1, 1)) / R, lon: Math.atan2(-p.z, p.x) / R }; }
function textureCanvas(width = 2048) { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = width / 2; return canvas; }
function polygonPath(ctx, geometry, width, height) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  ctx.beginPath();
  for (const polygon of polys) for (const offset of [-width, 0, width]) for (const ring of polygon) {
    let previous;
    ring.forEach(([lon, lat], i) => {
      let x = (lon + 180) / 360 * width;
      if (previous !== undefined) { while (x - previous > width / 2) x -= width; while (x - previous < -width / 2) x += width; }
      previous = x;
      const y = (90 - lat) / 180 * height;
      if (i === 0) ctx.moveTo(x + offset, y); else ctx.lineTo(x + offset, y);
    });
    ctx.closePath();
  }
}
function nameColor(name) {
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `hsl(${((h >>> 0) % 360)}, 26%, 49%)`;
}
function canvasTexture(canvas) { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function borderTexture(data) {
  const canvas = textureCanvas(), ctx = canvas.getContext('2d');
  for (const feature of data.features) {
    polygonPath(ctx, feature.geometry, canvas.width, canvas.height);
    ctx.fillStyle = nameColor(feature.properties.name); ctx.fill('evenodd');
    ctx.strokeStyle = '#c5c8a2'; ctx.lineWidth = .45; ctx.stroke();
  }
  return canvasTexture(canvas);
}
function disposeGroup(group) {
  for (const child of [...group.children]) { child.geometry?.dispose(); if (Array.isArray(child.material)) child.material.forEach(m => m.dispose()); else child.material?.dispose(); group.remove(child); }
}
function routePoints(route) {
  const points = [], steps = 24, n = route.points.length - 1;
  for (let i = 0; i < n; i++) {
    const a = latLonVector(...route.points[i]), b = latLonVector(...route.points[i + 1]);
    const angle = a.angleTo(b), sin = Math.sin(angle);
    for (let j = 0; j < steps; j++) {
      const t = j / steps, global = (i + t) / n;
      const p = angle < .0001 ? a.clone() : a.clone().multiplyScalar(Math.sin((1 - t) * angle) / sin).addScaledVector(b, Math.sin(t * angle) / sin);
      points.push(p.normalize().multiplyScalar(1.015 + .13 * Math.sin(Math.PI * global)));
    }
  }
  points.push(latLonVector(...route.points.at(-1), 1.015));
  return points;
}
function along(points, t) { const f = clamp(t, 0, 1) * (points.length - 1), i = Math.min(points.length - 2, Math.floor(f)); return points[i].clone().lerp(points[i + 1], f - i); }

export class HistoryGlobe {
  constructor(container, meta, land, borders, callbacks = {}) {
    this.container = container; this.meta = meta; this.borders = borders; this.callbacks = callbacks;
    this.layers = { population: true, territories: true, migrations: true, ancestry: true, events: true };
    this.scale = 'log'; this.gain = 1; this.year = -3000; this.routes = []; this.phase = 0; this.disposed = false; this.dirty = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, .005, 30);
    this.camera.position.copy(latLonVector(24, 24, 3.2));
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    this.renderer.setClearColor(0x101714, 0); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = .065;
    this.controls.enablePan = false; this.controls.minDistance = 1.13; this.controls.maxDistance = 6;
    this.controls.rotateSpeed = .55; this.controls.zoomSpeed = .6;
    this.controls.addEventListener('start', () => { this.destination = null; });
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.scene.add(new THREE.AmbientLight(0xc0d3bc, 1.5));
    const light = new THREE.DirectionalLight(0xe5e2c1, 2.1); light.position.set(3,4,2); this.scene.add(light);
    const fill = new THREE.DirectionalLight(0x527e69, 1.1); fill.position.set(-3,-1,-2); this.scene.add(fill);
    const canvas = textureCanvas(), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#182b25'; ctx.fillRect(0,0,canvas.width,canvas.height);
    for (const feature of land.features) { polygonPath(ctx, feature.geometry, canvas.width,canvas.height); ctx.fillStyle='#3b4932'; ctx.fill('evenodd'); ctx.strokeStyle='#778064';ctx.lineWidth=.6;ctx.stroke(); }
    // Quiet cartographic graticule, fixed to the globe rather than the viewport.
    ctx.strokeStyle='#c1caa10c';ctx.lineWidth=1;
    for(let lon=0;lon<=360;lon+=15){ctx.beginPath();ctx.moveTo(lon/360*canvas.width,0);ctx.lineTo(lon/360*canvas.width,canvas.height);ctx.stroke();}
    for(let lat=0;lat<=180;lat+=15){ctx.beginPath();ctx.moveTo(0,lat/180*canvas.height);ctx.lineTo(canvas.width,lat/180*canvas.height);ctx.stroke();}
    this.surface = new THREE.Mesh(new THREE.SphereGeometry(1,128,64), new THREE.MeshPhongMaterial({ map:canvasTexture(canvas), specular:0x263c2e, shininess:12 }));
    this.scene.add(this.surface);
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.017,96,48),new THREE.ShaderMaterial({
      uniforms:{},vertexShader:'varying vec3 vNormal; varying vec3 vView; void main(){ vec4 p=modelViewMatrix*vec4(position,1.0); vNormal=normalize(normalMatrix*normal); vView=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',
      fragmentShader:'varying vec3 vNormal; varying vec3 vView; void main(){float a=pow(1.0-abs(dot(normalize(vNormal),normalize(vView))),4.0);gl_FragColor=vec4(0.34,0.56,0.43,a*0.19);}',
      transparent:true,depthWrite:false,side:THREE.FrontSide,
    })); this.scene.add(atmosphere);
    this.territoryMeshes = [0,1].map(i=>{const m=new THREE.Mesh(new THREE.SphereGeometry(1.001+i*.0003,96,48),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));m.renderOrder=i+1;this.scene.add(m);return m;});
    this.earlyMesh = new THREE.Mesh(new THREE.SphereGeometry(1.0012,96,48),new THREE.MeshBasicMaterial({transparent:true,opacity:.38,depthWrite:false}));this.scene.add(this.earlyMesh);
    this.geoCache = new Map(); this.borderKey = null; this.borderData = null; this.borderRequest = 0;
    this.normals = meta.cells.map(c => latLonVector(c[0],c[1]));
    this.spikes = new THREE.InstancedMesh(new THREE.CylinderGeometry(.7,1,1,4,1),new THREE.MeshBasicMaterial({color:0xffffff}),meta.cells.length);
    this.spikes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.spikes.frustumCulled=false;this.scene.add(this.spikes);
    this.dotObject = new THREE.Object3D();this.color = new THREE.Color();this.up = new THREE.Vector3(0,1,0);
    this.routeGroup = new THREE.Group();this.eventGroup = new THREE.Group();this.scene.add(this.routeGroup,this.eventGroup);
    this.selection = new THREE.Mesh(new THREE.RingGeometry(.017,.019,48),new THREE.MeshBasicMaterial({color:0xe7d4a0,side:THREE.DoubleSide,transparent:true,opacity:.85,depthWrite:false}));this.selection.visible=false;this.scene.add(this.selection);
    this.raycaster = new THREE.Raycaster();this.pointer = new THREE.Vector2();
    this.hoverAt = 0;
    this.onDown = e => {this.down={x:e.clientX,y:e.clientY};};
    this.onUp = e => {if(this.down && Math.hypot(e.clientX-this.down.x,e.clientY-this.down.y)<5) this.pick(e,true);this.down=null;};
    this.onMove = e => {if(performance.now()-this.hoverAt>90 && !this.down){this.hoverAt=performance.now();this.pick(e,false);}};
    this.onLeave = ()=>this.callbacks.onHover?.(null);
    const el=this.renderer.domElement;el.addEventListener('pointerdown',this.onDown);el.addEventListener('pointerup',this.onUp);el.addEventListener('pointermove',this.onMove);el.addEventListener('pointerleave',this.onLeave);
    this.onContextLost=e=>{e.preventDefault();this.callbacks.onError?.('The graphics context was lost. Reload this page to restore the globe. Your browser may be low on graphics memory.');};el.addEventListener('webglcontextlost',this.onContextLost);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();
    this.labels = [['EUROPE',54,15],['NILE VALLEY',24,31],['ANATOLIA',39,34],['SAHARA',23,0],['SOUTH ASIA',21,79],['EAST ASIA',36,112],['SAHUL',-24,133],['NORTH AMERICA',43,-106],['SOUTH AMERICA',-15,-60]].map(([name,lat,lon])=>{const el=document.createElement('span');el.className='globe-label';el.textContent=name;document.querySelector('#map-labels').appendChild(el);return{el,position:latLonVector(lat,lon,1.023)};});
  }
  resize(){const {width,height}=this.container.getBoundingClientRect();if(!width||!height)return;this.width=width;this.height=height;this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.renderer.setSize(width,height);this.dirty=true;}
  focus(region){this.destination=latLonVector(region.lat,region.lon,Math.min(6,region.distance/Math.min(1,this.camera.aspect)));}
  zoom(factor){this.destination=null;this.camera.position.setLength(clamp(this.camera.position.length()*factor,1.13,6));this.controls.update();}
  setLayers(layers){Object.assign(this.layers,layers);this.spikes.visible=this.layers.population&&!!this.populations;this.routeGroup.visible=this.layers.migrations;this.eventGroup.visible=this.layers.events;this.updateBordersOpacity();if(this.populations)this.updatePopulation(this.populations);}
  setScale(scale,gain){this.scale=scale;this.gain=gain;if(this.populations)this.updatePopulation(this.populations);}
  updatePopulation(populations){
    this.dirty=true;this.populations=populations;this.spikes.visible=!!populations&&this.layers.population;
    if(!populations)return;
    const routes=this.layers.ancestry?activeMigrations(this.routes,this.year).filter(r=>r.blend):[];
    const low=new THREE.Color('#766846'), high=new THREE.Color('#ffe6ac');
    for(let i=0;i<populations.length;i++){
      const c=this.meta.cells[i],normal=this.normals[i],d=populations[i]/c[2];
      const height=densityHeight(d,this.scale,this.gain),width=.0028*Math.max(.38,Math.sqrt(Math.cos(c[0]*R)));
      this.dotObject.position.copy(normal).multiplyScalar(1.003+height/2);
      this.dotObject.quaternion.setFromUnitVectors(this.up,normal);this.dotObject.scale.set(populations[i]>0?width:0,height,width);this.dotObject.updateMatrix();this.spikes.setMatrixAt(i,this.dotObject.matrix);
      // With study colors enabled, growth changes height only. The study's
      // incoming fraction drives hue independently of population growth.
      if(this.layers.ancestry)this.color.set('#dbc28a');
      else this.color.copy(low).lerp(high,clamp((Math.log10(d+.01)+2)/5,0,1));
      for(const route of routes){
        const b=route.blend,dist=distanceKm(c[0],c[1],...b.center),sourceDistance=distanceKm(c[0],c[1],...route.points[0]);
        if(sourceDistance<b.radius*.65)this.color.lerp(new THREE.Color(b.incoming),1-sourceDistance/(b.radius*.65));
        if(dist<b.radius){const fraction=(b.fraction??.55)*migrationProgress(route,this.year);const blended=new THREE.Color(b.prior).lerp(new THREE.Color(b.incoming),fraction);this.color.lerp(blended,1-dist/b.radius);}
      }
      this.spikes.setColorAt(i,this.color);
    }
    this.spikes.instanceMatrix.needsUpdate=true;this.spikes.instanceColor.needsUpdate=true;
  }
  setYear(year,routes,events){
    this.dirty=true;this.year=year;this.routes=routes;this.setBorders(year);
    const active=activeMigrations(routes,year),key=active.map(r=>r.id).join('|');
    if(this.routeKey!==key){
      this.routeKey=key;disposeGroup(this.routeGroup);this.routeVisuals=[];
      for(const route of active){const points=routePoints(route);const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:route.color,transparent:true,opacity:.55}));this.routeGroup.add(line);
        const dots=new THREE.Points(new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(new Float32Array(18*3),3)),new THREE.PointsMaterial({color:route.color,size:.011,sizeAttenuation:true,transparent:true,opacity:.9,depthWrite:false}));this.routeGroup.add(dots);
        const head=new THREE.Mesh(new THREE.SphereGeometry(.007,8,8),new THREE.MeshBasicMaterial({color:route.color}));this.routeGroup.add(head);
        this.routeVisuals.push({route,points,dots,head});
      }
    }
    const eventKey=events.map(e=>e.id).join('|');
    if(this.eventKey!==eventKey){this.eventKey=eventKey;disposeGroup(this.eventGroup);for(const event of events){const normal=latLonVector(event.lat,event.lon);const m=new THREE.Mesh(new THREE.OctahedronGeometry(.008),new THREE.MeshBasicMaterial({color:CATEGORY_COLORS[event.kind]??'#e2c794'}));m.position.copy(normal).multiplyScalar(1.025);m.userData.event=event;this.eventGroup.add(m);}}
    this.updateBordersOpacity();
  }
  async loadGeo(index){const row=this.borders.snapshots[index];if(!this.geoCache.has(row.file))this.geoCache.set(row.file,fetch(`./data/borders/${row.file}`).then(r=>{if(!r.ok)throw new Error(`Boundary snapshot ${row.year} could not load.`);return r.json();}).catch(e=>{this.geoCache.delete(row.file);throw e;}));return this.geoCache.get(row.file);}
  async setBorders(year){
    const b=borderBracket(this.borders.snapshots,year);this.currentBorderBracket=b;
    const early=EARLY_ZONES.filter(z=>year>=z.start&&year<=z.end),earlyKey=early.map(z=>z.name).join('|');
    if(earlyKey!==this.earlyKey){this.earlyKey=earlyKey;const canvas=textureCanvas(),ctx=canvas.getContext('2d');for(const zone of early){polygonPath(ctx,zone.geometry,canvas.width,canvas.height);ctx.fillStyle=zone.color;ctx.fill('evenodd');ctx.strokeStyle=zone.color;ctx.setLineDash([3,3]);ctx.lineWidth=1.5;ctx.stroke();}this.earlyMesh.material.map?.dispose();this.earlyMesh.material.map=canvasTexture(canvas);this.earlyMesh.material.needsUpdate=true;}
    if(!b){this.borderRequest++;this.borderKey=null;this.borderData=null;this.updateBordersOpacity();this.callbacks.onBorders?.({early});return;}
    const key=`${b.a}/${b.b}`;
    if(key===this.borderKey){this.updateBordersOpacity();this.callbacks.onBorders?.({bracket:b,ready:!!this.borderData,loading:!this.borderData&&!this.borderError,error:this.borderError});return;}
    this.borderKey=key;this.borderData=null;this.borderError=null;const request=++this.borderRequest;this.updateBordersOpacity();this.callbacks.onBorders?.({bracket:b,loading:true});
    try{
      const data=await Promise.all([this.loadGeo(b.a),this.loadGeo(b.b)]);
      if(request!==this.borderRequest||this.disposed)return;
      this.borderData=data;
      for(let i=0;i<2;i++){this.territoryMeshes[i].material.map?.dispose();this.territoryMeshes[i].material.map=borderTexture(data[i]);this.territoryMeshes[i].material.needsUpdate=true;}
      this.updateBordersOpacity();this.callbacks.onBorders?.({bracket:this.currentBorderBracket,ready:true});
    }catch(error){if(request===this.borderRequest){this.borderError=error.message+' Select another era and return, or reload, to retry.';this.callbacks.onBorders?.({error:this.borderError});}}
  }
  updateBordersOpacity(){
    this.dirty=true;
    const b=this.currentBorderBracket;for(let i=0;i<2;i++){this.territoryMeshes[i].visible=this.layers.territories&&!!b&&!!this.borderData;this.territoryMeshes[i].material.opacity=.38*(b?(i===0?1-b.t:b.t):0);}
    this.earlyMesh.visible=this.layers.territories&&!b;
  }
  territoriesAt(lat,lon){const b=this.currentBorderBracket;if(!b)return EARLY_ZONES.filter(z=>this.year>=z.start&&this.year<=z.end&&containsPoint(z.geometry,lon,lat)).map(z=>({name:z.name,source:z.source,year:null}));if(!this.borderData)return[];
    const out=[];for(const i of(b.a===b.b?[0]:[0,1]))for(const feature of this.borderData[i].features)if(containsPoint(feature.geometry,lon,lat))out.push({name:feature.properties.name,year:this.borders.snapshots[i===0?b.a:b.b].year,source:'basemaps'});return out;}
  nearestCell(lat,lon){let best=-1,bestDistance=Infinity;for(let i=0;i<this.meta.cells.length;i++){const c=this.meta.cells[i];if(Math.abs(c[0]-lat)>2)continue;const d=distanceKm(lat,lon,c[0],c[1]);if(d<bestDistance){bestDistance=d;best=i;}}return bestDistance<170?best:-1;}
  selectLocation(lat,lon){this.selection.position.copy(latLonVector(lat,lon,1.011));this.selection.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),this.selection.position.clone().normalize());this.selection.visible=true;}
  clearSelection(){this.selection.visible=false;}
  pick(event,click){
    const rect=this.renderer.domElement.getBoundingClientRect();this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);
    const targets=[this.surface];if(this.layers.events)targets.push(...this.eventGroup.children);
    const hit=this.raycaster.intersectObjects(targets,false)[0];
    if(!hit){this.callbacks.onHover?.(null);return;}
    if(hit.object.userData.event){const e=hit.object.userData.event;if(click)this.callbacks.onEvent?.(e);else this.callbacks.onHover?.({event:e,x:event.clientX-rect.left,y:event.clientY-rect.top});return;}
    const place=vectorLatLon(hit.point);place.index=this.nearestCell(place.lat,place.lon);place.territories=this.territoriesAt(place.lat,place.lon);
    if(click){this.selectLocation(place.lat,place.lon);this.callbacks.onLocation?.(place);}else this.callbacks.onHover?.({...place,x:event.clientX-rect.left,y:event.clientY-rect.top});
  }
  render(dt,playing){
    if(this.disposed)return;
    if(this.destination){this.camera.position.lerp(this.destination,1-Math.exp(-dt*5));if(this.camera.position.distanceTo(this.destination)<.001)this.destination=null;}
    this.controls.update();if(!this.dirty&&!playing&&!this.destination)return;if(playing)this.phase+=dt;
    for(const v of this.routeVisuals??[]){const p=migrationProgress(v.route,this.year),positions=v.dots.geometry.attributes.position;for(let i=0;i<18;i++){const t=p===0?0:((i/18+this.phase*.1)%1)*p;const point=along(v.points,t);positions.setXYZ(i,point.x,point.y,point.z);}positions.needsUpdate=true;v.head.position.copy(along(v.points,p));}
    const cameraNormal=this.camera.position.clone().normalize(),horizon=1/this.camera.position.length();
    for(const label of this.labels){const visible=label.position.clone().normalize().dot(cameraNormal)>horizon+.07;label.el.hidden=!visible;if(visible){const p=label.position.clone().project(this.camera);label.el.style.left=`${(p.x*.5+.5)*this.width}px`;label.el.style.top=`${(-p.y*.5+.5)*this.height}px`;}}
    this.renderer.render(this.scene,this.camera);this.dirty=false;
  }
  dispose(){this.disposed=true;this.borderRequest++;this.resizeObserver.disconnect();this.controls.dispose();this.scene.traverse(o=>{o.geometry?.dispose();if(o.material){o.material.map?.dispose();o.material.dispose();}});this.renderer.dispose();for(const label of this.labels)label.el.remove();}
}
