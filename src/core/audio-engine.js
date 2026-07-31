import { clamp } from '../utils/format.js';

const AudioContextClass = window.AudioContext || window.webkitAudioContext;

export class AudioEngine {
  constructor(bus) {
    this.bus = bus;
    this.context = null;
    this.analyser = null;
    this.masterGain = null;
    this.sourceNode = null;
    this.mediaElement = new Audio();
    this.mediaElement.preload = 'metadata';
    this.mediaElement.crossOrigin = 'anonymous';
    this.mediaElementNode = null;
    this.stream = null;
    this.mode = 'idle';
    this.currentTrack = null;
    this.objectUrl = null;
    this.freqData = null;
    this.waveData = null;
    this.smoothing = 0.78;
    this.analysisResolutionMode = 'ultra';
    this.metrics = { rms: 0, peak: 0, smoothRms: 0, bands: {}, dominantBand: '—', stereoBalance: 0 };
    this.demoNodes = [];
    this.mediaElement.addEventListener('play', () => this.bus.emit('playstate', { playing: true }));
    this.mediaElement.addEventListener('pause', () => this.bus.emit('playstate', { playing: false }));
    this.mediaElement.addEventListener('ended', () => this.bus.emit('ended'));
    this.mediaElement.addEventListener('timeupdate', () => this.bus.emit('timeupdate', this.getTimeState()));
    this.mediaElement.addEventListener('loadedmetadata', () => this.bus.emit('duration', this.getTimeState()));
    this.mediaElement.addEventListener('error', () => this.bus.emit('audio-error', this.mediaElement.error));
  }

  async ensureContext() {
    if (!AudioContextClass) throw new Error('Web Audio APIに対応していません。');
    if (!this.context) {
      this.context = new AudioContextClass({ latencyHint: 'interactive' });
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = this.getFftSize();
      this.analyser.minDecibels = -95;
      this.analyser.maxDecibels = -15;
      this.analyser.smoothingTimeConstant = this.smoothing;
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = 1;
      // 解析ノードはスピーカーへ直結しない。マイク入力のハウリングを防ぐ。
      this.masterGain.connect(this.context.destination);
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.waveData = new Uint8Array(this.analyser.fftSize);
    }
    if (this.context.state === 'suspended') await this.context.resume();
    return this.context;
  }

  getFftSize() {
    return ({ auto: 2048, high: 4096, ultra: 8192, cinema: 16384 })[this.analysisResolutionMode] || 8192;
  }

  setAnalysisResolution(mode) {
    this.analysisResolutionMode = ['auto', 'high', 'ultra', 'cinema'].includes(mode) ? mode : 'ultra';
    if (!this.analyser) return;
    this.analyser.fftSize = this.getFftSize();
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.waveData = new Uint8Array(this.analyser.fftSize);
  }

  setSmoothing(value) {
    this.smoothing = clamp(Number(value), 0, 0.95);
    if (this.analyser) this.analyser.smoothingTimeConstant = this.smoothing;
  }

  disconnectSource() {
    try { this.sourceNode?.disconnect(); } catch {}
    this.sourceNode = null;
    if (this.stream) { this.stream.getTracks().forEach(track => track.stop()); this.stream = null; }
    this.stopDemo();
  }

