// Gemeinsame Speicherschicht aller Seiten (früher in jedem HTML einzeln
// eingebettet). Dieselbe IndexedDB ("flugbuch-db", Store "kv", Präfix
// "flugbuch:") desselben Origins — dadurch sehen Flugbuch, Statistik,
// Material, Stammdaten-Seiten und Service exakt dieselben Daten.
//
// Exportiert:
//   window.storage      get/set/delete/list (IndexedDB, localStorage nur als
//                       Fallback falls IndexedDB scheitert)
//   window.fsapiHandle  get/set/delete für Ordner-Handles (File System Access
//                       API: Backup-Ordner, Vario-Ordner) in "flugbuch-fsapi"
//
// ACHTUNG: Änderungen hier betreffen alle Seiten sofort. Bei einer Änderung
// CACHE_VERSION in sw.js erhöhen.

  // Storage backed by IndexedDB (much higher quota than localStorage — often
  // 50MB+ vs. ~5-10MB shared across the whole origin). Falls back to
  // localStorage automatically if IndexedDB is unavailable for any reason.
  // Note: no web storage API can fully protect against the OS clearing app
  // data (e.g. if storage is low or the app/shortcut is removed and
  // re-added) — use the Service-Seite's Backup-Funktion as the real
  // safety net against that.
  (function () {
    const DB_NAME = "flugbuch-db";
    const STORE = "kv";
    let dbPromise = null;

    function openDb() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error("IndexedDB not available")); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbPromise;
    }

    async function idbGet(key) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
        req.onerror = () => reject(req.error);
      });
    }
    async function idbSet(key, value) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    async function idbDelete(key) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    async function idbKeys() {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAllKeys();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    const PREFIX = "flugbuch:";
    function keyFor(key) { return PREFIX + key; }

    // One-time migration: if there's data in localStorage from before this
    // upgrade, copy it into IndexedDB so nothing already saved is lost.
    let migrated = false;
    async function migrateFromLocalStorageOnce() {
      if (migrated) return;
      migrated = true;
      try {
        const existingKeys = new Set(await idbKeys());
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(PREFIX) && !existingKeys.has(k)) {
            await idbSet(k, localStorage.getItem(k));
          }
        }
      } catch (e) { console.error("Migration to IndexedDB failed:", e); }
    }

    window.storage = {
      async get(key) {
        try {
          await migrateFromLocalStorageOnce();
          const raw = await idbGet(keyFor(key));
          // localStorage only ever gets a value here as set()'s fallback
          // after a failed IndexedDB write (the one-time migration above
          // only fills gaps, never overwrites an existing IndexedDB entry)
          // — so if it holds something *different* from what's in
          // IndexedDB, that's a more recent save that never made it into
          // IndexedDB. Previously this was only ever checked when
          // IndexedDB had NO entry at all (raw === null); whenever
          // IndexedDB already held some (now stale) value for the key,
          // the newer localStorage one was silently ignored — an edit
          // could show correctly right after saving (the in-memory app
          // state was updated regardless) yet silently revert to the old
          // value on the next load, since every future get() kept
          // returning the stale IndexedDB copy. See customFields.typ
          // desync, chat 2026-08-29. Any divergence here is now healed by
          // writing the localStorage value back into IndexedDB.
          let lsRaw = null;
          try { lsRaw = localStorage.getItem(keyFor(key)); } catch {}
          if (lsRaw !== null && lsRaw !== raw) {
            try { await idbSet(keyFor(key), lsRaw); } catch {}
            return { key, value: lsRaw };
          }
          if (raw !== null) return { key, value: raw };
          return null;
        } catch (e) {
          console.error("storage.get error, falling back to localStorage:", e);
          try {
            const raw = localStorage.getItem(keyFor(key));
            return raw !== null ? { key, value: raw } : null;
          } catch { return null; }
        }
      },
      async set(key, value) {
        try {
          await migrateFromLocalStorageOnce();
          await idbSet(keyFor(key), value);
          // Veraltete localStorage-Kopie (Rest eines früheren Fallbacks)
          // entfernen — get() würde sie sonst als "neueren" Stand werten
          // und damit den soeben gespeicherten Wert wieder überschreiben.
          try { localStorage.removeItem(keyFor(key)); } catch {}
          return { key, value };
        } catch (e) {
          console.error("storage.set error, falling back to localStorage:", e);
          try { localStorage.setItem(keyFor(key), value); return { key, value }; }
          catch (e2) { console.error("localStorage fallback also failed:", e2); return null; }
        }
      },
      async delete(key) {
        try {
          await migrateFromLocalStorageOnce();
          const existedIdb = (await idbGet(keyFor(key))) !== null;
          await idbDelete(keyFor(key));
          try { localStorage.removeItem(keyFor(key)); } catch {}
          return { key, deleted: existedIdb };
        } catch (e) {
          console.error("storage.delete error, falling back to localStorage:", e);
          try {
            const k = keyFor(key);
            const existed = localStorage.getItem(k) !== null;
            localStorage.removeItem(k);
            return { key, deleted: existed };
          } catch { return null; }
        }
      },
      async list(prefix) {
        try {
          await migrateFromLocalStorageOnce();
          const fullPrefix = PREFIX + (prefix || "");
          const allKeys = await idbKeys();
          const keys = allKeys.filter(k => typeof k === "string" && k.startsWith(fullPrefix)).map(k => k.slice(PREFIX.length));
          return { keys, prefix };
        } catch (e) {
          console.error("storage.list error, falling back to localStorage:", e);
          try {
            const fullPrefix = PREFIX + (prefix || "");
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && k.startsWith(fullPrefix)) keys.push(k.slice(PREFIX.length));
            }
            return { keys, prefix };
          } catch { return null; }
        }
      },
    };
  })();

  // Separate, eigenständige kleine Datenbank NUR für lokal gewählte Ordner
  // (File System Access API, Chrome/Edge Desktop) — z.B. den Vario-Ordner
  // für den Direkt-Import. Bewusst NICHT in "flugbuch-db"/"kv" mit abgelegt:
  // ein FileSystemDirectoryHandle ist kein per JSON.stringify
  // serialisierbarer String (den window.storage durchgängig erwartet),
  // sondern ein eigenes strukturiert-klonbares Objekt — eine zweite
  // Datenbank vermeidet jedes Risiko, das gemeinsame Schema zu verändern.
  // Dieselbe Datenbank/derselbe Store wie in service.html (dort für den
  // Backup-Ordner) — nur der Schlüssel unterscheidet sich ("varioDir" hier
  // vs. "backupDir" dort), beide Seiten können sie parallel nutzen.
  (function () {
    const DB_NAME = "flugbuch-fsapi";
    let dbPromise = null;
    function openDb() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error("IndexedDB not available")); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore("handles"); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbPromise;
    }
    window.fsapiHandle = {
      async get(key) {
        try {
          const db = await openDb();
          return await new Promise((resolve, reject) => {
            const tx = db.transaction("handles", "readonly");
            const req = tx.objectStore("handles").get(key);
            req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
            req.onerror = () => reject(req.error);
          });
        } catch { return null; }
      },
      async set(key, handle) {
        try {
          const db = await openDb();
          await new Promise((resolve, reject) => {
            const tx = db.transaction("handles", "readwrite");
            tx.objectStore("handles").put(handle, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
          return true;
        } catch { return false; }
      },
      async delete(key) {
        try {
          const db = await openDb();
          await new Promise((resolve, reject) => {
            const tx = db.transaction("handles", "readwrite");
            tx.objectStore("handles").delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
          return true;
        } catch { return false; }
      },
    };
  })();
