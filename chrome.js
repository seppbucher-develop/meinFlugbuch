// Gemeinsamer "Rahmen" für alle Seiten der App:
//   • unten links die Versionsnummer (aus version.json)
//   • unten rechts ein runder "?"-Button, der zur Hilfe springt
//     (hilfe.html#<seite>, damit direkt der passende Abschnitt offen ist)
//
// Einbindung am Ende von <body> jeder Seite:
//   <script src="chrome.js" data-page="flugbuch"></script>
// Auf hilfe.html selbst: data-page="hilfe" -> nur die Version, kein "?".
//
// Bewusst z-index 50: Dialoge/Overlays der App liegen bei 100+ und decken
// die beiden Elemente dadurch ab, statt von ihnen überlagert zu werden.
(function () {
  var script = document.currentScript;
  var page = (script && script.getAttribute("data-page")) || "";

  var css = [
    ".fb-chrome{position:fixed;bottom:calc(8px + env(safe-area-inset-bottom,0px));z-index:50;",
    "font-family:system-ui,sans-serif;pointer-events:none;}",
    ".fb-chrome-version{left:calc(10px + env(safe-area-inset-left,0px));font-size:11px;",
    "color:#a8d8f5;opacity:.75;background:rgba(4,14,32,.6);padding:2px 7px;border-radius:8px;}",
    ".fb-chrome-help{right:calc(10px + env(safe-area-inset-right,0px));pointer-events:auto;",
    "width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;",
    "background:rgba(4,14,32,.85);border:1px solid rgba(255,255,255,.22);color:#7dd3fc;",
    "font-size:17px;font-weight:800;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.4);}",
    ".fb-chrome-help:active{transform:scale(.94);}",
    ""
  ].join("");
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var ver = document.createElement("div");
  ver.className = "fb-chrome fb-chrome-version";
  ver.id = "fbVersion";
  ver.style.display = "none";
  document.body.appendChild(ver);

  // Cache-Buster wie beim Laden der .jsx-Dateien: sonst zeigt GitHub Pages
  // (10 Min. Cache) nach einem Release noch die alte Nummer.
  fetch("version.json?v=" + Date.now())
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (d && d.version) { ver.textContent = d.version; ver.style.display = ""; }
    })
    .catch(function () {});

  if (page !== "hilfe") {
    var a = document.createElement("a");
    a.className = "fb-chrome fb-chrome-help";
    a.href = "hilfe.html" + (page ? "#" + page : "");
    a.title = "Hilfe";
    a.setAttribute("aria-label", "Hilfe");
    a.textContent = "?";
    document.body.appendChild(a);
  }
})();
