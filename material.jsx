// ── Material ──────────────────────────────────────────────────────────────
// Eigenständige Seite (wie Statistik) — eigene IndexedDB-Keys unter dem
// Präfix "material:", getrennt von den Flug-Datensätzen ("flight:"), aber
// im selben Storage-Origin wie flugbuch.html (siehe material.html).
// Spalten entsprechen 1:1 dem "Diverses"-Reiter der ursprünglichen Excel-
// Datei: Datum, Art, Typ, Wer, SN, Fabrikation, Hersteller, was, wo, Preis,
// Bemerkung.
//
// Führende Tabellen: Für die vier Kategorien in "Art" (Schirm/Sitz/Gerät/
// Div) gibt es je eine eigene Stammdaten-Seite/-Liste (schirme:list,
// sitze:list, geraete:list, div:list — siehe schirme.jsx/sitze.jsx/
// geraete.jsx/div.jsx). Diese Listen sind FÜHREND: ein Material-Eintrag
// dieser Art bekommt automatisch die ID des dazu passenden Stammdaten-
// Eintrags (Abgleich über "Typ" = Name des Stammdaten-Eintrags) in ein
// eigenes Feld (schirmId/sitzId/geraetId/divId) — analog zur schirmId, die
// flugbuch.jsx schon länger bei Flügen einträgt (siehe dort
// resolveSchirmForGlider). Gibt es zum Typ-Namen noch keinen Stammdaten-
// Eintrag, wird er hier automatisch neu angelegt.

const ART_OPTIONS = ["Schirm", "Sitz", "Gerät", "Div"];

// Konfiguration der vier Stammdaten-Tabellen: idPrefix für neu erzeugte
// Einträge, key = IndexedDB-Schlüssel der Liste, field = Name des Feldes,
// das bei einem Material-Eintrag dieser Art auf die ID im Stamm zeigt.
const ART_TABLES = {
  "Schirm": { key: "schirme:list", field: "schirmId", idPrefix: "schirm", label: "Schirme", icon: "🪂", href: "schirme.html" },
  "Sitz":   { key: "sitze:list",   field: "sitzId",   idPrefix: "sitz",   label: "Sitze",   icon: "🎽", href: "sitze.html" },
  "Gerät":  { key: "geraete:list", field: "geraetId", idPrefix: "geraet", label: "Geräte",  icon: "📟", href: "geraete.html" },
  "Div":    { key: "div:list",     field: "divId",    idPrefix: "div",    label: "Div",     icon: "🧰", href: "div.html" },
};

const MATERIAL_FIELDS = [
  { id: "datum", label: "Datum", type: "date" },
  { id: "art", label: "Art", type: "select", options: ART_OPTIONS },
  { id: "typ", label: "Typ", type: "text", datalist: true },
  { id: "wer", label: "Wer", type: "text" },
  { id: "sn", label: "SN", type: "text" },
  { id: "fabrikation", label: "Fabrikation", type: "text" },
  { id: "hersteller", label: "Hersteller", type: "text" },
  { id: "was", label: "Was", type: "text" },
  { id: "wo", label: "Wo", type: "text" },
  { id: "preis", label: "Preis", type: "number" },
  { id: "bemerkung", label: "Bemerkung", type: "text" },
];

function parseDateToTs(d) {
  if (!d) return 0;
  const p = d.split(".");
  return p.length === 3 ? new Date(+p[2], +p[1] - 1, +p[0]).getTime() : 0;
}

async function loadMasterList(key) {
  try { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : []; } catch { return []; }
}
async function saveMasterList(key, list) {
  try { await window.storage.set(key, JSON.stringify(list)); } catch {}
}

// Alte Art-Bezeichnung "Notschirm" (aus dem ursprünglichen Excel-Import)
// zählt fachlich als Schirm und landet daher in derselben Stammdaten-
// Tabelle wie Gleitschirme — die feste Auswahl in "Art" kennt seit dieser
// Umstellung nur noch Schirm/Sitz/Gerät/Div, daher hier einmalig (und
// idempotent) umbenannt.
async function migrateNotschirmToSchirm(entries) {
  const toFix = entries.filter(e => (e.art || "").trim() === "Notschirm");
  if (!toFix.length) return entries;
  const fixed = toFix.map(e => ({ ...e, art: "Schirm" }));
  await Promise.all(fixed.map(e => window.storage.set(`entry:${e.id}`, JSON.stringify(e))));
  const byId = new Map(fixed.map(e => [e.id, e]));
  return entries.map(e => byId.get(e.id) || e);
}

