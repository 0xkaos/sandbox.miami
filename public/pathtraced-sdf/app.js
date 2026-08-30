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

    float sdRoundBox(vec3 p, vec3 b, float r) {
      vec3 q = abs(p) - b + r;
      return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.) - r;
    }

    float sdTorus(vec3 p, vec2 t) {
      vec2 q = vec2(length(p.xz) - t.x, p.y);
      return length(q) - t.y;
    }

    float gyroid(vec3 p, float scale, float thickness) {
      p *= scale;
      float g = dot(sin(p), cos(p.zxy));
      return abs(g) / (scale * 1.55) - thickness;
    }

    vec2 mapScene(vec3 p) {
      float floorD = p.y + 1.72;
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
      } else {
        float volume = sdRoundBox(q, vec3(1.34), .58);
        float cleft = -sdRoundBox(q - vec3(.25, .0, .5), vec3(.42, 1.8, .64), .3);
        sculpture = max(max(max(g1, g2), volume), cleft);
      }

      sculpture *= .78;
      if (sculpture < floorD) return vec2(sculpture, 1.);
      return vec2(floorD, 2.);
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
      float horizon = smoothstep(-.25, .65, rd.y);
      vec3 sky = mix(vec3(.055, .058, .049), vec3(.36, .38, .32), horizon);
      float windowA = pow(max(dot(rd, normalize(vec3(-.55, .72, -.28))), 0.), 72.);
      float windowB = pow(max(dot(rd, normalize(vec3(.72, .32, .61))), 0.), 220.);
      sky += vec3(1.0, .88, .67) * windowA * 3.2;
      sky += vec3(.52, .67, .72) * windowB * 1.6;
      return sky;
    }

    void surfaceMaterial(float id, vec3 p, out vec3 albedo, out float metallic, out float roughness) {
      if (id > 1.5) {
        float grain = .5 + .5 * sin(p.x * 2.7 + sin(p.z * 4.));
        albedo = mix(vec3(.19, .18, .145), vec3(.27, .25, .205), grain * .22);
        metallic = 0.; roughness = .76;
      } else if (uMaterial == 0) {
        float patina = smoothstep(.15, .85, .5 + .5 * sin(p.y * 3.1 + p.z * 2.4));
        albedo = mix(vec3(.53, .55, .49), vec3(.18, .29, .275), patina * .45);
        metallic = .72; roughness = .22;
      } else if (uMaterial == 1) {
        albedo = mix(vec3(.31, .085, .038), vec3(.67, .27, .09), .5 + .5 * sin(p.y * 4.));
        metallic = .18; roughness = .42;
      } else {
        albedo = vec3(.035, .043, .04);
        metallic = .82; roughness = .105;
      }
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

        vec3 lightPos = vec3(mix(-2.8, 2.4, random()), 4.35, mix(-2.8, .8, random()));
        vec3 toLight = lightPos - p;
        float lightDist = length(toLight);
        vec3 lightDir = toLight / lightDist;
        float nDotL = max(dot(n, lightDir), 0.);
        if (nDotL > 0. && visibleToLight(p + n * .006, lightDir, lightDist)) {
          float falloff = 32. / (2. + lightDist * lightDist);
          vec3 lightColor = vec3(1., .78, .52) * falloff;
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
      vec3 rd = normalize(forward * 1.72 + right * uv.x + up * uv.y);

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
    ['uPrevious','uResolution','uCamera','uDistance','uSeed','uFrame','uForm','uMaterial']
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
  let yaw = .62;
  let pitch = .12;
  let distance = 5.8;
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
    distance = Math.max(3.5, Math.min(7.4, distance + event.deltaY * .003));
    hint.style.opacity = '0';
    reset();
  }, { passive: false });

  pauseButton.addEventListener('click', togglePause);
  resetButton.addEventListener('click', () => reset(true));
  formSelect.addEventListener('change', () => reset());
  materialSelect.addEventListener('change', () => reset());

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
