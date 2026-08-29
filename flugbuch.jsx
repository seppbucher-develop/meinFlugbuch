const { useState, useEffect, useRef, useCallback, useMemo } = React;

// ── IGC Parser ─────────────────────────────────────────────────────────────
// Set by FlightProfile while its zoom level is above 1×, checked by the
// swipe-between-flights handler further down so a horizontal drag inside a
// zoomed profile chart can never also trigger navigating to the next/
// previous flight. A plain module-level flag rather than React state/
// context since this is a short-lived interaction lock between two
// components that don't otherwise need to know about each other.
let profileZoomActive = false;

function parseIGC(text) {
  const lines = text.split("\n");
  const track = [];
  let date = "", pilot = "", glider = "", tzOffsetHours = null;
  for (const line of lines) {
    if (line.startsWith("HFDTE")) {
      const m = line.match(/HFDTE(?:DATE:)?(\d{2})(\d{2})(\d{2})/);
      if (m) date = `${m[1]}.${m[2]}.20${m[3]}`;
    }
    // Header records carry more than just the date — pilot name and glider
    // type are standard IGC fields (every logger writes them). Reading
    // these means a fresh IGC import can fill in Pilot/Schirm immediately
    // instead of leaving them blank for manual entry.
    if (line.startsWith("HFPLT")) {
      const m = line.match(/HFPLT(?:PILOTINCHARGE:|PILOT:)?(.+)/);
      if (m) pilot = m[1].trim();
    }
    if (line.startsWith("HFGTY")) {
      const m = line.match(/HFGTY(?:GLIDERTYPE:)?(.+)/);
      if (m) glider = m[1].trim();
    }
    // B-record times are always UTC per the IGC spec — HFTZN is the
    // timezone the pilot's own device was set to for that flight, used to
    // convert Startzeit/Landezeit to local time. Always trusted as given,
    // including 0 (UTC), since that can be the pilot's genuinely correct
    // setting rather than a misconfiguration.
    if (line.startsWith("HFTZN")) {
      const m = line.match(/HFTZN(?:TIMEZONE:)?(-?\d+(?:\.\d+)?)/);
      if (m) tzOffsetHours = parseFloat(m[1]);
    }
    if (line.startsWith("B") && line.length >= 35) {
      const hh = +line.slice(1,3), mm = +line.slice(3,5), ss = +line.slice(5,7);
      const latD = +line.slice(7,9), latM = +line.slice(9,14)/1000;
      const lonD = +line.slice(15,18), lonM = +line.slice(18,23)/1000;
      const latS = line[14], lonS = line[23];
      const lat = (latD + latM/60) * (latS==="S"?-1:1);
      const lon = (lonD + lonM/60) * (lonS==="W"?-1:1);
      // IGC B-record layout: time(6) + lat(7)+N/S(1) + lon(8)+E/W(1) +
      // validity(1) + pressure-altitude PPPPP(5) + GPS-altitude GGGGG(5).
      // This was reading columns 25-29 (pressure altitude) while calling
      // the result "gpsAlt" — the actual GPS altitude field is 30-34.
      // Mixing them up doesn't just mislabel a value: pressure altitude
      // can drift from true GPS altitude by hundreds of meters depending
      // on the day's air pressure, and a single dropout in either field
      // reading exactly 0 (a common "no fix" sentinel) can silently
      // become the "minimum altitude" for an entire flight, throwing off
      // every altitude-based feature (height-coded track colour, max
      // altitude stat, thermal detection). Real altitude readings are
      // never exactly 0m for a flight anywhere the app is actually used,
      // so a 0 reading is always treated as a glitch and skipped rather
      // than kept as a real data point.
      const gpsAlt = +line.slice(30,35);
      if (!isNaN(lat)&&!isNaN(lon)&&!isNaN(gpsAlt)&&gpsAlt>0)
        track.push({ lat, lon, gpsAlt, timeSec: hh*3600+mm*60+ss });
    }
  }
  return { track, date, pilot, glider, tzOffsetHours };
}

// No HFTZN in the file: look up the real IANA timezone for the takeoff
// point (via the tz-lookup library, loaded in index.html/flugbuch.html)
// and ask the browser's own Intl API for the correct UTC offset on that
// exact date — this gets the right DST rule for whatever country the
// flight was actually in, not just a rough guess. Falls back to a plain
// longitude estimate (~15° per hour) only if the library isn't loaded or
// the lookup fails for some reason.
function estimateTzOffset(firstPt, dateStr) {
  if (!firstPt) return 0;
  try {
    if (typeof window !== "undefined" && window.tzlookup) {
      const zoneName = window.tzlookup(firstPt.lat, firstPt.lon);
      const m = String(dateStr).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      const d = m ? new Date(Date.UTC(+m[3], +m[2]-1, +m[1], 12)) : new Date();
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: zoneName, timeZoneName: "shortOffset" }).formatToParts(d);
      const tzPart = parts.find(p => p.type === "timeZoneName")?.value || "";
      const om = tzPart.match(/GMT([+-]\d+)(?::(\d+))?/);
      if (om) {
        const h = parseInt(om[1], 10);
        const extraMin = om[2] ? parseInt(om[2],10)/60 : 0;
        return h >= 0 ? h + extraMin : h - extraMin;
      }
      if (tzPart === "GMT") return 0;
    }
  } catch {}
  return Math.round((firstPt.lon || 0) / 15);
}

// Max.Steigen / Max.Sinken / Max.Steigen 20s — herausgelöst aus analyzeIGC,
// damit dieselbe Berechnung auch für die einmalige Nachrechnen-Funktion
// (recomputeTrackStats, siehe FlugbuchApp) genutzt werden kann, ohne den
// ganzen (u.a. die Distanz-Optimierung enthaltenden) analyzeIGC-Durchlauf
// erneut anzustossen.
function computeClimbSinkStats(track) {
  // Max.Steigen / Max.Sinken: absolute maximum rate found between any two
  // consecutive track points (instantaneous, not smoothed/averaged over a
  // time window) — the person wants the raw peak value the vario would
  // have shown, not a windowed approximation.
  let maxClimb = -Infinity, maxSinkRate = Infinity;
  for (let i=1; i<track.length; i++) {
    const dt = track[i].timeSec - track[i-1].timeSec;
    if (dt <= 0) continue;
    const rate = (track[i].gpsAlt - track[i-1].gpsAlt) / dt;
    if (rate > maxClimb) maxClimb = rate;
    if (rate < maxSinkRate) maxSinkRate = rate;
  }
  maxClimb = isFinite(maxClimb) ? +maxClimb.toFixed(1) : 0;
  maxSinkRate = isFinite(maxSinkRate) ? +maxSinkRate.toFixed(1) : 0;
  // "Max.Steigen 20s": same sliding-window approach as maxClimb above, but
  // with the classic 20-second window used by most vario/competition tools
  // (rather than the 30s window empirically tuned for maxClimb) — kept as
  // a separate figure since the two windows deliberately serve different
  // comparisons (this app's own Max.Steigen vs. externally-reported 20s
  // climb values).
  const CLIMB_WINDOW_SEC_20 = 20;
  let maxClimb20 = -Infinity;
  {
    let j = 0;
    for (let i=0; i<track.length; i++) {
      const t0 = track[i].timeSec;
      const target = t0 + CLIMB_WINDOW_SEC_20;
      while (j < track.length && track[j].timeSec < target) j++;
      if (j >= track.length) break;
      if (j === i) continue;
      const dt = track[j].timeSec - t0;
      if (dt <= 0) continue;
      const rate = (track[j].gpsAlt - track[i].gpsAlt) / dt;
      if (rate > maxClimb20) maxClimb20 = rate;
    }
  }
  maxClimb20 = isFinite(maxClimb20) ? +maxClimb20.toFixed(1) : 0;
  return { maxClimb, maxClimb20, maxSinkRate };
}

// Steig-/Sinkwerte immer mit genau einer Nachkommastelle anzeigen (z.B.
// "3.0" statt "3"). Die berechneten Rohwerte sind zwar schon auf eine
// Nachkommastelle gerundet (toFixed(1) in computeClimbSinkStats), aber
// sobald das Ergebnis als Zahl weiterverarbeitet (parseFloat, +wert) oder
// über String(...) wieder in customFields abgelegt wird, geht eine
// überflüssige Null wieder verloren ("3.0" -> 3 -> "3"). Diese Funktion
// wird deshalb erst an jeder Anzeigestelle angewendet, nicht beim Speichern.
function fmt1(v) {
  const n = parseFloat(v);
  return isNaN(n) ? "" : n.toFixed(1);
}

// Dauer immer als "Xh MMm" formatieren (z.B. "2h 27m"), unabhängig von der
// Quelle (IGC-Track, manuell erfasste Start-/Landezeit, CSV-Import) — ein
// CSV-Import übernahm die Dauer bisher ungefiltert im rohen Format aus der
// Exceldatei (z.B. "0:57"), was neben echten IGC-Flügen inkonsistent aussah.
function formatDurationHM(sec) {
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60);
  return `${h}h ${String(m).padStart(2,"0")}m`;
}

function analyzeIGC(track, tzOffsetHours, dateStr) {
  const tz = tzOffsetHours != null ? tzOffsetHours : estimateTzOffset(track[0], dateStr);
  if (!track.length) return {};
  const alts = track.map(p=>p.gpsAlt);
  const maxAlt = Math.max(...alts), minAlt = Math.min(...alts);
  const startAlt = track[0].gpsAlt, endAlt = track[track.length-1].gpsAlt;
  const startPt = track[0], endPt = track[track.length-1];
  const { maxClimb, maxClimb20, maxSinkRate } = computeClimbSinkStats(track);
  // Thermal count (separate from the climb/sink rate calc above) — counts
  // sustained climb segments using a simple threshold-crossing detector.
  const thermals=[]; let inT=false, tStart=null;
  for(let i=1;i<track.length;i++){
    const rate=(track[i].gpsAlt-track[i-1].gpsAlt)/(track[i].timeSec-track[i-1].timeSec||1);
    if(rate>0.5&&!inT){inT=true;tStart=i;}
    else if(rate<=0.5&&inT){inT=false;if(tStart)thermals.push({start:tStart,end:i});}
  }
  // Total height gain ("Höhengewinn"): sum of every positive altitude step
  // across the whole track, not just within detected thermals — this is
  // the standard "total climb" metric (matches what tools like XCSoar/
  // SeeYou report), so a flight with several separate climbs adds them
  // all up rather than only counting the single best one.
  let totalGain = 0;
  for (let i=1;i<track.length;i++) {
    const diff = track[i].gpsAlt - track[i-1].gpsAlt;
    if (diff > 0) totalGain += diff;
  }
  // Startzeit/Landezeit include seconds (HH:MM:SS), and Dauer is derived
  // from those two strings via the same formula used for manually-entered
  // flights — rather than independently from the raw track timestamps —
  // so it stays consistent if either time is edited by hand afterwards.
  const fmtClock = (sec) => {
    // Applying the offset here (not to the underlying timeSec/durationSec)
    // keeps duration math simple and correct regardless of timezone, since
    // a constant offset cancels out in any time difference — only the
    // displayed clock time needs to shift to local time.
    const local = ((sec + tz*3600) % 86400 + 86400) % 86400;
    const h = Math.floor(local/3600), m = Math.floor((local%3600)/60), s = Math.floor(local%60);
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  };
  const startTime = fmtClock(track[0].timeSec);
  const endTime = fmtClock(track[track.length-1].timeSec);
  let durationSec = track[track.length-1].timeSec - track[0].timeSec;
  if (durationSec < 0) durationSec += 24*3600; // landing past midnight
  const durationStr = formatDurationHM(durationSec);
  // H.Diff. is computed from Start-/Landeplatz-Höhe (same as the manual-
  // entry formula). Distanz is deliberately NOT computed here — IGC-
  // derived distance wasn't accurate enough to trust, so it's always left
  // for manual entry, and Ø Speed only gets filled in once that manual
  // distance exists (via saveComputedField, same as for any other flight).
  const hDiff = Math.abs(startAlt - endAlt);
  // Analog XContest „Freier Streckenflug" (bis zu 3 Wendepunkte) — siehe
  // computeOpenDistanceKm weiter unten in dieser Datei (Funktionsdeklara-
  // tionen werden gehoisted, daher hier bereits aufrufbar).
  const scoreDistanceKm = computeOpenDistanceKm(track);
  // Max Speed im Geradeausflug (siehe computeMaxStraightSpeedKmh weiter
  // unten) — Spiralen/Wingover werden dort bewusst ausgeklammert, da sie
  // zwar oft die höchste GPS-Geschwindigkeit im ganzen Flug liefern, aber
  // eine Manöver- statt Gleitflug-Geschwindigkeit sind.
  const maxSpeedKmh = computeMaxStraightSpeedKmh(track);
  return { maxAlt, minAlt, startAlt, endAlt, startPt, endPt, durationSec, durationStr, startTime, endTime,
    thermalCount: thermals.length, maxClimb, maxClimb20, maxSinkRate, totalGain: Math.round(totalGain), hDiff, scoreDistanceKm, maxSpeedKmh };
}

// Kleinster Winkel zwischen zwei Peilungen (0-180°), unabhängig von der
// 0°/360°-Wrap-Grenze. (bearingDeg selbst ist bereits weiter unten in dieser
// Datei definiert — Funktionsdeklarationen werden gehoisted, daher hier schon
// aufrufbar.)
function angleDiffDeg(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Für einen Trackpunkt i: das Zeitfenster [lo,hi], das mindestens
// minWindowSec in JEDE Richtung um ihn herum abdeckt (nicht nur einen
// einzelnen Nachbarpunkt) — Basis für die "Geradeausflug"-Erkennung in
// computeMaxStraightSpeedKmh unten. Zeitbasiert statt punktbasiert, damit
// das Fenster unabhängig von der Aufzeichnungsrate des jeweiligen Loggers
// (1s, 4s, …) eine vergleichbare Zeitspanne abdeckt.
function timeWindowBounds(track, i, minWindowSec) {
  let lo = i;
  while (lo > 0 && (track[i].timeSec - track[lo-1].timeSec) < minWindowSec) lo--;
  let hi = i;
  while (hi < track.length-1 && (track[hi+1].timeSec - track[i].timeSec) < minWindowSec) hi++;
  return { lo, hi };
}

// Ein Fenster [lo,hi] gilt als "Geradeausflug", wenn JEDE einzelne
// Kurssegment-Richtung darin innerhalb von corridorDeg der Gesamt-Peilung
// track[lo]->track[hi] bleibt. Das ist die eigentliche Spiralen-/Wingover-/
// Thermikkreis-Erkennung: eine echte Kurve, Spirale, ein Wingover oder ein
// schneller Thermikkreis kann diesen Test nie erfüllen, weil die
// Kursrichtung darin laufend um mehr als corridorDeg abweicht — auch wenn
// ein einzelner Punkt darin rein zufällig eine kurzzeitig unauffällige
// Punkt-zu-Punkt-Kursänderung zeigt. Genau das war die Schwäche einer
// früheren, rein punktbasierten Version dieses Algorithmus: an zwei realen
// Flügen erzeugte je ein einzelner schlechter GPS-Fix eine völlig
// überzogene Ein-Sekunden-"Geschwindigkeit" (~150 km/h) mit einer zufällig
// geringen Kursänderung an genau diesem einen Punkt — einmal kurz vor der
// Landung (Höhe praktisch konstant), einmal mitten in einer echten Spirale
// (an genau diesem Punkt zufällig kaum Kursänderung, obwohl die
// unmittelbaren Nachbarn stark schwankende Kursänderungen von 15-150°/s
// zeigten). Die fensterweite Prüfung über mindestens SPEED_WINDOW_SEC
// Sekunden erkennt beide Fälle zuverlässig: eine Spirale (mindestens ein
// bis zwei volle, oft mehrere Kreise) hält niemals über SPEED_WINDOW_SEC
// Sekunden hinweg eine Kursrichtung innerhalb von ±SPEED_CORRIDOR_DEG.
function isWindowStraight(track, lo, hi, corridorDeg) {
  if (hi - lo < 2) return true; // zu kurz, um sinnvoll zu beurteilen
  const overallHeading = bearingDeg(track[lo], track[hi]);
  for (let k = lo; k < hi; k++) {
    if (angleDiffDeg(bearingDeg(track[k], track[k+1]), overallHeading) > corridorDeg) return false;
  }
  return true;
}

// Höchste GPS-Geschwindigkeit im (mehr oder weniger) Geradeausflug — siehe
// isWindowStraight oben für die Herleitung der beiden Konstanten. Die
// "Messdistanz" für die Geschwindigkeit ist bewusst nicht der einzelne
// 1-Sekunden-Schritt, sondern das ganze bestätigt gerade Fenster
// (track[lo] bis track[hi]): das mittelt einzelne GPS-Positionsfehler
// automatisch heraus, statt ihnen wie ein Ein-Punkt-Vergleich schutzlos
// ausgesetzt zu sein.
const SPEED_WINDOW_SEC = 4;
const SPEED_CORRIDOR_DEG = 15;
// Reine Sicherheitsmarge für den unwahrscheinlichen Fall, dass trotz allem
// noch ein Ausreisser durchrutscht — ein Gleitschirm erreicht auch im
// Vollgas-Speedbar-Geradeausflug mit starkem Rückenwind keine höheren
// GPS-Bodengeschwindigkeiten.
const PLAUSIBLE_MAX_SPEED_KMH = 120;
function computeMaxStraightSpeedKmh(track) {
  if (!track || track.length < 3) return 0;
  let maxSpeed = 0;
  for (let i = 1; i < track.length - 1; i++) {
    const { lo, hi } = timeWindowBounds(track, i, SPEED_WINDOW_SEC);
    if (hi === lo) continue;
    if (!isWindowStraight(track, lo, hi, SPEED_CORRIDOR_DEG)) continue; // Kurve/Spirale/Wingover/Thermikkreis — ausklammern
    const dt = track[hi].timeSec - track[lo].timeSec;
    const speedKmh = (haversineDistKm(track[lo], track[hi]) || 0) / (dt / 3600);
    if (speedKmh > PLAUSIBLE_MAX_SPEED_KMH) continue;
    if (speedKmh > maxSpeed) maxSpeed = speedKmh;
  }
  return +maxSpeed.toFixed(1);
}

// ── FlightMap ──────────────────────────────────────────────────────────────
// IGC-/GPX-Export verwenden den ursprünglichen Dateinamen des importierten
// IGC-Files (customFields.igcFilename, bereits ohne Endung — siehe
// importIGCFiles), damit ein Re-Export denselben Namen trägt wie die
// Originaldatei vom Fluginstrument. Ein eigener Fallback-Name für den
// GPX-Export ist nicht nötig: der GPX-Export-Button erscheint ohnehin nur,
// wenn ein Track vorhanden ist (fl.track?.length>1), und ein Track kommt
// ausschliesslich aus einem IGC-Import — igcFilename ist in diesem Fall
// also immer gesetzt.

// Builds a minimal valid GPX 1.1 track file from a flight's IGC track
// points, so it can be opened in an external map viewer (gpx.studio) that
// renders real map tiles reliably instead of our own hand-drawn canvas tiles.
function buildGpxFromFlight(flight) {
  const track = flight?.track || [];
  if (!track.length) return null;
  const points = track.map(p => {
    const h = Math.floor(p.timeSec/3600)%24, m = Math.floor((p.timeSec%3600)/60), s = p.timeSec%60;
    const timeStr = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}Z`;
    return `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.gpsAlt}</ele><time>1970-01-01T${timeStr}</time></trkpt>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="meinflugApp" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${flight?.name || "Flug"}</name><trkseg>${points}</trkseg></trk>
</gpx>`;
}


// ── WorldMapView ───────────────────────────────────────────────────────────
// Shows Startplatz/Landeplatz markers across all (or just the currently
// multi-selected) flights, rendered with the MapTiler SDK (loaded via CDN
// in flugbuch.html) — same approach as meintauchbuch's MiniMap component,
// using the OUTDOOR (terrain/relief) style with German-language labels.
// Separate from FlightMap's own custom canvas renderer used in the flight
// detail view, which stays exactly as it was (it needs the height-profile
// zoom sync, which this map has no equivalent of).
// Kein eingebauter Schlüssel mehr — muss unter Service → API-Zugangsdaten
// hinterlegt werden ("settings:maptilerApiKey"), sonst bleiben die Karten
// leer (siehe die beiden apiKey-Stellen unten, die ohne Fallback nur noch
// mapTilerKey selbst verwenden).

// Stylised paraglider wing icon (top-down view, transparent background,
// user-provided photo/render) used as the profile-sync reference marker in
// the flight-detail map — replaces the plain red dot, and rotates to face
// the actual flight direction at that point in the track.
// Selectable glider marker variants — colour/pattern options the person
// photographed and cropped themselves (see Settings > Schirme). Background
// removal: erode the white mask slightly first (border_value=1, treating
// "beyond the image edge" as background too) to break thin bridges between
// the true background and enclosed white design elements near notches in
// the silhouette, then dilate the border-touching regions back out — this
// keeps chevron patterns etc. opaque while still clearing the real
// background. Chosen variant is persisted ("gliderVariant" storage key)
// and used everywhere the glider marker/reference-point icon appears.
const GLIDER_VARIANTS = [
  { id: "custom", label: "Eigenes Symbol", type: "text", char: "" },
  { id: "parachute", label: "Schirm-Emoji", type: "text", char: "🪂" },
{ id: "v1", label: "Dunkelblau", type: "image", dataUrl: "data:image/png;base64,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" },
{ id: "v2", label: "Türkis", type: "image", dataUrl: "data:image/png;base64,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" },
{ id: "v3", label: "Gelb", type: "image", dataUrl: "data:image/png;base64,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" },
{ id: "v4", label: "Weiss/Blau", type: "image", dataUrl: "data:image/png;base64,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" },
{ id: "v7", label: "Blau/Rot", type: "image", dataUrl: "data:image/png;base64,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" },
{ id: "v8", label: "Orange/Blau", type: "image", dataUrl: "data:image/png;base64,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" },
{ id: "v9", label: "Rot/Weiss/Blau", type: "image", dataUrl: "data:image/png;base64,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" },
];
const DEFAULT_GLIDER_VARIANT = "v1";

// MapTiler's own "The WebGL context was lost." warning banner isn't
// scoped inside the specific map's container (clearing that container
// wasn't enough to remove it) — it stays visible until this sweeps the
// whole document for it. Called right after a successful map rebuild.
function removeStrayMapTilerWarnings() {
  try {
    document.querySelectorAll("body *").forEach(el => {
      if (el.children.length === 0 && /WebGL context was lost/i.test(el.textContent || "")) {
        el.remove();
      }
    });
  } catch (e) { /* best-effort cleanup, never worth breaking anything over */ }
}


function WorldMapView({ flights, selectedIds, onBack, mapTilerKey }) {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const [showSP, setShowSP] = useState(true);
  const [showLP, setShowLP] = useState(true);
  const [search, setSearch] = useState("");

  const relevantFlights = (selectedIds && selectedIds.size > 0)
    ? flights.filter(f => selectedIds.has(f.id))
    : flights;

  const points = useMemo(() => {
    // Same advanced syntax as the main Flugliste search (feld:wert,
    // feld=wert, feld>wert, +wort/-wort, UND/ODER) — matchFlights is the
    // exact function that search uses, reused here instead of a separate,
    // more limited implementation.
    const searched = search.trim() ? matchFlights(relevantFlights, search) : relevantFlights;
    const seen = new Map();
    for (const f of searched) {
      if (showSP && f.startPt && f.startPt.lat != null) {
        const name = f.site || "";
        const key = `SP:${f.startPt.lat.toFixed(3)},${f.startPt.lon.toFixed(3)}`;
        if (!seen.has(key)) seen.set(key, { lat: f.startPt.lat, lon: f.startPt.lon, type: "SP", name });
      }
      if (showLP && f.endPt && f.endPt.lat != null) {
        const name = f.customFields?.landung || "";
        const key = `LP:${f.endPt.lat.toFixed(3)},${f.endPt.lon.toFixed(3)}`;
        if (!seen.has(key)) seen.set(key, { lat: f.endPt.lat, lon: f.endPt.lon, type: "LP", name });
      }
    }
    return [...seen.values()];
  }, [relevantFlights, showSP, showLP, search]);

  // MapTiler SDK map, same approach as meintauchbuch's MiniMap: OUTDOOR
  // style (terrain/relief/hillshading — unlike Leaflet+OpenTopoMap, this
  // is a more reliable CDN with German-language labels built in) with a
  // German locale. Rebuilt whenever the filtered point set actually
  // changes (compared via a stable JSON key), same as Tauchbuch does.
  const pointsKey = JSON.stringify(points);
  useEffect(() => {
    if (!mapDivRef.current || !window.maptilersdk || !points.length || !mapTilerKey) return;
    const sdk = window.maptilersdk;

    const initMap = () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      // Clears any leftover DOM MapTiler injected but didn't clean up on
      // its own (e.g. its "WebGL context was lost" warning banner).
      if (mapDivRef.current) mapDivRef.current.innerHTML = "";
      const map = new sdk.Map({
        container: mapDivRef.current,
        apiKey: mapTilerKey,
        style: sdk.MapStyle.OUTDOOR,
        language: "de",
        center: [points[0].lon, points[0].lat],
        zoom: 8,
      });
      mapRef.current = map;

      // Recovers automatically from "WebGL context was lost" (a platform-
      // level thing, especially on iOS Safari under memory pressure or
      // after long backgrounding) by rebuilding this same map right away.
      const canvas = map.getCanvas && map.getCanvas();
      if (canvas) {
        canvas.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          removeStrayMapTilerWarnings();
          if (mapRef.current === map) initMap();
        }, { once: true });
      }

      points.forEach(p => {
        const el = document.createElement("div");
        el.style.cssText = `width:16px;height:16px;border-radius:50%;background:${p.type==="SP"?"#4ade80":"#f87171"};border:2px solid rgba(255,255,255,0.85);box-shadow:0 1px 4px rgba(0,0,0,0.5);`;
        const marker = new sdk.Marker({ element: el }).setLngLat([p.lon, p.lat]);
        marker.setPopup(new sdk.Popup({ offset: 14 }).setText(p.name || (p.type === "SP" ? "Startplatz" : "Landeplatz")));
        marker.addTo(map);
      });

      if (points.length > 1) {
        const lons = points.map(p => p.lon), lats = points.map(p => p.lat);
        map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 40 });
      }
      map.on("load", () => removeStrayMapTilerWarnings());
    };
    initMap();
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [pointsKey]);

  return (
    <div style={{minHeight:"100vh",background:"#040e20",color:"#e8f4fd",fontFamily:"system-ui,sans-serif",paddingBottom:24}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"calc(20px + env(safe-area-inset-top, 0px)) 16px 14px",borderBottom:"1px solid rgba(100,180,255,0.1)",marginBottom:12}}>
        <button onClick={()=>{window.location.href="index.html";}} title="Zur Startseite"
          style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,color:"rgba(232,244,253,0.8)",cursor:"pointer",flexShrink:0}}>
          🏠
        </button>
        <button onClick={onBack} style={{background:"none",border:"none",color:"#7dd3fc",fontSize:22,cursor:"pointer",padding:0}}>‹</button>
        <div>
          <div style={{fontSize:11,fontWeight:600,color:"#7dd3fc",letterSpacing:1.5,textTransform:"uppercase"}}>Weltkarte</div>
          <div style={{fontSize:10,color:"rgba(232,244,253,0.35)",marginTop:1}}>
            {selectedIds && selectedIds.size>0 ? `${selectedIds.size} ausgewählte Flüge` : `Alle ${flights.length} Flüge`} · {points.length} Orte
          </div>
        </div>
      </div>

      <div style={{padding:"0 16px 10px",display:"flex",gap:8,alignItems:"center",flexWrap:"nowrap",overflowX:"auto"}}>
        <button onClick={()=>setShowSP(s=>!s)}
          style={{background:showSP?"rgba(74,222,128,0.18)":"rgba(255,255,255,0.05)",border:`1px solid ${showSP?"rgba(74,222,128,0.4)":"rgba(255,255,255,0.1)"}`,borderRadius:20,padding:"7px 14px",color:showSP?"#4ade80":"rgba(232,244,253,0.5)",fontSize:13,fontWeight:700,cursor:"pointer"}}>
          🛫 Startplätze
        </button>
        <button onClick={()=>setShowLP(s=>!s)}
          style={{background:showLP?"rgba(248,113,113,0.18)":"rgba(255,255,255,0.05)",border:`1px solid ${showLP?"rgba(248,113,113,0.4)":"rgba(255,255,255,0.1)"}`,borderRadius:20,padding:"7px 14px",color:showLP?"#f87171":"rgba(232,244,253,0.5)",fontSize:13,fontWeight:700,cursor:"pointer"}}>
          🛬 Landeplätze
        </button>
      </div>
      <div style={{padding:"0 16px 12px"}}>
        <SearchBar filterText={search} setFilterText={setSearch} knownGliders={[...new Set(flights.map(f=>f.glider).filter(Boolean))].sort()} />
      </div>

      <div style={{margin:"0 16px",position:"relative",borderRadius:14,overflow:"hidden",border:"1px solid rgba(100,180,255,0.12)"}}>
        <div ref={mapDivRef} style={{width:"100%",height:"60vh",background:"#040e20"}} />
        {!mapTilerKey && (
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,background:"rgba(4,14,32,0.92)",color:"rgba(232,244,253,0.6)",fontSize:13,textAlign:"center",padding:24}}>
            <div style={{fontSize:28}}>🗺️</div>
            <div>Kein MapTiler-Schlüssel hinterlegt.</div>
            <a href="service.html" style={{color:"#7dd3fc",fontSize:12}}>→ Unter Service eintragen</a>
          </div>
        )}
        {mapTilerKey && points.length === 0 && (
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(4,14,32,0.85)",color:"rgba(232,244,253,0.5)",fontSize:14,pointerEvents:"none"}}>
            Keine Orte gefunden.
          </div>
        )}
      </div>
    </div>
  );
}


function FlightMap({ flight, highlightRange, onPlaybackPositionChange, onPlaybackActiveChange, controlsSlot, isWide, mapTilerKey }) {
  const previewDivRef = useRef(null);
  const previewMapRef = useRef(null);
  const previewRefMarkerRef = useRef(null);
  const previewReadyRef = useRef(false);
  const fullDivRef = useRef(null);
  const fullMapRef = useRef(null);
  const fullRefMarkerRef = useRef(null);
  const fullReadyRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Which glider marker to use — chosen in Settings > Schirme, shared
  // across the whole app via storage. Re-read on focus so a change made in
  // Settings (a different page) takes effect without needing a full reload
  // of this one. Two of the nine choices are a text/emoji symbol instead of
  // a photographed image ("Eigenes Symbol" custom letter/emoji, and the
  // fixed 🪂 emoji) — gliderIcon carries either { type:"image", value:url }
  // or { type:"text", value:char } so the marker-creation code below can
  // render the right kind without needing to know the full variant list.
  const [gliderIcon, setGliderIcon] = useState(() => {
    const d = GLIDER_VARIANTS.find(v => v.id === DEFAULT_GLIDER_VARIANT) || GLIDER_VARIANTS[0];
    return { type: d.type, value: d.type === "image" ? d.dataUrl : d.char };
  });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await window.storage.get("gliderVariant");
        const id = r ? r.value : DEFAULT_GLIDER_VARIANT;
        const found = GLIDER_VARIANTS.find(v => v.id === id) || GLIDER_VARIANTS.find(v => v.id === DEFAULT_GLIDER_VARIANT);
        let value = found.type === "image" ? found.dataUrl : found.char;
        if (found.id === "custom") {
          try {
            const c = await window.storage.get("gliderCustomChar");
            value = (c && c.value) ? c.value : "★"; // never render literally empty
          } catch (e) {}
        }
        if (!cancelled) setGliderIcon({ type: found.type, value });
      } catch (e) { console.error("Load error (gliderVariant):", e); }
    };
    load();
    window.addEventListener("focus", load);
    return () => { cancelled = true; window.removeEventListener("focus", load); };
  }, []);
  const [isPlaying, setIsPlaying] = useState(false);
  useEffect(() => { if (onPlaybackActiveChange) onPlaybackActiveChange(isPlaying); }, [isPlaying]);
  const [playSpeed, setPlaySpeed] = useState(10);
  const [playPickerOpen, setPlayPickerOpen] = useState(false);
  const [playElapsedSec, setPlayElapsedSec] = useState(0); // seconds into the flight (IGC time)
  const playMarkerRef = useRef(null);
  const previewPlayMarkerRef = useRef(null);
  const playRafRef = useRef(null);
  const playLastTsRef = useRef(null);

  const togglePlay = () => setIsPlaying(p => !p);

  const track = flight?.track || [];
  const sP = flight?.startPt, eP = flight?.endPt;
  const hasMap = track.length > 0 || (sP && eP);

  // Same GPS-glitch rejection as before: a single wild fix shouldn't blow
  // out the bounding box used for fitBounds.
  const cleanTrack = useMemo(() => {
    if (track.length < 3) return track;
    const median = arr => { const s=[...arr].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };
    const medLat = median(track.map(p=>p.lat)), medLon = median(track.map(p=>p.lon));
    const filtered = track.filter(p => Math.abs(p.lat-medLat)<=0.5 && Math.abs(p.lon-medLon)<=0.5);
    return filtered.length ? filtered : track;
  }, [track]);

  // Cumulative flown distance up to each track point (same basis
  // FlightProfile's own "distances" array uses) — lets playback report its
  // current position in a form the profile's cine-sync marker can use
  // directly, without either component needing to know how the other one
  // is internally structured.
  const cumDist = useMemo(() => {
    const arr = new Array(track.length).fill(0);
    for (let i=1;i<track.length;i++) arr[i] = arr[i-1] + (haversineDistKm(track[i-1], track[i]) || 0);
    return arr;
  }, [track]);

  // The segment highlightRange refers to (by cumulative flown distance
  // along the *raw* track, same basis FlightProfile itself uses), plus the
  // single nearest point to use for the red reference marker.
  const { segment, refPoint, heading } = useMemo(() => {
    if (!highlightRange || highlightRange.start == null || track.length < 2) return { segment: null, refPoint: null, heading: 0 };
    let acc = 0;
    const seg = [];
    if (acc >= highlightRange.start-0.05 && acc <= highlightRange.end+0.05) seg.push(track[0]);
    let bestIdx = 0, bestDiff = Math.abs(0 - highlightRange.center);
    for (let i=1;i<track.length;i++) {
      acc += haversineDistKm(track[i-1], track[i]) || 0;
      if (acc >= highlightRange.start-0.05 && acc <= highlightRange.end+0.05) seg.push(track[i]);
      const diff = Math.abs(acc - highlightRange.center);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    // Heading at this point: averaged over a short span around it (rather
    // than just the single adjacent step) so brief GPS jitter doesn't make
    // the marker's rotation flicker/jump as the person drags the profile.
    const spanBack = track[Math.max(0, bestIdx-3)];
    const spanFwd = track[Math.min(track.length-1, bestIdx+3)];
    const heading = bearingDeg(spanBack, spanFwd);
    return { segment: seg.length > 1 ? seg : null, refPoint: track[bestIdx], heading };
  }, [track, highlightRange]);

  // Creates ONE MapTiler map instance (and its one WebGL context) per
  // flight: track line (white casing + blue line) and S/L markers, added
  // once the style finishes loading. Deliberately does NOT depend on
  // highlightRange — recreating the whole map (and its GL context) on
  // every profile pan/zoom tick was exactly what caused the "WebGL context
  // was lost" errors, since browsers cap how many live contexts can exist
  // at once. Camera position and the reference marker are instead updated
  // in place by the separate effect below.
  // Baut den MapTiler/MapLibre "line-gradient"-Ausdruck für die Kartenlinie
  // — dieselbe Einfärbungslogik wie im Höhenprofil darunter (Höhe: rot=tief
  // bis blau=hoch; Steigen/Sinken: rot=Sinken bis grün=Steigen), damit
  // Karte und Profil beim Umschalten immer übereinstimmen. line-gradient
  // statt tausender Einzelsegmente: eine einzige Linie, deren Farbe entlang
  // ihrer eigenen Länge (0 bis 1, "line-progress") interpoliert wird — dafür
  // muss die Quelle mit lineMetrics:true angelegt werden (siehe unten).
  // Anzahl der Farb-Stützstellen wird auf ~400 begrenzt (Stride-Downsampling),
  // da ein Ausdruck mit tausenden Stopps unnötig gross und langsam zu
  // parsen wäre — für eine glatte Farbverlauf-Linie reicht das reichlich.
  // Baut den MapTiler/MapLibre "line-gradient"-Ausdruck für die Kartenlinie
  // — färbt nach Steig-/Sinkrate zwischen den GPS-Punkten (rot=Sinken,
  // gelb=neutral, grün=Steigen). line-gradient statt tausender Einzel-
  // segmente: eine einzige Linie, deren Farbe entlang ihrer eigenen Länge
  // (0 bis 1, "line-progress") interpoliert wird — dafür muss die Quelle
  // mit lineMetrics:true angelegt werden (siehe unten). Stopp-Anzahl auf
  // ~400 begrenzt (Stride-Downsampling), da ein Ausdruck mit tausenden
  // Stopps unnötig gross und langsam zu parsen wäre.
  const buildLineGradient = (pts) => {
    if (pts.length < 2) return null;
    const cum = [0];
    for (let i=1;i<pts.length;i++) cum.push(cum[i-1] + (haversineDistKm(pts[i-1], pts[i]) || 0));
    const total = cum[cum.length-1] || 1;

    const colorFor = (i) => {
      if (i === 0) return "hsl(70,90%,50%)"; // erster Punkt: neutral (keine Vorgänger-Rate)
      const dt = pts[i].timeSec - pts[i-1].timeSec;
      const rate = dt > 0 ? (pts[i].gpsAlt - pts[i-1].gpsAlt) / dt : 0;
      const t = (Math.max(-4, Math.min(4, rate)) + 4) / 8;
      return `hsl(${t*140},90%,50%)`;
    };

    const stride = Math.max(1, Math.ceil(pts.length / 400));
    const expr = ["interpolate", ["linear"], ["line-progress"]];
    let lastProgress = -1;
    for (let i=0; i<pts.length; i += stride) {
      const progress = total > 0 ? cum[i] / total : 0;
      if (progress <= lastProgress) continue; // Stopps müssen strikt steigen
      expr.push(progress, colorFor(i));
      lastProgress = progress;
    }
    // Letzten Punkt garantiert mit aufnehmen, sonst bricht die Linie am
    // Ende ggf. vor der eigentlichen Landung farblich ab.
    if (lastProgress < 1) expr.push(1, colorFor(pts.length-1));
    return expr;
  };

  const buildMap = (container, mapRefObj, readyRef) => {
    if (!container || !window.maptilersdk || !hasMap || !mapTilerKey) return;
    const sdk = window.maptilersdk;
    if (mapRefObj.current) { mapRefObj.current.remove(); mapRefObj.current = null; }
    // MapTiler's own .remove() doesn't reliably clear everything it
    // injects into the container (its "WebGL context was lost" warning
    // banner in particular stays put even through a full rebuild) —
    // clearing the container directly guarantees a clean slate.
    container.innerHTML = "";
    readyRef.current = false;
    const initialCenter = track.length ? [track[0].lon, track[0].lat] : [sP.lon, sP.lat];
    const map = new sdk.Map({
      container, apiKey: mapTilerKey, style: sdk.MapStyle.OUTDOOR,
      language: "de", center: initialCenter, zoom: 11,
    });
    mapRefObj.current = map;

    // "The WebGL context was lost" is a platform-level thing (iOS Safari in
    // particular reclaims GPU contexts aggressively under memory pressure or
    // after the tab's been backgrounded a while) — not something that can be
    // fully prevented, only recovered from. The underlying canvas fires a
    // real browser event for it, so rebuilding this same map right away
    // (rather than leaving it visibly broken) is straightforward.
    const canvas = map.getCanvas && map.getCanvas();
    if (canvas) {
      canvas.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        removeStrayMapTilerWarnings();
        if (mapRefObj.current === map) buildMap(container, mapRefObj, readyRef);
      }, { once: true });
    }

    const addMarker = (pt, color, label) => {
      const el = document.createElement("div");
      el.style.cssText = `width:22px;height:22px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;color:#fff;font:800 10px system-ui;`;
      el.textContent = label;
      new sdk.Marker({ element: el }).setLngLat([pt.lon, pt.lat]).addTo(map);
    };

    map.on("load", () => {
      const fullTrace = cleanTrack.length ? cleanTrack : track;
      if (fullTrace.length > 1) {
        map.addSource("track", {
          type: "geojson",
          lineMetrics: true,
          data: { type: "Feature", geometry: { type: "LineString", coordinates: fullTrace.map(p=>[p.lon,p.lat]) } },
        });
        map.addLayer({ id: "track-casing", type: "line", source: "track",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "rgba(255,255,255,0.55)", "line-width": 6.5 } });
        const gradient = buildLineGradient(fullTrace);
        map.addLayer({ id: "track-line", type: "line", source: "track",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: gradient ? { "line-gradient": gradient, "line-width": 3.5 } : { "line-color": "#1e40af", "line-width": 3.5 } });
      }
      if (track.length) {
        addMarker(track[0], "#22c55e", "S");
        addMarker(track[track.length-1], "#ef4444", "L");
      } else if (sP && eP) {
        addMarker(sP, "#22c55e", "S");
        addMarker(eP, "#ef4444", "L");
      }
      readyRef.current = true;
      applyHighlight(map, mapRefObj===previewMapRef ? previewRefMarkerRef : fullRefMarkerRef);
      removeStrayMapTilerWarnings();
    });
  };

  // Lightweight in-place update for a profile pan/zoom change: moves the
  // camera (fitBounds, no new context) and the single reference marker,
  // and swaps the track source's data between the full track and just the
  // zoomed-in segment. Safe to call repeatedly — does nothing until the
  // map's initial "load" has actually finished.
  const applyHighlight = (map, refMarkerRefObj) => {
    if (!map) return;
    const sdk = window.maptilersdk;
    // Line always shows the whole track — only the camera zooms into the
    // profile's segment (via fitBounds below), so nothing here needs to
    // touch the "track" source at all once it's been set on load.
    if (refMarkerRefObj.current) { refMarkerRefObj.current.remove(); refMarkerRefObj.current = null; }
    // Skip the static reference marker entirely while cine playback is
    // running — the moving playback marker already shows the current
    // position, and showing both at once looked like two overlapping
    // icons.
    if (refPoint && !isPlaying) {
      const el = document.createElement("div");
      el.style.cssText = `width:34px;height:34px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 1px 4px rgba(0,0,0,0.7));`;
      if (gliderIcon.type === "image") {
        const img = document.createElement("img");
        img.src = gliderIcon.value;
        img.style.cssText = `width:100%;height:100%;object-fit:contain;transform:rotate(${heading}deg);transition:transform 0.15s ease-out;`;
        el.appendChild(img);
      } else {
        el.style.fontSize = "26px";
        el.style.transform = `rotate(${heading}deg)`;
        el.style.transition = "transform 0.15s ease-out";
        el.textContent = gliderIcon.value;
      }
      // MapTiler markers rotate/pitch with the map by default, which would
      // fight with our own heading rotation on the inner icon — pin this
      // one to the screen instead so only the flight-direction rotation
      // ever applies to it.
      refMarkerRefObj.current = new sdk.Marker({ element: el, rotationAlignment: "viewport", pitchAlignment: "viewport" })
        .setLngLat([refPoint.lon, refPoint.lat]).addTo(map);
    }
    const fitToPoints = (pts) => {
      if (!pts.length) return;
      const lons = pts.map(p=>p.lon), lats = pts.map(p=>p.lat);
      if (pts.length === 1) { map.jumpTo({ center: [lons[0], lats[0]], zoom: 12 }); return; }
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 36, animate: false });
    };
    if (segment && segment.length > 1) fitToPoints(segment);
    else if (track.length) fitToPoints(cleanTrack.length ? cleanTrack : track);
    else if (sP && eP) fitToPoints([sP, eP]);
  };

  useEffect(() => {
    if (isFullscreen) {
      // Preview is hidden behind the fullscreen overlay anyway — tearing
      // down its map here means only one WebGL context is ever alive at a
      // time instead of two, which was adding to the GPU memory pressure
      // that triggers "WebGL context was lost" in the first place.
      if (previewMapRef.current) { previewMapRef.current.remove(); previewMapRef.current = null; }
      previewReadyRef.current = false;
      return;
    }
    buildMap(previewDivRef.current, previewMapRef, previewReadyRef);
    return () => { if (previewMapRef.current) { previewMapRef.current.remove(); previewMapRef.current = null; } };
  }, [flight?.id, gliderIcon, isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    // A frame's delay so the fullscreen overlay's container has its real
    // layout size before MapTiler reads it.
    const raf = requestAnimationFrame(() => buildMap(fullDivRef.current, fullMapRef, fullReadyRef));
    return () => {
      cancelAnimationFrame(raf);
      if (fullMapRef.current) { fullMapRef.current.remove(); fullMapRef.current = null; }
    };
  }, [isFullscreen, flight?.id, gliderIcon]);

  // Profile pan/zoom changes land here — updates the already-live map(s) in
  // place (camera + reference marker + track segment) instead of rebuilding
  // them, which is what previously exhausted the browser's WebGL context
  // budget during a drag gesture.
  useEffect(() => {
    if (previewReadyRef.current) applyHighlight(previewMapRef.current, previewRefMarkerRef);
    if (isFullscreen && fullReadyRef.current) applyHighlight(fullMapRef.current, fullRefMarkerRef);
  }, [highlightRange?.start, highlightRange?.end, isFullscreen, isPlaying]);

  // Cine playback: moves a dedicated glider marker along the track over
  // time, at playSpeed× real flight time. Works on the preview map too now
  // (not just fullscreen) — showing the map and the height profile at the
  // same time was the whole point, and fullscreen hides the profile.
  // Driven by requestAnimationFrame rather than setInterval so the speed
  // stays smooth and accurate regardless of frame rate hiccups.
  useEffect(() => {
    if (!isPlaying) return;
    if (track.length < 2) return;
    playLastTsRef.current = null;
    const totalSec = track[track.length-1].timeSec - track[0].timeSec;
    const step = (ts) => {
      if (playLastTsRef.current == null) playLastTsRef.current = ts;
      const dtReal = (ts - playLastTsRef.current) / 1000;
      playLastTsRef.current = ts;
      setPlayElapsedSec(prev => {
        const next = prev + dtReal * playSpeed;
        if (next >= totalSec) {
          setIsPlaying(false);
          return totalSec;
        }
        return next;
      });
      playRafRef.current = requestAnimationFrame(step);
    };
    playRafRef.current = requestAnimationFrame(step);
    return () => { if (playRafRef.current) cancelAnimationFrame(playRafRef.current); };
  }, [isPlaying, playSpeed, track.length]);

  // Moves the playback marker to match playElapsedSec whenever it changes
  // (during playback, or when scrubbing manually) — interpolates between
  // the two surrounding track points for smooth sub-sample positioning.
  // Updates the preview map and, if open, the fullscreen map — the person
  // specifically wants to watch the map and the height profile together,
  // which only the (non-fullscreen) preview allows.
  useEffect(() => {
    if (!window.maptilersdk) return;
    if (track.length < 2) return;
    const sdk = window.maptilersdk;

    const targetTime = track[0].timeSec + playElapsedSec;
    let i = 0;
    while (i < track.length-2 && track[i+1].timeSec < targetTime) i++;
    const a = track[i], b = track[i+1] || a;
    const span = (b.timeSec - a.timeSec) || 1;
    const frac = Math.max(0, Math.min(1, (targetTime - a.timeSec) / span));
    const lat = a.lat + (b.lat-a.lat)*frac, lon = a.lon + (b.lon-a.lon)*frac;
    const alt = a.gpsAlt + ((b.gpsAlt||a.gpsAlt) - a.gpsAlt)*frac;
    const spanBack = track[Math.max(0,i-3)], spanFwd = track[Math.min(track.length-1,i+3)];
    const hdg = bearingDeg(spanBack, spanFwd);

    if (onPlaybackPositionChange && cumDist.length) {
      const distKm = (cumDist[i]||0) + ((cumDist[i+1]||cumDist[i]||0) - (cumDist[i]||0)) * frac;
      onPlaybackPositionChange(distKm);
    }

    const placeOn = (map, ref, showAlt) => {
      if (!map) return;
      if (!ref.current) {
        const el = document.createElement("div");
        el.style.cssText = `position:relative;width:34px;height:34px;filter:drop-shadow(0 1px 4px rgba(0,0,0,0.7));display:flex;align-items:center;justify-content:center;`;
        let img = null;
        if (gliderIcon.type === "image") {
          img = document.createElement("img");
          img.src = gliderIcon.value;
          img.style.cssText = `width:100%;height:100%;object-fit:contain;`;
          el.appendChild(img);
        } else {
          el.style.fontSize = "26px";
          el.textContent = gliderIcon.value;
        }
        if (showAlt) {
          const altEl = document.createElement("span");
          altEl.style.cssText = `position:absolute;left:calc(100% + 4px);top:50%;transform:translateY(-50%);color:#dc2626;font:800 13px system-ui,sans-serif;white-space:nowrap;`;
          el.appendChild(altEl);
          ref._altEl = altEl;
        } else {
          ref._altEl = null;
        }
        const marker = new sdk.Marker({ element: el, rotationAlignment: "viewport", pitchAlignment: "viewport" }).setLngLat([lon, lat]).addTo(map);
        ref.current = marker;
        ref.current._imgEl = img;
        ref.current._altEl = ref._altEl;
      } else {
        ref.current.setLngLat([lon, lat]);
      }
      if (ref.current._imgEl) ref.current._imgEl.style.transform = `rotate(${hdg}deg)`;
      if (ref.current._altEl) ref.current._altEl.textContent = (alt!=null ? Math.round(alt) : "")+"m";
      // Follow while zoomed to a segment: once the marker leaves the
      // currently visible area, jump (same zoom level, so same-size view —
      // not a smooth pan) to a fresh view recentred on it.
      if (highlightRange && isPlaying && map.getBounds && !map.getBounds().contains([lon, lat])) {
        map.jumpTo({ center: [lon, lat], zoom: map.getZoom() });
      }
    };
    if (previewReadyRef.current) placeOn(previewMapRef.current, previewPlayMarkerRef, false);
    if (isFullscreen && fullReadyRef.current) placeOn(fullMapRef.current, playMarkerRef, true);
  }, [playElapsedSec, isFullscreen]);

  // Cleans up the fullscreen-specific playback marker whenever fullscreen
  // closes (playback itself keeps going — it's shared with the preview
  // now, not fullscreen-only), and resets everything when the flight
  // changes so a stale marker never lingers into the next map instance.
  useEffect(() => {
    if (!isFullscreen && playMarkerRef.current) { playMarkerRef.current.remove(); playMarkerRef.current = null; }
  }, [isFullscreen]);
  useEffect(() => {
    setIsPlaying(false);
    setPlayElapsedSec(0);
    if (playMarkerRef.current) { playMarkerRef.current.remove(); playMarkerRef.current = null; }
    if (previewPlayMarkerRef.current) { previewPlayMarkerRef.current.remove(); previewPlayMarkerRef.current = null; }
    if (onPlaybackPositionChange) onPlaybackPositionChange(null);
  }, [flight?.id]);


  return (
    <>
      <div style={{position:"relative"}} onClick={()=>{ if (hasMap) setIsFullscreen(true); }}>
        <div ref={previewDivRef} style={{width:"100%",aspectRatio:"3/2",background:"#040e20",borderRadius:10,overflow:"hidden",cursor:hasMap?"pointer":"default"}} />
        {hasMap && !mapTilerKey && (
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,background:"rgba(4,14,32,0.92)",color:"rgba(232,244,253,0.6)",fontSize:12,textAlign:"center",padding:16}}>
            <div style={{fontSize:22}}>🗺️</div>
            <div>Kein MapTiler-Schlüssel hinterlegt.</div>
            <a href="service.html" onClick={e=>e.stopPropagation()} style={{color:"#7dd3fc",fontSize:11}}>→ Unter Service eintragen</a>
          </div>
        )}
      </div>
      {controlsSlot && hasMap && ReactDOM.createPortal(
        <>
          {flight?.track?.length > 1 && (
            <>
              <button onClick={togglePlay}
                title={isPlaying?"Pause":"Abspielen"}
                style={{flex:"1 1 0",minWidth:0,height:34,boxSizing:"border-box",background:isPlaying?"#dc2626":"#16a34a",border:"none",borderRadius:8,color:"#fff",fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:3}}>
                {isPlaying ? "⏸" : "▶"}
              </button>
              <div style={{position:"relative",flex:"1 1 0",minWidth:0}} onClick={e=>e.stopPropagation()}>
                <button onClick={()=>setPlayPickerOpen(o=>!o)}
                  style={{width:"100%",height:34,boxSizing:"border-box",background:"#1e40af",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:800,cursor:"pointer"}}>
                  {playSpeed}×▾
                </button>
                {playPickerOpen && (
                  <div onClick={e=>{e.stopPropagation();setPlayPickerOpen(false);}}
                    style={{position:"absolute",bottom:"calc(100% + 4px)",left:0,background:"#14253a",border:"1px solid rgba(255,255,255,0.15)",borderRadius:10,padding:4,boxShadow:"0 8px 24px rgba(0,0,0,0.5)",display:"flex",flexDirection:"column",gap:2,minWidth:56,zIndex:10}}>
                    {[1,2,5,10,20,50,100].map(sp=>(
                      <button key={sp} onClick={()=>{setPlaySpeed(sp);setPlayPickerOpen(false);}}
                        style={{background:sp===playSpeed?"rgba(125,211,252,0.2)":"transparent",border:"none",borderRadius:6,padding:"5px 8px",color:sp===playSpeed?"#7dd3fc":"#e8f4fd",fontSize:12,fontWeight:sp===playSpeed?700:400,cursor:"pointer",textAlign:"left"}}>
                        {sp}×
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Right next to Speed now (not at the row's end).
                  Colour-coded to match its own button (same green as
                  Play) instead of text labels — same idea as Zoom↺
                  matching the Zoom tile's colour below. */}
              {playElapsedSec > 0 && (
                <button onClick={()=>{setIsPlaying(false);setPlayElapsedSec(0);}}
                  title="Zurück zum Start"
                  style={{flex:"1 1 0",minWidth:0,height:34,boxSizing:"border-box",background:"rgba(22,163,74,0.18)",border:"1px solid rgba(22,163,74,0.4)",borderRadius:8,color:"#4ade80",fontSize:16,cursor:"pointer"}}>
                  ↺
                </button>
              )}
            </>
          )}
        </>,
        controlsSlot
      )}
      {isFullscreen && (
        <div
          style={{position:"fixed",inset:0,background:"#000",zIndex:200,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",overflow:"hidden"}}
        >
          <div ref={fullDivRef} style={{width:"100%",height:"70vh"}} />
          {flight?.track?.length > 1 && (
            <div style={{position:"absolute",bottom:"calc(15vh + 10px)",right:14,display:"flex",gap:6,alignItems:"center"}}>
              <button onClick={togglePlay}
                title={isPlaying?"Pause":"Abspielen"}
                style={{background:isPlaying?"#dc2626":"#16a34a",border:"none",borderRadius:20,width:40,height:40,color:"#fff",fontSize:17,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:0,boxShadow:"0 2px 10px rgba(0,0,0,0.5)"}}>
                {isPlaying ? "⏸" : "▶"}
              </button>
              <div style={{position:"relative"}}>
                <button onClick={()=>setPlayPickerOpen(o=>!o)}
                  style={{background:"#1e40af",border:"none",borderRadius:20,padding:"9px 14px",color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",boxShadow:"0 2px 10px rgba(0,0,0,0.5)"}}>
                  {playSpeed}× ▾
                </button>
                {playPickerOpen && (
                  <div onClick={()=>setPlayPickerOpen(false)}
                    style={{position:"absolute",bottom:"calc(100% + 4px)",right:0,background:"#14253a",border:"1px solid rgba(255,255,255,0.15)",borderRadius:10,padding:4,boxShadow:"0 8px 24px rgba(0,0,0,0.5)",display:"flex",flexDirection:"column",gap:2,minWidth:64}}>
                    {[1,2,5,10,20,50,100].map(sp=>(
                      <button key={sp} onClick={()=>{setPlaySpeed(sp);setPlayPickerOpen(false);}}
                        style={{background:sp===playSpeed?"rgba(125,211,252,0.2)":"transparent",border:"none",borderRadius:6,padding:"6px 10px",color:sp===playSpeed?"#7dd3fc":"#e8f4fd",fontSize:13,fontWeight:sp===playSpeed?700:400,cursor:"pointer",textAlign:"left"}}>
                        {sp}×
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {playElapsedSec > 0 && (
                <button onClick={()=>{setIsPlaying(false);setPlayElapsedSec(0);}}
                  title="Zurück zum Start"
                  style={{background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.3)",borderRadius:20,width:40,height:40,color:"#fff",fontSize:15,cursor:"pointer",boxShadow:"0 2px 10px rgba(0,0,0,0.5)"}}>
                  ↺
                </button>
              )}
            </div>
          )}
          <button onClick={()=>setIsFullscreen(false)}
            style={{position:"absolute",top:"calc(env(safe-area-inset-top, 0px) + 10px)",right:14,background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:20,width:32,height:32,color:"#fff",fontSize:16,cursor:"pointer"}}>
            ✕
          </button>
        </div>
      )}
    </>
  );
}

// ── FlightProfile ────────────────────────────────────────────────────────
// Altitude-over-distance chart: the flight trace itself (colour-coded by
// altitude, same red→blue scale as the map) plus a brown ground/terrain
// profile drawn underneath it, sourced from Open-Meteo's free Elevation API
// (open-meteo.com/en/docs/elevation-api — no key needed, CORS-enabled,
// worldwide 90m-resolution DEM, explicitly suited to exactly this: getting
// height-above-ground for a track). Only ~80 evenly distance-spaced points
// are sent (one batched request) rather than the whole track, since terrain
// doesn't need 1-second resolution to look right and Open-Meteo caps
// batches at 100 coordinates anyway.
function FlightProfile({ flight, onPositionChange, playbackDistanceKm, isPlaybackActive, controlsSlot, isWide }) {
  const canvasRef = useRef(null);
  const [groundProfile, setGroundProfile] = useState(null);
  const [groundError, setGroundError] = useState(false);
  // Stepped zoom (1-8) replaces the earlier pinch-gesture zoom, which kept
  // conflicting with the page's own swipe-between-flights gesture no matter
  // how it was tuned. panPos (0-1) is a separate slider for where the
  // zoomed window sits along the flight — 0.5 (default) centres it, 0 pins
  // it to the start, 1 to the end.
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panPos, setPanPos] = useState(0.5);
  const [zoomPickerOpen, setZoomPickerOpen] = useState(false);
  const viewScale = zoomLevel;
  // panPos (0-1) is the window's CENTRE position across the whole flight —
  // 0 puts the centre exactly at the start, 1 exactly at landing. This is
  // deliberately NOT clamped to keep the whole window inside [0,1]: doing
  // that meant the centre (and the map's reference marker, which tracks
  // this same point) could never get closer than half a window-width from
  // either end. Left unclamped, the window can extend past the actual
  // flown distance at one edge when centred near start/landing — nothing
  // draws there since the track has no points beyond [0, totalDist]
  // anyway, so it just reads as empty space rather than an error.
  const viewStart = panPos - (1/viewScale)/2;
  const track = flight?.track || [];

  const rawDistances = useMemo(() => {
    if (!track.length) return [];
    const d = [0];
    for (let i = 1; i < track.length; i++) {
      d.push(d[i-1] + (haversineDistKm(track[i-1], track[i]) || 0));
    }
    return d;
  }, [track]);
  const rawTotalDist = rawDistances[rawDistances.length-1] || 0;
  // The manually-entered Distanz field is the number the person actually
  // trusts (their real XContest score, typed in by hand) — rather than
  // trying to approximate that algorithm in-browser, the whole distance
  // axis is proportionally rescaled so it lands exactly on that value,
  // while keeping the flown path's shape (relative proportions between
  // points) intact. Falls back to the raw flown distance, unscaled, if no
  // manual value has been entered for this flight.
  const manualDist = parseFloat(getDisplayDistance(flight)) || 0;
  const scale = (manualDist > 0 && rawTotalDist > 0) ? manualDist/rawTotalDist : 1;
  const distances = useMemo(() => rawDistances.map(d => d*scale), [rawDistances, scale]);
  const totalDist = distances[distances.length-1] || 0;
  // FlightMap reports playbackDistanceKm on the RAW (unscaled, actually
  // flown) distance basis — same as rawDistances above — since it's
  // computed straight from the GPS track, independent of any manually
  // entered Distanz. Everywhere below that positions the cursor against
  // this component's own (possibly rescaled) distances[]/totalDist needs
  // the SAME scale factor applied first, or the cursor drifts out of sync
  // with the map's marker whenever scale != 1 (i.e. whenever the manual
  // Distanz differs from the raw GPS distance — the normal case): it was
  // reaching the end of the profile's distance axis at the wrong wall-clock
  // moment, effectively running faster or slower than the map.
  const playbackDistanceScaled = playbackDistanceKm != null ? playbackDistanceKm * scale : null;

  // Cine-playback follow: while zoomed in, once the glider's position
  // leaves the currently visible window, jump (not smooth-scroll) to a
  // same-size window that starts right at the glider — "gleichgrosser
  // Kartenausschnitt weiterspringend", matching the map's own jump-to-
  // follow behaviour.
  useEffect(() => {
    if (!isPlaybackActive || playbackDistanceScaled == null || zoomLevel <= 1 || !totalDist) return;
    const windowFrac = 1/zoomLevel;
    const curStart = viewStart;
    const curEnd = viewStart + windowFrac;
    const posFrac = playbackDistanceScaled / totalDist;
    if (posFrac < curStart || posFrac > curEnd) {
      setPanPos(Math.max(0, Math.min(1, posFrac + windowFrac/2)));
    }
  }, [playbackDistanceScaled, isPlaybackActive, zoomLevel, totalDist]);

  useEffect(() => { setZoomLevel(1); setPanPos(0.5); }, [flight?.id]);
  useEffect(() => {
    profileZoomActive = zoomLevel > 1;
    return () => { profileZoomActive = false; };
  }, [zoomLevel]);

  // Tells the map above what part of the flight (in the flight's own,
  // unscaled distance units — the manual-Distanz proportional rescale only
  // affects the axis display here, not the underlying track) the current
  // zoomed excerpt covers, so it can zoom to match and drop a marker at its
  // centre. Only while actually zoomed in; at 1× there's no excerpt to
  // match, so the map goes back to showing the whole flight.
  useEffect(() => {
    if (!onPositionChange) return;
    if (zoomLevel <= 1 || !totalDist) { onPositionChange(null); return; }
    const visStart = viewStart * totalDist;
    const visEnd = visStart + totalDist/viewScale;
    const overallCenter = (visStart+visEnd)/2;
    // FlightMap's own segment/refPoint computation walks its track in RAW
    // (unscaled) km, so the window reported here must be converted back
    // from this chart's scaled axis before being passed up.
    const toRaw = d => scale > 0 ? Math.max(0, d) / scale : Math.max(0, d);
    onPositionChange({ start: toRaw(visStart), end: toRaw(visEnd), center: toRaw(overallCenter) });
  }, [zoomLevel, viewStart, viewScale, totalDist, scale]);

  // Swipe-to-pan directly on the chart, active only while zoomed (>1×) —
  // the page-level swipe-between-flights gesture is already fully disabled
  // during this time via profileZoomActive, so this can freely claim any
  // horizontal drag without the two competing. zoomLevelRef/panPosRef avoid
  // reading stale values from the closure captured when the effect last
  // bound its listeners.
  const zoomLevelRef = useRef(zoomLevel);
  const panPosRef = useRef(panPos);
  useEffect(() => { zoomLevelRef.current = zoomLevel; }, [zoomLevel]);
  useEffect(() => { panPosRef.current = panPos; }, [panPos]);
  const panGestureRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onTouchStart = (e) => {
      if (zoomLevelRef.current <= 1 || e.touches.length !== 1) return;
      e.preventDefault(); e.stopPropagation();
      panGestureRef.current = { startX: e.touches[0].clientX, startPan: panPosRef.current };
    };
    const onTouchMove = (e) => {
      const g = panGestureRef.current;
      if (!g || zoomLevelRef.current <= 1) return;
      e.preventDefault(); e.stopPropagation();
      const dx = e.touches[0].clientX - g.startX;
      // How far a full-width drag should shift panPos (0-1) depends on how
      // zoomed in we are — at higher zoom the same pixel drag should cover
      // proportionally less of the flight, matching what's on screen.
      const fracDelta = -dx / canvas.clientWidth / zoomLevelRef.current * 2;
      setPanPos(Math.min(1, Math.max(0, g.startPan + fracDelta)));
    };
    const onTouchEnd = () => { panGestureRef.current = null; };
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);

    // Mouse equivalent (Mac/desktop: no touch events at all). mousemove/up
    // are attached to window rather than the canvas so a fast drag that
    // briefly leaves the canvas bounds doesn't get stuck.
    const onMouseDown = (e) => {
      if (zoomLevelRef.current <= 1) return;
      e.preventDefault();
      panGestureRef.current = { startX: e.clientX, startPan: panPosRef.current };
    };
    const onMouseMove = (e) => {
      const g = panGestureRef.current;
      if (!g || zoomLevelRef.current <= 1) return;
      e.preventDefault();
      const dx = e.clientX - g.startX;
      const fracDelta = -dx / canvas.clientWidth / zoomLevelRef.current * 2;
      setPanPos(Math.min(1, Math.max(0, g.startPan + fracDelta)));
    };
    const onMouseUp = () => { panGestureRef.current = null; };
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.style.cursor = "grab";

    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);


  useEffect(() => {
    setGroundProfile(null);
    setGroundError(false);
    if (!track.length || totalDist <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        // 80 sample points across the flown distance, fetched from the
        // external terrain API — a paraglider's own altitude genuinely
        // isn't ground level, so this can't be derived from the track's
        // own data.
        const N = 80;
        const samplePts = [];
        let idx = 0;
        for (let i = 0; i <= N && track.length > 1; i++) {
          const targetDist = (rawTotalDist / N) * i;
          while (idx < rawDistances.length-1 && rawDistances[idx] < targetDist) idx++;
          samplePts.push({ lat: track[idx].lat, lon: track[idx].lon, distKm: distances[idx], ownElev: track[idx].gpsAlt });
        }

        if (!samplePts.length) return;
        const lats = samplePts.map(s=>s.lat.toFixed(5)).join(",");
        const lons = samplePts.map(s=>s.lon.toFixed(5)).join(",");
        const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
        // The free open-meteo tier explicitly carries no uptime guarantee
        // — a single transient failure/timeout shouldn't immediately show
        // "nicht erreichbar" to the person, so one retry is attempted
        // after a short pause before actually giving up.
        const fetchElevations = async () => {
          const res = await fetch(url);
          const data = await res.json();
          if (!Array.isArray(data.elevation)) throw new Error("unexpected response shape");
          return data.elevation;
        };
        let elevation;
        try {
          elevation = await fetchElevations();
        } catch (firstErr) {
          await new Promise(r => setTimeout(r, 1200));
          if (cancelled) return;
          elevation = await fetchElevations();
        }
        if (cancelled) return;
        // Never let the ground appear above the flight trace: a 90m-
        // resolution terrain model can occasionally overshoot near a
        // ridge or narrow valley the aircraft actually cleared, which
        // would otherwise draw as physically flying through the ground.
        const flightGroundPts = samplePts.map((s,i) => ({
          distKm: s.distKm,
          elev: elevation[i] != null ? Math.min(elevation[i], s.ownElev - 5) : null,
        }));
        setGroundProfile(flightGroundPts);
      } catch {
        if (cancelled) return;
        setGroundError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [flight?.id, totalDist]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !track.length) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);

    const padL = 42*dpr, padR = 8*dpr, padT = 10*dpr, padB = 34*dpr;
    const plotW = Math.max(1, W-padL-padR), plotH = Math.max(1, H-padT-padB);

    const visStart = viewStart * totalDist;
    const visEnd = visStart + totalDist/viewScale;
    // Clamped versions purely for the axis label text — the underlying
    // visStart/visEnd stay unclamped so the window's centre (and scale)
    // stay accurate even when it extends past the real start/landing.
    const visStartLabel = Math.max(0, visStart);
    const visEndLabel = Math.min(totalDist, visEnd);

    // Altitude range comes from every point actually inside the visible
    // window — zooming into a segment re-scales the legend to that
    // segment's own min/max instead of staying pinned to the whole range.
    const visibleAlts = [];
    for (let i=0;i<track.length;i++) if (distances[i]>=visStart && distances[i]<=visEnd) visibleAlts.push(track[i].gpsAlt);
    if (!visibleAlts.length && track.length) visibleAlts.push(track[0].gpsAlt, track[track.length-1].gpsAlt);
    let minA = Math.min(...visibleAlts), maxA = Math.max(...visibleAlts);
    if (groundProfile) {
      const gv = groundProfile.filter(g=>g.distKm>=visStart && g.distKm<=visEnd).map(g=>g.elev).filter(v=>v!=null);
      if (gv.length) minA = Math.min(minA, ...gv);
    }
    maxA = Math.max(maxA, minA+1);
    const altRange = maxA-minA || 1;
    const span = (visEnd-visStart) || 1;
    const xPos = d => padL + ((d-visStart)/span)*plotW;
    const yPos = alt => padT + plotH - ((alt-minA)/altRange)*plotH;

    ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.lineWidth = 1*dpr;
    ctx.beginPath(); ctx.moveTo(padL,padT); ctx.lineTo(padL,padT+plotH); ctx.lineTo(padL+plotW,padT+plotH); ctx.stroke();

    ctx.fillStyle = "rgba(232,244,253,0.5)"; ctx.font = `${10*dpr}px system-ui,sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(Math.round(maxA)+"m", padL-4*dpr, padT+9*dpr);
    ctx.fillText(Math.round(minA)+"m", padL-4*dpr, padT+plotH);
    ctx.textAlign = "left"; ctx.fillText(visStartLabel.toFixed(1)+" km", padL, padT+plotH+15*dpr);
    ctx.textAlign = "right"; ctx.fillText(visEndLabel.toFixed(1)+" km", padL+plotW, padT+plotH+15*dpr);
    if (viewScale > 1.02) {
      ctx.textAlign = "center"; ctx.fillText(`${viewScale.toFixed(1)}×`, padL+plotW/2, padT+9*dpr);
      ctx.save();
      ctx.setLineDash([4*dpr, 4*dpr]);
      ctx.strokeStyle = "rgba(220,38,38,0.7)"; ctx.lineWidth = 1*dpr;
      ctx.beginPath();
      ctx.moveTo(padL+plotW/2, padT);
      ctx.lineTo(padL+plotW/2, padT+plotH);
      ctx.stroke();
      ctx.restore();
    }

    // Altitude where the track crosses the centre of the visible window —
    // same point the map's red reference marker sits at — shown on the
    // Y-axis alongside the min/max labels, positioned at its own height.
    // While cine playback is actively running, this follows the moving
    // marker instead, so the red label always matches whichever marker is
    // actually visible on the map right now. Shown at every zoom level,
    // including the overview (1×) — not just once actually zoomed in.
    const centerDist = (isPlaybackActive && playbackDistanceScaled != null) ? playbackDistanceScaled : (visStart+visEnd)/2;
    let centerAlt = null, centerLabel = "";
    if (distances.length) {
      let ci = 0, cd = Infinity;
      for (let i=0;i<distances.length;i++) { const diff = Math.abs(distances[i]-centerDist); if (diff<cd) { cd=diff; ci=i; } }
      centerAlt = track[ci]?.gpsAlt;
      const utcStartSec = track[0]?.timeSec, rawTime = track[ci]?.timeSec;
      if (rawTime != null && utcStartSec != null) {
        const elapsedSec = Math.max(0, rawTime - utcStartSec);
        const hh = String(Math.floor(elapsedSec/3600)).padStart(2,"0");
        const mm = String(Math.floor((elapsedSec%3600)/60)).padStart(2,"0");
        const flightKm = centerDist/(scale||1);
        centerLabel = `${hh}:${mm}/${flightKm.toFixed(1)}km`;
      }
    }
    if (centerAlt != null) {
      const cy = Math.max(padT+9*dpr, Math.min(padT+plotH, yPos(centerAlt)));
      ctx.fillStyle = "#dc2626"; ctx.font = `bold ${10*dpr}px system-ui,sans-serif`;
      ctx.textAlign = "right";
      ctx.fillText(Math.round(centerAlt)+"m", padL-4*dpr, cy);
    }
    if (centerLabel) {
      ctx.fillStyle = "#dc2626"; ctx.font = `bold ${10*dpr}px system-ui,sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(centerLabel, padL+plotW/2, padT+plotH+29*dpr);
    }

    if (playbackDistanceScaled != null) {
      if (playbackDistanceScaled >= visStart && playbackDistanceScaled <= visEnd) {
        const px = xPos(playbackDistanceScaled);
        ctx.save();
        ctx.strokeStyle = "#4ade80"; ctx.lineWidth = 2*dpr;
        ctx.beginPath();
        ctx.moveTo(px, padT);
        ctx.lineTo(px, padT+plotH);
        ctx.stroke();
        ctx.fillStyle = "#4ade80";
        ctx.beginPath();
        ctx.arc(px, padT+plotH, 4*dpr, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
      }
    }

    if (groundProfile && groundProfile.length) {
      // Only the points inside (plus one just outside on each side, so the
      // fill/line doesn't visibly stop short at the window edge) the
      // current zoom window — including every sample across the whole
      // combined range here, even ones far outside what's visible, was
      // mapping those to wildly off-canvas x-coordinates and back, which
      // is what produced the zigzag distortion when zoomed in.
      const visibleGround = [];
      for (let i=0;i<groundProfile.length;i++) {
        const g = groundProfile[i];
        const inRange = g.distKm >= visStart && g.distKm <= visEnd;
        const prevOut = i>0 && groundProfile[i-1].distKm < visStart;
        const nextOut = i<groundProfile.length-1 && groundProfile[i+1].distKm > visEnd;
        if (inRange || (prevOut && g.distKm < visStart) || (nextOut && g.distKm > visEnd)) visibleGround.push(g);
      }
      // Margin points (the one just outside the window on each side) exist
      // purely so the line's slope into the edge is right — their actual
      // x position can fall outside the plot area, which used to let the
      // ground line/fill visibly overshoot past the axis on that side
      // (the track never had this problem since it has no such margin
      // points). Clamping to the plot bounds here keeps the edge slope
      // correct while never drawing past the axis.
      const clampX = x => Math.max(padL, Math.min(padL+plotW, x));
      const firstElev = visibleGround.find(g=>g.elev!=null)?.elev;
      const lastElev = [...visibleGround].reverse().find(g=>g.elev!=null)?.elev;
      ctx.beginPath();
      ctx.moveTo(xPos(visStart), firstElev!=null ? yPos(firstElev) : padT+plotH);
      visibleGround.forEach(g => { if (g.elev!=null) ctx.lineTo(clampX(xPos(g.distKm)), yPos(g.elev)); });
      if (lastElev!=null) ctx.lineTo(xPos(visEnd), yPos(lastElev));
      ctx.lineTo(xPos(visEnd), padT+plotH);
      ctx.lineTo(xPos(visStart), padT+plotH);
      ctx.closePath();
      ctx.fillStyle = "rgba(120,72,32,0.55)"; ctx.fill();
      ctx.strokeStyle = "rgba(150,95,45,0.9)"; ctx.lineWidth = 1.5*dpr;
      ctx.beginPath();
      let started = false;
      visibleGround.forEach((g) => { if (g.elev!=null) { const px=clampX(xPos(g.distKm)), py=yPos(g.elev); if(!started){ctx.moveTo(px,py);started=true;} else ctx.lineTo(px,py); } });
      ctx.stroke();
    }

    // Flight segment — height-colour-coded line (red=low, blue=high).
    for (let i=1;i<track.length;i++) {
      if (distances[i] < visStart && distances[i-1] < visStart) continue;
      if (distances[i-1] > visEnd && distances[i] > visEnd) continue;
      const t = (track[i].gpsAlt-minA)/altRange;
      ctx.strokeStyle = `hsl(${t*240},100%,50%)`; ctx.lineWidth = 2.5*dpr;
      ctx.beginPath();
      ctx.moveTo(xPos(distances[i-1]), yPos(track[i-1].gpsAlt));
      ctx.lineTo(xPos(distances[i]), yPos(track[i].gpsAlt));
      ctx.stroke();
    }
  }, [track, distances, totalDist, groundProfile, viewStart, viewScale, playbackDistanceScaled, isPlaybackActive]);

  if (!track.length) return null;

  return (
    <div style={{marginBottom:14}}>
      <div style={{marginBottom:6}}>
        <div style={{fontSize:10,fontWeight:700,color:"#7dd3fc",letterSpacing:1.5,textTransform:"uppercase"}}>Höhenprofil</div>
      </div>
      <div style={{borderRadius:14,overflow:"hidden",border:"1px solid rgba(100,180,255,0.12)",background:"#040e20"}}>
        <canvas ref={canvasRef} style={{width:"100%",height:160,display:"block",touchAction:zoomLevel>1?"none":"auto"}} />
      </div>
      {controlsSlot && ReactDOM.createPortal(
        <>
          <div style={{position:"relative",flex:"1 1 0",minWidth:0}}>
            <button onClick={()=>setZoomPickerOpen(o=>!o)}
              style={{width:"100%",height:34,boxSizing:"border-box",background:"rgba(220,38,38,0.18)",border:"1px solid rgba(220,38,38,0.4)",borderRadius:8,color:"#f87171",fontSize:12,fontWeight:700,cursor:"pointer"}}>
              🔍{zoomLevel}×▾
            </button>
            {zoomPickerOpen && (
              <>
                <div onClick={()=>setZoomPickerOpen(false)} style={{position:"fixed",inset:0,zIndex:249}} />
                <div onClick={e=>e.stopPropagation()}
                  style={{position:"absolute",bottom:"calc(100% + 4px)",left:0,background:"#14253a",border:"1px solid rgba(255,255,255,0.15)",borderRadius:10,padding:4,boxShadow:"0 8px 24px rgba(0,0,0,0.5)",display:"flex",flexDirection:"column",gap:2,minWidth:70,zIndex:250}}>
                  {[1,2,3,4,5,6,7,8].map(z=>(
                    <button key={z} onClick={()=>{setZoomLevel(z);setPanPos(0);setZoomPickerOpen(false);}}
                      style={{background:z===zoomLevel?"rgba(125,211,252,0.2)":"transparent",border:"none",borderRadius:6,padding:"6px 10px",color:z===zoomLevel?"#7dd3fc":"#e8f4fd",fontSize:13,fontWeight:z===zoomLevel?700:400,cursor:"pointer",textAlign:"left"}}>
                      {z}×
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {/* Only added (widening every other tile slightly) once actually
              zoomed in — colour-coded to match the Zoom tile (both red)
              instead of a text label, same idea as Play↺'s green match. */}
          {zoomLevel > 1 && (
            <button onClick={()=>setZoomLevel(1)} title="Zoom zurücksetzen"
              style={{flex:"1 1 0",minWidth:0,height:34,boxSizing:"border-box",background:"rgba(220,38,38,0.18)",border:"1px solid rgba(220,38,38,0.4)",borderRadius:8,color:"#f87171",fontSize:16,cursor:"pointer"}}>
              ↺
            </button>
          )}
        </>,
        controlsSlot
      )}
      {groundError && <div style={{fontSize:10,color:"rgba(232,244,253,0.35)",marginTop:4}}>Bodenprofil für den Flug-Teil momentan nicht verfügbar (Höhendaten-Dienst nicht erreichbar) — Trace wird trotzdem angezeigt.</div>}
      {manualDist>0 && <div style={{fontSize:9,color:"rgba(232,244,253,0.3)",marginTop:4}}>Streckenachse proportional auf die eingetragene Distanz ({manualDist} km) skaliert.</div>}
      {zoomLevel>1 && <div style={{fontSize:9,color:"rgba(232,244,253,0.3)",marginTop:2}}>Im Profil wischen, um den sichtbaren Ausschnitt zu verschieben.</div>}
    </div>
  );
}

// ── Custom field formulas ──────────────────────────────────────────────────
const FORMULA_DEFS = [
  { id:"rank_dur",  label:"Rang Flugzeit",   icon:"⏱", desc:"#1 = längster Flug" },
  { id:"rank_dist", label:"Rang Distanz",    icon:"📏", desc:"#1 = weitester Flug" },
  { id:"rank_alt",  label:"Rang Höhe",       icon:"⬆", desc:"#1 = höchster Flug" },
  { id:"pr_dur",    label:"Persönl. Rekord Dauer",  icon:"🏆", desc:"Ja / Nein" },
  { id:"pr_dist",   label:"Persönl. Rekord Distanz",icon:"🏆", desc:"Ja / Nein" },
  { id:"pr_alt",    label:"Persönl. Rekord Höhe",   icon:"🏆", desc:"Ja / Nein" },
  { id:"season_flights", label:"Saison-Flüge",  icon:"📅", desc:"Anzahl Flüge im Jahr" },
  { id:"season_hours",   label:"Saison-Stunden",icon:"⏱", desc:"Total Stunden im Jahr" },
];

function evalFormula(id, flight, allFlights) {
  const sorted = (key) => [...allFlights].sort((a,b)=>b[key]-a[k]);
  const yf = allFlights.filter(f=>f.year===flight.year);
  switch(id) {
    case "rank_dur":  return "#"+([...allFlights].sort((a,b)=>b.durationSec-a.durationSec).findIndex(f=>f.id===flight.id)+1);
    case "rank_dist": return "#"+([...allFlights].sort((a,b)=>b.totalDist-a.totalDist).findIndex(f=>f.id===flight.id)+1);
    case "rank_alt":  return "#"+([...allFlights].sort((a,b)=>b.maxAlt-a.maxAlt).findIndex(f=>f.id===flight.id)+1);
    case "pr_dur":    return flight.durationSec>=Math.max(...allFlights.map(f=>f.durationSec))?"🏆 Ja":"Nein";
    case "pr_dist":   return flight.totalDist>=Math.max(...allFlights.map(f=>f.totalDist))?"🏆 Ja":"Nein";
    case "pr_alt":    return flight.maxAlt>=Math.max(...allFlights.map(f=>f.maxAlt))?"🏆 Ja":"Nein";
    case "season_flights": return yf.length;
    case "season_hours": { const s=yf.reduce((a,f)=>a+f.durationSec,0); return `${Math.floor(s/3600)}h${String(Math.floor((s%3600)/60)).padStart(2,"0")}m`; }
    default: return "—";
  }
}

// ── FieldEditor ────────────────────────────────────────────────────────────
function FieldEditor({ customFieldDefs, onSave, onClose }) {
  const [defs, setDefs] = useState(customFieldDefs);
  const add = (type) => setDefs(d=>[...d,{id:`cf_${Date.now()}`,name:"",type,formula:""}]);
  const update = (id,key,val) => setDefs(d=>d.map(f=>f.id===id?{...f,[key]:val}:f));
  const remove = (id) => setDefs(d=>d.filter(f=>f.id!==id));
  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.7)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#0f2033",borderRadius:20,padding:20,width:"100%",maxWidth:420,maxHeight:"80vh",overflowY:"auto",border:"1px solid rgba(100,180,255,0.15)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <span style={{fontWeight:800,fontSize:16}}>Eigene Felder</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#7dd3fc",fontSize:20,cursor:"pointer"}}>✕</button>
        </div>
        {defs.map(f=>(
          <div key={f.id} style={{background:"rgba(255,255,255,0.05)",borderRadius:12,padding:12,marginBottom:8}}>
            {f.formula ? (
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:13}}>{FORMULA_DEFS.find(d=>d.id===f.formula)?.icon} {f.name}</span>
                <button onClick={()=>remove(f.id)} style={{background:"none",border:"none",color:"#f87171",cursor:"pointer"}}>✕</button>
              </div>
            ) : (
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <input value={f.name} onChange={e=>update(f.id,"name",e.target.value)} placeholder="Feldname"
                  style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"6px 10px",color:"#e8f4fd",fontSize:13}} />
                <select value={f.type} onChange={e=>update(f.id,"type",e.target.value)}
                  style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"6px 8px",color:"#e8f4fd",fontSize:12}}>
                  <option value="text">Text</option><option value="number">Zahl</option><option value="date">Datum</option>
                </select>
                <button onClick={()=>remove(f.id)} style={{background:"none",border:"none",color:"#f87171",cursor:"pointer"}}>✕</button>
              </div>
            )}
          </div>
        ))}
        <div style={{marginTop:12,marginBottom:12}}>
          <div style={{fontSize:11,color:"rgba(232,244,253,0.4)",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>Manuell hinzufügen</div>
          <div style={{display:"flex",gap:8}}>
            {["text","number","date"].map(t=>(
              <button key={t} onClick={()=>add(t)} style={{flex:1,background:"rgba(100,180,255,0.1)",border:"1px solid rgba(100,180,255,0.2)",borderRadius:10,padding:"8px 4px",color:"#7dd3fc",fontSize:12,cursor:"pointer"}}>
                + {t==="text"?"Text":t==="number"?"Zahl":"Datum"}
              </button>
            ))}
          </div>
        </div>
        <div style={{fontSize:11,color:"rgba(232,244,253,0.4)",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>Auto-Formeln</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:16}}>
          {FORMULA_DEFS.filter(fd=>!defs.find(d=>d.formula===fd.id)).map(fd=>(
            <button key={fd.id} onClick={()=>setDefs(d=>[...d,{id:`auto_${fd.id}`,name:fd.label,type:"auto",formula:fd.id}])}
              style={{background:"rgba(139,92,246,0.12)",border:"1px solid rgba(139,92,246,0.25)",borderRadius:20,padding:"5px 10px",color:"#c4b5fd",fontSize:11,cursor:"pointer"}}>
              {fd.icon} {fd.label}
            </button>
          ))}
        </div>
        <button onClick={()=>onSave(defs)} style={{width:"100%",background:"linear-gradient(135deg,#0ea5e9,#0284c7)",border:"none",borderRadius:12,padding:12,color:"#fff",fontWeight:700,cursor:"pointer",fontSize:14}}>
          Speichern
        </button>
      </div>
    </div>
  );
}

// ── Season Dashboard ────────────────────────────────────────────────────────
// ── Main App ───────────────────────────────────────────────────────────────
function lv03ToWgs84(e, n) {
  const y = (e - 600000) / 1000000, x = (n - 200000) / 1000000;
  let lon = 2.6779094 + 4.728982*y + 0.791484*y*x + 0.1306*y*x*x - 0.0436*y*y*y;
  let lat = 16.9023892 + 3.238272*x - 0.270978*y*y - 0.002528*x*x - 0.0447*y*y*x - 0.0140*x*x*x;
  return { lat: lat*100/36, lon: lon*100/36 };
}
function wgs84ToLv03(lat, lon) {
  const latP = (lat*3600 - 169028.66)/10000, lonP = (lon*3600 - 26782.5)/10000;
  const e = 600072.37 + 211455.93*lonP - 10938.51*lonP*latP - 0.36*lonP*latP*latP - 44.54*lonP*lonP*lonP;
  const n = 200147.07 + 308807.95*latP + 3745.25*lonP*lonP + 76.63*latP*latP - 194.56*lonP*lonP*latP + 119.79*latP*latP*latP;
  return { e: Math.round(e), n: Math.round(n) };
}
// Builds one 53-column CSV/TSV row (same layout as the original bulk-import
// CSV) from a flight object — the inverse of parseSingleRow/createFlightFromPDF.
// Used for the "copy flights" feature so pasted output matches Numbers' columns.
// Builds a row matching ONLY the 25 columns that are actually VISIBLE in the
// person's Numbers sheet (hidden columns 2,4,5,8,9,11-20,22,24-33,51,52 are
// skipped entirely — Numbers pastes into visible cells only, so including
// hidden columns here would shift every value one column too far).
// Of those 25 visible columns, 8 still contain formulas the person wants to
// keep (34,35,36,37,39,40,44,50 — S-L Entf., Dauer, Rang, %, km/h, H.Diff.,
// SÜ, Datum-Zeitwert): those get the FORMULA_PLACEHOLDER text instead of
// being left blank, since a blank paste would overwrite the formula with
// nothing and there is no way to make a plain-text/HTML clipboard paste
// skip a cell — the person replaces the placeholder with the formula again
// by hand after pasting. Nr/Flugreise (1,3) are
// deliberately left blank per the person's instructions.
const FORMULA_PLACEHOLDER = "#F#";
// All 25 columns from the original fixed layout, now available as
// individually selectable/reorderable entries for the configurable copy
// feature. "getter" is a key into flightToCsvValues()'s output; columns
// without real source data (Numbers-formula placeholders in the original
// sheet) use getter:null and always emit FORMULA_PLACEHOLDER.
const CSV_COLUMN_DEFS = [
  { key: "nr", label: "Nr.", getter: "nr" },
  { key: "flugreise", label: "Flugreise", getter: "flugreise" },
  { key: "datum", label: "Datum", getter: "datum" },
  { key: "startzeit", label: "Startzeit", getter: "startzeit" },
  { key: "start", label: "Start", getter: "start" },
  { key: "landezeit", label: "Landezeit", getter: "landezeit" },
  { key: "landung", label: "Landung", getter: "landung" },
  { key: "sl_entf", label: "S-L Entf.", getter: null },
  { key: "dauer", label: "Dauer", getter: null },
  { key: "rang", label: "Rang", getter: null },
  { key: "prozent", label: "%", getter: null },
  { key: "distanz", label: "Distanz", getter: "distanz" },
  { key: "kmh", label: "km/h", getter: null },
  { key: "hdiff", label: "H.Diff.", getter: null },
  { key: "muemS", label: "müM S", getter: "muemS" },
  { key: "muemL", label: "müM L", getter: "muemL" },
  { key: "hmax", label: "H.Max", getter: "hmax" },
  { key: "sue", label: "SÜ", getter: null },
  { key: "hgew", label: "H.Gew.", getter: "hgew" },
  { key: "sinken", label: "Sinken", getter: "sinken" },
  { key: "steigen", label: "Steigen", getter: "steigen" },
  { key: "geraet", label: "Gerät", getter: "geraet" },
  { key: "datum2", label: "Datum2", getter: null },
  { key: "bemerkung", label: "Bemerkung", getter: "bemerkung" },
];
const CSV_COLUMN_DEFAULT_ORDER = CSV_COLUMN_DEFS.map(c => c.key);

function flightToCsvValues(f) {
  const cf = f.customFields || {};
  // Combines a place name with its altitude and lat/lon (5 decimals) into
  // one comma+space-separated string for the Start/Landung columns, e.g.
  // "Tannay, 1450, 46.20123, 6.85432" — pieces that aren't available are
  // simply omitted rather than leaving stray empty commas.
  const combineLocation = (name, altStr, pt) => {
    const parts = [];
    if (name) parts.push(name);
    if (altStr) parts.push(String(altStr));
    if (pt && pt.lat != null && pt.lon != null) {
      parts.push(pt.lat.toFixed(5));
      parts.push(pt.lon.toFixed(5));
    }
    return parts.join(", ");
  };
  return {
    nr:       f.name || "",
    flugreise: "",
    datum:    f.rawDate || f.date || "",
    startzeit: f.startTime || "",
    start:    combineLocation(f.site || "", f.startAlt ? String(f.startAlt) : (cf.msa || ""), f.startPt),
    landezeit: f.endTime || "",
    landung:  combineLocation(cf.landung || "", f.endAlt ? String(f.endAlt) : (cf.ml || ""), f.endPt),
    distanz:  f.totalDist ? String(f.totalDist) : (cf.distKm || ""),
    muemS:    f.startAlt ? String(f.startAlt) : (cf.msa || ""),
    muemL:    f.endAlt ? String(f.endAlt) : (cf.ml || ""),
    hmax:     f.maxAlt ? String(f.maxAlt) : (cf.hMax || ""),
    hgew:     cf.hGew || "",
    sinken:   cf.maxSinken || "",
    steigen:  cf.maxSteigen || "",
    geraet:   f.glider || "",
    bemerkung: f.notes || "",
  };
}

// Builds one tab-separated row using an arbitrary, user-chosen subset/order
// of CSV_COLUMN_DEFS (by key) — this is what makes the copy feature
// adaptable to whatever column layout an external spreadsheet expects.
function buildCsvRow(f, columnKeys) {
  const values = flightToCsvValues(f);
  return columnKeys.map(key => {
    const def = CSV_COLUMN_DEFS.find(c => c.key === key);
    if (!def) return "";
    return def.getter ? (values[def.getter] || "") : FORMULA_PLACEHOLDER;
  }).join("\t");
}

function flightToCsvRow(f) {
  return buildCsvRow(f, CSV_COLUMN_DEFAULT_ORDER);
}

// Header row matching flightToCsvRow's 25 columns exactly, so a re-exported
// file opens in Numbers with the same column layout the person is used to
// from the original import sheet.
const CSV_HEADER = [
  "Nr", "Flugreise", "Datum", "Startzeit", "Start", "Landezeit", "Landung",
  "S-L Entf.", "Dauer", "Rang", "%", "Distanz", "km/h", "H.Diff.",
  "müM S", "müM L", "H.Max", "SÜ", "H.Gew.", "Sinken", "Steigen",
  "Gerät", "Passagier", "Datum2", "Bemerkung",
].join("\t");

// Builds a downloadable CSV/TSV file from one or more flights, using the
// exact same column structure as flightToCsvRow (and therefore as the
// original import format), so it can be re-opened in Numbers/Excel with
// matching columns. Tab-separated rather than comma-separated since the
// data itself may contain commas (e.g. place names) and this already
// matches what the app uses elsewhere for spreadsheet compatibility.
function exportFlightsAsCsv(flightList, filenameBase) {
  const rows = [CSV_HEADER, ...flightList.map(flightToCsvRow)].join("\r\n");
  const blob = new Blob([rows], { type: "text/tab-separated-values;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameBase}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function coordsToWgs84(a, b) {
  const af = parseFloat(String(a).replace(",", ".")), bf = parseFloat(String(b).replace(",", "."));
  if (isNaN(af) || isNaN(bf)) return { lat: null, lon: null };
  if (Math.abs(af) <= 90 && Math.abs(bf) <= 180) return { lat: af, lon: bf };
  const r = lv03ToWgs84(af, bf);
  return { lat: Math.round(r.lat*1e6)/1e6, lon: Math.round(r.lon*1e6)/1e6 };
}
// Parses one CSV/TSV row (same 53-column layout as the bulk import) into the
// "p" object shape expected by createFlightFromPDF.
function splitCsvLine(line) {
  const cols = []; let cur = "", inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === "," && !inQ) { cols.push(cur); cur = ""; }
    else cur += ch;
  }
  cols.push(cur);
  return cols;
}
// Compact Numbers-copy format (25 tab-separated columns):
// 0=Nr, 1=(leer), 2=Datum, 3=Startzeit, 4="Start-Name, müM, CH1903-E, CH1903-N",
// 5=Landezeit, 6="Land-Name, müM, CH1903-E, CH1903-N", 7=S-L-Entf, 8=Dauer, 9=Rang,
// 10=%, 11=Distanz, 12=km/h, 13=H.Diff, 14=müM-S(dup), 15=müM-L(dup), 16=H.Max,
// 17=SÜ, 18=H.Gew, 19=Sinken, 20=Steigen, 21=Gerät, 22=Passagier, 23=Datum(dup), 24=Bemerkung
function parseCompactField(field) {
  // "Name, alt, chE, chN" -> {name, alt, chE, chN}
  const parts = (field||"").split(",").map(s=>s.trim());
  return { name: parts[0]||"", alt: parts[1]||"", chE: parts[2]||"", chN: parts[3]||"" };
}
function parseCompactNumbersRow(cols) {
  const get = i => (cols[i]||"").trim();
  const start = parseCompactField(get(4));
  const land = parseCompactField(get(6));
  const s = coordsToWgs84(start.chE, start.chN);
  const l = coordsToWgs84(land.chE, land.chN);
  return {
    d: get(2), sz: get(3), lz: get(5), st: start.name, la: land.name,
    sLat: s.lat, sLon: s.lon, lLat: l.lat, lLon: l.lon,
    dur: get(8), dk: get(11), kmh: get(12), hd: get(13),
    msa: get(14) || start.alt, ml: get(15) || land.alt, hm: get(16), hg: get(18),
    ms: get(19), mst: get(20), ge: get(21), be: get(24),
    _nr: get(0),
    _colCount: 53, // treat as valid — this is the compact 25-col format
  };
}
// Splits a multi-line paste (multiple flights, one per line, e.g. several rows
// copied together from Numbers) into individual rows, then parses each with
// parseSingleRow. Skips blank lines. Returns [{raw, p, error}] for each row,
// where p is the parsed field object (or null on error).
function parseMultipleRows(text) {
  const lines = text.replace(/\r/g, "").split("\n").map(l=>l.trim()).filter(Boolean);
  return lines.map(line => {
    try {
      const p = parseSingleRow(line);
      return { raw: line, p, error: null };
    } catch (e) {
      return { raw: line, p: null, error: e.message };
    }
  });
}

function parseSingleRow(rowText) {
  const raw = rowText.replace(/\r/g, "");
  let cols;
  let isTabSeparated = false;
  if (raw.includes("\t")) {
    // Tab-separated (typical Numbers/Excel single-row copy)
    cols = raw.split("\t");
    isTabSeparated = true;
  } else if (raw.includes("\n") && !raw.includes(",")) {
    // One value per line, no commas at all -> newline-separated single row
    cols = raw.split("\n");
  } else if (raw.includes("\n")) {
    // Multiple lines with commas present: most likely several CSV lines got pasted
    // (e.g. header + data row). Use the LAST non-empty line as the actual data row,
    // since that is what a person copying "one row" from a spreadsheet/CSV usually means.
    const lines = raw.split("\n").map(l=>l.trim()).filter(Boolean);
    const dataLine = lines[lines.length-1] || raw;
    cols = splitCsvLine(dataLine);
    if (cols.length < 20) cols = splitCsvLine(raw);
  } else {
    // Single line, comma-separated
    cols = splitCsvLine(raw);
  }
  cols = cols.map(c => (c||"").trim().replace(/^"+|"+$/g, ""));

  // Detect the compact Numbers-copy format: ~25 tab-separated columns where
  // column 4 looks like "Name, alt, chE, chN" (contains commas + numbers).
  if (isTabSeparated && cols.length >= 20 && cols.length <= 30) {
    const field4 = cols[4] || "";
    if (field4.split(",").length >= 3) {
      return parseCompactNumbersRow(cols);
    }
  }

  const get = i => cols[i] || "";
  const s = coordsToWgs84(get(12), get(13));
  const l = coordsToWgs84(get(25), get(26));
  return {
    d: get(5), sz: get(6), lz: get(20), st: get(10), la: get(23),
    sLat: s.lat, sLon: s.lon, lLat: l.lat, lLon: l.lon,
    dur: get(34), dk: get(37), kmh: get(38), hd: get(39),
    msa: get(40), ml: get(41), hm: get(42), hg: get(44),
    ms: get(45), mst: get(46), ge: get(47), be: get(52),
    _nr: get(0),
    _colCount: cols.length,
  };
}

function createFlightFromPDF(nr, p) {
  let dateStr="", yr="", mo="";
  if (p.d) {
    const parts = p.d.split(".");
    if (parts.length===3) {
      const dd=parts[0].padStart(2,"0"), mm=parts[1].padStart(2,"0");
      const y2=+parts[2]; yr = parts[2].length===2 ? (y2>=30?"19":"20")+parts[2] : parts[2]; mo=mm;
      dateStr = `${dd}.${mm}.${yr}`;
    }
  }
  let durationSec=0;
  const durStr = p.dur||"";
  if (durStr) {
    const dm = durStr.match(/(\d+):(\d{2}):(\d{2})/);
    if (dm) durationSec=+dm[1]*3600 + +dm[2]*60 + +dm[3];
    else {
      const dm2=durStr.match(/(\d+):(\d{2})/);
      const dm3=durStr.match(/(\d+)\s*h\s*(\d+)\s*m/i);
      if(dm2) durationSec=+dm2[1]*3600 + +dm2[2]*60;
      else if(dm3) durationSec=+dm3[1]*3600 + +dm3[2]*60;
    }
  }
  const startPt = p.sLat&&p.sLon ? {lat:+p.sLat,lon:+p.sLon,gpsAlt:+(p.msa||0)} : null;
  const endPt   = p.lLat&&p.lLon ? {lat:+p.lLat,lon:+p.lLon,gpsAlt:+(p.ml||0)}  : null;
  const track = []; // no artificial track
  return {
    id: `pdf_${nr}_${Date.now()}`,
    pdfOnly: true, name: nr,
    date: dateStr, rawDate: p.d||"", year: yr, month: mo,
    pilot:"", site: p.st||"", glider: p.ge||"",
    startTime: p.sz || "",
    endTime:   p.lz || "",
    durationSec, durationStr: durationSec ? formatDurationHM(durationSec) : "",
    maxAlt: +(p.hm||0), minAlt: +(p.ml||0),
    startAlt: +(p.msa||0), endAlt: +(p.ml||0),
    totalDist: parseFloat(p.dk||0)||0,
    thermalCount: 0, maxClimb: +(p.mst||0),
    track, startPt, endPt,
    comment:"", rating:0,
    notes: p.be||"",
    customFields: {
      landung: p.la||"",
      distKm: p.dk||"", kmh: p.kmh||"",
      hDiff: p.hd||"", hMax: p.hm||"", hGew: p.hg||"",
      maxSinken: p.ms||"", maxSteigen: p.mst||"",
      typ: p.ty||"",
    },
  };
}

// Same storage key as the Schirme-Seite (schirme.jsx) — this file loads
// independently and shares no code with it, so the key is duplicated here
// deliberately.
const SCHIRME_KEY = "schirme:list";
// IGC-Logger schreiben den Schirm-Namen in HFGTY ohne feste Konvention:
// manche als "Hersteller Modell…" (z.B. "Ozone Enzo 3"), andere nur als
// reines Modell ohne Hersteller (z.B. "Artik R 2" — ein Niviuk-Modell,
// dessen Name "Niviuk" nirgends im Header steht). Blind IMMER das erste
// Wort als Hersteller abzutrennen (frühere Version dieser Funktion) traf
// im zweiten Fall daneben und schnitt fälschlich einen Teil des Modell-
// namens ab ("Artik R 2" → Hersteller "Artik", Schirm nur "R 2"). Deshalb
// wird das erste Wort nur abgetrennt, wenn es zu einem bekannten
// Hersteller passt — sonst bleibt die komplette Bezeichnung als Schirm-
// Name erhalten und der Hersteller bleibt leer (in der Schirme-Liste
// jederzeit von Hand nachtragbar).
const KNOWN_SCHIRM_HERSTELLER = [
  "Advance", "Airdesign", "APCO", "BGD", "Dudek", "Flow", "Gin", "Gradient",
  "Independence", "MacPara", "Niviuk", "Nova", "Ozone", "Paratech", "Skywalk",
  "Sky", "Supair", "Swing", "Triple Seven", "UP", "U-Turn", "Windtech",
];
function splitFirstWordAsHersteller(raw) {
  const name = (raw || "").trim();
  for (const hersteller of KNOWN_SCHIRM_HERSTELLER) {
    const re = new RegExp(`^${hersteller}\\s+(.+)$`, "i");
    const m = name.match(re);
    if (m) return { hersteller, cleaned: m[1].trim() };
  }
  return { hersteller: "", cleaned: name };
}

// ── FILTER ENGINE ────────────────────────────────────────────────────────
// Supports: free text, UND/AND/&& , ODER/OR/|| , field:value, field>val, field<val,
// field>=val, field<=val, +word (muss), -word (darf nicht). Duration values like
// 1h, 1:30, 90m are parsed to seconds for dauer comparisons.
// Straight-line distance between two points (km) — used for "Entfernung
// Start-Landung", which is deliberately the direct line between takeoff and
// landing coordinates, not the flown path length (that's the existing,
// manually-entered "Distanz" field).
// The one place that decides what "the flight's distance" is, given the
// several places it can come from (current entry field vs. older imported
// data) — used both by the Distanz field itself and by FlightProfile's
// axis scaling, so the two can never read a different value from each
// other by construction.
function getDisplayDistance(fl) {
  if (fl?.totalDist) return String(fl.totalDist);
  return fl?.customFields?.distKm || fl?.customFields?.dk || "";
}
// ── OPEN-DISTANCE-BEWERTUNG (analog XContest „Freier Streckenflug", bis zu
// 3 Wendepunkte) ────────────────────────────────────────────────────────
// Approximiert XContest's Freiflug-Wertung: findet bis zu 5 Punkte entlang
// des Tracks (chronologisch geordnet — Start, bis zu 3 Wendepunkte, Ziel),
// die die Summe der Luftlinien-Distanzen zwischen ihnen maximieren. Das ist
// KEINE bit-genaue Nachbildung von XContest's eigener Wertungs-Engine
// (die zusätzliche Validierungs-/Sperrzonen-Regeln kennt), sondern eine
// praxistaugliche Annäherung — gut genug, um Distanz/Ø Speed automatisch
// zu befüllen, wenn noch kein manuell erfasster XContest-Wert vorliegt.
//
// Jede der 5^n möglichen Punktkombinationen auf einem mehrtausend-Punkte-
// Track durchzuprobieren ist praktisch unmöglich (O(n^5)) — stattdessen
// wird der Track zunächst vereinfacht (Douglas-Peucker) auf eine deutlich
// kleinere Kandidatenmenge, die die grobe Form noch gut abbildet. Ein
// dynamisches Programm findet dann den optimalen Pfad mit bis zu 4
// Teilstrecken (= bis zu 5 Punkten) durch diese reduzierte Menge in O(k²)
// Zeit — trivial selbst für einige hundert Kandidaten.
function simplifyTrackDP(track, epsilonKm) {
  if (track.length <= 2) return track;
  // Lokale, ebene (äquirechteckige) Projektion um Referenzpunkt `ref` —
  // für die Ausdehnung eines einzelnen Flugs (wenige bis niedrige
  // Hunderte km) genau genug für die Abstandsberechnung Punkt-zu-Gerade.
  const toXY = (pt, ref) => {
    const R = 6371;
    const x = (pt.lon - ref.lon) * Math.PI/180 * R * Math.cos(ref.lat*Math.PI/180);
    const y = (pt.lat - ref.lat) * Math.PI/180 * R;
    return { x, y };
  };
  const perpDistKm = (p, a, b) => {
    const P = toXY(p, a), A = { x: 0, y: 0 }, B = toXY(b, a);
    const dx = B.x-A.x, dy = B.y-A.y;
    const len2 = dx*dx + dy*dy;
    if (len2 === 0) return Math.hypot(P.x-A.x, P.y-A.y);
    const t = Math.max(0, Math.min(1, ((P.x-A.x)*dx + (P.y-A.y)*dy) / len2));
    return Math.hypot(P.x-(A.x+t*dx), P.y-(A.y+t*dy));
  };
  const keep = new Array(track.length).fill(false);
  keep[0] = true; keep[track.length-1] = true;
  const stack = [[0, track.length-1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    if (end - start < 2) continue;
    let maxDist = -1, maxIdx = -1;
    for (let i = start+1; i < end; i++) {
      const d = perpDistKm(track[i], track[start], track[end]);
      if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist > epsilonKm) {
      keep[maxIdx] = true;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }
  return track.filter((_, i) => keep[i]);
}
function computeOpenDistanceKm(track) {
  if (!track || track.length < 2) return null;
  // epsilon schrittweise vergröbern, bis die Kandidatenmenge für das O(k²)
  // DP unten handlich bleibt — bei sehr langen/verwinkelten Tracks selten
  // nötig, aber als Sicherheitsnetz gegen Ausreisser wichtig.
  let epsilon = 0.05; // km
  let candidates = simplifyTrackDP(track, epsilon);
  let tries = 0;
  while (candidates.length > 400 && tries < 8) {
    epsilon *= 1.8;
    candidates = simplifyTrackDP(track, epsilon);
    tries++;
  }
  if (candidates.length > 600) {
    const stride = Math.ceil(candidates.length / 600);
    candidates = candidates.filter((_, i) => i % stride === 0 || i === candidates.length-1);
  }
  const k = candidates.length;
  if (k < 2) return null;
  const dist = (i, j) => haversineDistKm(candidates[i], candidates[j]) || 0;

  const MAX_LEGS = 4; // bis zu 3 Wendepunkte = bis zu 4 Teilstrecken
  // best[L][i] = beste Gesamtdistanz eines Pfads mit genau L Teilstrecken,
  // endend bei Kandidat i (Punkte müssen in chronologischer Reihenfolge
  // verwendet werden — DP läuft daher nur über j<i).
  const best = Array.from({ length: MAX_LEGS+1 }, () => new Float64Array(k).fill(-Infinity));
  for (let i = 0; i < k; i++) best[0][i] = 0; // 0 Teilstrecken: nur der Startpunkt selbst
  let overallBest = 0;
  for (let L = 1; L <= MAX_LEGS; L++) {
    for (let i = 0; i < k; i++) {
      let localBest = -Infinity;
      for (let j = 0; j < i; j++) {
        if (best[L-1][j] === -Infinity) continue;
        const cand = best[L-1][j] + dist(j, i);
        if (cand > localBest) localBest = cand;
      }
      best[L][i] = localBest;
      if (localBest > overallBest) overallBest = localBest;
    }
  }
  return +overallBest.toFixed(1);
}
// Entscheidet, was (falls überhaupt) bei Distanz/Ø Speed nachgetragen
// werden soll — überschreibt nie bereits vorhandene Werte. Wird sowohl
// beim IGC-Import (neu berechneter scoreDistanceKm) als auch beim
// nachträglichen Batch-Lauf über bestehende Flüge verwendet.
function computeDistanceSpeedBackfill(existingTotalDist, cf, scoreDistanceKm, durationSec) {
  const hasDist = (existingTotalDist > 0) || !!(cf?.distKm||"").trim();
  let distKm = hasDist ? (existingTotalDist || parseFloat(cf?.distKm) || 0) : null;
  const result = {};
  if (!hasDist && scoreDistanceKm != null && scoreDistanceKm > 0) {
    distKm = scoreDistanceKm;
    result.totalDist = scoreDistanceKm;
    result.distKm = String(scoreDistanceKm);
  }
  const hasSpeed = !!(cf?.kmh||"").trim();
  if (!hasSpeed && distKm && durationSec > 0) {
    result.kmh = String(+(distKm / (durationSec/3600)).toFixed(1));
  }
  return result; // { totalDist?, distKm?, kmh? } — nur gesetzte Keys sind neu
}
function haversineDistKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, dLat = (b.lat-a.lat)*Math.PI/180, dLon = (b.lon-a.lon)*Math.PI/180;
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}
// ── AUTOMATISCHE ORTS-/LAND-ZUORDNUNG BEIM IGC-IMPORT ────────────────────
// Findet unter den vorhandenen Flügen den nächstgelegenen mit gefülltem
// Feld innerhalb des konfigurierten Radius (unter Service einstellbar) —
// dient sowohl für Startplatz (gegen startPt anderer Flüge), Landeplatz
// (gegen endPt) als auch Land (ebenfalls gegen startPt, da das Land eines
// Flugs sich üblicherweise nach dem Startort richtet).
function findNearbyFieldValue(pt, flights, getPoint, getValue, radiusKm) {
  if (!pt) return "";
  let best = "", bestDist = Infinity;
  for (const f of flights) {
    const fp = getPoint(f);
    if (!fp) continue;
    const val = (getValue(f) || "").trim();
    if (!val) continue;
    const d = haversineDistKm(pt, fp);
    if (d != null && d <= radiusKm && d < bestDist) { bestDist = d; best = val; }
  }
  return best;
}
// Reverse-Geocoding via MapTiler — nur als Rückfallebene, wenn kein
// bestehender Flug in der Nähe ein Land liefert. Liefert den (deutschen)
// Ländernamen, oder "" bei Fehler/fehlendem Schlüssel — ein Fehler hier
// darf den Import nie blockieren, deshalb wird jede Exception abgefangen.
async function reverseGeocodeCountry(pt, apiKey) {
  if (!pt || !apiKey) return "";
  try {
    const url = `https://api.maptiler.com/geocoding/${pt.lon},${pt.lat}.json?key=${apiKey}&types=country&language=de`;
    const res = await fetch(url);
    if (!res.ok) return "";
    const data = await res.json();
    const feature = data?.features?.[0];
    return (feature?.text || feature?.place_name || "").trim();
  } catch (e) {
    console.error("MapTiler reverse geocoding failed:", e);
    return "";
  }
}
// Kombiniert beides zu einem Aufruf — der Aufrufer trägt die Werte nur in
// tatsächlich leere Felder ein, überschreibt also nie bereits vorhandene
// (z.B. aus Excel importierte) Angaben.
async function inferPlaceAndCountry(startPt, endPt, flights, radiusKm, apiKey) {
  const site = findNearbyFieldValue(startPt, flights, f=>f.startPt, f=>f.site, radiusKm);
  const landung = findNearbyFieldValue(endPt, flights, f=>f.endPt, f=>f.customFields?.landung, radiusKm);
  let land = findNearbyFieldValue(startPt, flights, f=>f.startPt, f=>f.customFields?.land, radiusKm);
  if (!land && startPt) land = await reverseGeocodeCountry(startPt, apiKey);
  return { site, landung, land };
}
// Compass bearing (0°=North, 90°=East, ...) from point a to point b —
// used to rotate the glider reference marker to face the actual flight
// direction at that point in the track.
function bearingDeg(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return 0;
  const lat1 = a.lat*Math.PI/180, lat2 = b.lat*Math.PI/180;
  const dLon = (b.lon-a.lon)*Math.PI/180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1)*Math.sin(lat2) - Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
  return (Math.atan2(y, x) * 180/Math.PI + 360) % 360;
}
// Attaches entfernungSL (straight-line Start-Landung distance) to every
// flight. Precomputing this once here — rather than inside the generic
// per-flight sort/search functions — keeps those functions simple (they
// just read a normal field) instead of needing the whole flight list
// threaded through every call.
function attachComputedRanks(flights) {
  return flights.map(f => {
    const sl = haversineDistKm(f.startPt, f.endPt);
    return { ...f, entfernungSL: sl != null ? +sl.toFixed(1) : null };
  });
}
function parseDurToSec(s){
  if(s==null) return 0;
  s=String(s).trim();
  let m=s.match(/^(\d+):(\d{2}):(\d{2})$/); if(m) return +m[1]*3600+ +m[2]*60+ +m[3];
  m=s.match(/^(\d+):(\d{2})$/); if(m) return +m[1]*3600+ +m[2]*60;
  m=s.match(/^(\d+(?:[.,]\d+)?)\s*h(?:\s*(\d+)\s*m)?$/i); if(m) return Math.round((+m[1].replace(",","."))*3600)+(m[2]?+m[2]*60:0);
  m=s.match(/^(\d+)\s*m(?:in)?$/i); if(m) return +m[1]*60;
  m=s.match(/^(\d+(?:[.,]\d+)?)$/); if(m) return Math.round(+m[1].replace(",",".")*3600); // bare number => hours
  return 0;
}
function flightFieldValue(f, field){
  const cf=f.customFields||{};
  switch(field){
    case "name": case "titel": return f.name||"";
    case "site": case "start": case "startplatz": return f.site||"";
    case "landung": case "landeplatz": return cf.landung||"";
    case "land": case "country": return cf.land||"";
    case "schirm": case "glider": case "gerät": case "geraet": return f.glider||"";
    case "typ": case "type": return cf.typ||"";
    case "pilot": return f.pilot||"";
    case "reise": return cf.reise||"";
    case "jahr": case "year": return f.year||"";
    case "datum": case "date": return f.date||"";
    case "startzeit": case "starttime": return f.startTime||"";
    case "landezeit": case "endtime": return f.endTime||"";
    case "kommentar": case "comment": return f.comment||"";
    case "bemerkung": case "notes": case "notiz": return f.notes||"";
    case "dauer": case "duration": return (f.durationSec||parseDurToSec(f.durationStr))/3600; // hours (number)
    case "distanz": case "dist": case "km": return f.totalDist||parseFloat(cf.distKm||cf.dk||0)||0;
    case "maxspeed": return f.maxSpeedKmh||0;
    case "höhe": case "hoehe": case "maxhöhe": case "maxhoehe": case "alt": return f.maxAlt||+(cf.hMax||cf.hm||0)||0;
    case "startalt": return f.startAlt||+(cf.msa||0)||0;
    case "endalt": return f.endAlt||+(cf.ml||0)||0;
    case "hdiff": return +(cf.hDiff||0)||0;
    case "maxsteigen": return +(cf.maxSteigen||0)||0;
    case "maxsteigen20": return +(cf.maxSteigen20||0)||0;
    case "maxsinken": return +(cf.maxSinken||0)||0;
    case "hgew": return +(cf.hGew||0)||0;
    case "entfernungsl": return f.entfernungSL||0;
    case "startlat": return f.startPt?.lat||0;
    case "startlon": return f.startPt?.lon||0;
    case "endlat": return f.endPt?.lat||0;
    case "endlon": return f.endPt?.lon||0;
    case "speed": case "kmh": return parseFloat(cf.kmh||0)||0;
    case "rating": case "bewertung": return f.rating||0;
    default: return "";
  }
}
function evalToken(f, tok){
  // comparison field op value — now also accepts != (not equal)
  let m=tok.match(/^([\wäöü]+)\s*(>=|<=|!=|≠|>|<|=|:)\s*(.+)$/i);
  if(m){
    const field=m[1].toLowerCase(), op=(m[2]==="≠"?"!=":m[2]), raw=m[3].trim().replace(/^"(.*)"$/, "$1");
    // igc:ja / igc:nein — presence of an imported IGC flight track, not a
    // value comparison. training:ja / training:nein likewise checks the
    // Excel "Training" flag (cf.training === "T"), not a text comparison.
    if(field==="igc" || field==="training"){
      const has = field==="igc" ? (f.track?.length>1) : (f.customFields?.training||"").trim().toUpperCase()==="T";
      const want = ["ja","vorhanden","true","1"].includes(raw.toLowerCase());
      return op==="!=" ? has!==want : has===want;
    }
    let fv=flightFieldValue(f, field);

    const numericFields=["name","titel","dauer","duration","distanz","dist","km","maxspeed","höhe","hoehe","maxhöhe","maxhoehe","alt",
      "startalt","endalt","hdiff","maxsteigen","maxsteigen20","maxsinken","hgew","entfernungsl",
      "speed","kmh","rating","bewertung","jahr","year","startlat","startlon","endlat","endlon"];
    const dateFields=["datum","date"];
    const timeFields=["startzeit","starttime","landezeit","endtime"];

    if(numericFields.includes(field)){
      let cmp = field==="dauer"||field==="duration" ? parseDurToSec(raw)/3600 : parseFloat(raw.replace(",","."));
      fv = parseFloat(fv)||0;
      if(isNaN(cmp)) return true;
      if(op===">") return fv>cmp;
      if(op==="<") return fv<cmp;
      if(op===">=") return fv>=cmp;
      if(op==="<=") return fv<=cmp;
      if(op==="!=") return Math.abs(fv-cmp)>=0.0001;
      return Math.abs(fv-cmp)<0.0001;
    }
    if(dateFields.includes(field)){
      // Chronological comparison (not string comparison — "05.01.2026" must
      // sort after "12.01.2025" despite being alphabetically earlier).
      const cmp = parseDateToTs(raw);
      const fvTs = parseDateToTs(fv);
      if(!cmp) return true;
      if(op===">") return fvTs>cmp;
      if(op==="<") return fvTs<cmp;
      if(op===">=") return fvTs>=cmp;
      if(op==="<=") return fvTs<=cmp;
      if(op==="!=") return fvTs!==cmp;
      return fvTs===cmp;
    }
    if(timeFields.includes(field)){
      const toSec = t => { const m2=String(t).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/); return m2?(+m2[1]*3600+ +m2[2]*60+ +(m2[3]||0)):null; };
      const cmp = toSec(raw), fvSec = toSec(fv);
      if(cmp==null) return true;
      if(fvSec==null) return false;
      if(op===">") return fvSec>cmp;
      if(op==="<") return fvSec<cmp;
      if(op===">=") return fvSec>=cmp;
      if(op==="<=") return fvSec<=cmp;
      if(op==="!=") return fvSec!==cmp;
      return fvSec===cmp;
    }
    // text fields: ":" (default) means contains; "=" means exact match;
    // "!=" means does NOT contain; >/</>=/<= compare alphabetically
    // (locale-aware, so names/places sort the way a person would expect).
    const fvStr = String(fv), rawStr = raw;
    if(op===":") return fvStr.toLowerCase().includes(rawStr.toLowerCase());
    if(op==="=") return fvStr.toLowerCase() === rawStr.toLowerCase();
    if(op==="!=") return !fvStr.toLowerCase().includes(rawStr.toLowerCase());
    const cmpAlpha = fvStr.localeCompare(rawStr, "de", {sensitivity:"base"});
    if(op===">") return cmpAlpha>0;
    if(op==="<") return cmpAlpha<0;
    if(op===">=") return cmpAlpha>=0;
    if(op==="<=") return cmpAlpha<=0;
    return fvStr.toLowerCase().includes(rawStr.toLowerCase());
  }
  // plain word => search across all text
  const hay=[f.name,f.site,f.glider,f.pilot,f.customFields?.landung,f.customFields?.land,f.customFields?.reise,f.comment,f.notes,f.date,f.year].join(" ").toLowerCase();
  return hay.includes(tok.toLowerCase());
}
// ── SORT ENGINE ──────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { id: "number",   label: "Nummer" },
  { id: "date",     label: "Datum" },
  { id: "jahr",     label: "Jahr" },
  { id: "startTime", label: "Startzeit" },
  { id: "endTime",  label: "Landezeit" },
  { id: "site",     label: "Startplatz" },
  { id: "landung",  label: "Landeplatz" },
  { id: "land",     label: "Land" },
  { id: "glider",   label: "Schirm" },
  { id: "typ",      label: "Typ" },
  { id: "reise",    label: "Reise" },
  { id: "duration", label: "Dauer" },
  { id: "dist",     label: "Distanz" },
  { id: "maxSpeed", label: "Max Speed" },
  { id: "alt",      label: "Max. Höhe" },
  { id: "startAlt", label: "Start müM" },
  { id: "endAlt",   label: "Landung müM" },
  { id: "hDiff",    label: "H.Diff." },
  { id: "speed",    label: "Ø Speed" },
  { id: "maxSteigen", label: "Max.Steigen" },
  { id: "maxSteigen20", label: "Max.Steigen 20s" },
  { id: "maxSinken", label: "Max.Sinken" },
  { id: "hGew",     label: "H.Gew." },
  { id: "entfernungSL", label: "Entf. S-L" },
  { id: "rating",   label: "Bewertung" },
];
function parseDateToTs(d, timeStr) {
  if (!d) return 0;
  const m = String(d).match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return 0;
  let [_, dd, mm, yy] = m;
  yy = yy.length === 2 ? (+yy >= 30 ? "19" + yy : "20" + yy) : yy;
  let hh = 0, min = 0, sec = 0;
  if (timeStr) {
    const tm = String(timeStr).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (tm) { hh = +tm[1]; min = +tm[2]; sec = +(tm[3] || 0); }
  }
  return new Date(+yy, +mm - 1, +dd, hh, min, sec).getTime();
}

function sortFieldValue(f, sortId) {
  const cf = f.customFields || {};
  switch (sortId) {
    case "year":     return f.year || 0;
    case "date":     return parseDateToTs(f.date || f.rawDate, f.startTime);
    case "number":
    case "name":     return parseInt((f.name || "").match(/\d+/)?.[0] || "0", 10);
    case "startTime": return parseDurToSec(f.startTime);
    case "endTime":  return parseDurToSec(f.endTime);
    case "duration": return f.durationSec || parseDurToSec(f.durationStr);
    case "dist":     return f.totalDist || parseFloat(cf.distKm || cf.dk || 0) || 0;
    case "maxSpeed": return f.maxSpeedKmh || 0;
    case "alt":      return f.maxAlt || +(cf.hMax || cf.hm || 0) || 0;
    case "startAlt": return f.startAlt || +(cf.msa || 0) || 0;
    case "endAlt":   return f.endAlt || +(cf.ml || 0) || 0;
    case "hDiff":    return +(cf.hDiff||0) || 0;
    case "maxSteigen": return +(cf.maxSteigen||0) || 0;
    case "maxSteigen20": return +(cf.maxSteigen20||0) || 0;
    case "maxSinken": return +(cf.maxSinken||0) || 0;
    case "hGew":     return +(cf.hGew||0) || 0;
    case "entfernungSL": return f.entfernungSL || 0;
    case "site":     return (f.site || "").toLowerCase();
    case "landung":  return (cf.landung || "").toLowerCase();
    case "land":     return (cf.land || "").toLowerCase();
    case "glider":   return (f.glider || "").toLowerCase();
    case "typ":      return (cf.typ || "").toLowerCase();
    case "pilot":    return (f.pilot || "").toLowerCase();
    case "reise":    return (cf.reise || "").toLowerCase();
    case "speed":    return parseFloat(cf.kmh || 0) || 0;
    case "rating":   return f.rating || 0;
    case "jahr":     return f.year || 0;
    default:         return 0;
  }
}
function sortFlights(flights, sortId, dir) {
  if (!sortId) return flights;
  const sorted = [...flights].sort((a, b) => {
    const av = sortFieldValue(a, sortId), bv = sortFieldValue(b, sortId);
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv));
    }
    return av - bv;
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

// Sortier-Felder, deren Wert in FlightRow ohnehin schon zu sehen ist —
// wird nach einem davon sortiert, muss kein zusätzliches Feld eingeblendet
// werden, weil es schon auf der Zeile steht.
const FLIGHT_ROW_VISIBLE_SORT_IDS = new Set([
  "date", "site", "landung", "reise", "glider", "maxSpeed", "dist", "duration", "rating",
]);

// Formatiert den Wert des aktuell gewählten Sortierfelds für die Anzeige in
// einer Flugzeile, damit man beim Sortieren nach einem sonst nicht
// sichtbaren Feld (z.B. Land, Pilot, H.Diff.) auch sieht, wonach die Liste
// gerade geordnet ist — statt raten zu müssen.
function sortFieldDisplay(f, sortId) {
  const cf = f.customFields || {};
  switch (sortId) {
    case "number": case "name": return f.name || null;
    case "jahr": case "year": return f.year || null;
    case "startTime": return f.startTime || null;
    case "endTime": return f.endTime || null;
    case "land": return cf.land || null;
    case "typ": return cf.typ || null;
    case "pilot": return f.pilot || null;
    case "alt": return f.maxAlt ? f.maxAlt+" m" : ((cf.hMax||cf.hm) ? (cf.hMax||cf.hm)+" m" : null);
    case "startAlt": return f.startAlt>0 ? f.startAlt+" m" : (cf.msa ? cf.msa+" m" : null);
    case "endAlt": return f.endAlt>0 ? f.endAlt+" m" : (cf.ml ? cf.ml+" m" : null);
    case "hDiff": return cf.hDiff ? cf.hDiff+" m" : null;
    case "speed": return cf.kmh ? cf.kmh+" km/h" : null;
    case "maxSteigen": return (cf.maxSteigen||f.maxClimb) ? fmt1(cf.maxSteigen||f.maxClimb)+" m/s" : null;
    case "maxSteigen20": return (cf.maxSteigen20||f.maxClimb20) ? fmt1(cf.maxSteigen20||f.maxClimb20)+" m/s" : null;
    case "maxSinken": return cf.maxSinken ? fmt1(cf.maxSinken)+" m/s" : null;
    case "hGew": return cf.hGew ? cf.hGew+" m" : null;
    case "entfernungSL": return f.entfernungSL!=null ? f.entfernungSL+" km" : null;
    default: return null;
  }
}

// Einzeilige Flugzeile — ein Design für schmale und breite Ansicht
// (früher: eigene Wide-/iPhone-Varianten). IGC-/CSV-Quellenbadges bewusst
// weggelassen (nicht relevant für die Übersicht), rechts immer Max Speed,
// Distanz und Dauer, unabhängig von der aktuellen Sortierung.
function FlightRow({ f, isLongest, onClick, selectMode, isSelected, onToggleSelect, sortId }) {
  const distText = f.totalDist ? `${f.totalDist} km` : null;
  const speedText = f.maxSpeedKmh ? `${f.maxSpeedKmh} km/h` : null;
  // Zusätzliches Feld für das aktuelle Sortierkriterium — nur wenn es nicht
  // schon durch eines der fest angezeigten Felder oben abgedeckt ist.
  const sortExtra = !FLIGHT_ROW_VISIBLE_SORT_IDS.has(sortId) ? sortFieldDisplay(f, sortId) : null;
  return (
    <div onClick={selectMode ? ()=>onToggleSelect(f.id) : onClick}
      style={{padding:"5px 16px",borderBottom:"1px solid rgba(255,255,255,0.04)",cursor:"pointer",display:"flex",alignItems:"center",gap:8,background:isSelected?"rgba(14,165,233,0.1)":"transparent",transition:"background 0.15s",whiteSpace:"nowrap",overflow:"hidden"}}
      onMouseEnter={e=>{ if(!isSelected) e.currentTarget.style.background="rgba(255,255,255,0.03)"; }}
      onMouseLeave={e=>{ if(!isSelected) e.currentTarget.style.background="transparent"; }}>
      {selectMode && (
        <div style={{flexShrink:0,width:20,height:20,borderRadius:6,border:`2px solid ${isSelected?"#7dd3fc":"rgba(232,244,253,0.3)"}`,background:isSelected?"#7dd3fc":"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
          {isSelected && <span style={{color:"#0a1628",fontSize:13,fontWeight:900}}>✓</span>}
        </div>
      )}
      {isLongest&&<span style={{fontSize:10,flexShrink:0}}>🏆</span>}
      <span style={{fontSize:11,color:"#a8d8f5",flexShrink:0}}>{f.date}</span>
      <span style={{fontSize:11,color:"#a8d8f5",overflow:"hidden",textOverflow:"ellipsis",minWidth:0}}>{f.site||"—"}</span>
      {f.customFields?.landung && <span style={{fontSize:11,color:"#a8d8f5",overflow:"hidden",textOverflow:"ellipsis",minWidth:0}}>→ {f.customFields.landung}</span>}
      {f.customFields?.reise && <span style={{fontSize:11,fontWeight:700,color:"#fcd34d",overflow:"hidden",textOverflow:"ellipsis",minWidth:0,flexShrink:2}}>· {f.customFields.reise}</span>}
      {f.glider && <span style={{fontSize:11,color:"#a8d8f5",overflow:"hidden",textOverflow:"ellipsis",minWidth:0,flexShrink:2}}>· {f.glider}</span>}
      <span style={{flex:1}} />
      <div style={{textAlign:"right",flexShrink:0,display:"flex",alignItems:"center",gap:10}}>
        {f.rating>0 && <span style={{fontSize:11,fontWeight:600,whiteSpace:"nowrap",flexShrink:0}}><span style={{color:"#fde047"}}>{f.rating}</span><span style={{fontSize:"0.85em"}}>⭐️</span></span>}
        {sortExtra && <span style={{fontSize:11,color:"#a8d8f5"}}>{sortExtra}</span>}
        {speedText && <span style={{fontSize:11,color:"#a8d8f5"}}>{speedText}</span>}
        {distText && <span style={{fontSize:11,color:"#a8d8f5"}}>{distText}</span>}
        <span style={{fontSize:13,fontWeight:600,color:"#7dd3fc"}}>{f.durationStr||"—"}</span>
      </div>
    </div>
  );
}

function matchFlights(flights, q){
  if(!q||!q.trim()) return flights;
  // Normalise operators
  let s=q.trim()
    .replace(/\s+(UND|AND)\s+/gi," && ")
    .replace(/\s+(ODER|OR)\s+/gi," || ")
    .replace(/&&/g," && ").replace(/\|\|/g," || ");
  // Split into OR groups, each OR group split into AND terms
  const orGroups=s.split(/\s*\|\|\s*/);
  return flights.filter(f=>{
    return orGroups.some(group=>{
      const andTerms=group.split(/\s*&&\s*/).flatMap(t=>{
        // also split on spaces but keep field:val / quoted together
        return t.match(/(?:[\wäöü]+(?:>=|<=|!=|≠|>|<|=|:)"[^"]+"|[\wäöü]+(?:>=|<=|!=|≠|>|<|=|:)\S+|\+\S+|\-\S+|"[^"]+"|\S+)/gi)||[];
      }).map(t=>t.replace(/^"(.*)"$/,"$1"));
      if(!andTerms.length) return true;
      return andTerms.every(term=>{
        if(term.startsWith("+")) return evalToken(f, term.slice(1));
        if(term.startsWith("-")) return !evalToken(f, term.slice(1));
        return evalToken(f, term);
      });
    });
  });
}

// ── ADVANCED SEARCH (macOS-Finder-style, multiple combinable criteria) ────
// Builds on top of the existing matchFlights/evalToken text-query engine
// instead of replacing it: each visual row just gets rendered into the same
// "field:value" / "field>value" token syntax already understood above, so
// both the simple one-line search and the row-based builder share one
// matching engine and never disagree with each other.
const SEARCH_FIELDS = [
  { id: "name",      label: "Name/Titel",     type: "text" },
  { id: "site",      label: "Startplatz",     type: "text" },
  { id: "landung",   label: "Landeplatz",     type: "text" },
  { id: "land",      label: "Land",           type: "text" },
  { id: "glider",    label: "Schirm",         type: "text" },
  { id: "typ",       label: "Typ",            type: "text" },
  { id: "pilot",     label: "Pilot",          type: "text" },
  { id: "reise",     label: "Reise",          type: "text" },
  { id: "datum",     label: "Datum",          type: "date" },
  { id: "startzeit", label: "Startzeit",      type: "time" },
  { id: "landezeit", label: "Landezeit",      type: "time" },
  { id: "jahr",      label: "Jahr",           type: "number" },
  { id: "bemerkung", label: "Bemerkung",      type: "text" },
  { id: "dauer",     label: "Dauer (h)",      type: "number" },
  { id: "distanz",   label: "Distanz (km)",   type: "number" },
  { id: "maxspeed",  label: "Max Speed (km/h)", type: "number" },
  { id: "hoehe",     label: "Max. Höhe (m)",  type: "number" },
  { id: "startalt",  label: "Start müM",      type: "number" },
  { id: "endalt",    label: "Landung müM",    type: "number" },
  { id: "hdiff",     label: "H.Diff. (m)",    type: "number" },
  { id: "speed",     label: "Ø Speed (km/h)", type: "number" },
  { id: "maxsteigen", label: "Max.Steigen (m/s)", type: "number" },
  { id: "maxsteigen20", label: "Max.Steigen 20s (m/s)", type: "number" },
  { id: "maxsinken", label: "Max.Sinken (m/s)", type: "number" },
  { id: "hgew",      label: "H.Gew. (m)",     type: "number" },
  { id: "entfernungsl", label: "Entf. S-L (km)", type: "number" },
  { id: "startlat",  label: "Start Lat",      type: "number" },
  { id: "startlon",  label: "Start Lon",      type: "number" },
  { id: "endlat",    label: "Landung Lat",    type: "number" },
  { id: "endlon",    label: "Landung Lon",    type: "number" },
  { id: "rating",    label: "Bewertung",      type: "number" },
  { id: "igc",       label: "IGC-Track",      type: "bool" },
  { id: "training",  label: "Training",       type: "bool" },
];
const BOOL_OPTIONS = [
  { value: "ja",   label: "Vorhanden" },
  { value: "nein", label: "Nicht vorhanden" },
];
const ADV_OPS_NUM = [">=", "<=", "!=", ">", "<", "=", "between"];
const ADV_OPS_TEXT = [":", "=", "!=", ">", "<", ">=", "<="];

// All fields a data tile in the flight detail view can be set to show,
// plus the default 9-tile layout (matches what used to be hardcoded).
const TILE_FIELD_OPTIONS = [
  { key: "duration",  label: "Dauer",         icon: "⏱",  get: fl => fl.durationStr || "—" },
  { key: "maxAlt",    label: "Max. Höhe",     icon: "⬆",  get: fl => fl.maxAlt ? fl.maxAlt+" m" : "—" },
  { key: "distanz",   label: "Distanz",       icon: "📏", get: fl => fl.totalDist ? fl.totalDist+" km" : (fl.customFields?.distKm||fl.customFields?.dk ? (fl.customFields.distKm||fl.customFields.dk)+" km" : "—") },
  { key: "maxSpeed",  label: "Max Speed",     icon: "⚡", get: fl => fl.maxSpeedKmh ? fl.maxSpeedKmh+" km/h" : "—" },
  { key: "startAlt",  label: "Start müM",     icon: "↑",  get: fl => fl.startAlt>0 ? fl.startAlt+" m" : (fl.customFields?.msa ? fl.customFields.msa+" m" : "—") },
  { key: "endAlt",    label: "Land. müM",     icon: "↓",  get: fl => fl.endAlt>0 ? fl.endAlt+" m" : (fl.customFields?.ml ? fl.customFields.ml+" m" : "—") },
  { key: "hDiff",     label: "H.Diff.",       icon: "↕",  get: fl => fl.customFields?.hDiff ? fl.customFields.hDiff+" m" : "—" },
  { key: "maxSinken", label: "Max.Sinken",    icon: "⬇",  get: fl => fl.customFields?.maxSinken ? fmt1(fl.customFields.maxSinken)+" m/s" : "—" },
  { key: "maxSteigen", label: "Max.Steigen",  icon: "⬆",  get: fl => (fl.customFields?.maxSteigen||fl.maxClimb) ? fmt1(fl.customFields?.maxSteigen||fl.maxClimb)+" m/s" : "—" },
  { key: "maxSteigen20", label: "Max.Steigen 20s", icon: "⬆", get: fl => (fl.customFields?.maxSteigen20||fl.maxClimb20) ? fmt1(fl.customFields?.maxSteigen20||fl.maxClimb20)+" m/s" : "—" },
  { key: "speed",     label: "Ø Speed",       icon: "💨", get: fl => fl.customFields?.kmh ? fl.customFields.kmh+" km/h" : "—" },
  { key: "hGew",      label: "Höhengewinn",   icon: "📈", get: fl => fl.customFields?.hGew ? fl.customFields.hGew+" m" : "—" },
  { key: "entfernungSL", label: "Entf. S-L",  icon: "📐", get: fl => fl.entfernungSL!=null ? fl.entfernungSL+" km" : "—" },
  { key: "rating",    label: "Bewertung",     icon: "⭐️", get: fl => fl.rating ? "★".repeat(fl.rating) : "—" },
];
const DEFAULT_TILE_KEYS = ["duration","maxAlt","distanz","startAlt","endAlt","hDiff","maxSinken","maxSteigen","speed"];

function buildAdvancedQuery(rows) {
  // Values containing whitespace must be quoted — the query tokenizer
  // (matchFlights/evalToken) splits on spaces outside quotes, so an
  // unquoted "field:Advance Pi 23" silently became three unrelated terms
  // ("field:Advance", "Pi", "23") that essentially never all matched.
  const quoteIfNeeded = v => /\s/.test(v) ? `"${v}"` : v;
  const termFor = (r) => {
    const fieldDef = SEARCH_FIELDS.find(f => f.id === r.field);
    const isNumeric = fieldDef?.type === "number" || fieldDef?.type === "date" || fieldDef?.type === "time";
    const op = r.op || (isNumeric ? "=" : ":");
    if (op === "between") {
      if (r.value2 === "" || r.value2 == null) return `${r.field}>=${String(r.value).trim()}`;
      // Joined with && so this pair always stays a unit no matter which
      // connector (UND/ODER) this row itself uses towards the row before
      // it — matchFlights splits on || first, so an && inside one row's
      // own part never gets separated from its partner by an OR elsewhere.
      return `${r.field}>=${String(r.value).trim()} && ${r.field}<=${String(r.value2).trim()}`;
    }
    return `${r.field}${op}${quoteIfNeeded(String(r.value).trim())}`;
  };
  // Each row (from the second non-empty one onward) carries its OWN
  // connector to whatever came before it — this is what allows mixed
  // UND/ODER chains (e.g. "Zeile1 UND Zeile2 ODER Zeile3") instead of one
  // global operator for the whole list. matchFlights already evaluates
  // && with higher precedence than || (splits on || first, then && within
  // each group), so a plain left-to-right chain here already means the
  // same thing a person reading "A UND B ODER C" would expect.
  let out = "";
  for (const r of rows) {
    if (r.value === "" || r.value == null) continue; // empty rows are skipped entirely, like before
    const term = termFor(r);
    if (!out) { out = term; continue; }
    out += (r.connector === "OR" ? " || " : " && ") + term;
  }
  return out;
}

function newSearchRow(connector) { return { field: "site", op: ":", value: "", connector: connector || "AND" }; }

// Reconstructs the row-builder's rows (each with its own connector to the
// previous row) from a query string — used when the search panel is
// reopened after being hidden, so a previously built multi-row search
// reappears as those same rows instead of just the raw filterText string
// the person would otherwise have to decode by eye to edit further.
function parseQueryToRows(query) {
  if (!query || !query.trim()) return [newSearchRow()];
  // Split on && / || while keeping the delimiter itself in the result
  // (capturing group in the regex), so each term stays paired with the
  // connector that led into it — needed to reconstruct mixed UND/ODER
  // chains rather than assuming one operator for the whole query.
  const pieces = query.trim().split(/\s*(&&|\|\|)\s*/).filter(p => p !== "");
  const parseTerm = (part) => {
    const m = part.trim().match(/^([\wäöü]+)\s*(>=|<=|!=|≠|>|<|=|:)\s*(.+)$/i);
    if (!m) return null;
    const field = m[1].toLowerCase();
    if (!SEARCH_FIELDS.find(f => f.id === field)) return null;
    const op = m[2] === "≠" ? "!=" : m[2];
    const value = m[3].trim().replace(/^"(.*)"$/, "$1");
    return { field, op, value };
  };
  const terms = [];
  const connectors = []; // connector leading into terms[i]; connectors[0] is unused
  for (let i = 0; i < pieces.length; i += 2) {
    const t = parseTerm(pieces[i]);
    if (!t) return [newSearchRow()];
    terms.push(t);
    connectors.push(i === 0 ? "AND" : (pieces[i - 1] === "||" ? "OR" : "AND"));
  }
  // Merge a "between" pair back into one row — buildAdvancedQuery always
  // emits these as two consecutive same-field >=/<= entries joined by &&.
  const rows = [];
  for (let i = 0; i < terms.length; i++) {
    const cur = terms[i], next = terms[i + 1];
    if (next && connectors[i + 1] === "AND" && cur.field === next.field && cur.op === ">=" && next.op === "<=") {
      rows.push({ field: cur.field, op: "between", value: cur.value, value2: next.value, connector: connectors[i] });
      i++;
    } else {
      rows.push({ ...cur, connector: connectors[i] });
    }
  }
  return rows.length ? rows : [newSearchRow()];
}

// Collapsed: a single search line (existing behaviour). Expanding it reveals
// a macOS-Finder-like row builder — add any number of Feld/Operator/Wert
// rows, combined either all-UND or all-ODER — which is translated live into
// the same query string the plain text box uses, so results stay identical
// either way.
function SearchBar({ filterText, setFilterText, knownGliders }) {
  // Opens on focus/tap into the search field itself (no separate button
  // needed) and stays independent state from then on — it does NOT close
  // again just because the field's text changes, since that caused the
  // panel to flicker open/closed on every keystroke. Closing only happens
  // via the explicit ✓ button below.
  const [advOpen, setAdvOpen] = useState(false);
  const [rows, setRows] = useState(() => parseQueryToRows(filterText));

  const applyRows = (nextRows) => {
    setRows(nextRows);
    setFilterText(buildAdvancedQuery(nextRows));
  };
  const updateRow = (idx, patch) => applyRows(rows.map((r,i)=> i===idx ? {...r, ...patch} : r));
  const addRow = () => applyRows([...rows, newSearchRow()]);
  const removeRow = (idx) => {
    const next = rows.filter((_,i)=>i!==idx);
    applyRows(next.length ? next : [newSearchRow()]);
  };

  return (
    <div style={{position:"relative"}}>
      <div style={{position:"relative"}}>
        <input value={filterText} onChange={e=>setFilterText(e.target.value)} onFocus={()=>setAdvOpen(true)} placeholder="🔍 Suchen…"
          style={{width:"100%",background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"8px 34px 8px 12px",color:"#e8f4fd",fontSize:13,boxSizing:"border-box"}} />
        {filterText && (
          <button onClick={()=>setFilterText("")}
            style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"rgba(232,244,253,0.4)",cursor:"pointer",fontSize:14}}>✕</button>
        )}
      </div>

      {advOpen && (
        <div style={{position:"absolute",top:"calc(100% + 8px)",left:0,width:"min(92vw, 420px)",zIndex:2000,background:"#0f1f36",boxShadow:"0 12px 32px rgba(0,0,0,0.5)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:10}}>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {rows.map((row, idx) => {
              const fieldDef = SEARCH_FIELDS.find(f=>f.id===row.field);
              return (
                <div key={idx} style={{display:"flex",gap:6,alignItems:"center"}}>
                  {idx===0 ? (
                    <span style={{minWidth:34,flexShrink:0}} />
                  ) : (
                    <button onClick={()=>updateRow(idx,{connector: row.connector==="OR" ? "AND" : "OR"})}
                      title="UND/ODER für diese Zeile umschalten"
                      style={{fontSize:10,fontWeight:700,minWidth:34,textAlign:"center",flexShrink:0,background:row.connector==="OR"?"rgba(167,139,250,0.18)":"rgba(125,211,252,0.15)",border:`1px solid ${row.connector==="OR"?"rgba(167,139,250,0.4)":"rgba(125,211,252,0.35)"}`,borderRadius:6,padding:"4px 2px",color:row.connector==="OR"?"#a78bfa":"#7dd3fc",cursor:"pointer"}}>
                      {row.connector==="OR" ? "ODER" : "UND"}
                    </button>
                  )}
                  <select value={row.field}
                    onChange={e=>{
                      const nf = SEARCH_FIELDS.find(f=>f.id===e.target.value);
                      const isNum = nf?.type==="number"||nf?.type==="date"||nf?.type==="time";
                      const isBool = nf?.type==="bool";
                      updateRow(idx, { field: e.target.value, op: isNum ? "=" : ":", value2: undefined, value: isBool ? "ja" : "" });
                    }}
                    style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"5px 4px",color:"#e8f4fd",fontSize:12,minWidth:0}}>
                    {SEARCH_FIELDS.map(f=><option key={f.id} value={f.id} style={{background:"#0a1628"}}>{f.label}</option>)}
                  </select>
                  {(() => {
                    if (fieldDef?.type === "bool") return null;
                    const isNumeric = fieldDef?.type === "number" || fieldDef?.type === "date" || fieldDef?.type === "time";
                    const ops = isNumeric ? ADV_OPS_NUM : ADV_OPS_TEXT;
                    return (
                      <select value={row.op || (isNumeric ? "=" : ":")} onChange={e=>updateRow(idx,{op:e.target.value})}
                        style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"5px 2px",color:"#e8f4fd",fontSize:12,width:isNumeric?68:44,flexShrink:0}}>
                        {ops.map(o=><option key={o} value={o} style={{background:"#0a1628"}}>{o==="between"?"zw.":o}</option>)}
                      </select>
                    );
                  })()}
                  {fieldDef?.type === "bool" ? (
                    <select value={row.value||"ja"} onChange={e=>updateRow(idx,{value:e.target.value})}
                      style={{flex:1,minWidth:0,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"5px 8px",color:"#e8f4fd",fontSize:12}}>
                      {BOOL_OPTIONS.map(o=><option key={o.value} value={o.value} style={{background:"#0a1628"}}>{o.label}</option>)}
                    </select>
                  ) : (
                  <input value={row.value==="*"?"":row.value} onChange={e=>updateRow(idx,{value:e.target.value})}
                    placeholder={row.op==="between" ? "von…" : "Wert…"}
                    disabled={row.value==="*"}
                    list={row.field==="glider" && knownGliders?.length ? "glider-datalist" : undefined}
                    style={{flex:1,minWidth:0,background:row.value==="*"?"rgba(255,255,255,0.03)":"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"5px 8px",color:"#e8f4fd",fontSize:12}} />
                  )}
                  {row.op==="between" && (
                    <input value={row.value2||""} onChange={e=>updateRow(idx,{value2:e.target.value})} placeholder="bis…"
                      style={{flex:1,minWidth:0,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"5px 8px",color:"#e8f4fd",fontSize:12}} />
                  )}
                  <button onClick={()=>removeRow(idx)} style={{background:"none",border:"none",color:"rgba(232,244,253,0.35)",cursor:"pointer",fontSize:14,padding:"0 2px",flexShrink:0}}>✕</button>
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
            <button onClick={addRow} style={{background:"rgba(125,211,252,0.12)",border:"1px solid rgba(125,211,252,0.3)",borderRadius:8,padding:"5px 10px",color:"#7dd3fc",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Zeile</button>
            <button onClick={()=>setAdvOpen(false)} title="Schliessen"
              style={{background:"rgba(34,197,94,0.18)",border:"1px solid rgba(34,197,94,0.4)",borderRadius:8,width:30,height:30,color:"#4ade80",fontSize:14,fontWeight:900,cursor:"pointer",flexShrink:0}}>✓</button>
          </div>
        </div>
      )}
      {knownGliders?.length > 0 && (
        <datalist id="glider-datalist">
          {knownGliders.map(g => <option key={g} value={g} />)}
        </datalist>
      )}
    </div>
  );
}

// ── FLIGHT RENUMBERING (chronological, gapless) ────────────────────────────
// Preserves whatever prefix/suffix text surrounds the embedded number in a
// flight's name (e.g. "Flug 42" -> "Flug 57"), so only the number itself
// changes when a date edit shifts a flight's position in the timeline.
function renumberFlightName(name, newNumber) {
  if (!name) return String(newNumber);
  const m = name.match(/\d+/);
  if (!m) return `${name} ${newNumber}`;
  return name.slice(0, m.index) + String(newNumber) + name.slice(m.index + m[0].length);
}
// Re-sorts ALL flights chronologically (date + start time) and reassigns a
// gapless 1..N numbering to every one of them, keeping each flight's own
// name style intact. Used whenever any flight's date changes, since that
// can shift its position relative to every other flight, not just itself.
function renumberAllFlights(flights) {
  const sorted = [...flights].sort((a,b) =>
    parseDateToTs(a.date||a.rawDate, a.startTime) - parseDateToTs(b.date||b.rawDate, b.startTime));
  const numberById = new Map(sorted.map((f,i)=>[f.id, i+1]));
  return flights.map(f => ({ ...f, name: renumberFlightName(f.name, numberById.get(f.id)) }));
}

function CoordEdit({lat, lon, alt, color, onSave}) {
  const [editing, setEditing] = useState(false);
  const [combined, setCombined] = useState(lat!=null&&lon!=null ? `${lat}, ${lon}` : "");
  const [al, setAl] = useState(alt!=null&&alt>0?String(alt):"");
  // Parses either "47.219903, 8.453543" or "41.86336° 21.52994°" (and
  // anything in between, e.g. no comma, no degree signs, extra spaces) —
  // strip degree symbols, then split on any run of commas/whitespace and
  // take the first two numbers as lat/lon.
  const parseLatLon = (str) => {
    if (!str) return null;
    const tokens = str.replace(/°/g, " ").split(/[,\s]+/).map(t=>t.trim()).filter(Boolean);
    if (tokens.length < 2) return null;
    const plat = parseFloat(tokens[0]);
    const plon = parseFloat(tokens[1]);
    if (isNaN(plat) || isNaN(plon)) return null;
    return { lat: plat, lon: plon };
  };
  const start = () => {
    setCombined(lat!=null&&lon!=null ? `${lat}, ${lon}` : "");
    setAl(alt!=null&&alt>0?String(alt):"");
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const parsed = parseLatLon(combined);
    const nalt = al.trim()===""?0:parseInt(al,10);
    onSave(parsed ? parsed.lat : null, parsed ? parsed.lon : null, isNaN(nalt)?0:nalt);
  };
  const iStyle = {width:"100%",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(125,211,252,0.4)",borderRadius:6,padding:"3px 6px",color:"#e8f4fd",fontSize:11,fontFamily:"monospace",boxSizing:"border-box",marginBottom:3};
  if (editing) {
    return (
      <div>
        <input value={combined} onChange={e=>setCombined(e.target.value)} placeholder="Lat, Lon (z.B. 47.21990, 8.45354) — leer = löschen" autoFocus style={iStyle}
          onKeyDown={e=>{ if(e.key==="Enter"){e.preventDefault();commit();} }} />
        <input value={al} onChange={e=>setAl(e.target.value)} placeholder="müM" style={iStyle}
          onKeyDown={e=>{ if(e.key==="Enter"){e.preventDefault();commit();} }} />
        <button onClick={commit} style={{width:"100%",background:"rgba(125,211,252,0.15)",border:"1px solid rgba(125,211,252,0.3)",borderRadius:6,padding:"3px",color:"#7dd3fc",fontSize:10,cursor:"pointer"}}>✓ Speichern</button>
      </div>
    );
  }
  return (
    <div onClick={start} style={{cursor:"pointer"}}>
      {(lat!=null&&lon!=null) ? (
        <div style={{fontSize:11,color:"rgba(232,244,253,0.7)",fontFamily:"monospace"}}>
          {lat.toFixed(5)}° N<br/>{lon.toFixed(5)}° E
        </div>
      ) : (
        <div style={{fontSize:11,color:"rgba(232,244,253,0.3)",fontFamily:"monospace"}}>— tippen zum Erfassen —</div>
      )}
      {alt>0 && <div style={{fontSize:10,color:color,opacity:0.6,marginTop:3}}>{alt} m ü.M.</div>}
    </div>
  );
}

function EditableTitle({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value||"");
  const commit = () => { setEditing(false); if(val.trim()!==(value||"") && val.trim()!=="") onSave(val.trim()); };
  if (editing) {
    return (
      <input value={val} onChange={e=>setVal(e.target.value)} onBlur={commit} autoFocus
        onKeyDown={e=>{ if(e.key==="Enter"){e.preventDefault();commit();} }}
        style={{fontSize:22,fontWeight:800,marginBottom:4,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(125,211,252,0.4)",borderRadius:8,padding:"2px 8px",color:"#e8f4fd",width:"100%",boxSizing:"border-box"}} />
    );
  }
  return (
    <div onClick={()=>{setVal(value||"");setEditing(true);}} style={{fontSize:22,fontWeight:800,marginBottom:4,cursor:"pointer"}}>
      {value||"—"}
    </div>
  );
}

function StaticField({label, value, unit}) {
  return (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
      <span style={{fontSize:13,color:"rgba(232,244,253,0.45)",minWidth:90}}>{label}</span>
      <span style={{fontSize:13,fontWeight:500,color:value?"#e8f4fd":"rgba(232,244,253,0.25)",textAlign:"right"}}>
        {value ? value+(unit?" "+unit:"") : "—"}
      </span>
    </div>
  );
}

function InlineField({label, value, onSave, multiline, unit}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value||"");
  const committedByEnter = useRef(false);
  const commit = () => {
    if (committedByEnter.current) { committedByEnter.current = false; return; }
    setEditing(false);
    if(val!==(value||"")) onSave(val);
  };
  const commitAndAdvance = (e) => {
    committedByEnter.current = true; // tell the upcoming blur event to no-op
    setEditing(false);
    if(val!==(value||"")) onSave(val);
    const row = e.target.closest("[data-inline-row]");
    const allRows = [...document.querySelectorAll("[data-inline-row]")];
    const idx = allRows.indexOf(row);
    // Wait for React to finish re-rendering this row back into its
    // "trigger" (span) state before looking for the next row's input,
    // otherwise we're searching a stale DOM snapshot. requestAnimationFrame
    // runs after the browser's next paint, which is reliably after the
    // state update has been committed to the DOM.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (let i = idx + 1; i < allRows.length; i++) {
          const nextRow = allRows[i];
          const trigger = nextRow?.querySelector("[data-inline-field-trigger]");
          const select = nextRow?.querySelector("select");
          if (trigger) { trigger.click(); return; }
          if (select) { select.focus(); return; } // e.g. ReiseSelect has no trigger span
        }
      });
    });
  };
  return (
    <div data-inline-row style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
      <span style={{fontSize:13,color:"rgba(232,244,253,0.45)",minWidth:90}}>{label}</span>
      {editing ? (
        multiline
          ? <textarea value={val} onChange={e=>setVal(e.target.value)} onBlur={commit} autoFocus
              style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(125,211,252,0.4)",borderRadius:8,padding:"4px 8px",color:"#e8f4fd",fontSize:13,resize:"vertical",minHeight:48}} />
          : <input value={val} onChange={e=>setVal(e.target.value)} onBlur={commit} autoFocus
              data-inline-field
              onKeyDown={e=>{
                if(e.key==="Enter"){
                  e.preventDefault();
                  commitAndAdvance(e);
                }
              }}
              style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(125,211,252,0.4)",borderRadius:8,padding:"4px 8px",color:"#e8f4fd",fontSize:13,textAlign:"right"}} />
      ) : (
        <span data-inline-field-trigger onClick={()=>{setVal(value||"");setEditing(true);}}
          style={{fontSize:13,fontWeight:500,color:value?"#e8f4fd":"rgba(232,244,253,0.25)",cursor:"pointer",minWidth:60,textAlign:"right"}}>
          {value||(unit?"— "+unit:"—")}
        </span>
      )}
    </div>
  );
}

// Text field with spreadsheet-style inline autocomplete (like Numbers/Excel
// suggesting a matching earlier entry as you type, with the suggested
// remainder shown selected so continuing to type overwrites it, and
// Enter/Tab accepts it) — used for Startplatz/Landeplatz so a long list of
// previously-used places never has to be scrolled through; only the single
// best-matching suggestion appears, inline, as part of the text itself.
function PlaceInlineField({label, value, onSave, suggestions, flights, kind}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value||"");
  const inputRef = useRef(null);
  const committedByEnter = useRef(false);

  const applySuggestion = (typed) => {
    if (!typed) return typed;
    const match = suggestions.find(s => s.toLowerCase().startsWith(typed.toLowerCase()) && s.length > typed.length);
    return match || typed;
  };

  const prevLen = useRef((value||"").length);
  const onChange = (e) => {
    const typed = e.target.value;
    const isDeleting = typed.length < prevLen.current;
    prevLen.current = typed.length;
    if (isDeleting) {
      // Backspace/Delete: respect exactly what's left, no re-suggesting —
      // otherwise the suggested tail would be immediately re-appended and
      // the field could never be shortened or cleared.
      setVal(typed);
      return;
    }
    const suggested = applySuggestion(typed);
    setVal(suggested);
    prevLen.current = suggested.length;
    // Select the auto-completed remainder so the next keystroke naturally
    // overwrites it (matching how Numbers/Excel/Sheets handle this), rather
    // than the person having to manually delete the suggested tail.
    if (suggested !== typed) {
      requestAnimationFrame(() => {
        inputRef.current?.setSelectionRange(typed.length, suggested.length);
      });
    }
  };

  // When the accepted place name matches one already used elsewhere, pull
  // that place's coordinates and altitude so the person doesn't have to
  // re-enter data that's already known for that place. If different
  // flights recorded DIFFERENT coordinates for the same name (typo'd
  // duplicate entry, GPS drift, etc.), that's ambiguous — don't silently
  // guess, ask which one to use instead.
  const [coordChoice, setCoordChoice] = useState(null); // { name, candidates } | null
  const findPlaceCandidates = (name) => {
    if (!name || !flights) return [];
    const matches = flights
      .filter(f => (kind === "start" ? f.site : f.customFields?.landung) === name)
      .filter(f => kind === "start" ? f.startPt : f.endPt)
      .sort((a,b) => parseDateToTs(b.date||b.rawDate) - parseDateToTs(a.date||a.rawDate));
    const seen = new Map(); // "lat,lon,alt" -> candidate
    for (const f of matches) {
      const pt = kind === "start" ? f.startPt : f.endPt;
      const alt = kind === "start" ? f.startAlt : f.endAlt;
      const key = `${pt.lat.toFixed(5)},${pt.lon.toFixed(5)},${alt||0}`;
      if (!seen.has(key)) seen.set(key, { pt, alt, date: f.date, flightName: f.name });
    }
    return [...seen.values()];
  };
  const findPlaceExtras = (name) => {
    const candidates = findPlaceCandidates(name);
    if (!candidates.length) return null;
    return candidates[0]; // single distinct match (or the most recent — see coordChoice for the ambiguous case)
  };

  const commitValue = (name) => {
    const candidates = findPlaceCandidates(name);
    if (candidates.length > 1) {
      onSave(name, null); // save the name now; coordinates follow once chosen
      setCoordChoice({ name, candidates });
    } else {
      onSave(name, candidates[0] || null);
    }
  };
  const commit = () => {
    if (committedByEnter.current) { committedByEnter.current = false; return; }
    setEditing(false);
    if(val!==(value||"")) commitValue(val);
  };
  const commitAndAdvance = (e) => {
    committedByEnter.current = true;
    setEditing(false);
    if(val!==(value||"")) commitValue(val);
    const row = e.target.closest("[data-inline-row]");
    const allRows = [...document.querySelectorAll("[data-inline-row]")];
    const idx = allRows.indexOf(row);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (let i = idx + 1; i < allRows.length; i++) {
          const nextRow = allRows[i];
          const trigger = nextRow?.querySelector("[data-inline-field-trigger]");
          const select = nextRow?.querySelector("select");
          if (trigger) { trigger.click(); return; }
          if (select) { select.focus(); return; }
        }
      });
    });
  };

  return (
    <div data-inline-row style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.04)",position:"relative"}}>
      <span style={{fontSize:13,color:"rgba(232,244,253,0.45)",minWidth:90}}>{label}</span>
      {editing ? (
        <input ref={inputRef} value={val} onChange={onChange} onBlur={commit} autoFocus
          data-inline-field
          onKeyDown={e=>{
            if(e.key==="Enter"||e.key==="Tab"){
              e.preventDefault();
              commitAndAdvance(e);
            }
          }}
          style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(125,211,252,0.4)",borderRadius:8,padding:"4px 8px",color:"#e8f4fd",fontSize:13,textAlign:"right"}} />
      ) : (
        <span data-inline-field-trigger onClick={()=>{setVal(value||"");setEditing(true);}}
          style={{fontSize:13,fontWeight:500,color:value?"#e8f4fd":"rgba(232,244,253,0.25)",cursor:"pointer",minWidth:60,textAlign:"right"}}>
          {value||"—"}
        </span>
      )}
      {coordChoice && (
        <div onClick={()=>setCoordChoice(null)}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:250,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:"#14253a",borderRadius:16,padding:"18px 20px",maxWidth:340,width:"100%",border:"1px solid rgba(255,255,255,0.1)"}}>
            <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>Mehrere Koordinaten für "{coordChoice.name}"</div>
            <div style={{fontSize:12,color:"rgba(232,244,253,0.5)",marginBottom:14}}>Welche soll für diesen Flug gelten?</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {coordChoice.candidates.map((c,i)=>(
                <button key={i} onClick={()=>{ onSave(coordChoice.name, c); setCoordChoice(null); }}
                  style={{textAlign:"left",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"10px 12px",color:"#e8f4fd",cursor:"pointer"}}>
                  <div style={{fontSize:13,fontWeight:700,fontFamily:"monospace"}}>{c.pt.lat.toFixed(5)}, {c.pt.lon.toFixed(5)}</div>
                  <div style={{fontSize:11,color:"rgba(232,244,253,0.5)",marginTop:2}}>{c.alt||0} m müM · zuletzt bei {c.flightName} ({c.date})</div>
                </button>
              ))}
              <button onClick={()=>setCoordChoice(null)}
                style={{textAlign:"center",background:"none",border:"none",color:"rgba(232,244,253,0.4)",fontSize:12,cursor:"pointer",marginTop:2}}>
                Keine übernehmen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Dropdown for assigning a flight to a Reise (travel). The list of
// selectable names comes directly from every reise value already used
// across all recorded flights (same pattern as the Startplatz-/
// Landeplatz-suggestions elsewhere in the detail view) — not from a
// separately maintained list, which used to leave this dropdown looking
// almost empty ("nur '+ Neue Reise…'") whenever a flight's reise value
// came in some other way than being typed through this exact component
// (e.g. via Excel/CSV-Import).
function ReiseSelect({ value, onSave, flights }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const names = useMemo(() => {
    const fromFlights = (flights||[]).map(f => f.customFields?.reise).filter(Boolean);
    return [...new Set(fromFlights)].sort((a,b) => a.localeCompare(b, "de"));
  }, [flights]);
  // The current value must always be selectable, even if this flight is
  // the only one with it (e.g. just typed via "+ Neue Reise…") — otherwise
  // the browser silently falls back to the first <option> ("—"), making
  // the field look empty even though the value is still stored correctly.
  const options = value && !names.includes(value) ? [value, ...names] : names;

  const commitNewName = () => {
    const trimmed = newName.trim();
    setAdding(false); setNewName("");
    if (!trimmed) return;
    onSave(trimmed);
  };

  if (adding) {
    return (
      <div data-inline-row style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
        <span style={{fontSize:13,color:"rgba(232,244,253,0.45)",minWidth:90}}>Reise</span>
        <input value={newName} onChange={e=>setNewName(e.target.value)} autoFocus
          placeholder="Name der Reise…"
          onKeyDown={e=>{ if(e.key==="Enter") commitNewName(); if(e.key==="Escape"){setAdding(false);setNewName("");} }}
          onBlur={commitNewName}
          style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"4px 8px",color:"#e8f4fd",fontSize:13,textAlign:"left",maxWidth:180,boxSizing:"border-box"}} />
      </div>
    );
  }

  return (
    <div data-inline-row style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
      <span style={{fontSize:13,color:"rgba(232,244,253,0.45)",minWidth:90}}>Reise</span>
      <select value={value||""} onChange={e=>{ if(e.target.value==="__NEW__"){ setAdding(true); } else { onSave(e.target.value); } }}
        style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"4px 8px",color:value?"#e8f4fd":"rgba(232,244,253,0.4)",fontSize:13,textAlign:"left",maxWidth:180}}>
        <option value="" style={{background:"#0a1628"}}>—</option>
        {options.map(n => <option key={n} value={n} style={{background:"#0a1628"}}>{n}</option>)}
        <option value="__NEW__" style={{background:"#0a1628",color:"#4ade80"}}>+ Neue Reise…</option>
      </select>
    </div>
  );
}

// Dropdown for selecting the glider used on a flight — sourced from the
// new "Schirme"-Seite (schirme:list, reachable via Service), which lists
// one entry per distinct Schirm-Name actually used across the flights.
// Also still reads the older "service:schirme" key (4 category tabs) if
// present, for backward compatibility with names entered there before the
// Schirme-Seite existed.
function SchirmSelect({ value, onSave, extra }) {
  const [names, setNames] = useState([]);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    (async () => {
      const combined = new Set();
      try {
        const r = await window.storage.get("schirme:list");
        if (r) {
          const list = JSON.parse(r.value) || [];
          list.forEach(s => { if (s?.name) combined.add(String(s.name).trim()); });
        }
      } catch {}
      try {
        const r2 = await window.storage.get("service:schirme");
        if (r2) {
          const schirme = JSON.parse(r2.value) || {};
          Object.values(schirme).forEach(s => { if (s?.name) combined.add(String(s.name).trim()); });
        }
      } catch {}
      setNames([...combined].filter(Boolean).sort((a,b)=>a.localeCompare(b,"de")));
    })();
  }, []);

  // The current value must always be selectable, even if it isn't among the
  // registered Schirme on the Service page (e.g. older/imported flights, or
  // a glider that was since renamed/removed there) — otherwise the browser
  // silently falls back to the first <option> ("—"), making the field look
  // empty even though the imported name is still there.
  const options = value && !names.includes(value) ? [value, ...names] : names;

  if (!editing) {
    return (
      <div data-inline-row onClick={()=>setEditing(true)}
        style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.04)",cursor:"pointer"}}>
        <span style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:13,color:"rgba(232,244,253,0.45)",minWidth:90}}>Schirm</span>
          {extra}
        </span>
        <span style={{fontSize:13,color:value?"#e8f4fd":"rgba(232,244,253,0.4)"}}>{value || "—"}</span>
      </div>
    );
  }

  return (
    <div data-inline-row style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
      <span style={{fontSize:13,color:"rgba(232,244,253,0.45)",minWidth:90}}>Schirm</span>
      <select value={value||""} autoFocus onBlur={()=>setEditing(false)}
        onChange={e=>{ onSave(e.target.value); setEditing(false); }}
        style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"4px 8px",color:value?"#e8f4fd":"rgba(232,244,253,0.4)",fontSize:13,textAlign:"left",maxWidth:180}}>
        <option value="" style={{background:"#0a1628"}}>—</option>
        {options.map(n => <option key={n} value={n} style={{background:"#0a1628"}}>{n}</option>)}
      </select>
    </div>
  );
}



function DetailContent({ fl, flights, navFlights, customFieldDefs, setFlights, setSelected, setView, setEditData, saveFlight, showFieldEditor, setShowFieldEditor, handleSaveFields, confirmDelete, setConfirmDelete, hideBackButton, isWide, returnTo, mapTilerKey }) {

    const autoFields = customFieldDefs.filter(d=>d.formula).map(d=>({...d, value:evalFormula(d.formula,fl,flights)}));
    const manualFields = customFieldDefs.filter(d=>!d.formula);
    // Swipe navigation walks navFlights (the active search's results, when
    // a search is active) rather than the full flights list — so swiping
    // through a filtered result stays within those results instead of
    // jumping out to the whole flugbuch.
    const navList = navFlights || flights;
    const flIdx = navList.findIndex(f=>f.id===fl.id);

    // "Typ" is only shown when it has content; this tracks a manual reveal
    // via the discreet "+ Typ" link for entering it the first time, reset
    // whenever the person moves to a different flight.
    const [typRevealed, setTypRevealed] = useState(false);
    const [confirmTypAuto, setConfirmTypAuto] = useState(null); // computed value pending confirmation, or null
    useEffect(() => { setTypRevealed(false); setConfirmTypAuto(null); }, [fl.id]);

    // Swipe-to-navigate: replaces the small prev/next arrow buttons. Swipe
    // left moves to the next flight in the list (same direction as the old
    // "◀" button, which incremented flIdx), swipe right moves to the
    // previous one (same as "▶", which decremented flIdx). Requires the
    // horizontal movement to clearly dominate over vertical movement so a
    // normal vertical scroll of the page is never mistaken for a swipe.
    const touchStart = useRef(null);
    const goToFlight = (delta) => {
      const next = navList[flIdx + delta];
      if (!next) return;
      setSelected(next);
    };
    const onTouchStart = (e) => {
      if (profileZoomActive || e.target.closest?.('[data-no-swipe]')) { touchStart.current = null; return; }
      const t = e.touches[0];
      touchStart.current = { x: t.clientX, y: t.clientY };
    };
    const onTouchEnd = (e) => {
      if (!touchStart.current || profileZoomActive) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStart.current.x;
      const dy = t.clientY - touchStart.current.y;
      touchStart.current = null;
      const SWIPE_THRESHOLD = 60; // px
      if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) goToFlight(-1); // swipe left -> previous flight
      else goToFlight(1);         // swipe right -> next flight
    };

    // Inline save helper
    const saveField = async (patch) => {
      const upd = { ...fl, ...patch,
        customFields: { ...(fl.customFields||{}), ...(patch.customFields||{}) } };
      const result = await saveFlight(upd);
      // Bei einem tatsächlich fehlgeschlagenen Speichern (z.B. ein
      // zirkuläres Objekt in customFields, das JSON.stringify zum Werfen
      // bringt) den lokalen State bewusst NICHT aktualisieren — sonst zeigt
      // die UI einen Wert als gespeichert an, der es nie wurde (siehe Chat
      // vom 2026-08-29). Stattdessen sichtbar warnen, auch ohne
      // Browser-Konsole erreichbar (z.B. am Handy).
      if (!result.ok) {
        alert("Speichern fehlgeschlagen — die Änderung wurde NICHT übernommen.\n\nFehler: " + (result.error?.message || String(result.error)));
        return;
      }
      setFlights(p=>p.map(f=>f.id===upd.id?upd:f));
      setSelected(upd);
    };
    // "Typ" defaults to "GS" but stays freely editable — customFields.typAuto
    // tracks whether the current value is still the app's own default one.
    // A manual edit via the InlineField below (which always sets
    // typAuto:false) permanently stops the auto-updates for that flight.
    // New/manually-entered flights (no recognizable CSV origin) and any
    // flight with no typ at all are safe to auto-manage right away — there
    // is nothing meaningful to lose. A CSV-imported flight (pdfOnly) that
    // already carries a real Typ value from that import is different: that
    // value might be a deliberate, more specific category than this app's
    // buckets, so it's never silently overwritten — the person is asked
    // once via a confirmation dialog, and either choice ("Automatisch" or
    // "Beibehalten") is then remembered via typAuto for that flight.
    useEffect(() => {
      const computed = "GS";
      const cf = fl.customFields || {};
      if (cf.typAuto === false) return;
      if (cf.typ === computed) return;
      if (cf.typAuto === true) { saveField({ customFields: { typ: computed, typAuto: true } }); return; }
      const hasExistingCsvTyp = !!fl.pdfOnly && !!cf.typ;
      if (hasExistingCsvTyp) { setConfirmTypAuto(computed); }
      else { saveField({ customFields: { typ: computed, typAuto: true } }); }
    }, [fl.id]);
    // Same as saveField, but for fields that feed into Dauer/H.Diff./Ø Speed
    // (start/end time, start/end altitude, distance). For manually-entered
    // flights with no IGC track — where these values aren't already derived
    // from precise GPS data — recompute the three derived fields from
    // whatever raw inputs are now available, the same way a spreadsheet
    // would live-update a formula cell. Flights with a real IGC track keep
    // their track-derived values untouched, since those are more accurate
    // than anything time/altitude fields alone could give us.
    const saveComputedField = async (currentFl, patch) => {
      const upd = { ...currentFl, ...patch,
        customFields: { ...(currentFl.customFields||{}), ...(patch.customFields||{}) } };
      // Dauer and H.Diff. are always derived live from Startzeit/Landezeit
      // and Start-/Landeplatz-Höhe respectively — including for flights
      // with a real IGC track, so editing those fields by hand afterwards
      // keeps Dauer/H.Diff. in sync instead of leaving them frozen at
      // whatever the original import happened to compute. Distanz is the
      // one exception and stays purely manual: IGC-derived distance wasn't
      // reliable enough to trust, so it's never auto-filled or recomputed
      // here regardless of what else changes.
      const startTs = parseDateToTs(upd.date || upd.rawDate, upd.startTime);
      const endTs = parseDateToTs(upd.date || upd.rawDate, upd.endTime);
      if (upd.startTime && upd.endTime) {
        let diffSec = Math.round((endTs - startTs) / 1000);
        if (diffSec < 0) diffSec += 24*3600; // landing past midnight
        if (diffSec > 0) {
          upd.durationSec = diffSec;
          upd.durationStr = formatDurationHM(diffSec);
        }
      }
      const startAltNum = +upd.startAlt || +(upd.customFields?.msa||0) || 0;
      const endAltNum = +upd.endAlt || +(upd.customFields?.ml||0) || 0;
      if (startAltNum && endAltNum) {
        upd.customFields = { ...upd.customFields, hDiff: String(Math.abs(startAltNum - endAltNum)) };
      }
      const distNum = parseFloat(upd.totalDist || upd.customFields?.distKm || upd.customFields?.dk || 0);
      if (distNum > 0 && upd.durationSec > 0) {
        const kmh = distNum / (upd.durationSec / 3600);
        upd.customFields = { ...upd.customFields, kmh: kmh.toFixed(1) };
      }
      const result = await saveFlight(upd);
      // Siehe saveField oben — bei tatsächlichem Fehlschlag den lokalen
      // State nicht aktualisieren, sonst zeigt die UI einen nie
      // gespeicherten Wert als gespeichert an.
      if (!result.ok) {
        alert("Speichern fehlgeschlagen — die Änderung wurde NICHT übernommen.\n\nFehler: " + (result.error?.message || String(result.error)));
        return;
      }
      setFlights(p=>p.map(f=>f.id===upd.id?upd:f));
      setSelected(upd);
    };
    const [notesEditing, setNotesEditing] = useState(false);
    const [profileRange, setProfileRange] = useState(null);
    const [playbackDistance, setPlaybackDistance] = useState(null);
    // Map and profile each keep owning their own controls' state, but the
    // actual buttons render into this shared slot below the profile
    // (via portals) instead of their original positions between map and
    // profile — the ref-callback + state dance is just to trigger a
    // re-render once the slot DOM node actually exists, since a plain ref
    // is still null on the very first render.
    const [controlsSlotEl, setControlsSlotEl] = useState(null);
    const controlsSlotRef = useCallback(node => { if (node) setControlsSlotEl(node); }, []);
    const [isPlaybackActive, setIsPlaybackActive] = useState(false);
    const [playbackPhase, setPlaybackPhase] = useState("flight");
    const [tileConfig, setTileConfig] = useState(DEFAULT_TILE_KEYS);
    const [tilePickerIdx, setTilePickerIdx] = useState(null);
    useEffect(() => {
      (async () => {
        try {
          const r = await window.storage.get("settings:tileConfig");
          if (r) {
            const arr = JSON.parse(r.value);
            if (Array.isArray(arr) && arr.length === 9) setTileConfig(arr);
          }
        } catch {}
      })();
    }, []);
    const saveTileConfig = async (next) => {
      setTileConfig(next);
      try { await window.storage.set("settings:tileConfig", JSON.stringify(next)); } catch {}
    };
    const [notesVal, setNotesVal] = useState(fl.notes||"");
    const commitNotes = () => {
      setNotesEditing(false);
      if (notesVal !== (fl.notes||"")) saveField({notes: notesVal});
    };
    // Editing the date can move this flight to a different point in the
    // overall chronological order, so — unlike the other inline fields —
    // this doesn't just save the one flight: it re-sorts ALL flights by
    // date/time and reassigns gapless sequential numbers to every one of
    // them (keeping each flight's own name style, just swapping the
    // number), then persists only the flights whose number actually
    // changed as a result.
    const saveDateField = async (newDateStr) => {
      const withUpdated = flights.map(f => f.id===fl.id ? { ...f, date: newDateStr } : f);
      const renumbered = renumberAllFlights(withUpdated);
      await Promise.all(renumbered.map((f, i) => {
        if (f.name !== withUpdated[i].name || f.id === fl.id) {
          return saveFlight(f).catch(()=>{});
        }
        return null;
      }));
      setFlights(renumbered);
      const newSelected = renumbered.find(f => f.id === fl.id);
      if (newSelected) setSelected(newSelected);
    };
    // Both Datum (indirectly, via renumberAllFlights above) and der
    // Flugname/-nummer selbst (EditableTitle) ändern die Nummerierung —
    // genau das, was die letzte Nummerierungs-Verschiebung im Backup
    // verursacht hat. Beide laufen deshalb über eine explizite
    // Bestätigung, statt sofort beim Verlassen des Feldes zu speichern.
    const [confirmDateChange, setConfirmDateChange] = useState(null); // newDateStr | null
    const [confirmNameChange, setConfirmNameChange] = useState(null); // newName | null
    // Consolidated delete: one 🗑 tile opens a small menu choosing what to
    // remove (IGC track / whole flight) instead of separate buttons for each.
    const [showDeleteMenu, setShowDeleteMenu] = useState(false);
    const [confirmDeleteKind, setConfirmDeleteKind] = useState(null); // null | "igc" | "all"
    const deleteTrack = async () => {
      const upd = { ...fl, track: [] };
      await saveFlight(upd);
      setFlights(p=>p.map(f=>f.id===upd.id?upd:f));
      setSelected(upd);
      setConfirmDeleteKind(null);
    };

    return (
      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
        style={{maxWidth:isWide?1100:480,margin:"0 auto",padding:"0 0 32px",background:"#040e20",minHeight:"100vh",color:"#e8f4fd",fontFamily:"system-ui,sans-serif"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"calc(16px + env(safe-area-inset-top, 0px)) 16px 10px"}}>
          {!hideBackButton && <button onClick={()=>{ if (returnTo) { window.location.href = returnTo; } else { setView("list"); } }} style={{background:"none",border:"none",color:"#7dd3fc",fontSize:22,cursor:"pointer"}}>←</button>}
          {hideBackButton && <button onClick={()=>{ if (returnTo) { window.location.href = returnTo; } else { setView("list"); } }} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:20,padding:"6px 14px",color:"rgba(232,244,253,0.6)",fontSize:13,cursor:"pointer"}}>✕ Liste</button>}
          <div style={{display:"flex",gap:5,flexWrap:"wrap",justifyContent:"flex-end"}}>
            {fl.track?.length > 1 && (
              <button onClick={()=>{
                const t = fl.track;
                const d = fl.rawDate||fl.date||"";
                const parts = d.split(".");
                const dateStr = parts.length===3 ? parts[0].padStart(2,"0")+parts[1].padStart(2,"0")+parts[2].slice(-2) : "010101";
                const fmtTime = s => { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60; return String(h).padStart(2,"0")+String(m).padStart(2,"0")+String(sec).padStart(2,"0"); };
                const fmtLat = lat => { const a=Math.abs(lat),d=Math.floor(a),m=(a-d)*60000; return String(d).padStart(2,"0")+String(Math.round(m)).padStart(5,"0")+(lat>=0?"N":"S"); };
                const fmtLon = lon => { const a=Math.abs(lon),d=Math.floor(a),m=(a-d)*60000; return String(d).padStart(3,"0")+String(Math.round(m)).padStart(5,"0")+(lon>=0?"E":"W"); };
                const NL = "\r\n";
                let igc = "AXXX"+NL+"HFDTE"+dateStr+NL;
                igc += "HFPLTPILOTINCHARGE:"+(fl.pilot||"")+NL;
                igc += "HFGTYGLIDERTYPE:"+(fl.glider||"")+NL;
                igc += "HFGIDGLIDERID:"+NL;
                for (const p of t) {
                  const ts = fmtTime(p.timeSec||0);
                  const alt = Math.round(p.gpsAlt||0);
                  igc += "B"+ts+fmtLat(p.lat)+fmtLon(p.lon)+"A"+String(alt).padStart(5,"0")+String(alt).padStart(5,"0")+NL;
                }
                // application/octet-stream statt text/plain — sonst hängen
                // manche Browser beim Speichern eigenmächtig ".txt" an den
                // (bereits korrekten) ".igc"-Dateinamen an.
                const blob = new Blob([igc], { type: "application/octet-stream" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download=(fl.customFields?.igcFilename||fl.name||"flug")+".igc";
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
              style={{background:"rgba(245,158,11,0.15)",border:"1px solid rgba(245,158,11,0.3)",borderRadius:16,padding:"4px 8px",color:"#fcd34d",fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>⬇ IGC</button>
            )}
            {fl.track?.length>1 && (
              <button onClick={()=>{
                  const gpx = buildGpxFromFlight(fl);
                  if (gpx) {
                    const blob = new Blob([gpx], { type: "application/gpx+xml" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${fl?.customFields?.igcFilename || fl?.name || "flug"}.gpx`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }
                }}
                style={{background:"rgba(34,197,94,0.15)",border:"1px solid rgba(34,197,94,0.3)",borderRadius:16,padding:"4px 8px",color:"#4ade80",fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>⬇ GPX</button>
            )}
            <div style={{position:"relative"}}>
              <button onClick={()=>setShowDeleteMenu(s=>!s)}
                style={{background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:16,padding:"4px 8px",color:"#f87171",fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>🗑 ▾</button>
              {showDeleteMenu && (
                <>
                  <div onClick={()=>setShowDeleteMenu(false)} style={{position:"fixed",inset:0,zIndex:99}} />
                  <div onClick={e=>e.stopPropagation()}
                    style={{position:"absolute",top:"calc(100% + 4px)",right:0,background:"#14253a",border:"1px solid rgba(255,255,255,0.15)",borderRadius:10,padding:4,boxShadow:"0 8px 24px rgba(0,0,0,0.5)",display:"flex",flexDirection:"column",gap:2,minWidth:150,zIndex:100}}>
                    {fl.track?.length>1 && (
                      <button onClick={()=>{setShowDeleteMenu(false);setConfirmDeleteKind("igc");}}
                        style={{background:"transparent",border:"none",borderRadius:6,padding:"8px 10px",color:"#e8f4fd",fontSize:13,cursor:"pointer",textAlign:"left"}}>
                        IGC-Track
                      </button>
                    )}
                    <button onClick={()=>{setShowDeleteMenu(false);setConfirmDelete(fl.id);}}
                      style={{background:"transparent",border:"none",borderRadius:6,padding:"8px 10px",color:"#f87171",fontSize:13,fontWeight:700,cursor:"pointer",textAlign:"left"}}>
                      Alles (ganzer Flug)
                    </button>
                  </div>
                </>
              )}
            </div>
            <button onClick={()=>window.location.href="hilfe.html"} title="Hilfe"
              style={{width:28,height:28,borderRadius:"50%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",color:"#ef4444",fontSize:13,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
              ?
            </button>
          </div>
        </div>

        <div style={{padding:"0 16px"}}>
          {/* Title row */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:2}}>
            <span style={{fontSize:11,color:"#7dd3fc"}}>{fl.date}</span>
            <div style={{display:"flex",gap:4}}>
              {fl.pdfOnly&&<span style={{background:"rgba(139,92,246,0.2)",color:"#c4b5fd",borderRadius:20,padding:"2px 10px",fontSize:10,fontWeight:700}}>CSV</span>}
            </div>
          </div>
          <EditableTitle value={fl.name} onSave={v=>setConfirmNameChange(v)} />
          <div style={{fontSize:13,color:"rgba(232,244,253,0.5)",marginBottom:12}}>{fl.startTime}{fl.endTime?" – "+fl.endTime:""}</div>

          {/* Rating inline */}
          <div style={{display:"flex",gap:6,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
            <div style={{display:"flex",gap:6,marginRight:4}}>
              {[1,2,3,4,5].map(s=>(
                <span key={s} onClick={()=>saveField({rating: (fl.rating||0)===s ? 0 : s})}
                  style={{fontSize:24,cursor:"pointer",color:s<=(fl.rating||0)?"#f59e0b":"rgba(232,244,253,0.2)"}}>★</span>
              ))}
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginLeft:"auto",justifyContent:"flex-end"}}>
              {fl.track?.length>1&&<span style={{background:"rgba(30,64,175,0.22)",color:"#60a5fa",borderRadius:20,padding:"2px 10px",fontSize:10,fontWeight:700,flexShrink:0}}>IGC</span>}
            </div>
          </div>

          {/* Notizen — kein Feld-Label mehr, Text über die volle Breite und linksbündig (statt des generischen label:value-Rechts-Layouts von InlineField). */}
          <div style={{background:"rgba(255,255,255,0.04)",borderRadius:14,padding:"13px 15px",marginBottom:14,border:"1px solid rgba(255,255,255,0.06)"}}>
            <div style={{fontSize:10,fontWeight:700,color:"rgba(232,244,253,0.4)",letterSpacing:1.5,textTransform:"uppercase",marginBottom:9}}>Notizen</div>
            {notesEditing ? (
              <textarea value={notesVal} onChange={e=>setNotesVal(e.target.value)} onBlur={commitNotes} autoFocus
                style={{width:"100%",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(125,211,252,0.4)",borderRadius:8,padding:"8px 10px",color:"#e8f4fd",fontSize:13,resize:"vertical",minHeight:60,textAlign:"left",boxSizing:"border-box"}} />
            ) : (
              <div onClick={()=>{setNotesVal(fl.notes||"");setNotesEditing(true);}}
                style={{width:"100%",fontSize:13,fontWeight:500,color:fl.notes?"#e8f4fd":"rgba(232,244,253,0.25)",cursor:"pointer",textAlign:"left",whiteSpace:"pre-wrap",minHeight:20,lineHeight:1.5}}>
                {fl.notes || "Notiz hinzufügen…"}
              </div>
            )}
          </div>

          {/* Swipe hint (replaces the old prev/next arrow buttons — navigation is now via touch swipe on this view) */}
          <div style={{textAlign:"center",fontSize:11,color:"rgba(232,244,253,0.3)",marginBottom:10}}>
            ‹ wischen ›
          </div>

          {/* Map */}
          <div data-no-swipe="true">
            <div style={{borderRadius:14,marginBottom:14,border:"1px solid rgba(100,180,255,0.12)"}}><FlightMap flight={fl} highlightRange={profileRange} onPlaybackPositionChange={setPlaybackDistance} onPlaybackActiveChange={setIsPlaybackActive} onPlaybackPhaseChange={setPlaybackPhase} controlsSlot={controlsSlotEl} isWide={isWide} mapTilerKey={mapTilerKey} /></div>
            <FlightProfile flight={fl} onPositionChange={setProfileRange} playbackDistanceKm={playbackDistance} isPlaybackActive={isPlaybackActive} playbackPhase={playbackPhase} controlsSlot={controlsSlotEl} isWide={isWide} />
          </div>
          {/* Shared row: every control from both the map (play/speed/reset/
              GPS Visualizer/Höhe·Steigen-Sinken) and the profile (Zoom/Zoom
              zurücksetzen) portals in here, compact enough for one line. */}
          <div ref={controlsSlotRef} style={{display:"flex",gap:5,margin:"10px 0 14px"}} />

          {/* Stats grid — each of the 9 tiles shows a user-chosen field
              (persisted globally, not per-flight). Tapping a tile opens a
              picker to reassign that slot to any Flugdaten field. */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
            {tileConfig.map((key, i) => {
              const opt = TILE_FIELD_OPTIONS.find(o=>o.key===key) || TILE_FIELD_OPTIONS[0];
              return (
                <div key={i} onClick={()=>setTilePickerIdx(i)}
                  style={{background:"rgba(255,255,255,0.05)",borderRadius:10,padding:"7px 6px",textAlign:"center",border:"1px solid rgba(255,255,255,0.06)",cursor:"pointer"}}>
                  <div style={{fontSize:12,marginBottom:1}}>{opt.icon}</div>
                  <div style={{fontSize:14,fontWeight:800,color:"#7dd3fc"}}>{opt.get(fl)}</div>
                  <div style={{fontSize:8,color:"rgba(232,244,253,0.4)",marginTop:1,textTransform:"uppercase",letterSpacing:0.4}}>{opt.label}</div>
                </div>
              );
            })}
          </div>

          {tilePickerIdx !== null && (
            <div onClick={()=>setTilePickerIdx(null)}
              style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:250,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
              <div onClick={e=>e.stopPropagation()}
                style={{background:"#14253a",borderTopLeftRadius:18,borderTopRightRadius:18,padding:"16px 18px calc(20px + env(safe-area-inset-bottom, 0px))",maxWidth:480,width:"100%",maxHeight:"75vh",overflowY:"auto",border:"1px solid rgba(255,255,255,0.1)"}}>
                <div style={{fontSize:14,fontWeight:700,marginBottom:10}}>Kachel {tilePickerIdx+1}: Feld wählen</div>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {TILE_FIELD_OPTIONS.map(opt => (
                    <button key={opt.key}
                      onClick={()=>{
                        const next = [...tileConfig]; next[tilePickerIdx] = opt.key;
                        saveTileConfig(next); setTilePickerIdx(null);
                      }}
                      style={{display:"flex",alignItems:"center",gap:10,textAlign:"left",background:tileConfig[tilePickerIdx]===opt.key?"rgba(125,211,252,0.15)":"transparent",border:"1px solid "+(tileConfig[tilePickerIdx]===opt.key?"rgba(125,211,252,0.35)":"rgba(255,255,255,0.06)"),borderRadius:10,padding:"9px 12px",color:"#e8f4fd",fontSize:13,cursor:"pointer"}}>
                      <span style={{fontSize:15}}>{opt.icon}</span>
                      <span style={{flex:1}}>{opt.label}</span>
                      <span style={{color:"rgba(232,244,253,0.4)",fontSize:12}}>{opt.get(fl)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Koordinaten-Badges */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            <div style={{background:"rgba(34,197,94,0.07)",borderRadius:12,padding:"10px",border:"1px solid rgba(34,197,94,0.18)"}}>
              <div style={{fontSize:9,fontWeight:700,color:"#4ade80",letterSpacing:1.2,textTransform:"uppercase",marginBottom:5}}>📍 Start</div>
              <CoordEdit
                lat={fl.startPt?.lat} lon={fl.startPt?.lon} alt={fl.startAlt}
                color="#4ade80"
                onSave={(lat,lon,alt)=>{
                  // lat/lon coming back as null means the person explicitly
                  // cleared the field — that must actually remove the point,
                  // not silently fall back to the previous value.
                  const sp = (lat!=null && lon!=null) ? {lat,lon,gpsAlt:alt||0} : null;
                  saveComputedField(fl, {startPt:sp, startAlt:alt||0});
                }} />
            </div>
            <div style={{background:"rgba(239,68,68,0.07)",borderRadius:12,padding:"10px",border:"1px solid rgba(239,68,68,0.18)"}}>
              <div style={{fontSize:9,fontWeight:700,color:"#f87171",letterSpacing:1.2,textTransform:"uppercase",marginBottom:5}}>🏁 Landung</div>
              <CoordEdit
                lat={fl.endPt?.lat} lon={fl.endPt?.lon} alt={fl.endAlt}
                color="#f87171"
                onSave={(lat,lon,alt)=>{
                  const ep = (lat!=null && lon!=null) ? {lat,lon,gpsAlt:alt||0} : null;
                  saveComputedField(fl, {endPt:ep, endAlt:alt||0});
                }} />
            </div>
          </div>

          {/* Editierbare Felder */}
          <div id="flugdaten-section" style={{background:"rgba(255,255,255,0.04)",borderRadius:14,padding:"13px 15px",marginBottom:11,border:"1px solid rgba(255,255,255,0.06)"}}>
            <div style={{fontSize:10,fontWeight:700,color:"#7dd3fc",letterSpacing:1.5,textTransform:"uppercase",marginBottom:9}}>Flugdaten</div>
            <InlineField label="Datum" value={fl.date} onSave={v=>setConfirmDateChange(v)} />
            <SchirmSelect value={fl.glider} onSave={v=>saveField({glider:v})}
              extra={(!fl.customFields?.typ && !typRevealed) ? (
                <span onClick={(e)=>{ e.stopPropagation(); setTypRevealed(true); }}
                  style={{fontSize:11,color:"rgba(232,244,253,0.25)",cursor:"pointer"}}>
                  + Typ
                </span>
              ) : null} />
            {(fl.customFields?.typ || typRevealed) && (
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{flex:1,minWidth:0}}>
                  <InlineField label="Typ" value={fl.customFields?.typ||""} onSave={v=>saveField({customFields:{typ:v, typAuto:false}})} />
                </div>
                {!fl.customFields?.typ && (
                  <span onClick={()=>setTypRevealed(false)}
                    style={{fontSize:13,color:"rgba(232,244,253,0.25)",cursor:"pointer",padding:"0 2px"}}>
                    ✕
                  </span>
                )}
              </div>
            )}
            <div onClick={()=>saveField({customFields:{training:(fl.customFields?.training||"").trim().toUpperCase()==="T"?"":"T"}})}
              style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",cursor:"pointer"}}>
              <div style={{width:18,height:18,borderRadius:5,border:`2px solid ${(fl.customFields?.training||"").trim().toUpperCase()==="T"?"#7dd3fc":"rgba(232,244,253,0.3)"}`,background:(fl.customFields?.training||"").trim().toUpperCase()==="T"?"#7dd3fc":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {(fl.customFields?.training||"").trim().toUpperCase()==="T" && <span style={{color:"#0a1628",fontSize:11,fontWeight:900}}>✓</span>}
              </div>
              <span style={{fontSize:13,color:"rgba(232,244,253,0.7)"}}>Training</span>
            </div>
            <InlineField label="Startzeit"   value={fl.startTime}                   onSave={v=>saveComputedField(fl,{startTime:v})} />
            <InlineField label="Landezeit"   value={fl.endTime}                     onSave={v=>saveComputedField(fl,{endTime:v})} />
            <PlaceInlineField label="Startplatz" value={fl.site} flights={flights} kind="start"
              onSave={(v,extras)=>saveField({
                site:v,
                ...(extras ? { startPt: extras.pt, startAlt: extras.alt } : {}),
              })}
              suggestions={[...new Set(flights.map(f=>f.site).filter(Boolean))]} />
            <PlaceInlineField label="Landeplatz" value={fl.customFields?.landung} flights={flights} kind="end"
              onSave={(v,extras)=>saveField({
                customFields:{landung:v},
                ...(extras ? { endPt: extras.pt, endAlt: extras.alt } : {}),
              })}
              suggestions={[...new Set(flights.map(f=>f.customFields?.landung).filter(Boolean))]} />
            <InlineField label="Land" value={fl.customFields?.land||""} onSave={v=>saveField({customFields:{land:v}})} />
            <ReiseSelect value={fl.customFields?.reise} flights={flights} onSave={v=>saveField({customFields:{reise:v}})} />
            {fl.customFields?.igcFilename && <StaticField label="IGC-Dateiname" value={fl.customFields.igcFilename} />}
            <InlineField label="Start müM"   value={fl.startAlt>0?String(fl.startAlt):(fl.customFields?.msa||"")}  onSave={v=>saveComputedField(fl,{startAlt:+v,customFields:{msa:v}})} unit="m" />
            <InlineField label="Landung müM" value={fl.endAlt>0?String(fl.endAlt):(fl.customFields?.ml||"")}       onSave={v=>saveComputedField(fl,{endAlt:+v,customFields:{ml:v}})} unit="m" />
            <InlineField label="Max. Höhe"   value={fl.maxAlt?String(fl.maxAlt):""}                                onSave={v=>saveField({maxAlt:+v,customFields:{hm:v}})} unit="m" />
            <InlineField label="Distanz"     value={getDisplayDistance(fl)} onSave={v=>saveComputedField(fl,{totalDist:parseFloat(v)||0,customFields:{distKm:v}})} unit="km" />
            <InlineField label="Max Speed"   value={fl.maxSpeedKmh?String(fl.maxSpeedKmh):""} onSave={v=>saveField({maxSpeedKmh:parseFloat(v)||0})} unit="km/h" />
            <StaticField label="Dauer"       value={fl.durationStr} />
            <StaticField label="H.Diff."     value={fl.customFields?.hDiff} unit="m" />
            <InlineField label="Ø Speed"     value={fl.customFields?.kmh}           onSave={v=>saveField({customFields:{kmh:v}})} unit="km/h" />
            <InlineField label="Max.Steigen" value={fmt1(fl.customFields?.maxSteigen)}    onSave={v=>saveField({customFields:{maxSteigen:v}})} unit="m/s" />
            <InlineField label="Max.Steigen 20s" value={fmt1(fl.customFields?.maxSteigen20)} onSave={v=>saveField({customFields:{maxSteigen20:v}})} unit="m/s" />
            <InlineField label="Max.Sinken"  value={fmt1(fl.customFields?.maxSinken)}     onSave={v=>saveField({customFields:{maxSinken:v}})} unit="m/s" />
            <InlineField label="H.Gew."      value={fl.customFields?.hGew}          onSave={v=>saveField({customFields:{hGew:v}})} unit="m" />
            <StaticField label="Entf. S-L"   value={fl.entfernungSL!=null?String(fl.entfernungSL):""} unit="km" />
          </div>

          {/* Auto fields */}
          {autoFields.length>0&&(
            <div style={{background:"rgba(255,255,255,0.04)",borderRadius:14,padding:"13px 15px",marginBottom:11,border:"1px solid rgba(255,255,255,0.06)"}}>
              <div style={{fontSize:10,fontWeight:700,color:"#f59e0b",letterSpacing:1.5,textTransform:"uppercase",marginBottom:9}}>⚡ Auto-Felder</div>
              {autoFields.map(f=>(
                <div key={f.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                  <span style={{fontSize:13,color:"rgba(232,244,253,0.45)"}}>{f.icon} {f.name}</span>
                  <span style={{fontSize:13,fontWeight:600,color:"#fcd34d"}}>{f.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Manual custom fields */}
          {manualFields.filter(f=>!["landung","distKm","kmh","hDiff","msa","ml","hm","hGew","maxSinken","maxSteigen"].includes(f.id)).length>0&&(
            <div style={{background:"rgba(255,255,255,0.04)",borderRadius:14,padding:"13px 15px",marginBottom:11,border:"1px solid rgba(255,255,255,0.06)"}}>
              <div style={{fontSize:10,fontWeight:700,color:"rgba(232,244,253,0.4)",letterSpacing:1.5,textTransform:"uppercase",marginBottom:9}}>Eigene Felder</div>
              {manualFields.filter(f=>!["landung","distKm","kmh","hDiff","msa","ml","hm","hGew","maxSinken","maxSteigen"].includes(f.id)).map(f=>(
                <InlineField key={f.id} label={f.name} value={fl.customFields?.[f.id]||""} onSave={v=>saveField({customFields:{[f.id]:v}})} />
              ))}
            </div>
          )}

        </div>
        {showFieldEditor&&<FieldEditor customFieldDefs={customFieldDefs} onSave={handleSaveFields} onClose={()=>setShowFieldEditor(false)} />}
        {confirmDelete===fl.id && (
          <div onClick={()=>setConfirmDelete(null)}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:24}}>
            <div onClick={e=>e.stopPropagation()}
              style={{background:"#14253a",borderRadius:16,padding:"20px 22px",maxWidth:320,width:"100%",border:"1px solid rgba(255,255,255,0.1)"}}>
              <div style={{fontSize:16,fontWeight:700,marginBottom:6}}>Flug löschen?</div>
              <div style={{fontSize:13,color:"rgba(232,244,253,0.6)",marginBottom:18}}>{fl.name} wird endgültig entfernt.</div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setConfirmDelete(null)}
                  style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"10px",color:"#e8f4fd",fontSize:14,cursor:"pointer"}}>Abbrechen</button>
                <button onClick={async()=>{
                    try{await window.storage.delete(`flight:${fl.id}`);}catch{}
                    setFlights(prev=>prev.filter(f=>f.id!==fl.id));
                    setSelected(null);
                    setConfirmDelete(null);
                    setView("list");
                  }}
                  style={{flex:1,background:"rgba(239,68,68,0.2)",border:"1px solid rgba(239,68,68,0.4)",borderRadius:10,padding:"10px",color:"#f87171",fontSize:14,fontWeight:700,cursor:"pointer"}}>Löschen</button>
              </div>
            </div>
          </div>
        )}

        {confirmDeleteKind && (
          <div onClick={()=>setConfirmDeleteKind(null)}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:24}}>
            <div onClick={e=>e.stopPropagation()}
              style={{background:"#14253a",borderRadius:16,padding:"20px 22px",maxWidth:320,width:"100%",border:"1px solid rgba(255,255,255,0.1)"}}>
              <div style={{fontSize:16,fontWeight:700,marginBottom:6}}>IGC-Track löschen?</div>
              <div style={{fontSize:13,color:"rgba(232,244,253,0.6)",marginBottom:18}}>
                Der GPS-Track von {fl.name} wird entfernt. Start- und Landepunkt bleiben erhalten. Diese Aktion kann nicht rückgängig gemacht werden.
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setConfirmDeleteKind(null)}
                  style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"10px",color:"#e8f4fd",fontSize:14,cursor:"pointer"}}>Abbrechen</button>
                <button onClick={deleteTrack}
                  style={{flex:1,background:"rgba(239,68,68,0.2)",border:"1px solid rgba(239,68,68,0.4)",borderRadius:10,padding:"10px",color:"#f87171",fontSize:14,fontWeight:700,cursor:"pointer"}}>Löschen</button>
              </div>
            </div>
          </div>
        )}

        {confirmNameChange !== null && (
          <div onClick={()=>setConfirmNameChange(null)}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:24}}>
            <div onClick={e=>e.stopPropagation()}
              style={{background:"#14253a",borderRadius:16,padding:"20px 22px",maxWidth:320,width:"100%",border:"1px solid rgba(255,255,255,0.1)"}}>
              <div style={{fontSize:16,fontWeight:700,marginBottom:6}}>⚠️ Flugname/-nummer ändern?</div>
              <div style={{fontSize:13,color:"rgba(232,244,253,0.6)",marginBottom:18}}>
                „{fl.name}“ wird zu „{confirmNameChange}“. Die Nummer wird sonst nirgends automatisch angepasst — bei falscher Eingabe können Dopplungen oder Lücken in der Nummerierung entstehen.
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setConfirmNameChange(null)}
                  style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"10px",color:"#e8f4fd",fontSize:14,cursor:"pointer"}}>Abbrechen</button>
                <button onClick={()=>{ saveField({name:confirmNameChange}); setConfirmNameChange(null); }}
                  style={{flex:1,background:"rgba(245,158,11,0.2)",border:"1px solid rgba(245,158,11,0.4)",borderRadius:10,padding:"10px",color:"#fcd34d",fontSize:14,fontWeight:700,cursor:"pointer"}}>Ändern</button>
              </div>
            </div>
          </div>
        )}

        {confirmDateChange !== null && (
          <div onClick={()=>setConfirmDateChange(null)}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:24}}>
            <div onClick={e=>e.stopPropagation()}
              style={{background:"#14253a",borderRadius:16,padding:"20px 22px",maxWidth:320,width:"100%",border:"1px solid rgba(255,255,255,0.1)"}}>
              <div style={{fontSize:16,fontWeight:700,marginBottom:6}}>⚠️ Datum ändern?</div>
              <div style={{fontSize:13,color:"rgba(232,244,253,0.6)",marginBottom:18}}>
                Ein neues Datum verschiebt {fl.name} evtl. an eine andere Stelle in der Chronologie — dabei werden <b>alle</b> Flugnummern neu, lückenlos durchnummeriert. Fortfahren?
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setConfirmDateChange(null)}
                  style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"10px",color:"#e8f4fd",fontSize:14,cursor:"pointer"}}>Abbrechen</button>
                <button onClick={()=>{ const d=confirmDateChange; setConfirmDateChange(null); saveDateField(d); }}
                  style={{flex:1,background:"rgba(245,158,11,0.2)",border:"1px solid rgba(245,158,11,0.4)",borderRadius:10,padding:"10px",color:"#fcd34d",fontSize:14,fontWeight:700,cursor:"pointer"}}>Ändern</button>
              </div>
            </div>
          </div>
        )}

        {confirmTypAuto !== null && (
          <div onClick={()=>{ saveField({customFields:{typAuto:false}}); setConfirmTypAuto(null); }}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:24}}>
            <div onClick={e=>e.stopPropagation()}
              style={{background:"#14253a",borderRadius:16,padding:"20px 22px",maxWidth:320,width:"100%",border:"1px solid rgba(255,255,255,0.1)"}}>
              <div style={{fontSize:16,fontWeight:700,marginBottom:6}}>Typ automatisch führen?</div>
              <div style={{fontSize:13,color:"rgba(232,244,253,0.6)",marginBottom:18}}>
                Dieser importierte Flug hat bereits einen Typ: „{fl.customFields?.typ}". Automatischer Standard wäre: „{confirmTypAuto}". Soll der Typ ab jetzt automatisch mitgeführt werden (aktueller Wert wird dabei ersetzt)? Diese Wahl gilt nur für diesen Flug und wird gemerkt.
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>{ saveField({customFields:{typAuto:false}}); setConfirmTypAuto(null); }}
                  style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"10px",color:"#e8f4fd",fontSize:14,cursor:"pointer"}}>Beibehalten</button>
                <button onClick={()=>{ const v=confirmTypAuto; setConfirmTypAuto(null); saveField({customFields:{typ:v, typAuto:true}}); }}
                  style={{flex:1,background:"rgba(245,158,11,0.2)",border:"1px solid rgba(245,158,11,0.4)",borderRadius:10,padding:"10px",color:"#fcd34d",fontSize:14,fontWeight:700,cursor:"pointer"}}>Automatisch</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  
}

function SidebarList({ flights, selectedId, onSelect, longestId }) {
  const [filterText, setFilterText] = useState("");
  const [sortId, setSortId] = useState("number");
  const [sortDir, setSortDir] = useState("desc");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const filtered = matchFlights(flights, filterText);
  const years = [...new Set(filtered.map(f=>f.year).filter(Boolean))].sort((a,b)=>b-a);
  // Keeps the left Flugliste (iPad/Mac split view) in sync with the right
  // Flugdetail: whenever the selected flight changes — including via the
  // detail view's own swipe/prev-next navigation, not just clicks on this
  // list — the matching row scrolls into view so the highlighted entry is
  // always visible without the person needing to manually scroll to find it.
  const rowRefs = useRef({});
  useEffect(() => {
    const el = rowRefs.current[selectedId];
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);
  return (
    <div style={{width:"clamp(340px, 22vw, 440px)",minWidth:340,height:"100vh",overflowY:"auto",borderRight:"1px solid rgba(255,255,255,0.08)",background:"#040e20",fontFamily:"system-ui,sans-serif"}}>
      <div style={{padding:"calc(14px + env(safe-area-inset-top, 0px)) 14px 8px",position:"sticky",top:0,background:"#040e20",zIndex:5,borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
        <div style={{marginBottom:6}}>
          <SearchBar filterText={filterText} setFilterText={setFilterText} knownGliders={[...new Set(flights.map(f=>f.glider).filter(Boolean))].sort()} />
        </div>
        <div style={{display:"flex",gap:6,position:"relative"}}>
          <button onClick={()=>setShowSortMenu(s=>!s)}
            style={{flex:1,display:"flex",justifyContent:"space-between",alignItems:"center",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"6px 10px",color:"rgba(232,244,253,0.8)",fontSize:11,cursor:"pointer"}}>
            <span>⇅ {SORT_OPTIONS.find(o=>o.id===sortId)?.label||"—"}</span>
            <span>{showSortMenu?"▾":"▸"}</span>
          </button>
          <button onClick={()=>setSortDir(d=>d==="asc"?"desc":"asc")}
            style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"6px 10px",color:"#7dd3fc",fontSize:12,cursor:"pointer"}}>
            {sortDir==="asc"?"↑":"↓"}
          </button>
          {showSortMenu && (
            <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:"#14253a",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:5,maxHeight:240,overflowY:"auto",zIndex:10,boxShadow:"0 8px 24px rgba(0,0,0,0.4)"}}>
              {SORT_OPTIONS.map(o=>(
                <div key={o.id} onClick={()=>{setSortId(o.id);setShowSortMenu(false);}}
                  style={{padding:"7px 10px",borderRadius:6,fontSize:12,cursor:"pointer",color:o.id===sortId?"#7dd3fc":"rgba(232,244,253,0.75)",background:o.id===sortId?"rgba(14,165,233,0.15)":"transparent"}}>
                  {o.label}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {sortId !== "date" ? (
        sortFlights(filtered, sortId, sortDir).map(f => (
          <SidebarFlightRow key={f.id} f={f} selectedId={selectedId} longestId={longestId} onSelect={onSelect} sortId={sortId}
            registerRef={el=>{ rowRefs.current[f.id]=el; }} />
        ))
      ) : years.map(yr => {
        const yFlights = sortFlights(filtered.filter(f=>f.year===yr), sortId, sortDir);
        return (
          <div key={yr}>
            <div style={{padding:"8px 14px",fontSize:12,fontWeight:700,color:"#7dd3fc",background:"rgba(255,255,255,0.02)"}}>{yr} · {yFlights.length}</div>
            {yFlights.map(f => (
              <SidebarFlightRow key={f.id} f={f} selectedId={selectedId} longestId={longestId} onSelect={onSelect} sortId={sortId}
                registerRef={el=>{ rowRefs.current[f.id]=el; }} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

const SIDEBAR_ROW_VISIBLE_SORT_IDS = new Set(["date", "site", "rating"]);

function SidebarFlightRow({ f, selectedId, longestId, onSelect, registerRef, sortId }) {
  const sortExtra = !SIDEBAR_ROW_VISIBLE_SORT_IDS.has(sortId) ? sortFieldDisplay(f, sortId) : null;
  return (
    <div ref={registerRef} onClick={()=>onSelect(f)}
      style={{padding:"5px 14px",cursor:"pointer",borderBottom:"1px solid rgba(255,255,255,0.04)",background:f.id===selectedId?"rgba(14,165,233,0.12)":"transparent",borderLeft:f.id===selectedId?"3px solid #7dd3fc":"3px solid transparent"}}>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        {f.id===longestId && <span style={{fontSize:11}}>🏆</span>}
        <span style={{fontSize:11,color:"#a8d8f5"}}>{f.date}</span>
        {f.rating>0 && <span style={{fontSize:11}}><span style={{color:"#fde047"}}>{f.rating}</span><span style={{fontSize:"0.85em"}}>⭐️</span></span>}
      </div>
      <div style={{fontSize:11,color:"#a8d8f5",marginTop:2}}>{f.site}</div>
      {sortExtra && <div style={{fontSize:11,color:"#a8d8f5",marginTop:2}}>{sortExtra}</div>}
    </div>
  );
}

// "Wide" here means tablet/desktop split-view territory, not just "not a
// narrow portrait phone" — a large phone in landscape (e.g. Galaxy S25,
// ~890px CSS width) is still comfortably under 1024, so it keeps the
// phone-optimised single-column layout in both orientations instead of
// switching into the side-by-side Flugliste+Flugdetail view meant for
// tablets/desktop, where there's enough width AND height for two panes
// at once. 1024 matches the standard tablet-landscape/small-laptop
// breakpoint, safely above real phone widths in either orientation.
function useIsWide() {
  const [isWide, setIsWide] = useState(typeof window !== "undefined" ? window.innerWidth >= 1024 : false);
  useEffect(() => {
    const onResize = () => setIsWide(window.innerWidth >= 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isWide;
}

// Erkennt ein Handy in Queransicht (breiter als hoch, aber unterhalb der
// useIsWide-Schwelle von 1024px) — separat von useIsWide, weil das
// zweispaltige Tablet/Desktop-Layout auf einem quer gehaltenen Handy trotz
// ausreichender Breite an der geringen Höhe scheitern würde. Wird nur
// genutzt, um die sonst auf 480px begrenzte Listenansicht dort die volle
// Displaybreite nutzen zu lassen.
function useIsLandscapePhone() {
  const check = () => typeof window !== "undefined" && window.innerWidth > window.innerHeight && window.innerWidth < 1024;
  const [isLandscapePhone, setIsLandscapePhone] = useState(check);
  useEffect(() => {
    const onResize = () => setIsLandscapePhone(check());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isLandscapePhone;
}

// Lets the person choose exactly which of the 25 possible columns get
// included when copying flights to the clipboard, and in what order —
// so the copied table's columns can be made to match whatever external
// spreadsheet template they're pasting into. Saved via window.storage
// (see FlugbuchApp), so it's picked up automatically by the app's generic
// backup export/import too, without needing any special-casing there.
function CsvColumnConfigModal({ columns, onSave, onClose }) {
  const [local, setLocal] = useState(columns);
  const toggle = (key) => setLocal(cols => cols.map(c => c.key===key ? {...c, enabled: !c.enabled} : c));
  const move = (idx, dir) => setLocal(cols => {
    const next = [...cols];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return cols;
    [next[idx], next[j]] = [next[j], next[idx]];
    return next;
  });
  const labelFor = key => CSV_COLUMN_DEFS.find(c=>c.key===key)?.label || key;
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:"#0a1628",borderRadius:16,padding:"18px 16px",maxWidth:400,width:"100%",border:"1px solid rgba(255,255,255,0.1)",maxHeight:"85vh",display:"flex",flexDirection:"column"}}>
        <div style={{fontSize:15,fontWeight:800,marginBottom:4}}>Spalten für "Kopieren"</div>
        <div style={{fontSize:12,color:"rgba(232,244,253,0.5)",marginBottom:14}}>Auswählen und mit ↑/↓ in die gewünschte Reihenfolge bringen, passend zur Ziel-Tabelle.</div>
        <div style={{overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
          {local.map((c, idx) => (
            <div key={c.key} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 8px",borderRadius:8,background:c.enabled?"rgba(34,197,94,0.08)":"rgba(255,255,255,0.03)"}}>
              <div onClick={()=>toggle(c.key)}
                style={{width:20,height:20,borderRadius:6,border:`2px solid ${c.enabled?"#4ade80":"rgba(232,244,253,0.3)"}`,background:c.enabled?"#4ade80":"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
                {c.enabled && <span style={{color:"#0a1628",fontSize:13,fontWeight:900}}>✓</span>}
              </div>
              <span style={{flex:1,fontSize:13,color:c.enabled?"#e8f4fd":"rgba(232,244,253,0.4)"}}>{labelFor(c.key)}</span>
              <button onClick={()=>move(idx,-1)} disabled={idx===0}
                style={{background:"rgba(255,255,255,0.06)",border:"none",borderRadius:6,width:26,height:26,color:idx===0?"rgba(232,244,253,0.2)":"#e8f4fd",fontSize:13,cursor:idx===0?"default":"pointer"}}>▲</button>
              <button onClick={()=>move(idx,1)} disabled={idx===local.length-1}
                style={{background:"rgba(255,255,255,0.06)",border:"none",borderRadius:6,width:26,height:26,color:idx===local.length-1?"rgba(232,244,253,0.2)":"#e8f4fd",fontSize:13,cursor:idx===local.length-1?"default":"pointer"}}>▼</button>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:8,marginTop:16}}>
          <button onClick={()=>setLocal(CSV_COLUMN_DEFS.map(c => ({ key: c.key, enabled: true })))}
            style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"9px",color:"rgba(232,244,253,0.7)",fontSize:13,cursor:"pointer"}}>
            Zurücksetzen
          </button>
          <button onClick={()=>{ onSave(local); onClose(); }}
            style={{flex:1,background:"linear-gradient(135deg,#22c55e,#16a34a)",color:"#fff",border:"none",borderRadius:10,padding:9,fontSize:13,fontWeight:800,cursor:"pointer"}}>
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

function DateAmbiguousResolver({ item, onAssign, onCreateNew, onClose, description }) {
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:"#0a1628",borderRadius:16,padding:"18px 16px",maxWidth:380,width:"100%",border:"1px solid rgba(255,255,255,0.1)"}}>
        <div style={{fontSize:15,fontWeight:800,marginBottom:6}}>Welchem Flug zuordnen?</div>
        <div style={{fontSize:12,color:"rgba(232,244,253,0.5)",marginBottom:10}}>
          {description || `"${item.file.name}" (${item.date}) passt zu keiner Flug-Nr., aber es gibt mehrere Flüge an diesem Datum ohne GPS-Track.`}
        </div>
        {(item.igcData?.startTime || item.igcData?.durationStr) && (
          <div style={{fontSize:12,color:"#7dd3fc",background:"rgba(125,211,252,0.08)",border:"1px solid rgba(125,211,252,0.2)",borderRadius:8,padding:"7px 10px",marginBottom:12}}>
            IGC-Datei: {item.igcData?.startTime ? `Start ${item.igcData.startTime}` : ""}{item.igcData?.startTime && item.igcData?.durationStr ? " · " : ""}{item.igcData?.durationStr ? `Dauer ${item.igcData.durationStr}` : ""}
          </div>
        )}
        <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12,maxHeight:"40vh",overflowY:"auto"}}>
          {item.candidates.map(c => (
            <button key={c.id} onClick={()=>onAssign(c)}
              style={{textAlign:"left",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"10px 12px",color:"#e8f4fd",fontSize:13,cursor:"pointer"}}>
              <b>{c.name}</b>{c.site ? " · "+c.site : ""}{c.startTime ? " · "+c.startTime : ""}{!c.startTime && c.durationStr ? " · "+c.durationStr : ""}
            </button>
          ))}
        </div>
        {onCreateNew && (
          <button onClick={onCreateNew}
            style={{width:"100%",background:"rgba(34,197,94,0.15)",border:"1px solid rgba(34,197,94,0.3)",borderRadius:10,padding:"9px",color:"#4ade80",fontSize:13,fontWeight:700,cursor:"pointer"}}>
            + Stattdessen neuen Flug anlegen
          </button>
        )}
      </div>
    </div>
  );
}

// Zeigt, bevor ein IGC-Import Flüge/Schirme tatsächlich anlegt, für jeden
// im Batch neu auftauchenden (noch nicht in der Schirme-Liste vorhandenen)
// Schirm-Namen eine Bestätigung mit editierbaren Feldern Schirm/Hersteller
// — vorausgefüllt mit dem Vorschlag aus splitFirstWordAsHersteller. Verhindert
// stilles Fehlanlegen (siehe Bug: "Artik R 2" wurde bisher ungefragt in
// Hersteller "Artik"/Schirm "R 2" zerlegt), ohne die automatische Erkennung
// für tatsächlich bekannte Hersteller abzuschaffen.
function NewSchirmDialog({ items, onConfirm, onCancel }) {
  const [edited, setEdited] = useState(() => items.map(it => ({ name: it.name, hersteller: it.hersteller })));
  const setField = (i, field, value) => setEdited(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: value } : e));
  return (
    <div onClick={onCancel} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:"#0a1628",borderRadius:16,padding:"18px 16px",maxWidth:420,width:"100%",maxHeight:"85vh",overflowY:"auto",border:"1px solid rgba(255,255,255,0.1)"}}>
        <div style={{fontSize:15,fontWeight:800,marginBottom:6}}>
          {items.length===1 ? "Neuer Schirm gefunden" : `${items.length} neue Schirme gefunden`}
        </div>
        <div style={{fontSize:12,color:"rgba(232,244,253,0.5)",marginBottom:14}}>
          Aus der IGC-Datei erkannt, aber noch nicht in deiner Schirme-Liste. Bitte prüfen/ergänzen — Hersteller lässt sich aus der Datei nicht immer sicher bestimmen.
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:14,marginBottom:16}}>
          {items.map((it, i) => (
            <div key={it.key} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"10px 12px"}}>
              <div style={{fontSize:10,color:"rgba(232,244,253,0.4)",marginBottom:8,fontFamily:"monospace"}}>Original: „{it.raw}"</div>
              <div style={{marginBottom:8}}>
                <div style={{fontSize:10,color:"rgba(232,244,253,0.4)",marginBottom:3}}>Schirm</div>
                <input value={edited[i].name} onChange={e=>setField(i,"name",e.target.value)}
                  style={{width:"100%",boxSizing:"border-box",background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,padding:"8px 10px",color:"#e8f4fd",fontSize:13,fontWeight:700}} />
              </div>
              <div>
                <div style={{fontSize:10,color:"rgba(232,244,253,0.4)",marginBottom:3}}>Hersteller</div>
                <input value={edited[i].hersteller} onChange={e=>setField(i,"hersteller",e.target.value)}
                  placeholder="z.B. Niviuk"
                  style={{width:"100%",boxSizing:"border-box",background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,padding:"8px 10px",color:"#e8f4fd",fontSize:13}} />
              </div>
            </div>
          ))}
        </div>
        <button onClick={()=>onConfirm(edited)}
          style={{width:"100%",background:"rgba(34,197,94,0.15)",border:"1px solid rgba(34,197,94,0.3)",borderRadius:10,padding:"11px",color:"#4ade80",fontSize:14,fontWeight:700,cursor:"pointer",marginBottom:8}}>
          ✓ Übernehmen & Import fortsetzen
        </button>
        <button onClick={onCancel}
          style={{width:"100%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"9px",color:"rgba(232,244,253,0.6)",fontSize:13,cursor:"pointer"}}>
          Import abbrechen
        </button>
      </div>
    </div>
  );
}

// Warnt vor dem eigentlichen Import, wenn eine Datei Datum+Startzeit exakt
// mit einem bereits vorhandenen, schon getrackten Flug teilt, aber unter
// einem anderen Dateinamen kommt (siehe pendingDateDups) — vermutlich
// dieselbe Aufzeichnung, nochmal exportiert. "Überspringen" ist die
// empfohlene, default-hervorgehobene Aktion.
function DateDupWarningDialog({ items, onImportAnyway, onSkip }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#0a1628",borderRadius:16,padding:"18px 16px",maxWidth:420,width:"100%",maxHeight:"85vh",overflowY:"auto",border:"1px solid rgba(255,255,255,0.1)"}}>
        <div style={{fontSize:15,fontWeight:800,marginBottom:6}}>
          {items.length===1 ? "Flug vermutlich schon vorhanden" : `${items.length} Flüge vermutlich schon vorhanden`}
        </div>
        <div style={{fontSize:12,color:"rgba(232,244,253,0.5)",marginBottom:14}}>
          Gleiches Datum und dieselbe Startzeit wie ein bereits vorhandener Flug mit GPS-Track, aber unter einem anderen Dateinamen — vermutlich dieselbe Aufzeichnung, nochmal exportiert.
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
          {items.map(({item, existing}) => (
            <div key={item.baseName} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"10px 12px",fontSize:12}}>
              <div style={{fontWeight:700,marginBottom:2}}>{item.file.name}</div>
              <div style={{color:"rgba(232,244,253,0.5)"}}>{item.date} · {item.igcData.startTime} — passt zu Flug „{existing.name}"{existing.site?` (${existing.site})`:""}</div>
            </div>
          ))}
        </div>
        <button onClick={onSkip}
          style={{width:"100%",background:"rgba(34,197,94,0.15)",border:"1px solid rgba(34,197,94,0.3)",borderRadius:10,padding:"11px",color:"#4ade80",fontSize:14,fontWeight:700,cursor:"pointer",marginBottom:8}}>
          Überspringen (empfohlen)
        </button>
        <button onClick={onImportAnyway}
          style={{width:"100%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"9px",color:"rgba(232,244,253,0.6)",fontSize:13,cursor:"pointer"}}>
          Trotzdem als neue Flüge importieren
        </button>
      </div>
    </div>
  );
}

function FlugbuchApp() {
  const isWide = useIsWide();
  const isLandscapePhone = useIsLandscapePhone();
  const [flights, setFlights] = useState([]);
  // MapTiler-Schlüssel, ausschliesslich unter Service → API-Zugangsdaten
  // hinterlegt (kein eingebauter Schlüssel mehr im Code) — ohne Eintrag
  // dort bleiben die Karten leer, siehe die Hinweis-Overlays in
  // WorldMapView/FlightMap.
  const [mapTilerKey, setMapTilerKey] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("settings:maptilerApiKey");
        if (r && r.value) setMapTilerKey(r.value);
      } catch {}
    })();
  }, []);
  // Radius (km) für die automatische Start-/Landeplatz- und Land-Zuordnung
  // beim IGC-Import — unter Service → "IGC-Import: Start-/Landeplatz & Land"
  // einstellbar. 0.5 km Standard, falls dort noch nichts gespeichert wurde.
  const [placeMatchRadiusKm, setPlaceMatchRadiusKm] = useState(0.5);
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("settings:placeMatchRadiusKm");
        const n = r && r.value ? parseFloat(r.value) : NaN;
        if (isFinite(n) && n > 0) setPlaceMatchRadiusKm(n);
      } catch {}
    })();
  }, []);
  // ── IGC-Ordner-Import (File System Access API, nur Chrome/Edge Desktop)
  // Einmalig einen Ordner wählen (z.B. das Vario-Laufwerk D:\, oder direkt
  // dessen "flights"-Unterordner) — die App merkt sich diesen Ordner
  // dauerhaft (wie den Backup-Ordner in Service) und durchsucht ihn bei
  // jedem Klick auf die IGC-Kachel rekursiv nach .igc-Dateien, unabhängig
  // von der genauen Tiefe der \flights\<Jahr>\<Monat>\<Tag>-Struktur.
  // Dateien, deren Name bereits bei einem vorhandenen Flug als igcFilename
  // hinterlegt ist, werden VOR dem eigentlichen Import (ohne sie überhaupt
  // zu lesen) aussortiert — nur wirklich neue Flüge landen im bestehenden
  // Import-Ablauf (doImport), der Dubletten/Datums-Zuordnung ohnehin schon
  // zuverlässig übernimmt. Einzelne .igc-Dateien lassen sich weiterhin
  // direkt per Drag&Drop auf dieselbe Kachel importieren, unabhängig davon,
  // ob ein Ordner gewählt ist — siehe onDrop weiter unten.
  const igcDirFsapiSupported = typeof window !== "undefined" && !!window.showDirectoryPicker;
  const [igcDirHandle, setIgcDirHandle] = useState(null);
  const [igcDirName, setIgcDirName] = useState(null);
  useEffect(() => {
    if (!igcDirFsapiSupported) return;
    (async () => {
      try {
        const handle = await window.fsapiHandle.get("igcDir");
        if (handle) { setIgcDirHandle(handle); setIgcDirName(handle.name); }
      } catch (e) { console.error("IGC-Ordner laden fehlgeschlagen:", e); }
    })();
  }, [igcDirFsapiSupported]);
  const chooseIgcDir = async () => {
    if (!igcDirFsapiSupported) return;
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      await window.fsapiHandle.set("igcDir", handle);
      setIgcDirHandle(handle);
      setIgcDirName(handle.name);
      // Direkt nach der Auswahl auch scannen/importieren — vorher blieb der
      // erste Klick wirkungslos (er hat nur den Ordner gemerkt), man musste
      // ein zweites Mal klicken, damit tatsächlich etwas importiert wurde.
      // handle wird hier direkt übergeben, statt sich auf den (noch nicht
      // aktualisierten) State igcDirHandle zu verlassen.
      await runIgcDirImport(handle);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      console.error("IGC-Ordnerauswahl fehlgeschlagen:", e);
    }
  };
  const clearIgcDir = async () => {
    await window.fsapiHandle.delete("igcDir");
    setIgcDirHandle(null);
    setIgcDirName(null);
  };
  // Läuft rekursiv durch alle Unterordner (Jahr/Monat/Tag, beliebig tief)
  // und sammelt jede gefundene .igc-Datei als echtes File-Objekt — dieselbe
  // Form, die auch der bestehende Datei-Auswahl-Import liefert, sodass sie
  // direkt an doImport() weitergereicht werden können, ohne dort irgendwas
  // anpassen zu müssen.
  const scanIgcDirRecursive = async (dirHandle) => {
    const files = [];
    const walk = async (handle) => {
      // dirHandle.values() yields handles only (no name) — destructuring
      // each one as [name, entry] then fails with "is not iterable",
      // since a single handle isn't itself iterable. .entries() is the
      // method that actually yields [name, handle] pairs.
      for await (const [name, entry] of handle.entries()) {
        if (entry.kind === "directory") { await walk(entry); continue; }
        if (entry.kind === "file" && /\.igc$/i.test(name)) {
          try { files.push(await entry.getFile()); } catch (e) { console.error("IGC-Datei lesen fehlgeschlagen:", name, e); }
        }
      }
    };
    await walk(dirHandle);
    return files;
  };

  // Derived once whenever the flight list changes — entfernungSL needs
  // every flight's start/end points to compute (great-circle distance),
  // so it's precomputed here rather than in the per-flight sort/search
  // helpers, then used everywhere in place of
  // the raw `flights` for display/search/sort/detail. Kept as a separate
  // array (not stored back into `flights`/persisted) since these are purely
  // derived, not real saved data.
  const flightsWithRanks = useMemo(() => attachComputedRanks(flights), [flights]);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("list"); // list|detail|edit|season
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [igcResult, setIgcResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  // Ergebnis-Banner der einmaligen Nachrechnen-Funktion (recomputeTrackStats,
  // siehe unten) — {scanned, speed, steigen, sinken} oder {running:true}
  // während sie läuft.
  const [recomputeResult, setRecomputeResult] = useState(null);
  // Cache der Schirme-Liste (schirme:list) für die Dauer eines IGC-Imports
  // — vermeidet, bei jeder einzelnen Datei erneut zu laden/zu speichern,
  // und stellt sicher, dass zwei Dateien mit demselben (neuen) Schirm im
  // selben Batch nicht versehentlich zwei separate Einträge anlegen.
  // Wird bei jedem frischen Import-Lauf neu geladen (siehe processIGCFiles).
  const schirmeListRef = useRef(null);
  const [pendingDups, setPendingDups] = useState([]);
  const [dupWarning, setDupWarning] = useState(null);
  // Queue of IGC files that matched no flight by filename, but matched
  // MULTIPLE existing (track-less) flights by date — resolved one at a
  // time via a picker rather than guessing which flight each belongs to.
  const [pendingDateAmbiguous, setPendingDateAmbiguous] = useState([]); // [{file, date, candidates}]
  // Schirme, die im aktuellen IGC-Batch neu auftauchen (noch kein
  // Namens-Treffer in der Schirme-Liste) — vor dem eigentlichen Anlegen der
  // Flüge/Schirme per NewSchirmDialog bestätigt/korrigiert (siehe
  // processIGCFiles). pendingImportRef hält die bereits geparsten Dateien,
  // damit der Import nach der Bestätigung fortgesetzt werden kann, ohne
  // alle Dateien erneut einzulesen.
  const [pendingNewSchirme, setPendingNewSchirme] = useState(null); // null | [{key, raw, name, hersteller}]
  // Dateien im aktuellen Batch, deren Datum+Startzeit exakt zu einem
  // bereits vorhandenen, schon getrackten Flug passen, aber unter einem
  // ANDEREN Dateinamen ankommen (sonst wäre es ein regulärer Re-Import/
  // Update über igcFilename, siehe attachIgcToFlight) — typischerweise
  // dieselbe Aufzeichnung, nochmal aus dem Vario exportiert. Wird vor der
  // Schirm-Erkennung geprüft (siehe processIGCFiles), damit für übersprungene
  // Dateien gar nicht erst nach einem neuen Schirm gefragt wird.
  const [pendingDateDups, setPendingDateDups] = useState(null); // null | [{item, existing}]
  const pendingImportRef = useRef(null);
  const [editData, setEditData] = useState({});
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [showFieldEditor, setShowFieldEditor] = useState(false);
  const [filterText, setFilterTextRaw] = useState("");
  const [sortId, setSortIdRaw] = useState("number");
  const [sortDir, setSortDirRaw] = useState("desc");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [searchRowOpen, setSearchRowOpen] = useState(false);
  // 💡 Saved views: named snapshots of the full Suchen/Sortieren/Gruppieren
  // configuration (filter text, sort field+direction, both grouping levels
  // incl. their own sort field+direction), so a person can jump straight
  // back to a particular way of looking at the flight list instead of
  // rebuilding it each time. Persisted separately from the "last used"
  // settings in flugbuchListSettings.
  const [savedViews, setSavedViewsRaw] = useState([]);
  const [showViewsMenu, setShowViewsMenu] = useState(false);
  const [viewsMode, setViewsMode] = useState("none"); // "none" | "move" | "delete"
  const [savingViewName, setSavingViewName] = useState(null); // string while the "Speichern als…" input is open, else null
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("flugbuchSavedViews");
        if (r && r.value) { const v = JSON.parse(r.value); if (Array.isArray(v)) setSavedViewsRaw(v); }
      } catch (e) {}
    })();
  }, []);
  const setSavedViews = (updater) => {
    setSavedViewsRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try { window.storage.set("flugbuchSavedViews", JSON.stringify(next)); } catch (e) {}
      return next;
    });
  };
  const applyView = (view) => {
    const c = view.config || {};
    setFilterTextRaw(c.filterText || "");
    setSortIdRaw(c.sortId || "number");
    setSortDirRaw(c.sortDir || "desc");
    persistListSettings({
      filterText: c.filterText||"", sortId: c.sortId||"number", sortDir: c.sortDir||"desc",
    });
    setShowViewsMenu(false);
    setSearchRowOpen(false);
  };
  const saveCurrentAsView = (name) => {
    const trimmed = (name||"").trim();
    if (!trimmed) return;
    const config = { filterText, sortId, sortDir };
    setSavedViews(prev => [...prev, { id: "view_"+Date.now(), name: trimmed, config }]);
    setSavingViewName(null);
  };
  // Restores the previously used Suchen/Sortieren settings on
  // mount — flugbuch.html is a separate page (full navigation, not a
  // client-side route), so plain React state always resets to the default
  // on return. Same window.storage pattern already used for the Statistik
  // year filter and per-table sort.
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("flugbuchListSettings");
        if (r && r.value) {
          const s = JSON.parse(r.value);
          if (typeof s.filterText === "string") setFilterTextRaw(s.filterText);
          if (s.sortId) setSortIdRaw(s.sortId);
          if (s.sortDir) setSortDirRaw(s.sortDir);
        }
      } catch (e) { /* nothing stored yet, or storage unavailable — keep defaults */ }
    })();
  }, []);
  const persistListSettings = (patch) => {
    try {
      window.storage.set("flugbuchListSettings", JSON.stringify({
        filterText, sortId, sortDir, ...patch,
      }));
    } catch (e) {}
  };
  const setFilterText = (v) => { setFilterTextRaw(v); persistListSettings({ filterText: v }); };
  const setSortId = (v) => { setSortIdRaw(v); persistListSettings({ sortId: v }); };
  const setSortDir = (updater) => { setSortDirRaw(prev => { const next = typeof updater==="function"?updater(prev):updater; persistListSettings({ sortDir: next }); return next; }); };
  const [showFilterHelp, setShowFilterHelp] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showRowImport, setShowRowImport] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [csvColumns, setCsvColumns] = useState(
    CSV_COLUMN_DEFS.map(c => ({ key: c.key, enabled: true }))
  );
  const [showCsvColumnConfig, setShowCsvColumnConfig] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("csvColumnConfig");
        if (r) {
          const saved = JSON.parse(r.value);
          // Merge with the full column list so a newly-added column (from
          // an app update) still shows up even in an old saved config,
          // appended at the end rather than silently missing.
          const savedKeys = new Set(saved.map(c => c.key));
          const merged = [...saved, ...CSV_COLUMN_DEFS.filter(c => !savedKeys.has(c.key)).map(c => ({ key: c.key, enabled: true }))];
          setCsvColumns(merged);
        }
      } catch (e) { console.error("Load error (csvColumnConfig):", e); }
    })();
  }, []);
  const saveCsvColumns = async (next) => {
    setCsvColumns(next);
    try { await window.storage.set("csvColumnConfig", JSON.stringify(next)); } catch (e) { console.error("Save error (csvColumnConfig):", e); }
  };
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditData, setBulkEditData] = useState({});
  // Wie beim Datum im Flugdetail: eine Datumsänderung hier nummeriert
  // ALLE Flüge neu — deshalb erst nach expliziter Warnung anwendbar.
  const [confirmBulkDateRenumber, setConfirmBulkDateRenumber] = useState(false);
  // Reise-Namen für Dropdowns (ReiseSelect, Mehrfachbearbeitung) — direkt
  // aus allen bereits erfassten Flügen abgeleitet (analog zu den
  // Startplatz-/Landeplatz-Vorschlägen), statt aus einer separat
  // gepflegten Liste: die stand sonst leicht leer da, sobald ein Reise-Wert
  // z.B. aus einem Excel-Import kam statt hier eingetippt zu werden.
  const reisenNames = useMemo(() => {
    const fromFlights = flights.map(f => f.customFields?.reise).filter(Boolean);
    return [...new Set(fromFlights)].sort((a,b) => a.localeCompare(b, "de"));
  }, [flights]);
  // When arriving here via a flight opened from Statistik or Reisen
  // (?openFlightId=...&returnTo=...), the back button in the detail view
  // should return to that exact page instead of this app's own list.
  const [returnTo, setReturnTo] = useState(null);
  const [copyMsg, setCopyMsg] = useState("");
  const [rowImportText, setRowImportText] = useState("");
  const [rowImportError, setRowImportError] = useState("");
  const fileRef = useRef(null);
  // Backup-Hinweis-Flag: geschrieben (nicht mehr lokal angezeigt — der rote
  // Punkt lebt jetzt auf der Startseite, direkt auf der Service-Karte, und
  // wird dort zentral aus diesem einen Schlüssel für ALLE Seiten gelesen).
  // suppressNextDirtyRef verhindert, dass der initiale Lade-Vorgang selbst
  // als "ungesicherte Änderung" gilt.
  const dirtyTrackingReadyRef = useRef(false);
  const suppressNextDirtyRef = useRef(false);
  useEffect(() => {
    if (!dirtyTrackingReadyRef.current) return;
    if (suppressNextDirtyRef.current) { suppressNextDirtyRef.current = false; return; }
    try { window.storage.set("settings:backupDirty", "1"); } catch {}
  }, [flights, customFieldDefs]);

  // Warn if the person tries to leave/reload while flights are still being
  // written to storage — otherwise anything not yet saved would be lost.
  useEffect(() => {
    const handler = (e) => {
      if (importProgress) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [importProgress]);

  // Load flights from storage on mount. All flight data comes from localStorage
  // now (seeded via CSV/PDF import) — no embedded fallback dataset.
  useEffect(() => {
    (async () => {
      let loaded = [];
      try {
        const keys = await window.storage.list("flight:");
        const raw = await Promise.all((keys?.keys||[]).map(async k => {
          try { const r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; } catch { return null; }
        }));
        loaded = raw.filter(Boolean);
      } catch(e) {
        console.error("Storage load error:", e);
        loaded = [];
      }
      const sorted = loaded.sort((a,b) =>
        (parseInt((b.name||"").match(/\d+/)?.[0]||"0",10)) - (parseInt((a.name||"").match(/\d+/)?.[0]||"0",10)));
      setFlights(sorted);
      try {
        const params = new URLSearchParams(window.location.search);
        const openId = params.get("openFlightId");
        const ret = params.get("returnTo");
        if (openId) {
          const target = sorted.find(f => String(f.id) === openId);
          if (target) {
            setSelected(target);
            setView("detail");
            if (ret) setReturnTo(ret);
          }
        }
      } catch {}
      try {
        const r = await window.storage.get("customFieldDefs");
        if (r) {
          const s = JSON.parse(r.value).filter(d => d.id !== "passagier");
          if (s.length) setCustomFieldDefs(s);
        }
      } catch {}
      // Only start flagging real changes once the initial load (flights +
      // customFieldDefs, above) has fully settled and re-rendered — a
      // short delay rather than flipping the flag immediately after the
      // last setState call, so the load's own render/effect pass doesn't
      // get mistaken for an unbacked-up change.
      setTimeout(() => { dirtyTrackingReadyRef.current = true; }, 500);
    })();
  }, []);

    // Bisher wurde ein Fehler hier komplett stillschweigend verschluckt —
    // inklusive eines synchron werfenden JSON.stringify(f) (z.B. bei einem
    // zirkulären Objekt in customFields), was Aufrufer wie saveField unten
    // nie erfuhren: sie aktualisierten den lokalen React-State trotzdem, der
    // Flug sah im UI "gespeichert" aus, obwohl in Wahrheit nichts in
    // IndexedDB/localStorage ankam (siehe Chat vom 2026-08-29 — Flüge mit
    // "GS" im UI, aber leerem Typ laut Statistik/Storage). Jetzt wird der
    // Fehler geloggt und ein Erfolgs-/Fehler-Ergebnis zurückgegeben, damit
    // saveField/saveComputedField den Nutzer warnen können, statt einen
    // nie gespeicherten Wert als gespeichert anzuzeigen. Bestehende
    // Aufrufer, die das Ergebnis ignorieren (await saveFlight(x);), sind
    // davon nicht betroffen — sie verhalten sich wie zuvor.
    const saveFlight = useCallback(async (f) => {
    try {
      await window.storage.set(`flight:${f.id}`, JSON.stringify(f));
      return { ok: true };
    } catch (e) {
      console.error("Flug konnte nicht gespeichert werden:", f?.id, e);
      return { ok: false, error: e };
    }
  }, []);

  // Einmalige Nachrechnen-Funktion für bereits importierte Flüge: läuft über
  // alle Flüge mit echtem GPS-Track und berechnet Max Speed, Max.Steigen,
  // Max.Steigen 20s und Max.Sinken direkt aus genau diesem Track neu (kein
  // erneuter IGC-Import nötig) — alle vier Felder werden dabei IMMER neu
  // berechnet und ein bereits vorhandener Wert bei Bedarf überschrieben,
  // nicht nur leere Felder aufgefüllt. Das ist bewusst so gewählt (statt der
  // "nur auffüllen"-Regel des normalen Imports): eine manuelle Korrektur
  // ausgerechnet dieser vier Track-Werte ist unwahrscheinlich, während ein
  // erneuter Lauf hier gezielt auch bereits gespeicherte Fehlwerte aus einer
  // älteren, ungenaueren Version des jeweiligen Algorithmus korrigieren
  // können muss (siehe Max Speed: ein einzelner schlechter GPS-Fix, z.B.
  // kurz vor der Landung, konnte in der ersten Version fälschlich als
  // Rekordgeschwindigkeit übernommen werden).
  //
  // Läuft ausserdem über ALLE Flüge (nicht nur getrackte) und normalisiert
  // die Dauer-Anzeige auf "Xh MMm" — betrifft vor allem ältere CSV-Importe,
  // die das rohe Dauer-Format aus der Exceldatei (z.B. "0:57") unverändert
  // übernommen hatten, statt es wie IGC-Flüge zu formatieren (siehe
  // formatDurationHM). Rein kosmetisch (die zugrunde liegende durationSec
  // bleibt unverändert), daher immer sicher zu überschreiben — "Dauer" ist
  // in der Detailansicht ohnehin nur ein reines Anzeigefeld (StaticField),
  // eine manuelle Korrektur ist über die UI gar nicht möglich.
  const recomputeTrackStats = useCallback(async () => {
    setRecomputeResult({ running: true });
    const trackedFlights = flights.filter(f => f.track && f.track.length > 1);
    let speedCount = 0, steigenCount = 0, steigen20Count = 0, sinkenCount = 0, durCount = 0;
    const updated = [];
    for (const f of flights) {
      const patch = {};
      const hasTrack = f.track && f.track.length > 1;
      if (hasTrack) {
        const cf = { ...(f.customFields||{}) };
        let cfChanged = false;
        const v = computeMaxStraightSpeedKmh(f.track);
        if (v && v !== f.maxSpeedKmh) { patch.maxSpeedKmh = v; speedCount++; }
        const { maxClimb, maxClimb20, maxSinkRate } = computeClimbSinkStats(f.track);
        if (parseFloat(cf.maxSteigen) !== maxClimb) { cf.maxSteigen = String(maxClimb); steigenCount++; cfChanged = true; }
        if (parseFloat(cf.maxSteigen20) !== maxClimb20) { cf.maxSteigen20 = String(maxClimb20); steigen20Count++; cfChanged = true; }
        if (parseFloat(cf.maxSinken) !== maxSinkRate) { cf.maxSinken = String(maxSinkRate); sinkenCount++; cfChanged = true; }
        if (cfChanged) patch.customFields = cf;
      }
      // Dauer-Darstellung vereinheitlichen ("Xh MMm") — betrifft vor allem
      // ältere CSV-Importe, die das rohe Dauer-Format aus der Exceldatei
      // (z.B. "0:57") direkt übernommen hatten, statt es wie IGC-Flüge auf
      // "2h 27m" zu normalisieren. Läuft über ALLE Flüge, nicht nur
      // getrackte, da genau die betroffenen CSV-Importe meist keinen Track
      // haben.
      if (f.durationSec > 0) {
        const normalized = formatDurationHM(f.durationSec);
        if (f.durationStr !== normalized) { patch.durationStr = normalized; durCount++; }
      }
      if (Object.keys(patch).length) {
        const upd = { ...f, ...patch };
        await saveFlight(upd);
        updated.push(upd);
      }
    }
    if (updated.length) {
      setFlights(prev => prev.map(f => {
        const u = updated.find(x => x.id === f.id);
        return u || f;
      }));
      if (selected) {
        const u = updated.find(x => x.id === selected.id);
        if (u) setSelected(u);
      }
    }
    setRecomputeResult({
      scanned: flights.length, scannedTrack: trackedFlights.length,
      speed: speedCount, steigen: steigenCount, steigen20: steigen20Count, sinken: sinkenCount, dauer: durCount,
    });
  }, [flights, saveFlight, selected]);

  const addNewFlight = useCallback(async () => {
    // Next sequential number = max existing numeric name + 1
    const maxNr = flights.reduce((m,f)=>{
      const n = parseInt((f.name||"").match(/\d+/)?.[0]||"0",10);
      return n>m?n:m;
    }, 0);
    const newNr = maxNr + 1;
    const now = new Date();
    const dd = String(now.getDate()).padStart(2,"0");
    const mm = String(now.getMonth()+1).padStart(2,"0");
    const yyyy = String(now.getFullYear());
    const newFlight = {
      id: `manual_${newNr}_${Date.now()}`,
      name: String(newNr),
      pdfOnly: false,
      date: `${dd}.${mm}.${yyyy}`,
      rawDate: `${dd}.${mm}.${yyyy}`,
      year: yyyy, month: mm,
      startTime: "", endTime: "",
      site: "", glider: "", pilot: "",
      comment: "", notes: "", rating: 0,
      durationStr: "", durationSec: 0,
      totalDist: 0, maxAlt: 0, startAlt: 0, endAlt: 0,
      startPt: null, endPt: null, track: [],
      customFields: { landung:"", typ:"GS", typAuto:true },
    };
    await saveFlight(newFlight);
    setFlights(prev => [newFlight, ...prev].sort((a,b)=>
      (parseInt((b.name||"").match(/\d+/)?.[0]||"0",10)) - (parseInt((a.name||"").match(/\d+/)?.[0]||"0",10))));
    setSelected(newFlight);
    setView("detail");
  }, [flights, saveFlight]);

  const handleSaveFields = useCallback(async (defs) => {
    setCustomFieldDefs(defs); setShowFieldEditor(false);
    try { await window.storage.set("customFieldDefs", JSON.stringify(defs)); } catch {}
  }, []);

  const doImport = useCallback(async (igcFiles) => {
    if (!igcFiles.length) return;
    setImporting(true); setImportProgress({done:0,total:igcFiles.length});
    const toImport = []; const dups = [];
    // Only treat a file as a duplicate if the matching flight already has a
    // REAL GPS track (track.length > 1) — a flight that merely exists (e.g.
    // imported from CSV with no track yet) should not block a fresh IGC import.
    // Matched via the stored igcFilename field, not the flight's Nummer —
    // Nummer no longer doubles as the source filename (see processIGCFiles).
    const flightsWithTrack = new Map(
      flights.filter(f => f.track && f.track.length > 1 && f.customFields?.igcFilename)
        .map(f => [f.customFields.igcFilename, f])
    );
    for (const file of igcFiles) {
      const baseName = file.name.replace(/\.igc$/i,"");
      if (flightsWithTrack.has(baseName)) dups.push(file);
      else toImport.push(file);
    }
    if (dups.length) { setPendingDups({confirmed:[...toImport],ask:dups}); setDupWarning(dups.map(f=>f.name).join(", ")); setImporting(false); setImportProgress(null); return; }
    await processIGCFiles(toImport);
  }, [flights]);

  // Scannt den gewählten IGC-Ordner rekursiv, sortiert
  // Dateien, deren Name bereits als igcFilename bei einem vorhandenen Flug
  // hinterlegt ist, LEISE aus (kein Dubletten-Dialog für hunderte alte
  // Dateien) und übergibt nur die wirklich neuen an den bestehenden
  // Import-Ablauf (doImport) — der kümmert sich danach wie gewohnt um
  // Datums-Zuordnung, Mehrdeutigkeiten usw.
  const [igcDirScanning, setIgcDirScanning] = useState(false);
  const [igcDirResult, setIgcDirResult] = useState(null);
  const runIgcDirImport = useCallback(async (handleOverride) => {
    // handleOverride erlaubt den Aufruf direkt nach chooseIgcDir(), bevor
    // der State igcDirHandle im selben Tick bereits aktualisiert ist.
    const handle = handleOverride || igcDirHandle;
    if (!handle) return;
    setIgcDirScanning(true); setIgcDirResult(null);
    try {
      const allFiles = await scanIgcDirRecursive(handle);
      const knownNames = new Set(
        flights.map(f => f.customFields?.igcFilename).filter(Boolean)
      );
      const newFiles = allFiles.filter(f => !knownNames.has(f.name.replace(/\.igc$/i,"")));
      setIgcDirScanning(false);
      setIgcDirResult({ total: allFiles.length, neu: newFiles.length });
      if (newFiles.length) await doImport(newFiles);
    } catch (e) {
      console.error("Vario-Import fehlgeschlagen:", e);
      setIgcDirScanning(false);
      setIgcDirResult({ error: e.message || String(e) });
    }
  }, [igcDirHandle, flights, doImport]);


  // Nimmt den rohen Schirm-Namen aus dem IGC-Header (HFGTY), trennt einen
  // bekannten Hersteller-Namen ab (siehe splitFirstWordAsHersteller/
  // KNOWN_SCHIRM_HERSTELLER oben) und sucht/erzeugt in der Schirme-Liste
  // (schirme:list, dieselbe Liste wie auf der Schirme-Seite) den
  // zugehörigen Eintrag — siehe schirme.jsx (generateFromFlights/
  // matchesSchirm) für die analoge Logik dort. Gibt den bereinigten Namen
  // (ohne Hersteller-Wort, falls einer erkannt wurde) und die schirmId
  // zurück, die dann in customFields.schirmId abgelegt wird, damit die
  // Schirme-Seite den Flug robust zuordnen kann.
  // overrideMap (optional): Map<normalisierter Schirm-Vorschlag, {id,name}>
  // aus einem gerade eben per NewSchirmDialog bestätigten Batch — greift
  // VOR der Namens-Suche, damit ein im Dialog umbenannter Schirm (der
  // Vorschlag "cleaned" stimmt dann nicht mehr mit dem Eintragsnamen
  // überein) trotzdem gefunden wird statt ein zweites Mal angelegt zu
  // werden.
  const resolveSchirmForGlider = useCallback(async (rawGlider, overrideMap) => {
    const { hersteller, cleaned } = splitFirstWordAsHersteller(rawGlider);
    if (!cleaned) return { name: "", schirmId: null };
    const norm = s => (s || "").trim().toLowerCase();
    if (overrideMap && overrideMap.has(norm(cleaned))) {
      const ov = overrideMap.get(norm(cleaned));
      return { name: ov.name, schirmId: ov.id };
    }
    let list = schirmeListRef.current;
    if (!list) {
      try {
        const r = await window.storage.get(SCHIRME_KEY);
        list = r ? JSON.parse(r.value) : [];
      } catch (e) { console.error("Schirme-Liste laden fehlgeschlagen:", e); list = []; }
      schirmeListRef.current = list;
    }
    let entry = list.find(s => norm(s.name) === norm(cleaned));
    let changed = false;
    if (entry) {
      // Hersteller nachtragen, falls beim gefundenen Eintrag noch leer.
      if (!entry.hersteller && hersteller) {
        entry = { ...entry, hersteller };
        list = list.map(s => s.id === entry.id ? entry : s);
        changed = true;
      }
    } else {
      entry = { id: `schirm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: cleaned, hersteller: hersteller || "", typ: "", letzterCheck: "", materialEntryId: null };
      list = [...list, entry];
      changed = true;
    }
    schirmeListRef.current = list;
    if (changed) {
      try {
        await window.storage.set(SCHIRME_KEY, JSON.stringify(list));
        await window.storage.set("settings:backupDirty", "1");
      } catch (e) { console.error("Schirme-Liste speichern fehlgeschlagen:", e); }
    }
    return { name: cleaned, schirmId: entry.id };
  }, []);

  // Applies parsed IGC data onto an existing flight (shared by both the
  // filename-match and the date-match paths, so they stay in sync).
  const attachIgcToFlight = useCallback(async (existing, track, date, pilot, glider, igcData, igcFilename, overrideMap) => {
    const cf = { ...(existing.customFields||{}) };
    // Gleiche Regel wie der Typ-Auto-Effekt in FlightDetail: nur setzen,
    // wenn noch kein Typ vorhanden ist und der Flug nicht explizit vom
    // automatischen Typ abgemeldet wurde (typAuto:false, z.B. nach
    // manueller Korrektur). So bekommt auch ein Flug, der z.B. per Excel
    // ohne Typ importiert und danach per IGC nachträglich mit einem Track
    // versehen wird, sofort einen durchsuchbaren Typ statt erst beim
    // ersten Öffnen der Detailansicht.
    if (!(cf.typ||"").trim() && cf.typAuto !== false) { cf.typ = "GS"; cf.typAuto = true; }
    if (!(cf.hGew||"").trim() && !isNaN(igcData.totalGain)) cf.hGew = String(igcData.totalGain);
    if (igcData.hDiff) cf.hDiff = String(igcData.hDiff);
    // Max.Steigen/Max.Steigen 20s/Max.Sinken werden bei einem (Re-)Import
    // IMMER aus dem gerade eingelesenen Track neu gesetzt, nicht nur wenn
    // sie noch leer sind — anders als z.B. Landeplatz/Distanz oben/unten,
    // die oft aus einer externen Quelle (XContest, Notizen) stammen und nie
    // überschrieben werden dürfen. Eine manuelle Korrektur ausgerechnet
    // dieser drei rein Track-berechneten Werte ist unwahrscheinlich, und ein
    // erneuter Import desselben oder eines korrigierten Files soll auch
    // hier veraltete/fehlerhafte gespeicherte Werte korrigieren können
    // (analog zur Nachrechnen-Funktion, siehe recomputeTrackStats).
    cf.maxSteigen = String(igcData.maxClimb);
    cf.maxSteigen20 = String(igcData.maxClimb20);
    cf.maxSinken = String(igcData.maxSinkRate);
    // Original IGC filename kept as its own field (shown in the Detail
    // view, not the list) — this is what lets a later re-import of the
    // same corrected file find this exact flight again, now that the
    // flight's "Nummer" (name) is always a plain sequential number rather
    // than doubling as the filename.
    if (igcFilename) cf.igcFilename = igcFilename;
    // Schirm-Zuordnung: nur auflösen, wenn diesem Flug noch keine schirmId
    // zugeordnet ist — ein bereits verknüpfter Flug (z.B. manuell auf der
    // Schirme-Seite korrigiert) wird hier nie überschrieben.
    let cleanedGlider = "";
    if (!cf.schirmId) {
      const resolved = await resolveSchirmForGlider(glider, overrideMap);
      cleanedGlider = resolved.name;
      if (resolved.schirmId) cf.schirmId = resolved.schirmId;
    }
    // Startplatz/Landeplatz/Land automatisch von einem nahegelegenen
    // bereits vorhandenen Flug übernehmen (bzw. Land per MapTiler
    // bestimmen) — nur für Felder, die hier noch leer sind; ein bereits
    // erfasster Wert (z.B. aus Excel) wird nie überschrieben.
    const startPtForInfer = existing.startPt || igcData.startPt;
    const endPtForInfer = existing.endPt || igcData.endPt;
    const needsSite = !(existing.site||"").trim();
    const needsLandung = !(cf.landung||"").trim();
    const needsLand = !(cf.land||"").trim();
    let inferredSite = "", inferredLandung = "";
    if (needsSite || needsLandung || needsLand) {
      const inferred = await inferPlaceAndCountry(startPtForInfer, endPtForInfer, flights, placeMatchRadiusKm, mapTilerKey);
      inferredSite = inferred.site; inferredLandung = inferred.landung;
      if (needsLandung && inferred.landung) cf.landung = inferred.landung;
      if (needsLand && inferred.land) cf.land = inferred.land;
    }
    // Distanz (analog XContest, bis zu 3 Wendepunkte) und Ø Speed nur
    // nachtragen, wenn beide Felder noch leer sind — ein bereits erfasster
    // (z.B. manuell von XContest übernommener) Wert wird nie überschrieben.
    const backfill = computeDistanceSpeedBackfill(existing.totalDist, cf, igcData.scoreDistanceKm, igcData.durationSec || existing.durationSec);
    if (backfill.distKm != null) cf.distKm = backfill.distKm;
    if (backfill.kmh != null) cf.kmh = backfill.kmh;
    const updated = {
      ...existing, track, customFields: cf,
      pilot: (existing.pilot||"").trim() ? existing.pilot : (pilot||existing.pilot),
      glider: (existing.glider||"").trim() ? existing.glider : (cleanedGlider||existing.glider),
      site: needsSite && inferredSite ? inferredSite : existing.site,
      maxAlt: existing.maxAlt || igcData.maxAlt,
      minAlt: existing.minAlt || igcData.minAlt,
      // Immer aus dem gerade eingelesenen Track neu gesetzt (nicht nur wenn
      // leer) — siehe Begründung bei Max.Steigen/-20s/Max.Sinken oben.
      maxSpeedKmh: igcData.maxSpeedKmh,
      startPt: existing.startPt || igcData.startPt,
      endPt: existing.endPt || igcData.endPt,
      startAlt: existing.startAlt || igcData.startAlt,
      endAlt: existing.endAlt || igcData.endAlt,
      durationSec: igcData.durationSec || existing.durationSec,
      durationStr: igcData.durationStr || existing.durationStr,
      startTime: (existing.startTime||"").trim() ? existing.startTime : igcData.startTime,
      endTime: (existing.endTime||"").trim() ? existing.endTime : igcData.endTime,
      totalDist: backfill.totalDist != null ? backfill.totalDist : existing.totalDist,
    };
    await saveFlight(updated);
    setFlights(prev=>prev.map(f=>f.id===updated.id?updated:f));
    if (selected?.id===updated.id) setSelected(updated);
  }, [selected, saveFlight, flights, placeMatchRadiusKm, mapTilerKey, resolveSchirmForGlider]);

  // Zweiter Teil des Imports (nach einer evtl. NewSchirmDialog-Bestätigung)
  // — arbeitet auf bereits geparsten Dateien, damit ein pausierter Import
  // nach der Bestätigung nicht alle Dateien erneut einlesen/parsen muss.
  // overrideMap: siehe resolveSchirmForGlider — nur gesetzt, wenn gerade
  // eben neue Schirme im Dialog bestätigt wurden.
  const runImportLoop = useCallback(async (parsedList, overrideMap) => {
    const newFlights = [];
    let updatedCount = 0;
    const dateAmbiguous = [];
    // Running "next number" for brand-new flights created in this batch —
    // continues from the current overall max so numbers stay unique even
    // across several new flights created in the same import.
    let maxNr = flights.reduce((m, f) => {
      const n = /^\d+$/.test(f.name||"") ? parseInt(f.name, 10) : 0;
      return n > m ? n : m;
    }, 0);
    for (let i=0; i<parsedList.length; i++) {
      const { file, track, date, pilot, glider, igcData, baseName } = parsedList[i];
      // Matched via the stored igcFilename (Detail-only field), not the
      // flight's Nummer — "Nummer" is always a plain sequential number
      // now, never the raw filename, so re-importing a corrected file
      // needs its own dedicated match key.
      const existing = flights.find(f=>f.customFields?.igcFilename===baseName);
      // Parse date
      const dateParts = date.split(".");
      let yr="", mo="", dateStr=date;
      if(dateParts.length===3){yr=dateParts[2];mo=dateParts[1];dateStr=date;}
      if (existing) {
        // Re-importing only ever updated the raw track before, so any
        // igcData-derived field that was empty (like H.Gew. after being
        // cleared) never got a chance to be recalculated. Now it fills in
        // anything currently blank, without touching values that are
        // already set (manually or from a previous import).
        await attachIgcToFlight(existing, track, date, pilot, glider, igcData, baseName, overrideMap);
        updatedCount++;
      } else {
        // No filename match — try matching by date instead, but only
        // against flights that don't already have a real track (a flight
        // that's already got GPS data from a previous import shouldn't be
        // silently overwritten just because the date happens to match).
        const dateCandidates = flights.filter(f => f.date===dateStr && (!f.track || f.track.length<=1));
        if (dateCandidates.length === 1) {
          await attachIgcToFlight(dateCandidates[0], track, date, pilot, glider, igcData, baseName, overrideMap);
          updatedCount++;
        } else if (dateCandidates.length > 1) {
          // Ambiguous — don't guess. Resolved via a picker after this loop.
          dateAmbiguous.push({ file, date: dateStr, track, pilot, glider, igcData, candidates: dateCandidates, baseName });
        } else {
          // Fresh flight, nothing to preserve — Distanz/Speed simply use
          // whatever computeDistanceSpeedBackfill derives from this IGC
          // file directly (existingTotalDist=0, cf={} → both count as
          // "empty"). Nummer is the next free sequential number — the
          // raw filename is kept only in customFields.igcFilename
          // (Detail-Ansicht), not as the flight's Nummer/name.
          maxNr += 1;
          const backfill = computeDistanceSpeedBackfill(0, {}, igcData.scoreDistanceKm, igcData.durationSec);
          // Startplatz/Landeplatz/Land automatisch von einem nahegelegenen
          // bereits vorhandenen Flug übernehmen (bzw. Land per MapTiler
          // bestimmen, falls kein Treffer) — siehe inferPlaceAndCountry.
          const inferred = await inferPlaceAndCountry(igcData.startPt, igcData.endPt, flights, placeMatchRadiusKm, mapTilerKey);
          // Hersteller-Wort abtrennen und den Rest in der Schirme-Liste
          // finden/anlegen — siehe resolveSchirmForGlider oben.
          const { name: cleanedGlider, schirmId } = await resolveSchirmForGlider(glider, overrideMap);
          const newF = { id:`igc_${baseName}_${Date.now()}`, name:String(maxNr), pdfOnly:false,
            date:dateStr, rawDate:date, year:yr, month:mo, pilot:pilot||"",site:inferred.site||"",glider:cleanedGlider||"",
            startTime:"", endTime:"", comment:"", rating:0, notes:"", track,
            customFields:{landung:inferred.landung||"",land:inferred.land||"",igcFilename:baseName,schirmId:schirmId||"",
              // Typ direkt beim Import setzen (wie beim manuellen Neuanlegen
              // eines Flugs) — vorher wurde "GS" erst beim ersten Öffnen der
              // Detailansicht gesetzt (siehe useEffect in FlightDetail), was
              // frisch importierte, noch nie geöffnete Flüge bei der Suche
              // nach Typ=GS unauffindbar machte, obwohl die Detailansicht
              // "GS" angezeigt hätte, sobald man sie geöffnet hätte.
              typ: "GS", typAuto: true,
              hGew: igcData.totalGain ? String(igcData.totalGain) : "",
              hDiff: igcData.hDiff ? String(igcData.hDiff) : "",
              maxSteigen: igcData.maxClimb ? String(igcData.maxClimb) : "",
              maxSteigen20: igcData.maxClimb20 ? String(igcData.maxClimb20) : "",
              maxSinken: igcData.maxSinkRate ? String(igcData.maxSinkRate) : "",
              distKm: backfill.distKm || "", kmh: backfill.kmh || ""},
            ...igcData, startPt:igcData.startPt, endPt:igcData.endPt,
            totalDist: backfill.totalDist || 0 };
          await saveFlight(newF);
          newFlights.push(newF);
        }
      }
      setImportProgress({done:i+1,total:parsedList.length});
    }
    if (newFlights.length) setFlights(prev=>[...newFlights,...prev].sort((a,b)=>(parseInt((b.name||"").match(/\d+/)?.[0]||"0",10))-(parseInt((a.name||"").match(/\d+/)?.[0]||"0",10))));
    if (dateAmbiguous.length) setPendingDateAmbiguous(dateAmbiguous);
    setIgcResult({ created: newFlights.length, updated: updatedCount, total: parsedList.length, deferred: dateAmbiguous.length });
    setTimeout(() => setIgcResult(null), 6000);
    setImporting(false); setImportProgress(null);
  }, [flights, saveFlight, attachIgcToFlight, placeMatchRadiusKm, mapTilerKey, resolveSchirmForGlider]);

  // Dritter (letzter) Erkennungsschritt vor dem eigentlichen Anlegen von
  // Flügen/Schirmen — separat, damit er sowohl direkt nach dem Parsen als
  // auch nach einer Datums-Dubletten-Entscheidung (überspringen/trotzdem
  // importieren) aufgerufen werden kann, ohne Code zu duplizieren.
  const detectAndHandleNewSchirme = useCallback(async (parsedList) => {
    const schirmeList = schirmeListRef.current || [];
    const norm = s => (s || "").trim().toLowerCase();
    const unknown = new Map(); // norm(cleaned) -> {key, raw, name, hersteller}
    for (const p of parsedList) {
      const { hersteller, cleaned } = splitFirstWordAsHersteller(p.glider);
      if (!cleaned) continue;
      const key = norm(cleaned);
      if (schirmeList.some(s => norm(s.name) === key)) continue; // schon vorhanden
      if (unknown.has(key)) continue; // im selben Batch schon erfasst
      unknown.set(key, { key, raw: p.glider, name: cleaned, hersteller });
    }
    if (unknown.size) {
      // Import pausiert hier — noch nichts gespeichert. Wird erst nach
      // Bestätigung (oder Abbruch) im NewSchirmDialog fortgesetzt.
      pendingImportRef.current = { parsedList };
      setPendingNewSchirme([...unknown.values()]);
      setImporting(false); setImportProgress(null);
      return;
    }
    await runImportLoop(parsedList, null);
  }, [runImportLoop]);

  // Eine Datei zählt als "vermutlich schon vorhanden", wenn Datum+Startzeit
  // exakt zu einem bereits gespeicherten, schon getrackten Flug passen —
  // aber NICHT, wenn der Dateiname übereinstimmt (das ist ein regulärer
  // Re-Import/Update über igcFilename, siehe attachIgcToFlight) und auch
  // nicht, wenn der passende Flug noch KEINEN Track hat (dafür sorgt
  // bereits die bestehende Datums-Zuordnung — dateCandidates — in
  // runImportLoop). Ziel: dieselbe Aufzeichnung, unter einem anderen
  // Dateinamen erneut exportiert, legt nicht versehentlich einen zweiten,
  // komplett separaten Flug an.
  const findDateTimeDuplicate = (p) => {
    if (!p.igcData.startTime) return null;
    if (flights.some(f => f.customFields?.igcFilename === p.baseName)) return null;
    return flights.find(f => f.track && f.track.length > 1 && f.date === p.date && f.startTime === p.igcData.startTime) || null;
  };

  const processIGCFiles = useCallback(async (igcFiles) => {
    setImporting(true); setImportProgress({done:0,total:igcFiles.length});
    // Frischer Batch → Schirme-Liste neu laden, statt eine evtl. veraltete
    // Kopie von einem vorherigen Import weiterzuverwenden.
    let schirmeList;
    try {
      const r = await window.storage.get(SCHIRME_KEY);
      schirmeList = r ? JSON.parse(r.value) : [];
    } catch (e) { console.error("Schirme-Liste laden fehlgeschlagen:", e); schirmeList = []; }
    schirmeListRef.current = schirmeList;

    // Alle Dateien vorab einlesen/parsen (statt im Import-Loop selbst),
    // damit sich unten — VOR dem eigentlichen Anlegen von Flügen/Schirmen —
    // schon erkennen lässt, welche Dateien vermutlich Dubletten sind und
    // welche Schirm-Namen im Batch neu sind.
    const parsedList = [];
    for (const file of igcFiles) {
      const text = await file.text();
      const { track, date, pilot, glider, tzOffsetHours } = parseIGC(text);
      const igcData = analyzeIGC(track, tzOffsetHours, date);
      const baseName = file.name.replace(/\.igc$/i,"");
      parsedList.push({ file, track, date, pilot, glider, igcData, baseName });
    }

    const dateDups = [];
    const nonDupList = [];
    for (const p of parsedList) {
      const existing = findDateTimeDuplicate(p);
      if (existing) dateDups.push({ item: p, existing });
      else nonDupList.push(p);
    }
    if (dateDups.length) {
      // Import pausiert hier — noch nichts gespeichert. Wird erst nach
      // Überspringen/Trotzdem-importieren im DateDupWarningDialog fortgesetzt.
      pendingImportRef.current = { nonDupList, dateDups };
      setPendingDateDups(dateDups);
      setImporting(false); setImportProgress(null);
      return;
    }
    await detectAndHandleNewSchirme(parsedList);
  }, [flights, detectAndHandleNewSchirme]);

  const resolveDateDups = useCallback(async (importAnyway) => {
    const { nonDupList, dateDups } = pendingImportRef.current || { nonDupList: [], dateDups: [] };
    const parsedList = importAnyway ? [...nonDupList, ...dateDups.map(d => d.item)] : nonDupList;
    pendingImportRef.current = null;
    setPendingDateDups(null);
    setImporting(true); setImportProgress({done:0,total:parsedList.length});
    await detectAndHandleNewSchirme(parsedList);
  }, [detectAndHandleNewSchirme]);

  // Nutzer hat den NewSchirmDialog bestätigt (ggf. mit korrigiertem
  // Schirm-Namen/Hersteller) — legt die Einträge an (oder verknüpft mit
  // einem inzwischen gleichnamigen bestehenden Eintrag, falls der Nutzer
  // auf einen schon existierenden Namen umbenannt hat) und setzt den
  // pausierten Import fort.
  const confirmNewSchirme = useCallback(async (edited) => {
    const pending = pendingNewSchirme || [];
    const norm = s => (s || "").trim().toLowerCase();
    let list = schirmeListRef.current || [];
    const overrideMap = new Map();
    let changed = false;
    pending.forEach((item, i) => {
      const finalName = (edited[i]?.name || "").trim() || item.name;
      const finalHersteller = (edited[i]?.hersteller || "").trim();
      let entry = list.find(s => norm(s.name) === norm(finalName));
      if (!entry) {
        entry = { id: `schirm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${i}`,
          name: finalName, hersteller: finalHersteller, typ: "", letzterCheck: "", materialEntryId: null };
        list = [...list, entry];
        changed = true;
      } else if (!entry.hersteller && finalHersteller) {
        entry = { ...entry, hersteller: finalHersteller };
        list = list.map(s => s.id === entry.id ? entry : s);
        changed = true;
      }
      overrideMap.set(item.key, { id: entry.id, name: entry.name });
    });
    schirmeListRef.current = list;
    if (changed) {
      try {
        await window.storage.set(SCHIRME_KEY, JSON.stringify(list));
        await window.storage.set("settings:backupDirty", "1");
      } catch (e) { console.error("Schirme-Liste speichern fehlgeschlagen:", e); }
    }
    setPendingNewSchirme(null);
    const { parsedList } = pendingImportRef.current || { parsedList: [] };
    pendingImportRef.current = null;
    setImporting(true); setImportProgress({done:0,total:parsedList.length});
    await runImportLoop(parsedList, overrideMap);
  }, [pendingNewSchirme, runImportLoop]);

  const cancelNewSchirme = useCallback(() => {
    // Vor dieser Bestätigung wurde noch nichts gespeichert — einfach
    // verwerfen, der ganze Batch wird nicht importiert.
    pendingImportRef.current = null;
    setPendingNewSchirme(null);
  }, []);

  const importIGCFiles = useCallback(async (files) => {
    const igc = files.filter(f=>f.name.toLowerCase().endsWith(".igc"));
    if (!igc.length) return;
    await doImport(igc);
  }, [doImport]);


  const saveEdit = useCallback(async () => {
    if (!selected) return;
    const updated = { ...selected, ...editData,
      customFields: { ...(selected.customFields||{}), ...(editData.customFields||{}) } };
    await saveFlight(updated);
    setFlights(prev=>prev.map(f=>f.id===updated.id?updated:f));
    setSelected(updated); setView("detail");
  }, [selected, editData, saveFlight]);

  // Grouped flights
  const filteredFlights = matchFlights(flightsWithRanks, filterText);
  const parseDurForList = s => { if(!s)return 0; const a=s.match(/(\d+):(\d{2}):(\d{2})/); if(a)return+a[1]*3600+ +a[2]*60+ +a[3]; const b=s.match(/(\d+):(\d{2})/); if(b)return+b[1]*60+ +b[2]; const c=s.match(/(\d+)h\s*(\d+)m/); if(c)return+c[1]*3600+ +c[2]*60; return 0; };
  const getDurFlight = f => f.durationSec || parseDurForList(f.durationStr);
  const longestId = flights.length ? flights.reduce((a,b)=>getDurFlight(a)>getDurFlight(b)?a:b).id : null;

  const enrichedSelected = selected ? (flightsWithRanks.find(f=>f.id===selected.id) || selected) : null;

  if (view==="worldmap") return <WorldMapView flights={filteredFlights} selectedIds={selectedIds} onBack={()=>setView("list")} mapTilerKey={mapTilerKey} />;

  // ── DETAIL VIEW ─────────────────────────────────────────────────────────
  if (view==="detail" && selected && isWide) {
    return (
      <div style={{display:"flex",height:"100vh",overflow:"hidden",background:"#040e20"}}>
        <SidebarList flights={filterText.trim() ? filteredFlights : flights} selectedId={selected.id} longestId={longestId}
          onSelect={f=>{setSelected(f);}} />
        <div style={{flex:1,minWidth:0,height:"100vh",overflowY:"auto"}}>
          <DetailContent fl={enrichedSelected} flights={flightsWithRanks} navFlights={filterText.trim() ? filteredFlights : flightsWithRanks} customFieldDefs={customFieldDefs}
            setFlights={setFlights} setSelected={setSelected} setView={setView}
            setEditData={setEditData}
            saveFlight={saveFlight} showFieldEditor={showFieldEditor} setShowFieldEditor={setShowFieldEditor}
            handleSaveFields={handleSaveFields} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete}
            returnTo={returnTo} mapTilerKey={mapTilerKey}
            hideBackButton={true} isWide={true} />
        </div>
      </div>
    );
  }
  if (view==="detail" && selected) {
    return <DetailContent fl={enrichedSelected} flights={flightsWithRanks} navFlights={filterText.trim() ? filteredFlights : flightsWithRanks} customFieldDefs={customFieldDefs}
      setFlights={setFlights} setSelected={setSelected} setView={setView}
      setEditData={setEditData}
      saveFlight={saveFlight} showFieldEditor={showFieldEditor} setShowFieldEditor={setShowFieldEditor}
      handleSaveFields={handleSaveFields} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete}
      returnTo={returnTo} mapTilerKey={mapTilerKey}
      isWide={isWide} />;
  }

  // ── EDIT VIEW ────────────────────────────────────────────────────────────
  if (view==="edit" && selected) {
    const fl = selected;
    const manualFields = customFieldDefs.filter(d=>!d.formula);
    return (
      <div style={{maxWidth:480,margin:"0 auto",padding:"0 0 32px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,padding:"calc(16px + env(safe-area-inset-top, 0px)) 16px 12px"}}>
          <button onClick={()=>setView("detail")} style={{background:"none",border:"none",color:"#7dd3fc",fontSize:22,cursor:"pointer"}}>←</button>
          <span style={{fontWeight:800,fontSize:17}}>{fl.name} bearbeiten</span>
        </div>
        <div style={{padding:"0 16px"}}>
          {[["Name / Titel",editData.name||"","name"],["Startplatz",editData.site||"","site"],
            ["Landeplatz",editData.customFields?.landung||"","landung"],["Schirm",editData.glider||"","glider"]].map(([l,v,k])=>(
            <div key={k} style={{marginBottom:12}}>
              <div style={{fontSize:11,color:"rgba(232,244,253,0.4)",marginBottom:4}}>{l}</div>
              <input value={v} onChange={e=>{
                if(k==="landung") setEditData(d=>({...d,customFields:{...(d.customFields||{}),landung:e.target.value}}));
                else setEditData(d=>({...d,[k]:e.target.value}));
              }}
                style={{width:"100%",background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"10px 13px",color:"#e8f4fd",fontSize:14,boxSizing:"border-box"}} />
            </div>
          ))}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,color:"rgba(232,244,253,0.4)",marginBottom:6}}>Bewertung</div>
            <div style={{display:"flex",gap:6}}>
              {[1,2,3,4,5].map(s=>(
                <button key={s} onClick={()=>setEditData(d=>({...d,rating:(d.rating||0)===s?0:s}))}
                  style={{fontSize:22,background:"none",border:"none",cursor:"pointer",color:s<=(editData.rating||0)?"#f59e0b":"rgba(232,244,253,0.2)"}}>★</button>
              ))}
            </div>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:"rgba(232,244,253,0.4)",marginBottom:4}}>Notizen</div>
            <textarea value={editData.notes||""} onChange={e=>setEditData(d=>({...d,notes:e.target.value}))} rows={2}
              style={{width:"100%",background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"10px 13px",color:"#e8f4fd",fontSize:13,resize:"vertical",boxSizing:"border-box"}} />
          </div>
          {manualFields.length>0&&manualFields.map(f=>(
            <div key={f.id} style={{marginBottom:12}}>
              <div style={{fontSize:11,color:"rgba(232,244,253,0.4)",marginBottom:4}}>{f.name}</div>
              <input value={editData.customFields?.[f.id]||""} onChange={e=>setEditData(d=>({...d,customFields:{...(d.customFields||{}),[f.id]:e.target.value}}))} type={f.type==="number"?"number":f.type==="date"?"date":"text"}
                style={{width:"100%",background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"10px 13px",color:"#e8f4fd",fontSize:14,boxSizing:"border-box"}} />
            </div>
          ))}
          <button onClick={()=>setShowFieldEditor(true)} style={{width:"100%",background:"rgba(139,92,246,0.1)",color:"#c4b5fd",border:"1px solid rgba(139,92,246,0.22)",borderRadius:12,padding:12,fontSize:13,fontWeight:600,cursor:"pointer",marginBottom:14}}>
            ⚙️ Felder verwalten
          </button>
          <button onClick={saveEdit} style={{width:"100%",background:"linear-gradient(135deg,#0ea5e9,#0284c7)",color:"#fff",border:"none",borderRadius:13,padding:14,fontSize:15,fontWeight:800,cursor:"pointer"}}>Speichern</button>
        </div>
        {showFieldEditor&&<FieldEditor customFieldDefs={customFieldDefs} onSave={handleSaveFields} onClose={()=>setShowFieldEditor(false)} />}
      </div>
    );
  }

  // ── LIST VIEW ─────────────────────────────────────────────────────────────
  // Import/Auswahl/Weltkarte/Darstellungen/Suchen — 5 Icon-Buttons,
  // einheitliches Design: grauer Rand standardmässig, die jeweils aktive
  // Kachel (offenes Panel) mit rotem Rand und flächig leicht rot
  // eingefärbtem Hintergrund. Reihenfolge (Sortierrichtung) und die feste
  // Jahres-Gruppierung sind hierher ins Suchen/Sortieren-Panel gewandert,
  // seit Jahr nur noch ein wählbares Gruppieren-Feld unter mehreren ist
  // statt eines fest verdrahteten Extra-Buttons.
  // In Hochformat stehen sie in einer eigenen Zeile unter dem Titel; in
  // Handy-Queransicht (wenig Höhe, aber genug Breite) rutschen sie
  // stattdessen mit in die Titelzeile zwischen "Flugbuch" und "+Flug",
  // damit diese Zeile keinen zusätzlichen vertikalen Platz braucht —
  // "+Flug" bekommt dafür dort dasselbe schlichte Kachel-Aussehen wie die
  // 5 anderen Buttons statt der grünen Pille.
  const headerIconButtons = [
    { key:"import", title:"Import", active:showImportMenu, onClick:()=>{ setShowImportMenu(m=>!m); }, icon:"📥" },
    { key:"select", title:"Auswahl", active:selectMode, onClick:()=>{ setSelectMode(m=>!m); setSelectedIds(new Set()); setCopyMsg(""); }, icon: selectMode?"✕":"☑" },
    { key:"map", title:"Weltkarte", active:false, onClick:()=>setView("worldmap"), icon:"🗺️" },
    { key:"views", title:"Gespeicherte Darstellungen", active:showViewsMenu, onClick:()=>{ setShowViewsMenu(m=>!m); setShowImportMenu(false); setViewsMode("none"); setSavingViewName(null); }, icon:"💡" },
    { key:"search", title:"Suchen/Sortieren", active:searchRowOpen, onClick:()=>{ setSearchRowOpen(o=>!o); setShowImportMenu(false); }, icon:"🔍" },
  ];
  const headerTileStyle = (active, compact) => compact
    ? {width:34,height:34,flexShrink:0,boxSizing:"border-box",display:"flex",alignItems:"center",justifyContent:"center",background:active?"rgba(239,68,68,0.15)":"rgba(255,255,255,0.05)",border:`1px solid ${active?"rgba(239,68,68,0.4)":"rgba(255,255,255,0.1)"}`,borderRadius:9,color:"#fff",fontSize:16,cursor:"pointer"}
    : {flex:"1 1 0",minWidth:0,aspectRatio:"2/1",boxSizing:"border-box",display:"flex",alignItems:"center",justifyContent:"center",background:active?"rgba(239,68,68,0.15)":"rgba(255,255,255,0.05)",border:`1px solid ${active?"rgba(239,68,68,0.4)":"rgba(255,255,255,0.1)"}`,borderRadius:10,color:"#fff",fontSize:26,cursor:"pointer"};
  const addFlugBtnStyle = isLandscapePhone
    ? {height:34,boxSizing:"border-box",background:"rgba(255,255,255,0.05)",color:"#e8f4fd",border:"1px solid rgba(255,255,255,0.1)",borderRadius:9,padding:"0 10px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}
    : {background:"rgba(34,197,94,0.15)",color:"#4ade80",border:"1px solid rgba(34,197,94,0.25)",borderRadius:20,padding:"7px 10px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"};

  return (
    <div style={{maxWidth:isWide?1400:(isLandscapePhone?"100%":480),margin:"0 auto",minHeight:"100vh",background:"#040e20",color:"#e8f4fd",fontFamily:"system-ui,sans-serif"}}>
      <input ref={fileRef} type="file" accept=".igc" multiple style={{display:"none"}} onChange={e=>importIGCFiles(Array.from(e.target.files))} />

      {/* Header */}
      <div style={{position:"sticky",top:0,zIndex:10,background:"#040e20"}}>
      <div style={{background:"rgba(255,255,255,0.03)",borderBottom:"1px solid rgba(255,255,255,0.06)",padding:`calc(${isLandscapePhone?14:28}px + env(safe-area-inset-top, 0px)) 16px 12px`,display:"flex",alignItems:"center",gap:8,backdropFilter:"blur(10px)"}}>
        <button onClick={()=>{window.location.href="index.html";}} title="Zur Startseite"
          style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:"rgba(232,244,253,0.8)",cursor:"pointer",flexShrink:0,lineHeight:1}}>
          ‹
        </button>
        <span style={isLandscapePhone
          ? {fontWeight:900,fontSize:16,letterSpacing:-0.5,flexShrink:0,whiteSpace:"nowrap"}
          : {fontWeight:900,fontSize:18,letterSpacing:-0.5,flex:1,textAlign:"center",marginLeft:-8}}>
          ✈️ Flugbuch
        </span>
        {isLandscapePhone && (
          <div style={{display:"flex",gap:6,alignItems:"center",flex:1,justifyContent:"center",overflow:"hidden"}}>
            {headerIconButtons.map(b => (
              <button key={b.key} onClick={b.onClick} title={b.title} style={headerTileStyle(b.active, true)}>{b.icon}</button>
            ))}
          </div>
        )}
        <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
          <button onClick={addNewFlight} style={addFlugBtnStyle}>+ Flug</button>
          <button onClick={()=>window.location.href="hilfe.html"} title="Hilfe"
            style={{width:32,height:32,borderRadius:"50%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",color:"#ef4444",fontSize:15,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
            ?
          </button>
        </div>
      </div>

      {!isLandscapePhone && (
        <div style={{padding:"10px 16px 0",display:"flex",gap:8}}>
          {headerIconButtons.map(b => (
            <button key={b.key} onClick={b.onClick} title={b.title} style={headerTileStyle(b.active, false)}>{b.icon}</button>
          ))}
        </div>
      )}

      {showViewsMenu && (
        <div style={{margin:"8px 16px 0",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:10,maxHeight:340,overflowY:"auto"}}>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>{ setSavingViewName(s=>s===null?"":null); setViewsMode("none"); }}
              title="Speichern als…"
              style={{flex:1,padding:"9px 0",borderRadius:8,fontSize:16,cursor:"pointer",background:savingViewName!==null?"rgba(74,222,128,0.15)":"rgba(255,255,255,0.05)",border:`1px solid ${savingViewName!==null?"rgba(74,222,128,0.4)":"rgba(255,255,255,0.1)"}`}}>
              💾
            </button>
            <button onClick={()=>{ setViewsMode(m=>m==="move"?"none":"move"); setSavingViewName(null); }}
              title="Verschieben"
              style={{flex:1,padding:"9px 0",borderRadius:8,fontSize:16,cursor:"pointer",background:viewsMode==="move"?"rgba(14,165,233,0.15)":"rgba(255,255,255,0.05)",border:`1px solid ${viewsMode==="move"?"rgba(14,165,233,0.4)":"rgba(255,255,255,0.1)"}`}}>
              🔀
            </button>
            <button onClick={()=>{ setViewsMode(m=>m==="delete"?"none":"delete"); setSavingViewName(null); }}
              title="Löschen"
              style={{flex:1,padding:"9px 0",borderRadius:8,fontSize:16,cursor:"pointer",background:viewsMode==="delete"?"rgba(239,68,68,0.15)":"rgba(255,255,255,0.05)",border:`1px solid ${viewsMode==="delete"?"rgba(239,68,68,0.4)":"rgba(255,255,255,0.1)"}`}}>
              🗑
            </button>
          </div>
          {savingViewName !== null && (
            <div style={{display:"flex",gap:6,padding:"8px 0 2px"}}>
              <input autoFocus value={savingViewName} onChange={e=>setSavingViewName(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter") saveCurrentAsView(savingViewName); if(e.key==="Escape") setSavingViewName(null); }}
                placeholder="Name der Darstellung…"
                style={{flex:1,minWidth:0,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,padding:"7px 10px",color:"#e8f4fd",fontSize:13}} />
              <button onClick={()=>saveCurrentAsView(savingViewName)}
                style={{flexShrink:0,background:"rgba(74,222,128,0.2)",border:"1px solid rgba(74,222,128,0.4)",borderRadius:8,padding:"0 12px",color:"#4ade80",fontWeight:700,cursor:"pointer"}}>✓</button>
            </div>
          )}
          {savedViews.length > 0 && <div style={{borderTop:"1px solid rgba(255,255,255,0.08)",margin:"6px 0 4px"}} />}
          {savedViews.length === 0 && (
            <div style={{padding:"10px 12px",fontSize:12,color:"rgba(232,244,253,0.35)",fontStyle:"italic"}}>Noch keine gespeicherten Darstellungen</div>
          )}
          {savedViews.map((v, idx) => (
            <div key={v.id}
              onClick={()=>{ if (viewsMode==="none") applyView(v); }}
              style={{display:"flex",alignItems:"center",gap:6,padding:"9px 12px",borderRadius:8,fontSize:13,cursor:viewsMode==="none"?"pointer":"default",color:"rgba(232,244,253,0.85)"}}>
              <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v.name}</span>
              {viewsMode==="move" && (
                <>
                  <button disabled={idx===0} onClick={e=>{ e.stopPropagation(); setSavedViews(prev=>{ const n=[...prev]; [n[idx-1],n[idx]]=[n[idx],n[idx-1]]; return n; }); }}
                    style={{opacity:idx===0?0.3:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:6,width:26,height:26,color:"#e8f4fd",cursor:idx===0?"default":"pointer"}}>↑</button>
                  <button disabled={idx===savedViews.length-1} onClick={e=>{ e.stopPropagation(); setSavedViews(prev=>{ const n=[...prev]; [n[idx+1],n[idx]]=[n[idx],n[idx+1]]; return n; }); }}
                    style={{opacity:idx===savedViews.length-1?0.3:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:6,width:26,height:26,color:"#e8f4fd",cursor:idx===savedViews.length-1?"default":"pointer"}}>↓</button>
                </>
              )}
              {viewsMode==="delete" && (
                <button onClick={e=>{ e.stopPropagation(); setSavedViews(prev=>prev.filter(x=>x.id!==v.id)); }}
                  style={{background:"rgba(239,68,68,0.2)",border:"1px solid rgba(239,68,68,0.4)",borderRadius:6,width:26,height:26,color:"#f87171",cursor:"pointer"}}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Import menu: IGC */}
      {showImportMenu && (
        <div style={{margin:"8px 16px 0",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:10,display:"flex",gap:8}}>
          <div onDragOver={e=>{e.preventDefault();setDragOver(true)}} onDragLeave={()=>setDragOver(false)}
            onDrop={e=>{e.preventDefault();setDragOver(false);importIGCFiles(Array.from(e.dataTransfer.files));}}
            onClick={()=>{
              if (igcDirFsapiSupported) { igcDirHandle ? runIgcDirImport() : chooseIgcDir(); }
              else fileRef.current?.click();
            }}
            title={igcDirFsapiSupported
              ? (igcDirHandle ? `Ordner „${igcDirName}" nach neuen IGC-Dateien durchsuchen (rekursiv, bereits bekannte werden übersprungen) — oder einzelne .igc-Dateien direkt hierher ziehen` : "IGC-Ordner einmalig auswählen (z.B. dein Vario-Laufwerk D:\\) — durchsucht künftig alle Unterordner automatisch. Oder einzelne .igc-Dateien direkt hierher ziehen.")
              : "IGC-Dateien auswählen oder hierher ziehen"}
            style={{flex:1,border:`2px dashed ${dragOver?"#fcd34d":"rgba(245,158,11,0.25)"}`,borderRadius:10,padding:"10px 8px",textAlign:"center",background:dragOver?"rgba(245,158,11,0.08)":"transparent",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,position:"relative"}}>
            {igcDirFsapiSupported && (
              <button
                onClick={e=>{e.stopPropagation();fileRef.current?.click();}}
                title="Einzelne(s) IGC-Datei(en) direkt über die Dateiauswahl wählen (statt Ordner-Scan)"
                style={{position:"absolute",top:3,right:3,width:20,height:20,padding:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(245,158,11,0.15)",border:"1px solid rgba(245,158,11,0.3)",borderRadius:6,color:"#fcd34d",fontSize:10,cursor:"pointer"}}>
                📄
              </button>
            )}
            <div style={{fontSize:15}}>📂</div>
            <div style={{color:dragOver?"#fcd34d":"rgba(252,211,77,0.5)",fontSize:10}}>
              {importProgress ? `⏳ ${importProgress.done}/${importProgress.total}` : importing ? "⏳ Importiere…" : igcDirScanning ? "⏳ Suche…" : "IGC"}
            </div>
          </div>
        </div>
      )}

      {/* Einmalige Nachrechnen-Funktion für bereits importierte Flüge (siehe
          recomputeTrackStats) — Max Speed, Max.Steigen, Max.Steigen 20s und
          Max.Sinken werden IMMER neu aus dem bereits gespeicherten Track
          berechnet (auch zur Korrektur bereits gespeicherter Fehlwerte),
          kein erneuter IGC-Import nötig. Normalisiert ausserdem die Dauer-
          Anzeige ("Xh MMm") über ALLE Flüge, nicht nur getrackte. */}
      {showImportMenu && (
        <div style={{margin:"6px 16px 0"}}>
          <button onClick={recomputeTrackStats} disabled={recomputeResult?.running}
            title="Für alle Flüge mit GPS-Track: Max Speed, Max.Steigen, Max.Steigen 20s und Max.Sinken direkt aus dem gespeicherten Track neu berechnen — korrigiert auch bereits gespeicherte Werte (z.B. aus einer älteren, ungenaueren Version des Algorithmus). Vereinheitlicht ausserdem bei allen Flügen die Dauer-Anzeige auf 'Xh MMm'."
            style={{width:"100%",background:"rgba(125,211,252,0.08)",border:"1px solid rgba(125,211,252,0.2)",borderRadius:8,padding:"7px 10px",color:"#7dd3fc",fontSize:11,fontWeight:600,cursor:recomputeResult?.running?"default":"pointer"}}>
            {recomputeResult?.running ? "⏳ Berechne…" : "🔁 Max Speed/Steigen/Sinken/Dauer für bestehende Flüge nachrechnen"}
          </button>
        </div>
      )}

      {recomputeResult && !recomputeResult.running && (
        <div style={{margin:"8px 16px 0",background:"rgba(125,211,252,0.08)",border:"1px solid rgba(125,211,252,0.25)",borderRadius:10,padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
          <span style={{fontSize:12,color:"#7dd3fc"}}>
            {recomputeResult.speed || recomputeResult.steigen || recomputeResult.steigen20 || recomputeResult.sinken || recomputeResult.dauer
              ? `✅ ${recomputeResult.scanned} Flüge geprüft (${recomputeResult.scannedTrack} mit Track) — neu berechnet: ${recomputeResult.speed}× Max Speed, ${recomputeResult.steigen}× Max.Steigen, ${recomputeResult.steigen20}× Max.Steigen 20s, ${recomputeResult.sinken}× Max.Sinken, ${recomputeResult.dauer}× Dauer-Format.`
              : `✅ ${recomputeResult.scanned} Flüge geprüft — überall bereits aktuell, nichts zu ändern.`}
          </span>
          <button onClick={()=>setRecomputeResult(null)} style={{background:"none",border:"none",color:"rgba(125,211,252,0.6)",cursor:"pointer",fontSize:16,flexShrink:0}}>✕</button>
        </div>
      )}

      {igcDirResult && (
        <div style={{margin:"8px 16px 0",background:igcDirResult.error?"rgba(239,68,68,0.08)":"rgba(167,139,250,0.1)",border:`1px solid ${igcDirResult.error?"rgba(239,68,68,0.3)":"rgba(167,139,250,0.3)"}`,borderRadius:10,padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:12,color:igcDirResult.error?"#f87171":"#a78bfa"}}>
            {igcDirResult.error ? "❌ "+igcDirResult.error : `✅ ${igcDirResult.total} IGC-Dateien im Ordner · ${igcDirResult.neu} davon neu`}
          </span>
          <button onClick={()=>setIgcDirResult(null)} style={{background:"none",border:"none",color:"rgba(167,139,250,0.5)",cursor:"pointer",fontSize:16}}>✕</button>
        </div>
      )}
      {igcDirHandle && showImportMenu && (
        <div style={{margin:"4px 16px 0",fontSize:11,color:"rgba(232,244,253,0.4)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>📁 IGC-Ordner: {igcDirName}</span>
          <button onClick={clearIgcDir} style={{background:"none",border:"none",color:"rgba(248,113,113,0.6)",fontSize:11,cursor:"pointer"}}>ändern</button>
        </div>
      )}

      {showCsvColumnConfig && (
        <CsvColumnConfigModal columns={csvColumns} onSave={saveCsvColumns} onClose={()=>setShowCsvColumnConfig(false)} />
      )}

      {pendingDateDups && (
        <DateDupWarningDialog items={pendingDateDups}
          onImportAnyway={()=>resolveDateDups(true)}
          onSkip={()=>resolveDateDups(false)} />
      )}

      {pendingNewSchirme && (
        <NewSchirmDialog items={pendingNewSchirme} onConfirm={confirmNewSchirme} onCancel={cancelNewSchirme} />
      )}

      {pendingDateAmbiguous.length > 0 && (
        <DateAmbiguousResolver
          item={pendingDateAmbiguous[0]}
          onClose={()=>setPendingDateAmbiguous(q=>q.slice(1))}
          onAssign={async (chosen) => {
            const item = pendingDateAmbiguous[0];
            await attachIgcToFlight(chosen, item.track, item.date, item.pilot, item.glider, item.igcData, item.baseName);
            // Remove the just-assigned flight from every remaining item's
            // candidate list — otherwise a second IGC file for the same
            // date could still be assigned to the same flight, silently
            // overwriting what was just attached.
            setPendingDateAmbiguous(q => q.slice(1).map(it => ({
              ...it, candidates: it.candidates.filter(c => c.id !== chosen.id),
            })));
          }}
          onCreateNew={async () => {
            const item = pendingDateAmbiguous[0];
            const baseName = item.baseName || item.file.name.replace(/\.igc$/i,"");
            const dateParts = item.date.split(".");
            let yr="", mo="";
            if (dateParts.length===3) { yr=dateParts[2]; mo=dateParts[1]; }
            const maxNr = flights.reduce((m, f) => {
              const n = /^\d+$/.test(f.name||"") ? parseInt(f.name, 10) : 0;
              return n > m ? n : m;
            }, 0);
            const backfill = computeDistanceSpeedBackfill(0, {}, item.igcData.scoreDistanceKm, item.igcData.durationSec);
            const inferred = await inferPlaceAndCountry(item.igcData.startPt, item.igcData.endPt, flights, placeMatchRadiusKm, mapTilerKey);
            const { name: cleanedGlider, schirmId } = await resolveSchirmForGlider(item.glider);
            const newF = { id:`igc_${baseName}_${Date.now()}`, name:String(maxNr+1), pdfOnly:false,
              date:item.date, rawDate:item.date, year:yr, month:mo, pilot:item.pilot||"",site:inferred.site||"",glider:cleanedGlider||"",
              startTime:"", endTime:"", comment:"", rating:0, notes:"", track:item.track,
              customFields:{landung:inferred.landung||"",land:inferred.land||"",igcFilename:baseName,schirmId:schirmId||"",
                // Siehe processIGCFiles weiter oben — Typ direkt beim Import
                // setzen statt erst beim ersten Öffnen der Detailansicht.
                typ: "GS", typAuto: true,
                hGew: item.igcData.totalGain ? String(item.igcData.totalGain) : "",
                hDiff: item.igcData.hDiff ? String(item.igcData.hDiff) : "",
                maxSteigen: item.igcData.maxClimb ? String(item.igcData.maxClimb) : "",
                maxSteigen20: item.igcData.maxClimb20 ? String(item.igcData.maxClimb20) : "",
                maxSinken: item.igcData.maxSinkRate ? String(item.igcData.maxSinkRate) : "",
                distKm: backfill.distKm || "", kmh: backfill.kmh || ""},
              ...item.igcData, startPt:item.igcData.startPt, endPt:item.igcData.endPt,
              totalDist: backfill.totalDist || 0 };
            await saveFlight(newF);
            setFlights(prev=>[newF,...prev]);
            setPendingDateAmbiguous(q=>q.slice(1));
          }}
        />
      )}

      {selectMode && (
        <div style={{padding:"8px 16px 0",display:"flex",gap:8}}>
          <button onClick={async()=>{
              if (!selectedIds.size) { setCopyMsg("Keine Flüge ausgewählt."); return; }
              const chosen = flights.filter(f=>selectedIds.has(f.id));
              const activeKeys = csvColumns.filter(c=>c.enabled).map(c=>c.key);
              const rowFor = f => buildCsvRow(f, activeKeys);
              const rows = chosen.map(rowFor).join("\r\n");
              try {
                // Numbers (and most spreadsheet apps) only recognise pasted text as a
                // table when it comes with an HTML <table> clipboard representation —
                // plain tab-separated text alone often gets pasted as one blob per cell.
                const escapeHtml = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
                const cellStyle = "font-family:Helvetica,sans-serif;font-size:10px;font-weight:normal;text-align:left;";
                const htmlTable = `<table style="${cellStyle}">` + chosen.map(f => {
                  const cols = rowFor(f).split("\t");
                  return "<tr>" + cols.map((c,i) => i===0
                    ? `<th style="${cellStyle}">${escapeHtml(c)}</th>`
                    : `<td style="${cellStyle}">${escapeHtml(c)}</td>`
                  ).join("") + "</tr>";
                }).join("") + "</table>";

                if (navigator.clipboard && window.ClipboardItem) {
                  const item = new ClipboardItem({
                    "text/plain": new Blob([rows], {type:"text/plain"}),
                    "text/html": new Blob([htmlTable], {type:"text/html"}),
                  });
                  await navigator.clipboard.write([item]);
                } else {
                  await navigator.clipboard.writeText(rows);
                }
                setCopyMsg(`✓ ${chosen.length} Flug${chosen.length!==1?"e":""} kopiert.`);
              } catch (e) {
                setCopyMsg("Fehler: " + e.message);
              }
            }}
            title="Auswahl kopieren"
            style={{flex:"1 1 0",minWidth:0,boxSizing:"border-box",background:"rgba(34,197,94,0.15)",border:"1px solid rgba(34,197,94,0.3)",borderRadius:10,padding:"9px 4px",color:"#4ade80",fontSize:13,fontWeight:700,cursor:"pointer",textAlign:"center"}}>
            📋 {selectedIds.size}
          </button>
          <button onClick={()=>setShowCsvColumnConfig(true)} title="Spalten für Kopieren einrichten"
            style={{flexShrink:0,width:40,boxSizing:"border-box",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"9px 4px",color:"rgba(232,244,253,0.7)",fontSize:15,cursor:"pointer",textAlign:"center"}}>
            ⚙️
          </button>
          <button onClick={()=>{
              if (!selectedIds.size) { setCopyMsg("Keine Flüge ausgewählt."); return; }
              setBulkEditOpen(true);
            }}
            title="Auswahl bearbeiten"
            style={{flex:"1 1 0",minWidth:0,boxSizing:"border-box",background:"rgba(14,165,233,0.15)",border:"1px solid rgba(14,165,233,0.3)",borderRadius:10,padding:"9px 4px",color:"#7dd3fc",fontSize:13,fontWeight:700,cursor:"pointer",textAlign:"center"}}>
            ✏️ {selectedIds.size}
          </button>
          <button onClick={()=>{
              if (!selectedIds.size) { setCopyMsg("Keine Flüge ausgewählt."); return; }
              setConfirmBulkDelete(true);
            }}
            title="Auswahl löschen"
            style={{flex:"1 1 0",minWidth:0,boxSizing:"border-box",background:"rgba(239,68,68,0.15)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:10,padding:"9px 4px",color:"#f87171",fontSize:13,fontWeight:700,cursor:"pointer",textAlign:"center"}}>
            🗑 {selectedIds.size}
          </button>
          <button onClick={()=>setSelectedIds(new Set(filteredFlights.map(f=>f.id)))}
            title="Alle Flüge auswählen"
            style={{flex:"1 1 0",minWidth:0,boxSizing:"border-box",background:"rgba(232,244,253,0.08)",border:"1px solid rgba(232,244,253,0.15)",borderRadius:10,padding:"9px 4px",color:"#e8f4fd",fontSize:13,fontWeight:700,cursor:"pointer",textAlign:"center"}}>
            Alle
          </button>
        </div>
      )}
      {confirmBulkDelete && (
        <div onClick={()=>setConfirmBulkDelete(false)}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:24}}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:"#14253a",borderRadius:16,padding:"20px 22px",maxWidth:320,width:"100%",border:"1px solid rgba(255,255,255,0.1)"}}>
            <div style={{fontSize:16,fontWeight:700,marginBottom:6}}>{selectedIds.size} Flüge — was löschen?</div>
            <div style={{fontSize:13,color:"rgba(232,244,253,0.6)",marginBottom:18}}>Diese Aktion kann nicht rückgängig gemacht werden.</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <button onClick={async()=>{
                  const ids = [...selectedIds];
                  for (const id of ids) {
                    try { await window.storage.delete(`flight:${id}`); } catch {}
                  }
                  setFlights(prev=>prev.filter(f=>!selectedIds.has(f.id)));
                  setCopyMsg(`✓ ${ids.length} Flug${ids.length!==1?"e":""} gelöscht.`);
                  setSelectedIds(new Set());
                  setConfirmBulkDelete(false);
                  setSelectMode(false);
                }}
                style={{background:"rgba(239,68,68,0.2)",border:"1px solid rgba(239,68,68,0.4)",borderRadius:10,padding:"10px",color:"#f87171",fontSize:14,fontWeight:700,cursor:"pointer"}}>🗑 Ganze Flüge löschen</button>
              <button onClick={async()=>{
                  const ids = [...selectedIds];
                  let cleared = 0;
                  for (const id of ids) {
                    const f = flights.find(fl=>fl.id===id);
                    if (f && f.track?.length>1) {
                      const upd = { ...f, track: [] };
                      try { await saveFlight(upd); cleared++; } catch {}
                      setFlights(prev=>prev.map(fl=>fl.id===id?upd:fl));
                    }
                  }
                  setCopyMsg(`✓ ${cleared} IGC-Track${cleared!==1?"s":""} gelöscht (Start/Landung bleiben).`);
                  setSelectedIds(new Set());
                  setConfirmBulkDelete(false);
                  setSelectMode(false);
                }}
                style={{background:"rgba(245,158,11,0.15)",border:"1px solid rgba(245,158,11,0.3)",borderRadius:10,padding:"10px",color:"#fcd34d",fontSize:14,fontWeight:700,cursor:"pointer"}}>🛰 Nur IGC-Tracks löschen</button>
              <button onClick={()=>setConfirmBulkDelete(false)}
                style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"10px",color:"#e8f4fd",fontSize:14,cursor:"pointer"}}>Abbrechen</button>
            </div>
          </div>
        </div>
      )}
      {bulkEditOpen && (() => {
        const chosenCount = selectedIds.size;
        const applyBulkEdit = async () => {
          const d = bulkEditData;
          let updated = flights.map(f => {
            if (!selectedIds.has(f.id)) return f;
            const patch = {};
            if (d.date) patch.date = d.date;
            if (d.site) patch.site = d.site;
            if (d.glider) patch.glider = d.glider;
            if (d.rating) patch.rating = d.rating;
            if (d.notes) patch.notes = d.notes;
            const cfPatch = {};
            if (d.landung) cfPatch.landung = d.landung;
            if (d.typ) { cfPatch.typ = d.typ; cfPatch.typAuto = false; }
            if (d.reise) cfPatch.reise = d.reise==="__CLEAR__" ? "" : d.reise;
            return { ...f, ...patch, customFields: { ...(f.customFields||{}), ...cfPatch } };
          });
          // A date change can shift where these flights (and everyone
          // else) fall chronologically, so renumber the whole list rather
          // than just the edited flights.
          if (d.date) updated = renumberAllFlights(updated);
          await Promise.all(updated.map((f, i) => {
            const before = flights[i];
            if (selectedIds.has(f.id) || f.name !== before.name) return saveFlight(f).catch(()=>{});
            return null;
          }));
          setFlights(updated);
          setCopyMsg(`✓ ${chosenCount} Flug${chosenCount!==1?"e":""} aktualisiert.`);
          setBulkEditOpen(false);
          setBulkEditData({});
        };
        const field = (label, key, opts) => (
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,color:"rgba(232,244,253,0.4)",marginBottom:4}}>{label}</div>
            <input value={bulkEditData[key]||""} onChange={e=>setBulkEditData(d=>({...d,[key]:e.target.value}))}
              placeholder={opts?.placeholder||"unverändert lassen"}
              style={{width:"100%",background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"10px 13px",color:"#e8f4fd",fontSize:14,boxSizing:"border-box"}} />
          </div>
        );
        return (
          <div onClick={()=>setBulkEditOpen(false)}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:24}}>
            <div onClick={e=>e.stopPropagation()}
              style={{background:"#14253a",borderRadius:16,padding:"20px 22px",maxWidth:380,width:"100%",border:"1px solid rgba(255,255,255,0.1)",maxHeight:"85vh",overflowY:"auto"}}>
              <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>{chosenCount} Flüge bearbeiten</div>
              <div style={{fontSize:12,color:"rgba(232,244,253,0.5)",marginBottom:16}}>Leer gelassene Felder bleiben unverändert. Ausgefüllte Felder werden auf alle {chosenCount} ausgewählten Flüge übertragen.</div>
              {field("Datum (z.B. 24.06.2026)", "date")}
              {field("Startplatz", "site")}
              {field("Landeplatz", "landung")}
              {field("Schirm", "glider")}
              {field("Typ", "typ")}
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,color:"rgba(232,244,253,0.4)",marginBottom:4}}>Reise</div>
                <select value={bulkEditData.reise||""} onChange={e=>setBulkEditData(d=>({...d,reise:e.target.value}))}
                  style={{width:"100%",background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"10px 13px",color:"#e8f4fd",fontSize:14,boxSizing:"border-box",appearance:"none",WebkitAppearance:"none"}}>
                  <option value="" style={{background:"#14253a"}}>unverändert lassen</option>
                  <option value="__CLEAR__" style={{background:"#14253a"}}>Leer (keine Reise)</option>
                  {reisenNames.map(n => <option key={n} value={n} style={{background:"#14253a"}}>{n}</option>)}
                </select>
              </div>
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,color:"rgba(232,244,253,0.4)",marginBottom:6}}>Bewertung</div>
                <div style={{display:"flex",gap:6}}>
                  {[1,2,3,4,5].map(s=>(
                    <button key={s} onClick={()=>setBulkEditData(d=>({...d,rating:(d.rating||0)===s?0:s}))}
                      style={{fontSize:22,background:"none",border:"none",cursor:"pointer",color:s<=(bulkEditData.rating||0)?"#f59e0b":"rgba(232,244,253,0.2)"}}>★</button>
                  ))}
                  {bulkEditData.rating>0 && <span style={{fontSize:11,color:"rgba(232,244,253,0.4)",alignSelf:"center",marginLeft:6}}>wird auf alle übertragen</span>}
                </div>
              </div>
              <div style={{marginBottom:18}}>
                <div style={{fontSize:11,color:"rgba(232,244,253,0.4)",marginBottom:4}}>Notizen</div>
                <textarea value={bulkEditData.notes||""} onChange={e=>setBulkEditData(d=>({...d,notes:e.target.value}))} rows={2}
                  placeholder="unverändert lassen"
                  style={{width:"100%",background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"10px 13px",color:"#e8f4fd",fontSize:13,resize:"vertical",boxSizing:"border-box"}} />
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>{setBulkEditOpen(false);setBulkEditData({});}}
                  style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"10px",color:"#e8f4fd",fontSize:14,cursor:"pointer"}}>Abbrechen</button>
                <button onClick={()=>{ if (bulkEditData.date) setConfirmBulkDateRenumber(true); else applyBulkEdit(); }}
                  style={{flex:1,background:"linear-gradient(135deg,#0ea5e9,#0284c7)",color:"#fff",border:"none",borderRadius:10,padding:10,fontSize:14,fontWeight:800,cursor:"pointer"}}>Speichern</button>
              </div>
            </div>
            {confirmBulkDateRenumber && (
              <div onClick={()=>setConfirmBulkDateRenumber(false)}
                style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:210,padding:24}}>
                <div onClick={e=>e.stopPropagation()}
                  style={{background:"#14253a",borderRadius:16,padding:"20px 22px",maxWidth:320,width:"100%",border:"1px solid rgba(255,255,255,0.1)"}}>
                  <div style={{fontSize:16,fontWeight:700,marginBottom:6}}>⚠️ Datum ändern?</div>
                  <div style={{fontSize:13,color:"rgba(232,244,253,0.6)",marginBottom:18}}>
                    Das neue Datum verschiebt die {chosenCount} ausgewählten Flüge evtl. an eine andere Stelle in der Chronologie — dabei werden <b>alle</b> Flugnummern neu, lückenlos durchnummeriert. Fortfahren?
                  </div>
                  <div style={{display:"flex",gap:10}}>
                    <button onClick={()=>setConfirmBulkDateRenumber(false)}
                      style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"10px",color:"#e8f4fd",fontSize:14,cursor:"pointer"}}>Abbrechen</button>
                    <button onClick={()=>{ setConfirmBulkDateRenumber(false); applyBulkEdit(); }}
                      style={{flex:1,background:"rgba(245,158,11,0.2)",border:"1px solid rgba(245,158,11,0.4)",borderRadius:10,padding:"10px",color:"#fcd34d",fontSize:14,fontWeight:700,cursor:"pointer"}}>Ändern</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}
      {copyMsg && (
        <div style={{padding:"6px 16px 0",fontSize:11,color:copyMsg.startsWith("✓")?"#4ade80":"#f87171"}}>
          {copyMsg}
        </div>
      )}

      {/* Blocking import-progress overlay — stays visible until all flights are
          written to storage, so the person can't accidentally navigate away
          (and lose unsaved data) while a large CSV import is still running. */}
      {importProgress && (
        <div style={{position:"fixed",inset:0,background:"rgba(10,22,40,0.92)",zIndex:300,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14}}>
          <div style={{fontSize:36}}>⏳</div>
          <div style={{fontSize:15,fontWeight:700,color:"#e8f4fd"}}>Speichere Flüge…</div>
          <div style={{fontSize:13,color:"rgba(232,244,253,0.6)"}}>{importProgress.done} / {importProgress.total}</div>
          <div style={{width:200,height:6,background:"rgba(255,255,255,0.1)",borderRadius:10,overflow:"hidden"}}>
            <div style={{width:`${importProgress.total?Math.round(importProgress.done/importProgress.total*100):0}%`,height:"100%",background:"#7dd3fc",transition:"width 0.2s"}} />
          </div>
          <div style={{fontSize:11,color:"rgba(232,244,253,0.4)",marginTop:6}}>Bitte Seite nicht schliessen oder neu laden</div>
        </div>
      )}
      {igcResult && (
        <div style={{margin:"10px 16px 0",background:"rgba(74,222,128,0.1)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:12,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:13,color:"#4ade80"}}>
            ✅ {(igcResult.created>0?igcResult.created+" neu  ":"")}{(igcResult.updated>0?igcResult.updated+" aktualisiert":"")}{(igcResult.deferred>0?"  "+igcResult.deferred+" zur Zuordnung":"")} ({igcResult.total} erkannt)
          </span>
          <button onClick={()=>setIgcResult(null)} style={{background:"none",border:"none",color:"rgba(74,222,128,0.5)",cursor:"pointer",fontSize:16}}>✕</button>
        </div>
      )}

      {/* Dup warning */}
      {dupWarning&&(
        <div style={{margin:"10px 16px 0",background:"rgba(245,158,11,0.1)",border:"1px solid rgba(245,158,11,0.3)",borderRadius:12,padding:"12px 14px"}}>
          <div style={{fontSize:13,color:"#fcd34d",marginBottom:8}}>⚠️ Bereits vorhanden: {dupWarning}</div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={async()=>{setDupWarning(null);await processIGCFiles([...pendingDups.confirmed,...pendingDups.ask]);}}
              style={{flex:1,background:"rgba(245,158,11,0.2)",border:"1px solid rgba(245,158,11,0.4)",borderRadius:10,padding:"8px",color:"#fcd34d",fontSize:12,cursor:"pointer"}}>Überschreiben</button>
            <button onClick={async()=>{setDupWarning(null);if(pendingDups.confirmed.length)await processIGCFiles(pendingDups.confirmed);}}
              style={{flex:1,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"8px",color:"rgba(232,244,253,0.6)",fontSize:12,cursor:"pointer"}}>Überspringen</button>
          </div>
        </div>
      )}

      {/* Suchen/Sortieren-Panel — ein-/ausblendbar über die 🔍-Kachel oben.
          Suchen / Sortieren (⇅, alle Datenfelder) / Reihenfolge (↑).
          Gruppierung gibt es hier bewusst nicht mehr — die lebt in der
          separaten Übersicht. */}
      {searchRowOpen && (
        <div style={{padding:"12px 16px 6px",position:"relative"}}>
          <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
            <div style={{flex:"1 1 0",minWidth:0,position:"relative"}}>
              <SearchBar filterText={filterText} setFilterText={setFilterText} knownGliders={[...new Set(flights.map(f=>f.glider).filter(Boolean))].sort()} />
            </div>
            <button onClick={()=>setShowSortMenu(s=>!s)}
              style={{flex:"1 1 0",minWidth:0,boxSizing:"border-box",display:"flex",justifyContent:"space-between",alignItems:"center",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"8px 8px",color:"#fff",fontSize:12,cursor:"pointer"}}>
              <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>⇅ {SORT_OPTIONS.find(o=>o.id===sortId)?.label||"—"}</span>
              <span style={{flexShrink:0,marginLeft:4}}>{showSortMenu?"▾":"▸"}</span>
            </button>
            <button onClick={()=>setSortDir(d=>d==="asc"?"desc":"asc")}
              title={sortDir==="asc" ? "Aufsteigend" : "Absteigend"}
              style={{flexShrink:0,width:34,height:34,boxSizing:"border-box",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer"}}>
              {sortDir==="asc"?"↑":"↓"}
            </button>
          </div>

        {showFilterHelp && (
          <div style={{marginTop:8,background:"rgba(125,211,252,0.07)",border:"1px solid rgba(125,211,252,0.2)",borderRadius:10,padding:"10px 12px",fontSize:11,lineHeight:1.6,color:"rgba(232,244,253,0.7)"}}>
            <div style={{fontWeight:700,color:"#7dd3fc",marginBottom:4}}>Filter-Syntax</div>
            <div><b>UND</b> / <b>ODER</b> — z.B. <code>Fiesch ODER Rigi</code></div>
            <div><b>+wort</b> muss / <b>-wort</b> darf nicht — z.B. <code>2026 -tandem</code></div>
            <div><b>feld:wert</b> — <code>site:Fiesch</code>, <code>schirm:Wisp</code>, <code>pilot:…</code></div>
            <div><b>feld&gt;wert</b> / <b>&lt;</b> / <b>&gt;=</b> — <code>dauer&gt;2</code> (h), <code>dist&gt;30</code> (km), <code>höhe&gt;3000</code> (m), <code>rating&gt;=4</code>, <code>jahr&gt;2020</code></div>
            <div style={{marginTop:4,opacity:0.7}}>Kombinierbar: <code>site:Fiesch UND dauer&gt;2 -tandem</code></div>
          </div>
        )}
        {showSortMenu && (
          <div style={{marginTop:6,background:"#14253a",border:"1px solid rgba(255,255,255,0.12)",borderRadius:12,padding:6,maxHeight:280,overflowY:"auto",boxShadow:"0 8px 24px rgba(0,0,0,0.4)"}}>
            {SORT_OPTIONS.map(o=>(
              <div key={o.id} onClick={()=>{setSortId(o.id);setShowSortMenu(false);}}
                style={{padding:"9px 12px",borderRadius:8,fontSize:13,cursor:"pointer",color:o.id===sortId?"#7dd3fc":"rgba(232,244,253,0.75)",background:o.id===sortId?"rgba(14,165,233,0.15)":"transparent"}}>
                {o.label}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Multi row import */}
      <div style={{margin:"0 16px 10px"}}>
        {showRowImport && (
          <div style={{marginTop:6,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:10}}>
            <textarea value={rowImportText} onChange={e=>setRowImportText(e.target.value)}
              placeholder="Eine oder mehrere Zeilen aus Numbers/Excel/CSV hier einfügen (eine Zeile pro Flug, gleiche Spalten wie Flugbuch-CSV)…"
              style={{width:"100%",minHeight:90,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:8,color:"#e8f4fd",fontSize:11,fontFamily:"monospace",boxSizing:"border-box",resize:"vertical"}} />
            {rowImportText.trim() && (()=>{
              const rows = parseMultipleRows(rowImportText);
              if (!rows.length) return null;
              const okCount = rows.filter(r=>r.p && r.p._colCount>=40).length;
              const badCount = rows.length - okCount;
              return (
                <div style={{marginTop:6,fontSize:10,lineHeight:1.6}}>
                  <div style={{color:okCount>0?"rgba(74,222,128,0.8)":"rgba(248,113,113,0.8)"}}>
                    {rows.length} Zeile{rows.length!==1?"n":""} erkannt · {okCount} gültig{badCount>0?` · ${badCount} fehlerhaft`:""}
                  </div>
                  {rows.map((r,i)=>{
                    const ok = r.p && r.p._colCount>=40;
                    return (
                      <div key={i} style={{color:ok?"rgba(232,244,253,0.4)":"rgba(248,113,113,0.7)"}}>
                        Zeile {i+1}: {ok ? `✓ Flug ${r.p._nr||"(auto)"} — ${r.p.st||"—"}` : `✗ ${r.error || (r.p ? r.p._colCount+" Spalten (erwartet ≥40)" : "Fehler")}`}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            {rowImportError && <div style={{color:"#f87171",fontSize:11,marginTop:6}}>{rowImportError}</div>}
            <button onClick={()=>{
                if(!rowImportText.trim()){ setRowImportError("Bitte mindestens eine Zeile einfügen."); return; }
                const rows = parseMultipleRows(rowImportText);
                const valid = rows.filter(r=>r.p && r.p._colCount>=40);
                if (!valid.length) {
                  setRowImportError("Keine gültige Zeile gefunden. Bitte die komplette(n) Zeile(n) mit allen Spalten einfügen, inkl. leerer Zellen.");
                  return;
                }
                try {
                  let maxNr = flights.reduce((m,f)=>{
                    const n = parseInt((f.name||"").match(/\d+/)?.[0]||"0",10);
                    return n>m?n:m;
                  }, 0);
                  const newFlights = [];
                  for (const r of valid) {
                    const parsedNr = parseInt((r.p._nr||"").match(/\d+/)?.[0]||"",10);
                    let nr;
                    if (parsedNr) { nr = String(parsedNr); }
                    else { maxNr += 1; nr = String(maxNr); }
                    const nf = createFlightFromPDF(nr, r.p);
                    saveFlight(nf);
                    newFlights.push(nf);
                  }
                  setFlights(prev => {
                    const merged = [...newFlights, ...prev];
                    return merged.sort((a,b)=>
                      (parseInt((b.name||"").match(/\d+/)?.[0]||"0",10)) - (parseInt((a.name||"").match(/\d+/)?.[0]||"0",10)));
                  });
                  setRowImportText(""); setRowImportError(""); setShowRowImport(false);
                  if (newFlights.length === 1) {
                    setSelected(newFlights[0]); setView("detail");
                  }
                } catch(e) { setRowImportError("Fehler beim Verarbeiten: "+e.message); }
              }}
              style={{marginTop:8,width:"100%",background:"rgba(34,197,94,0.15)",border:"1px solid rgba(34,197,94,0.3)",borderRadius:8,padding:"8px",color:"#4ade80",fontSize:13,fontWeight:700,cursor:"pointer"}}>
              + Flüge aus Zeile(n) erstellen
            </button>
          </div>
        )}
      </div>
      </div>

      {filterText.trim() && (
        <div style={{padding:"0 16px 8px",fontSize:12,color:"rgba(232,244,253,0.45)"}}>
          {filteredFlights.length} Treffer
        </div>
      )}

      {/* Flight list — flat, filtered (search bar / advanced search across
          all fields) and sorted. No grouping here anymore — that lives in
          the separate Übersicht area instead. */}
      <div style={{padding:"4px 0 16px"}}>
        {flights.length===0&&(
          <div style={{textAlign:"center",padding:"60px 20px",color:"rgba(232,244,253,0.25)"}}>
            <div style={{fontSize:48,marginBottom:12}}>✈️</div>
            <div style={{fontSize:16,fontWeight:600,marginBottom:6}}>Noch keine Flüge</div>
            <div style={{fontSize:13}}>CSV importieren oder IGC-Dateien ablegen</div>
          </div>
        )}
        {sortFlights(filteredFlights, sortId, sortDir).map(f => (
          <FlightRow key={f.id} f={f} isLongest={f.id===longestId} sortId={sortId}
            selectMode={selectMode} isSelected={selectedIds.has(f.id)}
            onToggleSelect={id=>setSelectedIds(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;})}
            onClick={()=>{setSelected(f);setView("detail");}} />
        ))}
      </div>
      {showFieldEditor&&<FieldEditor customFieldDefs={customFieldDefs} onSave={handleSaveFields} onClose={()=>setShowFieldEditor(false)} />}
    </div>
  );
}
