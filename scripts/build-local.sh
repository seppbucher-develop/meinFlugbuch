#!/usr/bin/env bash
# Baut build/*.js lokal neu (installiert esbuild bei Bedarf in ein temporäres
# Verzeichnis außerhalb des Repos). Nach jeder Änderung an einer .jsx-Datei
# ausführen, siehe CLAUDE.md.
set -euo pipefail
cd "$(dirname "$0")/.."
TOOLS="${TMPDIR:-/tmp}/flugbuch-build-tools"
if [ ! -d "$TOOLS/node_modules/esbuild" ]; then
  mkdir -p "$TOOLS"
  (cd "$TOOLS" && npm init -y >/dev/null && npm install --no-audit --no-fund esbuild@0.25.0 >/dev/null)
fi
NODE_PATH="$TOOLS/node_modules" node scripts/build.js
