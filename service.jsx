// ── Service ───────────────────────────────────────────────────────────────
// Eigenständige Seite (wie Statistik/Material) — enthält vorerst die
// Backup/Restore-Funktion, die früher im Flugbuch selbst lag. Bewusst
// vollständig generisch gebaut: statt einzelne Bereiche (Flüge, Material,
// Statistik-Filter, Reisen, …) hart zu verdrahten, sichert sie EINFACH
// JEDEN Schlüssel, der aktuell in der gemeinsamen IndexedDB liegt — neue
// Bereiche, die später dazukommen, werden dadurch automatisch mitgesichert,
// ohne dass dieser Code dafür angepasst werden müsste.

function formatBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(2) + " MB";
}

// Formatiert einen gespeicherten ISO-Zeitstempel wie "29.08.2026, 14:32" für
// die Anzeige bei den Backup-/Restore-Knöpfen.
function formatTimestamp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── CSV/IGC-Export ───────────────────────────────────────────────────────
// Lädt Flüge/Material/Schirme direkt aus derselben IndexedDB, genau wie
// schirme.jsx das für seine eigene Anzeige tut (service.jsx teilt keinen
// Code mit den anderen eigenständigen Seiten, daher hier dupliziert).
async function loadAllFlights() {
  const keys = await window.storage.list("flight:");
  const raw = await Promise.all((keys?.keys || []).map(async k => {
    try { const r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; } catch { return null; }
  }));
  return raw.filter(Boolean);
}
async function loadAllMaterial() {
  const keys = await window.storage.list("entry:");
  const raw = await Promise.all((keys?.keys || []).map(async k => {
    try { const r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; } catch { return null; }
  }));
  return raw.filter(Boolean);
}
async function loadSchirmeList() {
  try {
    const r = await window.storage.get("schirme:list");
    return r ? JSON.parse(r.value) : [];
  } catch { return []; }
}

// Generischer CSV-Baustein: erzeugt aus einer Liste beliebiger Objekte eine
// Datei mit genau einer Spalte pro tatsächlich vorkommendem Feld (Union
// aller Schlüssel, in der Reihenfolge ihres ersten Auftretens) — bewusst
// nichts hart verdrahtet, damit ALLE Datenbankfelder mitkommen, auch
// künftig neu hinzugekommene. Verschachtelte Objekte, die selbst eigene
// "Felder" darstellen (customFields bei Flügen), werden dafür zu eigenen
// Spalten "customFields.xyz" aufgelöst statt als ein JSON-Klumpen in einer
// Zelle zu landen; alles andere Verschachtelte (z.B. track, startPt, endPt)
// wird als JSON-Text in seiner eigenen Spalte abgelegt.
function flattenForCsv(record, flattenKeys) {
  const out = {};
  for (const [k, v] of Object.entries(record)) {
    if (flattenKeys.includes(k) && v && typeof v === "object" && !Array.isArray(v)) {
      for (const [sk, sv] of Object.entries(v)) out[`${k}.${sk}`] = sv;
    } else {
      out[k] = v;
    }
  }
  return out;
}
function csvCell(v) {
  let s;
  if (v === null || v === undefined) s = "";
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function buildCsv(records, flattenKeys = []) {
  const flat = records.map(r => flattenForCsv(r, flattenKeys));
  const keys = [];
  const seen = new Set();
  for (const r of flat) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  const lines = [keys.map(csvCell).join(",")];
  for (const r of flat) lines.push(keys.map(k => csvCell(r[k])).join(","));
  // BOM voran, damit Excel Umlaute (ü, ö, …) korrekt als UTF-8 erkennt.
  return "\uFEFF" + lines.join("\r\n");
}

// Baut denselben rekonstruierten IGC-Text wie der "⬇ IGC"-Knopf im Flugbuch
// selbst (siehe DetailContent in flugbuch.jsx) — die App speichert keine
// rohe IGC-Datei, sondern nur den geparsten Track, und rekonstruiert daraus
// bei Bedarf eine gültige (wenn auch minimale) IGC-Datei. Dieselbe Logik
// hier dupliziert, da service.jsx als eigenständige Seite keinen Code mit
// flugbuch.jsx teilt.
function buildIgcTextFromFlight(fl) {
  const t = fl.track;
  if (!t || t.length < 2) return null;
  const d = fl.rawDate || fl.date || "";
  const parts = d.split(".");
  const dateStr = parts.length === 3 ? parts[0].padStart(2, "0") + parts[1].padStart(2, "0") + parts[2].slice(-2) : "010101";
  const fmtTime = s => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return String(h).padStart(2, "0") + String(m).padStart(2, "0") + String(sec).padStart(2, "0"); };
  const fmtLat = lat => { const a = Math.abs(lat), dg = Math.floor(a), m = (a - dg) * 60000; return String(dg).padStart(2, "0") + String(Math.round(m)).padStart(5, "0") + (lat >= 0 ? "N" : "S"); };
  const fmtLon = lon => { const a = Math.abs(lon), dg = Math.floor(a), m = (a - dg) * 60000; return String(dg).padStart(3, "0") + String(Math.round(m)).padStart(5, "0") + (lon >= 0 ? "E" : "W"); };
  const NL = "\r\n";
  let igc = "AXXX" + NL + "HFDTE" + dateStr + NL;
  igc += "HFPLTPILOTINCHARGE:" + (fl.pilot || "") + NL;
  igc += "HFGTYGLIDERTYPE:" + (fl.glider || "") + NL;
  igc += "HFGIDGLIDERID:" + NL;
  for (const p of t) {
    const ts = fmtTime(p.timeSec || 0);
    const alt = Math.round(p.gpsAlt || 0);
    igc += "B" + ts + fmtLat(p.lat) + fmtLon(p.lon) + "A" + String(alt).padStart(5, "0") + String(alt).padStart(5, "0") + NL;
  }
  const filenameBase = (fl.customFields?.igcFilename || fl.name || fl.id || "flug").toString();
  return { filenameBase, text: igc };
}

