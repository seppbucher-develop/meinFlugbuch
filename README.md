# Flugbuch

Paragliding-Flugbuch als statische Web-App (kein Build-Schritt, kein Bundler
— React/Babel werden im Browser per CDN geladen, die `.jsx`-Dateien direkt
vom Server geholt und live kompiliert). Gehostet auf GitHub Pages.

## Versionierung

Die Version der App wird aus Git-Tags abgeleitet und in `version.json`
festgehalten (es gibt keinen Build-Server, der das automatisch könnte).
Sie erscheint auf dem Hauptscreen (`index.html`) und im Dateinamen jedes
Backups (`service.html` → Backup sichern).

Neue Version veröffentlichen:

```sh
git tag v1.2.3
./scripts/update-version.sh
git add version.json
git commit -m "Version v1.2.3"
git push && git push --tags
```
