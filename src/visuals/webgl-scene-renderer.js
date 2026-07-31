function hexToRgb01(value) {
  if (!value?.startsWith('#')) return [1, 1, 1];
  const raw = value.slice(1);
  const full = raw.length === 3 ? raw.split('').map(ch => ch + ch).join('') : raw;
  return [full.slice(0, 2), full.slice(2, 4), full.slice(4, 6)].map(v => parseInt(v, 16) / 255);
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log || 'shader compile failed');
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(log || 'program link failed');
  }
  return program;
}

const VERT = `#version 300 es
precision highp float;
out vec2 v_uv;
vec2[3] positions = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);
void main() {
  vec2 pos = positions[gl_VertexID];
  v_uv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_energy;
uniform float u_rms;
uniform float u_peak;
uniform float u_bass;
uniform float u_mid;
uniform float u_high;
uniform vec2 u_pointer;
uniform float u_mixStrength;
uniform int u_mode;
uniform vec3 u_bg;
uniform vec3 u_water;
uniform vec3 u_water2;
uniform vec3 u_sand;
uniform vec3 u_plant;
uniform vec3 u_ink;
uniform vec4 u_droplets[6];

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(7.3, 2.1);
    a *= 0.5;
  }
  return v;
}

float lineMask(float y, float target, float thickness) {
  return 1.0 - smoothstep(thickness, thickness + 0.003, abs(y - target));
}

float ringMask(vec2 uv, vec2 center, float radius, float thickness) {
  float d = abs(length(uv - center) - radius);
  return 1.0 - smoothstep(thickness, thickness + 0.0025, d);
}

float metaballs(vec2 uv) {
  float field = 0.0;
  for (int i = 0; i < 6; i++) {
    vec2 pos = u_droplets[i].xy;
    float r = u_droplets[i].z;
    float life = u_droplets[i].w;
    vec2 delta = uv - pos;
    field += life * (r * r) / (dot(delta, delta) + 0.0008);
  }
  return field;
}

vec3 baseBackdrop(vec2 uv) {
  vec2 p = uv;
  float n1 = fbm(p * 4.0 + vec2(0.0, u_time * 0.035));
  float n2 = fbm(p.yx * 5.2 + vec2(u_time * 0.05, 0.0));
  float n3 = fbm(p * 11.0 + u_time * 0.02);
  float waterWaves = sin((p.x + n1 * 0.1) * 20.0 + u_time * 0.55) * 0.5 + 0.5;
  float caustic = pow(max(0.0, sin((p.x + p.y * 0.75 + n2 * 0.15) * 30.0 + u_time * 0.8)), 6.0);
  caustic += pow(max(0.0, sin((p.x * 1.8 - p.y * 0.9 + n1 * 0.2) * 26.0 - u_time * 0.6)), 7.0);
  caustic *= 0.12 + u_energy * 0.08 + u_high * 0.12;
  float pointerGlow = 1.0 / (1.0 + 14.0 * dot(p - u_pointer, p - u_pointer));
  float paper = n3 * 0.06;
  vec2 centered = p - 0.5;
  centered.x *= u_resolution.x / max(u_resolution.y, 1.0);
  float mist = smoothstep(0.9, 0.2, length(centered + vec2(0.0, 0.12)));
  vec3 color = mix(u_bg, u_water2, smoothstep(0.0, 1.0, n1 * 0.9 + mist * 0.6));
  color = mix(color, u_water, waterWaves * 0.12 + u_bass * 0.08);
  color += vec3(caustic);
  color = mix(color, u_sand, paper);
  color += u_plant * pointerGlow * 0.035;
  float vignette = smoothstep(1.1, 0.18, length(centered));
  color *= 0.94 + vignette * 0.09;
  return color;
}

vec3 modeWaterline(vec2 uv, vec3 color) {
  float wave = 0.53 - (sin(uv.x * 19.0 + u_time * 1.35) * 0.016 + sin(uv.x * 48.0 - u_time * 0.7) * 0.006 + (u_rms + u_bass * 0.7) * 0.08);
  float body = smoothstep(wave + 0.24, wave - 0.01, uv.y);
  color = mix(color, mix(u_water, u_water2, 0.45), body * 0.22);
  float line = lineMask(uv.y, wave, 0.003 + u_peak * 0.005);
  color = mix(color, u_ink, line * 0.72);
  float reflection = lineMask(uv.y, wave + 0.022, 0.004);
  color += vec3(1.0) * reflection * 0.12;
  float ripple = ringMask(vec2(uv.x, uv.y * 0.44 + 0.27), vec2(0.5, 0.5), 0.08 + mod(u_time * 0.1, 0.18), 0.0025) * u_peak;
  color += u_water2 * ripple * 0.35;
  return color;
}

vec3 modeCircularGarden(vec2 uv, vec3 color) {
  vec2 c = uv - 0.5;
  c.x *= u_resolution.x / max(u_resolution.y, 1.0);
  float r = length(c);
  float a = atan(c.y, c.x);
  float petals = 0.11 + (sin(a * 20.0 + u_time * 0.6) * 0.02 + u_high * 0.08 + u_rms * 0.06);
  float ring = ringMask(c, vec2(0.0), petals * 1.3, 0.012);
  float core = 1.0 - smoothstep(0.08 + u_rms * 0.08, 0.16 + u_rms * 0.12, r);
  float spokes = pow(max(0.0, sin(a * 64.0)), 20.0) * smoothstep(0.08, 0.22 + u_high * 0.18, r) * (1.0 - smoothstep(0.22 + u_high * 0.18, 0.55, r));
  color = mix(color, u_plant, ring * 0.4);
  color = mix(color, u_water2, spokes * 0.6);
  color += mix(u_sand, vec3(1.0), 0.25) * core * 0.26;
  return color;
}

vec3 modePaperWave(vec2 uv, vec3 color) {
  float y1 = 0.22 + sin(uv.x * 9.0 + u_time * 0.25) * 0.02 + u_rms * 0.03;
  float y2 = 0.42 + sin(uv.x * 13.0 + u_time * 0.32 + 2.0) * 0.03 + u_mid * 0.04;
  float y3 = 0.66 + sin(uv.x * 11.0 - u_time * 0.28 + 1.0) * 0.025 + u_bass * 0.05;
  float band1 = smoothstep(y1 + 0.07, y1 - 0.01, uv.y) - smoothstep(y1 + 0.11, y1 + 0.04, uv.y);
  float band2 = smoothstep(y2 + 0.07, y2 - 0.01, uv.y) - smoothstep(y2 + 0.11, y2 + 0.04, uv.y);
  float band3 = smoothstep(y3 + 0.07, y3 - 0.01, uv.y) - smoothstep(y3 + 0.11, y3 + 0.04, uv.y);
  color = mix(color, u_sand, band1 * 0.25);
  color = mix(color, u_water2, band2 * 0.2);
  color = mix(color, u_sand, band3 * 0.15);
  float l = lineMask(uv.y, y1, 0.002) + lineMask(uv.y, y2, 0.002) + lineMask(uv.y, y3, 0.002);
  color = mix(color, u_ink, clamp(l, 0.0, 1.0) * 0.35);
  return color;
}

vec3 modeGlassOrbit(vec2 uv, vec3 color) {
  vec2 center = vec2(0.5, 0.5);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float ang = u_time * (0.12 + fi * 0.016) + fi * 1.05;
    vec2 pos = center + vec2(cos(ang), sin(ang) * 0.55) * (0.11 + fi * 0.045);
    float rad = 0.038 + fi * 0.009 + u_peak * 0.03;
    float d = length(uv - pos);
    float bubble = 1.0 - smoothstep(rad, rad + 0.008, d);
    float rim = ringMask(uv, pos, rad * 0.92, 0.004);
    color = mix(color, mix(u_water2, vec3(1.0), 0.35), bubble * 0.18);
    color += vec3(1.0) * rim * 0.16;
  }
  return color;
}

vec3 modeInkBloom(vec2 uv, vec3 color) {
  float ink = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 p = vec2(0.26 + 0.16 * fi + sin(u_time * 0.22 + fi) * 0.02, 0.38 + cos(u_time * 0.18 + fi * 2.0) * 0.09);
    float r = 0.05 + fi * 0.018 + u_rms * 0.05;
    ink += smoothstep(r, 0.0, length(uv - p));
  }
  ink = clamp(ink * 0.35, 0.0, 1.0);
  color = mix(color, mix(u_plant, u_water, 0.5), ink * 0.16);
  return color;
}

vec3 modeParticlePond(vec2 uv, vec3 color) {
  float particles = 0.0;
  for (int i = 0; i < 22; i++) {
    float fi = float(i);
    vec2 pos = vec2(fract(fi * 0.173 + u_time * (0.01 + fi * 0.0005) + sin(fi * 2.1) * 0.1), fract(fi * 0.317 - u_time * (0.012 + fi * 0.0004) + cos(fi * 1.3) * 0.1));
    float d = length(uv - pos);
    particles += (0.003 + u_high * 0.006) / (d * 40.0 + 0.02);
  }
  particles = clamp(particles * 0.18, 0.0, 1.0);
  color += mix(u_water2, vec3(1.0), 0.3) * particles;
  return color;
}

vec3 modeMinimalScope(vec2 uv, vec3 color) {
  float wave = 0.35 + sin(uv.x * 24.0 + u_time * 1.2) * (0.012 + u_rms * 0.04);
  float l = lineMask(uv.y, wave, 0.003);
  color = mix(color, u_ink, l * 0.6);
  for (int i = 0; i < 28; i++) {
    float fi = float(i);
    float x0 = fi / 28.0;
    float bar = step(x0, uv.x) * step(uv.x, x0 + 0.018);
    float h = 0.12 + sin(fi * 0.73 + u_time * 0.7) * 0.03 + u_high * 0.16 * (0.2 + fract(fi * 0.37));
    float mask = bar * step(0.82 - h, uv.y) * step(uv.y, 0.82);
    color = mix(color, mix(u_plant, u_water, 0.6), mask * 0.55);
  }
  return color;
}

void main() {
  vec2 uv = v_uv;
  vec3 color = baseBackdrop(uv);

  if (u_mode == 0) {
    color = modeWaterline(uv, color);
  } else if (u_mode == 1) {
    color = modeCircularGarden(uv, color);
  } else if (u_mode == 2) {
    color = modePaperWave(uv, color);
  } else if (u_mode == 3) {
    color = modeGlassOrbit(uv, color);
  } else if (u_mode == 4) {
    color = modeInkBloom(uv, color);
  } else if (u_mode == 5) {
    color = modeParticlePond(uv, color);
  } else if (u_mode == 6) {
    color = modeMinimalScope(uv, color);
  }

  float blob = metaballs(uv);
  float blobMask = smoothstep(1.25, 2.9, blob);
  float blobRim = smoothstep(1.35, 3.7, blob) - smoothstep(2.6, 5.2, blob);
  color = mix(color, mix(u_water2, vec3(1.0), 0.35), blobMask * 0.22 * u_mixStrength);
  color += vec3(1.0) * blobRim * 0.15 * u_mixStrength;

  outColor = vec4(color, 1.0);
}`;

