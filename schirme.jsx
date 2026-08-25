// ── Schirme ───────────────────────────────────────────────────────────────
// Eigenständige Seite (wie Statistik/Material/Service) — über die
// Service-Seite erreichbar. Zentrale Verwaltung: ein Datensatz pro
// Schirm-Modell (nach Name, wie er in den Flügen als "Schirm" steht),
// mit Hersteller, Typ, letztem Check, und optionaler Verknüpfung zu einem
// Material-Eintrag (Seriennummer/Hergestellt/Kaufdatum/Preis/Gekauft bei
// werden von dort live übernommen, nicht dupliziert).

const SCHIRME_KEY = "schirme:list";
// Aus den tatsächlichen Schirm-Werten der Excel-Daten verifizierte
// Hersteller-Präfixe — bewusst eine kleine, geprüfte Liste statt eines
// allgemeinen Herstellerverzeichnisses, um keine falschen Treffer zu
// riskieren (z.B. ein Modellname, der zufällig mit einem Wort beginnt,
// das auch ein Herstellername sein könnte).
const KNOWN_PREFIXES = ["UP", "Supair", "Ozone", "Nova", "MacPara"];
const TYP_OPTIONS = ["GS", "BP", "SF", "NS", "Div"];
const TYP_LABELS = { GS: "GS (Gleitschirm)", BP: "BP (Biplace)", SF: "SF (Speedflyer)", NS: "NS (Notschirm)", Div: "Div (Diverses)" };
// Bekannte Falschschreibungen/Dubletten im Schirm-Feld — vom Nutzer
// bestätigte Korrekturen (04.2026). Nur als Vorschlag: erscheint auf der
// Seite nur, solange noch ein Schirm-Eintrag mit dem "von"-Namen existiert.
const KNOWN_CORRECTIONS = [
  { from: "Advance Sigma 12", to: "Sigma 12 DLS" },
  { from: "Advance Sigma10", to: "Sigma 10" },
  { from: "Advance Sigma11", to: "Sigma 11" },
  { from: "Gr M", to: "Vision" },
  { from: "PI23", to: "Pi 23" },
  { from: "Pi23", to: "Pi 23" },
];

