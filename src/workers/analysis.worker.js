function postProgress(requestId, progress) { self.postMessage({ requestId, progress }); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

self.onmessage = event => {
  const { requestId, sampleRate, duration, channels } = event.data;
  try {
    const result = analyze(channels, sampleRate, duration, requestId);
    self.postMessage({ requestId, result });
  } catch (error) {
    self.postMessage({ requestId, error: error?.message || String(error) });
  }
};

function analyze(channels, sampleRate, duration, requestId) {
  const length = channels[0]?.length || 0;
  if (!length) throw new Error('解析できる音声データがありません。');
  const mono = new Float32Array(length);
  for (let c = 0; c < channels.length; c++) {
    const channel = channels[c];
    for (let i = 0; i < length; i++) mono[i] += channel[i] / channels.length;
  }
  postProgress(requestId, 0.28);

  const waveformBins = Math.min(1600, length);
  const waveform = new Array(waveformBins);
  const samplesPerBin = Math.max(1, Math.floor(length / waveformBins));
  let globalSum = 0, globalPeak = 0;
  for (let bin = 0; bin < waveformBins; bin++) {
    const start = bin * samplesPerBin;
    const end = bin === waveformBins - 1 ? length : Math.min(length, start + samplesPerBin);
    let min = 1, max = -1;
    for (let i = start; i < end; i++) {
      const sample = mono[i]; min = Math.min(min, sample); max = Math.max(max, sample);
      globalSum += sample * sample; globalPeak = Math.max(globalPeak, Math.abs(sample));
    }
    waveform[bin] = [min, max];
  }
  postProgress(requestId, 0.45);

  const frameSeconds = 0.25;
  const frameSize = Math.max(1, Math.floor(sampleRate * frameSeconds));
  const frames = [];
  let silenceFrames = 0;
  const alphaLow = Math.exp(-2 * Math.PI * 250 / sampleRate);
  const alphaMid = Math.exp(-2 * Math.PI * 2000 / sampleRate);
  let lpLow = 0, lpMid = 0;
  const onsetEnergies = [];
  for (let start = 0; start < length; start += frameSize) {
    const end = Math.min(length, start + frameSize);
    let sum = 0, peak = 0, zc = 0, prev = mono[start] || 0;
    let lowSum = 0, midSum = 0, highSum = 0;
    for (let i = start; i < end; i++) {
      const x = mono[i]; sum += x*x; peak = Math.max(peak, Math.abs(x));
      if ((x >= 0) !== (prev >= 0)) zc++;
      lpLow = (1 - alphaLow) * x + alphaLow * lpLow;
      lpMid = (1 - alphaMid) * x + alphaMid * lpMid;
      const low = lpLow, mid = lpMid - lpLow, high = x - lpMid;
      lowSum += low*low; midSum += mid*mid; highSum += high*high; prev = x;
    }
    const n = Math.max(1, end-start);
    const rms = Math.sqrt(sum/n);
    const energies = { low: Math.sqrt(lowSum/n), mid: Math.sqrt(midSum/n), high: Math.sqrt(highSum/n) };
    const dominantBand = Object.entries(energies).sort((a,b)=>b[1]-a[1])[0][0];
    let type;
    if (rms < 0.008) { type = 'silence'; silenceFrames++; }
    else if (rms < 0.025) type = 'quiet';
    else if (rms > 0.22 || peak > 0.85) type = 'peak';
    else if (rms > 0.11) type = 'loud';
    else type = dominantBand;
    frames.push({ startTime: start/sampleRate, endTime: end/sampleRate, rms, peak, zeroCrossingRate: zc/n, dominantBand, energies, type });
    onsetEnergies.push(rms);
  }
  postProgress(requestId, 0.72);

  const merged = [];
  for (const frame of frames) {
    const last = merged[merged.length - 1];
    if (last && last.type === frame.type) {
      const oldDuration = last.endTime - last.startTime;
      const addDuration = frame.endTime - frame.startTime;
      const total = oldDuration + addDuration;
      last.endTime = frame.endTime;
      last.averageRms = (last.averageRms * oldDuration + frame.rms * addDuration) / total;
      last.peak = Math.max(last.peak, frame.peak);
    } else {
      merged.push({ startTime: frame.startTime, endTime: frame.endTime, type: frame.type, averageRms: frame.rms, peak: frame.peak, dominantBand: frame.dominantBand, confidence: 0.72 });
    }
  }
  for (let i = 1; i < merged.length - 1; i++) {
    const segment = merged[i];
    if (segment.endTime - segment.startTime < 0.75 && merged[i-1].type === merged[i+1].type) {
      merged[i-1].endTime = merged[i+1].endTime;
      merged[i-1].peak = Math.max(merged[i-1].peak, segment.peak, merged[i+1].peak);
      merged.splice(i, 2); i--;
    }
  }

  const tempo = estimateTempo(onsetEnergies, frameSeconds);
  const averageRms = Math.sqrt(globalSum / length);
  const bandTotals = frames.reduce((acc, f) => { acc.low += f.energies.low; acc.mid += f.energies.mid; acc.high += f.energies.high; return acc; }, {low:0,mid:0,high:0});
  const dominantBand = Object.entries(bandTotals).sort((a,b)=>b[1]-a[1])[0][0];
  postProgress(requestId, 0.94);
  return {
    duration, sampleRate, channels: channels.length, averageRms, peak: globalPeak,
    silenceRatio: frames.length ? silenceFrames / frames.length : 0,
    dominantBand, estimatedTempo: tempo, waveform, segments: merged,
    analyzedAt: Date.now(), analysisVersion: 1
  };
}

function estimateTempo(energies, frameSeconds) {
  if (energies.length < 10) return null;
  const onsets = [];
  for (let i = 2; i < energies.length; i++) {
    const local = (energies[i-1] + energies[i-2]) / 2;
    if (energies[i] > local * 1.45 && energies[i] > 0.035) onsets.push(i * frameSeconds);
  }
  const bpms = [];
  for (let i = 1; i < onsets.length; i++) {
    const delta = onsets[i] - onsets[i-1];
    if (delta >= 0.28 && delta <= 1.5) {
      let bpm = 60 / delta;
      while (bpm < 60) bpm *= 2;
      while (bpm > 180) bpm /= 2;
      bpms.push(bpm);
    }
  }
  if (!bpms.length) return null;
  bpms.sort((a,b)=>a-b);
  return Math.round(bpms[Math.floor(bpms.length/2)]);
}