const MODE_MAP = {
  'waterline': 0,
  'circular-garden': 1,
  'paper-wave': 2,
  'glass-orbit': 3,
  'ink-bloom': 4,
  'particle-pond': 5,
  'minimal-scope': 6,
  'living-canvas': 0
};

export class WebGLSceneRenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      premultipliedAlpha: true
    });
    this.available = Boolean(this.gl);
    this.program = null;
    this.uniforms = null;
    this.pointer = [0.5, 0.5];
    if (!this.available) return;
    try {
      this.program = createProgram(this.gl, VERT, FRAG);
      const gl = this.gl;
      this.uniforms = {
        resolution: gl.getUniformLocation(this.program, 'u_resolution'),
        time: gl.getUniformLocation(this.program, 'u_time'),
        energy: gl.getUniformLocation(this.program, 'u_energy'),
        rms: gl.getUniformLocation(this.program, 'u_rms'),
        peak: gl.getUniformLocation(this.program, 'u_peak'),
        bass: gl.getUniformLocation(this.program, 'u_bass'),
        mid: gl.getUniformLocation(this.program, 'u_mid'),
        high: gl.getUniformLocation(this.program, 'u_high'),
        pointer: gl.getUniformLocation(this.program, 'u_pointer'),
        mixStrength: gl.getUniformLocation(this.program, 'u_mixStrength'),
        mode: gl.getUniformLocation(this.program, 'u_mode'),
        bg: gl.getUniformLocation(this.program, 'u_bg'),
        water: gl.getUniformLocation(this.program, 'u_water'),
        water2: gl.getUniformLocation(this.program, 'u_water2'),
        sand: gl.getUniformLocation(this.program, 'u_sand'),
        plant: gl.getUniformLocation(this.program, 'u_plant'),
        ink: gl.getUniformLocation(this.program, 'u_ink'),
        droplets: gl.getUniformLocation(this.program, 'u_droplets')
      };
    } catch (error) {
      console.warn('Full WebGL renderer disabled:', error);
      this.dispose();
    }
  }

  setPointer(x, y) {
    this.pointer[0] = x;
    this.pointer[1] = y;
  }

  resize(width, height, scale = 1) {
    if (!this.available) return;
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  render({ width, height, scale = 1, time = 0, mode = 'waterline', palette, metrics = {}, droplets = [], mixStrength = 1 }) {
    if (!this.available || !this.program) return false;
    this.resize(width, height, scale);
    const gl = this.gl;
    const dropletData = new Float32Array(24);
    for (let i = 0; i < 6; i++) {
      const d = droplets[i];
      const o = i * 4;
      if (!d) {
        dropletData[o] = -5;
        dropletData[o + 1] = -5;
        dropletData[o + 2] = 0;
        dropletData[o + 3] = 0;
      } else {
        dropletData[o] = d.x / Math.max(1, width);
        dropletData[o + 1] = 1 - d.y / Math.max(1, height);
        dropletData[o + 2] = d.r / Math.max(1, Math.min(width, height));
        dropletData[o + 3] = d.life;
      }
    }

    gl.useProgram(this.program);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.time, time);
    gl.uniform1f(this.uniforms.energy, metrics.energy || 0);
    gl.uniform1f(this.uniforms.rms, metrics.rms || 0);
    gl.uniform1f(this.uniforms.peak, metrics.peak || 0);
    gl.uniform1f(this.uniforms.bass, metrics.bass || 0);
    gl.uniform1f(this.uniforms.mid, metrics.mid || 0);
    gl.uniform1f(this.uniforms.high, metrics.high || 0);
    gl.uniform2f(this.uniforms.pointer, this.pointer[0], 1 - this.pointer[1]);
    gl.uniform1f(this.uniforms.mixStrength, mixStrength);
    gl.uniform1i(this.uniforms.mode, MODE_MAP[mode] ?? 0);
    gl.uniform3fv(this.uniforms.bg, hexToRgb01(palette.bg));
    gl.uniform3fv(this.uniforms.water, hexToRgb01(palette.water));
    gl.uniform3fv(this.uniforms.water2, hexToRgb01(palette.water2));
    gl.uniform3fv(this.uniforms.sand, hexToRgb01(palette.sand));
    gl.uniform3fv(this.uniforms.plant, hexToRgb01(palette.plant));
    gl.uniform3fv(this.uniforms.ink, hexToRgb01(palette.ink));
    gl.uniform4fv(this.uniforms.droplets, dropletData);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  dispose() {
    if (this.gl && this.program) this.gl.deleteProgram(this.program);
    this.program = null;
    this.uniforms = null;
    this.available = false;
    this.gl = null;
  }
}
