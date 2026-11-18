/* Automatisch erzeugt aus schirme.jsx (sha256 a1076d9c9fdc) — nicht von Hand ändern, siehe scripts/build.js */
(function (React, ReactDOM) {
const SCHIRME_KEY = "schirme:list";
function formatFlightHours(sec) {
  const m = Math.round((sec || 0) / 60);
  const h = Math.floor(m / 60), rem = m % 60;
  return `${h}h ${String(rem).padStart(2, "0")}m`;
}
const TYP_OPTIONS = ["GS", "BP", "SF", "NS", "Div"];
const TYP_LABELS = { GS: "GS (Gleitschirm)", BP: "BP (Biplace)", SF: "SF (Speedflyer)", NS: "NS (Notschirm)", Div: "Div (Diverses)" };
const isSchirmArt = (a) => {
  const t = (a || "").trim();
  return t === "Schirm" || t === "Notschirm";
};
function parseDateToTs(d) {
  if (!d) return 0;
  const p = d.split(".");
  return p.length === 3 ? new Date(+p[2], +p[1] - 1, +p[0]).getTime() : 0;
}
async function loadAllFlights() {
  const keys = await window.storage.list("flight:");
  const raw = await Promise.all((keys?.keys || []).map(async (k) => {
    try {
      const r = await window.storage.get(k);
      return r ? JSON.parse(r.value) : null;
    } catch {
      return null;
    }
  }));
  return raw.filter(Boolean);
}
async function loadAllMaterial() {
  const keys = await window.storage.list("entry:");
  const raw = await Promise.all((keys?.keys || []).map(async (k) => {
    try {
      const r = await window.storage.get(k);
      return r ? JSON.parse(r.value) : null;
    } catch {
      return null;
    }
  }));
  return raw.filter(Boolean);
}
function SchirmeApp() {
  const [flights, setFlights] = React.useState(null);
  const [material, setMaterial] = React.useState([]);
  const [schirme, setSchirme] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const [editing, setEditing] = React.useState(null);
  const migrateOldLinks = async (schirmeList, mat) => {
    const matById = new Map(mat.map((m) => [m.id, m]));
    const changedMatIds = /* @__PURE__ */ new Set();
    let schirmeChanged = false;
    const nextSchirme = schirmeList.map((s) => {
      if (!s.materialEntryId) return s;
      const m = matById.get(s.materialEntryId);
      if (m && m.schirmId !== s.id) {
        matById.set(m.id, { ...m, schirmId: s.id });
        changedMatIds.add(m.id);
      }
      schirmeChanged = true;
      const { materialEntryId, ...rest } = s;
      return rest;
    });
    if (changedMatIds.size) {
      await Promise.all([...changedMatIds].map((id) => window.storage.set(`entry:${id}`, JSON.stringify(matById.get(id)))));
    }
    return { schirme: schirmeChanged ? nextSchirme : schirmeList, material: [...matById.values()], changed: changedMatIds.size > 0 || schirmeChanged };
  };
  const load = React.useCallback(async () => {
    const [fl, mat] = await Promise.all([loadAllFlights(), loadAllMaterial()]);
    let schirmeList = [];
    try {
      const r = await window.storage.get(SCHIRME_KEY);
      schirmeList = r ? JSON.parse(r.value) : [];
    } catch {
      schirmeList = [];
    }
    const migrated = await migrateOldLinks(schirmeList, mat);
    setFlights(fl);
    setMaterial(migrated.material);
    setSchirme(migrated.schirme);
    if (migrated.changed) {
      try {
        await window.storage.set(SCHIRME_KEY, JSON.stringify(migrated.schirme));
      } catch {
      }
      markDirty();
    }
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);
  const markDirty = () => {
    try {
      window.storage.set("settings:backupDirty", "1");
    } catch {
    }
  };
  const saveSchirme = async (list) => {
    setSchirme(list);
    try {
      await window.storage.set(SCHIRME_KEY, JSON.stringify(list));
    } catch {
    }
    markDirty();
  };
  const suggestTyp = (name) => {
    if (!flights) return "";
    const counts = {};
    flights.forEach((f) => {
      if ((f.glider || "").trim() !== name) return;
      const t = (f.customFields?.typ || "").trim().toUpperCase();
      if (TYP_OPTIONS.includes(t)) counts[t] = (counts[t] || 0) + 1;
    });
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : "";
  };
  const linkFlightsToSchirm = async (fl, schirmEntry) => {
    const targetName = (schirmEntry.name || "").trim();
    const toLink = fl.filter(
      (f) => (f.glider || "").trim() === targetName && f.customFields?.schirmId !== schirmEntry.id
    );
    if (!toLink.length) return { updated: [], count: 0 };
    const updated = toLink.map((f) => ({ ...f, customFields: { ...f.customFields || {}, schirmId: schirmEntry.id } }));
    await Promise.all(updated.map((f) => window.storage.set(`flight:${f.id}`, JSON.stringify(f))));
    return { updated, count: updated.length };
  };
  const relinkAll = async (fl, schirmeList) => {
    let working = fl;
    let total = 0;
    for (const s of schirmeList) {
      const { updated, count } = await linkFlightsToSchirm(working, s);
      if (count) {
        const byId = new Map(updated.map((f) => [f.id, f]));
        working = working.map((f) => byId.get(f.id) || f);
        total += count;
      }
    }
    return { flights: working, count: total };
  };
  const relinkMaterial = async (mat, schirmeList) => {
    let working = mat;
    let total = 0;
    for (const s of schirmeList) {
      const targetName = (s.name || "").trim().toLowerCase();
      if (!targetName) continue;
      const toLink = working.filter((m) => isSchirmArt(m.art) && (m.typ || "").trim().toLowerCase() === targetName && m.schirmId !== s.id);
      if (!toLink.length) continue;
      const updated = toLink.map((m) => ({ ...m, schirmId: s.id }));
      await Promise.all(updated.map((m) => window.storage.set(`entry:${m.id}`, JSON.stringify(m))));
      const byId = new Map(updated.map((m) => [m.id, m]));
      working = working.map((m) => byId.get(m.id) || m);
      total += updated.length;
    }
    return { material: working, count: total };
  };
  const renameGliderEverywhere = async (oldName, newName) => {
    const fl = flights || await loadAllFlights();
    const target = (oldName || "").trim();
    const affected = fl.filter((f) => (f.glider || "").trim() === target);
    if (!affected.length) return 0;
    const cleanedNewName = (newName || "").trim();
    const updated = affected.map((f) => ({ ...f, glider: cleanedNewName }));
    await Promise.all(updated.map((f) => window.storage.set(`flight:${f.id}`, JSON.stringify(f))));
    return updated.length;
  };
  const generateAll = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const fl = flights || await loadAllFlights();
      const mat = material.length ? material : await loadAllMaterial();
      const existingNames = new Set(schirme.map((s) => (s.name || "").trim().toLowerCase()));
      const namesFromFlights = [...new Set(fl.map((f) => (f.glider || "").trim()).filter(Boolean))];
      const namesFromMaterial = [...new Set(mat.filter((m) => isSchirmArt(m.art)).map((m) => (m.typ || "").trim()).filter(Boolean))];
      const seen = new Set(existingNames);
      const newEntries = [];
      for (const n of [...namesFromFlights, ...namesFromMaterial]) {
        const key = n.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const fromMat = mat.find((m) => isSchirmArt(m.art) && (m.typ || "").trim().toLowerCase() === key);
        newEntries.push({
          id: `schirm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: n,
          hersteller: fromMat?.hersteller || "",
          typ: "",
          letzterCheck: ""
        });
      }
      const allSchirme = [...schirme, ...newEntries];
      if (newEntries.length) await saveSchirme(allSchirme);
      const { flights: relinkedFl, count: relinkFlCount } = await relinkAll(fl, allSchirme);
      setFlights(relinkedFl);
      const { material: relinkedMat, count: relinkMatCount } = await relinkMaterial(mat, allSchirme);
      setMaterial(relinkedMat);
      if (relinkFlCount || relinkMatCount) markDirty();
      const parts = [];
      if (newEntries.length) parts.push(`${newEntries.length} Schirm(e) erzeugt`);
      if (relinkFlCount) parts.push(`${relinkFlCount} Flug-Verknüpfung(en) ergänzt`);
      if (relinkMatCount) parts.push(`${relinkMatCount} Material-Verknüpfung(en) ergänzt`);
      setMsg({ type: "ok", text: parts.length ? `✓ ${parts.join(", ")}.` : "Alles bereits aktuell — nichts zu erzeugen oder zu verknüpfen." });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Erzeugen: " + (e.message || String(e)) });
    } finally {
      setBusy(false);
    }
  };
  const matchesSchirm = (f, entry) => f.customFields?.schirmId ? f.customFields.schirmId === entry.id : (f.glider || "").trim() === (entry.name || "").trim();
  const flightsFor = (entry) => (flights || []).filter((f) => matchesSchirm(f, entry));
  const flightCountFor = (entry) => flightsFor(entry).length;
  const durationFor = (entry) => flightsFor(entry).reduce((sum, f) => sum + (f.durationSec || 0), 0);
  const materialFor = (entry) => material.filter((m) => m.schirmId === entry.id).sort((a, b) => parseDateToTs(b.datum) - parseDateToTs(a.datum));
  const unlinkedSchirmMaterial = React.useMemo(() => material.filter((m) => isSchirmArt(m.art) && !m.schirmId), [material]);
  const linkMaterial = async (materialId, schirmId) => {
    const m = material.find((x) => x.id === materialId);
    if (!m) return;
    const updated = { ...m, schirmId };
    await window.storage.set(`entry:${updated.id}`, JSON.stringify(updated));
    setMaterial((prev) => prev.map((x) => x.id === updated.id ? updated : x));
    markDirty();
  };
  const unlinkMaterial = async (materialId) => {
    const m = material.find((x) => x.id === materialId);
    if (!m) return;
    const updated = { ...m, schirmId: null };
    await window.storage.set(`entry:${updated.id}`, JSON.stringify(updated));
    setMaterial((prev) => prev.map((x) => x.id === updated.id ? updated : x));
    markDirty();
  };
  const orphanGliders = React.useMemo(() => {
    if (!flights) return [];
    const knownIds = new Set(schirme.map((s) => s.id));
    const knownNames = new Set(schirme.map((s) => (s.name || "").trim()));
    const map = /* @__PURE__ */ new Map();
    flights.forEach((f) => {
      const name = (f.glider || "").trim();
      if (!name) return;
      const sid = f.customFields?.schirmId;
      const hasValidLink = sid && knownIds.has(sid);
      if (hasValidLink || knownNames.has(name)) return;
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(f);
    });
    return [...map.entries()].map(([name, fl]) => ({ name, flights: fl })).sort((a, b) => b.flights.length - a.flights.length);
  }, [flights, schirme]);
  const [orphanTarget, setOrphanTarget] = React.useState({});
  const reassignOrphan = async (name, targetId) => {
    if (!targetId) return;
    setBusy(true);
    setMsg(null);
    try {
      const target = schirme.find((s) => s.id === targetId);
      if (!target) return;
      const count = await renameGliderEverywhere(name, target.name);
      let updatedFl = await loadAllFlights();
      const { flights: relinked } = await relinkAll(updatedFl, [target]);
      setFlights(relinked);
      setMsg({ type: "ok", text: `✓ „${name}" → „${target.name}": ${count} Flug(e) umgehängt.` });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Zuordnen: " + (e.message || String(e)) });
    } finally {
      setBusy(false);
    }
  };
  const recreateOrphan = async (name) => {
    setBusy(true);
    setMsg(null);
    try {
      const entry = {
        id: `schirm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name,
        hersteller: "",
        typ: "",
        letzterCheck: ""
      };
      const next = [...schirme, entry];
      await saveSchirme(next);
      const fl = flights || await loadAllFlights();
      const { flights: relinked } = await relinkAll(fl, [entry]);
      setFlights(relinked);
      setMsg({ type: "ok", text: `✓ „${name}" wieder als eigenständigen Schirm angelegt.` });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Anlegen: " + (e.message || String(e)) });
    } finally {
      setBusy(false);
    }
  };
  if (flights === null) {
    return /* @__PURE__ */ React.createElement("div", { style: { padding: 24, color: "rgba(232,244,253,0.5)", fontFamily: "system-ui,sans-serif" } }, "Lade…");
  }
  const sortedSchirme = [...schirme].sort((a, b) => (a.name || "").localeCompare(b.name || "", "de"));
  return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "100vh", background: "#040e20", color: "#e8f4fd", fontFamily: "system-ui,sans-serif", paddingBottom: 40 } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "calc(18px + env(safe-area-inset-top, 0px)) 16px 6px", display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("a", { href: "material.html", style: { color: "#7dd3fc", fontSize: 24, textDecoration: "none", flexShrink: 0, lineHeight: 1 } }, "‹"), /* @__PURE__ */ React.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(232,244,253,0.4)", marginBottom: 2 } }, "Flugbuch · Material"), /* @__PURE__ */ React.createElement("h1", { style: { fontSize: 22, fontWeight: 800, margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("img", { src: "icons/icon-header-128.png?v=2", alt: "", style: { width: 24, height: 24, flexShrink: 0 } }), "Schirme"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.45)" } }, sortedSchirme.length, " Schirme"))), /* @__PURE__ */ React.createElement("div", { style: { padding: "0 16px 14px", display: "flex", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setEditing({ name: "", hersteller: "", typ: "", letzterCheck: "" }),
      disabled: busy,
      style: { background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 8, padding: "9px 14px", color: "#4ade80", fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer" }
    },
    "+ Neuer Schirm"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: generateAll,
      disabled: busy,
      title: "Legt für jeden in Flügen oder Material (Art=Schirm) verwendeten Namen einen Eintrag an, falls noch keiner existiert, und repariert alle Verknüpfungen.",
      style: { background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 8, padding: "9px 14px", color: "#4ade80", fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer" }
    },
    busy ? "⏳ …" : "🔄 Schirme synchronisieren"
  )), msg && /* @__PURE__ */ React.createElement("div", { style: { margin: "0 16px 14px", background: msg.type === "ok" ? "rgba(74,222,128,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${msg.type === "ok" ? "rgba(74,222,128,0.3)" : "rgba(239,68,68,0.3)"}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: msg.type === "ok" ? "#4ade80" : "#f87171" } }, msg.text), orphanGliders.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { margin: "0 16px 14px", background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 12, padding: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, fontWeight: 700, color: "#f87171", marginBottom: 4 } }, "⚠️ Schirm-Bezeichnungen ohne Eintrag in der Liste"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.55)", marginBottom: 10 } }, "Diese Namen stehen noch bei Flügen, haben aber keinen (mehr) passenden Eintrag oben — meist weil ein Schirm-Eintrag gelöscht statt umbenannt wurde. Zu einem bestehenden Schirm zuordnen, oder als eigenen Eintrag wiederherstellen."), orphanGliders.map((o) => /* @__PURE__ */ React.createElement("div", { key: o.name, style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.06)" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 140px", minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, fontWeight: 700, color: "#e8f4fd", overflow: "hidden", textOverflow: "ellipsis" } }, "„", o.name, '"'), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "rgba(232,244,253,0.4)" } }, o.flights.length, " Flug(e) · z.B. ", o.flights[0]?.date || "—")), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: orphanTarget[o.name] || "",
      disabled: busy,
      onChange: (e) => setOrphanTarget((t) => ({ ...t, [o.name]: e.target.value })),
      style: { background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px 8px", color: "#e8f4fd", fontSize: 11, minWidth: 130 }
    },
    /* @__PURE__ */ React.createElement("option", { value: "", style: { background: "#14253a" } }, "— Ziel-Schirm —"),
    sortedSchirme.map((s) => /* @__PURE__ */ React.createElement("option", { key: s.id, value: s.id, style: { background: "#14253a" } }, s.name))
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => reassignOrphan(o.name, orphanTarget[o.name]),
      disabled: busy || !orphanTarget[o.name],
      style: { background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 8, padding: "6px 10px", color: "#4ade80", fontSize: 11, fontWeight: 700, cursor: busy || !orphanTarget[o.name] ? "default" : "pointer" }
    },
    "Zuordnen"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => recreateOrphan(o.name),
      disabled: busy,
      title: "Legt diesen Namen wieder als eigenständigen Schirm-Eintrag an, statt ihn einem anderen zuzuordnen.",
      style: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px 10px", color: "rgba(232,244,253,0.7)", fontSize: 11, cursor: busy ? "default" : "pointer" }
    },
    "Wiederherstellen"
  )))), /* @__PURE__ */ React.createElement("div", { style: { padding: "0 16px" } }, sortedSchirme.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "30px 12px", textAlign: "center", fontSize: 13, color: "rgba(232,244,253,0.4)" } }, 'Noch keine Schirme — über „+ Neuer Schirm" anlegen, oder „🔄 Schirme synchronisieren", sobald Flüge oder Material-Einträge vorhanden sind.'), sortedSchirme.map((s) => {
    const matList = materialFor(s);
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        key: s.id,
        onClick: () => setEditing(s),
        style: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "12px 14px", marginBottom: 8, cursor: "pointer" }
      },
      /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14, fontWeight: 700, color: "#7dd3fc" } }, s.name), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)" } }, flightCountFor(s), " Flüge · ", formatFlightHours(durationFor(s)))),
      /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.7)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", null, s.hersteller || "— Hersteller —"), s.typ && /* @__PURE__ */ React.createElement("span", { style: { background: "rgba(125,211,252,0.15)", borderRadius: 20, padding: "1px 8px", color: "#7dd3fc", fontSize: 10, fontWeight: 700 } }, s.typ), matList.length > 0 && /* @__PURE__ */ React.createElement("a", { href: `material.html?schirmId=${s.id}`, onClick: (e) => e.stopPropagation(), style: { color: "rgba(74,222,128,0.8)", textDecoration: "none" } }, "🔗 ", matList.length, " Material-Eintrag(e)"), s.letzterCheck && /* @__PURE__ */ React.createElement("span", null, "· Check: ", s.letzterCheck))
    );
  })), editing && /* @__PURE__ */ React.createElement(
    SchirmEditor,
    {
      entry: editing,
      materialList: editing.id ? materialFor(editing) : [],
      unlinkedMaterial: unlinkedSchirmMaterial,
      suggestTyp,
      onLinkMaterial: linkMaterial,
      onUnlinkMaterial: unlinkMaterial,
      onCancel: () => setEditing(null),
      onSave: async (data) => {
        const trimmedName = (data.name || "").trim();
        if (!trimmedName) {
          setMsg({ type: "error", text: "Ein Name ist erforderlich." });
          return;
        }
        const isNew = !data.id;
        if (isNew) {
          const entry = { ...data, id: `schirm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: trimmedName };
          await saveSchirme([...schirme, entry]);
        } else {
          const oldName = editing.name;
          if (trimmedName !== oldName) await renameGliderEverywhere(oldName, trimmedName);
          const next = schirme.map((s) => s.id === data.id ? { ...data, name: trimmedName } : s);
          await saveSchirme(next);
        }
        setEditing(null);
        const updatedFl = await loadAllFlights();
        setFlights(updatedFl);
      },
      onDelete: async (id) => {
        const entry = schirme.find((s) => s.id === id);
        const affectedFlights = entry ? flightsFor(entry) : [];
        const affectedMaterial = entry ? materialFor(entry) : [];
        if (affectedFlights.length > 0 || affectedMaterial.length > 0) {
          setEditing(null);
          const parts = [];
          if (affectedFlights.length) parts.push(`${affectedFlights.length} Flug(e)`);
          if (affectedMaterial.length) parts.push(`${affectedMaterial.length} Material-Eintrag(e)`);
          setMsg({ type: "error", text: `„${entry.name}" kann nicht gelöscht werden — ${parts.join(" und ")} tragen diesen Schirm noch. Bitte zuerst umbenennen/trennen. Erst ein Schirm ohne Flüge und Material lässt sich löschen.` });
          return;
        }
        const next = schirme.filter((s) => s.id !== id);
        await saveSchirme(next);
        setEditing(null);
      }
    }
  ));
}
const BUILTIN_GLIDER_SYMBOLS = [
  { test: /artik\s*r\s*2/i, url: "icons/glider-artik-r2.png" },
  { test: /sigma\s*11\b/i, url: "icons/glider-sigma-11.png" },
  { test: /sigma\s*12/i, url: "icons/glider-sigma-12-dls.png" }
];
function builtinSymbolFor(name, hersteller) {
  const names = [name, (hersteller || "") + " " + (name || "")];
  const d = BUILTIN_GLIDER_SYMBOLS.find((x) => names.some((n) => n && x.test.test(n)));
  return d ? d.url : null;
}
function loadSymbolImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}
async function symbolFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadSymbolImage(url);
    const sc = Math.min(1, 700 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * sc)), h = Math.max(1, Math.round(img.naturalHeight * sc));
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0, w, h);
    const id = cx.getImageData(0, 0, w, h), d = id.data;
    const seen = new Uint8Array(w * h), stack = [];
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const p = y * w + x;
      if (seen[p]) return;
      const i = p * 4;
      if (d[i + 3] === 0 || d[i] >= 232 && d[i + 1] >= 232 && d[i + 2] >= 232) {
        seen[p] = 1;
        stack.push(p);
      }
    };
    for (let x = 0; x < w; x++) {
      push(x, 0);
      push(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      push(0, y);
      push(w - 1, y);
    }
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w;
      d[p * 4 + 3] = 0;
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }
    cx.putImageData(id, 0, 0);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 0) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 < 0) throw new Error("leer");
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1, k = Math.min(1, 200 / Math.max(cw, ch));
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(cw * k));
    out.height = Math.max(1, Math.round(ch * k));
    out.getContext("2d").drawImage(cv, x0, y0, cw, ch, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function rotateSymbol(src, dir) {
  const img = await loadSymbolImage(src);
  const cv = document.createElement("canvas");
  cv.width = img.naturalHeight;
  cv.height = img.naturalWidth;
  const cx = cv.getContext("2d");
  cx.translate(cv.width / 2, cv.height / 2);
  cx.rotate(dir * Math.PI / 2);
  cx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return cv.toDataURL("image/png");
}
function SchirmEditor({ entry, materialList, unlinkedMaterial, suggestTyp, onLinkMaterial, onUnlinkMaterial, onSave, onCancel, onDelete }) {
  const [data, setData] = React.useState({ ...entry, typ: entry.typ || suggestTyp(entry.name) });
  const [linkChoice, setLinkChoice] = React.useState("");
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));
  const isNew = !entry.id;
  return /* @__PURE__ */ React.createElement("div", { onClick: onCancel, style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 } }, /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: (e) => e.stopPropagation(),
      style: { background: "#14253a", borderRadius: 16, padding: "20px 20px", maxWidth: 420, width: "100%", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "85vh", overflowY: "auto" }
    },
    /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 4 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 } }, "Name"), /* @__PURE__ */ React.createElement(
      "input",
      {
        value: data.name || "",
        onChange: (e) => set("name", e.target.value),
        style: { width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 14, fontWeight: 700 }
      }
    )),
    !isNew && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(250,204,21,0.7)", marginBottom: 16 } }, "⚠️ Ändern des Namens benennt den Schirm auch bei allen betroffenen Flügen im Flugbuch um."),
    /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 } }, "Hersteller"), /* @__PURE__ */ React.createElement(
      "input",
      {
        value: data.hersteller || "",
        onChange: (e) => set("hersteller", e.target.value),
        style: { width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 14 }
      }
    )),
    /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 } }, "Typ"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } }, TYP_OPTIONS.map((t) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: t,
        onClick: () => set("typ", data.typ === t ? "" : t),
        style: { flex: "1 1 auto", background: data.typ === t ? "rgba(125,211,252,0.2)" : "rgba(255,255,255,0.05)", border: `1px solid ${data.typ === t ? "rgba(125,211,252,0.4)" : "rgba(255,255,255,0.1)"}`, borderRadius: 8, padding: "8px 6px", color: data.typ === t ? "#7dd3fc" : "rgba(232,244,253,0.6)", fontSize: 11, fontWeight: data.typ === t ? 700 : 400, cursor: "pointer" }
      },
      TYP_LABELS[t]
    )))),
    /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 } }, "Letzter Check"), /* @__PURE__ */ React.createElement(
      "input",
      {
        value: data.letzterCheck || "",
        onChange: (e) => set("letzterCheck", e.target.value),
        placeholder: "tt.mm.jjjj",
        style: { width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 14 }
      }
    )),
    /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 } }, "Symbol im Flug-Video"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, alignItems: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 130, height: 70, borderRadius: 10, background: "#3d5a32", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto", overflow: "hidden" } }, data.symbol || builtinSymbolFor(data.name, data.hersteller) ? /* @__PURE__ */ React.createElement("img", { src: data.symbol || builtinSymbolFor(data.name, data.hersteller), alt: "", style: { maxWidth: 120, maxHeight: 60, objectFit: "contain" } }) : /* @__PURE__ */ React.createElement("span", { style: { color: "#ef4444", fontSize: 30 } }, "▲")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6, flex: 1 } }, /* @__PURE__ */ React.createElement("label", { style: { background: "rgba(125,211,252,0.15)", border: "1px solid rgba(125,211,252,0.35)", borderRadius: 8, padding: "7px 10px", color: "#7dd3fc", fontSize: 12, fontWeight: 700, cursor: "pointer", textAlign: "center" } }, "Bild wählen", /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "file",
        accept: "image/*",
        style: { display: "none" },
        onChange: async (e) => {
          const f = e.target.files && e.target.files[0];
          e.target.value = "";
          if (!f) return;
          try {
            set("symbol", await symbolFromFile(f));
          } catch {
            alert("Das Bild konnte nicht gelesen werden.");
          }
        }
      }
    )), data.symbol && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6 } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: async () => set("symbol", await rotateSymbol(data.symbol, -1)),
        title: "90° nach links drehen",
        style: { flex: 1, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px", color: "#e8f4fd", fontSize: 14, cursor: "pointer" }
      },
      "↺"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: async () => set("symbol", await rotateSymbol(data.symbol, 1)),
        title: "90° nach rechts drehen",
        style: { flex: 1, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px", color: "#e8f4fd", fontSize: 14, cursor: "pointer" }
      },
      "↻"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => set("symbol", ""),
        title: "Symbol entfernen",
        style: { flex: 1, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8, padding: "6px", color: "#f87171", fontSize: 12, cursor: "pointer" }
      },
      "✕"
    )))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.45)", marginTop: 6, lineHeight: 1.4 } }, "Draufsicht des Schirms, Nase nach oben (mit ↺/↻ drehen). Weisser Hintergrund wird entfernt — das Bild am besten eng zuschneiden.", !data.symbol && builtinSymbolFor(data.name, data.hersteller) ? " Es wird das eingebaute Standardsymbol verwendet." : "", !data.symbol && !builtinSymbolFor(data.name, data.hersteller) ? " Ohne Symbol zeigt das Video den roten Pfeil." : "")),
    !isNew && /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 14, marginBottom: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)" } }, "Material-Einträge (", materialList.length, ")"), materialList.length > 0 && /* @__PURE__ */ React.createElement("a", { href: `material.html?schirmId=${entry.id}`, style: { fontSize: 11, color: "#7dd3fc", textDecoration: "none" } }, "→ in Material öffnen")), materialList.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.4)", marginBottom: 10 } }, "Noch kein Material-Eintrag verknüpft."), materialList.map((m) => /* @__PURE__ */ React.createElement("div", { key: m.id, style: { background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 10, padding: "8px 12px", fontSize: 12, color: "rgba(232,244,253,0.8)", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("span", null, m.datum, " · ", m.was || m.wo || "—", m.preis != null ? " · " + m.preis.toLocaleString("de-CH") + ".-" : ""), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => onUnlinkMaterial(m.id),
        title: "Verknüpfung aufheben",
        style: { background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 13, flexShrink: 0 }
      },
      "✕"
    ))), unlinkedMaterial.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, marginTop: 8 } }, /* @__PURE__ */ React.createElement(
      "select",
      {
        value: linkChoice,
        onChange: (e) => setLinkChoice(e.target.value),
        style: { flex: 1, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px 8px", color: "#e8f4fd", fontSize: 11 }
      },
      /* @__PURE__ */ React.createElement("option", { value: "", style: { background: "#14253a" } }, "— weiteren Material-Eintrag verknüpfen —"),
      unlinkedMaterial.map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id, style: { background: "#14253a" } }, m.datum, " · ", m.typ || m.was || "?"))
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => {
          if (linkChoice) {
            onLinkMaterial(linkChoice, entry.id);
            setLinkChoice("");
          }
        },
        disabled: !linkChoice,
        style: { background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 8, padding: "6px 12px", color: "#4ade80", fontSize: 11, fontWeight: 700, cursor: linkChoice ? "pointer" : "default" }
      },
      "Verknüpfen"
    ))),
    !isNew && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => onDelete(data.id),
        style: { width: "100%", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "9px", color: "#f87171", fontSize: 13, cursor: "pointer", marginBottom: 12, marginTop: 4 }
      },
      "🗑 Schirm-Eintrag löschen"
    ),
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: onCancel,
        style: { flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "11px", color: "#e8f4fd", fontSize: 14, cursor: "pointer" }
      },
      "Abbrechen"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => onSave(data),
        style: { flex: 1, background: "rgba(34,197,94,0.2)", border: "1px solid rgba(34,197,94,0.4)", borderRadius: 10, padding: "11px", color: "#4ade80", fontSize: 14, fontWeight: 700, cursor: "pointer" }
      },
      "Speichern"
    ))
  ));
}

;window.__FLUGBUCH_APP__ = SchirmeApp;
})(window.React, window.ReactDOM);
