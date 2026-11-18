#!/usr/bin/env bash
# Claude-Code-Hook (PostToolUse auf Edit/Write): baut build/*.js neu, sobald
# eine .jsx-Datei oder scripts/build.js geändert wurde. Liest das Hook-JSON
# von stdin. Bei Build-Fehlern Exit 2 -> Claude sieht die Fehlermeldung.
set -uo pipefail
cd "$(dirname "$0")/.."
FILE=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log((j.tool_input&&j.tool_input.file_path)||"")}catch(e){console.log("")}})')
case "$FILE" in
  *.jsx|*/scripts/build.js)
    if ! OUT=$(./scripts/build-local.sh 2>&1); then
      echo "build/ konnte nicht neu gebaut werden (Fehler in $FILE?):" >&2
      echo "$OUT" >&2
      exit 2
    fi
    ;;
esac
exit 0
