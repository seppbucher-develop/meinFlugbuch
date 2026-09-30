// ── Statistik / Übersicht ────────────────────────────────────────────────
// Eigenständige Seite (analog "Reisen") — liest dieselben Flugdaten wie
// flugbuch.jsx aus derselben IndexedDB (siehe Storage-Shim in
// statistik.html, identisch zu flugbuch.html), zeigt aber keine
// Bearbeitungsfunktion, nur eine Jahres-Pivot mit Mehrfach-Filtern, analog
// zur "Übersicht"-Pivot-Tabelle aus der ursprünglichen Excel-Datei.

// Style-Fragment für die erste Spalte der Pivot-Tabellen: bleibt beim
// horizontalen Scrollen der Tabelle (overflowX: auto) sichtbar. bg muss
// deckend sein, statt die rgba-Zeilenfarbe zu übernehmen — sonst würden die
// darunterliegenden Spalten beim Scrollen durch die sticky Zelle
// durchscheinen. Die Werte sind die jeweilige rgba-Zeilenfarbe, flach über
// den Seitenhintergrund #040e20 gerechnet.
function stickyCol(bg) {
  return { position: "sticky", left: 0, zIndex: 1, background: bg, boxShadow: "2px 0 4px rgba(0,0,0,0.25)" };
}
const STICKY_BG_HEADER = "#111a2b"; // rgba(255,255,255,0.05) über #040e20
const STICKY_BG_ROW = "#040e20";    // unveränderte Zeile (Seitenhintergrund)
const STICKY_BG_TOTAL = "#0e1e32";  // rgba(125,211,252,0.08) über #040e20

// Style-Fragment für die Kopfzeile der Pivot-Tabellen: bleibt beim
// vertikalen Scrollen (Tabellen-Container mit overflowY: auto + maxHeight)
// oben sichtbar. zIndex muss über der sticky-Spalte der Datenzeilen liegen,
// sonst würde deren linke Spalte beim Scrollen über der Kopfzeile landen
// (die Kopfzeile kommt im DOM zuerst, positionierte Elemente ohne höheren
// zIndex würden sonst darunter gemalt).
function stickyHeaderRow() {
  return { position: "sticky", top: 0, zIndex: 3 };
}

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
  { id: "reiseanalyse", label: "Reiseanalyse" },
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
      <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, overflow: "hidden", overflowX: "auto", overflowY: "auto", maxHeight: "60vh" }}>
        <div style={{ ...stickyHeaderRow(), display: "grid", gridTemplateColumns: cols, background: STICKY_BG_HEADER, borderBottom: "1px solid rgba(255,255,255,0.1)", minWidth }}>
          <div style={{ ...stickyCol(STICKY_BG_HEADER), padding: "3px 6px", fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.5 }}>Jahr</div>
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
            <div style={{ ...stickyCol(STICKY_BG_ROW), padding: "3px 6px", fontSize: 13, fontWeight: 700, color: "#7dd3fc" }}>{r.year}</div>
            {r.months.map((c, i) => (
              <div key={i} style={{ padding: "3px 3px", fontSize: 13, textAlign: "right", color: c ? "#e8f4fd" : "rgba(232,244,253,0.25)" }}>{c || "·"}</div>
            ))}
            <div style={{ padding: "3px 6px", fontSize: 13, textAlign: "right", fontWeight: 700, color: "rgba(232,244,253,0.8)" }}>{r.total}</div>
          </div>
        ))}
        {pivot.rows.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: cols, background: "rgba(125,211,252,0.08)", minWidth }}>
            <div style={{ ...stickyCol(STICKY_BG_TOTAL), padding: "3px 6px", fontSize: 13, fontWeight: 800 }}>Gesamt</div>
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
  // Feste fr-Spaltenbreiten + minWidth (statt minmax(0, …fr) wie in der
  // Übersicht): die Spaltenzahl ist hier datengetrieben (ein Jahr pro
  // Spalte) und bei vielen Jahren gäbe ein Schrumpfen-auf-Bildschirmbreite
  // nur noch unlesbare, auf ein paar Pixel gequetschte Ellipsis-Werte.
  // Stattdessen bleiben die Spalten lesbar breit und die Tabelle scrollt
  // horizontal (erste Spalte bleibt dabei sticky, siehe stickyCol).
  const cols = `1.1fr repeat(${pivot.yearList.length}, 0.8fr) 0.9fr`;
  const minWidth = 150 + pivot.yearList.length * 70 + 80;
  return (
    <div style={{ padding: "0 16px" }}>
      <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, overflow: "hidden", overflowX: "auto", overflowY: "auto", maxHeight: "60vh" }}>
        <div style={{ ...stickyHeaderRow(), display: "grid", gridTemplateColumns: cols, background: STICKY_BG_HEADER, borderBottom: "1px solid rgba(255,255,255,0.1)", minWidth }}>
          <div style={{ ...stickyCol(STICKY_BG_HEADER), padding: "3px 6px", fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.5 }}>Reise</div>
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
            <div style={{ ...stickyCol(STICKY_BG_ROW), padding: "3px 6px", fontSize: 13, fontWeight: 700, color: "#7dd3fc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.reise}</div>
            {r.minutesByYear.map((min, i) => (
              <div key={i} style={{ padding: "3px 6px", fontSize: 13, textAlign: "right", color: min ? "#e8f4fd" : "rgba(232,244,253,0.25)" }}>{min ? Math.round(min) : "·"}</div>
            ))}
            <div style={{ padding: "3px 6px", fontSize: 13, textAlign: "right", fontWeight: 700, color: "rgba(232,244,253,0.8)" }}>{Math.round(r.total)}</div>
          </div>
        ))}
        {pivot.rows.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: cols, background: "rgba(125,211,252,0.08)", minWidth }}>
            <div style={{ ...stickyCol(STICKY_BG_TOTAL), padding: "3px 6px", fontSize: 13, fontWeight: 800 }}>Gesamt</div>
            {pivot.yearTotals.map((min, i) => (
              <div key={i} style={{ padding: "3px 6px", fontSize: 13, fontWeight: 800, textAlign: "right" }}>{min ? Math.round(min) : "·"}</div>
            ))}
            <div style={{ padding: "3px 6px", fontSize: 13, fontWeight: 800, textAlign: "right", color: "#7dd3fc" }}>{Math.round(pivot.grandTotal)}</div>
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

