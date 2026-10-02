import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { distanceKm, activeMigrations, migrationProgress, borderBracket, containsPoint, clamp, CATEGORY_COLORS } from './model.mjs';
import { EARLY_ZONES } from './history.mjs';
import { activeNearEast, nearEastAt } from './near-east.mjs';
import { activeEuropeanPeoples, europeanPeoplesAt } from './europe.mjs';
import { CroppedAreaLayer } from './cropped-area-layer.mjs';
import { PointEvidenceLayer } from './point-evidence-layer.mjs';

const R = Math.PI / 180;
const NEAR_EAST_BOUNDS = { west:25, south:20, east:60, north:43 };
const SUPERSEDED_BORDERS = new Set(['Ur','Semites','Canaan','Judea']);
const BASE_PALETTES = {
  forest:{sea:'#182b25',land:'#3b4932',shore:'#778064',grid:'#c1caa10c',specular:'#263c2e',haze:[.34,.56,.43]},
  tidal:{sea:'#172c3b',land:'#3d5b62',shore:'#80a9af',grid:'#b3d8de0c',specular:'#2f4c58',haze:[.31,.55,.64]},
  violet:{sea:'#30263b',land:'#534657',shore:'#9b869f',grid:'#d7b8e30c',specular:'#493451',haze:[.51,.39,.61]},
  ember:{sea:'#30261e',land:'#604c38',shore:'#ae926a',grid:'#e3c29a0c',specular:'#49382c',haze:[.64,.43,.31]},
};
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
function paintBaseMap(ctx, land, palette) {
  const {width,height}=ctx.canvas;
  ctx.fillStyle=palette.sea;ctx.fillRect(0,0,width,height);
  for(const feature of land.features){
    polygonPath(ctx,feature.geometry,width,height);
    ctx.fillStyle=palette.land;ctx.fill('evenodd');
    ctx.strokeStyle=palette.shore;ctx.lineWidth=.6;ctx.stroke();
  }
  // Graticule is part of the base map, so it follows the chosen palette.
  ctx.strokeStyle=palette.grid;ctx.lineWidth=1;
  for(let lon=0;lon<=360;lon+=15){ctx.beginPath();ctx.moveTo(lon/360*width,0);ctx.lineTo(lon/360*width,height);ctx.stroke();}
  for(let lat=0;lat<=180;lat+=15){ctx.beginPath();ctx.moveTo(0,lat/180*height);ctx.lineTo(width,lat/180*height);ctx.stroke();}
}
function borderTexture(data, hasRegionalDetail = false) {
  const canvas = textureCanvas(), ctx = canvas.getContext('2d');
  for (const feature of data.features) {
    // The regional layer handles these broad or misleading early labels.
    if (hasRegionalDetail && SUPERSEDED_BORDERS.has(feature.properties.name)) continue;
    polygonPath(ctx, feature.geometry, canvas.width, canvas.height);
    ctx.fillStyle = nameColor(feature.properties.name); ctx.fill('evenodd');
    ctx.strokeStyle = '#c5c8a2'; ctx.lineWidth = .45; ctx.stroke();
  }
  return canvasTexture(canvas);
}
function regionalPolygonPath(ctx, geometry, width, height) {
  const polys=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
  ctx.beginPath();
  for(const polygon of polys)for(const ring of polygon){
    ring.forEach(([lon,lat],i)=>{
      const x=(lon-NEAR_EAST_BOUNDS.west)/(NEAR_EAST_BOUNDS.east-NEAR_EAST_BOUNDS.west)*width;
      const y=(NEAR_EAST_BOUNDS.north-lat)/(NEAR_EAST_BOUNDS.north-NEAR_EAST_BOUNDS.south)*height;
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    });ctx.closePath();
  }
}
function regionalTexture(areas) {
  const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=1344;
  const ctx=canvas.getContext('2d');
  const ordered=[...areas].sort((a,b)=>(a.kind==='culture'?0:1)-(b.kind==='culture'?0:1)||b.area-a.area);
  for(const area of ordered){
    regionalPolygonPath(ctx,area.geometry,canvas.width,canvas.height);
    ctx.fillStyle=area.color;ctx.globalAlpha=area.kind==='culture'?.28:area.confidence==='schematic'?.58:.72;ctx.fill('evenodd');
    ctx.globalAlpha=area.kind==='culture'?.85:1;ctx.strokeStyle=area.color;ctx.lineWidth=area.confidence==='schematic'?1.5:1;
    ctx.setLineDash(area.confidence==='schematic'?[4,3]:[]);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
  }
  return canvasTexture(canvas);
}
function disposeGroup(group) {
  for (const child of [...group.children]) { child.geometry?.dispose(); if (Array.isArray(child.material)) child.material.forEach(m => m.dispose()); else child.material?.dispose(); group.remove(child); }
}
function routePoints(route) {
  const controls = [latLonVector(...route.points[0])];
  for (let i = 1; i < route.points.length; i++) {
    const a = controls.at(-1), b = latLonVector(...route.points[i]);
    // A midpoint keeps unusually long imported segments away from the globe's
    // center. Working in 3D also keeps date-line crossings continuous.
    if (a.angleTo(b) > Math.PI * .8) {
      const rotation = new THREE.Quaternion().setFromUnitVectors(a, b);
      controls.push(a.clone().applyQuaternion(new THREE.Quaternion().slerp(rotation, .5)).normalize());
    }
    controls.push(b);
  }
  const curve = new THREE.CatmullRomCurve3(controls, false, 'centripetal');
  const points = [], steps = 64 * (controls.length - 1);
  // Smooth through the waypoints, then project back onto the sphere. Both the
  // endpoint clearance and the arc's rise are half their former height.
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push(curve.getPoint(t).normalize().multiplyScalar(1 + .5 * (.015 + .13 * Math.sin(Math.PI * t))));
  }
  return points;
}
function along(points, t) { const f = clamp(t, 0, 1) * (points.length - 1), i = Math.min(points.length - 2, Math.floor(f)); return points[i].clone().lerp(points[i + 1], f - i); }

