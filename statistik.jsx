// ── Statistik / Übersicht ────────────────────────────────────────────────
// Eigenständige Seite (analog "Reisen") — liest dieselben Flugdaten wie
// flugbuch.jsx aus derselben IndexedDB (siehe Storage-Shim in
// statistik.html, identisch zu flugbuch.html), zeigt aber keine
// Bearbeitungsfunktion, nur eine Jahres-Pivot mit Mehrfach-Filtern, analog
// zur "Übersicht"-Pivot-Tabelle aus der ursprünglichen Excel-Datei.

function formatMinutes(min) {
  const m = Math.round(min);
  const h = Math.floor(m / 60), rem = m % 60;
  return `${h}h ${String(rem).padStart(2, "0")}m`;
}

// Distinct, sortierte Werteliste für ein Filterfeld, quer über alle Flüge
// (nicht nur die aktuell gefilterten — Slicer-Verhalten wie in Excel:
// zeigt immer alle möglichen Werte, unabhängig von anderen aktiven
// Filtern).
function distinctValues(flights, getter) {
  const set = new Set();
  flights.forEach(f => { const v = (getter(f) || "").trim(); if (v) set.add(v); });
  return [...set].sort((a, b) => a.localeCompare(b, "de", { numeric: true, sensitivity: "base" }));
}

