// Service Worker fürs Flugbuch — ermöglicht Offline-Nutzung ab dem zweiten
// Online-Start. Strategie: "network-first" — bei bestehender Internet-
// verbindung wird IMMER die aktuelle Version vom Server geholt (wichtig,
// weil .jsx-Dateien sich per `git push` ändern und wir keine veralteten
// Programm-Versionen offline "einfrieren" wollen). Nur wenn das Netzwerk
// nicht erreichbar ist, wird auf die zuletzt erfolgreich geladene Version
// aus dem Cache zurückgegriffen.
//
// WICHTIG bei Änderungen an dieser Liste (z.B. neue Seite hinzugefügt):
// CACHE_VERSION hochzählen, sonst wird die Änderung nicht ausgerollt, da
// alte Service-Worker-Installationen sonst ihren alten Cache "STATIC_CACHE"
// unverändert weiterverwenden.
const CACHE_VERSION = "v1";
const CACHE_NAME = "flugbuch-cache-" + CACHE_VERSION;

const CORE_ASSETS = [
  "./",
  "index.html",
  "flugbuch.html",
  "flugbuch.jsx",
  "statistik.html",
  "statistik.jsx",
  "material.html",
  "material.jsx",
  "schirme.html",
  "schirme.jsx",
  "service.html",
  "service.jsx",
  "manifest.json",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-96.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll bricht bei einer einzelnen 404 sofort ganz ab — deshalb
      // Datei für Datei mit eigenem catch, damit z.B. ein fehlendes
      // Icon nicht die komplette Offline-Funktion verhindert.
      Promise.all(
        CORE_ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn("SW: Konnte nicht cachen:", url, err))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith("flugbuch-cache-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Nur eigene GET-Requests behandeln — externe CDN-Ressourcen (React,
  // MapTiler, Fonts, ...) und POST/PUT etc. unangetastet durchreichen,
  // damit deren eigenes Caching/Verhalten nicht gestört wird.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        // Erfolgreiche Antwort im Cache aktualisieren (auch für
        // Cache-Buster-URLs wie "flugbuch.jsx?v=169..." — die Basis-Datei
        // im Cache bleibt unter ihrem eigentlichen Pfad erreichbar).
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          const cacheKey = url.pathname.split("/").pop() || "./";
          cache.put(cacheKey, clone);
        });
        return networkResponse;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          // Fallback für Cache-Buster-URLs (z.B. "flugbuch.jsx?v=...") auf
          // die zuletzt gecachte Basisversion ohne Query-String.
          const baseName = url.pathname.split("/").pop();
          return caches.match(baseName) || caches.match("index.html");
        })
      )
  );
});
