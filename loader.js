// Gemeinsamer App-Loader aller Seiten (früher in jedem HTML einzeln).
//
// Einbindung (nach <div id="load-status"> und <div id="root">):
//   <script src="storage.js"></script>
//   <script src="loader.js" data-app="FlugbuchApp" data-src="flugbuch"></script>
//
// Ablauf:
//   1. Schneller Weg: vorkompilierte Datei build/<data-src>.js (erzeugt von
//      scripts/build.js, im GitHub-Workflow bei jedem Push auf master) wird als
//      normales <script> geladen — kein Babel, kein eval.
//   2. Rückfall: schlägt das fehl (Datei fehlt/veraltet), wird wie früher
//      <data-src>.jsx geladen und im Browser per Babel kompiliert (new Function).
//   3. React/ReactDOM sind in den HTML-Dateien fest versioniert und per SRI
//      abgesichert. Fehlen sie trotzdem (z.B. Hash-Konflikt), werden sie hier
//      ohne SRI aus derselben, fest versionierten URL nachgeladen.
(function () {
  var self = document.currentScript;
  var APP = self.getAttribute("data-app");
  var SRC = self.getAttribute("data-src");
  var statusEl = document.getElementById("load-status");

  // Fest versionierte CDN-Quellen (identisch zu den <script>-Tags und zu
  // CDN_ASSETS in sw.js — bei Änderungen überall nachziehen).
  var CDN = {
    react: "https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js",
    reactDom: "https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js",
    babel: "https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.10/babel.min.js"
  };

  function show(text, isError) {
    if (!statusEl) return;
    statusEl.style.display = "block";
    statusEl.style.color = isError ? "#f87171" : "#fcd34d";
    statusEl.textContent = text;
  }

  window.addEventListener("error", function (e) {
    show("JS-FEHLER: " + (e.error ? (e.error.stack || e.error.message) : e.message) + " (Zeile " + e.lineno + ")", true);
  });
  window.addEventListener("unhandledrejection", function (e) {
    var msg = "PROMISE-FEHLER: " + (e.reason && e.reason.stack ? e.reason.stack : String(e.reason));
    // MapTiler's own WebGL-context-loss handling triggers an internal
    // promise rejection (via setPrimaryLanguage) that looks fatal but
    // isn't — the app already listens for and recovers from context loss
    // itself (rebuilding the map). Surfacing this as a stuck red banner
    // was misleading once the map had already silently recovered.
    if (/maptiler-sdk|setPrimaryLanguage/.test(msg)) { console.error(msg); return; }
    show(msg, true);
  });

  function loadScript(url, withCors) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = url;
      // Mit crossorigin, damit der Service Worker eine "echte" (nicht opake)
      // Antwort cachen kann, die auch für die SRI-geprüften <script>-Tags passt.
      if (withCors) s.crossOrigin = "anonymous";
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Konnte " + url + " nicht laden")); };
      document.head.appendChild(s);
    });
  }

  async function ensureGlobals() {
    if (typeof React === "undefined") { try { await loadScript(CDN.react, true); } catch (e) {} }
    if (typeof ReactDOM === "undefined") { try { await loadScript(CDN.reactDom, true); } catch (e) {} }
    if (typeof React === "undefined") throw new Error("React konnte nicht geladen werden (CDN blockiert?)");
    if (typeof ReactDOM === "undefined") throw new Error("ReactDOM konnte nicht geladen werden (CDN blockiert?)");
  }

  // Schneller Weg: vorkompiliertes Bundle. Cache-Buster wie früher bei der
  // .jsx-Datei, damit nach einem Release nicht die von GitHub Pages
  // zwischengespeicherte (10 Min.) alte Fassung geladen wird.
  async function loadPrecompiled() {
    window.__FLUGBUCH_APP__ = undefined;
    await loadScript("build/" + SRC + ".js?v=" + Date.now(), false);
    var App = window.__FLUGBUCH_APP__;
    if (typeof App !== "function") throw new Error("build/" + SRC + ".js enthält keine App");
    return App;
  }

  // Rückfall: wie früher im Browser mit Babel kompilieren.
  async function loadWithBabel() {
    show("Vorkompilierte Datei nicht verfügbar — kompiliere " + SRC + ".jsx im Browser…", false);
    if (typeof Babel === "undefined") {
      try { await loadScript(CDN.babel, true); } catch (e) {}
    }
    if (typeof Babel === "undefined") throw new Error("Babel konnte nicht geladen werden (CDN blockiert?)");
    var resp = await fetch(SRC + ".jsx?v=" + Date.now());
    if (!resp.ok) throw new Error("Fehler beim Laden von " + SRC + ".jsx: HTTP " + resp.status);
    var source = await resp.text();
    var compiled;
    try {
      compiled = Babel.transform(source, { presets: ["react"] }).code;
    } catch (e) {
      throw new Error("BABEL-KOMPILIER-FEHLER:\n" + (e.message || String(e)));
    }
    var runApp = new Function("React", "ReactDOM", compiled + "\n; return " + APP + ";");
    return runApp(React, ReactDOM);
  }

  async function run() {
    try {
      show("Lade App-Code…", false);
      await ensureGlobals();

      // Versionsnummer für den Backup-Dateinamen (service.jsx) bereitstellen,
      // bevor die App läuft.
      try {
        var vResp = await fetch("version.json?v=" + Date.now());
        window.APP_VERSION = vResp.ok ? (await vResp.json()).version : null;
      } catch (e) { window.APP_VERSION = null; }

      var App;
      try {
        App = await loadPrecompiled();
      } catch (e) {
        console.warn("Vorkompilierte Datei nicht nutzbar, Rückfall auf Babel:", e);
        App = await loadWithBabel();
      }

      var root = ReactDOM.createRoot(document.getElementById("root"));
      root.render(React.createElement(App));
      setTimeout(function () {
        if (statusEl && !/FEHLER/.test(statusEl.textContent)) statusEl.style.display = "none";
      }, 800);
    } catch (e) {
      show("FEHLER:\n" + (e.message || String(e)) + (e.stack ? "\n\n" + e.stack : ""), true);
    }
  }

  // Erst nach "load": async eingebundene Skripte (z.B. Google Sign-In in
  // statistik.html) sollen beim Start der App schon verfügbar sein.
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run);
})();
