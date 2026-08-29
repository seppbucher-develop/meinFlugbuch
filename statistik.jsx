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

// Leerer Filtersatz — Grundlage für eine Statistik-Ansicht, für die noch
// keine eigenen Filter gespeichert wurden.
function emptyFilterSet() {
  return { typ: [], reise: [], schirm: [], landeplatz: [], land: [], training: "alle" };
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

// ── Statistik-Ansichten ──────────────────────────────────────────────────
// Die Statistik-Seite ist in drei Auswertungen aufgeteilt, zwischen denen
// über VIEWS/ViewSwitcher gewechselt wird — alle drei teilen sich dieselbe
// FilterBar/gefilterte Flugliste (siehe StatistikApp), sind inhaltlich aber
// eigenständige Pivot-Tabellen: Übersicht (Jahr), Monatsübersicht
// (Jahr × Monat) und Reiseübersicht (Reise × Jahr).
const VIEWS = [
  { id: "uebersicht", label: "Übersicht" },
  { id: "monat", label: "Monatsübersicht" },
  { id: "reise", label: "Reiseübersicht" },
];

function ViewSwitcher({ view, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {VIEWS.map(v => (
        <button key={v.id} onClick={() => onChange(v.id)}
          style={{ flex: 1, background: view === v.id ? "rgba(125,211,252,0.18)" : "rgba(255,255,255,0.05)", border: `1px solid ${view === v.id ? "rgba(125,211,252,0.4)" : "rgba(255,255,255,0.1)"}`, borderRadius: 10, padding: "10px 6px", color: view === v.id ? "#7dd3fc" : "rgba(232,244,253,0.6)", fontSize: 12, fontWeight: view === v.id ? 700 : 400, cursor: "pointer" }}>
          {v.label}
        </button>
      ))}
    </div>
  );
}

// Filterleiste (Typ/Reise/Schirm/Landeplatz/Land/Training + Zurücksetzen) —
// von allen drei Auswertungen (Übersicht, Monats- und Reiseübersicht)
// gemeinsam genutzt, damit sie dieselbe Flugliste eingrenzen.
function FilterBar({
  typOptions, typF, setTypF, reiseOptions, reiseF, setReiseF,
  schirmOptions, schirmF, setSchirmF, landeplatzOptions, landeplatzF, setLandeplatzF,
  landOptions, landF, setLandF, trainingF, setTrainingF, anyFilterActive, resetFilters,
}) {
  return (
    <>
      <div style={{ padding: "0 16px 10px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
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
    </>
  );
}

const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

// Jahr/Monat-Pivot: Zeilen = Jahre, Spalten = Monate (Jan–Dez) + Total,
// Zellwert = Anzahl Flüge in diesem Jahr/Monat. Analog zur Jahres-Pivot in
// der Übersicht — nutzt dieselbe (bereits gefilterte) Flugliste.
function computeMonthPivot(flights) {
  const byYear = new Map(); // Jahr -> Array[12] mit Flugzahl je Monat
  for (const f of flights) {
    const parts = (f.date || "").split(".");
    const yr = (f.year || parts[2] || "").toString();
    const mo = parts.length === 3 ? parseInt(parts[1], 10) : NaN;
    if (!yr || !mo || mo < 1 || mo > 12) continue;
    if (!byYear.has(yr)) byYear.set(yr, Array(12).fill(0));
    byYear.get(yr)[mo - 1]++;
  }
  const rows = [...byYear.entries()]
    .map(([year, months]) => ({ year, months, total: months.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => a.year.localeCompare(b.year, "de", { numeric: true }));
  const monthTotals = Array(12).fill(0);
  rows.forEach(r => r.months.forEach((c, i) => { monthTotals[i] += c; }));
  const grandTotal = monthTotals.reduce((a, b) => a + b, 0);
  return { rows, monthTotals, grandTotal };
}

function MonthPivotTable({ flights }) {
  const pivot = React.useMemo(() => computeMonthPivot(flights), [flights]);
  const cols = `0.9fr repeat(12, 0.55fr) 0.7fr`;
  const minWidth = 620;
  return (
    <div style={{ padding: "0 16px" }}>
      <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, overflow: "hidden", overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, background: "rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.1)", minWidth }}>
          <div style={{ padding: "3px 6px", fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.5 }}>Jahr</div>
          {MONATE.map(m => (
            <div key={m} style={{ padding: "3px 3px", fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>{m}</div>
          ))}
          <div style={{ padding: "3px 6px", fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Total</div>
        </div>
        {pivot.rows.length === 0 && (
          <div style={{ padding: "24px 12px", textAlign: "center", fontSize: 13, color: "rgba(232,244,253,0.4)", minWidth }}>Keine Flüge für diese Filterauswahl.</div>
        )}
        {pivot.rows.map(r => (
          <div key={r.year} style={{ display: "grid", gridTemplateColumns: cols, borderBottom: "1px solid rgba(255,255,255,0.05)", minWidth }}>
            <div style={{ padding: "3px 6px", fontSize: 13, fontWeight: 700, color: "#7dd3fc" }}>{r.year}</div>
            {r.months.map((c, i) => (
              <div key={i} style={{ padding: "3px 3px", fontSize: 13, textAlign: "right", color: c ? "#e8f4fd" : "rgba(232,244,253,0.25)" }}>{c || "·"}</div>
            ))}
            <div style={{ padding: "3px 6px", fontSize: 13, textAlign: "right", fontWeight: 700, color: "rgba(232,244,253,0.8)" }}>{r.total}</div>
          </div>
        ))}
        {pivot.rows.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: cols, background: "rgba(125,211,252,0.08)", minWidth }}>
            <div style={{ padding: "3px 6px", fontSize: 13, fontWeight: 800 }}>Gesamt</div>
            {pivot.monthTotals.map((c, i) => (
              <div key={i} style={{ padding: "3px 3px", fontSize: 13, fontWeight: 800, textAlign: "right" }}>{c || "·"}</div>
            ))}
            <div style={{ padding: "3px 6px", fontSize: 13, fontWeight: 800, textAlign: "right", color: "#7dd3fc" }}>{pivot.grandTotal}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// Reise/Jahr-Pivot: Zeilen = Reise (customFields.reise), Spalten = Jahre
// (dynamisch, wie in der Jahres-Übersicht) + Total, Zellwert = Flugdauer
// (Summe durationSec) je Reise/Jahr-Kombination. Flüge ohne eingetragene
// Reise landen — analog zum Umgang mit fehlendem Jahr in der Jahres-Pivot —
// gesammelt in einer "—"-Zeile, statt stillschweigend zu verschwinden.
function computeReisePivot(flights) {
  const years = new Set();
  const byReise = new Map(); // Reise -> Map(Jahr -> Minuten)
  for (const f of flights) {
    const reise = (f.customFields?.reise || "").trim() || "—";
    const yr = (f.year || (f.date || "").split(".")[2] || "—").toString();
    years.add(yr);
    if (!byReise.has(reise)) byReise.set(reise, new Map());
    const m = byReise.get(reise);
    m.set(yr, (m.get(yr) || 0) + (f.durationSec || 0) / 60);
  }
  const yearList = [...years].sort((a, b) => a.localeCompare(b, "de", { numeric: true }));
  const rows = [...byReise.entries()]
    .map(([reise, m]) => {
      const minutesByYear = yearList.map(y => m.get(y) || 0);
      return { reise, minutesByYear, total: minutesByYear.reduce((a, b) => a + b, 0) };
    })
    .sort((a, b) => a.reise.localeCompare(b.reise, "de", { numeric: true }));
  const yearTotals = yearList.map((_, i) => rows.reduce((acc, r) => acc + r.minutesByYear[i], 0));
  const grandTotal = yearTotals.reduce((a, b) => a + b, 0);
  return { yearList, rows, yearTotals, grandTotal };
}

function ReisePivotTable({ flights }) {
  const pivot = React.useMemo(() => computeReisePivot(flights), [flights]);
  const cols = `1.1fr repeat(${pivot.yearList.length}, 0.8fr) 0.9fr`;
  const minWidth = 150 + pivot.yearList.length * 70 + 80;
  return (
    <div style={{ padding: "0 16px" }}>
      <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, overflow: "hidden", overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, background: "rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.1)", minWidth }}>
          <div style={{ padding: "3px 6px", fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.5 }}>Reise</div>
          {pivot.yearList.map(y => (
            <div key={y} style={{ padding: "3px 6px", fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>{y}</div>
          ))}
          <div style={{ padding: "3px 6px", fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Total</div>
        </div>
        {pivot.rows.length === 0 && (
          <div style={{ padding: "24px 12px", textAlign: "center", fontSize: 13, color: "rgba(232,244,253,0.4)", minWidth }}>Keine Flüge für diese Filterauswahl.</div>
        )}
        {pivot.rows.map(r => (
          <div key={r.reise} style={{ display: "grid", gridTemplateColumns: cols, borderBottom: "1px solid rgba(255,255,255,0.05)", minWidth }}>
            <div style={{ padding: "3px 6px", fontSize: 13, fontWeight: 700, color: "#7dd3fc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.reise}</div>
            {r.minutesByYear.map((min, i) => (
              <div key={i} style={{ padding: "3px 6px", fontSize: 13, textAlign: "right", color: min ? "#e8f4fd" : "rgba(232,244,253,0.25)" }}>{min ? formatMinutes(min) : "·"}</div>
            ))}
            <div style={{ padding: "3px 6px", fontSize: 13, textAlign: "right", fontWeight: 700, color: "rgba(232,244,253,0.8)" }}>{formatMinutes(r.total)}</div>
          </div>
        ))}
        {pivot.rows.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: cols, background: "rgba(125,211,252,0.08)", minWidth }}>
            <div style={{ padding: "3px 6px", fontSize: 13, fontWeight: 800 }}>Gesamt</div>
            {pivot.yearTotals.map((min, i) => (
              <div key={i} style={{ padding: "3px 6px", fontSize: 13, fontWeight: 800, textAlign: "right" }}>{min ? formatMinutes(min) : "·"}</div>
            ))}
            <div style={{ padding: "3px 6px", fontSize: 13, fontWeight: 800, textAlign: "right", color: "#7dd3fc" }}>{formatMinutes(pivot.grandTotal)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Maximalwerte ─────────────────────────────────────────────────────────
// Persönliche Rekorde über die (gefilterte) Flugliste. getValue liest sowohl
// aus IGC-Flügen (f.maxAlt, f.totalDist, …) als auch aus manuell erfassten
// Flügen (customFields-Fallbacks) — dieselben Fallback-Ketten wie an den
// entsprechenden Stellen in flugbuch.jsx.
const MAX_STATS = [
  {
    id: "dauer", label: "Längster Flug", icon: "⏱",
    getValue: f => f.durationSec || 0,
    format: v => formatMinutes(v / 60),
  },
  {
    id: "distanz", label: "Weitester Flug", icon: "📏",
    getValue: f => f.totalDist || parseFloat(f.customFields?.distKm || f.customFields?.dk || 0) || 0,
    format: v => v.toFixed(1).replace(".", ",") + " km",
  },
  {
    id: "maxspeed", label: "Schnellster Flug", icon: "⚡",
    getValue: f => f.maxSpeedKmh || 0,
    format: v => v.toFixed(1).replace(".", ",") + " km/h",
  },
  {
    id: "hoehe", label: "Höchster Flug", icon: "⛰",
    getValue: f => f.maxAlt || +(f.customFields?.hMax || f.customFields?.hm || 0) || 0,
    format: v => Math.round(v) + " m",
  },
  {
    id: "hgew", label: "Größter Höhengewinn", icon: "🚀",
    getValue: f => +(f.customFields?.hGew || 0) || 0,
    format: v => Math.round(v) + " m",
  },
];

// Top 20 (absteigend) für eine Maximalwert-Kategorie — Flüge ohne diesen
// Wert (z.B. hGew bei manuell erfassten Flügen ohne IGC-Track) werden nicht
// mitgezählt, statt fälschlich als "0 m" mitzulaufen.
function rankFlights(flights, stat) {
  return flights
    .map(f => ({ flight: f, value: stat.getValue(f) }))
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 20);
}

function TopFlightsModal({ stat, ranked, onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 480, maxHeight: "80vh", overflowY: "auto", background: "#0f1f33", borderTop: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px 16px 0 0", padding: "16px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{stat.icon} Top 20 — {stat.label}</div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 8, width: 28, height: 28, color: "#e8f4fd", fontSize: 15, cursor: "pointer" }}>✕</button>
        </div>
        {ranked.length === 0 && (
          <div style={{ padding: "20px 4px", fontSize: 13, color: "rgba(232,244,253,0.4)", textAlign: "center" }}>Keine Flüge mit diesem Wert vorhanden.</div>
        )}
        {ranked.map((r, i) => (
          // Flugname (enthält nur die fortlaufende Flugnummer, z.B. "Flug 42")
          // bewusst weggelassen — Datum + Startplatz (+ Land, falls erfasst)
          // identifizieren den Flug aussagekräftiger.
          <a key={r.flight.id} href={`flugbuch.html?openFlightId=${encodeURIComponent(r.flight.id)}`}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "3px 4px", borderBottom: i < ranked.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none", textDecoration: "none", color: "inherit" }}>
            <div style={{ flexShrink: 0, width: 22, textAlign: "center", fontSize: 12, fontWeight: 800, color: i === 0 ? "#fcd34d" : "rgba(232,244,253,0.4)" }}>{i + 1}</div>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.flight.date} · {r.flight.site || "—"}{r.flight.customFields?.land ? ` · ${r.flight.customFields.land}` : ""}</div>
            <div style={{ flexShrink: 0, fontSize: 13, fontWeight: 700, color: "#7dd3fc" }}>{stat.format(r.value)}</div>
          </a>
        ))}
      </div>
    </div>
  );
}

function MaxStatsSection({ flights }) {
  const [openStatId, setOpenStatId] = React.useState(null);
  const ranked = React.useMemo(() => {
    const m = {};
    MAX_STATS.forEach(s => { m[s.id] = rankFlights(flights, s); });
    return m;
  }, [flights]);
  const openStat = MAX_STATS.find(s => s.id === openStatId) || null;

  return (
    <div style={{ padding: "4px 16px 14px" }}>
      <div style={{ fontSize: 10, color: "rgba(232,244,253,0.4)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Maximalwerte</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {MAX_STATS.map(s => {
          const best = ranked[s.id][0];
          return (
            <button key={s.id} onClick={() => best && setOpenStatId(s.id)}
              disabled={!best}
              style={{ textAlign: "left", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "10px 12px", cursor: best ? "pointer" : "default", opacity: best ? 1 : 0.5 }}>
              <div style={{ fontSize: 11, color: "rgba(232,244,253,0.5)", marginBottom: 4 }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#7dd3fc" }}>{best ? s.format(best.value) : "—"}</div>
              <div style={{ fontSize: 11, color: "rgba(232,244,253,0.4)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {best ? `${best.flight.date} · ${best.flight.site || "—"}` : "Keine Daten"}
              </div>
            </button>
          );
        })}
      </div>
      {openStat && <TopFlightsModal stat={openStat} ranked={ranked[openStat.id]} onClose={() => setOpenStatId(null)} />}
    </div>
  );
}

// ── TEMPORÄR: Typ-Diagnose ───────────────────────────────────────────────
// Debug-Hilfsmittel zur Untersuchung der Diskrepanz zwischen Flugbuch- und
// Statistik-Flugzahl bei aktivem Typ-Filter (siehe Chat vom 2026-08-29).
// Gruppiert alle Flüge nach dem exakten, ungetrimmten Rohwert von
// customFields.typ (via JSON.stringify), damit unsichtbare Abweichungen
// (Groß-/Kleinschreibung, führende/eingebettete Leerzeichen) auffallen,
// die beim Filtern nach "GS" ansonsten stillschweigend durchfallen.
// Nach Abschluss der Diagnose wieder entfernen: diese Funktion,
// TypDebugPanel, den State/Button in StatistikApp und diesen Kommentar.
function computeTypDebugGroups(flights) {
  const groups = new Map();
  flights.forEach(f => {
    const raw = f.customFields?.typ;
    const key = JSON.stringify(raw);
    if (!groups.has(key)) groups.set(key, { raw, count: 0, samples: [] });
    const g = groups.get(key);
    g.count++;
    if (g.samples.length < 8) g.samples.push(f);
  });
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function TypDebugPanel({ flights, onClose }) {
  const groups = React.useMemo(() => computeTypDebugGroups(flights), [flights]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 480, maxHeight: "80vh", overflowY: "auto", background: "#0f1f33", borderTop: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px 16px 0 0", padding: "16px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>🐞 Typ-Diagnose</div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 8, width: 28, height: 28, color: "#e8f4fd", fontSize: 15, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: "rgba(232,244,253,0.45)", marginBottom: 12 }}>
          {flights.length} Flüge insgesamt · customFields.typ gruppiert nach exaktem Rohwert (JSON.stringify macht Leerzeichen/Groß-Klein-Unterschiede sichtbar). Rot = weicht von "GS" ab.
        </div>
        {groups.map((g, i) => {
          const trimmed = (g.raw || "").trim();
          const isGS = trimmed === "GS";
          return (
            <div key={i} style={{ padding: "8px 4px", borderBottom: i < groups.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, fontWeight: 700 }}>
                <span style={{ color: isGS ? "#7dd3fc" : "#f87171", fontFamily: "monospace" }}>{JSON.stringify(g.raw)}</span>
                <span style={{ color: "rgba(232,244,253,0.6)" }}>{g.count}×</span>
              </div>
              {!isGS && (
                <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {g.samples.map(f => (
                    <a key={f.id} href={`flugbuch.html?openFlightId=${encodeURIComponent(f.id)}`}
                      style={{ fontSize: 11, color: "#7dd3fc", textDecoration: "none", background: "rgba(125,211,252,0.1)", borderRadius: 6, padding: "2px 6px" }}>
                      {f.date}
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatistikApp() {
  const [flights, setFlights] = React.useState(null); // null = noch am Laden
  const [typDebugOpen, setTypDebugOpen] = React.useState(false); // TEMPORÄR — Typ-Diagnose, siehe TypDebugPanel

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

  // Welche der drei Statistik-Ansichten (siehe VIEWS) gerade aktiv ist.
  const [view, setView] = React.useState("uebersicht");

  const [typF, setTypF] = React.useState(new Set());
  const [reiseF, setReiseF] = React.useState(new Set());
  const [schirmF, setSchirmF] = React.useState(new Set());
  const [landeplatzF, setLandeplatzF] = React.useState(new Set());
  const [landF, setLandF] = React.useState(new Set());
  const [trainingF, setTrainingF] = React.useState("alle");

  // Jede der drei Ansichten hat ihre eigenen Filter (z.B. "Übersicht" nach
  // Schirm gefiltert, "Reiseübersicht" ungefiltert) — filtersMapRef hält
  // alle drei Filtersätze { uebersicht, monat, reise } im Speicher, die
  // React-State-Variablen oben (typF, reiseF, …) spiegeln jeweils nur den
  // Filtersatz der gerade aktiven Ansicht. Beim Wechsel der Ansicht wird der
  // bisherige Stand hier gesichert und der Satz der Zielansicht geladen.
  const filtersMapRef = React.useRef({ uebersicht: emptyFilterSet(), monat: emptyFilterSet(), reise: emptyFilterSet() });
  const applyFilterSet = (f) => {
    setTypF(new Set(f.typ || []));
    setReiseF(new Set(f.reise || []));
    setSchirmF(new Set(f.schirm || []));
    setLandeplatzF(new Set(f.landeplatz || []));
    setLandF(new Set(f.land || []));
    setTrainingF(f.training || "alle");
  };
  const snapshotFilterState = () => ({
    typ: [...typF], reise: [...reiseF], schirm: [...schirmF],
    landeplatz: [...landeplatzF], land: [...landF], training: trainingF,
  });

  // Restauriert die zuletzt verwendete Ansicht + deren Filter beim Öffnen
  // der Seite — statistik.html ist eine eigene Seite (volle Navigation,
  // kein client-seitiges Routing), daher setzt React-State bei jedem
  // Aufruf sonst wieder auf die Standardwerte zurück. settingsLoaded
  // verhindert, dass der Persistierungs-Effekt unten die gerade erst
  // geladenen Filter sofort wieder mit den (noch leeren) Default-Werten
  // überschreibt.
  const [settingsLoaded, setSettingsLoaded] = React.useState(false);
  const filtersReadyRef = React.useRef(false);
  React.useEffect(() => {
    (async () => {
      let loadedView = "uebersicht";
      try {
        const rv = await window.storage.get("statistikView");
        if (rv && rv.value && VIEWS.some(v => v.id === rv.value)) loadedView = rv.value;
      } catch (e) {}
      try {
        const rf = await window.storage.get("statistikFilters");
        if (rf && rf.value) {
          const parsed = JSON.parse(rf.value);
          if (parsed && (Array.isArray(parsed.typ) || Array.isArray(parsed.schirm) || parsed.training)) {
            // Altformat: ein einziger, von allen Ansichten geteilter
            // Filtersatz (vor der Umstellung auf pro-Ansicht-Filter) — als
            // Startwert für alle drei Ansichten übernehmen, statt ihn zu
            // verwerfen.
            const migrated = { ...emptyFilterSet(), ...parsed };
            filtersMapRef.current = { uebersicht: migrated, monat: { ...migrated }, reise: { ...migrated } };
          } else if (parsed && typeof parsed === "object") {
            filtersMapRef.current = {
              uebersicht: { ...emptyFilterSet(), ...(parsed.uebersicht || {}) },
              monat: { ...emptyFilterSet(), ...(parsed.monat || {}) },
              reise: { ...emptyFilterSet(), ...(parsed.reise || {}) },
            };
          }
        }
      } catch (e) { /* noch nichts gespeichert, oder Storage nicht verfügbar */ }
      setView(loadedView);
      applyFilterSet(filtersMapRef.current[loadedView]);
      setSettingsLoaded(true);
    })();
  }, []);

  // Ein Ansichtswechsel tauscht die Filter-States auf die (potenziell ganz
  // anderen) gespeicherten Werte der Zielansicht aus — das darf den
  // Persistierungs-Effekt unten nicht als "Nutzer hat Filter geändert" mit
  // backupDirty=1 quittieren, es ist reine Navigation. isSwitchingViewRef
  // markiert genau diesen einen, durch changeView ausgelösten Render.
  const isSwitchingViewRef = React.useRef(false);
  const changeView = (id) => {
    if (id === view) return;
    // Filter der bisherigen Ansicht sichern, dann die der Zielansicht laden.
    const nextMap = { ...filtersMapRef.current, [view]: snapshotFilterState() };
    filtersMapRef.current = nextMap;
    isSwitchingViewRef.current = true;
    applyFilterSet(nextMap[id] || emptyFilterSet());
    setView(id);
    try {
      window.storage.set("statistikView", id);
      window.storage.set("statistikFilters", JSON.stringify(nextMap));
    } catch (e) {}
  };

  React.useEffect(() => {
    if (!settingsLoaded) return; // nicht speichern, bevor das Laden fertig ist
    if (isSwitchingViewRef.current) {
      // Nur der durch changeView ausgelöste Render — Speichern ist dort
      // bereits passiert, hier nur das Flag zurücksetzen.
      isSwitchingViewRef.current = false;
      return;
    }
    try {
      filtersMapRef.current = { ...filtersMapRef.current, [view]: snapshotFilterState() };
      window.storage.set("statistikFilters", JSON.stringify(filtersMapRef.current));
      // Nur bei echten, vom Nutzer ausgelösten Filteränderungen als
      // "ungesichert" markieren — nicht schon beim ersten Schreiben direkt
      // nach dem Laden der zuvor gespeicherten Werte (das wäre keine
      // Änderung, nur ein Wiederherstellen des letzten Zustands).
      if (filtersReadyRef.current) {
        window.storage.set("settings:backupDirty", "1");
      } else {
        filtersReadyRef.current = true;
      }
    } catch (e) {}
  }, [settingsLoaded, view, typF, reiseF, schirmF, landeplatzF, landF, trainingF]);

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
    return <div style={{ padding: 24, color: "rgba(232,244,253,0.5)", fontFamily: "system-ui,sans-serif" }}>Lade Flüge…</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#040e20", color: "#e8f4fd", fontFamily: "system-ui,sans-serif", paddingBottom: 40 }}>
      <div style={{ padding: "calc(18px + env(safe-area-inset-top, 0px)) 16px 6px", display: "flex", alignItems: "center", gap: 10 }}>
        <a href="index.html" style={{ color: "#7dd3fc", fontSize: 24, textDecoration: "none", flexShrink: 0, lineHeight: 1 }}>‹</a>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(232,244,253,0.4)", marginBottom: 2 }}>Flugbuch</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px" }}>Statistik</h1>
          <div style={{ fontSize: 12, color: "rgba(232,244,253,0.45)" }}>{all.length} Flüge insgesamt · {filtered.length} nach Filter</div>
        </div>
      </div>

      {/* TEMPORÄR — Typ-Diagnose-Button, siehe TypDebugPanel oben; nach Klärung wieder entfernen */}
      <div style={{ padding: "0 16px 4px" }}>
        <button onClick={() => setTypDebugOpen(true)}
          style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 8, padding: "6px 10px", color: "#f87171", fontSize: 11, cursor: "pointer" }}>
          🐞 Typ-Diagnose (temporär)
        </button>
      </div>
      {typDebugOpen && <TypDebugPanel flights={all} onClose={() => setTypDebugOpen(false)} />}

      <div style={{ padding: "4px 16px 14px" }}>
        <ViewSwitcher view={view} onChange={changeView} />
      </div>

      {(view === "uebersicht" || view === "monat" || view === "reise") && (
        <FilterBar
          typOptions={typOptions} typF={typF} setTypF={setTypF}
          reiseOptions={reiseOptions} reiseF={reiseF} setReiseF={setReiseF}
          schirmOptions={schirmOptions} schirmF={schirmF} setSchirmF={setSchirmF}
          landeplatzOptions={landeplatzOptions} landeplatzF={landeplatzF} setLandeplatzF={setLandeplatzF}
          landOptions={landOptions} landF={landF} setLandF={setLandF}
          trainingF={trainingF} setTrainingF={setTrainingF}
          anyFilterActive={anyFilterActive} resetFilters={resetFilters}
        />
      )}

      {view === "uebersicht" && (
        <>
          <MaxStatsSection flights={filtered} />

          <div style={{ padding: "0 16px" }}>
            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, overflow: "hidden", overflowX: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "0.8fr 0.8fr 0.8fr 0.9fr 1.1fr 0.9fr", background: "rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.1)", minWidth: 400 }}>
                {["Jahr", "Flüge", "Tage", "Flüge/Tag", "Minuten", "Schnitt"].map((h, i) => (
                  <div key={h} style={{ padding: "3px 6px", fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.5, textAlign: i === 0 ? "left" : "right" }}>{h}</div>
                ))}
              </div>
              {pivot.rows.length === 0 && (
                <div style={{ padding: "24px 12px", textAlign: "center", fontSize: 13, color: "rgba(232,244,253,0.4)" }}>Keine Flüge für diese Filterauswahl.</div>
              )}
              {pivot.rows.map(r => (
                <div key={r.year} style={{ display: "grid", gridTemplateColumns: "0.8fr 0.8fr 0.8fr 0.9fr 1.1fr 0.9fr", borderBottom: "1px solid rgba(255,255,255,0.05)", minWidth: 400 }}>
                  <div style={{ padding: "3px 6px", fontSize: 13, fontWeight: 700, color: "#7dd3fc" }}>{r.year}</div>
                  <div style={{ padding: "3px 6px", fontSize: 13, textAlign: "right" }}>{r.flights}</div>
                  <div style={{ padding: "3px 6px", fontSize: 13, textAlign: "right" }}>{r.days}</div>
                  <div style={{ padding: "3px 6px", fontSize: 13, textAlign: "right", color: "rgba(232,244,253,0.7)" }}>{r.days ? (r.flights / r.days).toFixed(1) : "—"}</div>
                  <div style={{ padding: "3px 6px", fontSize: 13, textAlign: "right" }}>{formatMinutes(r.minutes)}</div>
                  <div style={{ padding: "3px 6px", fontSize: 13, textAlign: "right", color: "rgba(232,244,253,0.7)" }}>{formatMinutes(r.minutes / r.flights)}</div>
                </div>
              ))}
              {pivot.rows.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "0.8fr 0.8fr 0.8fr 0.9fr 1.1fr 0.9fr", background: "rgba(125,211,252,0.08)", minWidth: 400 }}>
                  <div style={{ padding: "3px 6px", fontSize: 13, fontWeight: 800 }}>Gesamt</div>
                  <div style={{ padding: "3px 6px", fontSize: 13, fontWeight: 800, textAlign: "right" }}>{pivot.total.flights}</div>
                  <div style={{ padding: "3px 6px", fontSize: 13, fontWeight: 800, textAlign: "right" }}>{pivot.total.days}</div>
                  <div style={{ padding: "3px 6px", fontSize: 13, fontWeight: 800, textAlign: "right" }}>{pivot.total.days ? (pivot.total.flights / pivot.total.days).toFixed(1) : "—"}</div>
                  <div style={{ padding: "3px 6px", fontSize: 13, fontWeight: 800, textAlign: "right" }}>{formatMinutes(pivot.total.minutes)}</div>
                  <div style={{ padding: "3px 6px", fontSize: 13, fontWeight: 800, textAlign: "right", color: "#7dd3fc" }}>{formatMinutes(pivot.total.minutes / pivot.total.flights)}</div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {view === "monat" && <MonthPivotTable flights={filtered} />}

      {view === "reise" && <ReisePivotTable flights={filtered} />}
    </div>
  );
}
