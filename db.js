// ============================================================
// Minimal IndexedDB wrapper. Stores:
//   pendingDeployments  - deploy records not yet confirmed synced
//   pendingCheckins     - checkin records not yet confirmed synced
//   pendingMudpuppies   - mudpuppy records (new + edited) not yet confirmed synced
//   serverCache         - last known server snapshot(s) (for offline viewing),
//                          keyed "today" (deployments+checkins) and
//                          "mudpuppies" (full history, not date-limited since
//                          metadata is often filled in later)
// ============================================================
const DB_NAME = "fishtrap_db";
const DB_VERSION = 2;
let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("pendingDeployments"))
        db.createObjectStore("pendingDeployments", { keyPath: "ref_id" });
      if (!db.objectStoreNames.contains("pendingCheckins"))
        db.createObjectStore("pendingCheckins", { keyPath: "ref_id" });
      if (!db.objectStoreNames.contains("pendingMudpuppies"))
        db.createObjectStore("pendingMudpuppies", { keyPath: "id" });
      if (!db.objectStoreNames.contains("serverCache"))
        db.createObjectStore("serverCache", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

async function idbPut(store, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetKey(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  addPendingDeployment: (rec) => idbPut("pendingDeployments", rec),
  addPendingCheckin:    (rec) => idbPut("pendingCheckins", rec),
  addPendingMudpuppy:   (rec) => idbPut("pendingMudpuppies", rec),
  removePendingDeployment: (id) => idbDelete("pendingDeployments", id),
  removePendingCheckin:    (id) => idbDelete("pendingCheckins", id),
  removePendingMudpuppy:   (id) => idbDelete("pendingMudpuppies", id),
  getPendingDeployments: () => idbGetAll("pendingDeployments"),
  getPendingCheckins:    () => idbGetAll("pendingCheckins"),
  getPendingMudpuppies:  () => idbGetAll("pendingMudpuppies"),
  cacheServer: (data) => idbPut("serverCache", { key: "today", data, savedAt: Date.now() }),
  cacheMudpuppies: (list) => idbPut("serverCache", { key: "mudpuppies", data: list, savedAt: Date.now() }),
  getServerCache: async () => {
    const rec = await idbGetKey("serverCache", "today");
    return rec ? rec.data : null;
  },
  getMudpuppyCache: async () => {
    const rec = await idbGetKey("serverCache", "mudpuppies");
    return rec ? rec.data : null;
  }
};
