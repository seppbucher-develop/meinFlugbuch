# Flugbuch – Dokumentation

Persönliches Paragliding-Flugbuch als statische Web-App (PWA). Kein Server.
React kommt per CDN (fest versioniert, mit SRI), die `.jsx`-Dateien werden bei
jedem Push auf `master` einmalig zu `build/*.js` vorkompiliert (siehe unten).
Alle Daten liegen **lokal im Browser** (IndexedDB). Gehostet auf GitHub Pages. Siehe auch `README.md`
(Versionierung, Deployment) und die In-App-Hilfe (`hilfe.html`, Knopf **?**).

## Seiten

| Datei | Zweck |
|---|---|
| `index.html` | Startseite mit den Karten Flugbuch, Statistik, Material, Service |
| `flugbuch.html` + `flugbuch.jsx` | Flugliste, Detail, IGC-Import, Karte, Höhenprofil, Suche/Filter, Ansichten |
| `statistik.html` + `statistik.jsx` | Jahres-Übersicht (Pivot) mit Mehrfach-Filtern, nur lesend |
| `material.html` + `material.jsx` | Ausrüstungs-Einträge (Anschaffung, Service, Kosten, Datei/URL) |
| `schirme` / `sitze` / `geraete` / `div` (`.html` + `.jsx`) | Führende Stammdaten-Listen je Material-Kategorie |
| `service.html` + `service.jsx` | Backup/Restore, CSV-/IGC-Export, Einstellungen, Notizen |
| `hilfe.html` | Benutzerhilfe (Abschnitte per Anker, z.B. `hilfe.html#service`) |
| `chrome.js` | Gemeinsamer Rahmen: Version unten links, **?**-Knopf unten rechts |
| `storage.js` | Gemeinsame Speicherschicht (`window.storage`, `window.fsapiHandle`) |
| `loader.js` | Gemeinsamer App-Loader (lädt `build/<seite>.js`, Rückfall auf JSX + Babel) |
| `build/*.js` | Vorkompilierte Seiten (automatisch erzeugt, nicht von Hand ändern) |
| `scripts/build.js` | Build-Skript (esbuild) |
| `sw.js` | Service Worker (Offline-Cache) |
| `version.json` | Aktuelle Version (wird vom Workflow gepflegt) |

## Hilfe-Knopf und Versionsanzeige (`chrome.js`)

Jede Seite bindet am Ende von `<body>` ein:

```html
<script src="chrome.js" data-page="flugbuch"></script>
```

* **Unten links:** Versionsnummer aus `version.json` (mit Cache-Buster geladen).
* **Unten rechts:** runder **?**-Knopf → `hilfe.html#<data-page>`, die Hilfe
  öffnet also beim passenden Abschnitt (`:target` wird hervorgehoben).
  Auf `hilfe.html` selbst (`data-page="hilfe"`) gibt es nur die Version.
* `z-index: 50`; Dialoge der App liegen bei 100+ und decken beide Elemente ab.

Neue Seite anlegen: `chrome.js`-Tag einfügen, passenden Abschnitt mit
`id="<data-page>"` in `hilfe.html` ergänzen, Datei in `CORE_ASSETS` von
`sw.js` aufnehmen **und `CACHE_VERSION` erhöhen**.

## Datenhaltung

Alle Seiten teilen sich dieselbe IndexedDB (`flugbuch-db`, Store `kv`, Präfix
`flugbuch:`) über die gemeinsame Schicht `storage.js` (`window.storage` mit
`get/set/delete/list`; localStorage nur als Fallback, wenn IndexedDB
fehlschlägt — nach jedem erfolgreichen IndexedDB-Schreiben wird die
localStorage-Kopie des Schlüssels entfernt). Wichtige Schlüssel:

| Schlüssel | Inhalt |
|---|---|
| `flight:<id>` | ein Flug (inkl. Track, `customFields`) |
| `entry:<id>` / `material:*` | Material-Einträge |
| `schirme:list`, `sitze:list`, `geraete:list`, `div:list` | Stammdaten-Listen (führend) |
| `customFieldDefs`, `flugbuchSavedViews`, `flugbuchListSettings` | Felddefinitionen, Ansichten, Listen-Einstellungen |
| `settings:*` | Einstellungen (Karten-Schlüssel, Umkreise, Google-IDs, `backupDirty`, `lastBackupAt`, …) |

Stammdaten-Verknüpfung: Flüge und Material-Einträge zeigen per ID
(`schirmId`, `sitzId`, `geraetId`, `divId`) auf die Listen, nie umgekehrt.
Zugeordnet wird über die Material-Spalte „Typ" = Name des Stammdatensatzes;
fehlt er, wird er automatisch angelegt.

Ein separater Speicher `flugbuch-fsapi` hält Ordner-Handles (File System
Access API) für Backup-Ordner und Vario-Ordner.

## Backup / Restore

