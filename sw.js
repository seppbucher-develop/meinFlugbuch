// Service Worker fürs Flugbuch — ermöglicht Offline-Nutzung ab dem zweiten
// Online-Start. Cache-Strategie für die eigenen Dateien ist per
// SAME_ORIGIN_STRATEGY weiter unten umschaltbar (Details dort) — Standard
// ist "stale-while-revalidate": sofort aus dem Cache antworten, Netzwerk-
// Update läuft im Hintergrund für den nächsten Aufruf.
//
// WICHTIG bei Änderungen an dieser Liste (z.B. neue Seite hinzugefügt):
// CACHE_VERSION hochzählen, sonst wird die Änderung nicht ausgerollt, da
// alte Service-Worker-Installationen sonst ihren alten Cache "STATIC_CACHE"
// unverändert weiterverwenden.
const CACHE_VERSION = "v4";
const CACHE_NAME = "flugbuch-cache-" + CACHE_VERSION;

// Strategie für die eigenen Dateien (index.html, flugbuch.html, .jsx, ...):
//
// "network-first" (ursprünglich): Bei bestehender Verbindung wird IMMER
//   zuerst das Netzwerk versucht, erst wenn DAS scheitert, kommt der Cache
//   zum Zug. Garantiert nach jedem `git push` sofort die neueste Version,
//   hat aber einen Haken: bei schwachem/instabilem Empfang (z.B. Handy mit
//   wenig Netz am Lande-/Startplatz — technisch "online", aber Requests
//   hängen) wartet man erst den vollen Netzwerk-Timeout ab, bevor der
//   eigentlich sofort verfügbare Cache greift. Fühlt sich dann an wie
//   "offline ist langsam".
//
// "stale-while-revalidate": Antwortet SOFORT aus dem Cache (falls
//   vorhanden) und stößt parallel im Hintergrund einen Netzwerk-Request an,
//   der den Cache fürs NÄCHSTE Mal aktualisiert — kein Warten auf einen
//   Netzwerk-Timeout mehr, egal ob offline oder nur langsam. Preis dafür:
//   nach einem `git push` sieht man die neue Version idR erst beim
//   übernächsten statt beim nächsten Laden.
//
// Zum Zurückstellen auf die alte Strategie einfach wieder auf
// "network-first" ändern — beide Code-Pfade bleiben unten vollständig
// erhalten, es wird nur zwischen ihnen umgeschaltet.
const SAME_ORIGIN_STRATEGY = "stale-while-revalidate";

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

  // "Basisname" ohne Query-String als Cache-Key — auch für Cache-Buster-
  // URLs wie "flugbuch.jsx?v=169..." bleibt die Basis-Datei im Cache unter
  // ihrem eigentlichen Pfad erreichbar (in beiden Strategien unten gleich
  // verwendet).
  const cacheKey = url.pathname.split("/").pop() || "./";

  if (SAME_ORIGIN_STRATEGY === "stale-while-revalidate") {
    event.respondWith(
      caches.match(cacheKey).then((cached) => {
        const networkUpdate = fetch(req)
          .then((networkResponse) => {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, clone));
            return networkResponse;
          })
          .catch(() => null);

        if (cached) {
          // Auf das Netzwerk-Ergebnis NICHT warten — der Cache-Eintrag wird
          // im Hintergrund fürs nächste Mal aktualisiert. event.waitUntil
          // hält den Service Worker am Leben, bis das fertig ist, auch wenn
          // die Antwort selbst längst zurückgegeben wurde.
          event.waitUntil(networkUpdate);
          return cached;
        }
        // Nichts im Cache (z.B. beim allerersten Aufruf überhaupt) — hier
        // bleibt nur, auf das Netzwerk zu warten; schlägt auch das fehl,
        // wie in der network-first-Strategie auf index.html zurückfallen.
        return networkUpdate.then((networkResponse) => networkResponse || caches.match("index.html"));
      })
    );
    return;
  }

  // network-first (ursprüngliche Strategie, siehe SAME_ORIGIN_STRATEGY oben)
  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, clone));
        return networkResponse;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          // Fallback für Cache-Buster-URLs (z.B. "flugbuch.jsx?v=...") auf
          // die zuletzt gecachte Basisversion ohne Query-String.
          return caches.match(cacheKey) || caches.match("index.html");
        })
      )
  );
});
