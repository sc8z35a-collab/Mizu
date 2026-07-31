import { EventBus } from './core/event-bus.js';
import { detectCapabilities } from './core/capabilities.js';
import { StorageManager } from './core/storage.js';
import { AudioEngine } from './core/audio-engine.js';
import { Recorder } from './core/recorder.js';
import { OfflineAnalyzer } from './core/offline-analyzer.js';
import { VisualEngine } from './visuals/visual-engine.js';
import { AppController } from './ui/app-controller.js';

const bus = new EventBus();
const capabilities = detectCapabilities();
const storage = new StorageManager();
const audio = new AudioEngine(bus);
const recorder = new Recorder(bus);
const analyzer = new OfflineAnalyzer();
const visuals = new VisualEngine(document.getElementById('visualCanvas'), audio, bus);
const app = new AppController({ bus, audio, recorder, storage, analyzer, visuals, capabilities });

app.init().catch(error => {
  console.error(error);
  const region = document.getElementById('toastRegion');
  if (region) region.innerHTML = `<div class="toast error show">初期化に失敗しました: ${error.message}</div>`;
});

window.addEventListener('beforeunload', () => { visuals.stop(); analyzer.terminate(); audio.destroy(); });