// Jahres-Pivot der "Übersicht"-Ansicht: Zeilen = Jahre, Spalten = Flüge /
// Tage / Flüge-pro-Tag / Minuten / Schnitt. minmax(0, …fr) statt fester
// fr-Werte lässt die Spalten unter ihre Inhaltsbreite schrumpfen (Grid-
// Spalten haben sonst implizit min-width: auto), damit die Tabelle auch auf
// schmalen Bildschirmen (z.B. S25 Ultra) ohne horizontales Scrollen in die
// verfügbare Breite passt — Zellinhalte kürzen stattdessen per Ellipsis.
function UebersichtPivotTable({ pivot }) {
  const cols = "minmax(0,0.7fr) minmax(0,0.55fr) minmax(0,0.55fr) minmax(0,0.75fr) minmax(0,1.05fr) minmax(0,0.95fr)";
  const cellStyle = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  return (
    <div style={{ padding: "0 16px" }}>
      <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, overflow: "hidden", overflowY: "auto", maxHeight: "60vh" }}>
        <div style={{ ...stickyHeaderRow(), display: "grid", gridTemplateColumns: cols, background: STICKY_BG_HEADER, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          {["Jahr", "Flüge", "Tage", "Flüge/Tag", "Minuten", "Schnitt"].map((h, i) => (
            <div key={h} style={{ ...(i === 0 ? stickyCol(STICKY_BG_HEADER) : {}), ...cellStyle, padding: "3px 4px", fontSize: 10, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.3, textAlign: i === 0 ? "left" : "right" }}>{h}</div>
          ))}
        </div>
        {pivot.rows.length === 0 && (
          <div style={{ padding: "24px 12px", textAlign: "center", fontSize: 13, color: "rgba(232,244,253,0.4)" }}>Keine Flüge für diese Filterauswahl.</div>
        )}
        {pivot.rows.map(r => (
          <div key={r.year} style={{ display: "grid", gridTemplateColumns: cols, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ ...stickyCol(STICKY_BG_ROW), ...cellStyle, padding: "3px 4px", fontSize: 12, fontWeight: 700, color: "#7dd3fc" }}>{r.year}</div>
            <div style={{ ...cellStyle, padding: "3px 4px", fontSize: 12, textAlign: "right" }}>{r.flights}</div>
            <div style={{ ...cellStyle, padding: "3px 4px", fontSize: 12, textAlign: "right" }}>{r.days}</div>
            <div style={{ ...cellStyle, padding: "3px 4px", fontSize: 12, textAlign: "right", color: "rgba(232,244,253,0.7)" }}>{r.days ? (r.flights / r.days).toFixed(1) : "—"}</div>
            <div style={{ ...cellStyle, padding: "3px 4px", fontSize: 12, textAlign: "right" }}>{formatMinutes(r.minutes)}</div>
            <div style={{ ...cellStyle, padding: "3px 4px", fontSize: 12, textAlign: "right", color: "rgba(232,244,253,0.7)" }}>{formatMinutes(r.minutes / r.flights)}</div>
          </div>
        ))}
        {pivot.rows.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: cols, background: "rgba(125,211,252,0.08)" }}>
            <div style={{ ...stickyCol(STICKY_BG_TOTAL), ...cellStyle, padding: "3px 4px", fontSize: 12, fontWeight: 800 }}>Gesamt</div>
            <div style={{ ...cellStyle, padding: "3px 4px", fontSize: 12, fontWeight: 800, textAlign: "right" }}>{pivot.total.flights}</div>
            <div style={{ ...cellStyle, padding: "3px 4px", fontSize: 12, fontWeight: 800, textAlign: "right" }}>{pivot.total.days}</div>
            <div style={{ ...cellStyle, padding: "3px 4px", fontSize: 12, fontWeight: 800, textAlign: "right" }}>{pivot.total.days ? (pivot.total.flights / pivot.total.days).toFixed(1) : "—"}</div>
            <div style={{ ...cellStyle, padding: "3px 4px", fontSize: 12, fontWeight: 800, textAlign: "right" }}>{formatMinutes(pivot.total.minutes)}</div>
            <div style={{ ...cellStyle, padding: "3px 4px", fontSize: 12, fontWeight: 800, textAlign: "right", color: "#7dd3fc" }}>{formatMinutes(pivot.total.minutes / pivot.total.flights)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reiseanalyse ─────────────────────────────────────────────────────────
// Vierte Statistik-Ansicht: liest pistazienfarbige Termine aus dem Google
// Kalender des Nutzers per OAuth (Google Identity Services, siehe
// statistik.html) und wertet sie als "Reisen" aus — unabhängig vom
// (optionalen) "Reise"-Feld der einzelnen Flüge in flugbuch.jsx. Pro
// Kalendereintrag: Reisetage = Zeitspanne des Termins, Flugminuten = Summe
// der Flüge, deren Datum in diese Zeitspanne fällt. Ergebnis wird lokal
// zwischengespeichert (reiseanalyse:tripsCache), damit die Seite auch ohne
// erneute Google-Anmeldung sofort den letzten Stand zeigt.
//
// "Pistazie" ist ein Termin per eigener Farbe ODER — wenn ein Termin gar
// keine eigene Farbe trägt (häufiger Fall: der Nutzer hat nur die Farbe
// eines ganzen, dedizierten "Reisen"-Kalenders auf Pistazie gestellt,
// statt jeden Termin einzeln einzufärben) — jeder nicht abgesagte Termin in
// einem Kalender, dessen eigene Hintergrundfarbe pistazienfarben ist.
// Durchsucht werden dafür standardmässig ALLE Kalender des Kontos (nicht
// nur "primary"), da der Reisen-Kalender meist ein separater, sekundärer
// Kalender ist — außer settings:googleCalendarId ist explizit auf eine
// bestimmte Kalender-ID gesetzt.
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const PISTACHIO_EVENT_COLOR_ID = "10"; // alte 11er-Terminfarbpalette, dort "Basil" genannt
const PISTACHIO_HEX = ["#7bd148", "#0b8043"]; // neuere ~24er-Palette "Pistachio" + alte Palette "Basil", je nach dem, welche Google gerade fürs Konto anzeigt
const REISEANALYSE_START_YEAR = 2024;
const DAY_MS = 24 * 3600 * 1000;

function isPistachioHex(hex) {
  return !!hex && PISTACHIO_HEX.includes(hex.toLowerCase());
}

// Holt alle Kalender, auf die der Nutzer lesend zugreifen kann (eigene und
// mit ihm geteilte, ohne reine Verfügbarkeits-Kalender ohne Termindetails).
async function fetchCalendarList(accessToken) {
  const resp = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Google Kalenderliste: HTTP ${resp.status}${body ? " — " + body.slice(0, 200) : ""}`);
  }
  const data = await resp.json();
  return (data.items || []).filter(c => c.accessRole !== "freeBusyReader");
}

// Wartet darauf, dass das per <script> in statistik.html geladene Google
// Identity Services SDK bereit ist — das Script lädt async/defer, kann also
// beim ersten Aufruf der Reiseanalyse-Ansicht noch nicht fertig sein.
function loadGsiScript() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    (function poll() {
      if (window.google?.accounts?.oauth2) { resolve(); return; }
      if (Date.now() > deadline) { reject(new Error("Google Identitätsdienst konnte nicht geladen werden (accounts.google.com blockiert?).")); return; }
      setTimeout(poll, 150);
    })();
  });
}

// dd.mm.yyyy (Flugbuch-Datumsformat, siehe flugbuch.jsx) → UTC-Millisekunden
// um Mitternacht, oder null bei fehlendem/ungültigem Datum.
function parseFlightDateUTC(f) {
  const parts = (f.date || "").split(".");
  if (parts.length !== 3) return null;
  const d = parseInt(parts[0], 10), m = parseInt(parts[1], 10), y = parseInt(parts[2], 10);
  if (!d || !m || !y) return null;
  return Date.UTC(y, m - 1, d);
}
function tripStartUTC(trip) {
  const [y, m, d] = trip.startDate.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
// Exklusives Ende (erster Tag NACH der Reise) — bei ganztägigen Google-
// Kalendereinträgen ist end.date bereits exklusiv definiert, bei
// Termine-mit-Uhrzeit wird der Enddatums-Tag noch mitgezählt (+1 Tag).
function tripEndExclusiveUTC(trip) {
  const [y, m, d] = trip.endDate.split("-").map(Number);
  let t = Date.UTC(y, m - 1, d);
  if (!trip.allDay) t += DAY_MS;
  return t;
}
// Anzahl Tage einer Reise, die in ein bestimmtes Kalenderjahr fallen (bei
// Reisen über den Jahreswechsel hinweg auf das jeweilige Jahr geclippt).
function daysOfTripInYear(trip, year) {
  const start = tripStartUTC(trip), endEx = tripEndExclusiveUTC(trip);
  const yearStart = Date.UTC(year, 0, 1), yearEndEx = Date.UTC(year + 1, 0, 1);
  const clipStart = Math.max(start, yearStart), clipEnd = Math.min(endEx, yearEndEx);
  return Math.max(0, Math.round((clipEnd - clipStart) / DAY_MS));
}
function formatTripRange(startDate, endDate) {
  const fmt = s => { const [y, m, d] = s.split("-"); return `${d}.${m}.${y}`; };
  return startDate === endDate ? fmt(startDate) : `${fmt(startDate)} – ${fmt(endDate)}`;
}

// Termine eines einzelnen Kalenders ab REISEANALYSE_START_YEAR (Pagination
// über nextPageToken, falls nötig — die Events-API kennt keine
// serverseitige Farbfilterung, daher wird komplett geladen und hier
// gefiltert).
async function fetchCalendarEvents(accessToken, calendarId) {
  const events = [];
  let pageToken;
  do {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("timeMin", `${REISEANALYSE_START_YEAR}-01-01T00:00:00Z`);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "2500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Google Kalender API (${calendarId}): HTTP ${resp.status}${body ? " — " + body.slice(0, 200) : ""}`);
    }
    const data = await resp.json();
    events.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return events;
}