// Gleicht die übergebenen Material-Einträge mit den vier Stammdaten-
// Tabellen ab: für jeden Eintrag, dessen "Art" zu einer der vier Kategorien
// passt, wird per "Typ" (= Name im Stamm) der zugehörige Stammdaten-Eintrag
// gesucht — fehlt er, wird er neu angelegt — und dessen ID (falls noch
// nicht geschehen) in das passende Verknüpfungsfeld (schirmId/sitzId/
// geraetId/divId) des Material-Eintrags eingetragen. Persistiert sowohl
// geänderte Material-Einträge als auch geänderte Stammdaten-Listen und gibt
// die geänderten Material-Einträge zurück (leer, falls schon alles aktuell
// war).
async function syncMaterialWithMasters(entries) {
  const updated = [];
  for (const art of Object.keys(ART_TABLES)) {
    const cfg = ART_TABLES[art];
    const relevant = entries.filter(e => (e.art || "").trim() === art);
    if (!relevant.length) continue;
    let list = await loadMasterList(cfg.key);
    let listChanged = false;
    const byName = new Map(list.map(m => [(m.name || "").trim().toLowerCase(), m]));
    for (const e of relevant) {
      const name = (e.typ || "").trim();
      if (!name) continue;
      let master = byName.get(name.toLowerCase());
      if (!master) {
        master = { id: `${cfg.idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name, hersteller: e.hersteller || "", typ: "", letzterCheck: "" };
        list = [...list, master];
        byName.set(name.toLowerCase(), master);
        listChanged = true;
      }
      if (e[cfg.field] !== master.id) {
        const patched = { ...e, [cfg.field]: master.id };
        await window.storage.set(`entry:${patched.id}`, JSON.stringify(patched));
        updated.push(patched);
      }
    }
    if (listChanged) await saveMasterList(cfg.key, list);
  }
  return updated;
}

function EntryForm({ initial, onSave, onCancel, onDelete, suggestions }) {
  const [data, setData] = React.useState(initial || {});
  const set = (id, v) => setData(d => ({ ...d, [id]: v }));
  const typSuggestions = suggestions?.[(data.art || "").trim()] || [];
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#14253a", borderRadius: 16, padding: "20px 20px", maxWidth: 420, width: "100%", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{initial?.id ? "Eintrag bearbeiten" : "Neuer Eintrag"}</div>
        {MATERIAL_FIELDS.map(f => (
          <div key={f.id} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 }}>{f.label}</div>
            {f.type === "select" ? (
              <select value={data[f.id] ?? ""} onChange={e => set(f.id, e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 14 }}>
                <option value="" style={{ background: "#14253a" }}>— wählen —</option>
                {f.options.map(o => <option key={o} value={o} style={{ background: "#14253a" }}>{o}</option>)}
                {data[f.id] && !f.options.includes(data[f.id]) && (
                  <option value={data[f.id]} style={{ background: "#14253a" }}>{data[f.id]} (alt)</option>
                )}
              </select>
            ) : (
              <input
                value={data[f.id] ?? ""}
                onChange={e => set(f.id, f.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
                type={f.type === "number" ? "number" : "text"}
                placeholder={f.id === "datum" ? "tt.mm.jjjj" : ""}
                list={f.datalist && typSuggestions.length ? "typ-datalist" : undefined}
                style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 14 }} />
            )}
          </div>
        ))}
        {typSuggestions.length > 0 && (
          <datalist id="typ-datalist">
            {typSuggestions.map(n => <option key={n} value={n} />)}
          </datalist>
        )}
        {initial?.id && (
          <button onClick={() => onDelete(initial.id)}
            style={{ width: "100%", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "9px", color: "#f87171", fontSize: 13, cursor: "pointer", marginBottom: 12 }}>
            🗑 Eintrag löschen
          </button>
        )}
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
  const [filterMaster, setFilterMaster] = React.useState(null); // {field,label,id,name} aus ?schirmId=… etc.
  const [masterNames, setMasterNames] = React.useState({}); // Art -> [Name, …] für Typ-Vorschläge

  const load = React.useCallback(async () => {
    try {
      const keys = await window.storage.list("entry:");
      const raw = await Promise.all((keys?.keys || []).map(async k => {
        try { const r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; } catch { return null; }
      }));
      let list = raw.filter(Boolean);
      list = await migrateNotschirmToSchirm(list);
      const updated = await syncMaterialWithMasters(list);
      if (updated.length) {
        const byId = new Map(updated.map(e => [e.id, e]));
        list = list.map(e => byId.get(e.id) || e);
        markDirty();
      }
      setEntries(list);
    } catch (e) {
      console.error("Storage load error:", e);
      setEntries([]);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  // Namen der Stammdaten-Einträge je Art laden — dienen im Formular als
  // Typ-Vorschläge (Datalist), damit nicht aus Tippfehlern versehentlich
  // doppelte Stammdaten-Einträge entstehen.
  const loadMasterNames = React.useCallback(async () => {
    const next = {};
    for (const art of Object.keys(ART_TABLES)) {
      const list = await loadMasterList(ART_TABLES[art].key);
      next[art] = list.map(m => m.name).filter(Boolean).sort((a, b) => a.localeCompare(b, "de"));
    }
    setMasterNames(next);
  }, []);
  React.useEffect(() => { loadMasterNames(); }, [loadMasterNames]);

  // Filter über URL-Parameter (z.B. material.html?schirmId=abc) — kommt von
  // "→ Material" auf den Schirme-/Sitze-/Geräte-/Div-Seiten: zeigt dort nur
  // die zu diesem Stammdaten-Eintrag gehörenden Material-Einträge.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    for (const art of Object.keys(ART_TABLES)) {
      const cfg = ART_TABLES[art];
      const id = params.get(cfg.field);
      if (!id) continue;
      loadMasterList(cfg.key).then(list => {
        const m = list.find(x => x.id === id);
        setFilterMaster({ art, field: cfg.field, label: cfg.label, id, name: m ? m.name : id, hersteller: m?.hersteller || "" });
      });
      break;
    }
  }, []);

  const markDirty = () => { try { window.storage.set("settings:backupDirty", "1"); } catch {} };

  const saveEntry = async (data) => {
    const isNew = !data.id;
    let toSave = isNew ? { ...data, id: `mat_${Date.now()}` } : data;
    await window.storage.set(`entry:${toSave.id}`, JSON.stringify(toSave));
    const [synced] = await syncMaterialWithMasters([toSave]);
    if (synced) { toSave = synced; loadMasterNames(); }
    setEntries(prev => {
      const exists = prev.some(e => e.id === toSave.id);
      return exists ? prev.map(e => e.id === toSave.id ? toSave : e) : [toSave, ...prev];
    });
    setEditing(null);
    markDirty();
  };

  const deleteEntry = async (id) => {
    await window.storage.delete(`entry:${id}`);
    setEntries(prev => prev.filter(e => e.id !== id));
    setConfirmDelete(null);
    markDirty();
  };

  const all = entries || [];
  const artOptions = React.useMemo(() => {
    const set = new Set();
    all.forEach(e => { const v = (e.art || "").trim(); if (v) set.add(v); });
    return [...set].sort((a, b) => a.localeCompare(b, "de"));
  }, [all]);

  const filtered = React.useMemo(() => {
    let list = all;
    if (filterMaster) list = list.filter(e => e[filterMaster.field] === filterMaster.id);
    else if (filterArt.size) list = list.filter(e => filterArt.has((e.art || "").trim()));
    return [...list].sort((a, b) => parseDateToTs(b.datum) - parseDateToTs(a.datum));
  }, [all, filterArt, filterMaster]);

  const totalSpent = filtered.reduce((s, e) => s + (Number(e.preis) || 0), 0);

  // Ist die Filterung auf genau einen Stammdaten-Eintrag eingeschränkt (z.B.
  // material.html?schirmId=… bzw. Klick auf "🔗 Material" bei einem
  // bestimmten Schirm), sollen die Felder eines neu angelegten Eintrags so
  // weit wie möglich schon aus diesem Stammdaten-Eintrag vorbelegt sein,
  // statt komplett leer zu starten — Art, Typ (= Name im Stamm), Hersteller
  // sowie die Verknüpfung selbst (schirmId/sitzId/geraetId/divId).
  const newEntryDefaults = filterMaster
    ? { art: filterMaster.art, typ: filterMaster.name, hersteller: filterMaster.hersteller || "", [filterMaster.field]: filterMaster.id }
    : {};

  if (entries === null) {
    return <div style={{ padding: 24, color: "rgba(232,244,253,0.5)", fontFamily: "system-ui,sans-serif" }}>Lade Material…</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#040e20", color: "#e8f4fd", fontFamily: "system-ui,sans-serif", paddingBottom: 40 }}>
      <div style={{ padding: "calc(18px + env(safe-area-inset-top, 0px)) 16px 6px", display: "flex", alignItems: "center", gap: 10 }}>
        <a href="index.html" style={{ color: "#7dd3fc", fontSize: 24, textDecoration: "none", flexShrink: 0, lineHeight: 1 }}>‹</a>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(232,244,253,0.4)", marginBottom: 2 }}>Flugbuch</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px" }}>🎒 Material</h1>
          <div style={{ fontSize: 12, color: "rgba(232,244,253,0.45)" }}>{all.length} Einträge · {filtered.length} sichtbar · Summe {totalSpent.toLocaleString("de-CH", { maximumFractionDigits: 0 })}.-</div>
        </div>
      </div>

      <div style={{ padding: "10px 16px 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
        {Object.values(ART_TABLES).map(cfg => (
          <a key={cfg.href} href={cfg.href}
            style={{ background: "rgba(125,211,252,0.1)", border: "1px solid rgba(125,211,252,0.25)", borderRadius: 8, padding: "8px 14px", color: "#7dd3fc", fontSize: 12, fontWeight: 700, cursor: "pointer", textDecoration: "none" }}>
            {cfg.icon} {cfg.label}
          </a>
        ))}
      </div>

      <div style={{ padding: "10px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => setEditing(newEntryDefaults)}
          style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 8, padding: "8px 14px", color: "#4ade80", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          + Neuer Eintrag
        </button>
      </div>

      {filterMaster ? (
        <div style={{ margin: "0 16px 12px", background: "rgba(125,211,252,0.1)", border: "1px solid rgba(125,211,252,0.3)", borderRadius: 10, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#7dd3fc" }}>🔗 Gefiltert: {filterMaster.label} · <b>{filterMaster.name}</b></span>
          <a href="material.html" style={{ fontSize: 11, color: "#f87171", textDecoration: "none" }}>✕ Filter aufheben</a>
        </div>
      ) : artOptions.length > 0 && (
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
            Noch keine Einträge. Über „+ Neuer Eintrag" loslegen.
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
        <EntryForm initial={editing} onSave={saveEntry} onCancel={() => setEditing(null)} suggestions={masterNames}
          onDelete={(id) => { setEditing(null); setConfirmDelete(id); }} />
      )}

      {confirmDelete && (
        <div onClick={() => setConfirmDelete(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 210, padding: 24 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#14253a", borderRadius: 16, padding: "20px 22px", maxWidth: 320, width: "100%", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Eintrag löschen?</div>
            <div style={{ fontSize: 13, color: "rgba(232,244,253,0.6)", marginBottom: 18 }}>
              Diese Aktion kann nicht rückgängig gemacht werden.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmDelete(null)}
                style={{ flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px", color: "#e8f4fd", fontSize: 14, cursor: "pointer" }}>
                Abbrechen
              </button>
              <button onClick={() => deleteEntry(confirmDelete)}
                style={{ flex: 1, background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 10, padding: "10px", color: "#f87171", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                Löschen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
