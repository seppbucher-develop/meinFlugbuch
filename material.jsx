// ── Material ──────────────────────────────────────────────────────────────
// Eigenständige Seite (wie Statistik) — eigene IndexedDB-Keys unter dem
// Präfix "material:", getrennt von den Flug-Datensätzen ("flight:"), aber
// im selben Storage-Origin wie flugbuch.html (siehe material.html).
// Spalten entsprechen 1:1 dem "Diverses"-Reiter der ursprünglichen Excel-
// Datei: Datum, Art, Typ, Wer, SN, Fabrikation, Hersteller, was, wo, Preis,
// Bemerkung.

const MATERIAL_FIELDS = [
  { id: "datum", label: "Datum", type: "date" },
  { id: "art", label: "Art", type: "text" },
  { id: "typ", label: "Typ", type: "text" },
  { id: "wer", label: "Wer", type: "text" },
  { id: "sn", label: "SN", type: "text" },
  { id: "fabrikation", label: "Fabrikation", type: "text" },
  { id: "hersteller", label: "Hersteller", type: "text" },
  { id: "was", label: "Was", type: "text" },
  { id: "wo", label: "Wo", type: "text" },
  { id: "preis", label: "Preis", type: "number" },
  { id: "bemerkung", label: "Bemerkung", type: "text" },
];

function pad2(n) { return String(n).padStart(2, "0"); }

function parseMaterialExcelWorkbook(arrayBuffer) {
  if (!window.XLSX) throw new Error("Excel-Bibliothek nicht geladen (XLSX)");
  const wb = window.XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const sheet = wb.Sheets["Diverses"];
  if (!sheet) throw new Error('Reiter "Diverses" nicht gefunden');
  const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  // Header steht in Zeile 2 (Zeile 1 ist leer) — Datenzeilen ab Zeile 3.
  return rows.slice(2);
}

function createEntryFromExcelRow(row, rowNumber) {
  const [datum, art, typ, wer, sn, fabrikation, hersteller, was, wo, preis, bemerkung] = row;
  let dateStr = "";
  if (datum instanceof Date && !isNaN(datum)) {
    dateStr = `${pad2(datum.getDate())}.${pad2(datum.getMonth() + 1)}.${datum.getFullYear()}`;
  } else if (typeof datum === "string") {
    dateStr = datum.trim();
  }
  return {
    id: `mat_${rowNumber}_${Date.now()}`,
    datum: dateStr,
    art: art || "", typ: typ || "", wer: wer || "",
    sn: sn != null ? String(sn) : "",
    fabrikation: fabrikation != null ? String(fabrikation) : "",
    hersteller: hersteller || "", was: was || "", wo: wo || "",
    preis: preis != null && preis !== "" ? Number(preis) : null,
    bemerkung: bemerkung || "",
    excelImportKey: `mat-xls-${rowNumber}`,
  };
}

function parseDateToTs(d) {
  if (!d) return 0;
  const p = d.split(".");
  return p.length === 3 ? new Date(+p[2], +p[1] - 1, +p[0]).getTime() : 0;
}