// Sammelt alle pistazienfarbigen Termine über die angegebenen Kalender
// hinweg — "pistazienfarben" heißt: der Termin trägt Googles neuere
// eventLabelId (siehe settings:googlePistachioLabelId) ODER die alte
// colorId "10" ODER er trägt gar keine eigene Farbe und der Kalender, auf
// dem er liegt, ist selbst pistazienfarben (siehe Kommentar an
// PISTACHIO_HEX).
async function fetchPistachioTrips(accessToken, calendars, pistachioLabelId) {
  const trips = [];
  for (const cal of calendars) {
    const calPistachio = isPistachioHex(cal.backgroundColor);
    let events;
    try {
      events = await fetchCalendarEvents(accessToken, cal.id);
    } catch {
      continue;
    }
    for (const ev of events) {
      if (ev.status === "cancelled") continue;
      const isTrip = (pistachioLabelId && ev.eventLabelId === pistachioLabelId)
        || ev.colorId === PISTACHIO_EVENT_COLOR_ID
        || (!ev.colorId && calPistachio);
      if (!isTrip) continue;
      const startDate = ev.start?.date || (ev.start?.dateTime || "").slice(0, 10);
      const endDate = ev.end?.date || (ev.end?.dateTime || "").slice(0, 10);
      if (!startDate || !endDate) continue;
      trips.push({ id: `${cal.id}:${ev.id}`, title: ev.summary || "(ohne Titel)", startDate, endDate, allDay: !!ev.start?.date });
    }
  }
  return trips;
}

// Flugreisekosten aus der Schwester-App "Budget" (gleicher Origin, deren
// localStorage-State "budgetprojektion.state.v2"): Buchungen der
// Unterkategorie "Flugreisen" werden hier — bei jedem Rendern neu — den
// Kalender-Reisen zugeordnet:
//  - Buchungsdatum innerhalb genau einer Reise → automatisch dieser Reise
//  - im Puffer (COST_BUFFER_DAYS davor/danach, z.B. früher gebuchtes Hotel
//    oder Flug), in mehreren Reisen zugleich oder ausserhalb → offen, im
//    Zuordnungsdialog entscheidet der Nutzer (Reise wählen und/oder
//    Buchungsdatum ändern)
// Nur diese manuellen Entscheidungen werden gespeichert
// (reiseanalyse:kostenZuordnung = { buchungsId: { trip?: reiseId | "keine",
// ok?: true } }; "trip" fehlt = automatische Zuordnung nach Datum, "ok" =
// als geprüft markiert; ältere Einträge sind nur der String reiseId | "keine");
// das Buchungsdatum wird bei Änderung ins Budget zurückgeschrieben.
const BUDGET_STATE_KEY = "budgetprojektion.state.v2";
const BUDGET_META_KEY = "budgetprojektion.backupmeta.v1";
const COST_BUFFER_DAYS = 10;
const NO_TRIP = "keine";

