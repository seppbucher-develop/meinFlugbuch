# Flugbuch

Paragliding-Flugbuch als statische Web-App (kein Build-Schritt, kein Bundler
— React/Babel werden im Browser per CDN geladen, die `.jsx`-Dateien direkt
vom Server geholt und live kompiliert). Gehostet auf GitHub Pages.

## Versionierung

Die Version der App wird aus Git-Tags abgeleitet und in `version.json`
festgehalten (es gibt keinen Build-Server, der das für die App selbst
automatisch könnte). Sie erscheint auf dem Hauptscreen (`index.html`) und
im Dateinamen jedes Backups (`service.html` → Backup sichern).

**Patch-Version (v1.0.0 → v1.0.1 → v1.0.2 → …): automatisch.** Der
GitHub-Actions-Workflow `.github/workflows/bump-version.yml` läuft nach
jedem Push auf `master` (z.B. jedem PR-Merge), zählt die Patch-Stelle des
letzten Tags eins hoch, committet die neue `version.json` und setzt den
passenden Tag — ganz ohne manuellen Schritt.

**Minor/Major-Version (z.B. v1.1.0 oder v2.0.0): manuell**, wenn ein
größerer Sprung gewünscht ist. Der nächste automatische Patch-Bump zählt
danach ab diesem neuen Tag weiter:

```sh
git tag v1.1.0
./scripts/update-version.sh
git add version.json
git commit -m "Version v1.1.0"
git push && git push --tags
```

Der Workflow braucht Schreibrechte für den `GITHUB_TOKEN` (Repo-Einstellung
**Settings → Actions → General → Workflow permissions → "Read and write
permissions"**) sowie einen `master`, der direkte Pushes von GitHub Actions
zulässt (keine Branch-Protection-Regel, die das verhindert).
