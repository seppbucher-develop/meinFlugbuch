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
    let writeHandle = null;
    if (fsapiSupported && dirHandle) {
      try {
        let perm = await dirHandle.queryPermission({ mode: "readwrite" });
        if (perm !== "granted") perm = await dirHandle.requestPermission({ mode: "readwrite" });
        if (perm === "granted") { writeHandle = dirHandle; setDirPermission("granted"); }
        else setDirPermission(perm);
      } catch (e) { console.error("Berechtigung für Backup-Ordner fehlgeschlagen:", e); }
    }
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
      setMsg({ type: "ok", text: `✓ ${count} Einträge wiederhergestellt.` });
      loadStats();
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Wiederherstellen: " + (e.message || String(e)) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#040e20", color: "#e8f4fd", fontFamily: "-apple-system,BlinkMacSystemFont,sans-serif", paddingBottom: 40 }}>
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
            <button onClick={exportBackup} disabled={busy}
              style={{ flex: "1 1 160px", background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 10, padding: "12px", color: "#4ade80", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
              {busy ? "⏳ …" : "☁️ Backup sichern"}
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={busy}
              style={{ flex: "1 1 160px", background: "rgba(125,211,252,0.15)", border: "1px solid rgba(125,211,252,0.3)", borderRadius: 10, padding: "12px", color: "#7dd3fc", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
              ⬆ Backup importieren (Datei wählen)
            </button>
            <input ref={fileRef} type="file" accept=".json,.gz,.json.gz" style={{ display: "none" }}
              onChange={e => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ""; }} />
          </div>
        </div>

        <a href="schirme.html"
          style={{ display: "flex", alignItems: "center", gap: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, marginBottom: 14, textDecoration: "none", color: "inherit" }}>
          <div style={{ fontSize: 26, flexShrink: 0 }}>🪂</div>
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
