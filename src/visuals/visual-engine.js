import { clamp, lerp } from '../utils/format.js';
import { WebGLSceneRenderer } from './webgl-scene-renderer.js';

const PALETTES = {
  'water-paper': { bg:'#f7f7f2', water:'#b9d7db', water2:'#dcebed', ink:'#596c67', plant:'#748b79', sand:'#d8ccb7', glass:'rgba(255,255,255,.52)' },
  'moss-glass': { bg:'#f1f4f2', water:'#aac5c2', water2:'#d8e4de', ink:'#41524d', plant:'#667d6d', sand:'#c8bdab', glass:'rgba(240,247,244,.5)' },
  'sand-fiber': { bg:'#faf8f1', water:'#c8dcdd', water2:'#e5eeee', ink:'#6c645a', plant:'#879080', sand:'#cbb99d', glass:'rgba(255,252,244,.58)' },
  'moon-water': { bg:'#17211f', water:'#6d9193', water2:'#29403f', ink:'#dbe7e2', plant:'#8ca596', sand:'#9c927f', glass:'rgba(218,235,230,.10)' }
};

export const RESOLUTION_PROFILES = Object.freeze({
  auto: {
    name: '自動',
    supersampling: 1,
    maxScale: 2.5,
    maxPixels: 8_500_000,
    detailQuality: 1,
    autoQuality: true
  },
  high: {
    name: '高解像度',
    supersampling: 1.15,
    maxScale: 3,
    maxPixels: 12_000_000,
    detailQuality: 1.22,
    autoQuality: false
  },
  ultra: {
    name: '超高解像度',
    supersampling: 2,
    maxScale: 4,
    maxPixels: 18_000_000,
    detailQuality: 1.5,
    autoQuality: false
  },
  cinema: {
    name: 'Cinematic',
    supersampling: 2.35,
    maxScale: 5,
    maxPixels: 30_000_000,
    detailQuality: 1.95,
    autoQuality: false
  }
});