function readBudgetState() {
  try {
    const raw = localStorage.getItem(BUDGET_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function isoToUTC(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
// Zuordnung einer Buchung zu den Reisen (siehe Kommentar oben).
function classifyBooking(datum, trips) {
  const t = isoToUTC(datum);
  const inside = trips.filter(tr => t >= tripStartUTC(tr) && t < tripEndExclusiveUTC(tr));
  if (inside.length === 1) return { status: "innen", trip: inside[0] };
  if (inside.length > 1) return { status: "mehrdeutig" };
  const buf = COST_BUFFER_DAYS * DAY_MS;
  const near = trips.filter(tr => t >= tripStartUTC(tr) - buf && t < tripEndExclusiveUTC(tr) + buf);
  if (near.length === 1) return { status: "puffer", trip: near[0] };
  if (near.length > 1) return { status: "mehrdeutig" };
  return { status: "ausserhalb" };
}
// Kosten je Reise (Summe Ausgaben; Erstattungen mindern sie) + offene
// Buchungen. manual = gespeicherte Entscheidungen des Nutzers.
function normAssign(v) {
  if (!v) return {};
  if (typeof v === "string") return { trip: v };
  return v;
}
function computeFlightCosts(trips, manual) {
  const empty = { available: false, byTrip: new Map(), bookingsByTrip: new Map(), open: [], all: [] };
  const st = readBudgetState();
  if (!st) return empty;
  const unter = (st.unterkategorien || []).filter(u => u.name === "Flugreisen").map(u => u.id);
  const byTrip = new Map(), open = [], bookingsByTrip = new Map(), all = [];
  const add = (tripId, b) => {
    byTrip.set(tripId, (byTrip.get(tripId) || 0) - (b.betragChf || 0));
    if (!bookingsByTrip.has(tripId)) bookingsByTrip.set(tripId, []);
    bookingsByTrip.get(tripId).push(b);
  };
  for (const b of st.realTransaktionen || []) {
    if (!unter.includes(b.unterkategorieId) || !b.datum) continue;
    const m = normAssign(manual[b.id]);
    const ok = !!m.ok;
    if (m.trip === NO_TRIP) { all.push({ b, tripId: null, status: "keine", ok }); continue; }
    if (m.trip && trips.some(tr => tr.id === m.trip)) { add(m.trip, b); all.push({ b, tripId: m.trip, status: "manuell", ok }); continue; }
    const k = classifyBooking(b.datum, trips);
    if (k.status === "innen") { add(k.trip.id, b); all.push({ b, tripId: k.trip.id, status: "automatisch", ok }); }
    else { open.push({ b, k }); all.push({ b, tripId: null, status: "offen", ok }); }
  }
  open.sort((x, y) => x.b.datum.localeCompare(y.b.datum));
  bookingsByTrip.forEach(list => list.sort((x, y) => x.datum.localeCompare(y.datum)));
  return { available: true, byTrip, bookingsByTrip, open, all };
}
// Schreibt ein geändertes Buchungsdatum in die Buchung der Budget-App
// zurück (Originaldatum bleibt in datumOriginal) und markiert deren Backup
// als geändert. Das Budget übernimmt die Änderung per "storage"-Event.
function writeBookingDate(id, datum) {
  try {
    const st = readBudgetState();
    const b = st && (st.realTransaktionen || []).find(t => t.id === id);
    if (!b) return false;
    if (!b.datumOriginal) b.datumOriginal = b.datum;
    b.datum = datum;
    localStorage.setItem(BUDGET_STATE_KEY, JSON.stringify(st));
    try {
      const meta = JSON.parse(localStorage.getItem(BUDGET_META_KEY) || "{}");
      meta.dirty = true;
      localStorage.setItem(BUDGET_META_KEY, JSON.stringify(meta));
    } catch {}
    return true;
  } catch { return false; }
}
function formatChf(v) {
  return new Intl.NumberFormat("de-CH", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(v));
}
function formatIsoDe(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
// Abstand einer Buchung zu einer Reise in Tagen (0 = innerhalb).
function dayDistance(datum, trip) {
  const t = isoToUTC(datum), s = tripStartUTC(trip), e = tripEndExclusiveUTC(trip);
  if (t < s) return Math.round((s - t) / DAY_MS);
  if (t >= e) return Math.round((t - e) / DAY_MS) + 1;
  return 0;
}

const STATUS_LABEL = { offen: "Offen", manuell: "Manuell", automatisch: "Automatisch", keine: "Keine Reisekosten" };
const STATUS_COLOR = { offen: "#fbbf24", manuell: "#7dd3fc", automatisch: "#4ade80", keine: "rgba(232,244,253,0.5)" };

// Bearbeitungsdialog einer einzelnen Zuordnung (Klick auf eine Zeile der Liste).
function AssignEditModal({ row, trips, onSave, onClose }) {
  const { b } = row;
  const cur = row.status === "manuell" ? row.tripId : row.status === "keine" ? NO_TRIP : "";
  const [datum, setDatum] = React.useState(b.datum);
  const [tripId, setTripId] = React.useState(cur);
  const [ok, setOk] = React.useState(row.ok);
  const sorted = React.useMemo(
    () => [...trips].sort((x, y) => dayDistance(datum, x) - dayDistance(datum, y)),
    [trips, datum]
  );
  const field = { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "8px 10px", color: "#e8f4fd", fontSize: 13, colorScheme: "dark", width: "100%", boxSizing: "border-box" };
  const lbl = { fontSize: 11, color: "rgba(232,244,253,0.5)", margin: "10px 0 4px" };
  const btn = primary => ({ background: primary ? "rgba(125,211,252,0.2)" : "rgba(255,255,255,0.08)", border: "1px solid " + (primary ? "rgba(125,211,252,0.4)" : "rgba(255,255,255,0.15)"), borderRadius: 8, padding: "8px 14px", color: primary ? "#7dd3fc" : "#e8f4fd", fontSize: 12, fontWeight: 700, cursor: "pointer" });
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 520, maxHeight: "85vh", overflowY: "auto", background: "#0f1f33", borderTop: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px 16px 0 0", padding: "16px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Zuordnung bearbeiten</div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 8, width: 28, height: 28, color: "#e8f4fd", fontSize: 15, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700 }}>{b.name || "(ohne Bezeichnung)"}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: b.betragChf < 0 ? "#f87171" : "#4ade80" }}>CHF {formatChf(b.betragChf)}</div>
        <div style={lbl}>Buchungsdatum{datum !== b.datum ? ` (Original im Budget: ${formatIsoDe(b.datum)})` : ""}</div>
        <input type="date" value={datum} onChange={e => setDatum(e.target.value)} style={field} />
        <div style={lbl}>Reise</div>
        <select value={tripId} onChange={e => setTripId(e.target.value)} style={field}>
          <option value="">Automatisch (nach Buchungsdatum)</option>
          {sorted.map(tr => <option key={tr.id} value={tr.id}>{tr.title} ({formatTripRange(tr.startDate, tr.endDate)})</option>)}
          <option value={NO_TRIP}>Keine Reisekosten</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "14px 0", fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} style={{ width: 18, height: 18 }} /> Geprüft
        </label>
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
          <button onClick={() => { onSave(b, { datum: b.datum, tripId: "", ok: false }); onClose(); }} style={btn(false)}>Zurücksetzen</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={btn(false)}>Abbrechen</button>
            <button onClick={() => { onSave(b, { datum, tripId, ok }); onClose(); }} disabled={!datum} style={btn(true)}>Speichern</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Liste aller Flugreise-Buchungen mit ihrer Zuordnung, Filter und Sortierung.
function AssignListModal({ all, trips, onSave, onClose }) {
  const [status, setStatus] = React.useState("alle");
  const [checked, setChecked] = React.useState("alle");
  const [year, setYear] = React.useState("alle");
  const [q, setQ] = React.useState("");
  const [sortBy, setSortBy] = React.useState("datum");
  const [desc, setDesc] = React.useState(true);
  const [edit, setEdit] = React.useState(null); // Buchungs-ID
  const tripOf = id => trips.find(t => t.id === id);
  const years = [...new Set(all.map(r => r.b.datum.slice(0, 4)))].sort().reverse();
  const shown = all.filter(r => {
    if (status !== "alle" && r.status !== status) return false;
    if (checked === "ja" && !r.ok) return false;
    if (checked === "nein" && r.ok) return false;
    if (year !== "alle" && r.b.datum.slice(0, 4) !== year) return false;
    if (q.trim()) {
      const hay = ((r.b.name || "") + " " + (tripOf(r.tripId)?.title || "")).toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });
  const key = r => sortBy === "betrag" ? r.b.betragChf || 0
    : sortBy === "reise" ? (tripOf(r.tripId)?.title || "\uffff").toLowerCase()
    : sortBy === "status" ? r.status
    : sortBy === "geprueft" ? (r.ok ? 1 : 0)
    : r.b.datum;
  shown.sort((x, y) => {
    const a = key(x), b = key(y);
    const c = a < b ? -1 : a > b ? 1 : x.b.datum.localeCompare(y.b.datum);
    return desc ? -c : c;
  });
  const editRow = edit && all.find(r => r.b.id === edit);
  const field = { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px 8px", color: "#e8f4fd", fontSize: 12, colorScheme: "dark" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 640, maxHeight: "90vh", overflowY: "auto", background: "#0f1f33", borderTop: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px 16px 0 0", padding: "16px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>✈ Zuordnungen ({shown.length}/{all.length})</div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 8, width: 28, height: 28, color: "#e8f4fd", fontSize: 15, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Suche…" style={{ ...field, flex: 1, minWidth: 100 }} />
          <select value={status} onChange={e => setStatus(e.target.value)} style={field}>
            <option value="alle">Alle Status</option>
            {Object.keys(STATUS_LABEL).map(k => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
          </select>
          <select value={checked} onChange={e => setChecked(e.target.value)} style={field}>
            <option value="alle">Geprüft: alle</option>
            <option value="ja">Geprüft</option>
            <option value="nein">Nicht geprüft</option>
          </select>
          <select value={year} onChange={e => setYear(e.target.value)} style={field}>
            <option value="alle">Alle Jahre</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={field}>
            <option value="datum">Sortieren: Datum</option>
            <option value="betrag">Sortieren: Betrag</option>
            <option value="reise">Sortieren: Reise</option>
            <option value="status">Sortieren: Status</option>
            <option value="geprueft">Sortieren: Geprüft</option>
          </select>
          <button onClick={() => setDesc(d => !d)} title="Sortierrichtung" style={{ ...field, cursor: "pointer" }}>{desc ? "↓" : "↑"}</button>
        </div>
        {shown.length === 0 && <div style={{ padding: "20px 0", textAlign: "center", fontSize: 13, color: "rgba(232,244,253,0.5)" }}>Keine Zuordnungen für diesen Filter.</div>}
        {shown.map(r => {
          const tr = tripOf(r.tripId);
          return (
            <div key={r.b.id} onClick={() => setEdit(r.b.id)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 4px", borderBottom: "1px solid rgba(255,255,255,0.08)", cursor: "pointer" }}>
              <input type="checkbox" checked={r.ok} title="Geprüft"
                onClick={e => e.stopPropagation()} onChange={e => onSave(r.b, { datum: r.b.datum, tripId: r.status === "manuell" ? r.tripId : r.status === "keine" ? NO_TRIP : "", ok: e.target.checked })}
                style={{ width: 18, height: 18, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatIsoDe(r.b.datum)} · {r.b.name || "(ohne Bezeichnung)"}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, flexShrink: 0, color: r.b.betragChf < 0 ? "#f87171" : "#4ade80" }}>{formatChf(r.b.betragChf)}</div>
                </div>
                <div style={{ fontSize: 11, color: "rgba(232,244,253,0.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ color: STATUS_COLOR[r.status], fontWeight: 700 }}>{STATUS_LABEL[r.status]}</span>
                  {tr ? ` · ${tr.title} (${formatTripRange(tr.startDate, tr.endDate)})` : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {editRow && <AssignEditModal key={editRow.b.id + editRow.b.datum} row={editRow} trips={trips} onSave={onSave} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CostAssignRow({ item, trips, onSave }) {
  const { b, k } = item;
  const [datum, setDatum] = React.useState(b.datum);
  const [tripId, setTripId] = React.useState(k.status === "puffer" ? k.trip.id : "");
  const sorted = React.useMemo(
    () => [...trips].sort((x, y) => dayDistance(b.datum, x) - dayDistance(b.datum, y)),
    [trips, b.datum]
  );
  const hint = k.status === "puffer"
    ? `${dayDistance(b.datum, k.trip)} Tage ${isoToUTC(b.datum) < tripStartUTC(k.trip) ? "vor" : "nach"} «${k.trip.title}»`
    : k.status === "mehrdeutig" ? "passt zu mehreren Reisen" : "keiner Reise zuordenbar";
  const field = { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "7px 8px", color: "#e8f4fd", fontSize: 13, colorScheme: "dark" };
  return (
    <div style={{ padding: "10px 4px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name || "(ohne Bezeichnung)"}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: b.betragChf < 0 ? "#f87171" : "#4ade80", flexShrink: 0 }}>{formatChf(b.betragChf)}</div>
      </div>
      <div style={{ fontSize: 11, color: "rgba(232,244,253,0.45)", marginBottom: 6 }}>{hint}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <input type="date" value={datum} onChange={e => setDatum(e.target.value)} style={field} />
        <select value={tripId} onChange={e => setTripId(e.target.value)} style={{ ...field, flex: 1, minWidth: 140 }}>
          <option value="">– Reise wählen –</option>
          {sorted.map(tr => <option key={tr.id} value={tr.id}>{tr.title} ({formatTripRange(tr.startDate, tr.endDate)})</option>)}
          <option value={NO_TRIP}>Keine Reisekosten</option>
        </select>
        <button onClick={() => onSave(b, datum, tripId)} disabled={!datum}
          style={{ background: "rgba(125,211,252,0.15)", border: "1px solid rgba(125,211,252,0.3)", borderRadius: 8, padding: "7px 12px", color: "#7dd3fc", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          Übernehmen
        </button>
      </div>
    </div>
  );
}

function CostAssignModal({ open, trips, onSave, onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 520, maxHeight: "85vh", overflowY: "auto", background: "#0f1f33", borderTop: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px 16px 0 0", padding: "16px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>✈ Flugreisekosten zuordnen ({open.length} offen)</div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 8, width: 28, height: 28, color: "#e8f4fd", fontSize: 15, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: "rgba(232,244,253,0.45)", marginBottom: 8 }}>
          Buchungen der Unterkategorie „Flugreisen“ ausserhalb einer Reise (Puffer: {COST_BUFFER_DAYS} Tage davor/danach). Eine Datumsänderung wird in die Buchung im Budget übernommen.
        </div>
        {open.length === 0 && <div style={{ padding: "20px 0", textAlign: "center", fontSize: 13, color: "rgba(232,244,253,0.5)" }}>Alle Flugreisekosten sind zugeordnet. ✓</div>}
        {open.map(item => <CostAssignRow key={item.b.id + item.b.datum} item={item} trips={trips} onSave={onSave} />)}
      </div>
    </div>
  );
}

// Jahres-Pivot: Reisetage + Flugminuten je Jahr (ab REISEANALYSE_START_YEAR,
// plus jedes weitere Jahr, in das eine Reise tatsächlich hineinreicht) und
// je Jahr die Liste der einzelnen Reisen für den Drilldown.
function computeReiseanalysePivot(trips, flights, costs) {
  const parsedFlights = flights
    .map(f => ({ f, dateUTC: parseFlightDateUTC(f) }))
    .filter(x => x.dateUTC !== null);

  const currentYear = new Date().getFullYear();
  const years = new Set();
  for (let y = REISEANALYSE_START_YEAR; y <= currentYear; y++) years.add(y);
  trips.forEach(t => {
    const startY = new Date(tripStartUTC(t)).getUTCFullYear();
    const lastDayY = new Date(tripEndExclusiveUTC(t) - DAY_MS).getUTCFullYear();
    for (let y = Math.max(startY, REISEANALYSE_START_YEAR); y <= lastDayY; y++) years.add(y);
  });
  const yearList = [...years].sort((a, b) => a - b);

  const rows = yearList.map(year => {
    const tripRows = [];
    for (const t of trips) {
      const days = daysOfTripInYear(t, year);
      if (days <= 0) continue;
      const start = tripStartUTC(t), endEx = tripEndExclusiveUTC(t);
      const minutes = parsedFlights
        .filter(x => x.dateUTC >= start && x.dateUTC < endEx && new Date(x.dateUTC).getUTCFullYear() === year)
        .reduce((acc, x) => acc + (x.f.durationSec || 0) / 60, 0);
      // Kosten einer Reise zählen komplett im Startjahr der Reise (auch wenn
      // sie über den Jahreswechsel geht bzw. Buchungen in einem anderen Jahr
      // liegen), damit sie nicht doppelt erscheinen.
      const cost = t.startDate.slice(0, 4) === String(year) ? (costs.byTrip.get(t.id) || 0) : 0;
      tripRows.push({ id: t.id, title: t.title, days, minutes, cost, bookings: costs.bookingsByTrip.get(t.id) || [], startDate: t.startDate, endDate: t.endDate });
    }
    tripRows.sort((a, b) => a.startDate.localeCompare(b.startDate));
    return {
      year,
      days: tripRows.reduce((acc, r) => acc + r.days, 0),
      minutes: tripRows.reduce((acc, r) => acc + r.minutes, 0),
      cost: tripRows.reduce((acc, r) => acc + r.cost, 0),
      trips: tripRows,
    };
  });
  const total = rows.reduce((acc, r) => ({ days: acc.days + r.days, minutes: acc.minutes + r.minutes, cost: acc.cost + r.cost }), { days: 0, minutes: 0, cost: 0 });
  return { rows, total };
}

function ReiseanalysePivotTable({ pivot, onOpenYear }) {
  const cols = "minmax(0,0.7fr) minmax(0,0.9fr) minmax(0,1fr) minmax(0,1.1fr)";
  const cellStyle = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, background: STICKY_BG_HEADER, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        {["Jahr", "Reisetage", "Flugminuten", "Flugkosten"].map((h, i) => (
          <div key={h} style={{ ...cellStyle, padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.5, textAlign: i === 0 ? "left" : "right" }}>{h}</div>
        ))}
      </div>
      {pivot.rows.length === 0 && (
        <div style={{ padding: "24px 12px", textAlign: "center", fontSize: 13, color: "rgba(232,244,253,0.4)" }}>Keine pistazienfarbigen Kalendereinträge gefunden.</div>
      )}
      {pivot.rows.map(r => (
        <div key={r.year} onClick={() => r.trips.length && onOpenYear(r.year)}
          style={{ display: "grid", gridTemplateColumns: cols, borderBottom: "1px solid rgba(255,255,255,0.05)", cursor: r.trips.length ? "pointer" : "default" }}>
          <div style={{ ...cellStyle, padding: "9px 10px", fontSize: 14, fontWeight: 700, color: "#7dd3fc" }}>{r.year}{r.trips.length ? " ›" : ""}</div>
          <div style={{ ...cellStyle, padding: "9px 10px", fontSize: 14, textAlign: "right", color: r.days ? "#e8f4fd" : "rgba(232,244,253,0.25)" }}>{r.days || "·"}</div>
          <div style={{ ...cellStyle, padding: "9px 10px", fontSize: 14, textAlign: "right", color: r.minutes ? "#e8f4fd" : "rgba(232,244,253,0.25)" }}>{r.minutes ? formatMinutes(r.minutes) : "·"}</div>
          <div style={{ ...cellStyle, padding: "9px 10px", fontSize: 14, textAlign: "right", color: r.cost ? "#e8f4fd" : "rgba(232,244,253,0.25)" }}>{r.cost ? formatChf(r.cost) : "·"}</div>
        </div>
      ))}
      {pivot.rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: cols, background: "rgba(125,211,252,0.08)" }}>
          <div style={{ ...cellStyle, padding: "9px 10px", fontSize: 14, fontWeight: 800 }}>Gesamt</div>
          <div style={{ ...cellStyle, padding: "9px 10px", fontSize: 14, fontWeight: 800, textAlign: "right" }}>{pivot.total.days}</div>
          <div style={{ ...cellStyle, padding: "9px 10px", fontSize: 14, fontWeight: 800, textAlign: "right", color: "#7dd3fc" }}>{formatMinutes(pivot.total.minutes)}</div>
          <div style={{ ...cellStyle, padding: "9px 10px", fontSize: 14, fontWeight: 800, textAlign: "right", color: "#7dd3fc" }}>{pivot.total.cost ? formatChf(pivot.total.cost) : "·"}</div>
        </div>
      )}
    </div>
  );
}

function ReiseDrilldownModal({ row, onClose }) {
  const [expanded, setExpanded] = React.useState(null); // Reise-ID mit aufgeklappten Buchungen
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 480, maxHeight: "80vh", overflowY: "auto", background: "#0f1f33", borderTop: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px 16px 0 0", padding: "16px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>🧳 Reisen {row.year}</div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 8, width: 28, height: 28, color: "#e8f4fd", fontSize: 15, cursor: "pointer" }}>✕</button>
        </div>
        {row.trips.map((t, i) => (
          <div key={t.id} style={{ borderBottom: i < row.trips.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
            <div onClick={() => t.bookings.length && setExpanded(expanded === t.id ? null : t.id)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 4px", cursor: t.bookings.length ? "pointer" : "default" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}{t.bookings.length ? (expanded === t.id ? " ▾" : " ▸") : ""}</div>
                <div style={{ fontSize: 11, color: "rgba(232,244,253,0.4)" }}>{formatTripRange(t.startDate, t.endDate)}</div>
              </div>
              <div style={{ flexShrink: 0, textAlign: "right" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#7dd3fc" }}>{t.days} {t.days === 1 ? "Tag" : "Tage"}</div>
                <div style={{ fontSize: 11, color: "rgba(232,244,253,0.5)" }}>{t.minutes ? formatMinutes(t.minutes) : "0h 00m"}</div>
                {t.cost ? <div style={{ fontSize: 11, color: "rgba(232,244,253,0.5)" }}>CHF {formatChf(t.cost)}</div> : null}
              </div>
            </div>
            {expanded === t.id && (
              <div style={{ margin: "0 4px 8px", padding: "6px 8px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
                {t.bookings.map(b => (
                  <div key={b.id} style={{ display: "flex", gap: 8, padding: "3px 0", fontSize: 12 }}>
                    <div style={{ flexShrink: 0, color: "rgba(232,244,253,0.5)" }}>{formatIsoDe(b.datum)}</div>
                    <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name || "(ohne Bezeichnung)"}</div>
                    <div style={{ flexShrink: 0, fontWeight: 600, color: b.betragChf < 0 ? "#f87171" : "#4ade80" }}>{formatChf(b.betragChf)}</div>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, paddingTop: 4, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 12, fontWeight: 700 }}>
                  <span>Total ({t.bookings.length} {t.bookings.length === 1 ? "Buchung" : "Buchungen"})</span>
                  <span>CHF {formatChf(t.bookings.reduce((a, x) => a - (x.betragChf || 0), 0))}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReiseanalyseSection({ flights }) {
  const [clientId, setClientId] = React.useState("");
  const [calendarId, setCalendarId] = React.useState("primary");
  const [pistachioLabelId, setPistachioLabelId] = React.useState("");
  const [settingsLoaded, setSettingsLoaded] = React.useState(false);
  const [trips, setTrips] = React.useState([]);
  const [fetchedAt, setFetchedAt] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [openYear, setOpenYear] = React.useState(null);
  const [manual, setManual] = React.useState({}); // Buchungs-ID -> Reise-ID | "keine"
  const [budgetTick, setBudgetTick] = React.useState(0);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [listOpen, setListOpen] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        const [ci, cal, lbl, cache, zu] = await Promise.all([
          window.storage.get("settings:googleClientId"),
          window.storage.get("settings:googleCalendarId"),
          window.storage.get("settings:googlePistachioLabelId"),
          window.storage.get("reiseanalyse:tripsCache"),
          window.storage.get("reiseanalyse:kostenZuordnung"),
        ]);
        try { if (zu?.value) setManual(JSON.parse(zu.value) || {}); } catch {}
        if (ci?.value) setClientId(ci.value);
        if (cal?.value) setCalendarId(cal.value);
        if (lbl?.value) setPistachioLabelId(lbl.value);
        if (cache?.value) {
          try {
            const parsed = JSON.parse(cache.value);
            if (Array.isArray(parsed.trips)) { setTrips(parsed.trips); setFetchedAt(parsed.fetchedAt || null); }
          } catch {}
        }
      } catch {}
      setSettingsLoaded(true);
    })();
  }, []);

  const sync = async () => {
    setError(null);
    if (!clientId) {
      setError('Keine Google-Client-ID hinterlegt — unter Service → "🔗 Google Kalender (Reiseanalyse)" eintragen.');
      return;
    }
    setBusy(true);
    try {
      await loadGsiScript();
      const accessToken = await new Promise((resolve, reject) => {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: GOOGLE_CALENDAR_SCOPE,
          callback: (resp) => {
            if (resp.error) reject(new Error(resp.error)); else resolve(resp.access_token);
          },
          error_callback: (err) => reject(new Error(err?.message || "Google-Anmeldung abgebrochen.")),
        });
        client.requestAccessToken();
      });
      // Ohne explizit gesetzte Kalender-ID werden ALLE Kalender des Kontos
      // durchsucht (siehe Kommentar an PISTACHIO_HEX oben) — der
      // "Reisen"-Kalender ist meist ein separater, sekundärer Kalender,
      // nicht der Hauptkalender ("primary").
      const trimmedCalendarId = (calendarId || "").trim();
      const calendars = trimmedCalendarId && trimmedCalendarId !== "primary"
        ? [{ id: trimmedCalendarId, summary: trimmedCalendarId, backgroundColor: null }]
        : await fetchCalendarList(accessToken);
      const fetchedTrips = await fetchPistachioTrips(accessToken, calendars, pistachioLabelId.trim());
      const iso = new Date().toISOString();
      setTrips(fetchedTrips);
      setFetchedAt(iso);
      await window.storage.set("reiseanalyse:tripsCache", JSON.stringify({ fetchedAt: iso, calendarId, trips: fetchedTrips }));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  // Bei jedem Rendern/Sync neu aus dem Budget gelesen und zugeordnet
  // ("on the fly"); budgetTick erzwingt das nach einer Datumsänderung.
  const costs = React.useMemo(() => computeFlightCosts(trips, manual), [trips, manual, budgetTick]);
  const pivot = React.useMemo(() => computeReiseanalysePivot(trips, flights, costs), [trips, flights, costs]);

  // ok undefined = bisherigen Geprüft-Status behalten; tripId "" = automatisch.
  const saveAssign = async (b, { datum, tripId, ok }) => {
    if (datum !== b.datum && !writeBookingDate(b.id, datum)) {
      setError("Das Buchungsdatum konnte im Budget nicht geändert werden.");
      return;
    }
    const old = normAssign(manual[b.id]);
    const entry = {};
    const trip = tripId === undefined ? old.trip : tripId;
    if (trip) entry.trip = trip;
    if (ok === undefined ? old.ok : ok) entry.ok = true;
    const next = { ...manual };
    if (entry.trip || entry.ok) next[b.id] = entry; else delete next[b.id];
    setManual(next);
    try { await window.storage.set("reiseanalyse:kostenZuordnung", JSON.stringify(next)); } catch {}
    setBudgetTick(t => t + 1);
  };
  const assign = (b, datum, tripId) => saveAssign(b, { datum, tripId: tripId || undefined });
  const openRow = pivot.rows.find(r => r.year === openYear) || null;

  if (!settingsLoaded) {
    return <div style={{ padding: "24px 16px", color: "rgba(232,244,253,0.5)" }}>Lade…</div>;
  }

  return (
    <div style={{ padding: "0 16px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 11, color: "rgba(232,244,253,0.45)" }}>
          {fetchedAt
            ? `Kalenderstand: ${new Date(fetchedAt).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`
            : "Noch nicht mit Google Kalender synchronisiert."}
        </div>
        <button onClick={sync} disabled={busy}
          style={{ background: "rgba(125,211,252,0.15)", border: "1px solid rgba(125,211,252,0.3)", borderRadius: 10, padding: "9px 14px", color: "#7dd3fc", fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
          {busy ? "⏳ Synchronisiere…" : (fetchedAt ? "🔄 Aktualisieren" : "🔗 Mit Google Kalender verbinden")}
        </button>
      </div>
      {error && (
        <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#f87171", marginBottom: 12 }}>
          {error}
        </div>
      )}
      {costs.available && costs.open.length > 0 && (
        <div onClick={() => setAssignOpen(true)} style={{ cursor: "pointer", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#fbbf24", marginBottom: 12 }}>
          ✈ {costs.open.length} Flugreise-{costs.open.length === 1 ? "Buchung ist" : "Buchungen sind"} keiner Reise eindeutig zugeordnet — tippen zum Zuordnen ›
        </div>
      )}
      {costs.available && costs.all.length > 0 && (
        <div onClick={() => setListOpen(true)} style={{ cursor: "pointer", background: "rgba(125,211,252,0.08)", border: "1px solid rgba(125,211,252,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#7dd3fc", marginBottom: 12 }}>
          📋 Zuordnungsliste ({costs.all.filter(r => r.ok).length}/{costs.all.length} geprüft) ›
        </div>
      )}
      <ReiseanalysePivotTable pivot={pivot} onOpenYear={setOpenYear} />
      {assignOpen && <CostAssignModal open={costs.open} trips={trips} onSave={assign} onClose={() => setAssignOpen(false)} />}
      {listOpen && <AssignListModal all={costs.all} trips={trips} onSave={saveAssign} onClose={() => setListOpen(false)} />}
      {openRow && <ReiseDrilldownModal row={openRow} onClose={() => setOpenYear(null)} />}
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
      // Fallback nötig für Ansichten ohne eigenen Filtersatz (aktuell nur
      // "reiseanalyse") — filtersMapRef.current kennt nur uebersicht/monat/
      // reise, ein direkter Zugriff wäre dort sonst undefined und ließe
      // applyFilterSet abstürzen (f.typ etc. auf undefined).
      applyFilterSet(filtersMapRef.current[loadedView] || emptyFilterSet());
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
          <UebersichtPivotTable pivot={pivot} />
        </>
      )}

      {view === "monat" && <MonthPivotTable flights={filtered} />}

      {view === "reise" && <ReisePivotTable flights={filtered} />}

      {view === "reiseanalyse" && <ReiseanalyseSection flights={all} />}
    </div>
  );
}
