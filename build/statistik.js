/* Automatisch erzeugt aus statistik.jsx (sha256 66694dbdb928) — nicht von Hand ändern, siehe scripts/build.js */
(function (React, ReactDOM) {
function stickyCol(bg) {
  return { position: "sticky", left: 0, zIndex: 1, background: bg, boxShadow: "2px 0 4px rgba(0,0,0,0.25)" };
}
const STICKY_BG_HEADER = "#111a2b";
const STICKY_BG_ROW = "#040e20";
const STICKY_BG_TOTAL = "#0e1e32";
function stickyHeaderRow() {
  return { position: "sticky", top: 0, zIndex: 3 };
}
function formatMinutes(min) {
  const m = Math.round(min);
  const h = Math.floor(m / 60), rem = m % 60;
  return `${h}h ${String(rem).padStart(2, "0")}m`;
}
function emptyFilterSet() {
  return { typ: [], reise: [], schirm: [], landeplatz: [], land: [], training: "alle" };
}
function distinctValues(flights, getter) {
  const set = /* @__PURE__ */ new Set();
  flights.forEach((f) => {
    const v = (getter(f) || "").trim();
    if (v) set.add(v);
  });
  return [...set].sort((a, b) => a.localeCompare(b, "de", { numeric: true, sensitivity: "base" }));
}
function MultiSelectFilter({ label, options, selected, onChange }) {
  const [open, setOpen] = React.useState(false);
  const allSelected = selected.size === 0;
  const toggle = (v) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  };
  const summary = allSelected ? "Alle" : selected.size === 1 ? [...selected][0] : `${selected.size} ausgewählt`;
  return /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setOpen((o) => !o),
      style: { width: "100%", boxSizing: "border-box", display: "flex", justifyContent: "space-between", alignItems: "center", background: allSelected ? "rgba(255,255,255,0.05)" : "rgba(125,211,252,0.15)", border: `1px solid ${allSelected ? "rgba(255,255,255,0.1)" : "rgba(125,211,252,0.35)"}`, borderRadius: 8, padding: "8px 10px", color: allSelected ? "rgba(232,244,253,0.6)" : "#7dd3fc", fontSize: 12, cursor: "pointer" }
    },
    /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 600 } }, label),
    /* @__PURE__ */ React.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110, marginLeft: 6 } }, summary, " ", open ? "▾" : "▸")
  ), open && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { onClick: () => setOpen(false), style: { position: "fixed", inset: 0, zIndex: 40 } }), /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: (e) => e.stopPropagation(),
      style: { position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#14253a", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: 6, maxHeight: 260, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.5)", zIndex: 50, minWidth: 200 }
    },
    /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: () => onChange(/* @__PURE__ */ new Set()),
        style: { padding: "7px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer", color: allSelected ? "#7dd3fc" : "rgba(232,244,253,0.6)", fontWeight: allSelected ? 700 : 400, borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: 4 }
      },
      "✓ Alle"
    ),
    options.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "7px 10px", fontSize: 12, color: "rgba(232,244,253,0.35)" } }, "Keine Werte vorhanden"),
    options.map((o) => /* @__PURE__ */ React.createElement(
      "div",
      {
        key: o,
        onClick: () => toggle(o),
        style: { display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer", color: selected.has(o) ? "#e8f4fd" : "rgba(232,244,253,0.6)" }
      },
      /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, width: 15, height: 15, borderRadius: 4, border: `2px solid ${selected.has(o) ? "#7dd3fc" : "rgba(232,244,253,0.3)"}`, background: selected.has(o) ? "#7dd3fc" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" } }, selected.has(o) && /* @__PURE__ */ React.createElement("span", { style: { color: "#0a1628", fontSize: 10, fontWeight: 900 } }, "✓")),
      /* @__PURE__ */ React.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis" } }, o)
    ))
  )));
}
function TrainingFilter({ value, onChange }) {
  const opts = [["alle", "Alle"], ["ja", "Nur Training"], ["nein", "Ohne Training"]];
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6 } }, opts.map(([v, l]) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: v,
      onClick: () => onChange(v),
      style: { flex: 1, background: value === v ? "rgba(125,211,252,0.2)" : "rgba(255,255,255,0.05)", border: `1px solid ${value === v ? "rgba(125,211,252,0.4)" : "rgba(255,255,255,0.1)"}`, borderRadius: 8, padding: "8px 4px", color: value === v ? "#7dd3fc" : "rgba(232,244,253,0.6)", fontSize: 11, fontWeight: value === v ? 700 : 400, cursor: "pointer" }
    },
    l
  )));
}
const VIEWS = [
  { id: "uebersicht", label: "Übersicht" },
  { id: "monat", label: "Monatsübersicht" },
  { id: "reise", label: "Reiseübersicht" },
  { id: "reiseanalyse", label: "Reiseanalyse" }
];
function ViewSwitcher({ view, onChange }) {
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6 } }, VIEWS.map((v) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: v.id,
      onClick: () => onChange(v.id),
      style: { flex: 1, background: view === v.id ? "rgba(125,211,252,0.18)" : "rgba(255,255,255,0.05)", border: `1px solid ${view === v.id ? "rgba(125,211,252,0.4)" : "rgba(255,255,255,0.1)"}`, borderRadius: 10, padding: "10px 6px", color: view === v.id ? "#7dd3fc" : "rgba(232,244,253,0.6)", fontSize: 12, fontWeight: view === v.id ? 700 : 400, cursor: "pointer" }
    },
    v.label
  )));
}
function FilterBar({
  typOptions,
  typF,
  setTypF,
  reiseOptions,
  reiseF,
  setReiseF,
  schirmOptions,
  schirmF,
  setSchirmF,
  landeplatzOptions,
  landeplatzF,
  setLandeplatzF,
  landOptions,
  landF,
  setLandF,
  trainingF,
  setTrainingF,
  anyFilterActive,
  resetFilters
}) {
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { padding: "0 16px 10px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 } }, /* @__PURE__ */ React.createElement(MultiSelectFilter, { label: "Typ", options: typOptions, selected: typF, onChange: setTypF }), /* @__PURE__ */ React.createElement(MultiSelectFilter, { label: "Reise", options: reiseOptions, selected: reiseF, onChange: setReiseF }), /* @__PURE__ */ React.createElement(MultiSelectFilter, { label: "Schirm", options: schirmOptions, selected: schirmF, onChange: setSchirmF }), /* @__PURE__ */ React.createElement(MultiSelectFilter, { label: "Landeplatz", options: landeplatzOptions, selected: landeplatzF, onChange: setLandeplatzF }), /* @__PURE__ */ React.createElement(MultiSelectFilter, { label: "Land", options: landOptions, selected: landF, onChange: setLandF })), /* @__PURE__ */ React.createElement("div", { style: { padding: "0 16px 10px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "rgba(232,244,253,0.4)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 } }, "Training"), /* @__PURE__ */ React.createElement(TrainingFilter, { value: trainingF, onChange: setTrainingF })), anyFilterActive && /* @__PURE__ */ React.createElement("div", { style: { padding: "0 16px 14px" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: resetFilters,
      style: { background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 8, padding: "7px 12px", color: "#f87171", fontSize: 12, cursor: "pointer" }
    },
    "✕ Filter zurücksetzen"
  )));
}
const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
function computeMonthPivot(flights) {
  const byYear = /* @__PURE__ */ new Map();
  for (const f of flights) {
    const parts = (f.date || "").split(".");
    const yr = (f.year || parts[2] || "").toString();
    const mo = parts.length === 3 ? parseInt(parts[1], 10) : NaN;
    if (!yr || !mo || mo < 1 || mo > 12) continue;
    if (!byYear.has(yr)) byYear.set(yr, Array(12).fill(0));
    byYear.get(yr)[mo - 1]++;
  }
  const rows = [...byYear.entries()].map(([year, months]) => ({ year, months, total: months.reduce((a, b) => a + b, 0) })).sort((a, b) => a.year.localeCompare(b.year, "de", { numeric: true }));
  const monthTotals = Array(12).fill(0);
  rows.forEach((r) => r.months.forEach((c, i) => {
    monthTotals[i] += c;
  }));
  const grandTotal = monthTotals.reduce((a, b) => a + b, 0);
  return { rows, monthTotals, grandTotal };
}
function MonthPivotTable({ flights }) {
  const pivot = React.useMemo(() => computeMonthPivot(flights), [flights]);
  const cols = `0.9fr repeat(12, 0.55fr) 0.7fr`;
  const minWidth = 620;
  return /* @__PURE__ */ React.createElement("div", { style: { padding: "0 16px" } }, /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, overflow: "hidden", overflowX: "auto", overflowY: "auto", maxHeight: "60vh" } }, /* @__PURE__ */ React.createElement("div", { style: { ...stickyHeaderRow(), display: "grid", gridTemplateColumns: cols, background: STICKY_BG_HEADER, borderBottom: "1px solid rgba(255,255,255,0.1)", minWidth } }, /* @__PURE__ */ React.createElement("div", { style: { ...stickyCol(STICKY_BG_HEADER), padding: "3px 6px", fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.5 } }, "Jahr"), MONATE.map((m) => /* @__PURE__ */ React.createElement("div", { key: m, style: { padding: "3px 3px", fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" } }, m)), /* @__PURE__ */ React.createElement("div", { style: { padding: "3px 6px", fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" } }, "Total")), pivot.rows.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "24px 12px", textAlign: "center", fontSize: 13, color: "rgba(232,244,253,0.4)", minWidth } }, "Keine Flüge für diese Filterauswahl."), pivot.rows.map((r) => /* @__PURE__ */ React.createElement("div", { key: r.year, style: { display: "grid", gridTemplateColumns: cols, borderBottom: "1px solid rgba(255,255,255,0.05)", minWidth } }, /* @__PURE__ */ React.createElement("div", { style: { ...stickyCol(STICKY_BG_ROW), padding: "3px 6px", fontSize: 13, fontWeight: 700, color: "#7dd3fc" } }, r.year), r.months.map((c, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { padding: "3px 3px", fontSize: 13, textAlign: "right", color: c ? "#e8f4fd" : "rgba(232,244,253,0.25)" } }, c || "·")), /* @__PURE__ */ React.createElement("div", { style: { padding: "3px 6px", fontSize: 13, textAlign: "right", fontWeight: 700, color: "rgba(232,244,253,0.8)" } }, r.total))), pivot.rows.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: cols, background: "rgba(125,211,252,0.08)", minWidth } }, /* @__PURE__ */ React.createElement("div", { style: { ...stickyCol(STICKY_BG_TOTAL), padding: "3px 6px", fontSize: 13, fontWeight: 800 } }, "Gesamt"), pivot.monthTotals.map((c, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { padding: "3px 3px", fontSize: 13, fontWeight: 800, textAlign: "right" } }, c || "·")), /* @__PURE__ */ React.createElement("div", { style: { padding: "3px 6px", fontSize: 13, fontWeight: 800, textAlign: "right", color: "#7dd3fc" } }, pivot.grandTotal))));
}
function computeReisePivot(flights) {
  const years = /* @__PURE__ */ new Set();
  const byReise = /* @__PURE__ */ new Map();
  for (const f of flights) {
    const reise = (f.customFields?.reise || "").trim() || "—";
    const yr = (f.year || (f.date || "").split(".")[2] || "—").toString();
    years.add(yr);
    if (!byReise.has(reise)) byReise.set(reise, /* @__PURE__ */ new Map());
    const m = byReise.get(reise);
    m.set(yr, (m.get(yr) || 0) + (f.durationSec || 0) / 60);
  }
  const yearList = [...years].sort((a, b) => a.localeCompare(b, "de", { numeric: true }));
  const rows = [...byReise.entries()].map(([reise, m]) => {
    const minutesByYear = yearList.map((y) => m.get(y) || 0);
    return { reise, minutesByYear, total: minutesByYear.reduce((a, b) => a + b, 0) };
  }).sort((a, b) => a.reise.localeCompare(b.reise, "de", { numeric: true }));
  const yearTotals = yearList.map((_, i) => rows.reduce((acc, r) => acc + r.minutesByYear[i], 0));
  const grandTotal = yearTotals.reduce((a, b) => a + b, 0);
  return { yearList, rows, yearTotals, grandTotal };
}
function ReisePivotTable({ flights }) {
  const pivot = React.useMemo(() => computeReisePivot(flights), [flights]);
  const cols = `1.1fr repeat(${pivot.yearList.length}, 0.8fr) 0.9fr`;
  const minWidth = 150 + pivot.yearList.length * 70 + 80;
  return /* @__PURE__ */ React.createElement("div", { style: { padding: "0 16px" } }, /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, overflow: "hidden", overflowX: "auto", overflowY: "auto", maxHeight: "60vh" } }, /* @__PURE__ */ React.createElement("div", { style: { ...stickyHeaderRow(), display: "grid", gridTemplateColumns: cols, background: STICKY_BG_HEADER, borderBottom: "1px solid rgba(255,255,255,0.1)", minWidth } }, /* @__PURE__ */ React.createElement("div", { style: { ...stickyCol(STICKY_BG_HEADER), padding: "3px 6px", fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.5 } }, "Reise"), pivot.yearList.map((y) => /* @__PURE__ */ React.createElement("div", { key: y, style: { padding: "3px 6px", fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" } }, y)), /* @__PURE__ */ React.createElement("div", { style: { padding: "3px 6px", fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" } }, "Total")), pivot.rows.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "24px 12px", textAlign: "center", fontSize: 13, color: "rgba(232,244,253,0.4)", minWidth } }, "Keine Flüge für diese Filterauswahl."), pivot.rows.map((r) => /* @__PURE__ */ React.createElement("div", { key: r.reise, style: { display: "grid", gridTemplateColumns: cols, borderBottom: "1px solid rgba(255,255,255,0.05)", minWidth } }, /* @__PURE__ */ React.createElement("div", { style: { ...stickyCol(STICKY_BG_ROW), padding: "3px 6px", fontSize: 13, fontWeight: 700, color: "#7dd3fc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, r.reise), r.minutesByYear.map((min, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { padding: "3px 6px", fontSize: 13, textAlign: "right", color: min ? "#e8f4fd" : "rgba(232,244,253,0.25)" } }, min ? Math.round(min) : "·")), /* @__PURE__ */ React.createElement("div", { style: { padding: "3px 6px", fontSize: 13, textAlign: "right", fontWeight: 700, color: "rgba(232,244,253,0.8)" } }, Math.round(r.total)))), pivot.rows.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: cols, background: "rgba(125,211,252,0.08)", minWidth } }, /* @__PURE__ */ React.createElement("div", { style: { ...stickyCol(STICKY_BG_TOTAL), padding: "3px 6px", fontSize: 13, fontWeight: 800 } }, "Gesamt"), pivot.yearTotals.map((min, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { padding: "3px 6px", fontSize: 13, fontWeight: 800, textAlign: "right" } }, min ? Math.round(min) : "·")), /* @__PURE__ */ React.createElement("div", { style: { padding: "3px 6px", fontSize: 13, fontWeight: 800, textAlign: "right", color: "#7dd3fc" } }, Math.round(pivot.grandTotal)))));
}
const MAX_STATS = [
  {
    id: "dauer",
    label: "Längster Flug",
    icon: "⏱",
    getValue: (f) => f.durationSec || 0,
    format: (v) => formatMinutes(v / 60)
  },
  {
    id: "distanz",
    label: "Weitester Flug",
    icon: "📏",
    getValue: (f) => f.totalDist || parseFloat(f.customFields?.distKm || f.customFields?.dk || 0) || 0,
    format: (v) => v.toFixed(1).replace(".", ",") + " km"
  },
  {
    id: "maxspeed",
    label: "Schnellster Flug",
    icon: "⚡",
    getValue: (f) => f.maxSpeedKmh || 0,
    format: (v) => v.toFixed(1).replace(".", ",") + " km/h"
  },
  {
    id: "hoehe",
    label: "Höchster Flug",
    icon: "⛰",
    getValue: (f) => f.maxAlt || +(f.customFields?.hMax || f.customFields?.hm || 0) || 0,
    format: (v) => Math.round(v) + " m"
  },
  {
    id: "hgew",
    label: "Größter Höhengewinn",
    icon: "🚀",
    getValue: (f) => +(f.customFields?.hGew || 0) || 0,
    format: (v) => Math.round(v) + " m"
  }
];
function rankFlights(flights, stat) {
  return flights.map((f) => ({ flight: f, value: stat.getValue(f) })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 20);
}
function TopFlightsModal({ stat, ranked, onClose }) {
  return /* @__PURE__ */ React.createElement("div", { onClick: onClose, style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" } }, /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: (e) => e.stopPropagation(),
      style: { width: "100%", maxWidth: 480, maxHeight: "80vh", overflowY: "auto", background: "#0f1f33", borderTop: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px 16px 0 0", padding: "16px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 800 } }, stat.icon, " Top 20 — ", stat.label), /* @__PURE__ */ React.createElement("button", { onClick: onClose, style: { background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 8, width: 28, height: 28, color: "#e8f4fd", fontSize: 15, cursor: "pointer" } }, "✕")),
    ranked.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "20px 4px", fontSize: 13, color: "rgba(232,244,253,0.4)", textAlign: "center" } }, "Keine Flüge mit diesem Wert vorhanden."),
    ranked.map((r, i) => (
      // Flugname (enthält nur die fortlaufende Flugnummer, z.B. "Flug 42")
      // bewusst weggelassen — Datum + Startplatz (+ Land, falls erfasst)
      // identifizieren den Flug aussagekräftiger.
      /* @__PURE__ */ React.createElement(
        "a",
        {
          key: r.flight.id,
          href: `flugbuch.html?openFlightId=${encodeURIComponent(r.flight.id)}`,
          style: { display: "flex", alignItems: "center", gap: 10, padding: "3px 4px", borderBottom: i < ranked.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none", textDecoration: "none", color: "inherit" }
        },
        /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, width: 22, textAlign: "center", fontSize: 12, fontWeight: 800, color: i === 0 ? "#fcd34d" : "rgba(232,244,253,0.4)" } }, i + 1),
        /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, r.flight.date, " · ", r.flight.site || "—", r.flight.customFields?.land ? ` · ${r.flight.customFields.land}` : ""),
        /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, fontSize: 13, fontWeight: 700, color: "#7dd3fc" } }, stat.format(r.value))
      )
    ))
  ));
}
function MaxStatsSection({ flights }) {
  const [openStatId, setOpenStatId] = React.useState(null);
  const ranked = React.useMemo(() => {
    const m = {};
    MAX_STATS.forEach((s) => {
      m[s.id] = rankFlights(flights, s);
    });
    return m;
  }, [flights]);
  const openStat = MAX_STATS.find((s) => s.id === openStatId) || null;
  return /* @__PURE__ */ React.createElement("div", { style: { padding: "4px 16px 14px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "rgba(232,244,253,0.4)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 } }, "Maximalwerte"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 } }, MAX_STATS.map((s) => {
    const best = ranked[s.id][0];
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: s.id,
        onClick: () => best && setOpenStatId(s.id),
        disabled: !best,
        style: { textAlign: "left", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "10px 12px", cursor: best ? "pointer" : "default", opacity: best ? 1 : 0.5 }
      },
      /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.5)", marginBottom: 4 } }, s.icon, " ", s.label),
      /* @__PURE__ */ React.createElement("div", { style: { fontSize: 18, fontWeight: 800, color: "#7dd3fc" } }, best ? s.format(best.value) : "—"),
      /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, best ? `${best.flight.date} · ${best.flight.site || "—"}` : "Keine Daten")
    );
  })), openStat && /* @__PURE__ */ React.createElement(TopFlightsModal, { stat: openStat, ranked: ranked[openStat.id], onClose: () => setOpenStatId(null) }));
}
function UebersichtPivotTable({ pivot }) {
  const cols = "minmax(0,0.7fr) minmax(0,0.55fr) minmax(0,0.55fr) minmax(0,0.75fr) minmax(0,1.05fr) minmax(0,0.95fr)";
  const cellStyle = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  return /* @__PURE__ */ React.createElement("div", { style: { padding: "0 16px" } }, /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, overflow: "hidden", overflowY: "auto", maxHeight: "60vh" } }, /* @__PURE__ */ React.createElement("div", { style: { ...stickyHeaderRow(), display: "grid", gridTemplateColumns: cols, background: STICKY_BG_HEADER, borderBottom: "1px solid rgba(255,255,255,0.1)" } }, ["Jahr", "Flüge", "Tage", "Flüge/Tag", "Minuten", "Schnitt"].map((h, i) => /* @__PURE__ */ React.createElement("div", { key: h, style: { ...i === 0 ? stickyCol(STICKY_BG_HEADER) : {}, ...cellStyle, padding: "3px 4px", fontSize: 10, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.3, textAlign: i === 0 ? "left" : "right" } }, h))), pivot.rows.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "24px 12px", textAlign: "center", fontSize: 13, color: "rgba(232,244,253,0.4)" } }, "Keine Flüge für diese Filterauswahl."), pivot.rows.map((r) => /* @__PURE__ */ React.createElement("div", { key: r.year, style: { display: "grid", gridTemplateColumns: cols, borderBottom: "1px solid rgba(255,255,255,0.05)" } }, /* @__PURE__ */ React.createElement("div", { style: { ...stickyCol(STICKY_BG_ROW), ...cellStyle, padding: "3px 4px", fontSize: 12, fontWeight: 700, color: "#7dd3fc" } }, r.year), /* @__PURE__ */ React.createElement("div", { style: { ...cellStyle, padding: "3px 4px", fontSize: 12, textAlign: "right" } }, r.flights), /* @__PURE__ */ React.createElement("div", { style: { ...cellStyle, padding: "3px 4px", fontSize: 12, textAlign: "right" } }, r.days), /* @__PURE__ */ React.createElement("div", { style: { ...cellStyle, padding: "3px 4px", fontSize: 12, textAlign: "right", color: "rgba(232,244,253,0.7)" } }, r.days ? (r.flights / r.days).toFixed(1) : "—"), /* @__PURE__ */ React.createElement("div", { style: { ...cellStyle, padding: "3px 4px", fontSize: 12, textAlign: "right" } }, formatMinutes(r.minutes)), /* @__PURE__ */ React.createElement("div", { style: { ...cellStyle, padding: "3px 4px", fontSize: 12, textAlign: "right", color: "rgba(232,244,253,0.7)" } }, formatMinutes(r.minutes / r.flights)))), pivot.rows.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: cols, background: "rgba(125,211,252,0.08)" } }, /* @__PURE__ */ React.createElement("div", { style: { ...stickyCol(STICKY_BG_TOTAL), ...cellStyle, padding: "3px 4px", fontSize: 12, fontWeight: 800 } }, "Gesamt"), /* @__PURE__ */ React.createElement("div", { style: { ...cellStyle, padding: "3px 4px", fontSize: 12, fontWeight: 800, textAlign: "right" } }, pivot.total.flights), /* @__PURE__ */ React.createElement("div", { style: { ...cellStyle, padding: "3px 4px", fontSize: 12, fontWeight: 800, textAlign: "right" } }, pivot.total.days), /* @__PURE__ */ React.createElement("div", { style: { ...cellStyle, padding: "3px 4px", fontSize: 12, fontWeight: 800, textAlign: "right" } }, pivot.total.days ? (pivot.total.flights / pivot.total.days).toFixed(1) : "—"), /* @__PURE__ */ React.createElement("div", { style: { ...cellStyle, padding: "3px 4px", fontSize: 12, fontWeight: 800, textAlign: "right" } }, formatMinutes(pivot.total.minutes)), /* @__PURE__ */ React.createElement("div", { style: { ...cellStyle, padding: "3px 4px", fontSize: 12, fontWeight: 800, textAlign: "right", color: "#7dd3fc" } }, formatMinutes(pivot.total.minutes / pivot.total.flights)))));
}
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const PISTACHIO_EVENT_COLOR_ID = "10";
const PISTACHIO_HEX = ["#7bd148", "#0b8043"];
const REISEANALYSE_START_YEAR = 2024;
const DAY_MS = 24 * 3600 * 1e3;
function isPistachioHex(hex) {
  return !!hex && PISTACHIO_HEX.includes(hex.toLowerCase());
}
async function fetchCalendarList(accessToken) {
  const resp = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Google Kalenderliste: HTTP ${resp.status}${body ? " — " + body.slice(0, 200) : ""}`);
  }
  const data = await resp.json();
  return (data.items || []).filter((c) => c.accessRole !== "freeBusyReader");
}
function loadGsiScript() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 8e3;
    (function poll() {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("Google Identitätsdienst konnte nicht geladen werden (accounts.google.com blockiert?)."));
        return;
      }
      setTimeout(poll, 150);
    })();
  });
}
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
function tripEndExclusiveUTC(trip) {
  const [y, m, d] = trip.endDate.split("-").map(Number);
  let t = Date.UTC(y, m - 1, d);
  if (!trip.allDay) t += DAY_MS;
  return t;
}
function daysOfTripInYear(trip, year) {
  const start = tripStartUTC(trip), endEx = tripEndExclusiveUTC(trip);
  const yearStart = Date.UTC(year, 0, 1), yearEndEx = Date.UTC(year + 1, 0, 1);
  const clipStart = Math.max(start, yearStart), clipEnd = Math.min(endEx, yearEndEx);
  return Math.max(0, Math.round((clipEnd - clipStart) / DAY_MS));
}
function formatTripRange(startDate, endDate) {
  const fmt = (s) => {
    const [y, m, d] = s.split("-");
    return `${d}.${m}.${y}`;
  };
  return startDate === endDate ? fmt(startDate) : `${fmt(startDate)} – ${fmt(endDate)}`;
}
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
    events.push(...data.items || []);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return events;
}
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
      const isTrip = pistachioLabelId && ev.eventLabelId === pistachioLabelId || ev.colorId === PISTACHIO_EVENT_COLOR_ID || !ev.colorId && calPistachio;
      if (!isTrip) continue;
      const startDate = ev.start?.date || (ev.start?.dateTime || "").slice(0, 10);
      const endDate = ev.end?.date || (ev.end?.dateTime || "").slice(0, 10);
      if (!startDate || !endDate) continue;
      trips.push({ id: `${cal.id}:${ev.id}`, title: ev.summary || "(ohne Titel)", startDate, endDate, allDay: !!ev.start?.date });
    }
  }
  return trips;
}
const BUDGET_STATE_KEY = "budgetprojektion.state.v2";
const BUDGET_META_KEY = "budgetprojektion.backupmeta.v1";
const COST_BUFFER_DAYS = 10;
const NO_TRIP = "keine";
function readBudgetState() {
  try {
    const raw = localStorage.getItem(BUDGET_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function isoToUTC(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function classifyBooking(datum, trips) {
  const t = isoToUTC(datum);
  const inside = trips.filter((tr) => t >= tripStartUTC(tr) && t < tripEndExclusiveUTC(tr));
  if (inside.length === 1) return { status: "innen", trip: inside[0] };
  if (inside.length > 1) return { status: "mehrdeutig" };
  const buf = COST_BUFFER_DAYS * DAY_MS;
  const near = trips.filter((tr) => t >= tripStartUTC(tr) - buf && t < tripEndExclusiveUTC(tr) + buf);
  if (near.length === 1) return { status: "puffer", trip: near[0] };
  if (near.length > 1) return { status: "mehrdeutig" };
  return { status: "ausserhalb" };
}
function normAssign(v) {
  if (!v) return {};
  if (typeof v === "string") return { trip: v };
  return v;
}
function computeFlightCosts(trips, manual) {
  const empty = { available: false, byTrip: /* @__PURE__ */ new Map(), bookingsByTrip: /* @__PURE__ */ new Map(), open: [], all: [] };
  const st = readBudgetState();
  if (!st) return empty;
  const unter = (st.unterkategorien || []).filter((u) => u.name === "Flugreisen").map((u) => u.id);
  const byTrip = /* @__PURE__ */ new Map(), open = [], bookingsByTrip = /* @__PURE__ */ new Map(), all = [];
  const add = (tripId, b) => {
    byTrip.set(tripId, (byTrip.get(tripId) || 0) - (b.betragChf || 0));
    if (!bookingsByTrip.has(tripId)) bookingsByTrip.set(tripId, []);
    bookingsByTrip.get(tripId).push(b);
  };
  for (const b of st.realTransaktionen || []) {
    if (!unter.includes(b.unterkategorieId) || !b.datum) continue;
    const m = normAssign(manual[b.id]);
    const ok = !!m.ok;
    if (Array.isArray(m.split) && m.split.length) {
      const sign = (b.betragChf || 0) < 0 ? -1 : 1;
      let sum = 0;
      for (const part of m.split) {
        if (!trips.some((tr) => tr.id === part.trip)) continue;
        sum += part.chf;
        add(part.trip, { ...b, betragChf: sign * part.chf, name: `${b.name || ""} (Rechnung ${part.inv})`.trim() });
      }
      const ids = m.split.map((x) => x.trip).filter((id) => trips.some((tr) => tr.id === id));
      all.push({ b, tripId: ids[0] || null, tripIds: ids, status: "geteilt", ok, split: m.split, rest: Math.abs(b.betragChf || 0) - sum });
      continue;
    }
    if (m.trip === NO_TRIP) {
      all.push({ b, tripId: null, status: "keine", ok });
      continue;
    }
    if (m.trip && trips.some((tr) => tr.id === m.trip)) {
      add(m.trip, b);
      all.push({ b, tripId: m.trip, status: "manuell", ok });
      continue;
    }
    const k = classifyBooking(b.datum, trips);
    if (k.status === "innen") {
      add(k.trip.id, b);
      all.push({ b, tripId: k.trip.id, status: "automatisch", ok });
    } else {
      open.push({ b, k });
      all.push({ b, tripId: null, status: "offen", ok });
    }
  }
  open.sort((x, y) => x.b.datum.localeCompare(y.b.datum));
  bookingsByTrip.forEach((list) => list.sort((x, y) => x.datum.localeCompare(y.datum)));
  return { available: true, byTrip, bookingsByTrip, open, all };
}
function writeBookingDate(id, datum) {
  try {
    const st = readBudgetState();
    const b = st && (st.realTransaktionen || []).find((t) => t.id === id);
    if (!b) return false;
    if (!b.datumOriginal) b.datumOriginal = b.datum;
    b.datum = datum;
    localStorage.setItem(BUDGET_STATE_KEY, JSON.stringify(st));
    try {
      const meta = JSON.parse(localStorage.getItem(BUDGET_META_KEY) || "{}");
      meta.dirty = true;
      localStorage.setItem(BUDGET_META_KEY, JSON.stringify(meta));
    } catch {
    }
    return true;
  } catch {
    return false;
  }
}
function formatChf(v) {
  return new Intl.NumberFormat("de-CH", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(v));
}
function formatIsoDe(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
function dayDistance(datum, trip) {
  const t = isoToUTC(datum), s = tripStartUTC(trip), e = tripEndExclusiveUTC(trip);
  if (t < s) return Math.round((s - t) / DAY_MS);
  if (t >= e) return Math.round((t - e) / DAY_MS) + 1;
  return 0;
}
const STATUS_LABEL = { offen: "Offen", manuell: "Manuell", automatisch: "Automatisch", geteilt: "Geteilt", keine: "Keine Reisekosten" };
const STATUS_COLOR = { offen: "#fbbf24", manuell: "#7dd3fc", automatisch: "#4ade80", geteilt: "#c4b5fd", keine: "rgba(232,244,253,0.5)" };
function AssignEditModal({ row, trips, onSave, onClose }) {
  const { b } = row;
  const cur = row.status === "manuell" ? row.tripId : row.status === "keine" ? NO_TRIP : row.status === "geteilt" ? "__split" : "";
  const [datum, setDatum] = React.useState(b.datum);
  const [tripId, setTripId] = React.useState(cur);
  const [ok, setOk] = React.useState(row.ok);
  const sorted = React.useMemo(
    () => [...trips].sort((x, y) => dayDistance(datum, x) - dayDistance(datum, y)),
    [trips, datum]
  );
  const field = { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "8px 10px", color: "#e8f4fd", fontSize: 13, colorScheme: "dark", width: "100%", boxSizing: "border-box" };
  const lbl = { fontSize: 11, color: "rgba(232,244,253,0.5)", margin: "10px 0 4px" };
  const btn = (primary) => ({ background: primary ? "rgba(125,211,252,0.2)" : "rgba(255,255,255,0.08)", border: "1px solid " + (primary ? "rgba(125,211,252,0.4)" : "rgba(255,255,255,0.15)"), borderRadius: 8, padding: "8px 14px", color: primary ? "#7dd3fc" : "#e8f4fd", fontSize: 12, fontWeight: 700, cursor: "pointer" });
  return /* @__PURE__ */ React.createElement("div", { onClick: onClose, style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-end", justifyContent: "center" } }, /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: (e) => e.stopPropagation(),
      style: { width: "100%", maxWidth: 520, maxHeight: "85vh", overflowY: "auto", background: "#0f1f33", borderTop: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px 16px 0 0", padding: "16px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 800 } }, "Zuordnung bearbeiten"), /* @__PURE__ */ React.createElement("button", { onClick: onClose, style: { background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 8, width: 28, height: 28, color: "#e8f4fd", fontSize: 15, cursor: "pointer" } }, "✕")),
    /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8, fontSize: 13, fontWeight: 700 } }, b.name || "(ohne Bezeichnung)"),
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 700, color: b.betragChf < 0 ? "#f87171" : "#4ade80" } }, "CHF ", formatChf(b.betragChf)),
    /* @__PURE__ */ React.createElement("div", { style: lbl }, "Buchungsdatum", datum !== b.datum ? ` (Original im Budget: ${formatIsoDe(b.datum)})` : ""),
    /* @__PURE__ */ React.createElement("input", { type: "date", value: datum, onChange: (e) => setDatum(e.target.value), style: field }),
    /* @__PURE__ */ React.createElement("div", { style: lbl }, "Reise"),
    /* @__PURE__ */ React.createElement("select", { value: tripId, onChange: (e) => setTripId(e.target.value), style: field }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Automatisch (nach Buchungsdatum)"), row.status === "geteilt" && /* @__PURE__ */ React.createElement("option", { value: "__split" }, "Geteilt auf mehrere Reisen (aus Rechnungen)"), sorted.map((tr) => /* @__PURE__ */ React.createElement("option", { key: tr.id, value: tr.id }, tr.title, " (", formatTripRange(tr.startDate, tr.endDate), ")")), /* @__PURE__ */ React.createElement("option", { value: NO_TRIP }, "Keine Reisekosten")),
    /* @__PURE__ */ React.createElement("label", { style: { display: "flex", alignItems: "center", gap: 8, margin: "14px 0", fontSize: 13, cursor: "pointer" } }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: ok, onChange: (e) => setOk(e.target.checked), style: { width: 18, height: 18 } }), " Geprüft"),
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("button", { onClick: () => {
      onSave(b, { datum: b.datum, tripId: "", ok: false });
      onClose();
    }, style: btn(false) }, "Zurücksetzen"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement("button", { onClick: onClose, style: btn(false) }, "Abbrechen"), /* @__PURE__ */ React.createElement("button", { onClick: () => {
      onSave(b, { datum, tripId: tripId === "__split" ? void 0 : tripId, ok });
      onClose();
    }, disabled: !datum, style: btn(true) }, "Speichern")))
  ));
}
function AssignListModal({ all, trips, onSave, onClose }) {
  const [status, setStatus] = React.useState("alle");
  const [checked, setChecked] = React.useState("alle");
  const [year, setYear] = React.useState("alle");
  const [q, setQ] = React.useState("");
  const [sortBy, setSortBy] = React.useState("datum");
  const [desc, setDesc] = React.useState(true);
  const [edit, setEdit] = React.useState(null);
  const tripOf = (id) => trips.find((t) => t.id === id);
  const tripsText = (r) => (r.tripIds || [r.tripId]).map((id) => tripOf(id)?.title).filter(Boolean).join(", ");
  const years = [...new Set(all.map((r) => r.b.datum.slice(0, 4)))].sort().reverse();
  const shown = all.filter((r) => {
    if (status !== "alle" && r.status !== status) return false;
    if (checked === "ja" && !r.ok) return false;
    if (checked === "nein" && r.ok) return false;
    if (year !== "alle" && r.b.datum.slice(0, 4) !== year) return false;
    if (q.trim()) {
      const hay = ((r.b.name || "") + " " + tripsText(r)).toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });
  const key = (r) => sortBy === "betrag" ? r.b.betragChf || 0 : sortBy === "reise" ? (tripsText(r) || "￿").toLowerCase() : sortBy === "status" ? r.status : sortBy === "geprueft" ? r.ok ? 1 : 0 : r.b.datum;
  shown.sort((x, y) => {
    const a = key(x), b = key(y);
    const c = a < b ? -1 : a > b ? 1 : x.b.datum.localeCompare(y.b.datum);
    return desc ? -c : c;
  });
  const editRow = edit && all.find((r) => r.b.id === edit);
  const field = { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px 8px", color: "#e8f4fd", fontSize: 12, colorScheme: "dark" };
  return /* @__PURE__ */ React.createElement("div", { onClick: onClose, style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" } }, /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: (e) => e.stopPropagation(),
      style: { width: "100%", maxWidth: 640, maxHeight: "90vh", overflowY: "auto", background: "#0f1f33", borderTop: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px 16px 0 0", padding: "16px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 800 } }, "✈ Zuordnungen (", shown.length, "/", all.length, ")"), /* @__PURE__ */ React.createElement("button", { onClick: onClose, style: { background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 8, width: 28, height: 28, color: "#e8f4fd", fontSize: 15, cursor: "pointer" } }, "✕")),
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 } }, /* @__PURE__ */ React.createElement("input", { value: q, onChange: (e) => setQ(e.target.value), placeholder: "Suche…", style: { ...field, flex: 1, minWidth: 100 } }), /* @__PURE__ */ React.createElement("select", { value: status, onChange: (e) => setStatus(e.target.value), style: field }, /* @__PURE__ */ React.createElement("option", { value: "alle" }, "Alle Status"), Object.keys(STATUS_LABEL).map((k) => /* @__PURE__ */ React.createElement("option", { key: k, value: k }, STATUS_LABEL[k]))), /* @__PURE__ */ React.createElement("select", { value: checked, onChange: (e) => setChecked(e.target.value), style: field }, /* @__PURE__ */ React.createElement("option", { value: "alle" }, "Geprüft: alle"), /* @__PURE__ */ React.createElement("option", { value: "ja" }, "Geprüft"), /* @__PURE__ */ React.createElement("option", { value: "nein" }, "Nicht geprüft")), /* @__PURE__ */ React.createElement("select", { value: year, onChange: (e) => setYear(e.target.value), style: field }, /* @__PURE__ */ React.createElement("option", { value: "alle" }, "Alle Jahre"), years.map((y) => /* @__PURE__ */ React.createElement("option", { key: y, value: y }, y))), /* @__PURE__ */ React.createElement("select", { value: sortBy, onChange: (e) => setSortBy(e.target.value), style: field }, /* @__PURE__ */ React.createElement("option", { value: "datum" }, "Sortieren: Datum"), /* @__PURE__ */ React.createElement("option", { value: "betrag" }, "Sortieren: Betrag"), /* @__PURE__ */ React.createElement("option", { value: "reise" }, "Sortieren: Reise"), /* @__PURE__ */ React.createElement("option", { value: "status" }, "Sortieren: Status"), /* @__PURE__ */ React.createElement("option", { value: "geprueft" }, "Sortieren: Geprüft")), /* @__PURE__ */ React.createElement("button", { onClick: () => setDesc((d) => !d), title: "Sortierrichtung", style: { ...field, cursor: "pointer" } }, desc ? "↓" : "↑")),
    shown.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "20px 0", textAlign: "center", fontSize: 13, color: "rgba(232,244,253,0.5)" } }, "Keine Zuordnungen für diesen Filter."),
    shown.map((r) => {
      const tr = tripOf(r.tripId);
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          key: r.b.id,
          onClick: () => setEdit(r.b.id),
          style: { display: "flex", alignItems: "center", gap: 10, padding: "9px 4px", borderBottom: "1px solid rgba(255,255,255,0.08)", cursor: "pointer" }
        },
        /* @__PURE__ */ React.createElement(
          "input",
          {
            type: "checkbox",
            checked: r.ok,
            title: "Geprüft",
            onClick: (e) => e.stopPropagation(),
            onChange: (e) => onSave(r.b, { datum: r.b.datum, ok: e.target.checked }),
            style: { width: 18, height: 18, flexShrink: 0 }
          }
        ),
        /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, formatIsoDe(r.b.datum), " · ", r.b.name || "(ohne Bezeichnung)"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 700, flexShrink: 0, color: r.b.betragChf < 0 ? "#f87171" : "#4ade80" } }, formatChf(r.b.betragChf))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, /* @__PURE__ */ React.createElement("span", { style: { color: STATUS_COLOR[r.status], fontWeight: 700 } }, STATUS_LABEL[r.status]), r.status === "geteilt" ? ` · ${tripsText(r)}${Math.abs(r.rest) > 0.5 ? ` · Rest ${formatChf(r.rest)} nicht zugeordnet` : ""}` : tr ? ` · ${tr.title} (${formatTripRange(tr.startDate, tr.endDate)})` : ""))
      );
    })
  ), editRow && /* @__PURE__ */ React.createElement(AssignEditModal, { key: editRow.b.id + editRow.b.datum, row: editRow, trips, onSave, onClose: () => setEdit(null) }));
}
function CostAssignRow({ item, trips, onSave }) {
  const { b, k } = item;
  const [datum, setDatum] = React.useState(b.datum);
  const [tripId, setTripId] = React.useState(k.status === "puffer" ? k.trip.id : "");
  const sorted = React.useMemo(
    () => [...trips].sort((x, y) => dayDistance(b.datum, x) - dayDistance(b.datum, y)),
    [trips, b.datum]
  );
  const hint = k.status === "puffer" ? `${dayDistance(b.datum, k.trip)} Tage ${isoToUTC(b.datum) < tripStartUTC(k.trip) ? "vor" : "nach"} «${k.trip.title}»` : k.status === "mehrdeutig" ? "passt zu mehreren Reisen" : "keiner Reise zuordenbar";
  const field = { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "7px 8px", color: "#e8f4fd", fontSize: 13, colorScheme: "dark" };
  return /* @__PURE__ */ React.createElement("div", { style: { padding: "10px 4px", borderBottom: "1px solid rgba(255,255,255,0.08)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, b.name || "(ohne Bezeichnung)"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 700, color: b.betragChf < 0 ? "#f87171" : "#4ade80", flexShrink: 0 } }, formatChf(b.betragChf))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.45)", marginBottom: 6 } }, hint), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } }, /* @__PURE__ */ React.createElement("input", { type: "date", value: datum, onChange: (e) => setDatum(e.target.value), style: field }), /* @__PURE__ */ React.createElement("select", { value: tripId, onChange: (e) => setTripId(e.target.value), style: { ...field, flex: 1, minWidth: 140 } }, /* @__PURE__ */ React.createElement("option", { value: "" }, "– Reise wählen –"), sorted.map((tr) => /* @__PURE__ */ React.createElement("option", { key: tr.id, value: tr.id }, tr.title, " (", formatTripRange(tr.startDate, tr.endDate), ")")), /* @__PURE__ */ React.createElement("option", { value: NO_TRIP }, "Keine Reisekosten")), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => onSave(b, datum, tripId),
      disabled: !datum,
      style: { background: "rgba(125,211,252,0.15)", border: "1px solid rgba(125,211,252,0.3)", borderRadius: 8, padding: "7px 12px", color: "#7dd3fc", fontSize: 12, fontWeight: 700, cursor: "pointer" }
    },
    "Übernehmen"
  )));
}
function CostAssignModal({ open, trips, onSave, onClose }) {
  return /* @__PURE__ */ React.createElement("div", { onClick: onClose, style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" } }, /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: (e) => e.stopPropagation(),
      style: { width: "100%", maxWidth: 520, maxHeight: "85vh", overflowY: "auto", background: "#0f1f33", borderTop: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px 16px 0 0", padding: "16px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 800 } }, "✈ Flugreisekosten zuordnen (", open.length, " offen)"), /* @__PURE__ */ React.createElement("button", { onClick: onClose, style: { background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 8, width: 28, height: 28, color: "#e8f4fd", fontSize: 15, cursor: "pointer" } }, "✕")),
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.45)", marginBottom: 8 } }, "Buchungen der Unterkategorie „Flugreisen“ ausserhalb einer Reise (Puffer: ", COST_BUFFER_DAYS, " Tage davor/danach). Eine Datumsänderung wird in die Buchung im Budget übernommen."),
    open.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "20px 0", textAlign: "center", fontSize: 13, color: "rgba(232,244,253,0.5)" } }, "Alle Flugreisekosten sind zugeordnet. ✓"),
    open.map((item) => /* @__PURE__ */ React.createElement(CostAssignRow, { key: item.b.id + item.b.datum, item, trips, onSave }))
  ));
}
function computeReiseanalysePivot(trips, flights, costs) {
  const parsedFlights = flights.map((f) => ({ f, dateUTC: parseFlightDateUTC(f) })).filter((x) => x.dateUTC !== null);
  const currentYear = (/* @__PURE__ */ new Date()).getFullYear();
  const years = /* @__PURE__ */ new Set();
  for (let y = REISEANALYSE_START_YEAR; y <= currentYear; y++) years.add(y);
  trips.forEach((t) => {
    const startY = new Date(tripStartUTC(t)).getUTCFullYear();
    const lastDayY = new Date(tripEndExclusiveUTC(t) - DAY_MS).getUTCFullYear();
    for (let y = Math.max(startY, REISEANALYSE_START_YEAR); y <= lastDayY; y++) years.add(y);
  });
  const yearList = [...years].sort((a, b) => a - b);
  const rows = yearList.map((year) => {
    const tripRows = [];
    for (const t of trips) {
      const days = daysOfTripInYear(t, year);
      if (days <= 0) continue;
      const start = tripStartUTC(t), endEx = tripEndExclusiveUTC(t);
      const minutes = parsedFlights.filter((x) => x.dateUTC >= start && x.dateUTC < endEx && new Date(x.dateUTC).getUTCFullYear() === year).reduce((acc, x) => acc + (x.f.durationSec || 0) / 60, 0);
      const cost = t.startDate.slice(0, 4) === String(year) ? costs.byTrip.get(t.id) || 0 : 0;
      tripRows.push({ id: t.id, title: t.title, days, minutes, cost, bookings: costs.bookingsByTrip.get(t.id) || [], startDate: t.startDate, endDate: t.endDate });
    }
    tripRows.sort((a, b) => a.startDate.localeCompare(b.startDate));
    return {
      year,
      days: tripRows.reduce((acc, r) => acc + r.days, 0),
      minutes: tripRows.reduce((acc, r) => acc + r.minutes, 0),
      cost: tripRows.reduce((acc, r) => acc + r.cost, 0),
      trips: tripRows
    };
  });
  const total = rows.reduce((acc, r) => ({ days: acc.days + r.days, minutes: acc.minutes + r.minutes, cost: acc.cost + r.cost }), { days: 0, minutes: 0, cost: 0 });
  return { rows, total };
}
function ReiseanalysePivotTable({ pivot, onOpenYear }) {
  const cols = "minmax(0,0.7fr) minmax(0,0.9fr) minmax(0,1fr) minmax(0,1.1fr)";
  const cellStyle = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  return /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: cols, background: STICKY_BG_HEADER, borderBottom: "1px solid rgba(255,255,255,0.1)" } }, ["Jahr", "Reisetage", "Flugminuten", "Flugkosten"].map((h, i) => /* @__PURE__ */ React.createElement("div", { key: h, style: { ...cellStyle, padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.6)", textTransform: "uppercase", letterSpacing: 0.5, textAlign: i === 0 ? "left" : "right" } }, h))), pivot.rows.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "24px 12px", textAlign: "center", fontSize: 13, color: "rgba(232,244,253,0.4)" } }, "Keine pistazienfarbigen Kalendereinträge gefunden."), pivot.rows.map((r) => /* @__PURE__ */ React.createElement(
    "div",
    {
      key: r.year,
      onClick: () => r.trips.length && onOpenYear(r.year),
      style: { display: "grid", gridTemplateColumns: cols, borderBottom: "1px solid rgba(255,255,255,0.05)", cursor: r.trips.length ? "pointer" : "default" }
    },
    /* @__PURE__ */ React.createElement("div", { style: { ...cellStyle, padding: "9px 10px", fontSize: 14, fontWeight: 700, color: "#7dd3fc" } }, r.year, r.trips.length ? " ›" : ""),
    /* @__PURE__ */ React.createElement("div", { style: { ...cellStyle, padding: "9px 10px", fontSize: 14, textAlign: "right", color: r.days ? "#e8f4fd" : "rgba(232,244,253,0.25)" } }, r.days || "·"),
    /* @__PURE__ */ React.createElement("div", { style: { ...cellStyle, padding: "9px 10px", fontSize: 14, textAlign: "right", color: r.minutes ? "#e8f4fd" : "rgba(232,244,253,0.25)" } }, r.minutes ? formatMinutes(r.minutes) : "·"),
    /* @__PURE__ */ React.createElement("div", { style: { ...cellStyle, padding: "9px 10px", fontSize: 14, textAlign: "right", color: r.cost ? "#e8f4fd" : "rgba(232,244,253,0.25)" } }, r.cost ? formatChf(r.cost) : "·")
  )), pivot.rows.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: cols, background: "rgba(125,211,252,0.08)" } }, /* @__PURE__ */ React.createElement("div", { style: { ...cellStyle, padding: "9px 10px", fontSize: 14, fontWeight: 800 } }, "Gesamt"), /* @__PURE__ */ React.createElement("div", { style: { ...cellStyle, padding: "9px 10px", fontSize: 14, fontWeight: 800, textAlign: "right" } }, pivot.total.days), /* @__PURE__ */ React.createElement("div", { style: { ...cellStyle, padding: "9px 10px", fontSize: 14, fontWeight: 800, textAlign: "right", color: "#7dd3fc" } }, formatMinutes(pivot.total.minutes)), /* @__PURE__ */ React.createElement("div", { style: { ...cellStyle, padding: "9px 10px", fontSize: 14, fontWeight: 800, textAlign: "right", color: "#7dd3fc" } }, pivot.total.cost ? formatChf(pivot.total.cost) : "·")));
}
function ReiseDrilldownModal({ row, onClose }) {
  const [expanded, setExpanded] = React.useState(null);
  return /* @__PURE__ */ React.createElement("div", { onClick: onClose, style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" } }, /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: (e) => e.stopPropagation(),
      style: { width: "100%", maxWidth: 480, maxHeight: "80vh", overflowY: "auto", background: "#0f1f33", borderTop: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px 16px 0 0", padding: "16px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 800 } }, "🧳 Reisen ", row.year), /* @__PURE__ */ React.createElement("button", { onClick: onClose, style: { background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 8, width: 28, height: 28, color: "#e8f4fd", fontSize: 15, cursor: "pointer" } }, "✕")),
    row.trips.map((t, i) => /* @__PURE__ */ React.createElement("div", { key: t.id, style: { borderBottom: i < row.trips.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none" } }, /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: () => t.bookings.length && setExpanded(expanded === t.id ? null : t.id),
        style: { display: "flex", alignItems: "center", gap: 10, padding: "7px 4px", cursor: t.bookings.length ? "pointer" : "default" }
      },
      /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t.title, t.bookings.length ? expanded === t.id ? " ▾" : " ▸" : ""), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)" } }, formatTripRange(t.startDate, t.endDate))),
      /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, textAlign: "right" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 700, color: "#7dd3fc" } }, t.days, " ", t.days === 1 ? "Tag" : "Tage"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.5)" } }, t.minutes ? formatMinutes(t.minutes) : "0h 00m"), t.cost ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.5)" } }, "CHF ", formatChf(t.cost)) : null)
    ), expanded === t.id && /* @__PURE__ */ React.createElement("div", { style: { margin: "0 4px 8px", padding: "6px 8px", background: "rgba(255,255,255,0.04)", borderRadius: 8 } }, t.bookings.map((b) => /* @__PURE__ */ React.createElement("div", { key: b.id, style: { display: "flex", gap: 8, padding: "3px 0", fontSize: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, color: "rgba(232,244,253,0.5)" } }, formatIsoDe(b.datum)), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, b.name || "(ohne Bezeichnung)"), /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, fontWeight: 600, color: b.betragChf < 0 ? "#f87171" : "#4ade80" } }, formatChf(b.betragChf)))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginTop: 4, paddingTop: 4, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 12, fontWeight: 700 } }, /* @__PURE__ */ React.createElement("span", null, "Total (", t.bookings.length, " ", t.bookings.length === 1 ? "Buchung" : "Buchungen", ")"), /* @__PURE__ */ React.createElement("span", null, "CHF ", formatChf(t.bookings.reduce((a, x) => a - (x.betragChf || 0), 0)))))))
  ));
}
const FWA2025_FLAG_KEY = "reiseanalyse:fwa2025Korrektur";
const FWA2025_FIXES = [
  { id: "13235d7a-d233-4dce-891c-595dd1fe845c", note: "3823 = Rechnung 1938 + 1984", split: [
    { inv: "1938", title: "Bologna-Rom", start: "2025-03-27", chf: 1890 },
    { inv: "1984", title: "Rom-Napoli", start: "2025-04-03", chf: 1933 }
  ] },
  { id: "876c0949-1fac-43ab-92b8-239d20794bf1", note: "2928 = Malaga-Lissabon", trip: { title: "Malaga-Lissabon", start: "2025-05-21" } },
  { id: "5f916bd0-0f13-4a0c-b8b7-5f838b2d2229", note: "2595 = Baltikum 1 (Litauen)", trip: { title: "Litauen", start: "2025-06-12" } },
  { id: "229a4bc3-7aca-4357-8e36-fd14873dff68", note: "3450 = Rechnung 1926 + 1927", split: [
    { inv: "1926", title: "Abruzzen 1", start: "2025-10-04", chf: 1725 },
    { inv: "1927", title: "Abruzzen 2", start: "2025-10-11", chf: 1725 }
  ] },
  { id: "9fd7a429-f8c4-4ff5-8edb-40fd0fb78c31", note: "4105 = Rechnung 3568 + 3569", split: [
    { inv: "3568", title: "Pyrenäen", start: "2025-08-30", chf: 2300 },
    { inv: "3569", title: "Nordspanien", start: "2025-09-06", chf: 1805 }
  ] },
  { id: "35d4289b-6b4d-40e8-ac9d-f894e5632755", note: "3490 = Pampa (nicht angetreten, Gutschrift)", trip: NO_TRIP }
];
function buildFwa2025Fixes(trips, manual) {
  const st = readBudgetState();
  if (!st) throw new Error("Budget-Daten nicht gefunden (gleicher Browser/Origin nötig).");
  const findTrip = ({ title, start }) => {
    const t = trips.find((tr) => tr.title === title && tr.startDate === start);
    if (!t) throw new Error(`Reise «${title}» (${start}) fehlt im Kalender-Cache — erst synchronisieren.`);
    return t.id;
  };
  const next = { ...manual };
  for (const f of FWA2025_FIXES) {
    const b = (st.realTransaktionen || []).find((t) => t.id === f.id);
    if (!b) throw new Error(`Buchung nicht im Budget gefunden (${f.note}).`);
    const old = normAssign(manual[f.id]);
    const entry = {};
    if (f.split) entry.split = f.split.map((p) => ({ inv: p.inv, trip: findTrip(p), chf: p.chf }));
    else entry.trip = f.trip === NO_TRIP ? NO_TRIP : findTrip(f.trip);
    if (old.ok) entry.ok = true;
    next[f.id] = entry;
  }
  return { next, count: FWA2025_FIXES.length };
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
  const [manual, setManual] = React.useState({});
  const [budgetTick, setBudgetTick] = React.useState(0);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [listOpen, setListOpen] = React.useState(false);
  const [fixDone, setFixDone] = React.useState(true);
  React.useEffect(() => {
    (async () => {
      try {
        const fl = await window.storage.get(FWA2025_FLAG_KEY);
        setFixDone(!!fl?.value);
      } catch {
      }
      try {
        const [ci, cal, lbl, cache, zu] = await Promise.all([
          window.storage.get("settings:googleClientId"),
          window.storage.get("settings:googleCalendarId"),
          window.storage.get("settings:googlePistachioLabelId"),
          window.storage.get("reiseanalyse:tripsCache"),
          window.storage.get("reiseanalyse:kostenZuordnung")
        ]);
        try {
          if (zu?.value) setManual(JSON.parse(zu.value) || {});
        } catch {
        }
        if (ci?.value) setClientId(ci.value);
        if (cal?.value) setCalendarId(cal.value);
        if (lbl?.value) setPistachioLabelId(lbl.value);
        if (cache?.value) {
          try {
            const parsed = JSON.parse(cache.value);
            if (Array.isArray(parsed.trips)) {
              setTrips(parsed.trips);
              setFetchedAt(parsed.fetchedAt || null);
            }
          } catch {
          }
        }
      } catch {
      }
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
            if (resp.error) reject(new Error(resp.error));
            else resolve(resp.access_token);
          },
          error_callback: (err) => reject(new Error(err?.message || "Google-Anmeldung abgebrochen."))
        });
        client.requestAccessToken();
      });
      const trimmedCalendarId = (calendarId || "").trim();
      const calendars = trimmedCalendarId && trimmedCalendarId !== "primary" ? [{ id: trimmedCalendarId, summary: trimmedCalendarId, backgroundColor: null }] : await fetchCalendarList(accessToken);
      const fetchedTrips = await fetchPistachioTrips(accessToken, calendars, pistachioLabelId.trim());
      const iso = (/* @__PURE__ */ new Date()).toISOString();
      setTrips(fetchedTrips);
      setFetchedAt(iso);
      await window.storage.set("reiseanalyse:tripsCache", JSON.stringify({ fetchedAt: iso, calendarId, trips: fetchedTrips }));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };
  const costs = React.useMemo(() => computeFlightCosts(trips, manual), [trips, manual, budgetTick]);
  const pivot = React.useMemo(() => computeReiseanalysePivot(trips, flights, costs), [trips, flights, costs]);
  const saveAssign = async (b, { datum, tripId, ok, split }) => {
    if (datum !== b.datum && !writeBookingDate(b.id, datum)) {
      setError("Das Buchungsdatum konnte im Budget nicht geändert werden.");
      return;
    }
    const old = normAssign(manual[b.id]);
    const entry = {};
    const parts = split !== void 0 ? split : tripId === void 0 ? old.split : null;
    const trip = tripId === void 0 ? old.trip : tripId;
    if (parts && parts.length) entry.split = parts;
    else if (trip) entry.trip = trip;
    if (ok === void 0 ? old.ok : ok) entry.ok = true;
    const next = { ...manual };
    if (entry.trip || entry.split || entry.ok) next[b.id] = entry;
    else delete next[b.id];
    setManual(next);
    try {
      await window.storage.set("reiseanalyse:kostenZuordnung", JSON.stringify(next));
    } catch {
    }
    setBudgetTick((t) => t + 1);
  };
  const applyFwa2025Fix = async () => {
    setError(null);
    try {
      const { next, count } = buildFwa2025Fixes(trips, manual);
      if (!window.confirm(`Einmalkorrektur FWA 2025: ${count} Buchungen werden neu zugeordnet (Sammelrechnungen aufgeteilt). Fortfahren?`)) return;
      await window.storage.set("reiseanalyse:kostenZuordnung", JSON.stringify(next));
      await window.storage.set(FWA2025_FLAG_KEY, (/* @__PURE__ */ new Date()).toISOString());
      setManual(next);
      setFixDone(true);
      setBudgetTick((t) => t + 1);
    } catch (e) {
      setError("Einmalkorrektur nicht angewendet: " + (e.message || e));
    }
  };
  const assign = (b, datum, tripId) => saveAssign(b, { datum, tripId: tripId || void 0 });
  const openRow = pivot.rows.find((r) => r.year === openYear) || null;
  if (!settingsLoaded) {
    return /* @__PURE__ */ React.createElement("div", { style: { padding: "24px 16px", color: "rgba(232,244,253,0.5)" } }, "Lade…");
  }
  return /* @__PURE__ */ React.createElement("div", { style: { padding: "0 16px 14px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.45)" } }, fetchedAt ? `Kalenderstand: ${new Date(fetchedAt).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}` : "Noch nicht mit Google Kalender synchronisiert."), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: sync,
      disabled: busy,
      style: { background: "rgba(125,211,252,0.15)", border: "1px solid rgba(125,211,252,0.3)", borderRadius: 10, padding: "9px 14px", color: "#7dd3fc", fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer" }
    },
    busy ? "⏳ Synchronisiere…" : fetchedAt ? "🔄 Aktualisieren" : "🔗 Mit Google Kalender verbinden"
  )), error && /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#f87171", marginBottom: 12 } }, error), !fixDone && costs.available && trips.length > 0 && /* @__PURE__ */ React.createElement("div", { onClick: applyFwa2025Fix, style: { cursor: "pointer", background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#c4b5fd", marginBottom: 12 } }, "🛠 Einmalkorrektur: FWA-Rechnungen 2025 neu zuordnen (Sammelrechnungen aufteilen) — tippen zum Anwenden ›"), costs.available && costs.open.length > 0 && /* @__PURE__ */ React.createElement("div", { onClick: () => setAssignOpen(true), style: { cursor: "pointer", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#fbbf24", marginBottom: 12 } }, "✈ ", costs.open.length, " Flugreise-", costs.open.length === 1 ? "Buchung ist" : "Buchungen sind", " keiner Reise eindeutig zugeordnet — tippen zum Zuordnen ›"), costs.available && costs.all.length > 0 && /* @__PURE__ */ React.createElement("div", { onClick: () => setListOpen(true), style: { cursor: "pointer", background: "rgba(125,211,252,0.08)", border: "1px solid rgba(125,211,252,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#7dd3fc", marginBottom: 12 } }, "📋 Zuordnungsliste (", costs.all.filter((r) => r.ok).length, "/", costs.all.length, " geprüft) ›"), /* @__PURE__ */ React.createElement(ReiseanalysePivotTable, { pivot, onOpenYear: setOpenYear }), assignOpen && /* @__PURE__ */ React.createElement(CostAssignModal, { open: costs.open, trips, onSave: assign, onClose: () => setAssignOpen(false) }), listOpen && /* @__PURE__ */ React.createElement(AssignListModal, { all: costs.all, trips, onSave: saveAssign, onClose: () => setListOpen(false) }), openRow && /* @__PURE__ */ React.createElement(ReiseDrilldownModal, { row: openRow, onClose: () => setOpenYear(null) }));
}
function StatistikApp() {
  const [flights, setFlights] = React.useState(null);
  React.useEffect(() => {
    (async () => {
      try {
        const keys = await window.storage.list("flight:");
        const raw = await Promise.all((keys?.keys || []).map(async (k) => {
          try {
            const r = await window.storage.get(k);
            return r ? JSON.parse(r.value) : null;
          } catch {
            return null;
          }
        }));
        setFlights(raw.filter(Boolean));
      } catch (e) {
        console.error("Storage load error:", e);
        setFlights([]);
      }
    })();
  }, []);
  const [view, setView] = React.useState("uebersicht");
  const [typF, setTypF] = React.useState(/* @__PURE__ */ new Set());
  const [reiseF, setReiseF] = React.useState(/* @__PURE__ */ new Set());
  const [schirmF, setSchirmF] = React.useState(/* @__PURE__ */ new Set());
  const [landeplatzF, setLandeplatzF] = React.useState(/* @__PURE__ */ new Set());
  const [landF, setLandF] = React.useState(/* @__PURE__ */ new Set());
  const [trainingF, setTrainingF] = React.useState("alle");
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
    typ: [...typF],
    reise: [...reiseF],
    schirm: [...schirmF],
    landeplatz: [...landeplatzF],
    land: [...landF],
    training: trainingF
  });
  const [settingsLoaded, setSettingsLoaded] = React.useState(false);
  const filtersReadyRef = React.useRef(false);
  React.useEffect(() => {
    (async () => {
      let loadedView = "uebersicht";
      try {
        const rv = await window.storage.get("statistikView");
        if (rv && rv.value && VIEWS.some((v) => v.id === rv.value)) loadedView = rv.value;
      } catch (e) {
      }
      try {
        const rf = await window.storage.get("statistikFilters");
        if (rf && rf.value) {
          const parsed = JSON.parse(rf.value);
          if (parsed && (Array.isArray(parsed.typ) || Array.isArray(parsed.schirm) || parsed.training)) {
            const migrated = { ...emptyFilterSet(), ...parsed };
            filtersMapRef.current = { uebersicht: migrated, monat: { ...migrated }, reise: { ...migrated } };
          } else if (parsed && typeof parsed === "object") {
            filtersMapRef.current = {
              uebersicht: { ...emptyFilterSet(), ...parsed.uebersicht || {} },
              monat: { ...emptyFilterSet(), ...parsed.monat || {} },
              reise: { ...emptyFilterSet(), ...parsed.reise || {} }
            };
          }
        }
      } catch (e) {
      }
      setView(loadedView);
      applyFilterSet(filtersMapRef.current[loadedView] || emptyFilterSet());
      setSettingsLoaded(true);
    })();
  }, []);
  const isSwitchingViewRef = React.useRef(false);
  const changeView = (id) => {
    if (id === view) return;
    const nextMap = { ...filtersMapRef.current, [view]: snapshotFilterState() };
    filtersMapRef.current = nextMap;
    isSwitchingViewRef.current = true;
    applyFilterSet(nextMap[id] || emptyFilterSet());
    setView(id);
    try {
      window.storage.set("statistikView", id);
      window.storage.set("statistikFilters", JSON.stringify(nextMap));
    } catch (e) {
    }
  };
  React.useEffect(() => {
    if (!settingsLoaded) return;
    if (isSwitchingViewRef.current) {
      isSwitchingViewRef.current = false;
      return;
    }
    try {
      filtersMapRef.current = { ...filtersMapRef.current, [view]: snapshotFilterState() };
      window.storage.set("statistikFilters", JSON.stringify(filtersMapRef.current));
      if (filtersReadyRef.current) {
        window.storage.set("settings:backupDirty", "1");
      } else {
        filtersReadyRef.current = true;
      }
    } catch (e) {
    }
  }, [settingsLoaded, view, typF, reiseF, schirmF, landeplatzF, landF, trainingF]);
  const all = flights || [];
  const typOptions = React.useMemo(() => distinctValues(all, (f) => f.customFields?.typ), [all]);
  const reiseOptions = React.useMemo(() => distinctValues(all, (f) => f.customFields?.reise), [all]);
  const schirmOptions = React.useMemo(() => distinctValues(all, (f) => f.glider), [all]);
  const landeplatzOptions = React.useMemo(() => distinctValues(all, (f) => f.customFields?.landung), [all]);
  const landOptions = React.useMemo(() => distinctValues(all, (f) => f.customFields?.land), [all]);
  const filtered = React.useMemo(() => {
    return all.filter((f) => {
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
    const byYear = /* @__PURE__ */ new Map();
    for (const f of filtered) {
      const yr = (f.year || (f.date || "").split(".")[2] || "—").toString();
      if (!byYear.has(yr)) byYear.set(yr, { year: yr, minutes: 0, flights: 0, days: /* @__PURE__ */ new Set() });
      const bucket = byYear.get(yr);
      const durSec = f.durationSec || 0;
      bucket.minutes += durSec / 60;
      bucket.flights += 1;
      if (f.date) bucket.days.add(f.date);
    }
    const rows = [...byYear.values()].map((b) => ({ year: b.year, minutes: b.minutes, flights: b.flights, days: b.days.size })).sort((a, b) => a.year.localeCompare(b.year, "de", { numeric: true }));
    const total = rows.reduce((acc, r) => ({
      minutes: acc.minutes + r.minutes,
      flights: acc.flights + r.flights,
      days: acc.days + r.days
    }), { minutes: 0, flights: 0, days: 0 });
    return { rows, total };
  }, [filtered]);
  const resetFilters = () => {
    setTypF(/* @__PURE__ */ new Set());
    setReiseF(/* @__PURE__ */ new Set());
    setSchirmF(/* @__PURE__ */ new Set());
    setLandeplatzF(/* @__PURE__ */ new Set());
    setLandF(/* @__PURE__ */ new Set());
    setTrainingF("alle");
  };
  const anyFilterActive = typF.size || reiseF.size || schirmF.size || landeplatzF.size || landF.size || trainingF !== "alle";
  if (flights === null) {
    return /* @__PURE__ */ React.createElement("div", { style: { padding: 24, color: "rgba(232,244,253,0.5)", fontFamily: "system-ui,sans-serif" } }, "Lade Flüge…");
  }
  return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "100vh", background: "#040e20", color: "#e8f4fd", fontFamily: "system-ui,sans-serif", paddingBottom: 40 } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "calc(18px + env(safe-area-inset-top, 0px)) 16px 6px", display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("a", { href: "index.html", style: { color: "#7dd3fc", fontSize: 24, textDecoration: "none", flexShrink: 0, lineHeight: 1 } }, "‹"), /* @__PURE__ */ React.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(232,244,253,0.4)", marginBottom: 2 } }, "Flugbuch"), /* @__PURE__ */ React.createElement("h1", { style: { fontSize: 22, fontWeight: 800, margin: "0 0 4px" } }, "Statistik"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.45)" } }, all.length, " Flüge insgesamt · ", filtered.length, " nach Filter"))), /* @__PURE__ */ React.createElement("div", { style: { padding: "4px 16px 14px" } }, /* @__PURE__ */ React.createElement(ViewSwitcher, { view, onChange: changeView })), (view === "uebersicht" || view === "monat" || view === "reise") && /* @__PURE__ */ React.createElement(
    FilterBar,
    {
      typOptions,
      typF,
      setTypF,
      reiseOptions,
      reiseF,
      setReiseF,
      schirmOptions,
      schirmF,
      setSchirmF,
      landeplatzOptions,
      landeplatzF,
      setLandeplatzF,
      landOptions,
      landF,
      setLandF,
      trainingF,
      setTrainingF,
      anyFilterActive,
      resetFilters
    }
  ), view === "uebersicht" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(MaxStatsSection, { flights: filtered }), /* @__PURE__ */ React.createElement(UebersichtPivotTable, { pivot })), view === "monat" && /* @__PURE__ */ React.createElement(MonthPivotTable, { flights: filtered }), view === "reise" && /* @__PURE__ */ React.createElement(ReisePivotTable, { flights: filtered }), view === "reiseanalyse" && /* @__PURE__ */ React.createElement(ReiseanalyseSection, { flights: all }));
}

;window.__FLUGBUCH_APP__ = StatistikApp;
})(window.React, window.ReactDOM);
