#!/usr/bin/env node
// Kompiliert die .jsx-Dateien einmalig zu normalem JavaScript (build/*.js),
// damit der Browser nicht bei jedem Start 870 KB JSX per Babel übersetzen
// muss. Läuft im GitHub-Workflow bei jedem Push auf master (siehe
// .github/workflows/bump-version.yml); lokal:
//
//   npm install --no-save esbuild@0.25.0
//   node scripts/build.js
//
// Die HTML-Seiten laden build/<name>.js (loader.js); fehlt die Datei, fallen
// sie auf <name>.jsx + Babel im Browser zurück. Das Ergebnis ist bewusst
// NICHT minifiziert (lesbare Fehlermeldungen, gzip erledigt den Rest).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");
// Seite -> Name der Haupt-Komponente (muss mit data-app in der HTML-Datei übereinstimmen)
const APPS = {
  flugbuch: "FlugbuchApp",
  statistik: "StatistikApp",
  material: "MaterialApp",
  schirme: "SchirmeApp",
  sitze: "SitzeApp",
  geraete: "GeraeteApp",
  div: "DivApp",
  service: "ServiceApp",
};

fs.mkdirSync(path.join(root, "build"), { recursive: true });
let failed = false;
for (const [name, app] of Object.entries(APPS)) {
  const srcPath = path.join(root, name + ".jsx");
  const src = fs.readFileSync(srcPath, "utf8");
  try {
    const out = esbuild.transformSync(src, { loader: "jsx", target: "es2020", charset: "utf8" }).code;
    const hash = crypto.createHash("sha256").update(src).digest("hex").slice(0, 12);
    // Gleiche Laufzeitumgebung wie früher (new Function mit React/ReactDOM als
    // Parameter): eigener Funktions-Scope, kein "use strict".
    const wrapped =
      `/* Automatisch erzeugt aus ${name}.jsx (sha256 ${hash}) — nicht von Hand ändern, siehe scripts/build.js */\n` +
      `(function (React, ReactDOM) {\n${out}\n;window.__FLUGBUCH_APP__ = ${app};\n})(window.React, window.ReactDOM);\n`;
    fs.writeFileSync(path.join(root, "build", name + ".js"), wrapped);
    console.log(`build/${name}.js  ${(wrapped.length / 1024).toFixed(0)} KB`);
  } catch (e) {
    failed = true;
    console.error(`FEHLER in ${name}.jsx:\n${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