function splitHerstellerFromName(raw) {
  const name = (raw || "").trim();
  for (const prefix of KNOWN_PREFIXES) {
    const re = new RegExp(`^${prefix}\\s+(.+)$`, "i");
    const m = name.match(re);
    if (m) return { hersteller: prefix, cleaned: m[1].trim() };
  }
  return { hersteller: "", cleaned: name };
}

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

  const saveSchirme = async (list) => {
    setSchirme(list);
    try { await window.storage.set(SCHIRME_KEY, JSON.stringify(list)); } catch {}
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

  // Bereinigung: durchsucht alle Flüge nach bekannten Hersteller-Präfixen
  // im Schirm-Feld, entfernt den Präfix aus dem Flug-Feld "Schirm" und legt
  // (bzw. aktualisiert) den passenden Schirme-Eintrag mit dem erkannten
  // Hersteller an. Manuell ausgelöst (kein automatischer Lauf beim Start).
  // Benennt einen Schirm-Namen bei ALLEN betroffenen Flügen im Flugbuch um
  // — verwendet sowohl beim manuellen Umbenennen im Editor als auch von der
  // Schnellkorrektur-Liste unten. Gibt die Anzahl aktualisierter Flüge
  // zurück.
  const renameGliderEverywhere = async (oldName, newName) => {
    const fl = flights || await loadAllFlights();
    const affected = fl.filter(f => (f.glider || "").trim() === oldName);
    if (!affected.length) return 0;
    const updated = affected.map(f => ({ ...f, glider: newName }));
    await Promise.all(updated.map(f => window.storage.set(`flight:${f.id}`, JSON.stringify(f))));
    return updated.length;
  };

  // Findet Schirme-Einträge, deren Namen sich normalisiert (getrimmt,
  // mehrfache Leerzeichen zusammengefasst) gleichen — sie sehen für den
  // Menschen identisch aus (z.B. "Sigma 11" doppelt), sind aber intern
  // unterschiedliche Zeichenketten (typischerweise durch ein Leerzeichen
  // am Rand, aus Excel-Import oder mehrfachem "Schirme erzeugen"
  // entstanden). Führt sie zusammen: EIN Eintrag (der mit den meisten
  // Flügen) wird zum Ziel, auf das alle betroffenen Flüge umgeschrieben
  // werden — danach hat genau ein Eintrag alle Flüge, der/die anderen
  // 0 Flüge und können manuell gelöscht werden.
  const normalizeName = (n) => (n || "").trim().replace(/\s+/g, " ");
  const mergeDuplicates = async () => {
    setBusy(true); setMsg(null);
    try {
      const fl = flights || await loadAllFlights();
      const countFor = (rawName) => fl.filter(f => (f.glider || "").trim() === rawName).length;
      const groups = {};
      schirme.forEach(s => {
        const key = normalizeName(s.name).toLowerCase();
        (groups[key] = groups[key] || []).push(s);
      });
      const dupGroups = Object.values(groups).filter(g => g.length > 1);
      if (!dupGroups.length) {
        setMsg({ type: "ok", text: "Keine doppelten Schirm-Namen gefunden." });
        setBusy(false);
        return;
      }
      let mergedGroups = 0, updatedFlightsTotal = 0;
      let nextSchirme = [...schirme];
      for (const group of dupGroups) {
        const withCounts = group.map(s => ({ s, count: countFor(s.name) }));
        withCounts.sort((a, b) => b.count - a.count);
        const canonical = withCounts[0].s;
        const others = withCounts.slice(1).map(x => x.s);
        for (const other of others) {
          if (other.name !== canonical.name) {
            updatedFlightsTotal += await renameGliderEverywhere(other.name, canonical.name);
          }
        }
        // Fehlende Angaben (Hersteller/Typ/letzterCheck/Material-Link) aus
        // den Dubletten übernehmen, falls beim Ziel-Eintrag noch leer.
        const merged = { ...canonical };
        for (const other of others) {
          if (!merged.hersteller && other.hersteller) merged.hersteller = other.hersteller;
          if (!merged.typ && other.typ) merged.typ = other.typ;
          if (!merged.letzterCheck && other.letzterCheck) merged.letzterCheck = other.letzterCheck;
          if (!merged.materialEntryId && other.materialEntryId) merged.materialEntryId = other.materialEntryId;
        }
        nextSchirme = nextSchirme.map(s => s.id === canonical.id ? merged : s);
        mergedGroups++;
      }
      await saveSchirme(nextSchirme);
      const updatedFl = await loadAllFlights();
      setFlights(updatedFl);
      setMsg({ type: "ok", text: `✓ ${mergedGroups} Dublette(n) zusammengeführt, ${updatedFlightsTotal} Flüge aktualisiert. Die übrig gebliebenen Einträge mit 0 Flügen kannst du jetzt löschen.` });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Zusammenführen: " + (e.message || String(e)) });
    } finally {
      setBusy(false);
    }
  };

  const applyCorrection = async (from, to) => {
    setBusy(true); setMsg(null);
    try {
      const count = await renameGliderEverywhere(from, to);
      const next = schirme.map(s => s.name === from ? { ...s, name: to } : s);
      await saveSchirme(next);
      const updatedFl = await loadAllFlights();
      setFlights(updatedFl);
      setMsg({ type: "ok", text: `✓ „${from}" → „${to}": ${count} Flüge aktualisiert.` });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler bei der Korrektur: " + (e.message || String(e)) });
    } finally {
      setBusy(false);
    }
  };

  const runCleanup = async () => {
    setBusy(true); setMsg(null);
    try {
      const fl = flights || await loadAllFlights();
      const renameMap = {}; // alterName -> {cleaned, hersteller}
      fl.forEach(f => {
        const orig = (f.glider || "").trim();
        if (!orig || renameMap[orig]) return;
        const { hersteller, cleaned } = splitHerstellerFromName(orig);
        if (hersteller) renameMap[orig] = { cleaned, hersteller };
      });
      const affectedNames = Object.keys(renameMap);
      if (!affectedNames.length) {
        setMsg({ type: "ok", text: "Keine bekannten Hersteller-Präfixe im Schirm-Feld gefunden — nichts zu bereinigen." });
        setBusy(false);
        return;
      }
      let updatedFlights = 0;
      const flightUpdates = fl
        .filter(f => renameMap[(f.glider || "").trim()])
        .map(f => ({ ...f, glider: renameMap[(f.glider || "").trim()].cleaned }));
      await Promise.all(flightUpdates.map(f => window.storage.set(`flight:${f.id}`, JSON.stringify(f))));
      updatedFlights = flightUpdates.length;

      // Schirme-Liste entsprechend anlegen/aktualisieren.
      const next = [...schirme];
      for (const [origName, { cleaned, hersteller }] of Object.entries(renameMap)) {
        const existing = next.find(s => s.name === cleaned || s.name === origName);
        if (existing) {
          existing.name = cleaned;
          if (!existing.hersteller) existing.hersteller = hersteller;
        } else {
          next.push({ id: `schirm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: cleaned, hersteller, typ: "", letzterCheck: "", materialEntryId: null });
        }
      }
      await saveSchirme(next);
      const updatedFl = await loadAllFlights();
      setFlights(updatedFl);
      setMsg({ type: "ok", text: `✓ ${affectedNames.length} Schirm-Bezeichnung(en) bereinigt, ${updatedFlights} Flüge aktualisiert.` });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler bei der Bereinigung: " + (e.message || String(e)) });
    } finally {
      setBusy(false);
    }
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
      const existingNames = new Set(schirme.map(s => s.name));
      const missing = names.filter(n => !existingNames.has(n));
      if (!missing.length) {
        setMsg({ type: "ok", text: "Alle Schirm-Namen aus den Flügen sind bereits erfasst — nichts zu erzeugen." });
        setBusy(false);
        return;
      }
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
      await saveSchirme([...schirme, ...newEntries]);
      setMsg({ type: "ok", text: `✓ ${newEntries.length} Schirm(e) erzeugt${linked ? `, davon ${linked} automatisch mit Material verknüpft` : ""}.` });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Erzeugen: " + (e.message || String(e)) });
    } finally {
      setBusy(false);
    }
  };

  const flightCountFor = (name) => (flights || []).filter(f => (f.glider || "").trim() === name).length;
  const materialFor = (id) => material.find(m => m.id === id) || null;

  if (flights === null) {
    return <div style={{ padding: 24, color: "rgba(232,244,253,0.5)", fontFamily: "-apple-system,BlinkMacSystemFont,sans-serif" }}>Lade…</div>;
  }

  const sortedSchirme = [...schirme].sort((a, b) => a.name.localeCompare(b.name, "de"));

  return (
    <div style={{ minHeight: "100vh", background: "#040e20", color: "#e8f4fd", fontFamily: "-apple-system,BlinkMacSystemFont,sans-serif", paddingBottom: 40 }}>
      <div style={{ padding: "calc(18px + env(safe-area-inset-top, 0px)) 16px 6px" }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(232,244,253,0.4)", marginBottom: 2 }}>Flugbuch · Service</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px" }}>🪂 Schirme</h1>
        <div style={{ fontSize: 12, color: "rgba(232,244,253,0.45)" }}>{sortedSchirme.length} Schirme</div>
      </div>

      <div style={{ padding: "0 16px 14px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={generateFromFlights} disabled={busy}
          title="Legt für jeden in den Flügen verwendeten Schirm-Namen einen Eintrag an, falls noch keiner existiert."
          style={{ background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 8, padding: "9px 14px", color: "#4ade80", fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
          {busy ? "⏳ …" : "🔄 Schirme aus Flugbuch erzeugen"}
        </button>
        <button onClick={runCleanup} disabled={busy}
          title="Sucht bekannte Hersteller-Präfixe (UP, Supair, Ozone, Nova, MacPara) im Schirm-Feld der Flüge, entfernt sie dort und trägt sie hier als Hersteller ein."
          style={{ background: "rgba(250,204,21,0.12)", border: "1px solid rgba(250,204,21,0.3)", borderRadius: 8, padding: "9px 14px", color: "#facc15", fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
          {busy ? "⏳ …" : "🧹 Hersteller aus Schirm-Namen bereinigen"}
        </button>
        <button onClick={mergeDuplicates} disabled={busy}
          title="Führt Schirme mit optisch gleichem, aber intern leicht unterschiedlichem Namen zusammen (z.B. durch ein Leerzeichen). Ein Eintrag bekommt danach alle Flüge, der/die anderen 0."
          style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 8, padding: "9px 14px", color: "#a78bfa", fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
          {busy ? "⏳ …" : "🔗 Doppelte Schirme zusammenführen"}
        </button>
      </div>

      {msg && (
        <div style={{ margin: "0 16px 14px", background: msg.type === "ok" ? "rgba(74,222,128,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${msg.type === "ok" ? "rgba(74,222,128,0.3)" : "rgba(239,68,68,0.3)"}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: msg.type === "ok" ? "#4ade80" : "#f87171" }}>
          {msg.text}
        </div>
      )}

      {(() => {
        const existingNames = new Set(schirme.map(s => s.name));
        const pending = KNOWN_CORRECTIONS.filter(c => existingNames.has(c.from));
        if (!pending.length) return null;
        return (
          <div style={{ margin: "0 16px 14px", background: "rgba(125,211,252,0.06)", border: "1px solid rgba(125,211,252,0.2)", borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#7dd3fc", marginBottom: 10 }}>Vorgeschlagene Korrekturen</div>
            {pending.map(c => (
              <div key={c.from} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "rgba(232,244,253,0.8)" }}>„{c.from}" → „{c.to}"</span>
                <button onClick={() => applyCorrection(c.from, c.to)} disabled={busy}
                  style={{ flexShrink: 0, background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 8, padding: "5px 12px", color: "#4ade80", fontSize: 11, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
                  Übernehmen
                </button>
              </div>
            ))}
          </div>
        );
      })()}

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
                <span style={{ fontSize: 11, color: "rgba(232,244,253,0.4)" }}>{flightCountFor(s.name)} Flüge</span>
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
            const next = schirme.filter(s => s.id !== id);
            await saveSchirme(next);
            setEditing(null);
          }}
        />
      )}

      <div style={{ padding: "16px 16px 0" }}>
        <a href="service.html" style={{ display: "inline-block", fontSize: 12, color: "rgba(125,211,252,0.7)", textDecoration: "none" }}>← Zurück zu Service</a>
      </div>
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
