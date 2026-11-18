# Hinweise für Claude (und andere Mitarbeitende)

## Pflicht: build/ nachziehen

Die Seiten laden `build/<seite>.js` (vorkompiliert aus `<seite>.jsx`, siehe
DOKU.md → „Build und Ladeablauf"). Der Workflow baut erst NACH dem Merge auf
`master` neu — bis dahin würde der alte Stand ausgeliefert.

**Nach JEDER Änderung an einer `*.jsx`-Datei** (und an `scripts/build.js`):

```sh
./scripts/build-local.sh
```

und die geänderten `build/*.js` **mit committen**. Schlägt der Build fehl
(Syntaxfehler in der JSX), ist die Änderung fehlerhaft — erst beheben.
Vor jedem Commit/PR kurz prüfen: `git status` zeigt `build/` als geändert,
wenn eine `.jsx` geändert wurde.

## Weitere Regeln

* Neue/geänderte Dateien der App → `CORE_ASSETS` in `sw.js` ergänzen und
  `CACHE_VERSION` erhöhen.
* Neue Seite: `storage.js`, `loader.js`, `chrome.js` einbinden, in `APPS`
  (`scripts/build.js`) eintragen, Abschnitt in `hilfe.html` ergänzen.
* Änderungen an Funktionen/Bedienung → `hilfe.html` und `DOKU.md` mitpflegen.
