export class OfflineAnalyzer {
  constructor() { this.worker = null; this.pending = new Map(); this.sequence = 0; }
  ensureWorker() {
    if (this.worker) return;
    this.worker = new Worker(new URL('../workers/analysis.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = event => {
      const { requestId, result, error, progress } = event.data;
      const item = this.pending.get(requestId);
      if (!item) return;
      if (progress != null) { item.onProgress?.(progress); return; }
      this.pending.delete(requestId);
      error ? item.reject(new Error(error)) : item.resolve(result);
    };
  }
  async analyzeBlob(blob, audioContext, onProgress) {
    this.ensureWorker();
    const arrayBuffer = await blob.arrayBuffer();
    onProgress?.(0.08);
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    onProgress?.(0.18);
    const channels = [];
    for (let index = 0; index < audioBuffer.numberOfChannels; index++) channels.push(audioBuffer.getChannelData(index).slice());
    const requestId = ++this.sequence;
    const resultPromise = new Promise((resolve, reject) => this.pending.set(requestId, { resolve, reject, onProgress }));
    const transfers = channels.map(channel => channel.buffer);
    this.worker.postMessage({ requestId, sampleRate: audioBuffer.sampleRate, duration: audioBuffer.duration, channels }, transfers);
    return resultPromise;
  }
  terminate() { this.worker?.terminate(); this.worker = null; this.pending.clear(); }
}
