const fs = require('fs');
const vm = require('vm');
const path = require('path');

const workerPath = path.join(__dirname, '..', 'src', 'workers', 'analysis.worker.js');
const code = fs.readFileSync(workerPath, 'utf8');
const messages = [];
const context = { self: { postMessage: message => messages.push(message) }, console, Math, Float32Array, Array, Object, Date, Error };
vm.createContext(context);
vm.runInContext(code, context);

const sampleRate = 48000;
const duration = 4;
const channel = new Float32Array(sampleRate * duration);
for (let i = 0; i < channel.length; i++) {
  const time = i / sampleRate;
  const amplitude = time < 1 ? 0 : time < 2 ? 0.05 : time < 3 ? 0.18 : 0.03;
  const frequency = time < 2 ? 110 : time < 3 ? 440 : 3000;
  channel[i] = amplitude * Math.sin(2 * Math.PI * frequency * time);
}
context.self.onmessage({ data: { requestId: 1, sampleRate, duration, channels: [channel] } });
const final = messages.find(message => message.result);
if (!final) throw new Error('解析結果が返りませんでした。');
const result = final.result;
if (result.waveform.length !== 1600) throw new Error('波形点数が不正です。');
if (result.segments.length < 3) throw new Error('区間分類数が不足しています。');
if (result.peak < 0.17) throw new Error('ピーク値が不正です。');
console.log('PASS', { segments: result.segments.map(segment => segment.type), rms: result.averageRms, peak: result.peak });
