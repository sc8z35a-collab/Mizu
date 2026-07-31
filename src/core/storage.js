const DB_NAME = 'mizune-audio-lab';
const DB_VERSION = 1;
const STORES = { tracks: 'tracks', playlists: 'playlists', analyses: 'analyses', settings: 'settings' };

export class StorageManager {
  constructor() { this.db = null; }
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORES.tracks)) db.createObjectStore(STORES.tracks, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORES.playlists)) db.createObjectStore(STORES.playlists, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORES.analyses)) db.createObjectStore(STORES.analyses, { keyPath: 'trackId' });
        if (!db.objectStoreNames.contains(STORES.settings)) db.createObjectStore(STORES.settings, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.db;
  }
  async transaction(storeName, mode, callback) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try { result = callback(store); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }
  async putTrack(track) { await this.transaction(STORES.tracks, 'readwrite', store => store.put(track)); return track; }
  async getTrack(id) { return this.request(STORES.tracks, store => store.get(id)); }
  async getTracks() { return this.request(STORES.tracks, store => store.getAll()); }
  async deleteTrack(id) { await this.transaction(STORES.tracks, 'readwrite', store => store.delete(id)); }
  async putAnalysis(analysis) { await this.transaction(STORES.analyses, 'readwrite', store => store.put(analysis)); return analysis; }
  async getAnalysis(trackId) { return this.request(STORES.analyses, store => store.get(trackId)); }
  async clearAnalyses() { await this.transaction(STORES.analyses, 'readwrite', store => store.clear()); }
  async setSetting(key, value) { await this.transaction(STORES.settings, 'readwrite', store => store.put({ key, value })); }
  async getSetting(key, fallback = null) { const row = await this.request(STORES.settings, store => store.get(key)); return row?.value ?? fallback; }
  async getAllSettings() { const rows = await this.request(STORES.settings, store => store.getAll()); return Object.fromEntries(rows.map(row => [row.key, row.value])); }
  async clearAll() {
    const db = await this.open();
    await Promise.all(Object.values(STORES).map(name => new Promise((resolve, reject) => {
      const tx = db.transaction(name, 'readwrite'); tx.objectStore(name).clear(); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    })));
  }
  async request(storeName, producer) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = producer(tx.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
