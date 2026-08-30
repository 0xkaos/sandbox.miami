(() => {
  'use strict';

  const canvas = document.querySelector('#gl-canvas');
  const fallback = document.querySelector('#fallback');
  const sampleCount = document.querySelector('#sample-count');
  const renderLabel = document.querySelector('#render-label');
  const pulse = document.querySelector('#pulse');
  const pauseButton = document.querySelector('#pause');
  const resetButton = document.querySelector('#reset');
  const saveButton = document.querySelector('#save');
  const qualityInput = document.querySelector('#quality');
  const qualityValue = document.querySelector('#quality-value');
  const formSelect = document.querySelector('#form-select');
  const materialSelect = document.querySelector('#material-select');
  const lightingSelect = document.querySelector('#lighting-select');
  const hint = document.querySelector('#hint');
  const dialog = document.querySelector('#about-dialog');

  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance'
  });

  if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
    fallback.hidden = false;
    renderLabel.textContent = 'WebGL2 unavailable';
    return;
  }

  const vertexSource = `#version 300 es
    in vec2 aPosition;
    out vec2 vUv;
    void main() {
      vUv = aPosition * .5 + .5;
      gl_Position = vec4(aPosition, 0., 1.);
    }
  `;

  const traceSource = `#version 300 es
    precision highp float;
    precision highp int;
    precision highp sampler2D;

    in vec2 vUv;
    out vec4 fragColor;

    uniform sampler2D uPrevious;
    uniform vec2 uResolution;
    uniform vec2 uCamera;
    uniform float uDistance;
    uniform float uSeed;
    uniform int uFrame;
    uniform int uForm;
    uniform int uMaterial;
    uniform int uLighting;

    const float PI = 3.14159265359;
    const float FAR = 28.;
    uint rngState;

    uint hash(uint x) {
      x += (x << 10u); x ^= (x >> 6u);
      x += (x << 3u);  x ^= (x >> 11u);
      x += (x << 15u); return x;
    }

    float random() {
      rngState = hash(rngState);
      return float(rngState) * (1.0 / 4294967296.0);
    }

    mat2 rot(float a) {
      float s = sin(a), c = cos(a);
      return mat2(c, -s, s, c);
    }

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 345.45));
      p += dot(p, p + 34.345 + uSeed * .17);
      return fract(p.x * p.y);
    }

    float sdRoundBox(vec3 p, vec3 b, float r) {
      vec3 q = abs(p) - b + r;
      return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.) - r;
    }

    float sdTorus(vec3 p, vec2 t) {
      vec2 q = vec2(length(p.xz) - t.x, p.y);
      return length(q) - t.y;
    }

    float sdSphere(vec3 p, float r) {
      return length(p) - r;
    }

    float sdCylinder(vec3 p, float radius, float halfHeight) {
      vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(radius, halfHeight);
      return min(max(d.x, d.y), 0.) + length(max(d, 0.));
    }

    float sdCappedCone(vec3 p, float h, float r1, float r2) {
      vec2 q = vec2(length(p.xz), p.y);
      vec2 k1 = vec2(r2, h);
      vec2 k2 = vec2(r2 - r1, 2. * h);
      vec2 ca = vec2(q.x - min(q.x, q.y < 0. ? r1 : r2), abs(q.y) - h);
      vec2 cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0., 1.);
      float s = (cb.x < 0. && ca.y < 0.) ? -1. : 1.;
      return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
    }

    float sdRoundedPyramid(vec3 p, float halfHeight, float halfBase, float rounding) {
      float y = p.y + halfHeight;
      float taper = clamp(y / (2. * halfHeight), 0., 1.);
      float width = mix(halfBase, .035, taper);
      float side = max(abs(p.x), abs(p.z)) - width;
      float caps = max(-y, y - 2. * halfHeight);
      return max(side * .72, caps) - rounding;
    }

    float sdRoundedIcosahedron(vec3 p, float radius, float rounding) {
      const float phi = 1.61803398875;
      p = abs(p);
      vec3 faceA = normalize(vec3(1., 1., 1.));
      vec3 faceB = normalize(vec3(phi, 1. / phi, 0.));
      float planes = dot(p, faceA);
      planes = max(planes, dot(p, faceB.xyz));
      planes = max(planes, dot(p, faceB.yzx));
      planes = max(planes, dot(p, faceB.zxy));
      return planes - radius - rounding;
    }

    float gyroid(vec3 p, float scale, float thickness) {
      p *= scale;
      float g = dot(sin(p), cos(p.zxy));
      return abs(g) / (scale * 1.55) - thickness;
    }

    float ringBuilding(vec3 p, float buildingId) {
      const float count = 52.;
      float stepAngle = 2. * PI / count;
      float rndA = hash21(vec2(buildingId, 7.31));
      float rndB = hash21(vec2(buildingId, 19.77));
      float rndC = hash21(vec2(buildingId, 41.13));
      float angle = buildingId * stepAngle + (rndC - .5) * stepAngle * .16;
      float ringRadius = 6.45 + (rndB - .5) * .72;
      vec2 center = vec2(cos(angle), sin(angle)) * ringRadius;
      vec2 cell = p.xz - center;

      float height = 1.15 + rndA * 3.8;
      float radius = .15 + rndB * .075;
      vec3 bodyP = vec3(cell.x, p.y + 1.72 - height * .5, cell.y);
      float boxBody = sdRoundBox(bodyP, vec3(radius, height * .5, radius * (.75 + rndC * .35)), .035);
      float roundBody = sdCylinder(bodyP, radius, height * .5);
      float body = rndC > .68 ? roundBody : boxBody;

      float topY = -1.72 + height;
      float dome = sdSphere(vec3(cell.x, (p.y - topY) * 1.28, cell.y), radius * 1.04) * .78;
      float spireHeight = .35 + rndB * .55;
      vec3 spireP = vec3(cell.x, p.y - topY - spireHeight, cell.y);
      float spire = sdCappedCone(spireP, spireHeight, radius * .78, .015);
      float cap = rndB < .36 ? dome : spire;
      return min(body, cap);
    }

    float cityField(vec3 p) {
      const float count = 52.;
      float stepAngle = 2. * PI / count;
      float polar = atan(p.z, p.x);
      float nearestId = floor(polar / stepAngle + .5);
      float city = 100.;
      for (int offset = -1; offset <= 1; offset++) {
        city = min(city, ringBuilding(p, nearestId + float(offset)));
      }
      return city;
    }

    vec2 mapScene(vec3 p) {
      float floorD = p.y + 1.72;
      float cityD = cityField(p);
      vec3 q = p;
      q.xz *= rot(.22 + uSeed * .17);
      q.xy *= rot(-.12 + uSeed * .07);

      float g1 = gyroid(q + vec3(uSeed, 0., -uSeed) * .23, 3.05, .065);
      vec3 r = q.yzx;
      r.xz *= rot(1.04 + uSeed * .11);
      float g2 = gyroid(r + vec3(.4, -.2, .1), 2.35, .075);
      float sculpture;

      if (uForm == 0) {
        float volume = sdRoundBox(q, vec3(1.23, 1.48, 1.14), .42);
        float opening = -sdTorus(q.xzy + vec3(0., .0, .12), vec2(.86, .45));
        sculpture = max(max(min(g1, g2), volume), opening);
      } else if (uForm == 1) {
        vec3 k = q;
        k.xy *= rot(.45);
        float volume = min(sdTorus(k, vec2(1.03, .55)), sdTorus(k.yzx, vec2(.92, .48)));
        sculpture = max(g1, volume);
      } else if (uForm == 2) {
        float volume = sdRoundBox(q, vec3(1.34), .58);
        float cleft = -sdRoundBox(q - vec3(.25, .0, .5), vec3(.42, 1.8, .64), .3);
        sculpture = max(max(max(g1, g2), volume), cleft);
      } else {
        vec3 pyramidA = q - vec3(-.68, -.64, .18);
        pyramidA.xz *= rot(.32 + uSeed * .1);
        float pA = sdRoundedPyramid(pyramidA, .7, .78, .075);

        vec3 pyramidB = q - vec3(.72, -.82, -.26);
        pyramidB.xz *= rot(-.44 + uSeed * .06);
        float pB = sdRoundedPyramid(pyramidB, .52, .6, .065);

        vec3 icoA = q - vec3(.56, .55, .18);
        icoA.xy *= rot(.38);
        icoA.yz *= rot(uSeed * .12);
        float iA = sdRoundedIcosahedron(icoA, .66, .045);

        vec3 icoB = q - vec3(-.55, .75, -.38);
        icoB.xz *= rot(-.27);
        icoB.xy *= rot(.18 + uSeed * .08);
        float iB = sdRoundedIcosahedron(icoB, .48, .04);

        sculpture = min(min(pA, pB), min(iA, iB));
      }

      sculpture *= .78;
      vec2 result = vec2(sculpture, 1.);
      if (cityD < result.x) result = vec2(cityD, 3.);
      if (floorD < result.x) result = vec2(floorD, 2.);
      return result;
    }

    bool raymarch(vec3 ro, vec3 rd, out float t, out float material) {
      t = .02;
      material = 0.;
      for (int i = 0; i < 112; i++) {
        vec2 h = mapScene(ro + rd * t);
        if (h.x < .0009 * (1. + t * .12)) {
          material = h.y;
          return true;
        }
        t += max(h.x * .72, .0007);
        if (t > FAR) break;
      }
      return false;
    }

    vec3 getNormal(vec3 p) {
      const vec2 e = vec2(.0015, -.0015);
      return normalize(
        e.xyy * mapScene(p + e.xyy).x +
        e.yyx * mapScene(p + e.yyx).x +
        e.yxy * mapScene(p + e.yxy).x +
        e.xxx * mapScene(p + e.xxx).x
      );
    }

    bool visibleToLight(vec3 ro, vec3 rd, float maxT) {
      float t = .012;
      for (int i = 0; i < 72; i++) {
        float h = mapScene(ro + rd * t).x;
        if (h < .0012) return false;
        t += max(h * .75, .001);
        if (t >= maxT) return true;
      }
      return true;
    }

    vec3 cosineDirection(vec3 n) {
      float a = 2. * PI * random();
      float r = sqrt(random());
      vec3 u = normalize(abs(n.y) < .98 ? cross(n, vec3(0.,1.,0.)) : cross(n, vec3(1.,0.,0.)));
      vec3 v = cross(n, u);
      return normalize(u * cos(a) * r + v * sin(a) * r + n * sqrt(1. - r * r));
    }

    vec2 diskSample() {
      float a = random() * 2. * PI;
      float r = sqrt(random());
      return vec2(cos(a), sin(a)) * r;
    }

    vec3 environment(vec3 rd) {
      float horizon = exp(-abs(rd.y - .035) * 5.2);
      float elevation = smoothstep(-.18, .82, rd.y);
      vec3 sky;

      if (uLighting == 0) {
        sky = mix(vec3(.78, .13, .22), vec3(.10, .27, .64), elevation);
        float sideGlow = .58 + .42 * smoothstep(-1., .65, -rd.x);
        sky += vec3(1.0, .28, .08) * horizon * sideGlow * .85;
        sky += vec3(.72, .09, .38) * pow(horizon, 2.) * .34;
        vec3 sunDirection = normalize(vec3(-.68, .19, -.71));
        float sunCore = smoothstep(.9985, .99975, dot(rd, sunDirection));
        float sunHalo = pow(max(dot(rd, sunDirection), 0.), 96.);
        sky += vec3(1.0, .54, .18) * sunHalo * 2.8;
        sky += vec3(1.0, .82, .52) * sunCore * 9.;
      } else if (uLighting == 1) {
        sky = mix(vec3(.035, .025, .16), vec3(.06, .42, .72), elevation);
        sky += vec3(.12, .36, 1.) * horizon * 1.15;
        float electric = pow(max(dot(rd, normalize(vec3(.48, .38, -.79))), 0.), 120.);
        sky += vec3(.28, .75, 1.) * electric * 3.4;
        sky += vec3(.8, .12, .62) * pow(horizon, 3.) * .38;
      } else if (uLighting == 2) {
        sky = mix(vec3(.68, .34, .02), vec3(.10, .48, .29), elevation);
        sky += vec3(.75, 1., .04) * horizon * .92;
        vec3 sunDirection = normalize(vec3(.72, .31, -.62));
        float sun = pow(max(dot(rd, sunDirection), 0.), 155.);
        sky += vec3(.8, 1., .12) * sun * 5.;
        sky += vec3(.05, .45, .32) * max(rd.y, 0.) * .55;
      } else {
        sky = mix(vec3(.11, .012, .018), vec3(.025, .045, .12), elevation);
        sky += vec3(.88, .07, .015) * pow(horizon, 2.2) * .62;
        vec3 moonDirection = normalize(vec3(-.42, .64, -.64));
        float moon = pow(max(dot(rd, moonDirection), 0.), 380.);
        sky += vec3(.48, .64, 1.) * moon * 7.;
        sky += vec3(.45, .025, .008) * horizon * .32;
      }

      float highLight = pow(max(dot(rd, normalize(vec3(.62, .72, .24))), 0.), 180.);
      sky += (uLighting == 2 ? vec3(.55, 1., .18) : vec3(.27, .46, 1.)) * highLight * .8;
      return sky;
    }

    void surfaceMaterial(float id, vec3 p, out vec3 albedo, out float metallic, out float roughness) {
      if (id > 2.5) {
        const float count = 52.;
        float stepAngle = 2. * PI / count;
        float buildingId = floor(atan(p.z, p.x) / stepAngle + .5);
        float building = hash21(vec2(buildingId, 19.77));
        float mirrorBand = smoothstep(.44, .56, .5 + .5 * sin(p.y * 3.2 + building * 9.));
        vec3 stone = mix(vec3(.075, .045, .095), vec3(.23, .105, .15), building);
        vec3 glass = mix(vec3(.08, .16, .22), vec3(.32, .13, .27), building);
        albedo = mix(stone, glass, mirrorBand);
        metallic = mix(.04, .87, mirrorBand);
        roughness = mix(.72, .08, mirrorBand);
      } else if (id > 1.5) {
        float grain = .5 + .5 * sin(p.x * 2.7 + sin(p.z * 4.));
        float wet = smoothstep(.52, .76, .5 + .5 * sin(p.x * .7 + p.z * 1.1));
        albedo = mix(vec3(.12, .055, .095), vec3(.24, .12, .14), grain * .3);
        metallic = wet * .28; roughness = mix(.58, .12, wet);
      } else if (uMaterial == 0) {
        float patina = smoothstep(.15, .85, .5 + .5 * sin(p.y * 3.1 + p.z * 2.4));
        float mirror = smoothstep(.62, .78, .5 + .5 * sin(p.x * 4.1 - p.y * 2.3));
        albedo = mix(mix(vec3(.53, .55, .49), vec3(.18, .29, .275), patina * .45), vec3(.78, .82, .86), mirror);
        metallic = mix(.62, .94, mirror); roughness = mix(.3, .055, mirror);
      } else if (uMaterial == 1) {
        float glaze = smoothstep(.58, .78, .5 + .5 * sin(p.y * 4. + p.x * 2.));
        albedo = mix(vec3(.31, .055, .038), vec3(.82, .32, .08), glaze);
        metallic = mix(.06, .62, glaze); roughness = mix(.56, .09, glaze);
      } else {
        float polish = smoothstep(.42, .6, .5 + .5 * sin(p.z * 5. - p.y * 1.7));
        albedo = mix(vec3(.018, .024, .035), vec3(.17, .08, .2), polish);
        metallic = mix(.45, .96, polish); roughness = mix(.42, .045, polish);
      }
    }

    vec3 surfaceEmission(float id, vec3 p) {
      if (id < 2.5) return vec3(0.);
      float rows = step(.64, fract((p.y + 1.72) * 1.42));
      float columns = step(.52, fract((p.x + p.z * .13) * 3.1));
      float lit = rows * columns * step(.46, hash21(floor(p.xz * 2.7) + floor(p.y * 1.42)));
      vec3 windowColor = uLighting == 1 ? vec3(.2, .65, 1.) :
                         uLighting == 2 ? vec3(.72, 1., .08) :
                         uLighting == 3 ? vec3(1., .08, .015) : vec3(1., .19, .055);
      return windowColor * lit * (uLighting == 3 ? 2.8 : 1.9);
    }

    vec3 trace(vec3 ro, vec3 rd) {
      vec3 radiance = vec3(0.);
      vec3 throughput = vec3(1.);

      for (int bounce = 0; bounce < 4; bounce++) {
        float t, material;
        if (!raymarch(ro, rd, t, material)) {
          radiance += throughput * environment(rd);
          break;
        }

        vec3 p = ro + rd * t;
        vec3 n = getNormal(p);
        if (dot(n, rd) > 0.) n = -n;
        vec3 albedo;
        float metallic, roughness;
        surfaceMaterial(material, p, albedo, metallic, roughness);
        radiance += throughput * surfaceEmission(material, p);

        vec3 lightPos = vec3(mix(-3.8, 2.8, random()), 5.1, mix(-3.6, .6, random()));
        vec3 toLight = lightPos - p;
        float lightDist = length(toLight);
        vec3 lightDir = toLight / lightDist;
        float nDotL = max(dot(n, lightDir), 0.);
        if (nDotL > 0. && visibleToLight(p + n * .006, lightDir, lightDist)) {
          float falloff = 44. / (2. + lightDist * lightDist);
          vec3 themeLight = uLighting == 1 ? vec3(.2, .58, 1.) :
                            uLighting == 2 ? vec3(.7, 1., .08) :
                            uLighting == 3 ? vec3(.62, .12, .06) : vec3(1., .48, .24);
          vec3 lightColor = themeLight * falloff;
          radiance += throughput * albedo * (1. - metallic) * lightColor * nDotL / PI;
        }

        vec3 diffuseDir = cosineDirection(n);
        vec3 reflected = reflect(rd, n);
        vec3 glossyDir = normalize(mix(reflected, cosineDirection(n), roughness * roughness));
        float specularChance = mix(.12, .92, metallic);

        if (random() < specularChance) {
          rd = glossyDir;
          vec3 f0 = mix(vec3(.72), albedo, metallic);
          throughput *= f0 / specularChance;
        } else {
          rd = diffuseDir;
          throughput *= albedo * (1. - metallic) / max(1. - specularChance, .08);
        }
        ro = p + n * .006;

        if (bounce > 1) {
          float survive = clamp(max(throughput.r, max(throughput.g, throughput.b)), .12, .9);
          if (random() > survive) break;
          throughput /= survive;
        }
      }
      return radiance;
    }

    void main() {
      uvec2 pixel = uvec2(gl_FragCoord.xy);
      rngState = hash(pixel.x + hash(pixel.y + hash(uint(uFrame + 1) * 747796405u)));

      vec2 jitter = vec2(random(), random()) - .5;
      vec2 uv = (gl_FragCoord.xy + jitter - .5 * uResolution) / uResolution.y;
      uv.x -= .115;

      float yaw = uCamera.x;
      float pitch = uCamera.y;
      vec3 target = vec3(0., -.06, 0.);
      vec3 ro = target + uDistance * vec3(cos(pitch) * sin(yaw), sin(pitch), cos(pitch) * cos(yaw));
      vec3 forward = normalize(target - ro);
      vec3 right = normalize(cross(forward, vec3(0.,1.,0.)));
      vec3 up = cross(right, forward);
      vec3 rd = normalize(forward * 2.38 + right * uv.x + up * uv.y);

      vec2 lens = diskSample() * .011;
      vec3 focalPoint = ro + rd * uDistance;
      ro += right * lens.x + up * lens.y;
      rd = normalize(focalPoint - ro);

      vec3 sampleColor = trace(ro, rd);
      vec3 previous = texelFetch(uPrevious, ivec2(gl_FragCoord.xy), 0).rgb;
      float f = float(uFrame);
      vec3 accumulated = (previous * f + sampleColor) / (f + 1.);
      fragColor = vec4(accumulated, 1.);
    }
  `;

  const displaySource = `#version 300 es
    precision highp float;
    in vec2 vUv;
    out vec4 fragColor;
    uniform sampler2D uTexture;
    uniform vec2 uResolution;

    vec3 aces(vec3 x) {
      const float a = 2.51, b = .03, c = 2.43, d = .59, e = .14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0., 1.);
    }

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec3 color = texture(uTexture, vUv).rgb;
      color = aces(color * 1.28);
      color = pow(color, vec3(1. / 2.2));
      vec2 q = vUv * (1. - vUv);
      color *= .76 + .24 * pow(16. * q.x * q.y, .18);
      color += (hash(gl_FragCoord.xy) - .5) / 255.;
      fragColor = vec4(color, 1.);
    }
  `;

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(fragmentSource) {
    const program = gl.createProgram();
    gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    return program;
  }

  let traceProgram;
  let displayProgram;
  try {
    traceProgram = createProgram(traceSource);
    displayProgram = createProgram(displaySource);
  } catch (error) {
    console.error('Shader compilation failed:', error);
    fallback.hidden = false;
    fallback.querySelector('h2').textContent = 'The shader could not compile.';
    return;
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);

  for (const program of [traceProgram, displayProgram]) {
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  }

  const traceUniform = Object.fromEntries(
    ['uPrevious','uResolution','uCamera','uDistance','uSeed','uFrame','uForm','uMaterial','uLighting']
      .map(name => [name, gl.getUniformLocation(traceProgram, name)])
  );
  const displayUniform = {
    texture: gl.getUniformLocation(displayProgram, 'uTexture'),
    resolution: gl.getUniformLocation(displayProgram, 'uResolution')
  };

  let textures = [];
  let framebuffers = [];
  let readIndex = 0;
  let frame = 0;
  let paused = false;
  let needsResize = true;
  let quality = .6;
  let seed = Math.random() * 8.;
  let yaw = .664;
  let pitch = .12;
  let distance = 8.15;
  let pointerDown = false;
  let pointerX = 0;
  let pointerY = 0;

  function destroyTargets() {
    textures.forEach(texture => gl.deleteTexture(texture));
    framebuffers.forEach(framebuffer => gl.deleteFramebuffer(framebuffer));
    textures = [];
    framebuffers = [];
  }

  function createTarget() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, canvas.width, canvas.height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete accumulation buffer');
    gl.clearBufferfv(gl.COLOR, 0, new Float32Array([0, 0, 0, 1]));
    textures.push(texture);
    framebuffers.push(framebuffer);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let width = Math.max(2, Math.floor(canvas.clientWidth * dpr * quality));
    let height = Math.max(2, Math.floor(canvas.clientHeight * dpr * quality));
    const maxPixels = 1600000;
    const pixels = width * height;
    if (pixels > maxPixels) {
      const scale = Math.sqrt(maxPixels / pixels);
      width = Math.floor(width * scale);
      height = Math.floor(height * scale);
    }
    if (canvas.width === width && canvas.height === height && textures.length) return;
    canvas.width = width;
    canvas.height = height;
    destroyTargets();
    createTarget();
    createTarget();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    frame = 0;
    readIndex = 0;
  }

  function reset(renewSeed = false) {
    if (renewSeed) seed = Math.random() * 8.;
    frame = 0;
    readIndex = 0;
    renderLabel.textContent = paused ? 'Accumulation paused' : 'Gathering light';
  }

  function drawTrace() {
    const writeIndex = 1 - readIndex;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[writeIndex]);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(traceProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures[readIndex]);
    gl.uniform1i(traceUniform.uPrevious, 0);
    gl.uniform2f(traceUniform.uResolution, canvas.width, canvas.height);
    gl.uniform2f(traceUniform.uCamera, yaw, pitch);
    gl.uniform1f(traceUniform.uDistance, distance);
    gl.uniform1f(traceUniform.uSeed, seed);
    gl.uniform1i(traceUniform.uFrame, frame);
    gl.uniform1i(traceUniform.uForm, Number(formSelect.value));
    gl.uniform1i(traceUniform.uMaterial, Number(materialSelect.value));
    gl.uniform1i(traceUniform.uLighting, Number(lightingSelect.value));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    readIndex = writeIndex;
    frame += 1;
  }

  function drawDisplay() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(displayProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures[readIndex]);
    gl.uniform1i(displayUniform.texture, 0);
    gl.uniform2f(displayUniform.resolution, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function updateStatus() {
    sampleCount.textContent = Math.min(frame, 9999).toString().padStart(4, '0');
    if (!paused) renderLabel.textContent = frame < 3 ? 'Tracing first paths' : frame < 80 ? 'Gathering light' : 'Resolving surface';
  }

  function animate() {
    if (needsResize) {
      resize();
      needsResize = false;
    }
    if (!paused && frame < 4096) drawTrace();
    drawDisplay();
    updateStatus();
    requestAnimationFrame(animate);
  }

  function togglePause() {
    paused = !paused;
    pauseButton.lastChild.textContent = paused ? 'Resume' : 'Pause';
    pauseButton.querySelector('.pause-icon').classList.toggle('play', paused);
    pulse.classList.toggle('paused', paused);
    renderLabel.textContent = paused ? 'Accumulation paused' : 'Gathering light';
  }

  canvas.addEventListener('pointerdown', event => {
    pointerDown = true;
    pointerX = event.clientX;
    pointerY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    hint.style.opacity = '0';
  });

  canvas.addEventListener('pointermove', event => {
    if (!pointerDown) return;
    const dx = event.clientX - pointerX;
    const dy = event.clientY - pointerY;
    pointerX = event.clientX;
    pointerY = event.clientY;
    yaw -= dx * .006;
    pitch = Math.max(-.55, Math.min(.65, pitch + dy * .005));
    reset();
  });

  canvas.addEventListener('pointerup', event => {
    pointerDown = false;
    canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    distance = Math.max(4.4, Math.min(11., distance + event.deltaY * .004));
    hint.style.opacity = '0';
    reset();
  }, { passive: false });

  pauseButton.addEventListener('click', togglePause);
  resetButton.addEventListener('click', () => reset(true));
  formSelect.addEventListener('change', () => reset());
  materialSelect.addEventListener('change', () => reset());
  lightingSelect.addEventListener('change', () => reset());

  qualityInput.addEventListener('input', () => {
    quality = Number(qualityInput.value) / 100;
    qualityValue.textContent = qualityInput.value + '%';
    needsResize = true;
  });

  saveButton.addEventListener('click', () => {
    drawDisplay();
    gl.finish();
    canvas.toBlob(blob => {
      if (!blob) return;
      const link = document.createElement('a');
      link.download = 'common-ground-' + Date.now() + '.png';
      link.href = URL.createObjectURL(blob);
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }, 'image/png');
  });

  document.querySelector('#about-open').addEventListener('click', () => dialog.showModal());
  document.querySelector('#about-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });

  window.addEventListener('keydown', event => {
    if (event.key.toLowerCase() === 'p' || event.code === 'Space') togglePause();
    if (event.key.toLowerCase() === 'r') reset(true);
  });
  window.addEventListener('resize', () => { needsResize = true; });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    paused = true;
    renderLabel.textContent = 'Context lost — reload';
    pulse.classList.add('paused');
  });

  requestAnimationFrame(animate);
})();