  async loadTrack(track) {
    await this.ensureContext();
    this.stopDemo();
    if (this.stream) { this.stream.getTracks().forEach(item => item.stop()); this.stream = null; }
    if (!this.mediaElementNode) {
      this.mediaElementNode = this.context.createMediaElementSource(this.mediaElement);
      this.mediaElementNode.connect(this.analyser);
      this.mediaElementNode.connect(this.masterGain);
    }
    this.sourceNode = this.mediaElementNode;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(track.blob);
    this.mediaElement.src = this.objectUrl;
    this.currentTrack = track;
    this.mode = 'file';
    this.bus.emit('sourcechange', { mode: 'file', track });
    await new Promise((resolve, reject) => {
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('音声ファイルを読み込めませんでした。')); };
      const cleanup = () => { this.mediaElement.removeEventListener('loadedmetadata', done); this.mediaElement.removeEventListener('error', fail); };
      this.mediaElement.addEventListener('loadedmetadata', done);
      this.mediaElement.addEventListener('error', fail);
      this.mediaElement.load();
    });
    return this.getTimeState();
  }

  async useMicrophone(constraints = {}) {
    await this.ensureContext();
    this.mediaElement.pause();
    this.stopDemo();
    if (this.stream) this.stream.getTracks().forEach(track => track.stop());
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      noiseSuppression: constraints.noiseSuppression ?? true,
      echoCancellation: constraints.echoCancellation ?? true,
      autoGainControl: constraints.autoGainControl ?? false
    }});
    this.stream = stream;
    this.sourceNode = this.context.createMediaStreamSource(stream);
    this.sourceNode.connect(this.analyser);
    this.mode = 'microphone';
    this.currentTrack = null;
    this.bus.emit('sourcechange', { mode: 'microphone', stream });
    return stream;
  }

  async startDemo() {
    await this.ensureContext();
    this.mediaElement.pause();
    if (this.stream) { this.stream.getTracks().forEach(track => track.stop()); this.stream = null; }
    this.stopDemo();
    const now = this.context.currentTime;
    const output = this.context.createGain();
    output.gain.value = 0.12;
    output.connect(this.analyser);
    output.connect(this.masterGain);
    const makeVoice = (frequency, type, detune, lfoRate) => {
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      const lfo = this.context.createOscillator();
      const lfoGain = this.context.createGain();
      osc.type = type; osc.frequency.value = frequency; osc.detune.value = detune;
      gain.gain.value = 0.18;
      lfo.frequency.value = lfoRate; lfoGain.gain.value = frequency * 0.035;
      lfo.connect(lfoGain); lfoGain.connect(osc.frequency); osc.connect(gain); gain.connect(output);
      osc.start(now); lfo.start(now); return [osc, gain, lfo, lfoGain];
    };
    this.demoNodes = [output, ...makeVoice(110, 'sine', 0, 0.17), ...makeVoice(220, 'triangle', 6, 0.11), ...makeVoice(330, 'sine', -7, 0.23)];
    this.sourceNode = output;
    this.mode = 'demo';
    this.currentTrack = { id: 'demo', title: 'Water Garden Demo', sourceType: 'demo', duration: Infinity };
    this.bus.emit('sourcechange', { mode: 'demo', track: this.currentTrack });
    this.bus.emit('playstate', { playing: true });
  }

  stopDemo() {
    this.demoNodes.forEach(node => { try { node.stop?.(); } catch {} try { node.disconnect?.(); } catch {} });
    this.demoNodes = [];
  }

  async play() {
    await this.ensureContext();
    if (this.mode === 'file') await this.mediaElement.play();
  }
  pause() { if (this.mode === 'file') this.mediaElement.pause(); }
  toggle() { return this.mediaElement.paused ? this.play() : this.pause(); }
  seek(seconds) { if (this.mode === 'file' && Number.isFinite(this.mediaElement.duration)) this.mediaElement.currentTime = clamp(seconds, 0, this.mediaElement.duration); }
  setVolume(value) { if (this.masterGain) this.masterGain.gain.value = clamp(value, 0, 1.5); }
  getTimeState() { return { currentTime: this.mediaElement.currentTime || 0, duration: Number.isFinite(this.mediaElement.duration) ? this.mediaElement.duration : 0 }; }
  isPlaying() { return this.mode === 'demo' || (this.mode === 'file' && !this.mediaElement.paused); }

  sample() {
    if (!this.analyser || !this.freqData || !this.waveData) return this.metrics;
    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.waveData);
    let sum = 0, peak = 0;
    for (let i = 0; i < this.waveData.length; i++) {
      const value = (this.waveData[i] - 128) / 128;
      sum += value * value; peak = Math.max(peak, Math.abs(value));
    }
    const rms = Math.sqrt(sum / this.waveData.length);
    const sampleRate = this.context.sampleRate;
    const nyquist = sampleRate / 2;
    const ranges = {
      'Sub Bass': [20,60], Bass:[60,250], 'Low Mid':[250,500], Mid:[500,2000], 'High Mid':[2000,4000], Presence:[4000,6000], Brilliance:[6000,Math.min(20000,nyquist)]
    };
    const bands = {};
    let dominantBand = '—', dominantValue = -1;
    Object.entries(ranges).forEach(([name,[low,high]]) => {
      const start = Math.max(0, Math.floor((low / nyquist) * this.freqData.length));
      const end = Math.min(this.freqData.length - 1, Math.ceil((high / nyquist) * this.freqData.length));
      let total = 0; for (let i = start; i <= end; i++) total += this.freqData[i];
      const normalized = end >= start ? total / ((end - start + 1) * 255) : 0;
      bands[name] = normalized;
      if (normalized > dominantValue) { dominantValue = normalized; dominantBand = name; }
    });
    this.metrics = { rms, peak, smoothRms: this.metrics.smoothRms * 0.84 + rms * 0.16, bands, dominantBand, frequency: this.freqData, waveform: this.waveData, spectrumBins: this.freqData.length, waveformSamples: this.waveData.length };
    return this.metrics;
  }

  destroy() {
    this.mediaElement.pause(); if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.disconnectSource(); this.context?.close();
  }
}
