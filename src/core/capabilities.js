export function detectCapabilities() {
  const supportedRecordingTypes = [
    'audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'
  ].filter(type => window.MediaRecorder?.isTypeSupported?.(type));
  return {
    webAudio: Boolean(window.AudioContext || window.webkitAudioContext),
    microphone: Boolean(navigator.mediaDevices?.getUserMedia),
    mediaRecorder: Boolean(window.MediaRecorder),
    indexedDB: Boolean(window.indexedDB),
    worker: Boolean(window.Worker),
    serviceWorker: 'serviceWorker' in navigator,
    fullscreen: Boolean(document.documentElement.requestFullscreen),
    webgl2: (() => { try { const c = document.createElement('canvas'); return Boolean(c.getContext('webgl2')); } catch { return false; } })(),
    recordingTypes: supportedRecordingTypes,
    secureContext: window.isSecureContext,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemory: navigator.deviceMemory || null
  };
}
