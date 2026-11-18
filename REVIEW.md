# Code-Review (Stand v1.0.148)

Geprüft: Speicherschicht, Service Worker, Workflows, Backup/Restore, Export,
Syntax aller `.jsx`/`.js`-Dateien. **Alle Punkte sind umgesetzt.**

| # | Bereich | Problem | Umsetzung |
|---|---|---|---|
| 1 | alle `*.html` | **Datenverlust-Risiko:** veraltete localStorage-Kopie (Rest eines früheren IndexedDB-Fehlers) überschrieb später den aktuellen Wert | `set()` löscht die localStorage-Kopie nach erfolgreichem IndexedDB-Schreiben |
| 2 | `sw.js` | `caches.match(a) \|\| caches.match("index.html")` – Fallback wirkungslos | `.then(base => base \|\| …)` |
| 3 | `sw.js` | 404/500-Antworten überschrieben gute Cache-Kopien | nur `ok` (CDN: `ok`/opaque) cachen |
| 4 | `flugbuch.jsx` | GPX-Name nicht XML-escaped | escaped |
| 5 | Storage-Block 8× dupliziert | Korrekturen mussten mehrfach gemacht werden | gemeinsame **`storage.js`** (inkl. `fsapiHandle`), Inline-Blöcke entfernt; ebenso gemeinsamer **`loader.js`** |
| 6 | Startzeit / `unsafe-eval` | 870 KB JSX wurden bei jedem Start per Babel kompiliert (`new Function`) | **Build-Schritt** (`scripts/build.js`, esbuild) im Workflow → `build/*.js` als normales `<script>`; Babel nur noch Rückfall |
| 7 | CDN | `react@18`, `react-dom@18`, `@babel/standalone@7` floatend, aber ewig gecacht | exakt gepinnt (18.3.1 / 7.26.10); React/ReactDOM mit **SRI**, Rückfall ohne SRI in `loader.js`; SW lädt per CORS vor |
| 8 | Restore | keine Validierung, nicht atomar, `set()`-Fehler (`null`) unbemerkt | vollständige Prüfung vorab, Rollback bei Fehler, `null` wird als Fehler gewertet |
| 9 | CSV-Export | Formel-Injection (`= + - @`) | `'` voranstellen (Zahlen unverändert) |
| 10 | Versionsanzeige | hinkte bei stale-while-revalidate einen Aufruf nach | `version.json` im SW immer network-first |
| 11 | MapTiler-Schlüssel | im Browser sichtbar | Hinweis in Service-Seite, Hilfe und Doku: im MapTiler-Konto auf Domain beschränken (Konto-Einstellung, nicht per Code lösbar) |
| 12 | `deployment-notify.yml` | pro Deployment ein neues offenes Issue | Issue wird nach dem Anlegen sofort geschlossen (Benachrichtigung ist schon raus) |

## Hinweise / Grenzen

* SRI-Hashes (React, ReactDOM) wurden aus den npm-Paketen berechnet, da das
  CDN aus der Entwicklungsumgebung nicht erreichbar war. Sollte ein Hash nicht
  zur CDN-Auslieferung passen, lädt `loader.js` dieselbe feste Version ohne SRI
  nach — die App bleibt lauffähig. Für JSZip, tz-lookup, mp4-muxer und das
  MapTiler-SDK wurde aus demselben Grund **kein** SRI gesetzt (nur feste Version).
* `build/` ist im Repo eingecheckt. Zwischen Merge einer `.jsx`-Änderung ohne
  lokalen Build und dem Workflow-Commit läuft kurz der alte Stand (siehe DOKU.md).
* End-to-End getestet (Headless-Chromium, lokal): alle Seiten starten über
  `build/*.js` und über den Babel-Rückfall; Storage-Roundtrip ok.