export function calculateRenderScale({
  cssWidth,
  cssHeight,
  devicePixelRatio = 1,
  mode = 'ultra',
  pixelBudget,
  maxScale
}) {
  const profile = RESOLUTION_PROFILES[mode] || RESOLUTION_PROFILES.ultra;
  const width = Math.max(1, Number(cssWidth) || 1);
  const height = Math.max(1, Number(cssHeight) || 1);
  const budget = Math.max(1, pixelBudget || profile.maxPixels);
  const scaleCap = Math.max(1, maxScale || profile.maxScale);
  const requested = Math.min(Math.max(1, devicePixelRatio || 1) * profile.supersampling, scaleCap);
  const budgetScale = Math.sqrt(budget / (width * height));
  const scale = Math.max(1, Math.min(requested, budgetScale));
  return {
    scale,
    requestedScale: requested,
    limited: scale + 0.001 < requested,
    pixelWidth: Math.max(1, Math.round(width * scale)),
    pixelHeight: Math.max(1, Math.round(height * scale))
  };
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function withAlpha(hex, alpha) {
  if (!hex?.startsWith('#')) return hex;
  const value = hex.slice(1);
  const normalized = value.length === 3 ? value.split('').map(ch => ch + ch).join('') : value;
  const [r, g, b] = [normalized.slice(0, 2), normalized.slice(2, 4), normalized.slice(4, 6)].map(v => parseInt(v, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export class VisualEngine {
  constructor(canvas, audioEngine, bus) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    this.audio = audioEngine;
    this.bus = bus;
    this.mode = 'waterline';
    this.paletteName = 'water-paper';
    this.palette = PALETTES[this.paletteName];
    this.intensity = 1;
    this.particleDensity = 0.55;
    this.reducedMotion = false;
    this.plantsEnabled = true;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.pixelWidth = 1;
    this.pixelHeight = 1;
    this.resolutionMode = 'ultra';
    this.resolutionLimited = false;
    this.rendererMode = 'full';
    this.webglRenderer = new WebGLSceneRenderer();
    this.webglActive = false;
    this.webglPipeline = 'canvas';
    this.running = false;
    this.raf = 0;
    this.resizeRaf = 0;
    this.last = performance.now();
    this.frameSamples = [];
    this.fps = 60;
    this.quality = RESOLUTION_PROFILES.ultra.detailQuality;
    this.autoQuality = false;
    this.particles = [];
    this.trails = [];
    this.waveHistory = [];
    this.livingMode = 'waterline';
    this.livingLastChange = 0;
    this.pointer = { x: 0.5, y: 0.5, active: false };
    this.metaDroplets = [];
    this.causticSeed = Array.from({ length: 54 }, (_, i) => ({
      x: Math.random(), y: Math.random(), speed: randomRange(0.08, 0.22), scale: randomRange(0.5, 1.4), phase: Math.random() * Math.PI * 2, index: i
    }));
    this.layers = {
      back: this.createLayer(),
      main: this.createLayer(),
      front: this.createLayer(),
      fx: this.createLayer()
    };

    this.scheduleResize = () => {
      cancelAnimationFrame(this.resizeRaf);
      this.resizeRaf = requestAnimationFrame(() => this.resize());
    };

    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.scheduleResize);
      this.resizeObserver.observe(canvas);
    } else {
      this.resizeObserver = null;
    }
    window.addEventListener('resize', this.scheduleResize, { passive: true });
    window.visualViewport?.addEventListener('resize', this.scheduleResize, { passive: true });
    window.addEventListener('orientationchange', this.scheduleResize, { passive: true });
    window.addEventListener('mousemove', event => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      this.pointer.y = clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      this.pointer.active = true;
    }, { passive: true });
    window.addEventListener('touchmove', event => {
      const touch = event.touches?.[0];
      if (!touch) return;
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x = clamp((touch.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      this.pointer.y = clamp((touch.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      this.pointer.active = true;
    }, { passive: true });

    this.resize();
    this.seedParticles();
  }

  createLayer() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    return { canvas, ctx };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    const render = calculateRenderScale({
      cssWidth: this.width,
      cssHeight: this.height,
      devicePixelRatio: window.devicePixelRatio || 1,
      mode: this.resolutionMode
    });
    this.dpr = render.scale;
    this.pixelWidth = render.pixelWidth;
    this.pixelHeight = render.pixelHeight;
    this.resolutionLimited = render.limited;

    if (this.canvas.width !== this.pixelWidth) this.canvas.width = this.pixelWidth;
    if (this.canvas.height !== this.pixelHeight) this.canvas.height = this.pixelHeight;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';

    for (const layer of Object.values(this.layers)) {
      if (layer.canvas.width !== this.pixelWidth) layer.canvas.width = this.pixelWidth;
      if (layer.canvas.height !== this.pixelHeight) layer.canvas.height = this.pixelHeight;
      layer.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      layer.ctx.imageSmoothingEnabled = true;
      layer.ctx.imageSmoothingQuality = 'high';
    }

    this.seedParticles();
  }

  setMode(mode) {
    this.mode = mode;
    this.waveHistory.length = 0;
  }

  setPalette(name) {
    this.paletteName = PALETTES[name] ? name : 'water-paper';
    this.palette = PALETTES[this.paletteName];
    document.documentElement.dataset.palette = this.paletteName;
  }

  setIntensity(value) {
    this.intensity = clamp(Number(value), 0.3, 2);
  }

  setParticleDensity(value) {
    this.particleDensity = clamp(Number(value), 0, 1);
    this.seedParticles();
  }

  setReducedMotion(value) {
    this.reducedMotion = Boolean(value);
  }

  setPlantsEnabled(value) {
    this.plantsEnabled = Boolean(value);
  }

  setRendererMode(mode) {
    this.rendererMode = ['auto', 'canvas', 'hybrid', 'full'].includes(mode) ? mode : 'auto';
  }

  resolveRendererPipeline() {
    if (!this.webglRenderer?.available) return 'canvas';
    if (this.rendererMode === 'canvas') return 'canvas';
    if (this.rendererMode === 'hybrid') return 'hybrid';
    if (this.rendererMode === 'full') return 'full';
    return this.resolutionMode === 'cinema' ? 'hybrid' : 'canvas';
  }

  shouldUseWebGL() {
    return this.resolveRendererPipeline() !== 'canvas';
  }

  setResolutionMode(mode) {
    const next = RESOLUTION_PROFILES[mode] ? mode : 'ultra';
    const profile = RESOLUTION_PROFILES[next];
    const changed = this.resolutionMode !== next;
    this.resolutionMode = next;
    this.autoQuality = profile.autoQuality;
    this.quality = profile.detailQuality;
    if (changed) this.resize();
  }

  getSuggestedScale(width, height, pixelBudget = 4_000_000) {
    return calculateRenderScale({
      cssWidth: width,
      cssHeight: height,
      devicePixelRatio: window.devicePixelRatio || 1,
      mode: this.resolutionMode,
      pixelBudget,
      maxScale: this.resolutionMode === 'cinema' ? 5 : this.resolutionMode === 'ultra' ? 4 : undefined
    });
  }

  seedParticles() {
    const areaContribution = Math.min(this.width * this.height / 2600, 950);
    const base = Math.round((160 + areaContribution) * this.particleDensity * this.quality);
    while (this.particles.length < base) this.particles.push(this.makeParticle());
    this.particles.length = base;
  }

  makeParticle() {
    return {
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.18,
      r: 0.5 + Math.random() * 3.8,
      life: Math.random(),
      phase: Math.random() * Math.PI * 2,
      depth: Math.random(),
      tint: Math.random() > 0.5 ? 'water' : 'sand'
    };
  }

  makeDroplet(peak, time) {
    const size = 18 + peak * Math.min(this.width, this.height) * randomRange(0.05, 0.12);
    return {
      x: this.width * randomRange(0.2, 0.8),
      y: this.height * randomRange(0.22, 0.72),
      r: size,
      life: 1,
      stretch: randomRange(0.75, 1.35),
      vx: randomRange(-14, 14),
      vy: randomRange(-8, 10),
      born: time,
      phase: Math.random() * Math.PI * 2
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.loop(this.last);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.resizeRaf);
  }

  loop = now => {
    if (!this.running) return;
    const dt = Math.min(40, now - this.last);
    this.last = now;
    const metrics = this.audio.sample();
    this.measurePerformance(dt);
    this.draw(now / 1000, dt / 1000, metrics);
    this.bus.emit('visual-metrics', {
      ...metrics,
      fps: this.fps,
      quality: this.quality,
      resolutionMode: this.resolutionMode,
      pixelWidth: this.pixelWidth,
      pixelHeight: this.pixelHeight,
      renderMegapixels: (this.pixelWidth * this.pixelHeight) / 1_000_000,
      renderScale: this.dpr,
      resolutionLimited: this.resolutionLimited,
      rendererMode: this.rendererMode,
      rendererPipeline: this.webglPipeline,
      webglActive: this.webglActive
    });
    this.raf = requestAnimationFrame(this.loop);
  };

  measurePerformance(dt) {
    this.frameSamples.push(dt);
    if (this.frameSamples.length > 90) this.frameSamples.shift();
    if (this.frameSamples.length % 30 !== 0) return;

    const avg = this.frameSamples.reduce((a, b) => a + b, 0) / this.frameSamples.length;
    this.fps = Math.round(1000 / avg);
    if (!this.autoQuality) return;

    if (this.fps < 42 && this.quality > 0.45) {
      this.quality = Math.max(0.45, this.quality - 0.12);
      this.seedParticles();
    } else if (this.fps > 57 && this.quality < RESOLUTION_PROFILES.auto.detailQuality) {
      this.quality = Math.min(RESOLUTION_PROFILES.auto.detailQuality, this.quality + 0.04);
      this.seedParticles();
    }
  }

  clearLayer(ctx) {
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.restore();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  draw(time, dt, metrics) {
    const p = this.palette;
    const energy = clamp(metrics.smoothRms * 5.5 * this.intensity, 0, 1.4);
    this.webglPipeline = this.resolveRendererPipeline();
    this.webglActive = this.webglPipeline !== 'canvas';
    if (this.webglRenderer?.available) this.webglRenderer.setPointer(this.pointer.x, this.pointer.y);
    const back = this.layers.back.ctx;
    const main = this.layers.main.ctx;
    const front = this.layers.front.ctx;
    const fx = this.layers.fx.ctx;

    this.clearLayer(back);
    this.clearLayer(main);
    this.clearLayer(front);
    this.clearLayer(fx);

    let mode = this.mode;
    if (mode === 'living-canvas') mode = this.selectLivingMode(time, metrics);

    if (this.webglPipeline === 'full') {
      this.drawWebGLScene(back, time, metrics, p, mode, 1);
    } else {
      if (this.webglActive) this.drawWebGLScene(back, time, metrics, p, mode, 0.72);
      this.drawBackground(back, time, energy, p);
      this.drawDepthMist(back, time, metrics, p);
      if (mode === 'waterline') this.drawWaterline(main, time, metrics, p);
      else if (mode === 'circular-garden') this.drawCircularGarden(main, time, metrics, p);
      else if (mode === 'paper-wave') this.drawPaperWave(main, time, metrics, p);
      else if (mode === 'glass-orbit') this.drawGlassOrbit(main, time, metrics, p, back.canvas);
      else if (mode === 'ink-bloom') this.drawInkBloom(main, time, dt, metrics, p);
      else if (mode === 'particle-pond') this.drawParticlePond(main, time, dt, metrics, p);
      else if (mode === 'minimal-scope') this.drawMinimalScope(main, time, metrics, p);
    }

    if (this.plantsEnabled && mode !== 'circular-garden') this.drawPlants(this.webglPipeline === 'full' ? front : main, time, metrics, p, this.webglPipeline === 'full' ? 0.32 : 0.42);
    this.drawAmbientParticles(front, time, dt, metrics, p, mode);
    this.updateMetaDroplets(front, time, dt, metrics, p);
    this.drawGlassVeil(fx, time, metrics, p);
    this.drawColorGrade(fx, time, metrics, p);

    this.compositeLayers();
  }

  compositeLayers() {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(this.layers.back.canvas, 0, 0, this.width, this.height);
    ctx.drawImage(this.layers.main.canvas, 0, 0, this.width, this.height);
    ctx.globalAlpha = 0.96;
    ctx.drawImage(this.layers.front.canvas, 0, 0, this.width, this.height);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.layers.fx.canvas, 0, 0, this.width, this.height);
    ctx.restore();
  }

  getParallax(strength = 1) {
    const cx = (this.pointer.x - 0.5) * strength;
    const cy = (this.pointer.y - 0.5) * strength;
    return { x: cx * 16, y: cy * 12 };
  }

  drawWebGLScene(ctx, time, metrics, p, mode, mixStrength = 1) {
    if (!this.webglRenderer?.available) return;
    const ok = this.webglRenderer.render({
      width: this.width,
      height: this.height,
      scale: this.dpr,
      time,
      mode,
      palette: p,
      metrics: {
        energy: clamp(metrics.smoothRms * 6.5 * this.intensity, 0, 1.5),
        rms: metrics.smoothRms || metrics.rms || 0,
        peak: metrics.peak || 0,
        bass: metrics.bands?.Bass || 0,
        mid: metrics.bands?.Mid || 0,
        high: metrics.bands?.Brilliance || 0
      },
      droplets: this.metaDroplets.slice(-6),
      mixStrength
    });
    if (!ok) return;
    ctx.save();
    ctx.globalAlpha = this.webglPipeline === 'full' ? 1 : 0.95;
    ctx.drawImage(this.webglRenderer.canvas, 0, 0, this.width, this.height);
    ctx.restore();
  }

  drawBackground(ctx, time, energy, p) {
    const parallax = this.getParallax(0.5);
    const gradient = ctx.createRadialGradient(
      this.width * 0.5 + parallax.x,
      this.height * 0.4 + parallax.y,
      20,
      this.width * 0.5,
      this.height * 0.5,
      Math.max(this.width, this.height) * 0.86
    );
    gradient.addColorStop(0, p.water2);
    gradient.addColorStop(0.42, p.bg);
    gradient.addColorStop(1, p.bg);
    ctx.globalAlpha = this.webglActive ? 0.42 : 0.86;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.globalAlpha = 1;

    this.drawPaperTexture(ctx, p, energy);
    this.drawCaustics(ctx, time, p, energy);

    if (!this.reducedMotion) {
      const step = Math.max(4, 14 / this.quality);
      ctx.save();
      ctx.globalAlpha = 0.045 + energy * 0.04;
      ctx.strokeStyle = p.water;
      ctx.lineWidth = 0.85;
      for (let i = 0; i < 7; i++) {
        const y = this.height * (0.12 + i * 0.12);
        ctx.beginPath();
        for (let x = -30; x <= this.width + 30; x += step) {
          const yy = y + Math.sin(x * 0.008 + time * (0.18 + i * 0.035)) * (8 + i * 1.2) + Math.cos(x * 0.016 - time * 0.11) * 2.5;
          x > -30 ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawPaperTexture(ctx, p, energy) {
    ctx.save();
    const fibers = Math.floor((180 + this.width * this.height / 8000) * Math.sqrt(this.quality));
    ctx.globalAlpha = 0.05 + energy * 0.01;
    ctx.strokeStyle = withAlpha(p.sand, 0.12);
    ctx.lineWidth = 0.45;
    for (let i = 0; i < fibers; i++) {
      const x = Math.random() * this.width;
      const y = Math.random() * this.height;
      const len = randomRange(3, 14);
      const angle = randomRange(-0.7, 0.7);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len * 0.3);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.03;
    for (let i = 0; i < fibers * 0.3; i++) {
      ctx.fillStyle = i % 2 ? p.water2 : p.sand;
      ctx.fillRect(Math.random() * this.width, Math.random() * this.height, 1, 1);
    }
    ctx.restore();
  }

  drawCaustics(ctx, time, p, energy) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.08 + energy * 0.06;
    for (const seed of this.causticSeed) {
      const x = (seed.x * this.width + Math.sin(time * seed.speed + seed.phase) * 36) % (this.width + 100) - 50;
      const y = (seed.y * this.height + Math.cos(time * seed.speed * 1.3 + seed.phase) * 28) % (this.height + 100) - 50;
      const r = (40 + 64 * seed.scale) * (1 + energy * 0.4);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,.38)');
      grad.addColorStop(0.4, withAlpha(p.water, 0.16));
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.24, seed.phase + time * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawDepthMist(ctx, time, m, p) {
    ctx.save();
    ctx.globalAlpha = 0.08;
    for (let i = 0; i < 5; i++) {
      const x = this.width * (0.18 + i * 0.18) + Math.sin(time * 0.12 + i) * 18;
      const y = this.height * (0.3 + (i % 3) * 0.18);
      const r = Math.min(this.width, this.height) * (0.16 + i * 0.02);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, withAlpha(i % 2 ? p.water2 : p.sand, 0.24));
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  selectLivingMode(time, metrics) {
    if (time - this.livingLastChange > 5) {
      const rms = metrics.smoothRms;
      const high = metrics.bands?.Brilliance || 0;
      const bass = metrics.bands?.Bass || 0;
      this.livingMode = rms < 0.015
        ? 'paper-wave'
        : high > 0.28
          ? 'particle-pond'
          : bass > 0.32
            ? 'waterline'
            : rms > 0.16
              ? 'circular-garden'
              : 'glass-orbit';
      this.livingLastChange = time;
    }
    return this.livingMode;
  }

  drawWaterline(ctx, time, m, p) {
    const wave = m.waveform;
    const center = this.height * 0.53;
    const amp = (38 + m.smoothRms * 310) * this.intensity;
    const fillStep = Math.max(1.2, 3 / this.quality);
    const lineStep = Math.max(0.75, 2.2 / this.quality);

    // Deep water body
    const fill = ctx.createLinearGradient(0, center - amp * 1.2, 0, this.height);
    fill.addColorStop(0, withAlpha(p.water2, 0.56));
    fill.addColorStop(0.48, withAlpha(p.water, 0.26));
    fill.addColorStop(1, 'rgba(143,175,180,.05)');
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, this.height);
    for (let x = 0; x <= this.width; x += fillStep) {
      const idx = wave ? Math.floor(x / this.width * wave.length) : 0;
      const sample = wave ? ((wave[idx] - 128) / 128) : Math.sin(x * 0.01 + time) * 0.02;
      const y = center - sample * amp - Math.sin(x * 0.006 + time * 0.7) * 6 - Math.cos(x * 0.012 - time * 0.24) * 2.5;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(this.width, this.height);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    // Surface reflection
    ctx.beginPath();
    for (let x = 0; x <= this.width; x += lineStep) {
      const idx = wave ? Math.floor(x / this.width * wave.length) : 0;
      const sample = wave ? ((wave[idx] - 128) / 128) : 0;
      const y = center - sample * amp - Math.sin(x * 0.006 + time * 0.7) * 6;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = p.ink;
    ctx.globalAlpha = 0.82;
    ctx.lineWidth = 1.15;
    ctx.stroke();

    // Secondary shimmer line
    ctx.beginPath();
    for (let x = 0; x <= this.width; x += lineStep * 1.4) {
      const idx = wave ? Math.floor(x / this.width * wave.length) : 0;
      const sample = wave ? ((wave[idx] - 128) / 128) : 0;
      const y = center + 10 - sample * amp * 0.42 + Math.sin(x * 0.01 - time * 0.9) * 4;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = withAlpha('#ffffff', 0.46);
    ctx.globalAlpha = 0.32;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();

    this.drawRipples(ctx, time, m, p, center);
  }

  drawRipples(ctx, time, m, p, center) {
    const count = Math.floor((m.peak || 0) * (10 + this.quality * 4) * this.intensity);
    ctx.save();
    ctx.strokeStyle = p.water;
    ctx.lineWidth = 1;
    for (let i = 0; i < count; i++) {
      const phase = (time * 0.5 + i / Math.max(1, count)) % 1;
      const radius = 20 + phase * Math.min(this.width, this.height) * 0.24;
      ctx.globalAlpha = (1 - phase) * 0.18;
      ctx.beginPath();
      ctx.ellipse(this.width * 0.5, center, radius, radius * 0.22, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawCircularGarden(ctx, time, m, p) {
    const freq = m.frequency;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const base = Math.min(this.width, this.height) * 0.14;
    const bins = Math.max(144, Math.floor(240 * this.quality));
    ctx.save();
    ctx.translate(cx, cy);

    // halo
    const pulse = base * (1 + (m.smoothRms || 0) * 2.2 * this.intensity);
    const g = ctx.createRadialGradient(0, 0, 5, 0, 0, pulse * 1.5);
    g.addColorStop(0, p.glass);
    g.addColorStop(0.6, withAlpha(p.water2, 0.12));
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, pulse * 1.5, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < bins; i++) {
      const angle = i / bins * Math.PI * 2 - Math.PI / 2;
      const idx = freq ? Math.floor(Math.pow(i / bins, 1.8) * freq.length * 0.88) : 0;
      const value = freq ? freq[idx] / 255 : 0;
      const length = 7 + value * Math.min(this.width, this.height) * 0.19 * this.intensity;
      ctx.save();
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(base, 0);
      ctx.quadraticCurveTo(base + length * 0.5, Math.sin(time * 1.3 + i * 0.08) * 4 * value, base + length, 0);
      ctx.strokeStyle = i % 4 === 0 ? p.plant : i % 2 ? p.water : p.sand;
      ctx.globalAlpha = 0.25 + value * 0.62;
      ctx.lineWidth = 0.5 + value * 1.7;
      ctx.stroke();
      if (value > 0.62) {
        ctx.fillStyle = withAlpha(p.sand, 0.45);
        ctx.beginPath();
        ctx.ellipse(base + length, 0, 1.2 + value * 4.2, 1 + value * 1.8, angle, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.strokeStyle = withAlpha(p.ink, 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, base, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    if (this.plantsEnabled) this.drawPlants(ctx, time, m, p, 0.92);
  }

  drawPaperWave(ctx, time, m, p) {
    const wave = m.waveform;
    if (!wave) return;
    const bands = Math.max(9, Math.floor(10 * Math.sqrt(this.quality)));
    const gap = this.height / (bands + 1);
    const step = Math.max(1.5, 6 / this.quality);
    ctx.save();
    for (let b = 0; b < bands; b++) {
      const y = gap * (b + 1);
      ctx.beginPath();
      for (let x = 0; x <= this.width; x += step) {
        const idx = Math.floor(((x / this.width) + (b * 0.071)) % 1 * wave.length);
        const sample = (wave[idx] - 128) / 128;
        const yy = y + sample * (18 + b * 3.5) * this.intensity + Math.sin(x * 0.012 + time * 0.3 + b) * 5 + Math.cos(x * 0.021 + b) * 1.8;
        x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
      }
      ctx.lineTo(this.width, y + 18);
      ctx.lineTo(0, y + 18);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, y - 12, 0, y + 20);
      fill.addColorStop(0, b % 2 ? withAlpha(p.sand, 0.26) : withAlpha(p.water2, 0.24));
      fill.addColorStop(1, 'rgba(255,255,255,0.02)');
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = withAlpha(p.ink, 0.24 + b * 0.02);
      ctx.globalAlpha = 0.24 + b * 0.018;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawGlassOrbit(ctx, time, m, p, backCanvas) {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const count = Math.floor(11 + this.quality * 10);
    ctx.save();
    for (let i = 0; i < count; i++) {
      const band = Object.values(m.bands || {})[i % 7] || 0;
      const a = time * (0.05 + i * 0.002) + i / count * Math.PI * 2;
      const orbit = 60 + i * Math.min(this.width, this.height) * 0.019;
      const x = cx + Math.cos(a) * orbit * (1 + band * 0.42);
      const y = cy + Math.sin(a) * orbit * 0.56;
      const r = 12 + band * 60 * this.intensity + i * 0.75;

      // pseudo refraction
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.72, a, 0, Math.PI * 2);
      ctx.clip();
      const scale = 1.04 + band * 0.08;
      const sw = this.width * scale;
      const sh = this.height * scale;
      const dx = -(sw - this.width) * 0.5 + Math.cos(a) * 6 * band;
      const dy = -(sh - this.height) * 0.5 + Math.sin(a) * 6 * band;
      ctx.globalAlpha = 0.18 + band * 0.16;
      ctx.drawImage(backCanvas, dx, dy, sw, sh);
      ctx.restore();

      const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, 2, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,.42)');
      grad.addColorStop(0.7, p.glass);
      grad.addColorStop(1, withAlpha(p.water, 0.08));
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.4 + band * 0.32;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.72, a, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha('#ffffff', 0.35 + band * 0.4);
      ctx.globalAlpha = 0.18 + band * 0.5;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawInkBloom(ctx, time, dt, m, p) {
    if ((m.peak || 0) > 0.28 && Math.random() < 0.13 * this.intensity) {
      this.trails.push({
        x: this.width * (0.2 + Math.random() * 0.6),
        y: this.height * (0.25 + Math.random() * 0.5),
        r: 4,
        life: 1,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 8
      });
    }
    ctx.save();
    for (const t of this.trails) {
      t.life -= dt * (this.reducedMotion ? 0.12 : 0.045);
      t.r += dt * (16 + (m.smoothRms || 0) * 80);
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      ctx.globalAlpha = Math.max(0, t.life) * 0.08;
      const grad = ctx.createRadialGradient(t.x, t.y, 1, t.x, t.y, t.r);
      grad.addColorStop(0, withAlpha(Math.random() > 0.5 ? p.plant : p.water, 0.4));
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fill();
    }
    const trailLimit = Math.floor(150 * this.quality);
    this.trails = this.trails.filter(t => t.life > 0).slice(-trailLimit);
    ctx.restore();
  }

  drawParticlePond(ctx, time, dt, m, p) {
    this.updateParticles(ctx, time, dt, m, p, 2.45);
  }

  drawMinimalScope(ctx, time, m, p) {
    const wave = m.waveform;
    const freq = m.frequency;
    const waveStep = Math.max(0.6, 1.6 / this.quality);
    ctx.save();
    ctx.strokeStyle = p.ink;
    ctx.globalAlpha = 0.78;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= this.width; x += waveStep) {
      const i = wave ? Math.floor(x / this.width * wave.length) : 0;
      const y = this.height * 0.35 + (wave ? ((wave[i] - 128) / 128) : 0) * this.height * 0.18;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();

    const bars = Math.floor(96 * this.quality);
    const gap = Math.max(1.2, 3 / this.quality);
    const bw = (this.width - gap * (bars - 1)) / bars;
    for (let i = 0; i < bars; i++) {
      const idx = freq ? Math.floor(Math.pow(i / bars, 1.65) * freq.length) : 0;
      const v = freq ? freq[idx] / 255 : 0;
      ctx.fillStyle = i < bars * 0.19 ? p.plant : p.water;
      ctx.globalAlpha = 0.18 + v * 0.7;
      ctx.fillRect(i * (bw + gap), this.height * 0.82 - v * this.height * 0.30, Math.max(0.5, bw), v * this.height * 0.30);
    }
    ctx.restore();
  }

  drawAmbientParticles(ctx, time, dt, m, p, mode) {
    if (mode === 'particle-pond') return;
    this.updateParticles(ctx, time, dt, m, p, 0.65);
  }

  getFlowVector(x, y, time, bass, high) {
    const nx = x / this.width;
    const ny = y / this.height;
    const angle = Math.sin(nx * 7 + time * 0.24) * 1.2 + Math.cos(ny * 9 - time * 0.19) * 0.8 + bass * 3.6 + high * Math.sin((nx + ny) * 13 + time * 0.8);
    return { x: Math.cos(angle), y: Math.sin(angle) * 0.65 };
  }

  updateParticles(ctx, time, dt, m, p, multiplier) {
    const energy = (m.smoothRms || 0) * 18 * this.intensity;
    const bass = m.bands?.Bass || 0;
    const high = m.bands?.Brilliance || 0;
    const spread = 0.08 + high * 0.32;
    ctx.save();
    for (const q of this.particles) {
      q.phase += dt * (0.4 + high * 4);
      const flow = this.getFlowVector(q.x, q.y, time + q.phase, bass, high);
      q.vx += (flow.x * 0.012 + (Math.sin(q.phase + time * 0.2) * 0.01)) * multiplier;
      q.vy += (flow.y * 0.012 - high * 0.004) * multiplier;
      q.vx *= 0.992;
      q.vy *= 0.993;
      q.x += q.vx * (1 + energy) * 60 * dt * (0.5 + q.depth * 0.9);
      q.y += q.vy * (1 + energy) * 60 * dt * (0.5 + q.depth * 0.9);
      if (q.x < -10) q.x = this.width + 10;
      if (q.x > this.width + 10) q.x = -10;
      if (q.y < -10) q.y = this.height + 10;
      if (q.y > this.height + 10) q.y = -10;
      const radius = q.r * (1 + high * 0.6) * (0.5 + q.depth * 0.8);
      const grad = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, radius * 2.2);
      grad.addColorStop(0, q.tint === 'sand' ? withAlpha(p.sand, 0.26 + spread) : withAlpha(p.water2, 0.18 + spread));
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 0.1 + high * 0.22;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(q.x, q.y, radius * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  updateMetaDroplets(ctx, time, dt, m, p) {
    const peak = m.peak || 0;
    if (peak > 0.22 && Math.random() < peak * 0.11 * this.intensity) {
      this.metaDroplets.push(this.makeDroplet(peak, time));
    }
    const maxDrops = Math.floor(24 + this.quality * 14);
    this.metaDroplets = this.metaDroplets.slice(-maxDrops).filter(drop => drop.life > 0);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const drop of this.metaDroplets) {
      drop.life -= dt * (0.17 + peak * 0.09);
      drop.x += drop.vx * dt;
      drop.y += drop.vy * dt;
      drop.phase += dt;
      const pulse = 1 + Math.sin(drop.phase * 3.2) * 0.04;
      const rx = drop.r * pulse;
      const ry = drop.r * drop.stretch / pulse;
      const grad = ctx.createRadialGradient(drop.x - rx * 0.25, drop.y - ry * 0.25, 1, drop.x, drop.y, Math.max(rx, ry));
      grad.addColorStop(0, 'rgba(255,255,255,.34)');
      grad.addColorStop(0.55, withAlpha(p.water2, 0.18 * drop.life));
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.14 * drop.life;
      ctx.beginPath();
      ctx.ellipse(drop.x, drop.y, rx, ry, Math.sin(drop.phase) * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha('#ffffff', 0.22 * drop.life);
      ctx.globalAlpha = 0.16 * drop.life;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawGlassVeil(ctx, time, m, p) {
    const parallax = this.getParallax(0.9);
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = p.glass;
    ctx.beginPath();
    ctx.moveTo(this.width * 0.08 + parallax.x, this.height * 0.08);
    ctx.quadraticCurveTo(this.width * 0.32, this.height * 0.02, this.width * 0.56, this.height * 0.1);
    ctx.quadraticCurveTo(this.width * 0.78, this.height * 0.16, this.width * 0.92, this.height * 0.12);
    ctx.lineTo(this.width * 0.92, this.height * 0.22);
    ctx.quadraticCurveTo(this.width * 0.74, this.height * 0.29, this.width * 0.48, this.height * 0.23);
    ctx.quadraticCurveTo(this.width * 0.22, this.height * 0.17, this.width * 0.08, this.height * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawColorGrade(ctx, time, m, p) {
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, this.width, this.height);
    grad.addColorStop(0, withAlpha(p.water2, 0.04));
    grad.addColorStop(1, withAlpha(p.sand, 0.06));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  drawPlants(ctx, time, m, p, alpha = 1) {
    const mid = m.bands?.Mid || 0;
    const baseY = this.height;
    const density = Math.sqrt(this.quality);
    const count = Math.floor((10 + this.width / 120) * density);
    ctx.save();
    ctx.strokeStyle = p.plant;
    ctx.lineWidth = 0.95;
    ctx.globalAlpha = 0.18 * alpha;
    for (let i = 0; i < count; i++) {
      const x = (i + 0.45) * this.width / count;
      const h = 48 + (i % 6) * 16 + mid * 96 * this.intensity;
      const sway = Math.sin(time * 0.6 + i * 0.8) * 10 * (0.4 + mid * 2);
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.quadraticCurveTo(x + sway * 0.25, baseY - h * 0.5, x + sway, baseY - h);
      ctx.stroke();
      for (let j = 1; j < 5; j++) {
        const t = j / 5;
        const px = lerp(x, x + sway, t);
        const py = baseY - h * t;
        const tilt = j % 2 ? 0.6 : -0.6;
        ctx.beginPath();
        ctx.ellipse(px + (j % 2 ? 6 : -6), py, 8 + mid * 4.5, 2.5 + mid * 2.2, tilt, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(p.plant, 0.14 * alpha);
        ctx.fill();
        if (j > 2 && Math.random() > 0.65) {
          ctx.beginPath();
          ctx.ellipse(px + (j % 2 ? 10 : -10), py - 4, 3.5 + mid * 2, 1.5 + mid, tilt, 0, Math.PI * 2);
          ctx.fillStyle = withAlpha(p.sand, 0.12 * alpha);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }
}
