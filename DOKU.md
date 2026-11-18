# Flugbuch – Dokumentation

Persönliches Paragliding-Flugbuch als statische Web-App (PWA). Kein Server,
kein Build-Schritt: React und Babel kommen per CDN, die `.jsx`-Dateien werden
im Browser geladen und live kompiliert. Alle Daten liegen **lokal im Browser**
(IndexedDB). Gehostet auf GitHub Pages. Siehe auch `README.md`
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
`flugbuch:`) über die in jedem HTML eingebettete Schicht `window.storage`
(`get/set/delete/list`; localStorage nur als Fallback, wenn IndexedDB
fehlschlägt). Wichtige Schlüssel:

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
(`flights`, `customFieldDefs`, …) wird weiterhin gelesen. Der rote Punkt auf
der Service-Karte (`settings:backupDirty`) zeigt ungesicherte Änderungen.

## Offline / Service Worker

* Eigene Dateien: Standard *stale-while-revalidate* (sofort aus Cache,
  Aktualisierung im Hintergrund); unter Service umschaltbar auf *network-first*.
* CDN-Skripte (React, Babel, MapTiler, JSZip, tz-lookup): cache-first.
* Nur erfolgreiche (`ok`) Antworten werden gecacht.
* Bei **jeder** Änderung an der Dateiliste `CACHE_VERSION` in `sw.js` erhöhen.
* Nur die Karte (MapTiler) und die Ländererkennung brauchen Internet.

## Versionierung und Deployment

Siehe `README.md`: Patch-Version automatisch durch
`.github/workflows/bump-version.yml` nach jedem Push auf `master`;
Minor/Major manuell per Tag und `scripts/update-version.sh`.
`deployment-notify.yml` legt nach erfolgreichem Pages-Deployment ein Issue an.

## Entwickeln

* Kein Build: Dateien ändern, im Browser neu laden. Syntax-Check der JSX-Dateien
  z.B. mit `@babel/core` + `@babel/preset-react`.
* `flugbuch.jsx` ist mit ~870 KB sehr gross (Babel meldet „deoptimised");
  Ladezeit beim Start wird davon dominiert (siehe REVIEW.md).
* Der Speicher-Block `window.storage` steht identisch in jedem HTML — Änderungen
  müssen in allen Dateien nachgezogen werden (siehe REVIEW.md).