function MultiSelectFilter({ label, options, selected, onChange }) {
  const [open, setOpen] = React.useState(false);
  const allSelected = selected.size === 0;
  const toggle = (v) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange(next);
  };
  const summary = allSelected ? "Alle" : (selected.size === 1 ? [...selected][0] : `${selected.size} ausgewählt`);
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: "100%", boxSizing: "border-box", display: "flex", justifyContent: "space-between", alignItems: "center", background: allSelected ? "rgba(255,255,255,0.05)" : "rgba(125,211,252,0.15)", border: `1px solid ${allSelected ? "rgba(255,255,255,0.1)" : "rgba(125,211,252,0.35)"}`, borderRadius: 8, padding: "8px 10px", color: allSelected ? "rgba(232,244,253,0.6)" : "#7dd3fc", fontSize: 12, cursor: "pointer" }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110, marginLeft: 6 }}>{summary} {open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div onClick={e => e.stopPropagation()}
            style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#14253a", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: 6, maxHeight: 260, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.5)", zIndex: 50, minWidth: 200 }}>
            <div onClick={() => onChange(new Set())}
              style={{ padding: "7px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer", color: allSelected ? "#7dd3fc" : "rgba(232,244,253,0.6)", fontWeight: allSelected ? 700 : 400, borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: 4 }}>
              ✓ Alle
            </div>
            {options.length === 0 && <div style={{ padding: "7px 10px", fontSize: 12, color: "rgba(232,244,253,0.35)" }}>Keine Werte vorhanden</div>}
            {options.map(o => (
              <div key={o} onClick={() => toggle(o)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer", color: selected.has(o) ? "#e8f4fd" : "rgba(232,244,253,0.6)" }}>
                <div style={{ flexShrink: 0, width: 15, height: 15, borderRadius: 4, border: `2px solid ${selected.has(o) ? "#7dd3fc" : "rgba(232,244,253,0.3)"}`, background: selected.has(o) ? "#7dd3fc" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {selected.has(o) && <span style={{ color: "#0a1628", fontSize: 10, fontWeight: 900 }}>✓</span>}
                </div>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{o}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TrainingFilter({ value, onChange }) {
  const opts = [["alle", "Alle"], ["ja", "Nur Training"], ["nein", "Ohne Training"]];
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {opts.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)}
          style={{ flex: 1, background: value === v ? "rgba(125,211,252,0.2)" : "rgba(255,255,255,0.05)", border: `1px solid ${value === v ? "rgba(125,211,252,0.4)" : "rgba(255,255,255,0.1)"}`, borderRadius: 8, padding: "8px 4px", color: value === v ? "#7dd3fc" : "rgba(232,244,253,0.6)", fontSize: 11, fontWeight: value === v ? 700 : 400, cursor: "pointer" }}>
          {l}
        </button>
      ))}
    </div>
  );
}

function StatistikApp() {
  const [flights, setFlights] = React.useState(null); // null = noch am Laden

  React.useEffect(() => {
    (async () => {
      try {
        const keys = await window.storage.list("flight:");
        const raw = await Promise.all((keys?.keys || []).map(async k => {
          try { const r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; } catch { return null; }
        }));
        setFlights(raw.filter(Boolean));
      } catch (e) {
        console.error("Storage load error:", e);
        setFlights([]);
      }
    })();
  }, []);

  const [typF, setTypF] = React.useState(new Set());
  const [reiseF, setReiseF] = React.useState(new Set());
  const [schirmF, setSchirmF] = React.useState(new Set());
  const [landeplatzF, setLandeplatzF] = React.useState(new Set());
  const [landF, setLandF] = React.useState(new Set());
  const [trainingF, setTrainingF] = React.useState("alle");
  // Restauriert die zuletzt verwendeten Filter beim Öffnen der Seite —
  // statistik.html ist eine eigene Seite (volle Navigation, kein
  // client-seitiges Routing), daher setzt React-State bei jedem Aufruf
  // sonst wieder auf die Standardwerte zurück. settingsLoaded verhindert,
  // dass der Persistierungs-Effekt unten die gerade erst geladenen
  // Filter sofort wieder mit den (noch leeren) Default-Werten überschreibt.
  const [settingsLoaded, setSettingsLoaded] = React.useState(false);
  React.useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("statistikFilters");
        if (r && r.value) {
          const s = JSON.parse(r.value);
          if (Array.isArray(s.typ)) setTypF(new Set(s.typ));
          if (Array.isArray(s.reise)) setReiseF(new Set(s.reise));
          if (Array.isArray(s.schirm)) setSchirmF(new Set(s.schirm));
          if (Array.isArray(s.landeplatz)) setLandeplatzF(new Set(s.landeplatz));
          if (Array.isArray(s.land)) setLandF(new Set(s.land));
          if (s.training) setTrainingF(s.training);
        }
      } catch (e) { /* noch nichts gespeichert, oder Storage nicht verfügbar */ }
      setSettingsLoaded(true);
    })();
  }, []);
  React.useEffect(() => {
    if (!settingsLoaded) return; // nicht speichern, bevor das Laden fertig ist
    try {
      window.storage.set("statistikFilters", JSON.stringify({
        typ: [...typF], reise: [...reiseF], schirm: [...schirmF],
        landeplatz: [...landeplatzF], land: [...landF], training: trainingF,
      }));
    } catch (e) {}
  }, [settingsLoaded, typF, reiseF, schirmF, landeplatzF, landF, trainingF]);

  const all = flights || [];

  const typOptions = React.useMemo(() => distinctValues(all, f => f.customFields?.typ), [all]);
  const reiseOptions = React.useMemo(() => distinctValues(all, f => f.customFields?.reise), [all]);
  const schirmOptions = React.useMemo(() => distinctValues(all, f => f.glider), [all]);
  const landeplatzOptions = React.useMemo(() => distinctValues(all, f => f.customFields?.landung), [all]);
  const landOptions = React.useMemo(() => distinctValues(all, f => f.customFields?.land), [all]);

  const filtered = React.useMemo(() => {
    return all.filter(f => {
      const cf = f.customFields || {};
      if (typF.size && !typF.has((cf.typ || "").trim())) return false;
      if (reiseF.size && !reiseF.has((cf.reise || "").trim())) return false;
      if (schirmF.size && !schirmF.has((f.glider || "").trim())) return false;
      if (landeplatzF.size && !landeplatzF.has((cf.landung || "").trim())) return false;
      if (landF.size && !landF.has((cf.land || "").trim())) return false;
      const isTraining = (cf.training || "").trim().toUpperCase() === "T";
      if (trainingF === "ja" && !isTraining) return false;
      if (trainingF === "nein" && isTraining) return false;
      return true;
    });
  }, [all, typF, reiseF, schirmF, landeplatzF, landF, trainingF]);

  const pivot = React.useMemo(() => {
    const byYear = new Map();
    for (const f of filtered) {
      const yr = (f.year || (f.date || "").split(".")[2] || "—").toString();
      if (!byYear.has(yr)) byYear.set(yr, { year: yr, minutes: 0, flights: 0, days: new Set() });
      const bucket = byYear.get(yr);
      const durSec = f.durationSec || 0;
      bucket.minutes += durSec / 60;
      bucket.flights += 1;
      if (f.date) bucket.days.add(f.date);
    }
    const rows = [...byYear.values()]
      .map(b => ({ year: b.year, minutes: b.minutes, flights: b.flights, days: b.days.size }))
      .sort((a, b) => a.year.localeCompare(b.year, "de", { numeric: true }));
    const total = rows.reduce((acc, r) => ({
      minutes: acc.minutes + r.minutes, flights: acc.flights + r.flights, days: acc.days + r.days,
    }), { minutes: 0, flights: 0, days: 0 });
    return { rows, total };
  }, [filtered]);

  const resetFilters = () => {
    setTypF(new Set()); setReiseF(new Set()); setSchirmF(new Set());
    setLandeplatzF(new Set()); setLandF(new Set()); setTrainingF("alle");
  };
  const anyFilterActive = typF.size || reiseF.size || schirmF.size || landeplatzF.size || landF.size || trainingF !== "alle";

  if (flights === null) {
    return <div style={{ padding: 24, color: "rgba(232,244,253,0.5)", fontFamily: "-apple-system,BlinkMacSystemFont,sans-serif" }}>Lade Flüge…</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#040e20", color: "#e8f4fd", fontFamily: "-apple-system,BlinkMacSystemFont,sans-serif", paddingBottom: 40 }}>
      <div style={{ padding: "calc(18px + env(safe-area-inset-top, 0px)) 16px 6px" }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(232,244,253,0.4)", marginBottom: 2 }}>Flugbuch</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px" }}>Übersicht</h1>
        <div style={{ fontSize: 12, color: "rgba(232,244,253,0.45)" }}>{all.length} Flüge insgesamt · {filtered.length} nach Filter</div>
      </div>

      <div style={{ padding: "10px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
        <MultiSelectFilter label="Typ" options={typOptions} selected={typF} onChange={setTypF} />
        <MultiSelectFilter label="Reise" options={reiseOptions} selected={reiseF} onChange={setReiseF} />
        <MultiSelectFilter label="Schirm" options={schirmOptions} selected={schirmF} onChange={setSchirmF} />
        <MultiSelectFilter label="Landeplatz" options={landeplatzOptions} selected={landeplatzF} onChange={setLandeplatzF} />
        <MultiSelectFilter label="Land" options={landOptions} selected={landF} onChange={setLandF} />
      </div>
      <div style={{ padding: "0 16px 10px" }}>
        <div style={{ fontSize: 10, color: "rgba(232,244,253,0.4)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Training</div>
        <TrainingFilter value={trainingF} onChange={setTrainingF} />
      </div>
      {anyFilterActive && (
        <div style={{ padding: "0 16px 14px" }}>
          <button onClick={resetFilters}
            style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 8, padding: "7px 12px", color: "#f87171", fontSize: 12, cursor: "pointer" }}>
            ✕ Filter zurücksetzen
          </button>
        </div>
      )}

      <div style={{ padding: "0 16px" }}>
        <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, overflow: "hidden", overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1.4fr 1fr", background: "rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.1)", minWidth: 480 }}>
            {["Jahr", "Flüge", "Tage", "Flüge/Tag", "Minuten", "Schnitt"].map((h, i) => (
              <div key={h} style={{ padding: "10px 8px", fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.5, textAlign: i === 0 ? "left" : "right" }}>{h}</div>
            ))}
          </div>
          {pivot.rows.length === 0 && (
            <div style={{ padding: "24px 12px", textAlign: "center", fontSize: 13, color: "rgba(232,244,253,0.4)" }}>Keine Flüge für diese Filterauswahl.</div>
          )}
          {pivot.rows.map(r => (
            <div key={r.year} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1.4fr 1fr", borderBottom: "1px solid rgba(255,255,255,0.05)", minWidth: 480 }}>
              <div style={{ padding: "9px 8px", fontSize: 13, fontWeight: 700, color: "#7dd3fc" }}>{r.year}</div>
              <div style={{ padding: "9px 8px", fontSize: 13, textAlign: "right" }}>{r.flights}</div>
              <div style={{ padding: "9px 8px", fontSize: 13, textAlign: "right" }}>{r.days}</div>
              <div style={{ padding: "9px 8px", fontSize: 13, textAlign: "right", color: "rgba(232,244,253,0.7)" }}>{r.days ? (r.flights / r.days).toFixed(1) : "—"}</div>
              <div style={{ padding: "9px 8px", fontSize: 13, textAlign: "right" }}>{formatMinutes(r.minutes)}</div>
              <div style={{ padding: "9px 8px", fontSize: 13, textAlign: "right", color: "rgba(232,244,253,0.7)" }}>{formatMinutes(r.minutes / r.flights)}</div>
            </div>
          ))}
          {pivot.rows.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1.4fr 1fr", background: "rgba(125,211,252,0.08)", minWidth: 480 }}>
              <div style={{ padding: "10px 8px", fontSize: 13, fontWeight: 800 }}>Gesamt</div>
              <div style={{ padding: "10px 8px", fontSize: 13, fontWeight: 800, textAlign: "right" }}>{pivot.total.flights}</div>
              <div style={{ padding: "10px 8px", fontSize: 13, fontWeight: 800, textAlign: "right" }}>{pivot.total.days}</div>
              <div style={{ padding: "10px 8px", fontSize: 13, fontWeight: 800, textAlign: "right" }}>{pivot.total.days ? (pivot.total.flights / pivot.total.days).toFixed(1) : "—"}</div>
              <div style={{ padding: "10px 8px", fontSize: 13, fontWeight: 800, textAlign: "right" }}>{formatMinutes(pivot.total.minutes)}</div>
              <div style={{ padding: "10px 8px", fontSize: 13, fontWeight: 800, textAlign: "right", color: "#7dd3fc" }}>{formatMinutes(pivot.total.minutes / pivot.total.flights)}</div>
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: "16px 16px 0" }}>
        <a href="index.html" style={{ display: "inline-block", fontSize: 12, color: "rgba(125,211,252,0.7)", textDecoration: "none" }}>← Zur Startseite</a>
      </div>
    </div>
  );
}