function EntryForm({ initial, onSave, onCancel }) {
  const [data, setData] = React.useState(initial || {});
  const set = (id, v) => setData(d => ({ ...d, [id]: v }));
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#14253a", borderRadius: 16, padding: "20px 20px", maxWidth: 420, width: "100%", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{initial?.id ? "Eintrag bearbeiten" : "Neuer Eintrag"}</div>
        {MATERIAL_FIELDS.map(f => (
          <div key={f.id} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 }}>{f.label}</div>
            <input
              value={data[f.id] ?? ""}
              onChange={e => set(f.id, f.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
              type={f.type === "number" ? "number" : "text"}
              placeholder={f.id === "datum" ? "tt.mm.jjjj" : ""}
              style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 14 }} />
          </div>
        ))}
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <button onClick={onCancel}
            style={{ flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "11px", color: "#e8f4fd", fontSize: 14, cursor: "pointer" }}>
            Abbrechen
          </button>
          <button onClick={() => onSave(data)}
            style={{ flex: 1, background: "rgba(34,197,94,0.2)", border: "1px solid rgba(34,197,94,0.4)", borderRadius: 10, padding: "11px", color: "#4ade80", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

function MaterialApp() {
  const [entries, setEntries] = React.useState(null); // null = am Laden
  const [editing, setEditing] = React.useState(null); // Eintrag in Bearbeitung, oder {} für neu
  const [confirmDelete, setConfirmDelete] = React.useState(null);
  const [filterArt, setFilterArt] = React.useState(new Set());
  const [importing, setImporting] = React.useState(false);
  const [importResult, setImportResult] = React.useState(null);
  const fileRef = React.useRef(null);

  const load = React.useCallback(async () => {
    try {
      const keys = await window.storage.list("entry:");
      const raw = await Promise.all((keys?.keys || []).map(async k => {
        try { const r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; } catch { return null; }
      }));
      setEntries(raw.filter(Boolean));
    } catch (e) {
      console.error("Storage load error:", e);
      setEntries([]);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const saveEntry = async (data) => {
    const isNew = !data.id;
    const toSave = isNew ? { ...data, id: `mat_${Date.now()}` } : data;
    await window.storage.set(`entry:${toSave.id}`, JSON.stringify(toSave));
    setEntries(prev => {
      const exists = prev.some(e => e.id === toSave.id);
      return exists ? prev.map(e => e.id === toSave.id ? toSave : e) : [toSave, ...prev];
    });
    setEditing(null);
  };

  const deleteEntry = async (id) => {
    await window.storage.delete(`entry:${id}`);
    setEntries(prev => prev.filter(e => e.id !== id));
    setConfirmDelete(null);
  };

  const importExcel = async (file) => {
    setImporting(true); setImportResult(null);
    try {
      const buf = await file.arrayBuffer();
      const rows = parseMaterialExcelWorkbook(buf);
      const alreadyImported = new Set((entries || []).map(e => e.excelImportKey).filter(Boolean));
      const newEntries = [];
      let skipped = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 3;
        if (!row || row.every(c => c === null || c === "")) continue;
        if (!(row[0] instanceof Date) || isNaN(row[0])) continue;
        const key = `mat-xls-${rowNumber}`;
        if (alreadyImported.has(key)) { skipped++; continue; }
        const entry = createEntryFromExcelRow(row, rowNumber);
        await window.storage.set(`entry:${entry.id}`, JSON.stringify(entry));
        newEntries.push(entry);
      }
      if (newEntries.length) setEntries(prev => [...newEntries, ...prev]);
      setImportResult({ created: newEntries.length, skipped, total: rows.length });
    } catch (e) {
      setImportResult({ error: e.message || String(e) });
    } finally {
      setImporting(false);
    }
  };

  const all = entries || [];
  const artOptions = React.useMemo(() => {
    const set = new Set();
    all.forEach(e => { const v = (e.art || "").trim(); if (v) set.add(v); });
    return [...set].sort((a, b) => a.localeCompare(b, "de"));
  }, [all]);

  const filtered = React.useMemo(() => {
    const list = filterArt.size ? all.filter(e => filterArt.has((e.art || "").trim())) : all;
    return [...list].sort((a, b) => parseDateToTs(b.datum) - parseDateToTs(a.datum));
  }, [all, filterArt]);

  const totalSpent = filtered.reduce((s, e) => s + (Number(e.preis) || 0), 0);

  if (entries === null) {
    return <div style={{ padding: 24, color: "rgba(232,244,253,0.5)", fontFamily: "-apple-system,BlinkMacSystemFont,sans-serif" }}>Lade Material…</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#040e20", color: "#e8f4fd", fontFamily: "-apple-system,BlinkMacSystemFont,sans-serif", paddingBottom: 40 }}>
      <div style={{ padding: "calc(18px + env(safe-area-inset-top, 0px)) 16px 6px" }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(232,244,253,0.4)", marginBottom: 2 }}>Flugbuch</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px" }}>🎒 Material</h1>
        <div style={{ fontSize: 12, color: "rgba(232,244,253,0.45)" }}>{all.length} Einträge · {filtered.length} sichtbar · Summe {totalSpent.toLocaleString("de-CH", { maximumFractionDigits: 0 })}.-</div>
      </div>

      <div style={{ padding: "10px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => setEditing({})}
          style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 8, padding: "8px 14px", color: "#4ade80", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          + Neuer Eintrag
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={importing}
          style={{ background: "rgba(250,204,21,0.12)", border: "1px solid rgba(250,204,21,0.3)", borderRadius: 8, padding: "8px 14px", color: "#facc15", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          {importing ? "⏳ Importiere…" : "📊 Excel importieren"}
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
          onChange={e => { if (e.target.files[0]) importExcel(e.target.files[0]); e.target.value = ""; }} />
      </div>

      {importResult && (
        <div style={{ margin: "0 16px 10px", background: importResult.error ? "rgba(239,68,68,0.08)" : "rgba(250,204,21,0.1)", border: `1px solid ${importResult.error ? "rgba(239,68,68,0.3)" : "rgba(250,204,21,0.3)"}`, borderRadius: 10, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: importResult.error ? "#f87171" : "#facc15" }}>
            {importResult.error ? "❌ " + importResult.error : `✅ ${importResult.created} neu importiert · ${importResult.skipped} bereits vorhanden`}
          </span>
          <button onClick={() => setImportResult(null)} style={{ background: "none", border: "none", color: "rgba(250,204,21,0.5)", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
      )}

      {artOptions.length > 0 && (
        <div style={{ padding: "0 16px 12px", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {artOptions.map(a => (
            <button key={a} onClick={() => setFilterArt(prev => { const n = new Set(prev); n.has(a) ? n.delete(a) : n.add(a); return n; })}
              style={{ background: filterArt.has(a) ? "rgba(125,211,252,0.2)" : "rgba(255,255,255,0.05)", border: `1px solid ${filterArt.has(a) ? "rgba(125,211,252,0.4)" : "rgba(255,255,255,0.1)"}`, borderRadius: 20, padding: "5px 12px", color: filterArt.has(a) ? "#7dd3fc" : "rgba(232,244,253,0.6)", fontSize: 11, fontWeight: filterArt.has(a) ? 700 : 400, cursor: "pointer" }}>
              {a}
            </button>
          ))}
          {filterArt.size > 0 && (
            <button onClick={() => setFilterArt(new Set())}
              style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 20, padding: "5px 12px", color: "#f87171", fontSize: 11, cursor: "pointer" }}>
              ✕ zurücksetzen
            </button>
          )}
        </div>
      )}

      <div style={{ padding: "0 16px" }}>
        {filtered.length === 0 && (
          <div style={{ padding: "40px 12px", textAlign: "center", fontSize: 13, color: "rgba(232,244,253,0.4)" }}>
            Noch keine Einträge. Über „Excel importieren" oder „+ Neuer Eintrag" loslegen.
          </div>
        )}
        {filtered.map(e => (
          <div key={e.id} onClick={() => setEditing(e)}
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "12px 14px", marginBottom: 8, cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#7dd3fc" }}>{e.art || "—"}{e.typ ? " · " + e.typ : ""}</span>
              <span style={{ fontSize: 11, color: "rgba(232,244,253,0.4)" }}>{e.datum}</span>
            </div>
            <div style={{ fontSize: 12, color: "rgba(232,244,253,0.7)" }}>
              {[e.wer, e.hersteller, e.was].filter(Boolean).join(" · ") || "—"}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ fontSize: 11, color: "rgba(232,244,253,0.4)" }}>{e.bemerkung}</span>
              {e.preis != null && <span style={{ fontSize: 12, fontWeight: 700, color: e.preis < 0 ? "#4ade80" : "#e8f4fd" }}>{e.preis.toLocaleString("de-CH", { maximumFractionDigits: 2 })}.-</span>}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <EntryForm initial={editing} onSave={saveEntry} onCancel={() => setEditing(null)} />
      )}

      <div style={{ padding: "16px 16px 0" }}>
        <a href="index.html" style={{ display: "inline-block", fontSize: 12, color: "rgba(125,211,252,0.7)", textDecoration: "none" }}>← Zur Startseite</a>
      </div>
    </div>
  );
}
