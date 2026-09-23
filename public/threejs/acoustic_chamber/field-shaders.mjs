export const volumeVertex = `
out vec3 vPosition;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPosition = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

export const volumeFragment = `
precision highp sampler3D;
uniform sampler3D uField;
uniform vec3 uMin;
uniform vec3 uMax;
uniform vec3 uEye;
uniform float uOpacity;
in vec3 vPosition;
out vec4 outColor;
void main() {
  vec3 direction = normalize(vPosition - uEye);
  vec3 inv = 1.0 / direction;
  vec3 a = (uMin - uEye) * inv, b = (uMax - uEye) * inv;
  vec3 lo = min(a, b), hi = max(a, b);
  float near = max(max(lo.x, lo.y), lo.z), far = min(min(hi.x, hi.y), hi.z);
  near = max(near, 0.0);
  if (near >= far) discard;
  float stepSize = (far - near) / 80.0;
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 color = vec3(0.0);
  float alpha = 0.0;
  for (int i = 0; i < 80; i++) {
    vec3 p = uEye + direction * (near + (float(i) + jitter) * stepSize);
    vec4 data = texture(uField, (p - uMin) / (uMax - uMin));
    float pressure = (data.r - 128.0 / 255.0) * 2.0;
    float density = pow(abs(pressure), 1.3) * smoothstep(0.3, 0.85, data.b);
    float amount = 1.0 - exp(-density * uOpacity * stepSize * 7.0);
    vec3 tint = pressure > 0.0 ? vec3(0.91, 0.53, 0.25) : vec3(0.21, 0.62, 0.81);
    color += (1.0 - alpha) * amount * tint;
    alpha += (1.0 - alpha) * amount;
    if (alpha > 0.94) break;
  }
  if (alpha < 0.004) discard;
  outColor = vec4(color / max(alpha, 0.001), alpha);
}`;

export const sliceFragment = `
precision highp sampler3D;
uniform sampler3D uField;
uniform vec3 uMin;
uniform vec3 uMax;
uniform float uOpacity;
in vec3 vPosition;
out vec4 outColor;
void main() {
  vec4 data = texture(uField, (vPosition - uMin) / (uMax - uMin));
  if (data.b < 0.5) discard;
  float pressure = (data.r - 128.0 / 255.0) * 2.0;
  vec3 tint = pressure > 0.0 ? vec3(0.94, 0.61, 0.32) : vec3(0.24, 0.69, 0.86);
  float strength = clamp(abs(pressure) * 3.0, 0.0, 1.0);
  outColor = vec4(tint * (0.22 + strength * 0.78), uOpacity * (0.05 + 0.95 * strength));
}`;

export const particleVertex = `
attribute vec3 color;
varying vec3 vColor;
varying float vCoverage;
uniform float uPixelRatio;
uniform float uSize;
void main() {
  vColor = color;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;
  float size = clamp(14.0 / max(1.5, -view.z), 1.3, 3.2) * uPixelRatio * uSize;
  gl_PointSize = max(1.0, size);
  vCoverage = min(1.0, size * size);
}`;
export const particleFragment = `
varying vec3 vColor;
varying float vCoverage;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  gl_FragColor = vec4(vColor, (1.0 - smoothstep(0.3, 1.0, r)) * 0.8 * vCoverage);
}`;
