# Code-Review (Stand v1.0.148)

Geprüft: Speicherschicht, Service Worker, Workflows, Backup/Restore, Export,
Syntax aller `.jsx`/`.js`-Dateien (Babel: alle fehlerfrei).

## Behoben in diesem Commit

| # | Datei | Problem | Fix |
|---|---|---|---|
| 1 | alle `*.html` (`window.storage.set`) | **Datenverlust-Risiko:** Schlug ein IndexedDB-Schreibvorgang einmal fehl, blieb der Wert im localStorage. Später erfolgreiche Speicherungen gingen nur nach IndexedDB; `get()` hielt die alte localStorage-Kopie für „neuer" und überschrieb damit den aktuellen Wert. | `set()` löscht nach erfolgreichem IndexedDB-Schreiben die localStorage-Kopie |
| 2 | `sw.js` network-first | `caches.match(a) \|\| caches.match("index.html")` – `\|\|` auf Promises greift nie, der Fallback auf `index.html` war wirkungslos (Antwort `undefined` → Fehler offline) | `.then(base => base \|\| caches.match("index.html"))` |
| 3 | `sw.js` beide Strategien | Auch 404/500-Antworten wurden gecacht und ersetzten die funktionierende Kopie → offline kaputt | nur `response.ok` cachen |
| 4 | `flugbuch.jsx` `buildGpxFromFlight` | Flugname nicht XML-escaped (`&`, `<`) → ungültiges GPX | escaped |

## Offen / Empfehlungen

1. **Duplizierter Storage-Block** in 8 HTML-Dateien (6 identisch, `flugbuch.html` und `statistik.html` leicht abweichend). Jede Korrektur muss mehrfach gemacht werden (wie Fund #1). → in eine gemeinsame `storage.js` auslagern.
2. **Startzeit:** `flugbuch.jsx` (~870 KB) wird bei jedem Start per Babel im Browser kompiliert. Ein einmaliger Build (z.B. esbuild in der GitHub-Action) würde den Start deutlich beschleunigen; Modulaufteilung der Datei wäre ebenfalls wünschenswert.
3. **CDN nicht fest versioniert:** `react@18`, `react-dom@18`, `@babel/standalone@7` sind floatende Versionen, werden aber vom Service Worker cache-first „für immer" gehalten (Kommentar sagt „fest versioniert"). → exakte Versionen pinnen (inkl. SRI-Hash).
4. **Restore ohne Validierung/Atomarität:** `importBackup` schreibt beliebige Schlüssel einzeln; bricht es mittendrin ab, ist der Stand halb ersetzt. → vorher Schlüssel-Präfixe und Werttypen prüfen, ggf. Sicherheitskopie des aktuellen Stands anlegen.
5. **CSV-Export:** Zellen, die mit `=`, `+`, `-`, `@` beginnen, werden von Excel als Formel ausgeführt (CSV-Injection). → mit `'` voranstellen.
6. **Versionsanzeige hinkt einen Aufruf nach**, solange Stale-While-Revalidate aktiv ist (`version.json` kommt zuerst aus dem Cache). Unkritisch; `version.json` könnte aus dem SW-Cache ausgenommen werden.
7. **MapTiler-Schlüssel** liegt im Browser und wird in Anfrage-URLs (`?key=`) mitgesendet — bei MapTiler üblich, Schlüssel dort auf die Domain beschränken.
8. **deployment-notify.yml** erzeugt pro Deployment ein neues Issue (wächst unbegrenzt) → Issue nach Benachrichtigung schliessen oder Kommentar statt Issue.
9. `new Function(...)` zum Starten des kompilierten Codes erzwingt `unsafe-eval`; mit einem Build-Schritt (Punkt 2) entfiele das.
