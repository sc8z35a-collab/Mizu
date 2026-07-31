export class Recorder {
  constructor(bus) { this.bus = bus; this.mediaRecorder = null; this.chunks = []; this.startedAt = 0; this.timer = null; this.pausedAt = 0; }
  get isRecording() { return this.mediaRecorder?.state === 'recording' || this.mediaRecorder?.state === 'paused'; }
  start(stream, mimeType) {
    if (!stream) throw new Error('録音に使用するマイクがありません。');
    if (!window.MediaRecorder) throw new Error('このブラウザは録音に対応していません。');
    const options = mimeType ? { mimeType, audioBitsPerSecond: 192000 } : { audioBitsPerSecond: 192000 };
    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(stream, options);
    this.mediaRecorder.ondataavailable = event => { if (event.data?.size) this.chunks.push(event.data); };
    this.mediaRecorder.onerror = event => this.bus.emit('record-error', event.error || new Error('録音エラー'));
    this.mediaRecorder.start(1000);
    this.startedAt = performance.now();
    this.timer = setInterval(() => this.bus.emit('record-time', (performance.now() - this.startedAt) / 1000), 250);
    this.bus.emit('record-state', { state: 'recording' });
  }
  pause() { if (this.mediaRecorder?.state === 'recording') { this.mediaRecorder.pause(); this.bus.emit('record-state', { state: 'paused' }); } }
  resume() { if (this.mediaRecorder?.state === 'paused') { this.mediaRecorder.resume(); this.bus.emit('record-state', { state: 'recording' }); } }
  stop() {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return Promise.resolve(null);
    return new Promise(resolve => {
      this.mediaRecorder.onstop = () => {
        clearInterval(this.timer);
        const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mimeType });
        const duration = (performance.now() - this.startedAt) / 1000;
        this.bus.emit('record-state', { state: 'stopped', blob, duration, mimeType });
        resolve({ blob, duration, mimeType });
      };
      this.mediaRecorder.stop();
    });
  }
}
