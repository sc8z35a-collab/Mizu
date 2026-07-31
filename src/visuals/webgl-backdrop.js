function hexToRgb01(value) {
  if (!value?.startsWith('#')) return [1, 1, 1];
  const raw = value.slice(1);
  const full = raw.length === 3 ? raw.split('').map(ch => ch + ch).join('') : raw;
  const int = [full.slice(0, 2), full.slice(2, 4), full.slice(4, 6)].map(v => parseInt(v, 16) / 255);
  return int;
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
uniform float u_bass;
uniform float u_high;
uniform vec2 u_pointer;
uniform float u_webglMix;
uniform vec3 u_bg;
uniform vec3 u_water;
uniform vec3 u_water2;
uniform vec3 u_sand;
uniform vec3 u_plant;
uniform vec4 u_droplets[4];

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
    p = p * 2.0 + vec2(8.7, 2.3);
    a *= 0.5;
  }
  return v;
}

float metaballs(vec2 uv) {
  float field = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 pos = u_droplets[i].xy;
    float r = u_droplets[i].z;
    float life = u_droplets[i].w;
    vec2 delta = uv - pos;
    field += life * (r * r) / (dot(delta, delta) + 0.0008);
  }
  return field;
}

void main() {
  vec2 uv = v_uv;
  vec2 centered = uv - 0.5;
  centered.x *= u_resolution.x / max(u_resolution.y, 1.0);

  float n1 = fbm(uv * 4.0 + vec2(0.0, u_time * 0.035));
  float n2 = fbm(uv.yx * 5.0 + vec2(u_time * 0.05, 0.0));
  float waterWaves = sin((uv.x + n1 * 0.1) * 20.0 + u_time * 0.55) * 0.5 + 0.5;
  float caustic = pow(max(0.0, sin((uv.x + uv.y * 0.75 + n2 * 0.15) * 30.0 + u_time * 0.8)), 6.0);
  caustic += pow(max(0.0, sin((uv.x * 1.8 - uv.y * 0.9 + n1 * 0.2) * 26.0 - u_time * 0.6)), 7.0);
  caustic *= 0.12 + u_energy * 0.08 + u_high * 0.12;

  float pointerGlow = 1.0 / (1.0 + 14.0 * dot(uv - u_pointer, uv - u_pointer));
  float paper = fbm(uv * 18.0 + 2.0) * 0.06;
  float mist = smoothstep(0.9, 0.2, length(centered + vec2(0.0, 0.12)));
  vec3 color = mix(u_bg, u_water2, smoothstep(0.0, 1.0, n1 * 0.9 + mist * 0.6));
  color = mix(color, u_water, waterWaves * 0.12 + u_bass * 0.08);
  color += vec3(caustic);
  color = mix(color, u_sand, paper);
  color += u_plant * pointerGlow * 0.035;

  float blob = metaballs(uv);
  float blobMask = smoothstep(1.2, 2.8, blob);
  float blobRim = smoothstep(1.3, 3.5, blob) - smoothstep(2.4, 5.0, blob);
  color = mix(color, mix(u_water2, vec3(1.0), 0.35), blobMask * 0.22 * u_webglMix);
  color += vec3(1.0) * blobRim * 0.15 * u_webglMix;

  float vignette = smoothstep(1.05, 0.18, length(centered));
  color *= 0.94 + vignette * 0.09;
  outColor = vec4(color, 1.0);
}`;

export class WebGLBackdrop {
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
    this.uniforms = null;
    this.program = null;
    this.pointer = [0.5, 0.5];
    if (!this.available) return;
    try {
      this.program = createProgram(this.gl, VERT, FRAG);
      this.uniforms = {
        resolution: this.gl.getUniformLocation(this.program, 'u_resolution'),
        time: this.gl.getUniformLocation(this.program, 'u_time'),
        energy: this.gl.getUniformLocation(this.program, 'u_energy'),
        bass: this.gl.getUniformLocation(this.program, 'u_bass'),
        high: this.gl.getUniformLocation(this.program, 'u_high'),
        pointer: this.gl.getUniformLocation(this.program, 'u_pointer'),
        webglMix: this.gl.getUniformLocation(this.program, 'u_webglMix'),
        bg: this.gl.getUniformLocation(this.program, 'u_bg'),
        water: this.gl.getUniformLocation(this.program, 'u_water'),
        water2: this.gl.getUniformLocation(this.program, 'u_water2'),
        sand: this.gl.getUniformLocation(this.program, 'u_sand'),
        plant: this.gl.getUniformLocation(this.program, 'u_plant'),
        droplets: this.gl.getUniformLocation(this.program, 'u_droplets')
      };
    } catch (error) {
      console.warn('WebGL renderer disabled:', error);
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

  render({ width, height, scale = 1, time = 0, energy = 0, bass = 0, high = 0, palette, droplets = [], mixStrength = 1 }) {
    if (!this.available || !this.program) return false;
    this.resize(width, height, scale);
    const gl = this.gl;
    const bg = hexToRgb01(palette.bg);
    const water = hexToRgb01(palette.water);
    const water2 = hexToRgb01(palette.water2);
    const sand = hexToRgb01(palette.sand);
    const plant = hexToRgb01(palette.plant);

    const dropletData = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      const d = droplets[i];
      const offset = i * 4;
      if (!d) {
        dropletData[offset + 0] = -5;
        dropletData[offset + 1] = -5;
        dropletData[offset + 2] = 0;
        dropletData[offset + 3] = 0;
      } else {
        dropletData[offset + 0] = d.x / Math.max(1, width);
        dropletData[offset + 1] = 1 - d.y / Math.max(1, height);
        dropletData[offset + 2] = d.r / Math.max(1, Math.min(width, height));
        dropletData[offset + 3] = d.life;
      }
    }

    gl.useProgram(this.program);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.time, time);
    gl.uniform1f(this.uniforms.energy, energy);
    gl.uniform1f(this.uniforms.bass, bass);
    gl.uniform1f(this.uniforms.high, high);
    gl.uniform2f(this.uniforms.pointer, this.pointer[0], 1 - this.pointer[1]);
    gl.uniform1f(this.uniforms.webglMix, mixStrength);
    gl.uniform3fv(this.uniforms.bg, bg);
    gl.uniform3fv(this.uniforms.water, water);
    gl.uniform3fv(this.uniforms.water2, water2);
    gl.uniform3fv(this.uniforms.sand, sand);
    gl.uniform3fv(this.uniforms.plant, plant);
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