function ServiceApp() {
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null); // {type:"ok"|"error", text}
  const [stats, setStats] = React.useState(null); // {flights, material, keys}
  const fileRef = React.useRef(null);

  // API-Zugangsdaten (aktuell: MapTiler) — zentral hier hinterlegt statt
  // fest im Quellcode von flugbuch.jsx, damit ein eigener Schlüssel nicht
  // bei jeder Code-Änderung neu eingetragen werden muss. flugbuch.jsx liest
  // "settings:maptilerApiKey" beim Start und nutzt, falls vorhanden, diesen
  // statt des eingebauten Standard-Schlüssels.
  const [maptilerKey, setMaptilerKey] = React.useState("");
  const [maptilerKeySaved, setMaptilerKeySaved] = React.useState(false);
  React.useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("settings:maptilerApiKey");
        if (r && r.value) { setMaptilerKey(r.value); setMaptilerKeySaved(true); }
      } catch {}
    })();
  }, []);
  const saveMaptilerKey = async () => {
    const trimmed = maptilerKey.trim();
    try {
      if (trimmed) await window.storage.set("settings:maptilerApiKey", trimmed);
      else await window.storage.delete("settings:maptilerApiKey");
      await window.storage.set("settings:backupDirty", "1");
      setMaptilerKeySaved(!!trimmed);
      setMsg({ type: "ok", text: trimmed ? "✓ MapTiler-Schlüssel gespeichert." : "✓ MapTiler-Schlüssel entfernt — Flugbuch nutzt wieder den eingebauten Standard-Schlüssel." });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Speichern: " + (e.message || String(e)) });
    }
  };

  // Radius (km), innerhalb dessen ein neu importierter IGC-Flug einen
  // Start-/Landeplatz-Namen bzw. ein Land von einem bereits vorhandenen
  // Flug mit ähnlichen Koordinaten übernehmen darf. 0.5 km Standard —
  // klein genug, um nicht zwei unterschiedliche, nahe beieinanderliegende
  // Startplätze zu verwechseln, aber gross genug, um GPS-Ungenauigkeiten
  // und leichtes Verschieben des Startpunkts (z.B. anderer Startbereich
  // am selben Hang) abzudecken.
  const [placeRadius, setPlaceRadius] = React.useState("0.5");
  const [placeRadiusSaved, setPlaceRadiusSaved] = React.useState(false);
  React.useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("settings:placeMatchRadiusKm");
        if (r && r.value) { setPlaceRadius(r.value); setPlaceRadiusSaved(true); }
      } catch {}
    })();
  }, []);
  const savePlaceRadius = async () => {
    const num = parseFloat(placeRadius.replace(",", "."));
    if (!isFinite(num) || num <= 0) {
      setMsg({ type: "error", text: "Bitte eine Zahl grösser 0 eingeben (z.B. 0.5)." });
      return;
    }
    try {
      await window.storage.set("settings:placeMatchRadiusKm", String(num));
      await window.storage.set("settings:backupDirty", "1");
      setPlaceRadiusSaved(true);
      setMsg({ type: "ok", text: `✓ Radius gespeichert: ${num} km.` });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Speichern: " + (e.message || String(e)) });
    }
  };

  // Lokaler Backup-Ordner (File System Access API) — nur Chrome/Edge
  // Desktop unterstützen das; auf allen anderen Browsern (Safari, Firefox,
  // jedes Handy) bleibt es beim Teilen/Download-Weg weiter unten.
  const fsapiSupported = typeof window !== "undefined" && !!window.showDirectoryPicker;
  const [dirHandle, setDirHandle] = React.useState(null);
  const [dirName, setDirName] = React.useState(null);
  const [dirPermission, setDirPermission] = React.useState("prompt"); // "granted" | "denied" | "prompt"

  React.useEffect(() => {
    if (!fsapiSupported) return;
    (async () => {
      try {
        const handle = await window.fsapiHandle.get("backupDir");
        if (handle) {
          setDirHandle(handle);
          setDirName(handle.name);
          // Nur prüfen (nicht neu anfragen) — eine echte Anfrage
          // (requestPermission) braucht eine Nutzer-Geste und passiert
          // deshalb erst beim tatsächlichen Backup-Klick weiter unten.
          try {
            const perm = await handle.queryPermission({ mode: "readwrite" });
            setDirPermission(perm);
            if (perm === "granted") refreshFolderBackups(handle);
          } catch { setDirPermission("prompt"); }
        }
      } catch (e) { console.error("Backup-Ordner laden fehlgeschlagen:", e); }
    })();
  }, [fsapiSupported]);

  // Liste der Backup-Dateien direkt im gewählten Ordner — lässt Restore
  // ohne eigenen Dateidialog auskommen, wenn ein Ordner konfiguriert ist.
  const [folderBackups, setFolderBackups] = React.useState([]);
  const [loadingFolderBackups, setLoadingFolderBackups] = React.useState(false);
  const refreshFolderBackups = async (handle) => {
    const h = handle || dirHandle;
    if (!h) { setFolderBackups([]); return; }
    setLoadingFolderBackups(true);
    try {
      const found = [];
      for await (const [name, entry] of h.entries()) {
        if (entry.kind !== "file") continue;
        if (!/^flugbuch-backup-.*\.(json|json\.gz)$/i.test(name)) continue;
        try {
          const file = await entry.getFile();
          found.push({ name, lastModified: file.lastModified, size: file.size, handle: entry });
        } catch {}
      }
      found.sort((a, b) => b.lastModified - a.lastModified);
      setFolderBackups(found);
    } catch (e) {
      console.error("Ordner-Inhalt lesen fehlgeschlagen:", e);
      setFolderBackups([]);
    } finally {
      setLoadingFolderBackups(false);
    }
  };

  const chooseDirectory = async () => {
    if (!fsapiSupported) return;
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      await window.fsapiHandle.set("backupDir", handle);
      setDirHandle(handle);
      setDirName(handle.name);
      setDirPermission("granted");
      setMsg({ type: "ok", text: `✓ Backup-Ordner „${handle.name}" festgelegt. Künftige Backups landen automatisch dort.` });
      refreshFolderBackups(handle);
    } catch (e) {
      if (e && e.name === "AbortError") return; // Auswahl abgebrochen
      setMsg({ type: "error", text: "Ordnerauswahl fehlgeschlagen: " + (e.message || String(e)) });
    }
  };

  const clearDirectory = async () => {
    await window.fsapiHandle.delete("backupDir");
    setDirHandle(null);
    setDirName(null);
    setDirPermission("prompt");
    setFolderBackups([]);
  };

  // Zeitpunkt des letzten erfolgreichen Backups/Restores — dauerhaft
  // gespeichert (wie alles andere hier über window.storage/IndexedDB),
  // damit die Anzeige bei den Knöpfen auch einen App-Neustart übersteht.
  const [lastBackupAt, setLastBackupAt] = React.useState(null);
  const [lastRestoreAt, setLastRestoreAt] = React.useState(null);
  React.useEffect(() => {
    (async () => {
      try {
        const b = await window.storage.get("settings:lastBackupAt");
        if (b && b.value) setLastBackupAt(b.value);
        const r = await window.storage.get("settings:lastRestoreAt");
        if (r && r.value) setLastRestoreAt(r.value);
      } catch {}
    })();
  }, []);

  // Berechtigung für den gewählten Backup-Ordner anfragen (falls nötig) —
  // von exportBackup UND exportCsvIgc genutzt, jeweils ganz am Anfang des
  // Klick-Handlers aufgerufen, noch bevor irgendein await die Nutzer-Geste
  // dieses Klicks verbraucht (sonst würde requestPermission() vom Browser
  // stillschweigend abgelehnt).
  const requestDirWriteHandle = async () => {
    if (!(fsapiSupported && dirHandle)) return null;
    try {
      let perm = await dirHandle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") perm = await dirHandle.requestPermission({ mode: "readwrite" });
      if (perm === "granted") { setDirPermission("granted"); return dirHandle; }
      setDirPermission(perm);
    } catch (e) { console.error("Berechtigung für Backup-Ordner fehlgeschlagen:", e); }
    return null;
  };

  const loadStats = React.useCallback(async () => {
    try {
      const all = await window.storage.list("");
      const keys = all?.keys || [];
      const flights = keys.filter(k => k.startsWith("flight:")).length;
      const material = keys.filter(k => k.startsWith("entry:")).length;
      setStats({ flights, material, keys: keys.length });
    } catch (e) {
      console.error("Stats load error:", e);
    }
  }, []);

  React.useEffect(() => { loadStats(); }, [loadStats]);

  const exportBackup = async () => {
    setBusy(true); setMsg(null);
    // Berechtigung für den gewählten Ordner ganz am Anfang anfragen (falls
    // nötig) — noch bevor irgendein await die Nutzer-Geste dieses Klicks
    // verbraucht, sonst würde requestPermission() vom Browser stillschweigend
    // abgelehnt (dieselbe Ursache wie beim navigator.share()-Problem vorhin).
    let writeHandle = await requestDirWriteHandle();
    try {
      // Wirklich JEDEN Schlüssel sichern — Flüge (flight:*), Material
      // (entry:*), Statistik-Filter (statistikFilters), eigene Felder
      // (customFieldDefs), Reisen (reisen:*), gespeicherte Darstellungen
      // (flugbuchSavedViews), Notizen (settings:notes) und alles, was
      // künftig noch dazukommt — ohne dass diese Liste je gepflegt werden
      // müsste.
      const all = await window.storage.list("");
      const keys = all?.keys || [];
      // Parallel statt sequentiell auslesen: bei tausenden Schlüsseln
      // (Flüge, Material, …) dauert ein Eintrag-für-Eintrag-Auslesen
      // spürbar lange — genug, dass der Browser die kurzzeitige
      // "Nutzer-Berechtigung" für navigator.share() (nur direkt nach dem
      // Antippen des Buttons gültig) wieder verfällt, bevor share()
      // überhaupt aufgerufen wird. Der native Teilen-Dialog erschien
      // deshalb nie, die App fiel lautlos auf den einfachen Download
      // zurück. Parallel dauert dasselbe nur einen Bruchteil der Zeit.
      const results = await Promise.all(keys.map(k => window.storage.get(k).catch(() => null)));
      const entries = {};
      keys.forEach((k, i) => { if (results[i]) entries[k] = results[i].value; });
      const payload = { exportedAt: new Date().toISOString(), entries };
      const json = JSON.stringify(payload);
      const dateStamp = new Date().toISOString().slice(0, 10);

      let blob, filename;
      try {
        if (typeof CompressionStream !== "undefined") {
          const gzStream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
          blob = await new Response(gzStream).blob();
          filename = `flugbuch-backup-${dateStamp}.json.gz`;
        }
      } catch (e) { console.error("Backup: gzip compression failed, falling back to plain JSON:", e); }
      if (!blob) {
        blob = new Blob([json], { type: "application/json" });
        filename = `flugbuch-backup-${dateStamp}.json`;
      }

      const markBackedUp = async () => {
        try { await window.storage.set("settings:backupDirty", "0"); } catch {}
        const iso = new Date().toISOString();
        try { await window.storage.set("settings:lastBackupAt", iso); } catch {}
        setLastBackupAt(iso);
      };

      // Bevorzugter Weg, falls ein Ordner festgelegt und die Berechtigung
      // erteilt ist: komplett automatisch, ganz ohne jeden Dialog — die
      // eigentliche Antwort auf "einmalig festlegen, danach nie wieder
      // nachfragen".
      if (writeHandle) {
        try {
          const fileHandle = await writeHandle.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          await markBackedUp();
          setMsg({ type: "ok", text: `✓ Automatisch gespeichert in „${writeHandle.name}": ${filename} (${keys.length} Einträge, ${formatBytes(blob.size)}).` });
          refreshFolderBackups(writeHandle);
          setBusy(false);
          return;
        } catch (e) {
          console.error("Direktes Schreiben in Backup-Ordner fehlgeschlagen, weiche auf Teilen/Download aus:", e);
          // Kein return — fällt bewusst durch auf den bestehenden Weg unten.
        }
      }

      if (navigator.share && navigator.canShare) {
        try {
          const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file] });
            await markBackedUp();
            setMsg({ type: "ok", text: `✓ Backup geteilt (${keys.length} Einträge, ${formatBytes(blob.size)}).` });
            setBusy(false);
            return;
          }
        } catch (e) {
          if (e && e.name === "AbortError") { setBusy(false); return; }
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      await markBackedUp();
      setMsg({ type: "ok", text: `✓ Backup gespeichert: ${filename} (${keys.length} Einträge, ${formatBytes(blob.size)}).` });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Sichern: " + (e.message || String(e)) });
    } finally {
      setBusy(false);
    }
  };

  const importBackup = async (file) => {
    setBusy(true); setMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
      let text;
      if (isGzip) {
        if (typeof DecompressionStream === "undefined") {
          throw new Error("Dieses gzip-komprimierte Backup kann auf diesem Browser nicht gelesen werden.");
        }
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        text = await new Response(stream).text();
      } else {
        text = new TextDecoder("utf-8").decode(bytes);
      }
      const data = JSON.parse(text);

      // Zwei Formate werden akzeptiert: das neue generische Format dieser
      // Seite ({entries:{key:value}}), und das ältere, Flugbuch-eigene
      // Format ({flights:[...], customFieldDefs:[...], service:{...},
      // reisen:{...}, notes, savedViews}) — falls noch ein Backup von vor
      // dieser Service-Seite vorliegt, lässt es sich weiterhin einlesen.
      let count = 0;
      if (data.entries && typeof data.entries === "object") {
        for (const [key, value] of Object.entries(data.entries)) {
          await window.storage.set(key, value);
          count++;
        }
      } else if (Array.isArray(data.flights)) {
        for (const f of data.flights) { await window.storage.set(`flight:${f.id}`, JSON.stringify(f)); count++; }
        if (Array.isArray(data.customFieldDefs) && data.customFieldDefs.length) {
          await window.storage.set("customFieldDefs", JSON.stringify(data.customFieldDefs)); count++;
        }
        if (data.service && typeof data.service === "object") {
          for (const [k, v] of Object.entries(data.service)) { await window.storage.set(k, JSON.stringify(v)); count++; }
        }
        if (data.reisen && typeof data.reisen === "object") {
          for (const [k, v] of Object.entries(data.reisen)) { await window.storage.set(k, JSON.stringify(v)); count++; }
        }
        if (typeof data.notes === "string" && data.notes) { await window.storage.set("settings:notes", data.notes); count++; }
        if (Array.isArray(data.savedViews) && data.savedViews.length) {
          await window.storage.set("flugbuchSavedViews", JSON.stringify(data.savedViews)); count++;
        }
      } else {
        throw new Error("Ungültiges Backup-Format.");
      }

      await window.storage.set("settings:backupDirty", "0");
      const iso = new Date().toISOString();
      try { await window.storage.set("settings:lastRestoreAt", iso); } catch {}
      setLastRestoreAt(iso);
      setMsg({ type: "ok", text: `✓ ${count} Einträge wiederhergestellt.` });
      loadStats();
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Wiederherstellen: " + (e.message || String(e)) });
    } finally {
      setBusy(false);
    }
  };

  // Erzeugt flugbuch.csv, material.csv, schirme.csv (je eine Spalte pro
  // Datenbankfeld) sowie eine ZIP-Datei mit den rekonstruierten IGC-Dateien
  // aller Flüge mit Track — und legt alle vier am selben Ort ab wie das
  // Backup oben (automatischer Backup-Ordner, sonst Teilen/Download, exakt
  // dieselbe Reihenfolge wie exportBackup).
  const exportCsvIgc = async () => {
    setBusy(true); setMsg(null);
    let writeHandle = await requestDirWriteHandle();
    try {
      const [flights, material, schirme] = await Promise.all([
        loadAllFlights(), loadAllMaterial(), loadSchirmeList(),
      ]);

      const flugbuchCsv = buildCsv(flights, ["customFields"]);
      const materialCsv = buildCsv(material);
      const schirmeCsv = buildCsv(schirme);

      if (typeof JSZip === "undefined") throw new Error("ZIP-Bibliothek (JSZip) konnte nicht geladen werden.");
      const zip = new JSZip();
      const usedNames = new Set();
      let igcCount = 0;
      for (const fl of flights) {
        const built = buildIgcTextFromFlight(fl);
        if (!built) continue;
        const safeBase = built.filenameBase.replace(/[\\/:*?"<>|]/g, "_");
        let name = safeBase + ".igc", i = 2;
        while (usedNames.has(name)) { name = `${safeBase}_${i}.igc`; i++; }
        usedNames.add(name);
        zip.file(name, built.text);
        igcCount++;
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });

      const files = [
        { name: "flugbuch.csv", blob: new Blob([flugbuchCsv], { type: "text/csv;charset=utf-8" }) },
        { name: "material.csv", blob: new Blob([materialCsv], { type: "text/csv;charset=utf-8" }) },
        { name: "schirme.csv", blob: new Blob([schirmeCsv], { type: "text/csv;charset=utf-8" }) },
        { name: "flugbuch-igc.zip", blob: zipBlob },
      ];
      const summary = `flugbuch.csv, material.csv, schirme.csv, flugbuch-igc.zip (${flights.length} Flüge, ${material.length} Material-Einträge, ${schirme.length} Schirme, ${igcCount} IGC-Dateien)`;

      // Wie beim Backup: bevorzugt direkt in den festgelegten Ordner
      // schreiben, ganz ohne Dialog.
      if (writeHandle) {
        try {
          for (const f of files) {
            const fileHandle = await writeHandle.getFileHandle(f.name, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(f.blob);
            await writable.close();
          }
          setMsg({ type: "ok", text: `✓ Export gespeichert in „${writeHandle.name}": ${summary}.` });
          setBusy(false);
          return;
        } catch (e) {
          console.error("Direktes Schreiben in Backup-Ordner fehlgeschlagen, weiche auf Teilen/Download aus:", e);
          // Kein return — fällt bewusst durch auf den bestehenden Weg unten.
        }
      }

      if (navigator.share && navigator.canShare) {
        try {
          const shareFiles = files.map(f => new File([f.blob], f.name, { type: f.blob.type || "application/octet-stream" }));
          if (navigator.canShare({ files: shareFiles })) {
            await navigator.share({ files: shareFiles });
            setMsg({ type: "ok", text: `✓ Export geteilt: ${summary}.` });
            setBusy(false);
            return;
          }
        } catch (e) {
          if (e && e.name === "AbortError") { setBusy(false); return; }
        }
      }

      for (const f of files) {
        const url = URL.createObjectURL(f.blob);
        const a = document.createElement("a");
        a.href = url; a.download = f.name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      setMsg({ type: "ok", text: `✓ Export heruntergeladen: ${summary}.` });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Exportieren: " + (e.message || String(e)) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#040e20", color: "#e8f4fd", fontFamily: "system-ui,sans-serif", paddingBottom: 40 }}>
      <div style={{ padding: "calc(18px + env(safe-area-inset-top, 0px)) 16px 6px", display: "flex", alignItems: "center", gap: 10 }}>
        <a href="index.html" style={{ color: "#7dd3fc", fontSize: 24, textDecoration: "none", flexShrink: 0, lineHeight: 1 }}>‹</a>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(232,244,253,0.4)", marginBottom: 2 }}>Flugbuch</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px" }}>🛠️ Service</h1>
          <div style={{ fontSize: 12, color: "rgba(232,244,253,0.45)" }}>
            {stats ? `${stats.flights} Flüge · ${stats.material} Material-Einträge · ${stats.keys} Datensätze gesamt` : "Lade…"}
          </div>
        </div>
      </div>

      <div style={{ padding: "16px" }}>
        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>🔑 API-Zugangsdaten</div>
          <div style={{ fontSize: 12, color: "rgba(232,244,253,0.55)", marginBottom: 14, lineHeight: 1.5 }}>
            MapTiler-Schlüssel für die Karten im Flugbuch (Outdoor-Kartenstil). Ohne eigenen Schlüssel läuft die App mit einem eingebauten Standard-Schlüssel weiter.
          </div>
          <div style={{ fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 }}>MapTiler API Key</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={maptilerKey} onChange={e => setMaptilerKey(e.target.value)}
              placeholder="eigenen Schlüssel von cloud.maptiler.com einfügen"
              style={{ flex: "1 1 220px", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 13 }} />
            <button onClick={saveMaptilerKey}
              style={{ flexShrink: 0, background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 10, padding: "10px 16px", color: "#4ade80", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              Speichern
            </button>
          </div>
          {maptilerKeySaved && (
            <div style={{ fontSize: 11, color: "rgba(74,222,128,0.8)", marginTop: 8 }}>✓ Eigener Schlüssel aktiv — Feld leeren und speichern, um wieder den Standard-Schlüssel zu nutzen.</div>
          )}
        </div>

        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>📍 IGC-Import: Start-/Landeplatz &amp; Land</div>
          <div style={{ fontSize: 12, color: "rgba(232,244,253,0.55)", marginBottom: 14, lineHeight: 1.5 }}>
            Beim Import einer neuen IGC-Datei übernimmt das Flugbuch Startplatz, Landeplatz und Land automatisch von einem bereits vorhandenen Flug, dessen Koordinaten innerhalb dieses Radius liegen. Findet sich kein Treffer, wird das Land zusätzlich per MapTiler bestimmt (benötigt den Schlüssel oben).
          </div>
          <div style={{ fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 }}>Radius (km)</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={placeRadius} onChange={e => setPlaceRadius(e.target.value)}
              inputMode="decimal" placeholder="0.5"
              style={{ flex: "1 1 120px", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 13 }} />
            <button onClick={savePlaceRadius}
              style={{ flexShrink: 0, background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 10, padding: "10px 16px", color: "#4ade80", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              Speichern
            </button>
          </div>
          {placeRadiusSaved && (
            <div style={{ fontSize: 11, color: "rgba(74,222,128,0.8)", marginTop: 8 }}>✓ Aktueller Radius: {placeRadius} km.</div>
          )}
        </div>

        {fsapiSupported && (
          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>📁 Backup-Ordner (automatisch, dieser PC)</div>
            <div style={{ fontSize: 12, color: "rgba(232,244,253,0.55)", marginBottom: 14, lineHeight: 1.5 }}>
              Einmalig festlegen (z.B. dein lokaler Synology-Drive-Sync-Ordner) — künftige Backups landen danach automatisch dort, ganz ohne Dialog. Gilt nur für diesen Browser auf diesem Gerät.
            </div>
            {dirName ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 auto", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#4ade80" }}>
                  📂 {dirName}
                  {dirPermission !== "granted" && <span style={{ color: "#fcd34d", marginLeft: 8 }}>(Berechtigung beim nächsten Backup erneut bestätigen)</span>}
                </div>
                <button onClick={chooseDirectory}
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "8px 12px", color: "rgba(232,244,253,0.8)", fontSize: 12, cursor: "pointer" }}>
                  Ändern
                </button>
                <button onClick={clearDirectory}
                  style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8, padding: "8px 12px", color: "#f87171", fontSize: 12, cursor: "pointer" }}>
                  Entfernen
                </button>
              </div>
            ) : (
              <button onClick={chooseDirectory}
                style={{ background: "rgba(125,211,252,0.15)", border: "1px solid rgba(125,211,252,0.3)", borderRadius: 10, padding: "10px 16px", color: "#7dd3fc", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                📁 Ordner auswählen…
              </button>
            )}

            {dirName && dirPermission === "granted" && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, color: "rgba(232,244,253,0.4)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                  Backups in diesem Ordner {loadingFolderBackups ? "(lade…)" : `(${folderBackups.length})`}
                </div>
                {folderBackups.length === 0 && !loadingFolderBackups && (
                  <div style={{ fontSize: 12, color: "rgba(232,244,253,0.4)" }}>Noch keine Backup-Dateien hier gefunden.</div>
                )}
                {folderBackups.map(b => (
                  <div key={b.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 8, marginBottom: 6 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: "#e8f4fd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</div>
                      <div style={{ fontSize: 10, color: "rgba(232,244,253,0.4)" }}>{new Date(b.lastModified).toLocaleString("de-CH")} · {formatBytes(b.size)}</div>
                    </div>
                    <button onClick={async () => { const file = await b.handle.getFile(); importBackup(file); }} disabled={busy}
                      style={{ flexShrink: 0, background: "rgba(125,211,252,0.15)", border: "1px solid rgba(125,211,252,0.3)", borderRadius: 8, padding: "6px 12px", color: "#7dd3fc", fontSize: 11, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
                      Wiederherstellen
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>☁️ Backup & Restore {dirName ? "(anderer Ort)" : ""}</div>
          <div style={{ fontSize: 12, color: "rgba(232,244,253,0.55)", marginBottom: 16, lineHeight: 1.5 }}>
            {dirName
              ? "Zum manuellen Wiederherstellen aus einer Datei außerhalb des oben gewählten Ordners, oder wenn dein Backup-Ordner gerade nicht verfügbar ist."
              : "Sichert alles auf einmal: Flugbuch, Statistik-Voreinstellungen und Material. Eine wiederhergestellte Sicherung ersetzt die aktuellen Daten in den jeweils gleichen Bereichen (bestehende Einträge mit derselben ID werden überschrieben, alles andere bleibt unangetastet)."}
            {!fsapiSupported && " Auf diesem Browser läuft „Backup sichern” über den Teilen-/Download-Dialog (die automatische Ordner-Option oben gibt es nur in Chrome/Edge am PC)."}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 160px" }}>
              <button onClick={exportBackup} disabled={busy}
                style={{ width: "100%", boxSizing: "border-box", background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 10, padding: "12px", color: "#4ade80", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
                {busy ? "⏳ …" : "☁️ Backup sichern"}
              </button>
              <div style={{ fontSize: 11, color: "rgba(232,244,253,0.45)", marginTop: 6, textAlign: "center" }}>
                {lastBackupAt ? `Letztes Backup: ${formatTimestamp(lastBackupAt)}` : "Noch kein Backup gesichert."}
              </div>
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <button onClick={() => fileRef.current?.click()} disabled={busy}
                style={{ width: "100%", boxSizing: "border-box", background: "rgba(125,211,252,0.15)", border: "1px solid rgba(125,211,252,0.3)", borderRadius: 10, padding: "12px", color: "#7dd3fc", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
                ⬆ Backup importieren (Datei wählen)
              </button>
              <div style={{ fontSize: 11, color: "rgba(232,244,253,0.45)", marginTop: 6, textAlign: "center" }}>
                {lastRestoreAt ? `Letzter Restore: ${formatTimestamp(lastRestoreAt)}` : "Noch kein Restore durchgeführt."}
              </div>
            </div>
            <input ref={fileRef} type="file" accept=".json,.gz,.json.gz" style={{ display: "none" }}
              onChange={e => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ""; }} />
          </div>
        </div>

        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>📤 Exportieren (CSV &amp; IGC)</div>
          <div style={{ fontSize: 12, color: "rgba(232,244,253,0.55)", marginBottom: 16, lineHeight: 1.5 }}>
            Erzeugt vier Dateien — flugbuch.csv, material.csv und schirme.csv (je eine Spalte pro Datenbankfeld) sowie eine ZIP-Datei mit den IGC-Dateien aller Flüge — und legt sie am selben Ort ab wie das Backup oben{dirName ? ` (Ordner „${dirName}")` : ""}.
          </div>
          <button onClick={exportCsvIgc} disabled={busy}
            style={{ width: "100%", boxSizing: "border-box", background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: "12px", color: "#fcd34d", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
            {busy ? "⏳ …" : "📤 Exportieren"}
          </button>
        </div>

        <a href="schirme.html"
          style={{ display: "flex", alignItems: "center", gap: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, marginBottom: 14, textDecoration: "none", color: "inherit" }}>
          <img src="icons/icon-header-128.png?v=2" alt="" style={{ width: 26, height: 26, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Schirme</div>
            <div style={{ fontSize: 12, color: "rgba(232,244,253,0.55)" }}>Hersteller, Typ, letzter Check — verknüpft mit Material</div>
          </div>
          <div style={{ fontSize: 18, color: "rgba(232,244,253,0.3)" }}>›</div>
        </a>

        {msg && (
          <div style={{ background: msg.type === "ok" ? "rgba(74,222,128,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${msg.type === "ok" ? "rgba(74,222,128,0.3)" : "rgba(239,68,68,0.3)"}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: msg.type === "ok" ? "#4ade80" : "#f87171", marginBottom: 14 }}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}
