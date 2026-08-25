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
    try {
      // Wirklich JEDEN Schlüssel sichern — Flüge (flight:*), Material
      // (entry:*), Statistik-Filter (statistikFilters), eigene Felder
      // (customFieldDefs), Reisen (reisen:*), gespeicherte Darstellungen
      // (flugbuchSavedViews), Notizen (settings:notes) und alles, was
      // künftig noch dazukommt — ohne dass diese Liste je gepflegt werden
      // müsste.
      const all = await window.storage.list("");
      const keys = all?.keys || [];
      const entries = {};
      for (const k of keys) {
        const r = await window.storage.get(k);
        if (r) entries[k] = r.value;
      }
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
      <div style={{ padding: "calc(18px + env(safe-area-inset-top, 0px)) 16px 6px" }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(232,244,253,0.4)", marginBottom: 2 }}>Flugbuch</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px" }}>🛠️ Service</h1>
        <div style={{ fontSize: 12, color: "rgba(232,244,253,0.45)" }}>
          {stats ? `${stats.flights} Flüge · ${stats.material} Material-Einträge · ${stats.keys} Datensätze gesamt` : "Lade…"}
        </div>
      </div>

      <div style={{ padding: "16px" }}>
        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>☁️ Backup & Restore</div>
          <div style={{ fontSize: 12, color: "rgba(232,244,253,0.55)", marginBottom: 16, lineHeight: 1.5 }}>
            Sichert alles auf einmal: Flugbuch, Statistik-Voreinstellungen und Material. Eine wiederhergestellte Sicherung ersetzt die aktuellen Daten in den jeweils gleichen Bereichen (bestehende Einträge mit derselben ID werden überschrieben, alles andere bleibt unangetastet).
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={exportBackup} disabled={busy}
              style={{ flex: "1 1 160px", background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 10, padding: "12px", color: "#4ade80", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
              {busy ? "⏳ …" : "☁️ Backup sichern"}
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={busy}
              style={{ flex: "1 1 160px", background: "rgba(125,211,252,0.15)", border: "1px solid rgba(125,211,252,0.3)", borderRadius: 10, padding: "12px", color: "#7dd3fc", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
              ⬆ Backup importieren
            </button>
            <input ref={fileRef} type="file" accept=".json,.gz,.json.gz" style={{ display: "none" }}
              onChange={e => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ""; }} />
          </div>
        </div>

        {msg && (
          <div style={{ background: msg.type === "ok" ? "rgba(74,222,128,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${msg.type === "ok" ? "rgba(74,222,128,0.3)" : "rgba(239,68,68,0.3)"}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: msg.type === "ok" ? "#4ade80" : "#f87171", marginBottom: 14 }}>
            {msg.text}
          </div>
        )}

        <div style={{ fontSize: 11, color: "rgba(232,244,253,0.3)", textAlign: "center", marginTop: 20 }}>
          Weitere Service-Funktionen (z.B. Wartungserinnerungen für Schirm/Rettungsgerät) folgen hier später.
        </div>
      </div>

      <div style={{ padding: "16px 16px 0" }}>
        <a href="index.html" style={{ display: "inline-block", fontSize: 12, color: "rgba(125,211,252,0.7)", textDecoration: "none" }}>← Zur Startseite</a>
      </div>
    </div>
  );
}