`service.html` erzeugt `flugbuch-backup-<version>[-<gerät>]-<datum>.json[.gz]`
mit `{ entries: { schlüssel: wert } }`. Restore schreibt jeden Eintrag zurück
(gleiche ID → überschrieben, alles andere bleibt). Das ältere Format
(`flights`, `customFieldDefs`, …) wird weiterhin gelesen.

Sicherheitsnetz beim Restore: Die Datei wird zuerst **vollständig geprüft**
(Schlüssel nicht leer/≤300 Zeichen/ohne Steuerzeichen, Werte nur Text) —
bei einem Fehler wird nichts geschrieben. Vor dem Schreiben wird der bisherige
Stand der betroffenen Schlüssel gemerkt; schlägt ein Schreibvorgang fehl
(auch `storage.set` → `null`), wird alles **zurückgerollt**.

CSV-Export: Texte, die mit `= + - @` (oder Tab/CR) beginnen, bekommen ein
vorangestelltes `'` (Schutz vor CSV-/Formel-Injection); echte Zahlen bleiben. Der rote Punkt auf
der Service-Karte (`settings:backupDirty`) zeigt ungesicherte Änderungen.

## Offline / Service Worker

* `version.json` wird immer zuerst vom Netz geholt (Versionsanzeige aktuell),
  offline aus dem Cache.
* Eigene Dateien: Standard *stale-while-revalidate* (sofort aus Cache,
  Aktualisierung im Hintergrund); unter Service umschaltbar auf *network-first*.
* CDN-Skripte (React, MapTiler, JSZip, tz-lookup, mp4-muxer): cache-first,
  beim Installieren per CORS vorab geladen (React/ReactDOM tragen
  `integrity`+`crossorigin` und brauchen eine nicht-opake Antwort). Babel wird
  nur im Rückfall nachgeladen und nicht vorab gecacht.
* Nur erfolgreiche (`ok`) Antworten werden gecacht; Cache-Schlüssel ist der
  Pfad relativ zum SW-Scope (auch `build/…`).
* Bei **jeder** Änderung an der Dateiliste `CACHE_VERSION` in `sw.js` erhöhen.
* Nur die Karte (MapTiler) und die Ländererkennung brauchen Internet.

## Versionierung und Deployment

Siehe `README.md`: Patch-Version automatisch durch
`.github/workflows/bump-version.yml` nach jedem Push auf `master`;
Minor/Major manuell per Tag und `scripts/update-version.sh`.
`deployment-notify.yml` legt nach erfolgreichem Pages-Deployment ein Issue an.

## Build und Ladeablauf

`scripts/build.js` (esbuild) übersetzt jede `<seite>.jsx` zu
`build/<seite>.js` (nicht minifiziert, in einer Funktion mit `React`/`ReactDOM`
als Parameter, setzt `window.__FLUGBUCH_APP__`). Der Workflow
`bump-version.yml` baut bei jedem Push auf `master` und committet `build/`
zusammen mit `version.json`.

`loader.js` (je Seite mit `data-app`/`data-src`):
1. React/ReactDOM prüfen; fehlen sie (z.B. SRI-Konflikt), aus derselben
   fest versionierten URL **ohne** SRI nachladen.
2. `build/<seite>.js` laden → kein Babel, kein `eval`.
3. Schlägt das fehl (Datei fehlt): Rückfall wie früher — `<seite>.jsx` holen,
   Babel (7.26.10) nachladen, per `new Function` starten.

Lokal bauen:

```sh
npm install --no-save esbuild@0.25.0
node scripts/build.js
```

Nach jeder `.jsx`-Änderung `./scripts/build-local.sh` ausführen und `build/`
mitcommitten (sonst läuft bis zum Workflow nach dem Merge der alte Stand).
Abgesichert durch den Claude-Hook `scripts/hook-build.sh` (baut automatisch)
und die PR-Prüfung `.github/workflows/check-build.yml` (schlägt bei
veraltetem `build/` fehl).

## Entwickeln

* Syntax-Check der JSX-Dateien: `node scripts/build.js` (bricht bei Fehlern ab).
* CDN-Versionen sind fest (React 18.3.1, Babel 7.26.10, JSZip 3.10.1,
  tz-lookup 6.1.25, mp4-muxer 5.1.3, MapTiler SDK 3.0.0). Bei einem Update
  HTML-Tags, `loader.js` und `CDN_ASSETS` in `sw.js` gemeinsam anpassen und
  die SRI-Hashes der React-Tags neu berechnen
  (`openssl dgst -sha384 -binary datei | openssl base64 -A`).
* MapTiler-Schlüssel: im MapTiler-Konto auf die App-Domain beschränken.
* Neue Seite: HTML mit `storage.js`, `loader.js`, `chrome.js`; Eintrag in
  `APPS` (`scripts/build.js`) und `CORE_ASSETS` (`sw.js`); `CACHE_VERSION` erhöhen.
