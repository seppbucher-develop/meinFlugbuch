// ── Schirme ───────────────────────────────────────────────────────────────
// Eigenständige Seite (wie Statistik/Material/Service) — über die
// Service-Seite erreichbar. Zentrale Verwaltung: ein Datensatz pro
// Schirm-Modell (nach Name, wie er in den Flügen als "Schirm" steht),
// mit Hersteller, Typ, letztem Check, und optionaler Verknüpfung zu einem
// Material-Eintrag (Seriennummer/Hergestellt/Kaufdatum/Preis/Gekauft bei
// werden von dort live übernommen, nicht dupliziert).

const SCHIRME_KEY = "schirme:list";
function formatFlightHours(sec) {
  const m = Math.round((sec || 0) / 60);
  const h = Math.floor(m / 60), rem = m % 60;
  return `${h}h ${String(rem).padStart(2, "0")}m`;
}
const TYP_OPTIONS = ["GS", "BP", "SF", "NS", "Div"];
const TYP_LABELS = { GS: "GS (Gleitschirm)", BP: "BP (Biplace)", SF: "SF (Speedflyer)", NS: "NS (Notschirm)", Div: "Div (Diverses)" };

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

function SchirmeApp() {
  const [flights, setFlights] = React.useState(null);
  const [material, setMaterial] = React.useState([]);
  const [schirme, setSchirme] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const [editing, setEditing] = React.useState(null); // Schirm-Record in Bearbeitung

  const load = React.useCallback(async () => {
    const [fl, mat] = await Promise.all([loadAllFlights(), loadAllMaterial()]);
    setFlights(fl);
    setMaterial(mat);
    try {
      const r = await window.storage.get(SCHIRME_KEY);
      setSchirme(r ? JSON.parse(r.value) : []);
    } catch { setSchirme([]); }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const markDirty = () => { try { window.storage.set("settings:backupDirty", "1"); } catch {} };

  const saveSchirme = async (list) => {
    setSchirme(list);
    try { await window.storage.set(SCHIRME_KEY, JSON.stringify(list)); } catch {}
    markDirty();
  };

  // Häufigster Typ-Wert unter den Flügen mit diesem Schirm — als Vorschlag,
  // falls für diesen Schirm noch kein Typ gesetzt ist.
  const suggestTyp = (name) => {
    if (!flights) return "";
    const counts = {};
    flights.forEach(f => {
      if ((f.glider || "").trim() !== name) return;
      const t = (f.customFields?.typ || "").trim().toUpperCase();
      if (TYP_OPTIONS.includes(t)) counts[t] = (counts[t] || 0) + 1;
    });
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : "";
  };

  // Die eigentliche, robuste Referenz: jeder Flug bekommt (unsichtbar, in
  // customFields.schirmId) die ID des Schirme-Eintrags, dem er zugeordnet
  // ist — statt sich bei jeder Zählung erneut auf den Namens-TEXT zu
  // verlassen (der durch Leerzeichen, Gross-/Kleinschreibung o.ä. leicht
  // uneindeutig wird, wie sich gezeigt hat). Verknüpft alle Flüge, deren
  // aktueller Schirm-Text zum übergebenen Eintrag passt, aber noch nicht
  // (oder noch falsch) referenziert sind. Läuft bei jedem Erzeugen/
  // Reparieren erneut, damit auch neu importierte Flüge automatisch
  // nachgezogen werden.
  const linkFlightsToSchirm = async (fl, schirmEntry) => {
    const targetName = (schirmEntry.name || "").trim();
    const toLink = fl.filter(f =>
      (f.glider || "").trim() === targetName && f.customFields?.schirmId !== schirmEntry.id
    );
    if (!toLink.length) return { updated: [], count: 0 };
    const updated = toLink.map(f => ({ ...f, customFields: { ...(f.customFields || {}), schirmId: schirmEntry.id } }));
    await Promise.all(updated.map(f => window.storage.set(`flight:${f.id}`, JSON.stringify(f))));
    return { updated, count: updated.length };
  };

  // Repariert die schirmId-Verknüpfung für ALLE Schirme-Einträge in einem
  // Durchgang — verknüpft nach aktuellem Namens-Text (einmaliger
  // Textabgleich pro Aufruf), danach zählt für die Anzeige ausschliesslich
  // noch die ID. Gibt die Gesamtzahl neu verknüpfter Flüge zurück.
  const relinkAll = async (fl, schirmeList) => {
    let working = fl;
    let total = 0;
    for (const s of schirmeList) {
      const { updated, count } = await linkFlightsToSchirm(working, s);
      if (count) {
        const byId = new Map(updated.map(f => [f.id, f]));
        working = working.map(f => byId.get(f.id) || f);
        total += count;
      }
    }
    return { flights: working, count: total };
  };

  // Benennt einen Schirm-Namen bei ALLEN betroffenen Flügen im Flugbuch um
  // — verwendet beim manuellen Umbenennen im Editor sowie beim Zuordnen
  // eines verwaisten Namens (reassignOrphan). Aktualisiert bewusst weiterhin
  // den Flug-Text (glider), da flugbuch.jsx selbst nur diesen Text kennt und
  // anzeigt/durchsucht — die schirmId ist eine zusätzliche, für flugbuch.jsx
  // unsichtbare Absicherung nur für diese Seite hier. Gibt die Anzahl
  // aktualisierter Flüge zurück.
  const renameGliderEverywhere = async (oldName, newName) => {
    const fl = flights || await loadAllFlights();
    // Bugfix: der Flug-Schirm-Wert wurde getrimmt verglichen, oldName aber
    // nicht — bei einem Leerzeichen-Unterschied (z.B. "Sigma 11 " als
    // gespeicherter Schirm-Name) griff der Vergleich dadurch nie, und es
    // wurde still und leise nichts umbenannt.
    const target = (oldName || "").trim();
    const affected = fl.filter(f => (f.glider || "").trim() === target);
    if (!affected.length) return 0;
    const cleanedNewName = (newName || "").trim();
    const updated = affected.map(f => ({ ...f, glider: cleanedNewName }));
    await Promise.all(updated.map(f => window.storage.set(`flight:${f.id}`, JSON.stringify(f))));
    return updated.length;
  };

  // Erzeugt (einmalig, per Klick) für jeden in den Flügen verwendeten
  // Schirm-Namen einen Eintrag, falls noch keiner existiert — und versucht
  // zusätzlich, automatisch einen passenden Material-Eintrag zu verknüpfen
  // (nur bei eindeutigem Namens-Treffer im Feld "Was", um keine falschen
  // Verknüpfungen zu riskieren; bei Unsicherheit bleibt unverknüpft, dann
  // manuell im Schirm-Eintrag nachtragen).
  const generateFromFlights = async () => {
    setBusy(true); setMsg(null);
    try {
      const fl = flights || await loadAllFlights();
      const mat = material.length ? material : await loadAllMaterial();
      const names = [...new Set(fl.map(f => (f.glider || "").trim()).filter(Boolean))];
      const existingNames = new Set(schirme.map(s => (s.name || "").trim()));
      const missing = names.filter(n => !existingNames.has(n));
      let linked = 0;
      const newEntries = missing.map(n => {
        // Eindeutiger Namens-Treffer im Material-Feld "Was" (Gross-/
        // Kleinschreibung ignoriert) — nur verknüpfen, wenn GENAU EIN
        // Material-Eintrag passt, sonst lieber unverknüpft lassen.
        const candidates = mat.filter(m => (m.was || "").trim().toLowerCase() === n.toLowerCase());
        const materialEntryId = candidates.length === 1 ? candidates[0].id : null;
        if (materialEntryId) linked++;
        return {
          id: `schirm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: n, hersteller: "", typ: "", letzterCheck: "", materialEntryId,
        };
      });
      const allSchirme = [...schirme, ...newEntries];
      if (newEntries.length) await saveSchirme(allSchirme);
      // Zusätzlich zum Erzeugen neuer Einträge: die schirmId-Verknüpfung
      // für ALLE Einträge (auch bereits bestehende) einmal reparieren —
      // fängt neu importierte Flüge ein, die textlich schon zu einem
      // bestehenden Schirm passen, aber noch nie durch diese Seite
      // gelaufen sind und daher noch keine schirmId tragen.
      const { flights: relinked, count: relinkCount } = await relinkAll(fl, allSchirme);
      setFlights(relinked);
      if (relinkCount) markDirty();
      const parts = [];
      if (newEntries.length) parts.push(`${newEntries.length} Schirm(e) erzeugt${linked ? ` (${linked}× mit Material verknüpft)` : ""}`);
      if (relinkCount) parts.push(`${relinkCount} Flug-Verknüpfung(en) ergänzt`);
      setMsg({ type: "ok", text: parts.length ? `✓ ${parts.join(", ")}.` : "Alles bereits aktuell — nichts zu erzeugen oder zu verknüpfen." });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Erzeugen: " + (e.message || String(e)) });
    } finally {
      setBusy(false);
    }
  };

  // Primär über die schirmId (robust, eindeutig) — Text-Vergleich nur noch
  // als Rückfallebene für Flüge, die diese Seite noch nie durchlaufen hat
  // (z.B. druckfrisch importiert, "Erzeugen"/"Reparieren" noch nicht
  // erneut ausgeführt). Ein Flug zählt nie doppelt: sobald er per ID
  // verknüpft ist, greift ausschliesslich diese Zeile, unabhängig davon,
  // ob sein Text zufällig auch bei einem anderen Eintrag passen würde.
  const matchesSchirm = (f, entry) => f.customFields?.schirmId
    ? f.customFields.schirmId === entry.id
    : (f.glider || "").trim() === (entry.name || "").trim();
  const flightsFor = (entry) => (flights || []).filter(f => matchesSchirm(f, entry));
  const flightCountFor = (entry) => flightsFor(entry).length;
  const durationFor = (entry) => flightsFor(entry).reduce((sum, f) => sum + (f.durationSec || 0), 0);
  const materialFor = (id) => material.find(m => m.id === id) || null;

  // "Verwaiste" Schirm-Bezeichnungen: Namen, die bei mindestens einem Flug
  // im Feld "glider" stehen, aber zu KEINEM aktuellen Schirme-Eintrag mehr
  // passen (weder per Text noch per schirmId) — typischerweise, weil der
  // zugehörige Schirme-Eintrag früher direkt gelöscht statt umbenannt
  // wurde (Löschen hängt die betroffenen Flüge nicht um, im Gegensatz zum
  // Umbenennen). Macht sichtbar, woher ein
  // scheinbar "gelöschter" Schirm-Name in Statistik-Filtern noch stammt.
  const orphanGliders = React.useMemo(() => {
    if (!flights) return [];
    const knownIds = new Set(schirme.map(s => s.id));
    const knownNames = new Set(schirme.map(s => (s.name || "").trim()));
    const map = new Map();
    flights.forEach(f => {
      const name = (f.glider || "").trim();
      if (!name) return;
      const sid = f.customFields?.schirmId;
      const hasValidLink = sid && knownIds.has(sid);
      if (hasValidLink || knownNames.has(name)) return; // sauber zugeordnet
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(f);
    });
    return [...map.entries()]
      .map(([name, fl]) => ({ name, flights: fl }))
      .sort((a, b) => b.flights.length - a.flights.length);
  }, [flights, schirme]);

  const [orphanTarget, setOrphanTarget] = React.useState({}); // name -> gewählte Ziel-schirmId
  const reassignOrphan = async (name, targetId) => {
    if (!targetId) return;
    setBusy(true); setMsg(null);
    try {
      const target = schirme.find(s => s.id === targetId);
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
    setBusy(true); setMsg(null);
    try {
      const entry = { id: `schirm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name, hersteller: "", typ: "", letzterCheck: "", materialEntryId: null };
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
    return <div style={{ padding: 24, color: "rgba(232,244,253,0.5)", fontFamily: "system-ui,sans-serif" }}>Lade…</div>;
  }

  const sortedSchirme = [...schirme].sort((a, b) => a.name.localeCompare(b.name, "de"));

  return (
    <div style={{ minHeight: "100vh", background: "#040e20", color: "#e8f4fd", fontFamily: "system-ui,sans-serif", paddingBottom: 40 }}>
      <div style={{ padding: "calc(18px + env(safe-area-inset-top, 0px)) 16px 6px", display: "flex", alignItems: "center", gap: 10 }}>
        <a href="service.html" style={{ color: "#7dd3fc", fontSize: 24, textDecoration: "none", flexShrink: 0, lineHeight: 1 }}>‹</a>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(232,244,253,0.4)", marginBottom: 2 }}>Flugbuch · Service</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8 }}>
            <img src="icons/icon-header-128.png?v=2" alt="" style={{ width: 24, height: 24, flexShrink: 0 }} />
            Schirme
          </h1>
          <div style={{ fontSize: 12, color: "rgba(232,244,253,0.45)" }}>{sortedSchirme.length} Schirme</div>
        </div>
      </div>

      <div style={{ padding: "0 16px 14px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={generateFromFlights} disabled={busy}
          title="Legt für jeden in den Flügen verwendeten Schirm-Namen einen Eintrag an, falls noch keiner existiert."
          style={{ background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 8, padding: "9px 14px", color: "#4ade80", fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
          {busy ? "⏳ …" : "🔄 Schirme aus Flugbuch erzeugen"}
        </button>
      </div>

      {msg && (
        <div style={{ margin: "0 16px 14px", background: msg.type === "ok" ? "rgba(74,222,128,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${msg.type === "ok" ? "rgba(74,222,128,0.3)" : "rgba(239,68,68,0.3)"}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: msg.type === "ok" ? "#4ade80" : "#f87171" }}>
          {msg.text}
        </div>
      )}

      {orphanGliders.length > 0 && (
        <div style={{ margin: "0 16px 14px", background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#f87171", marginBottom: 4 }}>⚠️ Schirm-Bezeichnungen ohne Eintrag in der Liste</div>
          <div style={{ fontSize: 11, color: "rgba(232,244,253,0.55)", marginBottom: 10 }}>
            Diese Namen stehen noch bei Flügen, haben aber keinen (mehr) passenden Eintrag oben — meist weil ein Schirm-Eintrag gelöscht statt umbenannt wurde. Zu einem bestehenden Schirm zuordnen, oder als eigenen Eintrag wiederherstellen.
          </div>
          {orphanGliders.map(o => (
            <div key={o.name} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ flex: "1 1 140px", minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#e8f4fd", overflow: "hidden", textOverflow: "ellipsis" }}>„{o.name}"</div>
                <div style={{ fontSize: 10, color: "rgba(232,244,253,0.4)" }}>{o.flights.length} Flug(e) · z.B. {o.flights[0]?.date || "—"}</div>
              </div>
              <select value={orphanTarget[o.name] || ""} disabled={busy}
                onChange={e => setOrphanTarget(t => ({ ...t, [o.name]: e.target.value }))}
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px 8px", color: "#e8f4fd", fontSize: 11, minWidth: 130 }}>
                <option value="" style={{ background: "#14253a" }}>— Ziel-Schirm —</option>
                {sortedSchirme.map(s => (
                  <option key={s.id} value={s.id} style={{ background: "#14253a" }}>{s.name}</option>
                ))}
              </select>
              <button onClick={() => reassignOrphan(o.name, orphanTarget[o.name])} disabled={busy || !orphanTarget[o.name]}
                style={{ background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 8, padding: "6px 10px", color: "#4ade80", fontSize: 11, fontWeight: 700, cursor: busy || !orphanTarget[o.name] ? "default" : "pointer" }}>
                Zuordnen
              </button>
              <button onClick={() => recreateOrphan(o.name)} disabled={busy}
                title="Legt diesen Namen wieder als eigenständigen Schirm-Eintrag an, statt ihn einem anderen zuzuordnen."
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px 10px", color: "rgba(232,244,253,0.7)", fontSize: 11, cursor: busy ? "default" : "pointer" }}>
                Wiederherstellen
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: "0 16px" }}>
        {sortedSchirme.length === 0 && (
          <div style={{ padding: "30px 12px", textAlign: "center", fontSize: 13, color: "rgba(232,244,253,0.4)" }}>
            Noch keine Schirme gefunden — sobald Flüge mit Schirm-Angabe vorhanden sind, erscheinen sie hier automatisch.
          </div>
        )}
        {sortedSchirme.map(s => {
          const mat = materialFor(s.materialEntryId);
          return (
            <div key={s.id} onClick={() => setEditing(s)}
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "12px 14px", marginBottom: 8, cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#7dd3fc" }}>{s.name}</span>
                <span style={{ fontSize: 11, color: "rgba(232,244,253,0.4)" }}>{flightCountFor(s)} Flüge · {formatFlightHours(durationFor(s))}</span>
              </div>
              <div style={{ fontSize: 12, color: "rgba(232,244,253,0.7)", display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span>{s.hersteller || "— Hersteller —"}</span>
                {s.typ && <span style={{ background: "rgba(125,211,252,0.15)", borderRadius: 20, padding: "1px 8px", color: "#7dd3fc", fontSize: 10, fontWeight: 700 }}>{s.typ}</span>}
                {mat && <span style={{ color: "rgba(74,222,128,0.8)" }}>🔗 verknüpft</span>}
                {s.letzterCheck && <span>· Check: {s.letzterCheck}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <SchirmEditor
          entry={editing}
          material={material}
          suggestTyp={suggestTyp}
          onCancel={() => setEditing(null)}
          onSave={async (data) => {
            const trimmedName = (data.name || "").trim();
            const oldName = editing.name;
            if (trimmedName && trimmedName !== oldName) {
              await renameGliderEverywhere(oldName, trimmedName);
            }
            const next = schirme.map(s => s.id === data.id ? { ...data, name: trimmedName || s.name } : s);
            await saveSchirme(next);
            setEditing(null);
            const updatedFl = await loadAllFlights();
            setFlights(updatedFl);
          }}
          onDelete={async (id) => {
            const entry = schirme.find(s => s.id === id);
            const affected = entry ? flightsFor(entry) : [];
            if (affected.length > 0) {
              setEditing(null);
              setMsg({ type: "error", text: `„${entry.name}" kann nicht gelöscht werden — ${affected.length} Flug(e) tragen diesen Schirm noch. Bitte zuerst oben umbenennen (z.B. zu einem bestehenden Schirm), das hängt die Flüge automatisch um. Erst ein Schirm ohne Flüge lässt sich löschen.` });
              return;
            }
            const next = schirme.filter(s => s.id !== id);
            await saveSchirme(next);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function SchirmEditor({ entry, material, suggestTyp, onSave, onCancel, onDelete }) {
  const [data, setData] = React.useState({ ...entry, typ: entry.typ || suggestTyp(entry.name) });
  const set = (k, v) => setData(d => ({ ...d, [k]: v }));
  const linkedMaterial = material.find(m => m.id === data.materialEntryId) || null;

  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#14253a", borderRadius: 16, padding: "20px 20px", maxWidth: 420, width: "100%", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 }}>Name</div>
          <input value={data.name || ""} onChange={e => set("name", e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 14, fontWeight: 700 }} />
        </div>
        <div style={{ fontSize: 11, color: "rgba(250,204,21,0.7)", marginBottom: 16 }}>⚠️ Ändern des Namens benennt den Schirm auch bei allen betroffenen Flügen im Flugbuch um.</div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 }}>Hersteller</div>
          <input value={data.hersteller || ""} onChange={e => set("hersteller", e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 14 }} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 }}>Typ</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {TYP_OPTIONS.map(t => (
              <button key={t} onClick={() => set("typ", data.typ === t ? "" : t)}
                style={{ flex: "1 1 auto", background: data.typ === t ? "rgba(125,211,252,0.2)" : "rgba(255,255,255,0.05)", border: `1px solid ${data.typ === t ? "rgba(125,211,252,0.4)" : "rgba(255,255,255,0.1)"}`, borderRadius: 8, padding: "8px 6px", color: data.typ === t ? "#7dd3fc" : "rgba(232,244,253,0.6)", fontSize: 11, fontWeight: data.typ === t ? 700 : 400, cursor: "pointer" }}>
                {TYP_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 }}>Letzter Check</div>
          <input value={data.letzterCheck || ""} onChange={e => set("letzterCheck", e.target.value)}
            placeholder="tt.mm.jjjj"
            style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 14 }} />
        </div>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 14, marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 }}>Material-Eintrag verknüpfen</div>
          <select value={data.materialEntryId || ""} onChange={e => set("materialEntryId", e.target.value || null)}
            style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 13, marginBottom: 10 }}>
            <option value="" style={{ background: "#14253a" }}>— nicht verknüpft —</option>
            {material.map(m => (
              <option key={m.id} value={m.id} style={{ background: "#14253a" }}>
                {m.datum} · {m.was || m.art || "?"}{m.hersteller ? " · " + m.hersteller : ""}
              </option>
            ))}
          </select>
          {linkedMaterial && (
            <div style={{ background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 10, padding: "10px 12px", fontSize: 12, color: "rgba(232,244,253,0.8)" }}>
              <div>Seriennummer: <b>{linkedMaterial.sn || "—"}</b></div>
              <div>Hergestellt: <b>{linkedMaterial.fabrikation || "—"}</b></div>
              <div>Kaufdatum: <b>{linkedMaterial.datum || "—"}</b></div>
              <div>Preis: <b>{linkedMaterial.preis != null ? linkedMaterial.preis.toLocaleString("de-CH") + ".-" : "—"}</b></div>
              <div>Gekauft bei: <b>{linkedMaterial.wo || "—"}</b></div>
            </div>
          )}
        </div>

        <button onClick={() => onDelete(data.id)}
          style={{ width: "100%", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "9px", color: "#f87171", fontSize: 13, cursor: "pointer", marginBottom: 12, marginTop: 4 }}>
          🗑 Schirm-Eintrag löschen
        </button>

        <div style={{ display: "flex", gap: 10 }}>
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
