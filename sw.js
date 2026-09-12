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
const CACHE_VERSION = "v4";
const CACHE_NAME = "flugbuch-cache-" + CACHE_VERSION;

// React/Babel/MapTiler etc. werden bisher direkt von externen CDNs geladen
// und NIE offline verfügbar gemacht (der fetch-Handler reicht Cross-Origin-
// Requests unangetastet durch, siehe unten) — deshalb blieb die App offline
// bei einem weißen Screen hängen: die Seiten selbst wurden zwar aus dem
// Cache bedient, aber ohne React/Babel konnte nichts gerendert werden.
// Diese fest versionierten CDN-Dateien ändern sich unter ihrer URL nie
// (react@18, babel@7, maptiler-sdk-js/v3.0.0, ...), deshalb werden sie hier
// wie CORE_ASSETS vorab gecacht und offline aus dem Cache bedient.
const CDN_ASSETS = [
  "https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js",
  "https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js",
  "https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js",
  "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
  "https://cdn.jsdelivr.net/npm/tz-lookup@6.1.25/tz.js",
  "https://cdn.maptiler.com/maptiler-sdk-js/v3.0.0/maptiler-sdk.umd.min.js",
  "https://cdn.maptiler.com/maptiler-sdk-js/v3.0.0/maptiler-sdk.css",
];

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
  "sitze.html",
  "sitze.jsx",
  "geraete.html",
  "geraete.jsx",
  "div.html",
  "div.jsx",
  "service.html",
  "service.jsx",
  "hilfe.html",
  "manifest.json",
  "version.json",
  "favicon.ico",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-96.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
  "icons/icon-header-128.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll bricht bei einer einzelnen 404 sofort ganz ab — deshalb
      // Datei für Datei mit eigenem catch, damit z.B. ein fehlendes
      // Icon nicht die komplette Offline-Funktion verhindert.
      Promise.all([
        ...CORE_ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn("SW: Konnte nicht cachen:", url, err))
        ),
        // CDN-Skripte per no-cors laden (die CDNs senden zwar CORS-Header,
        // aber no-cors ist robuster und liefert ein "opaque" Response, das
        // sich als <script src>/<link> genauso verwenden lässt).
        ...CDN_ASSETS.map((url) =>
          fetch(url, { mode: "no-cors" })
            .then((resp) => cache.put(url, resp))
            .catch((err) => console.warn("SW: Konnte CDN-Datei nicht cachen:", url, err))
        ),
      ])
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

  // Nur eigene GET-Requests behandeln — POST/PUT etc. unangetastet
  // durchreichen, damit deren eigenes Verhalten nicht gestört wird.
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Bekannte CDN-Skripte (React, Babel, MapTiler, ...): fest versioniert und
  // damit unter ihrer URL unveränderlich — cache-first, damit sie offline
  // sofort aus dem Cache kommen statt auf einen (dann scheiternden)
  // Netzwerk-Request zu warten. Alle anderen Cross-Origin-Requests werden
  // unangetastet durchgereicht, damit deren eigenes Caching/Verhalten nicht
  // gestört wird.
  if (url.origin !== self.location.origin) {
    if (!CDN_ASSETS.includes(req.url)) return;
    event.respondWith(
      caches.match(req.url).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((networkResponse) => {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req.url, clone));
          return networkResponse;
        });
      })
    );
    return;
  }

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