export class HistoryGlobe {
  constructor(container, meta, land, borders, nearEast, callbacks = {}) {
    this.container = container; this.meta = meta; this.borders = borders; this.nearEast = nearEast; this.land=land; this.callbacks = callbacks;
    this.theme=window.SandboxTheme?.get()??'forest';
    const palette=BASE_PALETTES[this.theme]??BASE_PALETTES.forest;
    this.layers = { population: true, territories: true, migrations: true, ancestry: true, events: true, sites: true, archaeology: true, languages: false };
    this.scale = 'log'; this.gain = 1; this.populationOpacity = 1; this.year = -3000; this.routes = []; this.phase = 0; this.disposed = false; this.dirty = true;
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
    this.baseMapContext=ctx;paintBaseMap(ctx,land,palette);
    this.surface = new THREE.Mesh(new THREE.SphereGeometry(1,128,64), new THREE.MeshPhongMaterial({ map:canvasTexture(canvas), specular:palette.specular, shininess:12 }));
    this.scene.add(this.surface);
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.017,96,48),new THREE.ShaderMaterial({
      uniforms:{tint:{value:new THREE.Vector3(...palette.haze)}},vertexShader:'varying vec3 vNormal; varying vec3 vView; void main(){ vec4 p=modelViewMatrix*vec4(position,1.0); vNormal=normalize(normalMatrix*normal); vView=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',
      fragmentShader:'uniform vec3 tint; varying vec3 vNormal; varying vec3 vView; void main(){float a=pow(1.0-abs(dot(normalize(vNormal),normalize(vView))),4.0);gl_FragColor=vec4(tint,a*0.19);}',
      transparent:true,depthWrite:false,side:THREE.FrontSide,
    })); this.scene.add(this.atmosphere);
    // A single surface blends premultiplied colors, avoiding both z-fighting
    // between shells and the dark pulse caused by stacking two alpha layers.
    this.emptyBorder = canvasTexture(textureCanvas(2));
    this.borderUniforms = {
      oldA:{value:this.emptyBorder}, oldB:{value:this.emptyBorder},
      mapA:{value:this.emptyBorder}, mapB:{value:this.emptyBorder},
      oldWeight:{value:0}, weight:{value:0}, transition:{value:1}, opacity:{value:.38},
    };
    this.territoryMesh = new THREE.Mesh(this.surface.geometry.clone(), new THREE.ShaderMaterial({
      uniforms:this.borderUniforms, transparent:true, depthWrite:false,
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:`uniform sampler2D oldA,oldB,mapA,mapB;
        uniform float oldWeight,weight,transition,opacity; varying vec2 vUv;
        vec4 premultiply(vec4 c){return vec4(c.rgb*c.a,c.a);}
        void main(){
          vec4 before=mix(premultiply(texture2D(oldA,vUv)),premultiply(texture2D(oldB,vUv)),oldWeight);
          vec4 after=mix(premultiply(texture2D(mapA,vUv)),premultiply(texture2D(mapB,vUv)),weight);
          vec4 c=mix(before,after,transition);
          gl_FragColor=vec4(c.rgb/max(c.a,0.00001),c.a*opacity);
          #include <colorspace_fragment>
        }`,
    }));
    this.territoryMesh.scale.setScalar(1.002);this.territoryMesh.renderOrder=1;this.territoryMesh.visible=false;this.scene.add(this.territoryMesh);
    this.emptyRegion=canvasTexture(textureCanvas(2));
    this.regionUniforms={oldMap:{value:this.emptyRegion},map:{value:this.emptyRegion},weight:{value:1},bounds:{value:new THREE.Vector4(
      (NEAR_EAST_BOUNDS.west+180)/360,(NEAR_EAST_BOUNDS.south+90)/180,
      (NEAR_EAST_BOUNDS.east-NEAR_EAST_BOUNDS.west)/360,(NEAR_EAST_BOUNDS.north-NEAR_EAST_BOUNDS.south)/180)}};
    this.regionMesh=new THREE.Mesh(this.surface.geometry.clone(),new THREE.ShaderMaterial({
      uniforms:this.regionUniforms,transparent:true,depthWrite:false,
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:`uniform sampler2D oldMap,map; uniform float weight; uniform vec4 bounds; varying vec2 vUv;
        void main(){vec2 uv=(vUv-bounds.xy)/bounds.zw;
          if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0){gl_FragColor=vec4(0.0);return;}
          vec4 a=texture2D(oldMap,uv),b=texture2D(map,uv);
          float alpha=mix(a.a,b.a,weight);
          vec3 rgb=mix(a.rgb*a.a,b.rgb*b.a,weight)/max(alpha,0.00001);
          gl_FragColor=vec4(rgb,alpha);
          #include <colorspace_fragment>
        }`,
    }));
    this.regionMesh.scale.setScalar(1.004);this.regionMesh.renderOrder=2;this.regionMesh.visible=false;this.scene.add(this.regionMesh);
    this.regionTexture=null;this.regionPrevious=null;this.regionPending=null;this.regionFade=1;this.regionKey=null;
    this.europeCatalog=null;this.europeLayer=null;
    this.textureCache=new Map();this.displayBorder=null;this.previousBorder=null;this.pendingBorder=null;this.borderFade=1;
    this.earlyMesh = new THREE.Mesh(this.surface.geometry.clone(),new THREE.MeshBasicMaterial({transparent:true,opacity:.38,depthWrite:false}));this.earlyMesh.scale.setScalar(1.002);this.scene.add(this.earlyMesh);
    this.geoCache = new Map(); this.borderKey = null; this.borderData = null; this.borderRequest = 0;
    this.dotObject = new THREE.Object3D();this.color = new THREE.Color();this.up = new THREE.Vector3(0,1,0);
    this.spikeUniforms={heightGain:{value:1},linearHeight:{value:0},studyColors:{value:1},lowDensityColor:{value:new THREE.Color('#766846')},highDensityColor:{value:new THREE.Color('#ffe6ac')}};
    this.setPopulationGrid(meta);
    this.routeGroup = new THREE.Group();this.eventGroup = new THREE.Group();this.siteGroup = new THREE.Group();this.regionalPlaceGroup=new THREE.Group();this.scene.add(this.routeGroup,this.eventGroup,this.siteGroup,this.regionalPlaceGroup);
    this.burialDots=new PointEvidenceLayer(this.scene,{size:4,radius:1.024,zoomLimit:2.2,opacity:.82});
    this.levantDots=new PointEvidenceLayer(this.scene,{size:2.6,radius:1.023,zoomLimit:1.43,opacity:.68});
    // Keep gazetteer points just above the highest regional color surface.
    this.pleiadesDots=new PointEvidenceLayer(this.scene,{size:2.7,radius:1.006,zoomLimit:1.58,opacity:.68});
    this.languageDots=new PointEvidenceLayer(this.scene,{size:4,radius:1.027,zoomLimit:2.2,opacity:.8});
    this.regionalLabels=[];
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
  setTheme(theme){
    const palette=BASE_PALETTES[theme]??BASE_PALETTES.forest;
    if(this.theme===theme)return;
    this.theme=theme;
    paintBaseMap(this.baseMapContext,this.land,palette);
    this.surface.material.map.needsUpdate=true;
    this.surface.material.specular.set(palette.specular);
    this.atmosphere.material.uniforms.tint.value.set(...palette.haze);
    this.dirty=true;
  }
  setLayers(layers){Object.assign(this.layers,layers);this.spikes.visible=this.layers.population&&!!this.populations;this.routeGroup.visible=this.layers.migrations;this.eventGroup.visible=this.layers.events;this.siteGroup.visible=this.layers.sites;this.regionalPlaceGroup.visible=this.layers.territories;this.burialDots.setVisible(!!this.layers.archaeology,this.camera.position.length());this.levantDots.setVisible(!!this.layers.archaeology,this.camera.position.length());this.pleiadesDots.setVisible(!!this.layers.archaeology,this.camera.position.length());this.languageDots.setVisible(!!this.layers.languages,this.camera.position.length());this.updateBordersOpacity();if(this.populations)this.updatePopulation(this.populations);}
  setEuropeanCatalog(catalog){
    this.europeLayer?.dispose();this.europeCatalog=catalog;this.europeLayer=null;
    if(catalog){
      const [west,south,east,north]=catalog.bounds??[-15,30,50,72];
      this.europeLayer=new CroppedAreaLayer(this.scene,this.surface.geometry,{west,south,east,north},{width:2048,height:1440});
      this.europeLayer.setVisible(this.layers.territories);
    }
    this.setRegionalYear(this.year);this.dirty=true;
  }
  setEvidencePoints(burials=[],levant=[],languages=[]){
    this.burialDots.setRecords(burials);this.levantDots.setRecords(levant);this.languageDots.setRecords(languages);
    this.burialDots.setVisible(!!this.layers.archaeology,this.camera.position.length());
    this.levantDots.setVisible(!!this.layers.archaeology,this.camera.position.length());
    this.languageDots.setVisible(!!this.layers.languages,this.camera.position.length());
    this.dirty=true;
  }
  setPleiadesPoints(records=[]){
    this.pleiadesDots.setRecords(records);
    this.pleiadesDots.setVisible(!!this.layers.archaeology,this.camera.position.length());
    this.dirty=true;
  }
  setScale(scale,gain){this.scale=scale;this.gain=gain;this.spikeUniforms.heightGain.value=gain;this.spikeUniforms.linearHeight.value=scale==='linear'?1:0;this.dirty=true;}
  setPopulationOpacity(opacity){this.populationOpacity=clamp(opacity,0,1);this.spikes.material.opacity=this.populationOpacity;this.spikes.visible=this.layers.population&&!!this.populations&&this.populationOpacity>0;this.dirty=true;}
  setPopulationGrid(meta){
    if(this.spikes){this.scene.remove(this.spikes);this.spikes.geometry.dispose();this.spikes.material.dispose();}
    this.meta=meta;this.populations=null;this.blendWeights=new Map();
    this.normals=meta.cells.map(c=>latLonVector(c[0],c[1]));
    const geometry=new THREE.CylinderGeometry(.7,1,1,4,1);geometry.translate(0,.5,0);
    geometry.setAttribute('cellPopulation',new THREE.InstancedBufferAttribute(new Float32Array(meta.cells.length),1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('cellArea',new THREE.InstancedBufferAttribute(new Float32Array(meta.cells.map(c=>c[2])),1));
    const material=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:this.populationOpacity,depthWrite:false});
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,this.spikeUniforms);
      shader.vertexShader='attribute float cellPopulation; attribute float cellArea; uniform float heightGain; uniform float linearHeight; uniform float studyColors; uniform vec3 lowDensityColor; uniform vec3 highDensityColor;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
        float density=max(0.0,cellPopulation/cellArea);
        float height=heightGain*mix(0.1*log(1.0+density)/log(10.0),density*0.00015,linearHeight);
        transformed.y*=height;
        if(cellPopulation<=0.0)transformed=vec3(0.0);
        #ifdef USE_INSTANCING_COLOR
          if(studyColors<0.5)vColor=mix(lowDensityColor,highDensityColor,clamp((log(density+0.01)/log(10.0)+2.0)/5.0,0.0,1.0));
        #endif`);
    };
    this.spikes=new THREE.InstancedMesh(geometry,material,meta.cells.length);
    this.spikes.frustumCulled=false;this.spikes.renderOrder=3;this.spikes.visible=false;
    // Orientation and footprint are static. Only one scalar per cell changes
    // during playback; height and magnification are evaluated on the GPU.
    for(let i=0;i<meta.cells.length;i++){
      const c=meta.cells[i],normal=this.normals[i],width=.0028*meta.resolutionDegrees*Math.max(.38,Math.sqrt(Math.cos(c[0]*R)));
      this.dotObject.position.copy(normal).multiplyScalar(1.003);
      this.dotObject.quaternion.setFromUnitVectors(this.up,normal);this.dotObject.scale.set(width,1,width);this.dotObject.updateMatrix();this.spikes.setMatrixAt(i,this.dotObject.matrix);
      this.spikes.setColorAt(i,this.color.set('#dbc28a'));
    }
    this.scene.add(this.spikes);this.colorKey=null;this.dirty=true;
  }
  updatePopulation(populations){
    this.dirty=true;this.populations=populations;this.spikes.visible=!!populations&&this.layers.population&&this.populationOpacity>0;
    if(!populations)return;
    const attribute=this.spikes.geometry.attributes.cellPopulation;attribute.array.set(populations);attribute.needsUpdate=true;
    this.spikeUniforms.studyColors.value=this.layers.ancestry?1:0;
    const routes=this.layers.ancestry?activeMigrations(this.routes,this.year).filter(r=>r.blend):[];
    const key=routes.map(r=>`${r.id}:${migrationProgress(r,this.year)}`).join('|');
    if(this.colorKey===key)return;this.colorKey=key;
    const blends=routes.map(route=>{
      const b=route.blend;
      if(!this.blendWeights.has(route.id)){
        const source=new Float32Array(this.meta.cells.length),target=new Float32Array(source.length);
        for(let i=0;i<source.length;i++){const c=this.meta.cells[i];source[i]=Math.max(0,1-distanceKm(c[0],c[1],...route.points[0])/(b.radius*.65));target[i]=Math.max(0,1-distanceKm(c[0],c[1],...b.center)/b.radius);}
        this.blendWeights.set(route.id,{source,target});
      }
      return {...this.blendWeights.get(route.id),incoming:new THREE.Color(b.incoming),mixed:new THREE.Color(b.prior).lerp(new THREE.Color(b.incoming),(b.fraction??.55)*migrationProgress(route,this.year))};
    });
    const base=new THREE.Color('#dbc28a');
    for(let i=0;i<populations.length;i++){
      this.color.copy(base);
      for(const b of blends){if(b.source[i])this.color.lerp(b.incoming,b.source[i]);if(b.target[i])this.color.lerp(b.mixed,b.target[i]);}
      this.spikes.setColorAt(i,this.color);
    }
    this.spikes.instanceColor.needsUpdate=true;
  }
  setYear(year,routes,events,sites=[]){
    this.dirty=true;this.year=year;this.routes=routes;this.setBorders(year);this.setRegionalYear(year);
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
    const siteKey=sites.map(s=>s.id).join('|');
    if(this.siteKey!==siteKey){this.siteKey=siteKey;disposeGroup(this.siteGroup);for(const site of sites){
      const marker=new THREE.Mesh(new THREE.TorusGeometry(.010,.0025,6,20),new THREE.MeshBasicMaterial({color:'#f0bb83'}));
      marker.position.copy(latLonVector(site.lat,site.lon,1.016));marker.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),marker.position.clone().normalize());
      // Pick the whole badge, including its hollow center. The globe surface
      // remains a ray target so markers on the far side cannot be selected.
      marker.geometry.computeBoundingSphere();
      marker.raycast=(raycaster,hits)=>{
        const sphere=marker.geometry.boundingSphere.clone().applyMatrix4(marker.matrixWorld);
        const point=raycaster.ray.intersectSphere(sphere,new THREE.Vector3());if(!point)return;
        const distance=raycaster.ray.origin.distanceTo(point);
        if(distance>=raycaster.near&&distance<=raycaster.far)hits.push({distance,point,object:marker});
      };
      marker.userData.site=site;this.siteGroup.add(marker);
    }}
    this.updateBordersOpacity();
  }
  beginRegion(next){
    this.regionPrevious=this.regionTexture;this.regionTexture=next.texture;this.regionKey=next.key;this.regionFade=0;
    this.regionUniforms.oldMap.value=this.regionPrevious??this.emptyRegion;
    this.regionUniforms.map.value=this.regionTexture;this.regionUniforms.weight.value=0;
    this.regionMesh.visible=this.layers.territories;this.dirty=true;
  }
  setRegionalYear(year){
    const {areas,places}=activeNearEast(this.nearEast,year);
    const europe=activeEuropeanPeoples(this.europeCatalog,year);
    if(this.europeLayer?.setAreas(europe.areas))this.dirty=true;
    const key=areas.map(a=>a.id).join('|');
    if(key===this.regionKey&&this.regionPending){
      if(this.regionPending.texture!==this.emptyRegion)this.regionPending.texture.dispose();
      this.regionPending=null;
    }
    if(key!==this.regionKey&&key!==this.regionPending?.key){
      const next={key,texture:areas.length?regionalTexture(areas):this.emptyRegion};
      if(this.regionFade<1){if(this.regionPending?.texture!==this.emptyRegion)this.regionPending?.texture.dispose();this.regionPending=next;}
      else this.beginRegion(next);
    }
    const allPlaces=places.concat(europe.places);
    const placeKey=allPlaces.map(p=>p.id).join('|');
    if(placeKey!==this.regionalPlaceKey){
      this.regionalPlaceKey=placeKey;disposeGroup(this.regionalPlaceGroup);
      for(const label of this.regionalLabels)label.el.remove();this.regionalLabels=[];
      for(const place of allPlaces){
        const point=latLonVector(place.lat,place.lon,1.02);
        const marker=new THREE.Mesh(new THREE.SphereGeometry(.0065,10,8),new THREE.MeshBasicMaterial({color:place.color??(place.kind==='ethnonym'?'#c8a9c3':'#e5d39c'),depthWrite:false}));
        marker.position.copy(point);marker.renderOrder=4;marker.userData.regionalPlace=place;
        // Give the small dot a usable hit area without selecting the far side.
        marker.raycast=(raycaster,hits)=>{
          const sphere=new THREE.Sphere(marker.getWorldPosition(new THREE.Vector3()),.014);
          const hit=raycaster.ray.intersectSphere(sphere,new THREE.Vector3());if(!hit)return;
          const distance=raycaster.ray.origin.distanceTo(hit);
          if(distance>=raycaster.near&&distance<=raycaster.far)hits.push({distance,point:hit,object:marker});
        };
        this.regionalPlaceGroup.add(marker);
        const el=document.createElement('span');el.className='globe-label near-east-label';el.textContent=place.name;document.querySelector('#map-labels').appendChild(el);
        this.regionalLabels.push({el,position:point});
      }
    }
    this.updateBordersOpacity();
  }
  advanceRegion(dt){
    if(this.regionFade>=1)return;
    this.regionFade=Math.min(1,this.regionFade+dt/.28);
    this.regionUniforms.weight.value=this.regionFade*this.regionFade*(3-2*this.regionFade);this.dirty=true;
    if(this.regionFade===1){
      if(this.regionPrevious&&this.regionPrevious!==this.emptyRegion&&this.regionPrevious!==this.regionTexture)this.regionPrevious.dispose();
      this.regionPrevious=null;this.regionUniforms.oldMap.value=this.regionTexture;
      if(this.regionPending){const next=this.regionPending;this.regionPending=null;this.beginRegion(next);}
      else if(this.regionTexture===this.emptyRegion)this.regionMesh.visible=false;
    }
  }
  async loadGeo(index){const row=this.borders.snapshots[index];if(!this.geoCache.has(row.file))this.geoCache.set(row.file,fetch(`./data/borders/${row.file}`).then(r=>{if(!r.ok)throw new Error(`Boundary snapshot ${row.year} could not load.`);return r.json();}).catch(e=>{this.geoCache.delete(row.file);throw e;}));return this.geoCache.get(row.file);}
  textureFor(index,data){
    if(!this.textureCache.has(index))this.textureCache.set(index,borderTexture(data,!!this.nearEast));
    return this.textureCache.get(index);
  }
  beginBorder(pair){
    this.previousBorder=this.displayBorder;this.displayBorder=pair;this.borderFade=0;
    const u=this.borderUniforms,old=this.previousBorder;
    u.oldA.value=old?.textures[0]??this.emptyBorder;u.oldB.value=old?.textures[1]??this.emptyBorder;u.oldWeight.value=u.weight.value;
    u.mapA.value=pair.textures[0];u.mapB.value=pair.textures[1];u.weight.value=pair.bracket?.t??0;u.transition.value=0;
    this.updateBordersOpacity();
  }
  queueBorder(pair){if(this.borderFade<1)this.pendingBorder=pair;else this.beginBorder(pair);}
  advanceBorders(dt){
    const target=this.displayBorder?.bracket?.t??0,delta=target-this.borderUniforms.weight.value;
    if(Math.abs(delta)>.00001){this.borderUniforms.weight.value+=delta*(1-Math.exp(-dt*18));this.dirty=true;}
    if(this.borderFade>=1)return;
    this.borderFade=Math.min(1,this.borderFade+dt/.28);
    this.borderUniforms.transition.value=this.borderFade*this.borderFade*(3-2*this.borderFade);this.dirty=true;
    if(this.borderFade===1){
      this.previousBorder=null;
      this.borderUniforms.oldA.value=this.borderUniforms.mapA.value;this.borderUniforms.oldB.value=this.borderUniforms.mapB.value;
      if(this.pendingBorder){const next=this.pendingBorder;this.pendingBorder=null;this.beginBorder(next);}
      const used=new Set([this.emptyBorder,...[this.displayBorder,this.previousBorder,this.pendingBorder].flatMap(p=>p?.textures??[])]);
      for(const [key,texture] of this.textureCache){if(this.textureCache.size<=6)break;if(!used.has(texture)){texture.dispose();this.textureCache.delete(key);}}
      this.updateBordersOpacity();
    }
  }
  async setBorders(year){
    let b=borderBracket(this.borders.snapshots,year);
    // At an exact sample use the following interval at weight zero. Avoid an
    // extra (same,same) swap between every pair during playback.
    if(b&&b.a===b.b&&b.b<this.borders.snapshots.length-1)b={...b,b:b.a+1,t:0};
    this.currentBorderBracket=b;
    const early=EARLY_ZONES.filter(z=>year>=z.start&&year<=z.end),earlyKey=early.map(z=>z.name).join('|');
    if(earlyKey!==this.earlyKey){this.earlyKey=earlyKey;const canvas=textureCanvas(),ctx=canvas.getContext('2d');for(const zone of early){polygonPath(ctx,zone.geometry,canvas.width,canvas.height);ctx.fillStyle=zone.color;ctx.fill('evenodd');ctx.strokeStyle=zone.color;ctx.setLineDash([3,3]);ctx.lineWidth=1.5;ctx.stroke();}this.earlyMesh.material.map?.dispose();this.earlyMesh.material.map=canvasTexture(canvas);this.earlyMesh.material.needsUpdate=true;}
    if(!b){
      if(this.borderKey!==null){this.borderRequest++;this.borderKey=null;this.borderData=null;this.borderError=null;this.pendingBorder=null;this.queueBorder({key:null,bracket:null,data:null,textures:[this.emptyBorder,this.emptyBorder]});}
      this.updateBordersOpacity();this.callbacks.onBorders?.({early});return;
    }
    const key=`${b.a}/${b.b}`;
    if(this.displayBorder?.key===key)this.displayBorder.bracket=b;
    if(this.pendingBorder?.key===key)this.pendingBorder.bracket=b;
    if(b.t>.5&&b.b+1<this.borders.snapshots.length)this.loadGeo(b.b+1).catch(()=>{});
    if(key===this.borderKey){this.updateBordersOpacity();this.callbacks.onBorders?.({bracket:b,ready:!!this.borderData,loading:!this.borderData&&!this.borderError,error:this.borderError});return;}
    // Preserve the complete displayed pair until the replacement is ready.
    this.borderKey=key;this.borderData=null;this.borderError=null;this.pendingBorder=null;
    const request=++this.borderRequest;this.updateBordersOpacity();this.callbacks.onBorders?.({bracket:b,loading:true});
    try{
      const data=await Promise.all([this.loadGeo(b.a),this.loadGeo(b.b)]);
      if(request!==this.borderRequest||this.disposed)return;
      this.borderData=data;
      const textures=[this.textureFor(b.a,data[0]),this.textureFor(b.b,data[1])];
      this.queueBorder({key,bracket:this.currentBorderBracket,data,textures});
      this.updateBordersOpacity();this.callbacks.onBorders?.({bracket:this.currentBorderBracket,ready:true});
    }catch(error){if(request===this.borderRequest&&!this.disposed){this.borderError=error.message+' Keeping the last available map. Select another era and return, or reload, to retry.';this.callbacks.onBorders?.({error:this.borderError});}}
  }
  updateBordersOpacity(){
    this.dirty=true;
    this.territoryMesh.visible=this.layers.territories&&!!(this.displayBorder?.data||this.previousBorder?.data);
    this.earlyMesh.visible=this.layers.territories&&!this.currentBorderBracket;
    this.regionMesh.visible=this.layers.territories&&!!this.regionTexture&&(this.regionTexture!==this.emptyRegion||this.regionFade<1);
    this.europeLayer?.setVisible(this.layers.territories);
  }
  territoriesAt(lat,lon){
    const regional=nearEastAt(this.nearEast,this.year,lat,lon).map(item=>({...item,source:'regional'}));
    const european=europeanPeoplesAt(this.europeCatalog,this.year,lat,lon)
      .filter(item=>item.kind!=='ethnonym')
      .map(item=>({...item,source:'european'}));
    regional.push(...european);
    if(!this.currentBorderBracket)return regional.concat(EARLY_ZONES.filter(z=>this.year>=z.start&&this.year<=z.end&&containsPoint(z.geometry,lon,lat)).map(z=>({name:z.name,source:z.source,year:null})));
    const pair=this.displayBorder,b=pair?.bracket;if(!b||!pair.data)return regional;
    const out=[];for(const i of(b.a===b.b||b.t===0?[0]:[0,1]))for(const feature of pair.data[i].features){
      const name=feature.properties.name;
      if(this.nearEast&&SUPERSEDED_BORDERS.has(name))continue;
      if(containsPoint(feature.geometry,lon,lat))out.push({name,year:this.borders.snapshots[i===0?b.a:b.b].year,source:'basemaps'});
    }return regional.concat(out);
  }
  nearestCell(lat,lon){let best=-1,bestDistance=Infinity;for(let i=0;i<this.meta.cells.length;i++){const c=this.meta.cells[i];if(Math.abs(c[0]-lat)>this.meta.resolutionDegrees*2)continue;const d=distanceKm(lat,lon,c[0],c[1]);if(d<bestDistance){bestDistance=d;best=i;}}return bestDistance<170*this.meta.resolutionDegrees?best:-1;}
  selectLocation(lat,lon){this.selection.position.copy(latLonVector(lat,lon,1.011));this.selection.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),this.selection.position.clone().normalize());this.selection.visible=true;}
  clearSelection(){this.selection.visible=false;}
  pick(event,click){
    const rect=this.renderer.domElement.getBoundingClientRect();this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);
    const targets=[this.surface];if(this.layers.events)targets.push(...this.eventGroup.children);
    if(this.layers.sites)targets.push(...this.siteGroup.children);
    if(this.layers.territories)targets.push(...this.regionalPlaceGroup.children);
    const hit=this.raycaster.intersectObjects(targets,false)[0];
    if(!hit){this.callbacks.onHover?.(null);return;}
    if(hit.object.userData.event){const e=hit.object.userData.event;if(click)this.callbacks.onEvent?.(e);else this.callbacks.onHover?.({event:e,x:event.clientX-rect.left,y:event.clientY-rect.top});return;}
    if(hit.object.userData.site){const site=hit.object.userData.site;if(click)this.callbacks.onSite?.(site);else this.callbacks.onHover?.({site,x:event.clientX-rect.left,y:event.clientY-rect.top});return;}
    if(hit.object.userData.regionalPlace){const place=hit.object.userData.regionalPlace;if(click)this.callbacks.onRegional?.(place);else this.callbacks.onHover?.({regionalPlace:place,x:event.clientX-rect.left,y:event.clientY-rect.top});return;}
    const place=vectorLatLon(hit.point);place.index=this.nearestCell(place.lat,place.lon);place.territories=this.territoriesAt(place.lat,place.lon);
    const nearby=[
      [this.burialDots,35,'evidence'],[this.levantDots,18,'evidence'],
      [this.pleiadesDots,15,'evidence'],[this.languageDots,35,'language'],
    ].filter(([layer])=>layer.mesh.visible)
      .map(([layer,radius,kind])=>({record:layer.nearest(place.lat,place.lon,radius),kind}))
      .filter(item=>item.record)
      .sort((a,b)=>distanceKm(place.lat,place.lon,a.record.lat,a.record.lon)-distanceKm(place.lat,place.lon,b.record.lat,b.record.lon));
    if(nearby.length){
      const {record,kind}=nearby[0];
      if(click){if(kind==='language')this.callbacks.onLanguage?.(record);else this.callbacks.onEvidence?.(record);}
      else this.callbacks.onHover?.({[kind]:record,x:event.clientX-rect.left,y:event.clientY-rect.top});
      return;
    }
    if(click){this.selectLocation(place.lat,place.lon);this.callbacks.onLocation?.(place);}else this.callbacks.onHover?.({...place,x:event.clientX-rect.left,y:event.clientY-rect.top});
  }
  render(dt,playing){
    if(this.disposed)return;
    if(this.destination){this.camera.position.lerp(this.destination,1-Math.exp(-dt*5));if(this.camera.position.distanceTo(this.destination)<.001)this.destination=null;}
    this.advanceBorders(dt);this.advanceRegion(dt);if(this.europeLayer?.advance(dt))this.dirty=true;this.controls.update();
    const cameraDistance=this.camera.position.length();
    if(this.burialDots.setVisible(!!this.layers.archaeology,cameraDistance))this.dirty=true;
    if(this.levantDots.setVisible(!!this.layers.archaeology,cameraDistance))this.dirty=true;
    if(this.pleiadesDots.setVisible(!!this.layers.archaeology,cameraDistance))this.dirty=true;
    if(this.languageDots.setVisible(!!this.layers.languages,cameraDistance))this.dirty=true;
    if(!this.dirty&&!playing&&!this.destination)return;if(playing)this.phase+=dt;
    for(const v of this.routeVisuals??[]){const p=migrationProgress(v.route,this.year),positions=v.dots.geometry.attributes.position;for(let i=0;i<18;i++){const t=p===0?0:((i/18+this.phase*.1)%1)*p;const point=along(v.points,t);positions.setXYZ(i,point.x,point.y,point.z);}positions.needsUpdate=true;v.head.position.copy(along(v.points,p));}
    const cameraNormal=this.camera.position.clone().normalize(),horizon=1/this.camera.position.length();
    for(const label of this.labels){const visible=label.position.clone().normalize().dot(cameraNormal)>horizon+.07;label.el.hidden=!visible;if(visible){const p=label.position.clone().project(this.camera);label.el.style.left=`${(p.x*.5+.5)*this.width}px`;label.el.style.top=`${(-p.y*.5+.5)*this.height}px`;}}
    const labelPriority=['Ur','Babylon','Nineveh','Samaria','Jerusalem','Uruk','Ashur','Ebla','Hazor'];
    const placed=[];
    for(const label of [...this.regionalLabels].sort((a,b)=>{
      const ai=labelPriority.indexOf(a.el.textContent),bi=labelPriority.indexOf(b.el.textContent);
      return (ai<0?100:ai)-(bi<0?100:bi);
    })){
      let visible=this.layers.territories&&this.camera.position.length()<1.9&&label.position.clone().normalize().dot(cameraNormal)>horizon+.06;
      if(visible){const p=label.position.clone().project(this.camera),x=(p.x*.5+.5)*this.width,y=(-p.y*.5+.5)*this.height;
        if(placed.some(([px,py])=>Math.abs(x-px)<50&&Math.abs(y-py)<17))visible=false;
        else{label.el.style.left=`${x}px`;label.el.style.top=`${y}px`;placed.push([x,y]);}
      }label.el.hidden=!visible;
    }
    this.renderer.render(this.scene,this.camera);this.dirty=false;
  }
  dispose(){this.disposed=true;this.borderRequest++;this.resizeObserver.disconnect();this.controls.dispose();this.europeLayer?.dispose();this.burialDots.dispose();this.levantDots.dispose();this.pleiadesDots.dispose();this.languageDots.dispose();this.scene.traverse(o=>{o.geometry?.dispose();if(o.material){o.material.map?.dispose();o.material.dispose();}});for(const texture of this.textureCache.values())texture.dispose();this.emptyBorder.dispose();for(const texture of [this.regionTexture,this.regionPrevious,this.regionPending?.texture,this.emptyRegion])texture?.dispose();this.renderer.dispose();for(const label of [...this.labels,...this.regionalLabels])label.el.remove();}
}
